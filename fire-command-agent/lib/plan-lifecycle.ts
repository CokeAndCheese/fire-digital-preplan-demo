import 'server-only';
import { auditEvent, getPlanRepository, PlanConflictError } from './plan-persistence';
import { renderPlanDocument, PlanDocumentError } from './plan-document';
import { verifyDocumentVisually, visualAuditSummary, pendingVisualCheck } from './plan-document-visual';
import type { PlanSimulationVerification, PlanWaterSourceQuery, UnifiedFireRescuePlan } from './plan-contract';
import type { MutablePlanRepository } from './plan-orchestrator';

export class PlanLifecycleError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = 'PlanLifecycleError';
    this.status = status;
  }
}

function defaultRepository(): MutablePlanRepository {
  return getPlanRepository();
}

function asWaterLabel(entry: { code: string | null; address: string | null; id: string }) {
  return entry.code || entry.address || entry.id;
}

function actor(value: unknown, fallback: string) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || fallback;
}

async function current(planId: string, repository: MutablePlanRepository) {
  const plan = await repository.get(planId);
  if (!plan) throw new PlanLifecycleError('未找到指定预案。', 404);
  return plan;
}

function assertVerificationMatchesPlan(plan: UnifiedFireRescuePlan, verification: PlanSimulationVerification) {
  const expectedStepIds = new Set(plan.simulation.mappings.map((step) => step.stepId));
  const completedStepIds = new Set(verification.completedStepIds);
  const failedStepIds = new Set(verification.failedStepIds);
  const actualStepIds = new Set([...completedStepIds, ...failedStepIds]);
  if (actualStepIds.size !== verification.completedStepIds.length + verification.failedStepIds.length
    || [...actualStepIds].some((stepId) => !expectedStepIds.has(stepId))) {
    throw new PlanLifecycleError('三维回执包含重复或不属于当前预案的步骤。');
  }
  if (verification.status === 'completed' && (
    failedStepIds.size > 0
    || completedStepIds.size !== expectedStepIds.size
    || [...expectedStepIds].some((stepId) => !completedStepIds.has(stepId))
  )) {
    throw new PlanLifecycleError(`完成状态必须精确覆盖全部 ${expectedStepIds.size} 个步骤且没有失败项。`);
  }
}

function simulationFullyVerified(plan: UnifiedFireRescuePlan) {
  const verification = plan.simulationVerification;
  if (!verification || verification.status !== 'completed') return false;
  try {
    assertVerificationMatchesPlan(plan, verification);
    return true;
  } catch {
    return false;
  }
}

export async function reviewPlan(
  planId: string,
  input: {
    revision: number; reviewer: string; decision: 'approve' | 'return'; comment?: string;
    /** 复核来源：human=人工操作；timeout=7 秒无操作按超时策略自动继续（需产生独立审计事件） */
    source?: 'human' | 'timeout';
    /**
     * 指挥员核定的正式响应等级。需求书 §6：正式等级只能由人工写入，
     * 编排流程不得把规则建议当成正式等级。不传则保持未核定。
     */
    confirmedLevel?: 'I' | 'II' | 'III' | 'IV' | 'V' | null;
  },
  repository: MutablePlanRepository = defaultRepository(),
) {
  const plan = await current(planId, repository);
  if (plan.revision !== input.revision) throw new PlanLifecycleError('预案已更新，请刷新后再复核。', 409);
  const reviewer = actor(input.reviewer, '未署名复核员');
  const comment = (input.comment || '').trim();
  if (!comment && input.decision === 'return') throw new PlanLifecycleError('退回必须填写人工意见。');
  const timeout = input.source === 'timeout';
  const at = new Date().toISOString();
  return repository.update(planId, plan.revision, (next) => {
    next.review.comments.push({ author: reviewer, content: comment || (timeout ? '7 秒无操作，系统按超时策略自动继续。' : '人工复核通过。'), at });
    next.review.reviewer = reviewer;
    next.review.reviewedAt = at;
    next.review.status = input.decision === 'approve' ? 'approved' : 'rejected';
    next.lifecycleStatus = input.decision === 'approve' ? 'approved' : 'pending_manual_review';
    next.issuance.status = 'not_issued';
    next.issuance.blockReason = input.decision === 'approve' ? next.issuance.blockReason : comment;
    // 正式等级只在通过时写入，且只记指挥员显式给出的值。
    if (input.decision === 'approve' && input.confirmedLevel) {
      next.responseLevel.confirmedLevel = input.confirmedLevel;
      next.responseLevel.confirmedBy = reviewer;
      next.responseLevel.confirmedAt = at;
    }
    next.updatedBy = reviewer;
    next.updatedAt = at;
    // 需求书 §10：7 秒超时必须是独立的状态转移与审计事件，与人工通过可区分。
    const eventType = input.decision === 'approve'
      ? (timeout ? 'review_timeout' : 'review_recorded')
      : 'review_returned';
    next.auditEvents.push(auditEvent(
      eventType, reviewer,
      [timeout ? '7 秒无操作，系统按超时策略自动继续。' : (comment || '人工复核通过。'), input.confirmedLevel ? `核定正式等级 ${input.confirmedLevel} 级。` : null]
        .filter(Boolean).join(' '),
      [], { actorType: 'human', revision: next.revision + 1, source: 'api:review' },
    ));
    next.revision += 1;
    return next;
  });
}

export async function recordSimulationVerification(
  planId: string,
  input: { revision: number; verification: PlanSimulationVerification; actor?: string },
  repository: MutablePlanRepository = defaultRepository(),
) {
  const plan = await current(planId, repository);
  if (plan.revision !== input.revision) throw new PlanLifecycleError('预案已更新，请刷新后同步推演回执。', 409);
  assertVerificationMatchesPlan(plan, input.verification);
  const by = actor(input.actor, 'three-d-scene');
  const at = new Date().toISOString();
  return repository.update(planId, plan.revision, (next) => {
    const completedStepIds = new Set(input.verification.completedStepIds);
    const failedStepIds = new Set(input.verification.failedStepIds);
    next.simulationVerification = input.verification;
    next.simulation.status = input.verification.status === 'completed'
      ? 'ready'
      : input.verification.status === 'failed'
        ? 'failed'
        : 'pending_manual_review';
    next.simulation.mappings = next.simulation.mappings.map((mapping) => {
      if (failedStepIds.has(mapping.stepId)) {
        return { ...mapping, status: 'failed', failureReason: input.verification.detail || '三维步骤执行失败。' };
      }
      if (completedStepIds.has(mapping.stepId)) {
        const { failureReason: _failureReason, ...completed } = mapping;
        return { ...completed, status: 'ready' };
      }
      return { ...mapping, status: 'pending_manual_review' };
    });
    // 需求书 §10 状态机：推演完成与推演进行中必须可区分。
    //
    // 两条守卫：
    // - 已签发/已归档的预案不因补录回执而退回推演态；
    // - 未复核通过的预案不得进入 simulation_*，因为 §10 规定
    //   simulation_running 的进入条件是「推演动作已获准并开始执行」。
    //   此时回执仍照常记录，失败通过 simulation.status 可见。
    if (next.review.status === 'approved'
      && next.lifecycleStatus !== 'issued' && next.lifecycleStatus !== 'archived') {
      next.lifecycleStatus = input.verification.status === 'completed'
        ? 'simulation_completed'
        : input.verification.status === 'failed'
          ? 'failed'
          : input.verification.status === 'unavailable'
            ? 'pending_manual_review'
            : 'simulation_running';
    }
    next.updatedBy = by;
    next.updatedAt = at;
    next.auditEvents.push(auditEvent('simulation_recorded', by,
      `三维推演 ${input.verification.runId} 第 ${input.verification.attempt} 次回执：${input.verification.status}。`,
      [], { actorType: 'system', revision: next.revision + 1, source: 'api:simulation' }));
    next.revision += 1;
    return next;
  });
}

export async function issuePlan(
  planId: string,
  input: { revision: number; issuer: string; permissionConfirmed: boolean },
  repository: MutablePlanRepository = defaultRepository(),
) {
  const plan = await current(planId, repository);
  if (plan.revision !== input.revision) throw new PlanLifecycleError('预案已更新，请刷新后再签发。', 409);
  const issuer = actor(input.issuer, '未署名签发员');
  const reasons: string[] = [];
  if (!input.permissionConfirmed) reasons.push('未记录人工签发权限确认。');
  if (plan.review.status !== 'approved') reasons.push('预案尚未人工复核通过。');
  if (plan.missingItems.length) reasons.push(`仍有缺失项：${plan.missingItems.join('、')}`);
  if (plan.failedItems.length) reasons.push(`仍有失败项：${plan.failedItems.map((item) => item.section).join('、')}`);
  // 文案按实际步数走：主库预案是 11 步，早期 demo 库才是 8 步删减版。
  if (!simulationFullyVerified(plan)) reasons.push(`三维 ${plan.simulation.mappings.length} 步推演尚未完整通过。`);
  if (plan.evidenceRefs.some((reference) => reference.status !== 'verified')) reasons.push('仍有未核验或缺失的关键证据。');
  const at = new Date().toISOString();
  if (reasons.length) {
    return repository.update(planId, plan.revision, (next) => {
      next.issuance.status = 'blocked';
      next.issuance.blockReason = reasons.join(' ');
      next.updatedBy = issuer;
      next.updatedAt = at;
      next.auditEvents.push(auditEvent('issuance_blocked', issuer, next.issuance.blockReason,
        [], { actorType: 'human', revision: next.revision + 1, source: 'api:issue' }));
      next.revision += 1;
      return next;
    });
  }
  return repository.update(planId, plan.revision, (next) => {
    next.issuance.status = 'issued';
    next.issuance.issuer = issuer;
    next.issuance.issuedAt = at;
    next.issuance.blockReason = null;
    next.lifecycleStatus = 'issued';
    next.updatedBy = issuer;
    next.updatedAt = at;
    next.auditEvents.push(auditEvent('issued', issuer,
      [
        '人工确认签发权限后签发预案。',
        // 需求书 §6：正式等级未核定时必须在审计里留痕，不能让规则建议顶替。
        next.responseLevel.confirmedLevel
          ? `正式等级 ${next.responseLevel.confirmedLevel} 级（${next.responseLevel.confirmedBy || '未署名'}核定）。`
          : '正式等级未核定，签发沿用规则建议，须复核补录。',
      ].join(''),
      [], { actorType: 'human', revision: next.revision + 1, source: 'api:issue' }));
    next.revision += 1;
    return next;
  });
}

export async function exportPlan(
  planId: string,
  revision: number,
  actorName: string,
  repository: MutablePlanRepository = defaultRepository(),
) {
  const plan = await current(planId, repository);
  if (plan.revision !== revision) throw new PlanLifecycleError('预案已更新，请刷新后导出。', 409);
  if (plan.issuance.status !== 'issued') throw new PlanLifecycleError('只有人工签发后的预案才允许导出 Word。');
  try {
    const rendered = await renderPlanDocument(plan);
    const at = new Date().toISOString();
    // 需求书 §12.1.1 逐页视觉验收。实测图片页多的真实模板逐页渲染可耗时数十分钟，
    // 导出接口不能同步等待：先落盘并把 verification.visual 标记为 pending 立即返回，
    // 视觉验收转后台异步跑，跑完再回填（见下方 scheduleVisualCheck）。
    const pendingVisual = pendingVisualCheck();
    const updated = await repository.update(planId, plan.revision, (next) => {
      next.document = {
        status: 'ready', fileName: rendered.fileName, generatedAt: at, templateName: rendered.templateName,
        templateId: rendered.templateId, templateVersion: rendered.templateVersion, templateSource: rendered.templateSource,
        verification: { status: 'passed', checkedFields: rendered.checkedFields, missingFields: [], visual: pendingVisual },
        failureReason: null,
      };
      next.updatedBy = actor(actorName, 'word-export');
      next.updatedAt = at;
      next.auditEvents.push(auditEvent('exported', next.updatedBy,
        `已从 ${rendered.templateName}（来源 ${rendered.templateSource}）生成 ${rendered.fileName}。`
        + `逐页视觉验收：${visualAuditSummary(pendingVisual)}`,
        [], { actorType: 'system', revision: next.revision + 1, source: 'api:export' }));
      next.revision += 1;
      return next;
    });
    scheduleVisualCheck(planId, rendered.buffer, at, repository);
    return { plan: updated, ...rendered };
  } catch (error) {
    const reason = error instanceof PlanDocumentError || error instanceof Error ? error.message : String(error);
    const latest = await current(planId, repository);
    await repository.update(planId, latest.revision, (next) => {
      next.document = { status: 'failed', fileName: null, generatedAt: null, templateName: process.env.FIRE_PLAN_TEMPLATE_PATH?.trim() || null, verification: { status: 'failed', checkedFields: [], missingFields: [] }, failureReason: reason };
      next.updatedBy = actor(actorName, 'word-export');
      next.updatedAt = new Date().toISOString();
      next.auditEvents.push(auditEvent('export_failed', next.updatedBy, reason,
        [], { actorType: 'system', revision: next.revision + 1, source: 'api:export' }));
      next.revision += 1;
      return next;
    });
    throw new PlanLifecycleError(reason, 422);
  }
}

/**
 * 导出成功后在后台异步跑逐页视觉验收，结果回填到 document.verification.visual。
 *
 * 不 await 调用方：exportPlan 已经把文件落盘并返回，这里只管把结果写回去。
 * 用 generatedAt 而不是 revision 判断"是否还是同一次导出"——异步跑的这几十分钟里
 * 预案完全可能被复核、签发等其他操作推进了好几个 revision，只要没有新导出覆盖
 * 这份 document，回填仍然有意义；一旦 generatedAt 变了说明已经被更新的导出顶替，
 * 这时静默放弃，不倒退覆盖更新的结果。revision 冲突则重读最新版本重试。
 */
function scheduleVisualCheck(
  planId: string,
  docx: Buffer,
  generatedAt: string,
  repository: MutablePlanRepository,
) {
  void (async () => {
    let visual;
    try {
      visual = await verifyDocumentVisually(docx, generatedAt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      visual = { status: 'not_run' as const, pageCount: 0, pages: [], renderer: null, checkedAt: null, failureReason: `后台视觉验收执行失败：${reason}` };
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const latest = await repository.get(planId);
      if (!latest || latest.document.generatedAt !== generatedAt) return;
      const at = new Date().toISOString();
      try {
        await repository.update(planId, latest.revision, (next) => {
          if (next.document.generatedAt !== generatedAt) return next;
          next.document.verification.visual = visual;
          next.auditEvents.push(auditEvent('visual_check_completed', 'system:visual-check',
            `逐页视觉验收：${visualAuditSummary(visual)}`,
            [], { actorType: 'system', revision: next.revision + 1, source: 'async:visual-check' }));
          next.revision += 1;
          return next;
        });
        return;
      } catch (error) {
        if (error instanceof PlanConflictError) continue;
        throw error;
      }
    }
  })();
}

/**
 * 归档预案。需求书 §12.3：归档包含预案 JSON、Word 文件、三维回执、
 * 复核记录、签发记录、平台数据引用和完整审计链。
 *
 * 闸门有意从严：必须先签发且 Word 已生成。归档是闭环终点，
 * 允许未签发预案归档等于承认可以跳过签发闸门。
 *
 * 幂等：已归档的预案重复调用直接返回，不新增 revision，
 * 满足 §18 对归档的幂等要求。
 */
export async function archivePlan(
  planId: string,
  input: { revision: number; actor?: string },
  repository: MutablePlanRepository = defaultRepository(),
) {
  const plan = await current(planId, repository);
  if (plan.archive?.status === 'archived') return plan;
  if (plan.revision !== input.revision) throw new PlanLifecycleError('预案已更新，请刷新后再归档。', 409);
  if (plan.issuance.status !== 'issued') throw new PlanLifecycleError('只有已签发的预案才允许归档。');
  if (plan.document.status !== 'ready') throw new PlanLifecycleError('归档要求 Word 预案已生成。');
  const by = actor(input.actor, '归档员');
  const at = new Date().toISOString();
  return repository.update(planId, plan.revision, (next) => {
    next.archive = {
      status: 'archived', archivedAt: at, archivedBy: by,
      index: {
        incidentId: next.event.incidentId, building: next.building.name,
        sceneId: next.spatialTarget.sceneId, floor: next.spatialTarget.floor,
        planId: next.planId, revision: next.revision + 1,
      },
      contents: {
        planJson: true,
        documentFileName: next.document.fileName,
        simulationReceipts: next.simulationVerification?.completedStepIds.length ?? 0,
        reviewRecords: next.review.comments.length,
        auditEvents: next.auditEvents.length + 1,
        platformReferences: next.evidenceRefs.filter((reference) => reference.kind === 'platform').length,
      },
      failureReason: null,
    };
    next.lifecycleStatus = 'archived';
    next.updatedBy = by;
    next.updatedAt = at;
    next.auditEvents.push(auditEvent('archived', by,
      `已归档预案与 ${next.document.fileName || 'Word 文件'}，含 ${next.auditEvents.length + 1} 条审计事件。`,
      [], { actorType: 'human', revision: next.revision + 1, source: 'api:archive' }));
    next.revision += 1;
    return next;
  });
}

/**
 * 需求书 §8.3.1：对话栏每次水源查询都要留痕（含解析结果、口径与命中条数）。
 *
 * 留痕失败不得阻断对话回答，因此调用方按"尽力记录"处理。
 */
export async function recordWaterSourceQuery(
  planId: string,
  query: PlanWaterSourceQuery,
  input: { actor?: string } = {},
  repository: MutablePlanRepository = defaultRepository(),
) {
  const plan = await current(planId, repository);
  const by = actor(input.actor, '指挥员');
  const at = new Date().toISOString();
  return repository.update(planId, plan.revision, (next) => {
    const queries = next.waterQueries ?? [];
    // 只保留最近 50 次，避免单个预案被对话查询无限撑大。
    next.waterQueries = [...queries, query].slice(-50);
    next.updatedBy = by;
    next.updatedAt = at;
    next.auditEvents.push(auditEvent('water_source_queried', by,
      `对话水源查询：${query.question.slice(0, 80)}；状态 ${query.status}，命中 ${query.resultCount} 条。`,
      query.evidenceRefs,
      { actorType: 'human', revision: next.revision + 1, source: 'api:agent-chat', requestId: query.queryId }));
    next.revision += 1;
    return next;
  });
}

export type WaterSourceBinding = {
  sourceId: string;
  /** primary/backup 为指派；unassign 撤销指派；reverify 仅标记需重新核验 */
  role: 'primary' | 'backup' | 'unassign' | 'reverify';
  revision: number;
  actor?: string;
};

/**
 * 需求书 §8.3.1：把对话检索到的水源指派为主/备水源，或标记重新核验。
 *
 * 只改写已在预案候选列表中的条目：对话结果本身来自同一台账检索，
 * 允许凭空插入一条会绕开水源清洗与坐标校验。
 */
export async function bindWaterSource(
  planId: string,
  input: WaterSourceBinding,
  repository: MutablePlanRepository = defaultRepository(),
) {
  const plan = await current(planId, repository);
  if (plan.revision !== input.revision) throw new PlanLifecycleError('预案已更新，请刷新后重试。', 409);
  const water = plan.routeWater;
  const target = water?.waterSources.find((entry) => entry.id === input.sourceId);
  if (!water || !target) throw new PlanLifecycleError('该水源不在当前预案的候选列表中，未写入。');
  const by = actor(input.actor, '指挥员');
  const at = new Date().toISOString();
  return repository.update(planId, plan.revision, (next) => {
    const sources = next.routeWater?.waterSources ?? [];
    for (const entry of sources) {
      if (entry.id !== input.sourceId) {
        // 主/备各只有一个：指派新的即释放同角色的旧条目。
        if (input.role !== 'reverify' && entry.role === input.role) entry.role = null;
        continue;
      }
      if (input.role === 'reverify') {
        entry.verifiedAt = null;
        entry.confirmation = 'unknown';
      } else {
        entry.role = input.role === 'unassign' ? null : input.role;
        entry.confirmation = 'manually_confirmed';
        entry.verifiedAt = at;
      }
    }
    const label = asWaterLabel(target);
    const detail = input.role === 'reverify'
      ? `已将 ${label} 标记为需重新核验，核验时间已清空。`
      : input.role === 'unassign'
        ? `已撤销 ${label} 的主/备水源指派。`
        : `已将 ${label} 指派为${input.role === 'primary' ? '主' : '备用'}水源，并记为人工确认。`;
    next.updatedBy = by;
    next.updatedAt = at;
    next.auditEvents.push(auditEvent('water_source_bound', by, detail, [],
      { actorType: 'human', revision: next.revision + 1, source: 'api:water-source' }));
    next.revision += 1;
    return next;
  });
}
