import { authorizePlanApi, noStoreHeaders, record, revision } from '@/lib/plan-api';
import { exportPlan, PlanLifecycleError } from '@/lib/plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const body = record(await request.json().catch(() => null));
  const expectedRevision = revision(body?.revision);
  if (!expectedRevision) return Response.json({ message: '导出请求缺少 revision。' }, { status: 400, headers: noStoreHeaders });
  const { planId } = await context.params;
  try {
    const result = await exportPlan(planId, expectedRevision, typeof body?.actor === 'string' ? body.actor : 'word-export');
    return new Response(new Uint8Array(result.buffer), {
      headers: {
        ...noStoreHeaders,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (error) {
    const status = error instanceof PlanLifecycleError ? error.status : 500;
    return Response.json({ message: error instanceof Error ? error.message : 'Word 导出失败。' }, { status, headers: noStoreHeaders });
  }
}
