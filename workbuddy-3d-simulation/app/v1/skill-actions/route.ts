import { NextResponse } from 'next/server';
import {
  createSceneVisualCommand,
  enqueueSceneCommand,
  resolveSceneTarget,
  waitForSceneCommandAck,
  WUKUANG_SCENE_ID,
  type SceneCommandInput,
} from '@/lib/scene-command-bridge';
import { getSceneInstanceTree } from '@/lib/ustudio';
import { extractScenePosition, type Point3 } from '@/lib/fire-simulation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SkillActionRequest = {
  executionId?: unknown;
  action?: unknown;
  input?: SceneCommandInput;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as SkillActionRequest | null;
  if (!payload || payload.action !== 'locate_space') {
    return NextResponse.json({ message: 'Only locate_space is supported by the 3D scene bridge.' }, { status: 400 });
  }

  const input = payload.input ?? {};
  const sceneId = typeof input.sceneId === 'string' && input.sceneId.trim() ? input.sceneId.trim() : WUKUANG_SCENE_ID;
  if (sceneId !== WUKUANG_SCENE_ID) {
    return NextResponse.json({ message: 'The 3D scene bridge only accepts the configured Wukuang scene.' }, { status: 400 });
  }

  try {
    const tree = await getSceneInstanceTree({ sceneId });
    const target = resolveSceneTarget(tree, { ...input, sceneId });
    if (!target) {
      return NextResponse.json({
        message: 'No verifiable floor or room object was found in the current 3D scene.',
        visualization: { status: 'unresolved', sceneId },
      }, { status: 422 });
    }

    // 从场景树中找到目标节点并提取其坐标，作为三维中的着火位置标注点。
    let firePoint: Point3 | null = null;
    const walk = (node: Record<string, unknown>): boolean => {
      const id = String(node.id ?? node.out_instance_id ?? node.twins_instance_id ?? '');
      const name = String(node.name ?? node.out_instance_name ?? '');
      if (id === target.objectId || name === target.label) {
        firePoint = extractScenePosition(node);
        return true;
      }
      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) if (child && typeof child === 'object' && walk(child as Record<string, unknown>)) return true;
      return false;
    };
    walk(tree as unknown as Record<string, unknown>);

    const command = createSceneVisualCommand({
      ...input,
      sceneId,
      firePoint: firePoint ?? undefined,
    }, target);
    enqueueSceneCommand(command);
    const acknowledgement = await waitForSceneCommandAck(command.commandId);

    return NextResponse.json({
      executionId: typeof payload.executionId === 'string' ? payload.executionId : undefined,
      visualization: {
        status: acknowledgement?.ok ? 'displayed' : 'queued',
        sceneId,
        commandId: command.commandId,
        target,
        incident: command.incident,
        message: acknowledgement?.message ?? 'The command is queued and will display when the 3D model is connected.',
      },
    });
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'Failed to resolve the 3D scene target.',
    }, { status: 502 });
  }
}
