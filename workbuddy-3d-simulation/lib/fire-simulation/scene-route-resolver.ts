/**
 * 真实场景路线/对象解析（接口形状防御式）。
 *
 * 目标：把"场景内部可达路径"（kgraph shortest-path）与"消火栓等设备本体"
 * （getSceneInstanceTree 层级树）解析成推演可直接消费的坐标点序列与 out_instance_id。
 *
 * 设计原则：
 * - 多种返回形状兼容：直接读干净字段，不用一种形状赌平台；解析不出就返回 undefined，
 *   由调用方按 DATA_GAP 如实降级，绝不臆造成一条路线。
 * - 纯函数（parse* / extract*）可单测；异步 resolve* 只在运行时调用平台。
 */

import { findShortestPath, getSceneInstanceTree, getTwinsInstanceDetail, type GeoLocation } from '@/lib/ustudio';
import type { Point3 } from './contracts';

/** 单点解析：兼容 {x,y,z} / [x,y,z] / "x&y&z" / {longitude,latitude}。无效返回 null。 */
export function parsePoint(value: unknown): Point3 | null {
  if (Array.isArray(value)) {
    const [x, y, z] = value.map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y, z: Number.isFinite(z) ? z : 0 } : null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const x = Number(obj.x ?? obj.longitude ?? obj.lng);
    const y = Number(obj.y ?? obj.latitude ?? obj.lat);
    const z = Number(obj.z ?? obj.altitude ?? 0);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y, z: Number.isFinite(z) ? z : 0 };
    return null;
  }
  if (typeof value === 'string') {
    const parts = value.split(/[&,，\s]+/).map((p) => Number(p.trim()));
    if (parts.length >= 2 && parts.slice(0, 2).every(Number.isFinite)) {
      return { x: parts[0], y: parts[1], z: parts.length >= 3 && Number.isFinite(parts[2]) ? parts[2] : 0 };
    }
    return null;
  }
  return null;
}

function firstField(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

/** 从最短路径响应里提取路径点序列。兼容 result.path / data.path / points / route 等常见形状。 */
export function parsePathPoints(payload: unknown): Point3[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  // 一层 / 两层嵌套（result / data / response）
  const candidates: unknown[] = [
    firstField(root, ['path', 'points', 'route', 'routes', 'result', 'data']),
  ];
  for (const field of ['result', 'data']) {
    const nested = root[field];
    if (nested && typeof nested === 'object') {
      candidates.push(firstField(nested as Record<string, unknown>, ['path', 'points', 'route', 'routes', 'coordinates']));
    }
  }
  for (const candidate of candidates) {
    const list = Array.isArray(candidate) ? candidate : undefined;
    if (!list) continue;
    const mapped = list.map(parsePoint).filter((p): p is Point3 => p !== null);
    if (mapped.length >= 2) return mapped;
  }
  return null;
}

/** 从场景树某节点提取坐标（position / centroid / x,y,z）。 */
export function extractScenePosition(node: Record<string, unknown>): Point3 | null {
  const candidate = firstField(node, ['position', 'centroid', 'location', 'coordinate']);
  if (candidate !== undefined) {
    const parsed = parsePoint(candidate);
    if (parsed) return parsed;
  }
  return parsePoint(node);
}

/** 从场景树里筛选消防设备本体（消火栓 / 水泵 / 接合器 / 消防设施等）的 out_instance_id。 */
const EQUIPMENT_KEYWORDS = ['消火栓', 'hydrant', '水泵', 'pump', '接合器', 'siamese', '消防', '灭火器', 'fire'] as const;

/** 供水类本体（用于"水源部署"步骤）：消火栓/水泵/接合器/水箱/水源地/取水点。 */
export const WATER_SOURCE_KEYWORDS = [
  '消火栓', 'hydrant',
  '水泵', 'pump',
  '接合器', 'siamese',
  '水箱', 'tank',
  '水源', 'watersource', 'water_source',
  '取水',
] as const;

/** 供水类本体的类型标识（含常见变体）。 */
const WATER_SOURCE_TYPES = [
  'outdoorfirehydrant', 'indoorfirehydrant', 'hydrant', 'firehydrant',
  'pumpadapter', 'siameseconnection', 'firewatertank', 'watertank',
  'watersource', 'firepump', 'mobilefirepump', 'pumpcontrolcabinet',
] as const;

function isButtonOrTrigger(type: string, name: string): boolean {
  return type.includes('button') || type.includes('trigger') || name.includes('按钮') || name.includes('button');
}

/**
 * 从场景树筛选**真正的供水对象**（室外/室内消火栓、水泵接合器、消防水箱、水源地、消防水泵、取水点）。
 * 明确排除 HydrantButton 这类"消火栓按钮/触发器"（不是取水水源），避免把 90+ 个按钮当水源展示。
 */
export function collectWaterSourceObjectIds(root: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    const type = String(node.type ?? '').toLowerCase();
    const name = String(node.name ?? node.twins_instance_name ?? '').toLowerCase();
    const id = String(node.id ?? node.out_instance_id ?? '');
    if (id && !isButtonOrTrigger(type, name)) {
      const typeHit = WATER_SOURCE_TYPES.some((t) => type.includes(t));
      const nameHit = WATER_SOURCE_KEYWORDS.some((k) => name.includes(k.toLowerCase()));
      if (typeHit || nameHit) ids.push(id);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (child && typeof child === 'object') walk(child as Record<string, unknown>);
    }
  };
  walk(root);
  return [...new Set(ids)];
}

export function collectEquipmentObjectIds(root: Record<string, unknown>, keywords: readonly string[] = EQUIPMENT_KEYWORDS): string[] {
  const ids: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    const type = String(node.type ?? '').toLowerCase();
    const name = String(node.name ?? node.twins_instance_name ?? '').toLowerCase();
    const id = String(node.id ?? node.out_instance_id ?? '');
    if (id && keywords.some((k) => type.includes(k.toLowerCase()) || name.includes(k.toLowerCase()))) {
      ids.push(id);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (child && typeof child === 'object') walk(child as Record<string, unknown>);
    }
  };
  walk(root);
  return [...new Set(ids)];
}

/** 构建最短路径的 source/target 坐标点。任一缺坐标返回 undefined（调用方降级）。 */
export function toGeoLocation(point: Point3): GeoLocation {
  return { x: point.x, y: point.y, z: point.z };
}

/**
 * 解析真实场景内部路径（起点→起火房间）。
 * 解析不出 ≥2 个坐标点就返回 null，交由调用方按 DATA_GAP 降级。
 */
export async function resolveSceneInteriorRoute(
  input: { sceneId?: string; source: Point3; target: Point3; costModel?: unknown },
): Promise<Point3[] | null> {
  try {
    const payload = await findShortestPath({
      sceneId: input.sceneId,
      source: toGeoLocation(input.source),
      target: toGeoLocation(input.target),
      costModel: input.costModel,
    });
    const path = parsePathPoints(payload);
    return path && path.length >= 2 ? path : null;
  } catch {
    return null;
  }
}

/** 从场景树解析目标楼层/房间与消防设备本体 ID。失败/缺数据返回空数组（调用方降级）。 */
export async function resolveSceneObjects(input: { sceneId?: string; floor?: string; room?: string }) {
  const fireRoomObjectIds: string[] = [];
  const equipmentObjectIds: string[] = [];
  try {
    const tree = await getSceneInstanceTree({ sceneId: input.sceneId });
    if (tree && typeof tree === 'object') {
      equipmentObjectIds.push(...collectEquipmentObjectIds(tree as unknown as Record<string, unknown>));
    }
  } catch {
    // 解析失败保持空，由调用方降级。
  }
  return { fireRoomObjectIds, equipmentObjectIds };
}

/**
 * 按对象 out_instance_id 解析其场景坐标（position 属性，格式 x&y&z）。
 * 解析不到返回 null，交由调用方降级。用于"着火对象→火点坐标"。
 */
export async function resolveObjectPosition(sceneId: string, outInstanceId: string): Promise<Point3 | null> {
  try {
    const tree = await getSceneInstanceTree({ sceneId });
    let twinsId = '';
    const walk = (node: Record<string, unknown>) => {
      if (twinsId) return;
      if (String(node.out_instance_id ?? node.id) === outInstanceId) {
        twinsId = String(node.twins_instance_id ?? '');
        return;
      }
      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) {
        if (child && typeof child === 'object') walk(child as Record<string, unknown>);
      }
    };
    walk(tree as unknown as Record<string, unknown>);
    if (!twinsId) return null;
    const detail = await getTwinsInstanceDetail({ twinsInstanceId: twinsId });
    const props = Array.isArray(detail?.twins_instance_property_list)
      ? (detail.twins_instance_property_list as Array<Record<string, unknown>>)
      : [];
    const posProp = props.find((prop) => String(prop?.twins_property_identifier ?? '') === 'position');
    return posProp ? parsePoint(posProp.property_value) : null;
  } catch {
    return null;
  }
}

/**
 * 解析场景"地面高度"z：优先取 1F（或名字含 1F/一层/首层）的楼层下第一个空间或楼层节点高度；
 * 否则取场景里 z 最小的空间高度。解析不到返回 null（调用方可回退到 0 或火点 z）。
 */
export async function resolveGroundHeight(sceneId: string): Promise<number | null> {
  try {
    const tree = await getSceneInstanceTree({ sceneId });
    let groundCandidate = '';
    const walk = (node: Record<string, unknown>) => {
      if (groundCandidate) return;
      const name = String(node.name ?? node.twins_instance_name ?? '');
      const type = String(node.type ?? node.twins_identifier ?? '');
      if ((type.toLowerCase().includes('story') || type.toLowerCase().includes('floor'))
        && /1f|1层|首层|一层|一层|地面|ground/i.test(name)) {
        const children = Array.isArray(node.children) ? node.children : [];
        const child = children.find((c) => c && typeof c === 'object' && String((c as Record<string, unknown>).type ?? (c as Record<string, unknown>).twins_identifier ?? '').toLowerCase().includes('space'));
        if (child) {
          groundCandidate = String((child as Record<string, unknown>).out_instance_id ?? (child as Record<string, unknown>).id ?? '');
        }
      }
      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) {
        if (child && typeof child === 'object') walk(child as Record<string, unknown>);
      }
    };
    walk(tree as unknown as Record<string, unknown>);
    if (groundCandidate) {
      const pos = await resolveObjectPosition(sceneId, groundCandidate);
      if (pos) return pos.z;
    }
    return null;
  } catch {
    return null;
  }
}
