import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/** 作战区域部署：轮询三维场景子项目里某次绘制的状态。 */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const endpoint = (process.env.SCENE_CONTROL_URL || '').trim().replace(/\/+$/, '');
  if (!endpoint) return NextResponse.json({ message: '三维场景桥接地址未配置。' }, { status: 503, headers: noStore });
  const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    const response = await fetch(`${endpoint}/api/zone-deploy/draw/${encodeURIComponent(runId)}`, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: noStore });
  } catch {
    return NextResponse.json({ message: '作战区域绘制状态查询超时。' }, { status: 504, headers: noStore });
  }
}
