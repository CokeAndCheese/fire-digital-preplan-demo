import { fireResourcePlatformUrl, getFireResourcePlatformUnits } from '@/lib/skills/fire-resource-platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const platformUrl = fireResourcePlatformUrl();
  try {
    const result = await getFireResourcePlatformUnits(platformUrl);
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '救援力量平台暂时不可用。';
    return Response.json({ ok: false, platformUrl, message: `八维通救援力量平台同步失败：${message}` }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
