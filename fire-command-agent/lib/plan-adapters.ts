import type { UnifiedFireRescuePlan } from './plan-contract';

function reviewItems(plan: UnifiedFireRescuePlan) {
  return [...new Set([
    ...plan.missingItems,
    ...plan.failedItems.map((item) => `${item.section}：${publicFailureReason(item.reason)}`),
  ])];
}

function publicFailureReason(reason: string) {
  const normalized = reason.trim();
  if (!normalized) return '未返回可核验回执';
  if (/fetch failed|ECONN|HTTP\s*\d{3}|TypeError|ReferenceError|SyntaxError|timeout|timed out|连接失败|请求超时/i.test(normalized)) {
    return '未返回可核验回执';
  }
  if (/场景\/对象 ID 待人工复核/.test(normalized)) return '场景/对象 ID 待人工复核';
  if (/^[A-Z0-9_:-]+$/.test(normalized)) return '未返回可核验回执';
  if (normalized.length > 160) return '未返回可核验回执';
  return normalized;
}

/** These adapters reshape presentation only; every business value remains in plan. */
export function planConsumers(plan: UnifiedFireRescuePlan) {
  const pendingReview = reviewItems(plan);
  return {
    page: { planId: plan.planId, version: plan.version, lifecycleStatus: plan.lifecycleStatus, pendingReview },
    chat: {
      planId: plan.planId,
      version: plan.version,
      lifecycleStatus: plan.lifecycleStatus,
      pendingReview,
      responseLevel: plan.responseLevel.recommendation,
    },
    scene3d: {
      planId: plan.planId,
      version: plan.version,
      spatialTarget: plan.spatialTarget,
      simulation: plan.simulation,
    },
    word: { planId: plan.planId, version: plan.version, document: plan },
  };
}

export function planChatSummary(plan: UnifiedFireRescuePlan) {
  const pendingReview = reviewItems(plan);
  const level = plan.responseLevel.recommendation ? `${plan.responseLevel.recommendation} 级响应建议` : '未生成响应等级建议';
  if (plan.lifecycleStatus === 'issued' && plan.document.status === 'ready' && plan.simulation.status === 'ready') {
    return `预案已签发，${level}。精简三维 8 步推演、Word 导出与归档均已完成。`;
  }
  if (pendingReview.length) {
    return `已生成预案草稿，${level}。${pendingReview.join('、')}待人工复核；未满足签发或推演条件。`;
  }
  return `已生成预案草稿，${level}。当前待人工复核；7 秒无操作将按超时策略自动继续。`;
}
