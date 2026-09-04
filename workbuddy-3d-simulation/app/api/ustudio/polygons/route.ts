import { NextResponse } from 'next/server';
import { describeUStudioError, listScenePolygons } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallbackMessage: string) {
  const upstream = describeUStudioError(error);
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ message, ...(upstream ?? {}) }, { status: 500 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sceneId = url.searchParams.get('sceneId')?.trim() || undefined;

  try {
    const polygons = await listScenePolygons({ sceneId });
    return NextResponse.json(polygons);
  } catch (error) {
    console.error('[ustudio/polygons] failed', { sceneId, error });
    return errorResponse(error, '加载多边形列表失败');
  }
}
