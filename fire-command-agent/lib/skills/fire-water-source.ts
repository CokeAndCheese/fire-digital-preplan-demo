import 'server-only';

/**
 * 市政水源（消火栓）检索。
 *
 * 数据源：{FIRE_RESOURCE_PLATFORM_URL}/data/hydrants.json
 *
 * 实测数据质量（2026-08-25，共 3990 条）：
 * - lat/lng 为 null：1036 条（26%），有地址无坐标，无法参与距离排序
 * - 坐标落在三亚行政边界外：45 条，其中 HX 序列 Δlng 恒为 0.062495，属等差补值
 * - type/diameter/pressure：3990/3990 全空，无法推算供水能力
 * - code 为空：106 条
 * - 坐标完全重合：84 组（最多 5 点叠一处）
 * - status 字段 UTF-8 损坏：3 条
 *
 * 因此本模块的输出必须携带 dataQuality，让下游知道排序覆盖率，
 * 不得把 74% 的覆盖率当作全量结果使用。
 */

import { fireResourcePlatformUrl } from './fire-resource-platform';

/** 三亚市行政区划大致边界，用于剔除等差补值产生的越界坐标 */
const SANYA_BOUNDS = { minLat: 18.09, maxLat: 18.67, minLng: 108.46, maxLng: 109.87 } as const;

export type WaterSourceUsability = 'available' | 'unavailable' | 'unknown';

export type WaterSourceRecord = {
  id: string;
  code: string | null;
  address: string | null;
  longitude: number;
  latitude: number;
  /** 原始 status 文本，可能含损坏字符 */
  rawStatus: string | null;
  usability: WaterSourceUsability;
  /** 口径，实测全空。保留字段以便数据补齐后直接生效 */
  diameterMm: number | null;
  /** 压力，实测全空。用水量计算依赖此项 */
  pressureMpa: number | null;
  sourceRecordId: string;
};

export type LocatedWaterSource = WaterSourceRecord & {
  distanceKm: number;
};

export type WaterSourceDataQuality = {
  totalRecords: number;
  /** 通过清洗、可参与距离排序的记录数 */
  usableRecords: number;
  droppedMissingCoordinate: number;
  droppedOutOfBounds: number;
  droppedMalformed: number;
  duplicateCoordinateGroups: number;
  corruptedStatusRecords: number;
  /** usableRecords / totalRecords */
  coverageRatio: number;
  /** 供水能力字段缺失，用水量只能估算 */
  supplyCapacityAvailable: boolean;
};

export type WaterSourceSearchResult = {
  status: 'ready' | 'pending_manual_review';
  platformUrl: string;
  dataUrl: string;
  fetchedAt: string;
  /** 按距离升序 */
  sources: LocatedWaterSource[];
  dataQuality: WaterSourceDataQuality;
  /** 数据质量导致的显式告警，必须随预案一起呈现 */
  warnings: string[];
};

type RawRecord = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 数值解析。空字符串必须返回 null 而不是 0：
 * 源数据 diameter/pressure 全为 ''，Number('') === 0 会把"无数据"
 * 误读成"口径 0mm / 压力 0MPa"，让下游以为供水能力已知。
 */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** U+FFFD 替换字符表示源数据编码已损坏，不可当作有效状态解析 */
function hasCorruptedText(value: string | null): boolean {
  return value !== null && value.includes('�');
}

function classifyUsability(rawStatus: string | null): WaterSourceUsability {
  if (rawStatus === null || hasCorruptedText(rawStatus)) return 'unknown';
  if (rawStatus.includes('不可用') || rawStatus.includes('无水') || rawStatus.includes('锈蚀')) return 'unavailable';
  if (rawStatus.includes('可用')) return 'available';
  return 'unknown';
}

function withinSanya(latitude: number, longitude: number): boolean {
  return latitude >= SANYA_BOUNDS.minLat && latitude <= SANYA_BOUNDS.maxLat
    && longitude >= SANYA_BOUNDS.minLng && longitude <= SANYA_BOUNDS.maxLng;
}

/**
 * 清洗原始水源记录。
 *
 * 丢弃分三类并分别计数，便于向指挥员解释"为什么只有 N 个水源可用"：
 * 1. 无坐标        —— 有地址但未测绘，需补测
 * 2. 坐标越界      —— 等差补值产生的假坐标
 * 3. 结构异常      —— 缺 id 等关键字段
 *
 * 不做地理编码回填：地址转坐标需要外部服务，且回填精度不足以用于进攻路线。
 */
export function cleanWaterSourceRecords(payload: unknown[]): {
  records: WaterSourceRecord[];
  dataQuality: WaterSourceDataQuality;
  warnings: string[];
} {
  let droppedMissingCoordinate = 0;
  let droppedOutOfBounds = 0;
  let droppedMalformed = 0;
  let corruptedStatusRecords = 0;
  const records: WaterSourceRecord[] = [];

  payload.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      droppedMalformed += 1;
      return;
    }
    const raw = entry as RawRecord;
    const id = text(raw.id) ?? (text(raw.code) ? `code-${text(raw.code)}` : null);
    if (!id) {
      droppedMalformed += 1;
      return;
    }
    const rawStatus = text(raw.status);
    if (hasCorruptedText(rawStatus)) corruptedStatusRecords += 1;

    const latitude = finiteNumber(raw.lat);
    const longitude = finiteNumber(raw.lng);
    if (latitude === null || longitude === null) {
      droppedMissingCoordinate += 1;
      return;
    }
    if (!withinSanya(latitude, longitude)) {
      droppedOutOfBounds += 1;
      return;
    }
    records.push({
      id,
      code: text(raw.code),
      address: text(raw.address),
      longitude,
      latitude,
      rawStatus,
      usability: classifyUsability(rawStatus),
      diameterMm: finiteNumber(raw.diameter),
      pressureMpa: finiteNumber(raw.pressure),
      sourceRecordId: text(raw.id) ?? `index-${index}`,
    });
  });

  const coordinateKeys = new Map<string, number>();
  for (const record of records) {
    const key = `${record.latitude.toFixed(6)},${record.longitude.toFixed(6)}`;
    coordinateKeys.set(key, (coordinateKeys.get(key) ?? 0) + 1);
  }
  const duplicateCoordinateGroups = [...coordinateKeys.values()].filter((n) => n > 1).length;
  const supplyCapacityAvailable = records.some((r) => r.diameterMm !== null || r.pressureMpa !== null);
  const totalRecords = payload.length;

  const dataQuality: WaterSourceDataQuality = {
    totalRecords,
    usableRecords: records.length,
    droppedMissingCoordinate,
    droppedOutOfBounds,
    droppedMalformed,
    duplicateCoordinateGroups,
    corruptedStatusRecords,
    coverageRatio: totalRecords > 0 ? records.length / totalRecords : 0,
    supplyCapacityAvailable,
  };

  return { records, dataQuality, warnings: buildWarnings(dataQuality) };
}

function buildWarnings(quality: WaterSourceDataQuality): string[] {
  const warnings: string[] = [];
  if (quality.droppedMissingCoordinate > 0) {
    const pct = ((quality.droppedMissingCoordinate / quality.totalRecords) * 100).toFixed(1);
    warnings.push(`${quality.droppedMissingCoordinate} 条水源无坐标（占 ${pct}%），未参与距离排序；需补测坐标。`);
  }
  if (quality.droppedOutOfBounds > 0) {
    warnings.push(`${quality.droppedOutOfBounds} 条水源坐标落在三亚行政边界外，已剔除；疑为等差补值产生的无效坐标。`);
  }
  if (quality.duplicateCoordinateGroups > 0) {
    warnings.push(`${quality.duplicateCoordinateGroups} 组水源坐标完全重合，同距水源的先后次序不可作为选取依据。`);
  }
  if (quality.corruptedStatusRecords > 0) {
    warnings.push(`${quality.corruptedStatusRecords} 条水源状态字段编码损坏，可用性按“未知”处理。`);
  }
  if (!quality.supplyCapacityAvailable) {
    warnings.push('全部水源缺少口径与压力数据，供水能力无法核算；用水量只能按规范经验值估算。');
  }
  return warnings;
}

function haversineKm(
  from: { longitude: number; latitude: number },
  to: { longitude: number; latitude: number },
) {
  const earthRadiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 优先走 /api/hydrants：它回传 {ok,total,hydrants}，带 total 可校验是否被截断；
 * 静态文件 /data/hydrants.json 是裸数组，无法区分"空台账"和"传输截断"。
 */
function waterSourceApiUrl(platformUrl: string) {
  return new URL('api/hydrants', `${platformUrl}/`).toString();
}

function waterSourceDataUrl(platformUrl: string) {
  return new URL('data/hydrants.json', `${platformUrl}/`).toString();
}

/**
 * 从 API 或静态文件两种形状中取出水源数组。
 * API 形状：{ok:true,total:3990,hydrants:[...]}；静态形状：[...]
 * total 与实际条数不一致时抛错，不静默使用被截断的数据。
 */
function extractHydrantList(payload: unknown, sourceUrl: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const envelope = payload as Record<string, unknown>;
    if (envelope.ok === false) {
      throw new Error(`水源接口返回失败：${String(envelope.error ?? '未说明原因')}`);
    }
    const list = envelope.hydrants;
    if (Array.isArray(list)) {
      const total = envelope.total;
      if (typeof total === 'number' && Number.isFinite(total) && total !== list.length) {
        throw new Error(`水源数据不完整：接口声明 ${total} 条，实收 ${list.length} 条（${sourceUrl}）。`);
      }
      return list;
    }
  }
  throw new Error('水源数据格式异常：既非数组也不含 hydrants 字段。');
}

/**
 * 水源数据缓存。源文件 1.22 MB / 3990 条，逐次请求重复下载会拖慢预案生成。
 * TTL 取 5 分钟：市政消火栓台账不是实时数据，5 分钟内复用不影响处置判断。
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { key: string; expiresAt: number; payload: unknown[]; dataUrl: string } | null = null;

export function clearWaterSourceCache() {
  cache = null;
}

async function fetchHydrants(url: string, fetcher: typeof fetch): Promise<unknown[]> {
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`水源数据源返回 ${response.status}`);
  return extractHydrantList(await response.json() as unknown, url);
}

/**
 * 取水源台账：先试 API，失败回落静态文件。
 * 回落是有意的——静态文件同源同批次，可用性比 API 高；
 * 但两者都失败时必须抛错，不返回空数组冒充"该区域无水源"。
 */
async function loadWaterSourcePayload(
  platformUrl: string,
  fetcher: typeof fetch,
): Promise<{ payload: unknown[]; dataUrl: string }> {
  const apiUrl = waterSourceApiUrl(platformUrl);
  const now = Date.now();
  if (cache && cache.key === platformUrl && cache.expiresAt > now) {
    return { payload: cache.payload, dataUrl: cache.dataUrl };
  }
  let payload: unknown[];
  let dataUrl = apiUrl;
  try {
    payload = await fetchHydrants(apiUrl, fetcher);
  } catch (apiError) {
    dataUrl = waterSourceDataUrl(platformUrl);
    try {
      payload = await fetchHydrants(dataUrl, fetcher);
    } catch {
      throw apiError instanceof Error ? apiError : new Error('水源台账读取失败。');
    }
  }
  cache = { key: platformUrl, expiresAt: now + CACHE_TTL_MS, payload, dataUrl };
  return { payload, dataUrl };
}

export type WaterSourceSearchInput = {
  longitude: number;
  latitude: number;
  /** 检索半径，缺省 3 km。市政消火栓密度高，过大半径无助于处置决策 */
  radiusKm?: number;
  /** 返回条数上限，缺省 10 */
  limit?: number;
  /** 是否排除已报不可用的水源，缺省 false（保留并标注，由指挥员判断） */
  excludeUnavailable?: boolean;
};

/**
 * 按距离检索起火点周边水源。
 *
 * status 恒为 'pending_manual_review'：源数据 26% 无坐标、口径压力全空，
 * 任何情况下都不足以支撑无人复核的自动取水决策。
 */
export async function searchNearbyWaterSources(
  input: WaterSourceSearchInput,
  platformUrl = fireResourcePlatformUrl(),
  fetcher: typeof fetch = fetch,
): Promise<WaterSourceSearchResult> {
  const { payload, dataUrl } = await loadWaterSourcePayload(platformUrl, fetcher);
  const { records, dataQuality, warnings } = cleanWaterSourceRecords(payload);

  const radiusKm = typeof input.radiusKm === 'number' && input.radiusKm > 0 ? input.radiusKm : 3;
  const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.floor(input.limit) : 10;
  const origin = { longitude: input.longitude, latitude: input.latitude };

  const candidates = input.excludeUnavailable
    ? records.filter((record) => record.usability !== 'unavailable')
    : records;

  const sources = candidates
    .map((record) => ({
      ...record,
      distanceKm: haversineKm(origin, { longitude: record.longitude, latitude: record.latitude }),
    }))
    .filter((record) => record.distanceKm <= radiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, limit);

  const resultWarnings = [...warnings];
  if (sources.length === 0) {
    resultWarnings.push(`起火点 ${radiusKm} km 范围内未检索到有坐标的水源；需人工核实就近取水点。`);
  }
  const unavailableCount = sources.filter((s) => s.usability === 'unavailable').length;
  if (unavailableCount > 0) {
    resultWarnings.push(`返回的 ${sources.length} 个水源中 ${unavailableCount} 个已报不可用，取水前须现场确认。`);
  }

  return {
    status: 'pending_manual_review',
    platformUrl,
    dataUrl,
    fetchedAt: new Date().toISOString(),
    sources,
    dataQuality,
    warnings: resultWarnings,
  };
}
