import { NextResponse } from 'next/server';
import {
  acknowledgeSceneCommand,
  takeSceneCommands,
  WUKUANG_SCENE_ID,
  type SceneCommandAck,
} from '@/lib/scene-command-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request: Request) {
  const sceneId = new URL(request.url).searchParams.get('sceneId')?.trim();
  if (!sceneId || sceneId !== WUKUANG_SCENE_ID) {
    return NextResponse.json({ message: 'Invalid sceneId.' }, { status: 400 });
  }
  return NextResponse.json({ commands: takeSceneCommands(sceneId) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SceneCommandAck | null;
  if (!body || typeof body.commandId !== 'string' || typeof body.ok !== 'boolean' || typeof body.message !== 'string') {
    return NextResponse.json({ message: 'Invalid command acknowledgement.' }, { status: 400 });
  }
  acknowledgeSceneCommand({
    commandId: body.commandId,
    ok: body.ok,
    message: body.message,
    executedAt: typeof body.executedAt === 'string' ? body.executedAt : new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
