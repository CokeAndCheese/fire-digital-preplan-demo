import { authorizePlanApi, noStoreHeaders, record, revision } from '@/lib/plan-api';
import { PlanLifecycleError, reviewPlan } from '@/lib/plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const body = record(await request.json().catch(() => null));
  const expectedRevision = revision(body?.revision);
  const decision = body?.decision;
  if (!expectedRevision || (decision !== 'approve' && decision !== 'return') || typeof body?.reviewer !== 'string') {
    return Response.json({ message: '复核请求必须包含 revision、reviewer 与 approve/return 决策。' }, { status: 400, headers: noStoreHeaders });
  }
  // 正式等级只接受 I–V 五个字面值，其他一律忽略而不报错——
  // 复核动作不能因为一个可选字段拼错而整体失败。
  const levels = ['I', 'II', 'III', 'IV', 'V'] as const;
  const confirmedLevel = typeof body?.confirmedLevel === 'string'
    && (levels as readonly string[]).includes(body.confirmedLevel)
    ? body.confirmedLevel as (typeof levels)[number]
    : undefined;
  const { planId } = await context.params;
  try {
    const plan = await reviewPlan(planId, {
      revision: expectedRevision, reviewer: body.reviewer, decision,
      comment: typeof body.comment === 'string' ? body.comment : undefined,
      confirmedLevel,
      source: body.source === 'timeout' ? 'timeout' : 'human',
    });
    return Response.json({ plan }, { headers: noStoreHeaders });
  } catch (error) {
    const status = error instanceof PlanLifecycleError ? error.status : 500;
    return Response.json({ message: error instanceof Error ? error.message : '复核保存失败。' }, { status, headers: noStoreHeaders });
  }
}
