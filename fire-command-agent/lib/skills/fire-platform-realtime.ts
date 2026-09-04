import 'server-only';

/**
 * 三亚市消防救援力量与重点单位信息平台 —— 实时态势接入。
 *
 * 数据源：{FIRE_RESOURCE_PLATFORM_URL}/api/realtime
 *
 * 平台同时回传三类实时数据，此前本地实现完全未接：
 * - weather：天气、气温、风向、风力、湿度（火势蔓延判断、昼夜处置）
 * - traffic：城市整体路况 + 拥堵路段（车速、长度、趋势），进攻路线可达性
 * - hydrology：水库水位，天然水源补给参考
 *
 * 注意：traffic 是**城市级**路况，不是起火点到队站的逐段导航。
 * 它能否定一条路线（该路段严重拥堵），但不能确认一条路线可通。
 * 因此本模块的输出只作为约束条件，不产出行车时间。
 */

import { fireResourcePlatformUrl } from './fire-resource-platform';

export type TrafficCongestionLevel = 'clear' | 'slow' | 'congested' | 'severe' | 'unknown';

export type PlatformWeather = {
  city: string | null;
  weather: string | null;
  temperatureCelsius: number | null;
  windDirection: string | null;
  windPower: string | null;
  humidityPercent: number | null;
  reportTime: string | null;
  fetchedAt: string | null;
};

export type CongestedRoad = {
  roadName: string | null;
  sectionDescription: string | null;
  level: TrafficCongestionLevel;
  levelLabel: string | null;
  /** km/h，平台原值 */
  speedKmh: number | null;
  /** 拥堵长度，米 */
  distanceMeters: number | null;
  /** BETTER / WORSE / UNKNOWN：趋势决定这条路能否在到场前恢复 */
  trend: 'BETTER' | 'WORSE' | 'STABLE' | 'UNKNOWN';
};

export type PlatformTraffic = {
  city: string | null;
  overallLevel: TrafficCongestionLevel;
  overallLabel: string | null;
  description: string | null;
  congestedRoads: CongestedRoad[];
};

export type PlatformReservoir = {
  name: string;
  waterLevelMeters: number | null;
};

export type PlatformRealtimeSnapshot = {
  status: 'ready' | 'partial' | 'unavailable';
  fetchedAt: string;
  sourceUrl: string;
  weather: PlatformWeather | null;
  traffic: PlatformTraffic | null;
  reservoirs: PlatformReservoir[];
  /** 平台自身回传的分项错误 */
  sourceErrors: Record<string, unknown>;
  warnings: string[];
};

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** 平台把数值也用字符串回传（temperature: "29"），空串必须是 null 而不是 0 */
function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * 高德路况 status 码：1 畅通 / 2 缓行 / 3 拥堵 / 4 严重拥堵。
 * 未知码一律归 unknown，不猜测。
 */
function congestionLevel(status: unknown): TrafficCongestionLevel {
  switch (numberOrNull(status)) {
    case 1: return 'clear';
    case 2: return 'slow';
    case 3: return 'congested';
    case 4: return 'severe';
    default: return 'unknown';
  }
}

function trendOf(value: unknown): CongestedRoad['trend'] {
  const raw = text(value)?.toUpperCase();
  if (raw === 'BETTER' || raw === 'WORSE' || raw === 'STABLE') return raw;
  return 'UNKNOWN';
}

export function parseWeather(payload: unknown): PlatformWeather | null {
  const block = asRecord(payload);
  const data = asRecord(block?.data);
  if (!data) return null;
  return {
    city: text(data.city),
    weather: text(data.weather),
    temperatureCelsius: numberOrNull(data.temperatureFloat ?? data.temperature),
    windDirection: text(data.windDirection),
    windPower: text(data.windPower),
    humidityPercent: numberOrNull(data.humidity),
    reportTime: text(data.reportTime),
    fetchedAt: text(data.fetchedAt),
  };
}

export function parseTraffic(payload: unknown): PlatformTraffic | null {
  const block = asRecord(payload);
  const data = asRecord(block?.data);
  if (!data) return null;
  const evaluation = asRecord(data.evaluation);
  const roads = Array.isArray(data.congestedRoads) ? data.congestedRoads : [];
  return {
    city: text(data.city),
    overallLevel: congestionLevel(evaluation?.status),
    overallLabel: text(evaluation?.statusDesc),
    description: text(data.description),
    congestedRoads: roads
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Raw => entry !== null)
      .map((road) => ({
        roadName: text(road.roadName),
        sectionDescription: text(road.sectionDesc),
        level: congestionLevel(road.status),
        levelLabel: text(road.statusDesc),
        speedKmh: numberOrNull(road.speed),
        distanceMeters: numberOrNull(road.distance),
        trend: trendOf(road.trend),
      })),
  };
}

export function buildRealtimeWarnings(snapshot: {
  weather: PlatformWeather | null;
  traffic: PlatformTraffic | null;
  reservoirs: PlatformReservoir[];
}): string[] {
  const warnings: string[] = [];
  if (!snapshot.weather) warnings.push('平台未返回天气数据；风力与湿度对火势蔓延的影响需人工判断。');
  if (!snapshot.traffic) {
    warnings.push('平台未返回路况数据；进攻路线可达性未经核验。');
  } else {
    const blocking = snapshot.traffic.congestedRoads.filter(
      (road) => road.level === 'severe' || road.level === 'congested',
    );
    for (const road of blocking) {
      const trend = road.trend === 'WORSE' ? '且仍在恶化' : road.trend === 'BETTER' ? '正在缓解' : '趋势未知';
      warnings.push(
        `${road.roadName ?? '未命名路段'}（${road.sectionDescription ?? '路段未描述'}）${road.levelLabel ?? '拥堵'}`
        + `，车速 ${road.speedKmh ?? '未知'} km/h，${trend}；调派路线应避让或另选进攻面。`,
      );
    }
  }
  if (snapshot.reservoirs.length === 0) {
    warnings.push('平台未返回水库水位；天然水源补给能力未知。');
  }
  warnings.push('路况为城市整体态势，非起火点到队站的逐段导航；可用于否定路线，不足以确认路线可通或推算行车时间。');
  return warnings;
}

export function parseReservoirs(payload: unknown): PlatformReservoir[] {
  const block = asRecord(payload);
  const data = asRecord(block?.data);
  const list = Array.isArray(data?.reservoirs) ? data.reservoirs : [];
  return list
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Raw => entry !== null)
    .map((entry) => ({ name: text(entry.name) ?? '未命名水库', waterLevelMeters: numberOrNull(entry.waterLevel) }))
    .filter((entry) => entry.name !== '未命名水库' || entry.waterLevelMeters !== null);
}

/**
 * 实时态势缓存。TTL 取 60 秒：天气与路况本身按分钟级更新，
 * 秒级重复拉取无意义，但不能像水源台账那样缓存 5 分钟——
 * 拥堵趋势 WORSE 时，过期数据会误导调派。
 */
const CACHE_TTL_MS = 60 * 1000;
let cache: { key: string; expiresAt: number; snapshot: PlatformRealtimeSnapshot } | null = null;

export function clearRealtimeCache() {
  cache = null;
}

export async function getPlatformRealtime(
  platformUrl = fireResourcePlatformUrl(),
  fetcher: typeof fetch = fetch,
): Promise<PlatformRealtimeSnapshot> {
  const sourceUrl = new URL('api/realtime', `${platformUrl}/`).toString();
  const now = Date.now();
  if (cache && cache.key === sourceUrl && cache.expiresAt > now) return cache.snapshot;

  const response = await fetcher(sourceUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`实时态势接口返回 ${response.status}`);
  const payload = asRecord(await response.json());
  if (!payload) throw new Error('实时态势数据格式异常：期望对象。');

  const weather = parseWeather(payload.weather);
  const traffic = parseTraffic(payload.traffic);
  const reservoirs = parseReservoirs(payload.hydrology);
  const sourceErrors = asRecord(payload.errors) ?? {};
  const presentCount = [weather, traffic, reservoirs.length > 0].filter(Boolean).length;

  const snapshot: PlatformRealtimeSnapshot = {
    status: presentCount === 3 ? 'ready' : presentCount === 0 ? 'unavailable' : 'partial',
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    weather,
    traffic,
    reservoirs,
    sourceErrors,
    warnings: buildRealtimeWarnings({ weather, traffic, reservoirs }),
  };
  cache = { key: sourceUrl, expiresAt: now + CACHE_TTL_MS, snapshot };
  return snapshot;
}
