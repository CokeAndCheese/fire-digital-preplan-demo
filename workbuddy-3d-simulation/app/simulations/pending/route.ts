import { NextResponse } from 'next/server';
import { takePendingSimulation, WUKUANG_SCENE_ID } from '@/lib/scene-command-bridge';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const sceneId = new URL(request.url).searchParams.get('sceneId')?.trim() || WUKUANG_SCENE_ID;
  const run = takePendingSimulation(sceneId);
  return NextResponse.json({ run });
}
