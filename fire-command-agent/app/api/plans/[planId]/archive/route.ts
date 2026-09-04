import { authorizePlanApi, noStoreHeaders, record, revision } from '@/lib/plan-api';
import { archivePlan, PlanLifecycleError } from '@/lib/plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 归档预案。需求书 §12.3 的闭环终点。
 *
 * 幂等：已归档的预案重复 POST 返回同一预案且不新增 revision，
 * 所以此处不因 revision 不匹配而先行报错——由 archivePlan 判定。
 */
export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const body = record(await request.json().catch(() => null));
  const expectedRevision = revision(body?.revision);
  if (!expectedRevision) {
    return Response.json({ message: '归档请求缺少 revision。' }, { status: 400, headers: noStoreHeaders });
  }
  const { planId } = await context.params;
  try {
    const plan = await archivePlan(planId, {
      revision: expectedRevision,
      actor: typeof body?.actor === 'string' ? body.actor : undefined,
    });
    return Response.json({ plan }, { headers: noStoreHeaders });
  } catch (error) {
    const status = error instanceof PlanLifecycleError ? error.status : 500;
    return Response.json({ message: error instanceof Error ? error.message : '归档失败。' }, { status, headers: noStoreHeaders });
  }
}
