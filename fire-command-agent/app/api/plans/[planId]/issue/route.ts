import { authorizePlanApi, noStoreHeaders, record, revision } from '@/lib/plan-api';
import { PlanLifecycleError, issuePlan } from '@/lib/plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const body = record(await request.json().catch(() => null));
  const expectedRevision = revision(body?.revision);
  if (!expectedRevision || typeof body?.issuer !== 'string' || body.permissionConfirmed !== true) {
    return Response.json({ message: '签发请求必须包含 revision、issuer 与明确的 permissionConfirmed=true。' }, { status: 400, headers: noStoreHeaders });
  }
  const { planId } = await context.params;
  try {
    const plan = await issuePlan(planId, { revision: expectedRevision, issuer: body.issuer, permissionConfirmed: true });
    return Response.json({ plan, issued: plan.issuance.status === 'issued' }, { status: plan.issuance.status === 'issued' ? 200 : 422, headers: noStoreHeaders });
  } catch (error) {
    const status = error instanceof PlanLifecycleError ? error.status : 500;
    return Response.json({ message: error instanceof Error ? error.message : '签发失败。' }, { status, headers: noStoreHeaders });
  }
}
