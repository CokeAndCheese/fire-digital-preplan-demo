import { authorizePlanApi, noStoreHeaders } from '@/lib/plan-api';
import { getPlanRepository } from '@/lib/plan-persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ planId: string }> }) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const { planId } = await context.params;
  const plan = await getPlanRepository().get(planId);
  if (!plan) return Response.json({ message: '未找到指定预案。' }, { status: 404, headers: noStoreHeaders });
  return Response.json({ plan }, { headers: noStoreHeaders });
}
