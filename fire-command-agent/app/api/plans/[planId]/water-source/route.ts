import { authorizePlanApi, noStoreHeaders, record, revision } from '@/lib/plan-api';
import { bindWaterSource, PlanLifecycleError } from '@/lib/plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['primary', 'backup', 'unassign', 'reverify'] as const;

/**
 * 需求书 §8.3.1：对话水源卡片的"设为主/备水源、加入预案、重新核验"写回。
 *
 * 三维定位由前端直接调 scene-control，不经此接口。
 */
export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const body = record(await request.json().catch(() => null));
  const expectedRevision = revision(body?.revision);
  if (!expectedRevision) {
    return Response.json({ message: '水源指派请求缺少 revision。' }, { status: 400, headers: noStoreHeaders });
  }
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId.trim() : '';
  const role = typeof body?.role === 'string' && (ROLES as readonly string[]).includes(body.role)
    ? body.role as (typeof ROLES)[number]
    : undefined;
  if (!sourceId || !role) {
    return Response.json(
      { message: '水源指派请求需要 sourceId 与 role（primary/backup/unassign/reverify）。' },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const { planId } = await context.params;
  try {
    const plan = await bindWaterSource(planId, {
      sourceId, role, revision: expectedRevision,
      actor: typeof body?.actor === 'string' ? body.actor : undefined,
    });
    return Response.json({ plan }, { headers: noStoreHeaders });
  } catch (error) {
    const status = error instanceof PlanLifecycleError ? error.status : 500;
    return Response.json(
      { message: error instanceof Error ? error.message : '水源指派失败。' },
      { status, headers: noStoreHeaders },
    );
  }
}
