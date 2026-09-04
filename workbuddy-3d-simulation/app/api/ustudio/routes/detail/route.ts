import { NextResponse } from 'next/server';
import { describeUStudioError, getSceneRouteDetail } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallbackMessage: string) {
  const upstream = describeUStudioError(error);
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ message, ...(upstream ?? {}) }, { status: 500 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sceneId = url.searchParams.get('sceneId')?.trim() || undefined;
  const routeId = url.searchParams.get('routeId')?.trim() || url.searchParams.get('route_id')?.trim() || url.searchParams.get('id')?.trim() || '';

  if (!routeId) return NextResponse.json({ message: 'routeId is required' }, { status: 400 });

  try {
    const detail = await getSceneRouteDetail({ sceneId, routeId });
    return NextResponse.json(detail);
  } catch (error) {
    console.error('[ustudio/routes/detail] failed', { sceneId, routeId, error });
    return errorResponse(error, '加载路径详情失败');
  }
}
