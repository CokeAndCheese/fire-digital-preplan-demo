import { NextResponse } from 'next/server';
import { generateZoneDeploy, zoneDeployToActions, resolveObjectPosition, resolveGroundHeight, type ZoneDeployOptions } from '@/lib/fire-simulation';
import { WUKUANG_SCENE_ID } from '@/lib/scene-command-bridge';
import { getSceneInstanceTree } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function point(value: unknown): { x: number; y: number; z: number } | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const x = Number(o.x ?? o.longitude);
  const y = Number(o.y ?? o.latitude);
  const z = Number(o.z ?? 0);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y, z };
  return null;
}

/**
 * 作战区域部署：给定火点坐标或对象 ID，生成区域与路线（+可绘制动作）。
 * 请求体：{ sceneId?, fireObjectId?, firePoint?: {x,y,z}, options?: ZoneDeployOptions }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ message: '请求体为空。' }, { status: 400 });
  const sceneId = typeof body.sceneId === 'string' && body.sceneId.trim() ? body.sceneId.trim() : WUKUANG_SCENE_ID;
  if (sceneId !== WUKUANG_SCENE_ID) return NextResponse.json({ message: '仅支持当前五矿国际广场场景。' }, { status: 400 });

  // 火点坐标：优先 firePoint，其次由 fireObjectId 解析（真实坐标），否则取场景树第一个房间作为演示火点。
  let firePoint = point(body.firePoint);
  let resolvedFireObjectId: string | null = typeof body.fireObjectId === 'string' && body.fireObjectId.trim() ? body.fireObjectId.trim() : null;
  if (!firePoint && resolvedFireObjectId) {
    firePoint = await resolveObjectPosition(sceneId, resolvedFireObjectId);
  }
  if (!firePoint) {
    // 默认演示火点：取场景树里第一个 Space（房间）。
    try {
      const tree = await getSceneInstanceTree({ sceneId });
      let firstSpace = '';
      const walk = (node: Record<string, unknown>) => {
        if (firstSpace) return;
        if (String(node.type ?? node.twins_identifier ?? '').toLowerCase() === 'space') {
          firstSpace = String(node.out_instance_id ?? node.id ?? '');
          return;
        }
        const children = Array.isArray(node.children) ? node.children : [];
        for (const child of children) if (child && typeof child === 'object') walk(child as Record<string, unknown>);
      };
      walk(tree as unknown as Record<string, unknown>);
      if (firstSpace) {
        resolvedFireObjectId = firstSpace;
        firePoint = await resolveObjectPosition(sceneId, firstSpace);
      }
    } catch {
      firePoint = null;
    }
  }
  if (!firePoint) {
    return NextResponse.json({ message: '缺少火点坐标或 fireObjectId，或未能解析到坐标。' }, { status: 422 });
  }

  const options = (typeof body.options === 'object' && body.options ? body.options : {}) as ZoneDeployOptions;
  // 地面高度：优先请求显式给 groundZ；否则尝试解析真实地面高度（1F/最低层），
  // 但仅当解析结果不高于火点高度时才采用（避免场景 z 轴语义不明导致区域抬高），否则回退火点 z。
  let groundZ = options.groundZ;
  if (typeof groundZ !== 'number') {
    const resolved = await resolveGroundHeight(sceneId);
    groundZ = typeof resolved === 'number' && resolved <= firePoint.z ? resolved : firePoint.z;
  }
  const deploy = generateZoneDeploy(firePoint, { groundZ, ...options });
  const actions = zoneDeployToActions(deploy);
  return NextResponse.json({ deploy, actions, firePoint, groundZ });
}
