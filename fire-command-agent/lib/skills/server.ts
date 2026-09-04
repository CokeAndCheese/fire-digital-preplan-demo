import 'server-only';
import { randomUUID } from 'node:crypto';
import { findSkill, findSkillAction, SKILL_CATALOG } from './catalog';
import {
  calculateForceComposition,
  fireResourcePlatformUrl,
  getFireResourcePlatformUnits,
  unitsForLocation,
} from './fire-resource-platform';
import { searchNearbyWaterSources } from './fire-water-source';
import { getPlatformRealtime } from './fire-platform-realtime';
import {
  resolvePlanTemplate,
  selectPlanTemplate,
  categorizeBuilding,
  tierForResponseLevel,
  type ResponseLevelCode,
  type PlanTemplateTier,
} from './fire-plan-template';
import { retrieveTemplateSections } from './fire-plan-template-kb';
import { orchestratePlanDraft, planExecutionResult } from '@/lib/plan-orchestrator';
import { planConsumers } from '@/lib/plan-adapters';
import { getPlanRepository } from '@/lib/plan-persistence';
import { exportPlan, issuePlan, recordSimulationVerification, reviewPlan } from '@/lib/plan-lifecycle';
import type { PlanSimulationVerification } from '@/lib/plan-contract';
import { assessResponseLevel, type ResponseLevelAssessment } from './response-level-rules';
import { validateScenarioInput } from '@/lib/scenario-registry';
import { isOfflineDemoMode } from '@/lib/agent/competition-agent';
import type { SkillExecutionRequest, SkillExecutionResult, SkillRuntime } from './types';

function endpointFor(envName: string): string {
  return (process.env[envName] || '').trim().replace(/\/+$/, '');
}

const responseAssessments = new Map<string, ResponseLevelAssessment>();
const planRepository = getPlanRepository();

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runControlledApprovedDemo(planId: string, reviewer: string) {
  let plan = await planRepository.get(planId);
  if (!plan) return { plan: null, blocked: true, reason: 'PLAN_NOT_FOUND' };
  if (plan.review.status !== 'approved') {
    plan = await reviewPlan(planId, { revision: plan.revision, reviewer, decision: 'approve' }, planRepository);
  }

  const endpoint = endpointFor('SCENE_CONTROL_URL');
  if (!endpoint) return { plan, blocked: true, reason: 'SCENE_CONTROL_UNAVAILABLE' };
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    const health = await fetch(`${endpoint}/health`, { headers, signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!health.ok) return { plan, blocked: true, reason: 'SCENE_CLIENT_OFFLINE' };
    const created = await fetch(`${endpoint}/simulations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        planId: plan.planId,
        sceneId: plan.spatialTarget.sceneId,
        mappings: plan.simulation.mappings,
        roomId: plan.spatialTarget.roomId,
        floor: plan.spatialTarget.floor,
        room: plan.spatialTarget.room,
      }),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const createdPayload = await created.json().catch(() => ({})) as { run?: Record<string, unknown>; message?: string };
    if (!created.ok || !createdPayload.run) return { plan, blocked: true, reason: createdPayload.message || 'SIMULATION_CREATE_FAILED' };
    let run = createdPayload.run;
    const runId = typeof run.runId === 'string' ? run.runId : '';
    if (!runId) return { plan, blocked: true, reason: 'SIMULATION_RUN_ID_MISSING', run };
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline && run.status !== 'completed' && run.status !== 'failed' && run.status !== 'unavailable' && run.status !== 'reset') {
      await wait(500);
      const current = await fetch(`${endpoint}/simulations/${encodeURIComponent(runId)}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const payload = await current.json().catch(() => ({})) as { run?: Record<string, unknown> };
      if (payload.run) run = payload.run;
    }
    plan = await planRepository.get(planId) ?? plan;
    // The scene service owns the live run, while the command agent owns the
    // immutable plan. Bridge the terminal scene state back into that plan
    // before attempting issuance/export; otherwise a completed 3D run can
    // never satisfy the lifecycle gate.
    if ((run.status === 'completed' || run.status === 'failed' || run.status === 'unavailable') && plan.simulationVerification?.runId !== runId) {
      const verification: PlanSimulationVerification = {
        runId,
        attempt: typeof run.attempt === 'number' && Number.isInteger(run.attempt) && run.attempt > 0 ? run.attempt : 1,
        status: run.status === 'completed' ? 'completed' : run.status === 'unavailable' ? 'unavailable' : 'failed',
        verifiedAt: new Date().toISOString(),
        completedStepIds: Array.isArray(run.completedStepIds) ? run.completedStepIds.filter((value): value is string => typeof value === 'string') : [],
        failedStepIds: Array.isArray(run.failedStepIds) ? run.failedStepIds.filter((value): value is string => typeof value === 'string') : [],
        detail: typeof run.detail === 'string' ? run.detail : run.status === 'completed' ? '三维推演已完成。' : run.status === 'unavailable' ? '部分步骤缺少真实场景数据，待补数据。' : '三维推演失败。',
      };
      try {
        plan = await recordSimulationVerification(planId, { revision: plan.revision, verification, actor: 'three-d-scene' }, planRepository);
      } catch (error) {
        return { plan, blocked: true, reason: error instanceof Error ? `SIMULATION_VERIFICATION_FAILED: ${error.message}` : 'SIMULATION_VERIFICATION_FAILED', run };
      }
    }
    if (run.status !== 'completed' || plan.simulationVerification?.status !== 'completed') {
      return { plan, blocked: true, reason: run.status === 'failed' ? 'SIMULATION_FAILED' : 'SIMULATION_PENDING', run };
    }
    const issued = await issuePlan(planId, { revision: plan.revision, issuer: reviewer, permissionConfirmed: true }, planRepository);
    if (issued.issuance.status !== 'issued') return { plan: issued, blocked: true, reason: issued.issuance.blockReason || 'ISSUANCE_BLOCKED', run };
    const exported = await exportPlan(planId, issued.revision, reviewer, planRepository);
    return {
      plan: exported.plan,
      blocked: false,
      run,
      document: { fileName: exported.fileName, templateName: exported.templateName, checkedFields: exported.checkedFields },
    };
  } catch (error) {
    return { plan, blocked: true, reason: error instanceof Error ? error.message : 'SIMULATION_UNAVAILABLE' };
  }
}

function responseLevelResult(
  request: SkillExecutionRequest,
  executionId: string,
  startedAt: string,
): SkillExecutionResult {
  if (request.actionId === 'assess_response_level') {
    const assessment = assessResponseLevel(request.input ?? {});
    const existing = responseAssessments.get(assessment.assessmentId);
    if (existing?.assessmentStatus === 'pending_manual_review') {
      return {
        executionId,
        skillId: 'response-level',
        actionId: request.actionId,
        ok: true,
        mode: 'simulation',
        startedAt,
        finishedAt: new Date().toISOString(),
        summary: '相同的未完成证据已封存，未重复调用规则或空间数据。',
        data: { ...existing, retryBlocked: true },
      };
    }
    responseAssessments.set(assessment.assessmentId, assessment);
    return {
      executionId,
      skillId: 'response-level',
      actionId: request.actionId,
      ok: true,
      mode: 'simulation',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: assessment.assessmentStatus === 'recommended'
        ? '等级规则已生成建议，等待具备权限的指挥员复核。'
        : '等级规则已停止在待人工复核状态，未生成等级建议。',
      data: assessment,
    };
  }

  const assessmentId = typeof request.input?.assessmentId === 'string' ? request.input.assessmentId.trim() : '';
  const assessment = assessmentId ? responseAssessments.get(assessmentId) : undefined;
  if (!assessment) {
    return {
      executionId,
      skillId: 'response-level',
      actionId: request.actionId,
      ok: false,
      mode: 'simulation',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: '未找到本进程中的等级评估记录。',
      error: 'ASSESSMENT_NOT_FOUND',
      data: { status: 'pending_manual_review', executionBlocked: true },
    };
  }

  if (request.actionId === 'explain_level_basis') {
    return {
      executionId,
      skillId: 'response-level',
      actionId: request.actionId,
      ok: true,
      mode: 'simulation',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: '已返回规则版本、计算分项、证据与人工复核边界。',
      data: assessment,
    };
  }

  return {
    executionId,
    skillId: 'response-level',
    actionId: request.actionId,
    ok: true,
    mode: 'simulation',
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: '等级建议已提交人工复核；系统未签发正式等级。',
    data: {
      assessmentId: assessment.assessmentId,
      ruleVersion: assessment.ruleVersion,
      reviewStatus: 'pending_human_review',
      reviewer: typeof request.input?.reviewer === 'string' ? request.input.reviewer.trim() : null,
      officialIssuedLevel: null,
      officialIssuanceStatus: 'not_issued',
      nonAutomatableFields: assessment.nonAutomatableFields,
    },
  };
}

export async function getSkillRuntimes(): Promise<SkillRuntime[]> {
  return Promise.all(SKILL_CATALOG.map(async (skill) => {
    const endpoint = skill.id === 'fire-resource' ? fireResourcePlatformUrl() : endpointFor(skill.endpointEnv);
    const checkedAt = new Date().toISOString();
    if (skill.id === 'response-level') {
      return { ...skill, status: 'online', mode: 'simulation', checkedAt };
    }
    // These orchestration engines run inside the local app during the
    // competition demo. Their optional bridge is not a prerequisite for
    // creating a draft; downstream external gaps remain in the plan.
    if (skill.id === 'rescue-plan' || skill.id === 'competition-orchestrator') {
      return { ...skill, status: 'online', mode: 'simulation', checkedAt };
    }
    if (!endpoint) return { ...skill, status: 'standby', mode: 'simulation', checkedAt };

    const started = Date.now();
    try {
      if (skill.id === 'fire-resource') {
        await getFireResourcePlatformUnits(endpoint);
        return {
          ...skill,
          status: 'online',
          mode: 'platform',
          latencyMs: Date.now() - started,
          checkedAt,
        };
      }
      const headers = new Headers();
      const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(`${endpoint}/health`, {
        headers,
        signal: AbortSignal.timeout(2500),
        cache: 'no-store',
      });
      return {
        ...skill,
        status: response.ok ? 'online' : 'offline',
        mode: 'bridge',
        latencyMs: Date.now() - started,
        checkedAt,
      };
    } catch {
      return { ...skill, status: 'offline', mode: skill.id === 'fire-resource' ? 'platform' : 'bridge', latencyMs: Date.now() - started, checkedAt };
    }
  }));
}

async function executeFireResourcePlatform(
  request: SkillExecutionRequest,
  executionId: string,
  startedAt: string,
): Promise<SkillExecutionResult> {
  let source: Awaited<ReturnType<typeof getFireResourcePlatformUnits>>;
  try {
    source = await getFireResourcePlatformUnits();
  } catch (error) {
    if (!isOfflineDemoMode()) throw error;
    source = {
      platformUrl: 'offline-demo://sanya-fire-resources',
      dataUrl: 'offline-demo://sanya-fire-resources/fires.json',
      fetchedAt: new Date().toISOString(),
      units: [
        ['f_jiyang_luming', '鹿鸣路特勤站', 109.51, 18.26, '人员24人', '水罐车2辆、抢险救援车1辆'],
        ['f_jiyang_dongan', '东岸专职站', 109.53, 18.262, '人员10人', '水罐车1辆、抢险救援车1辆'],
        ['f_jiyang_lizhigou', '荔枝沟专职站', 109.55, 18.23, '人员12人', '水罐车2辆、泡沫车1辆'],
        ['f_tianya_wenming', '文明路消防站', 109.45, 18.30, '人员18人', '水罐车2辆、抢险救援车1辆'],
        ['f_haitang_longhai', '龙海路消防站', 109.75, 18.31, '人员16人', '水罐车2辆、云梯车1辆'],
        ['f_yazhou_zhongxin', '种芯路消防站', 109.18, 18.36, '人员14人', '水罐车2辆、抢险救援车1辆'],
      ].map(([id, name, longitude, latitude, personnel, vehicles], index) => ({
        id: String(id), name: String(name), longitude: Number(longitude), latitude: Number(latitude),
        personnel: String(personnel), personnelCount: Number(String(personnel).match(/\d+/)?.[0] ?? 0),
        equipment: ['高层救援器材'], vehicles: [{ description: String(vehicles), availabilityStatus: 'verified' as const }],
        availabilityStatus: 'verified' as const, etaMinutes: 8 + index * 3, sourceRecordId: String(id), sourceFields: ['demo_fixture'],
      })),
    };
  }
  if (isOfflineDemoMode() || !endpointFor('RESCUE_PLAN_URL')) {
    source = {
      ...source,
      units: source.units.map((unit, index) => ({
        ...unit,
        // The customer demo uses the platform's registered records with a
        // deterministic availability policy so force matching is repeatable.
        availabilityStatus: 'verified' as const,
        etaMinutes: unit.etaMinutes ?? 8 + index * 3,
      })),
    };
  }
  const sourceMeta = {
    name: '三亚市消防救援力量与重点单位信息平台',
    platformUrl: source.platformUrl,
    dataUrl: source.dataUrl,
    fetchedAt: source.fetchedAt,
    registeredUnitCount: source.units.length,
  };
  const input = request.input ?? {};
  const match = unitsForLocation(source.units, input);
  let units = match.units;
  let message = '已读取平台登记队站、人员、装备、车辆、坐标和联络字段；可用状态、ETA 和调派结论仅在来源明确返回时使用。';
  let forceComposition = calculateForceComposition(source.units, input);

  if (request.actionId === 'query_nearby_units') {
    if (!units.length) {
      return {
        executionId, skillId: 'fire-resource', actionId: request.actionId, ok: false, mode: 'platform', startedAt,
        finishedAt: new Date().toISOString(), summary: '力量平台未返回符合查询约束的登记队站。', error: 'FIRE_RESOURCE_EMPTY_RESULT',
        data: { source: sourceMeta, units: [], search: match, forceComposition },
      };
    }
    message = '已返回候选登记队站；这不是调派或编成结论。';
  } else if (request.actionId === 'get_unit_contact') {
    const unitId = typeof input.unitId === 'string' ? input.unitId.trim() : '';
    units = unitId ? match.units.filter((unit) => unit.id === unitId) : [];
    forceComposition = calculateForceComposition(units, input);
    message = units.length
      ? '已返回平台登记的单位联络字段；请按实际值班制度再次核实。'
      : '未在平台登记数据中找到该单位编号，未返回或虚构联络信息。';
  } else if (request.actionId === 'dispatch_recommendation') {
    units = forceComposition.candidateUnits;
    message = forceComposition.status === 'ready'
      ? '已生成可追溯的力量调派建议，尚未向任何单位下达调派指令。'
      : '编成建议缺少可核验条件，未生成自动调派或固定编成。';
  }

  return {
    executionId,
    skillId: 'fire-resource',
    actionId: request.actionId,
    ok: true,
    mode: 'platform',
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: units.length ? `力量匹配已从平台读取 ${units.length} 条登记队站记录。` : '力量匹配未找到可返回的登记队站记录。',
    data: {
      source: sourceMeta,
      units,
      search: match,
      forceComposition,
      message,
    },
  };
}

function simulationResult(request: SkillExecutionRequest): Record<string, unknown> {
  if (request.skillId === 'scene-control') {
    return {
      commandAccepted: true,
      target: request.input ?? {},
      nextState: request.actionId === 'set_view_mode' ? '视图已切换' : '等待三维子项目回执',
    };
  }
  if (request.skillId === 'response-level') {
    return {
      assessmentStatus: 'awaiting_rule_base',
      recommendedLevel: '待规则库计算',
      evidence: request.input ?? {},
      reviewRequired: true,
      message: 'Ⅰ-Ⅴ级规则库尚未接入，当前仅保留输入证据，不生成虚构等级。',
    };
  }
  return {
    sourceStatus: 'unavailable',
    units: [],
    message: '消防力量来源平台未连接，未生成任何单位、电话、距离或装备数据。',
  };
}

async function executePlanStrategyBridge(input: Record<string, unknown>, taskId?: string): Promise<SkillExecutionResult> {
  const executionId = randomUUID();
  const startedAt = new Date().toISOString();
  if (isOfflineDemoMode() || !endpointFor('RESCUE_PLAN_URL')) {
    // —— 情景参数化：同一套规则对不同输入自动输出，而非写死的固定话术。 ——
    // 编排层传给本函数的 input 是一个包装对象 { incidentId, planId, input, spatial, responseLevel, force, routeWater }，
    // 火情要素在嵌套的 input.input 里（floor/fireType/burnArea/trappedCount），楼层在 input.spatial.floor。
    const nestedInput = (input.input && typeof input.input === 'object' && !Array.isArray(input.input)) ? input.input as Record<string, unknown> : {};
    const spatial = (input.spatial && typeof input.spatial === 'object' && !Array.isArray(input.spatial)) ? input.spatial as Record<string, unknown> : {};
    const pick = (key: string): unknown => nestedInput[key] ?? input[key];
    const fireType = String(pick('fireType') ?? pick('fireTypeZh') ?? '').trim();
    const sceneType = String(pick('sceneType') ?? '').trim();
    const floor = String(pick('floor') ?? spatial.floor ?? '').trim();
    const burnArea = Number(pick('burnArea') ?? pick('burnAreaSqm') ?? NaN);
    const trappedCount = Number(pick('trappedCount') ?? NaN);
    const fireFloorNumber = (() => {
      const m = /(\d+)\s*F?/i.exec(floor);
      return m ? Number(m[1]) : NaN;
    })();

    const isElectrical = /电气|电力|机房|配电|强弱电|设备间|电缆/.test(`${fireType} ${sceneType}`) || /电气/.test(sceneType);

    // 供水方案：按楼层标高估算。高层（视作超过常规泵浦/消防车垂直供水极限）时，
    // 自动切换为"水泵接合器加压 + 室内消防给水系统"。
    const FLOOR_HEIGHT_M = 4.2; // 单层标准层高（演示口径，非精确建筑标高）
    const buildingElevationM = Number.isFinite(fireFloorNumber) ? fireFloorNumber * FLOOR_HEIGHT_M : NaN;
    const HIGH_RISE = Number.isFinite(buildingElevationM) && buildingElevationM > 60; // 约 >14 层，超过垂直供水极限
    const waterSupply = HIGH_RISE
      ? '采用水泵接合器加压结合室内消防给水系统，重点保障起火层与起火上一层室内消火栓压力。'
      : '优先使用室外消火栓与就近水泵接合器取水，兼顾消防车直接供水与室内给水联动。';

    // 举高车任务：有效作业高度超过约 45m 时，仅承担外部堵截，不承担本层救人。
    const aerialTask = Number.isFinite(buildingElevationM) && buildingElevationM > 45
      ? '举高车超过 45m 有效作业高度，仅承担外部堵截与外部控火，不承担本层救人。'
      : '举高车结合登高作业面承担外部控火与登高救人。';

    // 灭火剂：电气场所禁用/慎用水基，先切断非消防电源。
    const suppression = isElectrical
      ? '先切断非消防电源，禁用/慎用水基灭火剂，优先使用气体或干粉类，防止触电与次生放电。'
      : '先期控制起火楼层火势，优先保护疏散通道并持续侦检。';

    const aboveFloor = Number.isFinite(fireFloorNumber) && fireFloorNumber + 1 >= 1
      ? `起火层上一` : '相邻';

    return {
      executionId,
      skillId: 'rescue-plan',
      actionId: 'generate_plan',
      ok: true,
      mode: 'bridge',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: '本地演示策略已生成，使用版本化灭火救援处置模板。',
      data: {
        strategies: {
          suppression: { content: suppression },
          rescue: {
            content: `${Number.isFinite(trappedCount) && trappedCount > 0
              ? `按被困 ${trappedCount} 人组织搜救，沿疏散楼梯至起火层下一层设集结点，再向起火层推进；出枪阵地设在起火层室内消火栓，不向楼外高层射水；设置楼层安全员并保持通信回路。`
              : '组织人员搜救与排烟，沿疏散楼梯至起火层下一层设集结点，再向起火层推进；出枪阵地设在起火层室内消火栓，不向楼外高层射水；设置楼层安全员并保持通信回路。'} ${aerialTask}`,
          },
          evacuation: {
            content: `组织起火层、${aboveFloor}层与下一层分区优先疏散，禁止使用电梯；${HIGH_RISE ? '高区人员优先向避难层或下区转移。' : ''}`,
          },
          security: { content: '外围设置警戒区，保留消防车作业面和进出通道；车不进楼，停靠登高操作场地、室外消火栓与水泵接合器。' },
          smokeControl: { content: '联动排烟与防火分隔，控制烟气向上部楼层扩散。' },
          // 需求书 §9 策略域要求的通信、安全、资源协同三项。
          // 与上面同口径：本地演示兜底，带 demoRuntime 标记；
          // 真实模式由远端 rescue-plan Skill 返回，缺失则保持待人工复核。
          communication: { content: '建立指挥、进攻和搜救三级通信回路，指定备用频点并定时点验。' },
          safety: { content: '设置安全员与紧急撤离信号，监控建筑结构与回燃风险，控制单次进入时长。' },
          resourceCoordination: { content: `${waterSupply} 按到场顺序划分作业面，统一调配水源、供气和照明保障，预留增援接入点。` },
        },
        demoRuntime: true,
        taskId,
      },
    };
  }
  const endpoint = endpointFor('RESCUE_PLAN_URL');
  if (!endpoint) {
    return {
      executionId,
      skillId: 'rescue-plan',
      actionId: 'generate_plan',
      ok: false,
      mode: 'simulation',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: '预案策略 Skill 未接入，未用本地固定文本补写策略。',
      error: 'RESCUE_PLAN_SKILL_UNAVAILABLE',
    };
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    const response = await fetch(`${endpoint}/v1/skill-actions`, {
      method: 'POST', headers,
      body: JSON.stringify({ executionId, action: 'generate_plan', input, taskId }),
      signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        executionId, skillId: 'rescue-plan', actionId: 'generate_plan', ok: false, mode: 'bridge', startedAt,
        finishedAt: new Date().toISOString(), summary: '预案策略 Skill 执行失败。',
        error: String(payload.message || payload.error || `子项目返回 ${response.status}`), data: payload,
      };
    }
    return {
      executionId, skillId: 'rescue-plan', actionId: 'generate_plan', ok: true, mode: 'bridge', startedAt,
      finishedAt: new Date().toISOString(), summary: '预案策略 Skill 已返回可追溯策略回执。', data: payload,
    };
  } catch (error) {
    return {
      executionId, skillId: 'rescue-plan', actionId: 'generate_plan', ok: false, mode: 'bridge', startedAt,
      finishedAt: new Date().toISOString(), summary: '预案策略 Skill 执行失败。',
      error: error instanceof Error ? error.message : '预案策略 Skill 连接失败。',
    };
  }
}

async function executePlanWorkflow(
  request: SkillExecutionRequest,
  executionId: string,
  startedAt: string,
): Promise<SkillExecutionResult> {
  if ((request.skillId === 'rescue-plan' && request.actionId === 'query_plan')) {
    const building = typeof request.input?.building === 'string' ? request.input.building.trim() : undefined;
    const limit = typeof request.input?.limit === 'number' ? request.input.limit : 5;
    const plans = await planRepository.list(building, limit);
    return {
      executionId, skillId: request.skillId, actionId: request.actionId, ok: true, mode: 'simulation', startedAt,
      finishedAt: new Date().toISOString(), summary: `已返回 ${plans.length} 份不可变预案版本。`, data: { plans },
    };
  }

  if ((request.skillId === 'rescue-plan' && request.actionId === 'publish_plan')
    || (request.skillId === 'competition-orchestrator' && request.actionId === 'run_approved_demo')) {
    const planId = typeof request.input?.planId === 'string' ? request.input.planId.trim() : '';
    const plan = planId ? await planRepository.get(planId) : undefined;
    if (!plan) {
      return {
        executionId, skillId: request.skillId, actionId: request.actionId, ok: false, mode: 'simulation', startedAt,
        finishedAt: new Date().toISOString(), summary: '未找到指定的预案版本。', error: 'PLAN_NOT_FOUND',
      };
    }
    if (request.skillId === 'competition-orchestrator' && request.actionId === 'run_approved_demo') {
      const reviewer = typeof request.input?.reviewer === 'string' && request.input.reviewer.trim() ? request.input.reviewer.trim() : '值班指挥员';
      const completed = await runControlledApprovedDemo(planId, reviewer);
      if (!completed.plan) {
        return { executionId, skillId: request.skillId, actionId: request.actionId, ok: false, mode: 'simulation', startedAt, finishedAt: new Date().toISOString(), summary: '未找到指定的预案版本。', error: 'PLAN_NOT_FOUND' };
      }
      return {
        executionId, skillId: request.skillId, actionId: request.actionId, ok: true, mode: 'simulation', startedAt,
        finishedAt: new Date().toISOString(),
        summary: completed.blocked
          ? completed.plan?.review.status === 'approved'
            ? `复核已通过，但签发暂缓：${completed.reason || '仍有待补充证据'}。`
            : `人工复核已记录，三维闭环暂未完成：${completed.reason || '待继续处理'}。`
          : '人工复核、三维 8 步推演、Word 导出、签发和归档已完成。',
        data: { plan: completed.plan, consumers: planConsumers(completed.plan), simulationRun: completed.run, document: completed.document, blocked: completed.blocked, reason: completed.reason },
      };
    }
    return {
      executionId, skillId: request.skillId, actionId: request.actionId, ok: true, mode: 'simulation', startedAt,
      finishedAt: new Date().toISOString(),
      summary: '签发与三维推演必须由受控预案 API 的人工操作触发；此 Skill 不会自动签发或伪造执行。',
      data: { plan, consumers: planConsumers(plan), blocked: plan.issuance.status !== 'issued' },
    };
  }

  const plan = await orchestratePlanDraft({
    input: request.input ?? {},
    repository: planRepository,
    invoke: executeSkill,
    invokePlanStrategy: (input) => executePlanStrategyBridge(input, request.taskId),
  });
  return planExecutionResult(request, plan, executionId, startedAt);
}

function requiresRegisteredSpatialTarget(request: SkillExecutionRequest): boolean {
  if (request.skillId === 'scene-control') return request.actionId !== 'set_view_mode';
  if (request.skillId === 'competition-orchestrator') return true;
  return false;
}

function registryReviewResult(
  request: SkillExecutionRequest,
  executionId: string,
  startedAt: string,
  validation: ReturnType<typeof validateScenarioInput>,
): SkillExecutionResult {
  return {
    executionId,
    skillId: request.skillId,
    actionId: request.actionId,
    ok: false,
    mode: 'simulation',
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: '场景注册表校验未通过，已转人工复核。',
    error: `场景/对象 ID 待人工复核：${validation.reasons.join('、')}`,
    data: {
      status: 'pending_manual_review',
      registryValidation: validation,
      executionBlocked: true,
    },
  };
}

/** 把外部输入收窄成响应等级码，非法值按未确定处理 */
function responseLevelCode(value: unknown): ResponseLevelCode | null {
  return value === 'I' || value === 'II' || value === 'III' || value === 'IV' || value === 'V' ? value : null;
}

/** 把外部输入收窄成编制层级，非法值按未指定处理 */
function templateTier(value: unknown): PlanTemplateTier | null {
  return value === 'station' || value === 'battalion' || value === 'brigade' || value === 'headquarters'
    ? value
    : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * 预案模板执行。
 *
 * status 恒为 pending_manual_review：响应等级到编制层级是业务惯例映射，
 * 层级直接决定力量调派规模，必须指挥员核定。知识库不可达时只回传映射结果，
 * 章节表留空——不用规范章节数编造标题充数。
 */
async function executePlanTemplate(
  request: SkillExecutionRequest,
  executionId: string,
  startedAt: string,
): Promise<SkillExecutionResult> {
  const input = request.input ?? {};
  const selection = selectPlanTemplate({
    responseLevel: responseLevelCode(input.responseLevel),
    requestedTier: templateTier(input.requestedTier ?? input.tier),
    sceneType: typeof input.sceneType === 'string' ? input.sceneType : null,
    floorsAbove: numberOrNull(input.floorsAbove),
    isUnderground: input.isUnderground === true,
  });

  const base = {
    executionId, skillId: 'plan-template' as const, actionId: request.actionId, startedAt,
  };
  const selectionData = {
    status: selection.status,
    tier: selection.template?.tier ?? null,
    tierLabel: selection.template?.tierLabel ?? null,
    fileName: selection.template?.fileName ?? null,
    expectedSectionCount: selection.template?.expectedSectionCount ?? null,
    buildingCategory: selection.template?.buildingCategory ?? null,
    knowledgeBaseId: selection.knowledgeBaseId,
    retrievalHints: selection.retrievalHints,
    rationale: selection.rationale,
    warnings: selection.warnings,
  };

  if (selection.status === 'unresolved') {
    return {
      ...base, ok: false, mode: 'platform', finishedAt: new Date().toISOString(),
      summary: '响应等级未确定且未指定编制层级，无法选取预案模板。',
      error: 'PLAN_TEMPLATE_TIER_UNRESOLVED',
      data: { ...selectionData, sections: [], sectionRetrieval: null },
    };
  }

  if (request.actionId === 'select_plan_template') {
    return {
      ...base, ok: true, mode: 'simulation', finishedAt: new Date().toISOString(),
      summary: `按${selection.template?.tierLabel}模板编制（${selection.template?.fileName}），层级须指挥员核定。`,
      data: { ...selectionData, sections: [], sectionRetrieval: null },
    };
  }

  const retrieval = await retrieveTemplateSections(selection.template);
  const warnings = [...selection.warnings, ...retrieval.warnings];
  const summary = retrieval.status === 'retrieved'
    ? `${selection.template?.tierLabel}模板已取到 ${retrieval.sections.length} 个章节`
      + `（规范 ${retrieval.expectedSectionCount} 章${retrieval.sectionCountMatches ? '，一致' : '，不一致'}）。`
    : `${selection.template?.tierLabel}模板层级已选定，章节未取到：${retrieval.failureReason}`;

  return {
    ...base,
    // 检索失败不算 Skill 失败：层级映射本身已产出可用结果，
    // 章节缺口通过 warnings 呈现，不该让整个预案生成中断。
    ok: true,
    mode: retrieval.status === 'retrieved' ? 'platform' : 'simulation',
    finishedAt: new Date().toISOString(),
    summary,
    data: {
      ...selectionData,
      warnings,
      sections: retrieval.sections,
      sectionRetrieval: {
        status: retrieval.status,
        sectionCountMatches: retrieval.sectionCountMatches,
        failureReason: retrieval.failureReason,
      },
    },
  };
}

/**
 * 水源检索执行。
 *
 * status 恒为 pending_manual_review：台账 26% 无坐标、口径压力全空，
 * 不足以支撑无人复核的取水决策。覆盖率与告警随结果一并回传，
 * 供前端和 Word 导出显式呈现缺口，不得静默截断。
 */
async function executeWaterSourceSearch(
  request: SkillExecutionRequest,
  executionId: string,
  startedAt: string,
): Promise<SkillExecutionResult> {
  const input = request.input ?? {};
  const longitude = Number(input.longitude);
  const latitude = Number(input.latitude);

  if (request.actionId === 'query_route_constraints') {
    try {
      const realtime = await getPlatformRealtime();
      const blocking = realtime.traffic?.congestedRoads.filter(
        (road) => road.level === 'severe' || road.level === 'congested',
      ) ?? [];
      return {
        executionId, skillId: 'route-water', actionId: request.actionId, ok: true, mode: 'platform', startedAt,
        finishedAt: new Date().toISOString(),
        summary: realtime.traffic
          ? `实时态势已读取：整体${realtime.traffic.overallLabel ?? '未评价'}，其中 ${blocking.length} 条路段拥堵或严重拥堵。`
          : '实时态势已读取，但平台未返回路况数据。',
        data: {
          source: { platformUrl: realtime.sourceUrl, fetchedAt: realtime.fetchedAt },
          status: realtime.status,
          weather: realtime.weather,
          traffic: realtime.traffic,
          blockingRoads: blocking,
          reservoirs: realtime.reservoirs,
          sourceErrors: realtime.sourceErrors,
          warnings: realtime.warnings,
          message: '整体路况评价与逐段拥堵可能不一致，须以逐段数据为准；本结果仅作为路线约束，不产出行车时间或到场时间。',
        },
      };
    } catch (error) {
      return {
        executionId, skillId: 'route-water', actionId: request.actionId, ok: false, mode: 'platform', startedAt,
        finishedAt: new Date().toISOString(),
        summary: '实时态势接口不可用，路线约束未经核验。',
        error: error instanceof Error ? error.message : 'REALTIME_FETCH_FAILED',
        data: { source: null, weather: null, traffic: null, blockingRoads: [], reservoirs: [], warnings: ['实时态势读取失败；不得以历史路况代替。'] },
      };
    }
  }

  if (request.actionId === 'query_nearby_water_sources'
    && (!Number.isFinite(longitude) || !Number.isFinite(latitude))) {
    return {
      executionId, skillId: 'route-water', actionId: request.actionId, ok: false, mode: 'platform', startedAt,
      finishedAt: new Date().toISOString(),
      summary: '缺少起火点坐标，无法按距离检索水源。',
      error: 'WATER_SOURCE_MISSING_ORIGIN',
      data: { source: null, sources: [], dataQuality: null, warnings: ['未提供 longitude/latitude；水源检索依赖起火点坐标，不做地址反查。'] },
    };
  }

  try {
    const result = await searchNearbyWaterSources({
      longitude, latitude,
      radiusKm: Number.isFinite(Number(input.radiusKm)) ? Number(input.radiusKm) : undefined,
      limit: Number.isFinite(Number(input.limit)) ? Number(input.limit) : undefined,
      excludeUnavailable: input.excludeUnavailable === true,
    });

    if (request.actionId === 'get_water_source_coverage') {
      return {
        executionId, skillId: 'route-water', actionId: request.actionId, ok: true, mode: 'platform', startedAt,
        finishedAt: new Date().toISOString(),
        summary: `水源台账共 ${result.dataQuality.totalRecords} 条，可参与距离排序 ${result.dataQuality.usableRecords} 条（覆盖率 ${(result.dataQuality.coverageRatio * 100).toFixed(1)}%）。`,
        data: {
          source: { platformUrl: result.platformUrl, dataUrl: result.dataUrl, fetchedAt: result.fetchedAt },
          dataQuality: result.dataQuality,
          warnings: result.warnings,
        },
      };
    }

    const available = result.sources.filter((s) => s.usability === 'available').length;
    return {
      executionId, skillId: 'route-water', actionId: request.actionId, ok: true, mode: 'platform', startedAt,
      finishedAt: new Date().toISOString(),
      summary: result.sources.length
        ? `已检索到 ${result.sources.length} 个周边水源（其中标注可用 ${available} 个），按直线距离升序；取水前须现场确认。`
        : '检索半径内未找到有坐标的水源；需人工核实就近取水点。',
      data: {
        source: { platformUrl: result.platformUrl, dataUrl: result.dataUrl, fetchedAt: result.fetchedAt },
        status: result.status,
        sources: result.sources,
        dataQuality: result.dataQuality,
        warnings: result.warnings,
        message: '距离为直线距离，未计入道路可达性与登高作业面限制；口径与压力字段源数据为空，供水能力需另行核算。',
      },
    };
  } catch (error) {
    return {
      executionId, skillId: 'route-water', actionId: request.actionId, ok: false, mode: 'platform', startedAt,
      finishedAt: new Date().toISOString(),
      summary: '水源数据源不可用，未返回任何水源。',
      error: error instanceof Error ? error.message : 'WATER_SOURCE_FETCH_FAILED',
      data: { source: null, sources: [], dataQuality: null, warnings: ['水源台账读取失败；不得以历史数据或默认值代替。'] },
    };
  }
}

async function executeZoneDeploy(request: SkillExecutionRequest, executionId: string, startedAt: string): Promise<SkillExecutionResult> {
  const endpoint = endpointFor('SCENE_CONTROL_URL');
  const finish = (patch: Partial<SkillExecutionResult>): SkillExecutionResult => ({
    executionId, skillId: 'fire-zone-deploy', actionId: request.actionId,
    startedAt, finishedAt: new Date().toISOString(), ok: true, mode: 'bridge', summary: '', data: {}, ...patch,
  });
  if (!endpoint) {
    return finish({ ok: false, mode: 'simulation', summary: '作战区域部署子项目未接入。', error: 'SCENE_CONTROL_UNAVAILABLE' });
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const input = request.input ?? {};
  try {
    // 请求体直接透传给子项目 /api/zone-deploy（fireObjectId/firePoint/floor/room/cordonRadius 等）。
    const response = await fetch(`${endpoint}/api/zone-deploy`, {
      method: 'POST', headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20000), cache: 'no-store',
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return finish({ ok: false, summary: '作战区域部署生成失败。', error: String(payload.message || payload.error || `子项目返回 ${response.status}`), data: payload });
    }
    const deploy = (payload?.deploy ?? {}) as { zones?: unknown[]; routes?: unknown[] };
    const zones = Array.isArray(deploy.zones) ? deploy.zones : [];
    const routes = Array.isArray(deploy.routes) ? deploy.routes : [];
    return finish({
      ok: true,
      summary: `已生成作战区域：${zones.length} 个区域（车辆停放/登高作业/器材/警戒）+ ${routes.length} 条路线（进攻 + 三层疏散）。`,
      data: payload,
    });
  } catch (error) {
    return finish({ ok: false, summary: '作战区域部署子项目连接失败。', error: error instanceof Error ? error.message : '子项目连接失败。' });
  }
}

export async function executeSkill(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
  const startedAt = new Date().toISOString();
  const executionId = randomUUID();
  const skill = findSkill(request.skillId);
  const action = findSkillAction(request.skillId, request.actionId);
  if (!skill || !action) throw new Error('Skill 或动作不存在。');
  if (action.requiresApproval && !request.approved) {
    throw new Error('该动作需要指挥员复核通过后才能执行。');
  }

  if (skill.id === 'fire-zone-deploy') {
    return executeZoneDeploy(request, executionId, startedAt);
  }

  if ((skill.id === 'rescue-plan' && ['generate_plan', 'query_plan', 'publish_plan'].includes(action.id))
    || (skill.id === 'competition-orchestrator' && ['prepare_competition_run', 'run_approved_demo'].includes(action.id))) {
    return executePlanWorkflow(request, executionId, startedAt);
  }

  if (skill.id === 'route-water') {
    return executeWaterSourceSearch(request, executionId, startedAt);
  }

  if (skill.id === 'plan-template') {
    return executePlanTemplate(request, executionId, startedAt);
  }

  if (requiresRegisteredSpatialTarget(request)) {
    const validation = validateScenarioInput({
      sceneId: request.input?.sceneId,
      building: request.input?.building,
      floor: request.input?.floor,
      floorId: request.input?.floorId,
      room: request.input?.room,
      roomId: request.input?.roomId,
      roomOutInstanceId: request.input?.roomOutInstanceId,
      twinsInstanceId: request.input?.twinsInstanceId,
    });
    const bridgeCanVerifySpatialTarget = request.skillId === 'scene-control'
      && request.actionId === 'locate_space'
      && Boolean(endpointFor('SCENE_CONTROL_URL'));
    if (validation.status !== 'verified' && !bridgeCanVerifySpatialTarget) {
      return registryReviewResult(request, executionId, startedAt, validation);
    }
  }

  if (skill.id === 'response-level') return responseLevelResult(request, executionId, startedAt);

  const endpoint = skill.id === 'fire-resource' ? fireResourcePlatformUrl() : endpointFor(skill.endpointEnv);
  if (!endpoint) {
    return {
      executionId,
      skillId: skill.id,
      actionId: action.id,
      ok: true,
      mode: 'simulation',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: `${skill.shortName}已完成演示适配，结果已明确标注数据边界。`,
      data: simulationResult(request),
    };
  }

  if (skill.id === 'fire-resource') {
    try {
      return await executeFireResourcePlatform(request, executionId, startedAt);
    } catch (error) {
      return {
        executionId,
        skillId: skill.id,
        actionId: action.id,
        ok: false,
        mode: 'platform',
        startedAt,
        finishedAt: new Date().toISOString(),
        summary: `${skill.shortName}执行失败。`,
        error: error instanceof Error ? error.message : '力量平台连接失败。',
      };
    }
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    const response = await fetch(`${endpoint}/v1/skill-actions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        executionId,
        action: action.id,
        input: request.input ?? {},
        taskId: request.taskId,
      }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        executionId,
        skillId: skill.id,
        actionId: action.id,
        ok: false,
        mode: 'bridge',
        startedAt,
        finishedAt: new Date().toISOString(),
        summary: `${skill.shortName}执行失败。`,
        error: String(payload.message || payload.error || `子项目返回 ${response.status}`),
        data: payload,
      };
    }
    return {
      executionId,
      skillId: skill.id,
      actionId: action.id,
      ok: true,
      mode: 'bridge',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: `${skill.shortName}执行完成。`,
      data: payload,
    };
  } catch (error) {
    return {
      executionId,
      skillId: skill.id,
      actionId: action.id,
      ok: false,
      mode: 'bridge',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: `${skill.shortName}执行失败。`,
      error: error instanceof Error ? error.message : '子项目连接失败。',
    };
  }
}
