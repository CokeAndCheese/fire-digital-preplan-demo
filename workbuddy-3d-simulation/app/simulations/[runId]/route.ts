import { NextResponse } from 'next/server';
import { getSimulationRun, updateSimulationRun } from '@/lib/scene-command-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = getSimulationRun(runId);
  return run ? NextResponse.json({ run }) : NextResponse.json({ message: '未找到三维推演。' }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const status = body?.status;
  if (status !== 'running' && status !== 'completed' && status !== 'failed' && status !== 'unavailable' && status !== 'reset') {
    return NextResponse.json({ message: '非法推演状态。' }, { status: 400 });
  }
  const run = updateSimulationRun(runId, {
    status,
    completedStepIds: Array.isArray(body?.completedStepIds) ? body.completedStepIds.filter((value): value is string => typeof value === 'string') : undefined,
    failedStepIds: Array.isArray(body?.failedStepIds) ? body.failedStepIds.filter((value): value is string => typeof value === 'string') : undefined,
    detail: typeof body?.detail === 'string' ? body.detail : undefined,
  });
  return run ? NextResponse.json({ run }) : NextResponse.json({ message: '未找到三维推演。' }, { status: 404 });
}
