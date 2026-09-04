import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { SCENARIO_REGISTRY } from '@/lib/scenario-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { input?: Record<string, unknown> } | null;
  const input = body?.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
  const sceneId = text(input.sceneId) || SCENARIO_REGISTRY.sceneId;
  const floor = text(input.floor);
  const room = text(input.room);
  if (sceneId !== SCENARIO_REGISTRY.sceneId) {
    return NextResponse.json({ message: '场景未登记，已阻止三维定位。' }, { status: 422, headers: noStore });
  }
  if (!floor && !room) {
    return NextResponse.json({ message: '至少需要提供楼层或房间，才能定位三维模型。' }, { status: 400, headers: noStore });
  }

  const endpoint = (process.env.SCENE_CONTROL_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
  if (!endpoint) {
    return NextResponse.json({ message: '三维场景桥接地址未配置。' }, { status: 503, headers: noStore });
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    const response = await fetch(`${endpoint}/v1/skill-actions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        executionId: randomUUID(),
        action: 'locate_space',
        taskId: text(input.taskId) || undefined,
        input: {
          ...input,
          sceneId,
          building: text(input.building) || SCENARIO_REGISTRY.building.name,
          floor: floor || undefined,
          room: room || undefined,
        },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: noStore });
  } catch {
    return NextResponse.json({ message: '三维模型定位请求超时，已保留待复核状态。' }, { status: 504, headers: noStore });
  }
}
