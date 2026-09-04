import { NextResponse } from 'next/server';
import { takePendingZoneDeployDraw, WUKUANG_SCENE_ID } from '@/lib/scene-command-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 三维页面无画面执行器轮询：认领一个待绘制的作战区域任务。 */
export function GET(request: Request) {
  const sceneId = new URL(request.url).searchParams.get('sceneId')?.trim() || WUKUANG_SCENE_ID;
  if (sceneId !== WUKUANG_SCENE_ID) return NextResponse.json({ message: 'Invalid sceneId.' }, { status: 400 });
  const run = takePendingZoneDeployDraw(sceneId);
  return NextResponse.json({ run });
}
