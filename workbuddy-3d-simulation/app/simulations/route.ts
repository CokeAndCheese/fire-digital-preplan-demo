import { NextResponse } from 'next/server';
import { createSimulationRun, resolveSceneTarget, WUKUANG_SCENE_ID, type RouteGeometryInput, type SimulationMappingInput } from '@/lib/scene-command-bridge';
import { getSceneInstanceTree } from '@/lib/ustudio';
import { collectWaterSourceObjectIds } from '@/lib/fire-simulation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const planId = typeof body?.planId === 'string' ? body.planId.trim() : '';
  const mappings: SimulationMappingInput[] = Array.isArray(body?.mappings)
    ? body.mappings.filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.stepId === 'string' && typeof value.sequence === 'number' && typeof value.title === 'string';
    }).map((value) => ({
      stepId: value.stepId as string,
      sequence: value.sequence as number,
      title: value.title as string,
      actionId: typeof value.actionId === 'string' ? value.actionId : undefined,
      input: value.input && typeof value.input === 'object' && !Array.isArray(value.input) ? value.input as Record<string, unknown> : undefined,
    }))
    : [];
  const sceneId = typeof body?.sceneId === 'string' && body.sceneId.trim() ? body.sceneId : WUKUANG_SCENE_ID;
  // 步数由指挥端预案决定（当前 11 步推演法，历史库存在 8 步删减版），
  // 这里只校验非空与序号完整，写死步数会让非该步数的预案永久无法签发。
  const sequences = new Set(mappings.map((item) => item.sequence));
  const sequenceComplete = sequences.size === mappings.length
    && [...sequences].every((value) => Number.isInteger(value) && value >= 1 && value <= mappings.length);
  if (!planId || !mappings.length || !sequenceComplete) {
    return NextResponse.json({ message: '需要 planId 和序号连续完整的 mappings。' }, { status: 400 });
  }
  if (sceneId !== WUKUANG_SCENE_ID) return NextResponse.json({ message: 'sceneId 与当前五矿国际广场场景不一致。' }, { status: 400 });
  const floor = body?.floor;
  const room = body?.room;
  const floorId = body?.floorId;
  const roomId = body?.roomId;
  let resolved = { floor, floorId, room, roomId };
  // 无条件尽力拉一次场景树：既用于解析目标空间对象，也用于解析真实供水对象 ID。
  let tree: Awaited<ReturnType<typeof getSceneInstanceTree>> | null = null;
  try {
    tree = await getSceneInstanceTree({ sceneId });
  } catch {
    tree = null; // 场景树不可用时不阻断推演创建，交由桥接层 DATA_GAP 降级。
  }
  if (floor || floorId || room || roomId) {
    if (tree) {
      const target = resolveSceneTarget(tree, { sceneId, floor, floorId, room, roomId });
      if (!target) {
        return NextResponse.json({ message: '未能在当前三维场景树中解析真实楼层或空间对象。' }, { status: 422 });
      }
      resolved = target.kind === 'space'
        ? { floor, floorId, room: target.label, roomId: target.objectId }
        : { floor: target.label, floorId: target.objectId, room, roomId };
    } else {
      return NextResponse.json({ message: '三维场景树不可用，无法解析目标空间对象。' }, { status: 502 });
    }
  }
  // 请求未带水源对象 ID 时，从场景树解析真实供水类本体（室外/室内消火栓、水泵接合器、水箱、水源地），
  // 供三维水源部署步骤做真实展示；解析不出则交桥接层按 DATA_GAP 如实降级。
  let autoWaterSourceObjectIds: string[] = [];
  if (tree && typeof tree === 'object') {
    autoWaterSourceObjectIds = collectWaterSourceObjectIds(tree as unknown as Record<string, unknown>);
  }
  const parseRoute = (value: unknown): RouteGeometryInput | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.routeKey !== 'string' || !record.routeKey.trim()) return undefined;
    const points = Array.isArray(record.points) ? record.points.filter((p): p is { x: number; y: number; z: number } =>
      !!p && typeof p === 'object' && (p as Record<string, unknown>).x !== undefined) : [];
    if (points.length < 2) return undefined;
    return {
      routeKey: record.routeKey,
      routeName: typeof record.routeName === 'string' ? record.routeName : undefined,
      points,
      color: typeof record.color === 'string' ? record.color : undefined,
    };
  };
  const primaryRoute = parseRoute(body?.primaryRoute);
  const backupRoute = parseRoute(body?.backupRoute);
  const requestedWaterIds = Array.isArray(body?.waterSourceObjectIds)
    ? body.waterSourceObjectIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const waterSourceObjectIds = requestedWaterIds.length ? requestedWaterIds : autoWaterSourceObjectIds;
  const run = createSimulationRun({ planId, sceneId, ...resolved, mappings, primaryRoute, backupRoute, waterSourceObjectIds });
  return NextResponse.json({ run });
}
