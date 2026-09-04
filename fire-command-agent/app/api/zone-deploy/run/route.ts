import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/** 作战区域部署：把已计算好的可绘制动作入队到三维场景，让无画面执行器驱动 SDK 绘制。 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const endpoint = (process.env.SCENE_CONTROL_URL || '').trim().replace(/\/+$/, '');
  if (!endpoint) return NextResponse.json({ message: '三维场景桥接地址未配置。' }, { status: 503, headers: noStore });
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = (process.env.SKILL_BRIDGE_TOKEN || '').trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    const response = await fetch(`${endpoint}/api/zone-deploy/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: noStore });
  } catch {
    return NextResponse.json({ message: '作战区域绘制请求超时。' }, { status: 504, headers: noStore });
  }
}
