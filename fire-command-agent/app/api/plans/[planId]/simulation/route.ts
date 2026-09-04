import { authorizePlanApi, noStoreHeaders, record, revision, simulationVerification } from '@/lib/plan-api';
import { getPlanRepository } from '@/lib/plan-persistence';
import { PlanLifecycleError, recordSimulationVerification } from '@/lib/plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const body = record(await request.json().catch(() => null));
  const expectedRevision = revision(body?.revision);
  const verification = simulationVerification(body?.verification);
  if (!expectedRevision || !verification) return Response.json({ message: '三维回执格式无效。' }, { status: 400, headers: noStoreHeaders });
  const { planId } = await context.params;
  const plan = await getPlanRepository().get(planId);
  if (!plan) return Response.json({ message: '未找到指定预案。' }, { status: 404, headers: noStoreHeaders });
  const expectedStepIds = new Set(plan.simulation.mappings.map((step) => step.stepId));
  const actualStepIds = [...new Set([...verification.completedStepIds, ...verification.failedStepIds])];
  if (actualStepIds.some((stepId) => !expectedStepIds.has(stepId))) {
    return Response.json({ message: '三维回执包含不属于当前预案的步骤。' }, { status: 422, headers: noStoreHeaders });
  }
  if (verification.status === 'completed' && (actualStepIds.length !== expectedStepIds.size || verification.failedStepIds.length > 0)) {
    return Response.json({ message: `完成状态必须覆盖全部 ${expectedStepIds.size} 个步骤且没有失败项。` }, { status: 422, headers: noStoreHeaders });
  }
  try {
    const updated = await recordSimulationVerification(planId, { revision: expectedRevision, verification, actor: typeof body?.actor === 'string' ? body.actor : undefined });
    return Response.json({ plan: updated }, { headers: noStoreHeaders });
  } catch (error) {
    const status = error instanceof PlanLifecycleError ? error.status : 500;
    return Response.json({ message: error instanceof Error ? error.message : '三维回执保存失败。' }, { status, headers: noStoreHeaders });
  }
}
