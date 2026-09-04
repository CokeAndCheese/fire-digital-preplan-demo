import { NextResponse } from 'next/server';
import { getZoneDeployDrawRun, updateZoneDeployDrawRun } from '@/lib/scene-command-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  return (async () => {
    const { runId } = await context.params;
    const run = getZoneDeployDrawRun(runId);
    if (!run) return NextResponse.json({ message: '未找到该作战区域绘制任务。' }, { status: 404 });
    return NextResponse.json({ run });
  })();
}

export async function PATCH(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = getZoneDeployDrawRun(runId);
  if (!run) return NextResponse.json({ message: '未找到该作战区域绘制任务。' }, { status: 404 });
  const body = await request.json().catch(() => null) as { status?: string; detail?: string } | null;
  const nextStatus = body?.status;
  if (nextStatus !== 'completed' && nextStatus !== 'failed' && nextStatus !== 'reset') {
    return NextResponse.json({ message: 'status 必须为 completed/failed/reset。' }, { status: 400 });
  }
  const updated = updateZoneDeployDrawRun(runId, {
    status: nextStatus,
    detail: typeof body?.detail === 'string' ? body.detail : undefined,
  });
  return NextResponse.json({ run: updated });
}
