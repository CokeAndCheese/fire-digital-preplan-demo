/**
 * 对话请求里"当前预案"的口径。
 *
 * 为什么要单独一层：发消息时 createLiveExecution 已把 liveExecution 重置成新一轮，
 * 此刻从回执里取不到预案编号。若不锁存，服务端只能回退取"最新落库"的那份，
 * 多预案并存时水源查询会答到别的对象上（需求书 §8.3.1）。
 */

export type ForwardedProps = {
  source: string;
  language: string;
  planId?: string;
};

/**
 * 锁存预案编号：有新编号就更新，没有则保留上一次。
 * 关键在于 runPlanId 为空时不能清空——那正是"刚发出新消息、回执尚未回来"的时刻。
 */
export function latchPlanId(previous: string | null, runPlanId?: string | null): string | null {
  return runPlanId ? runPlanId : previous;
}

/** 组装 forwardedProps。planId 只在确有锁存值时出现，不发空串占位。 */
export function buildForwardedProps(planId: string | null | undefined): ForwardedProps {
  return {
    source: 'independent-fire-command-agent',
    language: 'zh-CN',
    ...(planId ? { planId } : {}),
  };
}
