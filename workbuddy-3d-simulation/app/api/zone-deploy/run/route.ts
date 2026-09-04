import { NextResponse } from 'next/server';
import { createZoneDeployDrawRun, WUKUANG_SCENE_ID } from '@/lib/scene-command-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 作战区域绘制：接收指挥台计算好的可绘制动作，作为一次轻量绘制任务入队，
 * 供三维页面无画面执行器认领并驱动 SDK 绘制（区域多边形 + 进攻/疏散路线）。
 * 请求体：{ sceneId?, planId?, actions: DrawRoute[] }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ message: '请求体为空。' }, { status: 400 });
  const actions = Array.isArray(body.actions) ? body.actions.filter((item) => !!item && typeof item === 'object') : [];
  if (!actions.length) return NextResponse.json({ message: '缺少可绘制的区域/路线动作。' }, { status: 400 });
  const sceneId = typeof body.sceneId === 'string' && body.sceneId.trim() ? body.sceneId.trim() : WUKUANG_SCENE_ID;
  if (sceneId !== WUKUANG_SCENE_ID) return NextResponse.json({ message: '仅支持当前五矿国际广场场景。' }, { status: 400 });
  const run = createZoneDeployDrawRun({
    sceneId,
    planId: typeof body.planId === 'string' ? body.planId : undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
    actions,
  });
  return NextResponse.json({ run });
}
