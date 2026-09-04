import { NextResponse } from 'next/server';
import { describeUStudioError, getScenePolygonDetail } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallbackMessage: string) {
  const upstream = describeUStudioError(error);
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ message, ...(upstream ?? {}) }, { status: 500 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sceneId = url.searchParams.get('sceneId')?.trim() || undefined;
  const polygonId = url.searchParams.get('polygonId')?.trim() || url.searchParams.get('polygon_id')?.trim() || url.searchParams.get('id')?.trim() || '';

  if (!polygonId) return NextResponse.json({ message: 'polygonId is required' }, { status: 400 });

  try {
    const detail = await getScenePolygonDetail({ sceneId, polygonId });
    return NextResponse.json(detail);
  } catch (error) {
    console.error('[ustudio/polygons/detail] failed', { sceneId, polygonId, error });
    return errorResponse(error, '加载多边形详情失败');
  }
}
