import { InMemoryPlanRepository, orchestratePlanDraft } from '../plan-orchestrator';
import type { UnifiedFireRescuePlan } from '../plan-contract';
import type { SkillExecutionRequest, SkillExecutionResult } from '../skills/types';

function receipt(
  request: SkillExecutionRequest,
  data: Record<string, unknown>,
  mode: SkillExecutionResult['mode'] = 'bridge',
): SkillExecutionResult {
  return {
    executionId: `${request.skillId}-${request.actionId}-fixture`,
    skillId: request.skillId,
    actionId: request.actionId,
    ok: true,
    mode,
    startedAt: '2026-08-21T00:00:00.000Z',
    finishedAt: '2026-08-21T00:00:00.100Z',
    summary: 'fixture receipt',
    data,
  };
}

async function invoke(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
  if (request.skillId === 'scene-control') {
    return receipt(request, { target: { sceneId: 'scene-fixture', floorName: '8F', floorId: 'floor-8', name: '808', roomId: 'room-808' } });
  }
  if (request.skillId === 'response-level') {
    return receipt(request, { recommendedLevelCode: 'III', ruleVersion: 'fixture-rule-v1', missingEvidence: [] }, 'simulation');
  }
  if (request.skillId === 'route-water') {
    // 路线水源固件：回执可用，但不声称主备路线已核验。
    // 该 Skill 设计上恒为 pending_manual_review，不进入签发闸门的失败项。
    if (request.actionId === 'query_route_constraints') {
      return receipt(request, {
        status: 'ready',
        weather: { weather: '阴', temperatureCelsius: 29, windDirection: '西南', windPower: '5' },
        traffic: { overallLabel: '畅通', congestedRoads: [] },
        blockingRoads: [],
        reservoirs: [{ name: '大隆水库', waterLevelMeters: 57.1 }],
        warnings: [],
      }, 'platform');
    }
    return receipt(request, {
      status: 'pending_manual_review',
      sources: [{ id: 'hyd-fixture-1', code: 'TEST-001', address: '迎宾路128号', distanceKm: 0.23, usability: 'available', diameterMm: null, pressureMpa: null }],
      dataQuality: { totalRecords: 100, usableRecords: 73, coverageRatio: 0.73 },
      warnings: [],
    }, 'platform');
  }
  if (request.skillId === 'plan-template') {
    return receipt(request, {
      status: 'pending_manual_review',
      tier: 'battalion',
      tierLabel: '大队级',
      fileName: '大队级预案模板.pdf',
      expectedSectionCount: 8,
      buildingCategory: null,
      knowledgeBaseId: '2086971423845441537',
      retrievalHints: ['大队级预案模板.pdf', '大队级预案', '大队级预案模板章节'],
      sections: [],
      sectionRetrieval: { status: 'not_configured', sectionCountMatches: null, failureReason: 'PLAN_TEMPLATE_KB_URL not configured.' },
      rationale: ['按 III 级响应建议推导层级：大队级（业务惯例映射，非规范强制条文）。'],
      warnings: ['模板章节未与《大队级预案模板.pdf》核对；预案章节完整性需人工比对纸质模版。', '模板层级依据业务惯例推导，直接影响力量调派规模与章节完整性，须由指挥员核定后定稿。'],
    }, 'simulation');
  }
  if (request.skillId === 'fire-zone-deploy') {
    return receipt(request, {
      deploy: {
        zones: [
          { id: 'parking', name: '车辆停放区', color: '#2FD4BF', polygon: [{ x: 1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, { x: 5, y: 4, z: 0 }, { x: 1, y: 4, z: 0 }] },
          { id: 'aerial', name: '登高作业面', color: '#5AA9E6', polygon: [{ x: 6, y: 1, z: 0 }, { x: 9, y: 1, z: 0 }, { x: 9, y: 3, z: 0 }, { x: 6, y: 3, z: 0 }] },
          { id: 'cordon', name: '警戒区', color: '#FF5B60', polygon: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }] },
        ],
        routes: [
          { id: 'attack', name: '进攻路线', color: '#2FD4BF', path: [{ x: 1, y: 1, z: 0 }, { x: 4, y: 4, z: 0 }] },
          { id: 'evacuation_fire', name: '着火层疏散路线', color: '#28C76F', path: [{ x: 3, y: 3, z: 8 }, { x: 4, y: 4, z: 0 }] },
          { id: 'evacuation_below', name: '着火层下层疏散路线', color: '#28C76F', path: [{ x: 3, y: 3, z: 4 }, { x: 4, y: 4, z: 0 }] },
          { id: 'main_route', name: '主路线', color: '#2FD4BF', path: [{ x: 1, y: 5, z: 0 }, { x: 3, y: 3, z: 0 }, { x: 4, y: 4, z: 0 }] },
          { id: 'backup_route', name: '备用路线', color: '#F0B34A', path: [{ x: 5, y: 5, z: 0 }, { x: 4, y: 2, z: 0 }, { x: 4, y: 4, z: 0 }] },
        ],
      },
      firePoint: { x: 4, y: 4, z: 8 },
    }, 'bridge');
  }
  return receipt(request, {
    units: [{ id: 'unit-01', name: '测试消防救援站', personnel: 30, vehicles: ['水罐车'], equipment: ['热像仪'] }],
    forceComposition: {
      status: 'ready',
      selectedUnits: [{ id: 'unit-01', name: '测试消防救援站', etaMinutes: 5 }],
    },
  }, 'platform');
}

const strategy: SkillExecutionResult = {
  executionId: 'rescue-plan-generate-plan-fixture',
  skillId: 'rescue-plan',
  actionId: 'generate_plan',
  ok: true,
  mode: 'bridge',
  startedAt: '2026-08-21T00:00:00.200Z',
  finishedAt: '2026-08-21T00:00:00.300Z',
  summary: 'fixture strategy',
  data: {
    strategies: {
      suppression: { content: '冷却并控制火势。' },
      rescue: { content: '优先搜救被困人员。' },
      evacuation: { content: '组织受影响区域疏散。' },
      security: { content: '建立警戒区域。' },
      smokeControl: { content: '核验排烟条件。' },
    },
  },
};

export async function createCompletePlan(repository: InMemoryPlanRepository, incidentId = 'INC-FIXTURE'): Promise<UnifiedFireRescuePlan> {
  return orchestratePlanDraft({
    repository,
    invoke,
    invokePlanStrategy: async () => strategy,
    input: {
      incidentId,
      building: '测试大厦',
      buildingId: 'building-fixture',
      sceneId: 'scene-fixture',
      floor: '8F',
      floorId: 'floor-8',
      room: '808',
      roomId: 'room-808',
      fireType: '电气火灾',
      trappedCount: 2,
      burnArea: 35,
      specialHazards: ['配电设备'],
    },
  });
}
