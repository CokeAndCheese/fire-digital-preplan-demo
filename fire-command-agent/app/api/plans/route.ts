import { authorizePlanApi, noStoreHeaders } from '@/lib/plan-api';
import { getPlanRepository } from '@/lib/plan-persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = authorizePlanApi(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const building = url.searchParams.get('building')?.trim() || undefined;
  const rawLimit = Number(url.searchParams.get('limit') || 20);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const text = (key: string) => url.searchParams.get(key)?.trim() || undefined;
  const rawVersion = url.searchParams.get('version');
  const version = rawVersion !== null && Number.isInteger(Number(rawVersion)) ? Number(rawVersion) : undefined;
  // 需求书 12.3：归档查询维度。缺省不传即回退为原有"按建筑 + 条数"列表。
  const filters = {
    incidentId: text('incidentId'),
    sceneId: text('sceneId'),
    floor: text('floor'),
    planId: text('planId'),
    version,
    createdFrom: text('createdFrom'),
    createdTo: text('createdTo'),
  };
  const plans = await getPlanRepository().list(building, limit, filters);
  return Response.json({ plans, filters: { building, limit, ...filters } }, { headers: noStoreHeaders });
}
