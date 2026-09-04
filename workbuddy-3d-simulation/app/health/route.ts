import { NextResponse } from 'next/server';
import { WUKUANG_SCENE_ID } from '@/lib/scene-command-bridge';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'fire-scene-command-bridge',
    sceneId: WUKUANG_SCENE_ID,
  });
}
