import 'server-only';

export type ResourceAvailabilityStatus = 'verified' | 'unknown' | 'reported_unavailable';
export type ResponseLevelCode = 'I' | 'II' | 'III' | 'IV' | 'V';

export type FireResourcePlatformVehicle = {
  description: string;
  availabilityStatus: ResourceAvailabilityStatus;
};

export type FireResourcePlatformUnit = {
  id: string;
  name: string;
  address?: string;
  contact?: string;
  personnel?: string;
  personnelCount: number | null;
  equipment: string[];
  vehicles: FireResourcePlatformVehicle[];
  longitude?: number;
  latitude?: number;
  availabilityStatus: ResourceAvailabilityStatus;
  etaMinutes: number | null;
  sourceRecordId: string;
  sourceFields: string[];
};

export type ResourceSearchInput = {
  address?: unknown;
  longitude?: unknown;
  latitude?: unknown;
  radiusKm?: unknown;
};

export type LocatedFireResourceUnit = FireResourcePlatformUnit & {
  distanceKm: number | null;
};

export type ForceCompositionPolicy = {
  version: string;
  minUnitsByLevel: Record<ResponseLevelCode, number>;
  additionalUnitsPerTrapped: number;
  highRiseFloor: number;
  highRiseAdditionalUnits: number;
};

export type ForceCompositionInput = ResourceSearchInput & {
  responseLevel?: unknown;
  responseLevelConfirmed?: unknown;
  forcePolicy?: unknown;
  trappedCount?: unknown;
  floor?: unknown;
  roadConstraints?: unknown;
};

export type ForceCompositionRecommendation = {
  status: 'ready' | 'pending_manual_review';
  calculationVersion: string | null;
  requiredUnits: number | null;
  selectedUnits: LocatedFireResourceUnit[];
  candidateUnits: LocatedFireResourceUnit[];
  reviewReasons: string[];
};

type FireResourcePlatformRecord = {
  id?: unknown;
  name?: unknown;
  address?: unknown;
  phone?: unknown;
  personnel?: unknown;
  equipment?: unknown;
  vehicles?: unknown;
  lng?: unknown;
  lat?: unknown;
  availability?: unknown;
  status?: unknown;
  eta_minutes?: unknown;
  etaMinutes?: unknown;
  isGroup?: unknown;
};

const DEFAULT_PLATFORM_URL = 'https://platform.sanya119.online';
const LEVELS: ResponseLevelCode[] = ['I', 'II', 'III', 'IV', 'V'];

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function coordinate(longitude: unknown, latitude: unknown) {
  const lng = number(longitude);
  const lat = number(latitude);
  return lng !== undefined && lat !== undefined && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
    ? { longitude: lng, latitude: lat }
    : null;
}

function availability(value: unknown): ResourceAvailabilityStatus {
  if (value === true || value === 'available' || value === 'verified') return 'verified';
  if (value === false || value === 'unavailable' || value === 'out_of_service') return 'reported_unavailable';
  return 'unknown';
}

function splitReportedList(value: unknown): string[] {
  const raw = text(value);
  return raw ? raw.split(/[、,，;；\n]+/).map((item) => item.trim()).filter(Boolean) : [];
}

function personnelCount(value: unknown): number | null {
  const raw = text(value);
  const match = raw?.match(/(\d+)\s*(?:人|名|员)/);
  return match ? Number(match[1]) : null;
}

function sourceFields(record: FireResourcePlatformRecord): string[] {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key]) => key)
    .sort();
}

export function fireResourcePlatformUrl() {
  return (process.env.FIRE_RESOURCE_PLATFORM_URL || DEFAULT_PLATFORM_URL).trim().replace(/\/+$/, '');
}

function platformDataUrl(platformUrl: string) {
  return new URL('data/fires.json', `${platformUrl}/`).toString();
}

export function normalizeFireResourcePlatformRecord(record: FireResourcePlatformRecord): FireResourcePlatformUnit | null {
  const id = text(record.id);
  const name = text(record.name);
  if (!id || !name || record.isGroup === true) return null;
  const point = coordinate(record.lng, record.lat);
  const unitAvailability = availability(record.availability ?? record.status);
  return {
    id,
    name,
    address: text(record.address),
    contact: text(record.phone),
    personnel: text(record.personnel),
    personnelCount: personnelCount(record.personnel),
    equipment: splitReportedList(record.equipment),
    vehicles: splitReportedList(record.vehicles).map((description) => ({ description, availabilityStatus: 'unknown' })),
    ...(point ?? {}),
    availabilityStatus: unitAvailability,
    etaMinutes: nonNegativeInteger(record.eta_minutes ?? record.etaMinutes),
    sourceRecordId: id,
    sourceFields: sourceFields(record),
  };
}

export async function getFireResourcePlatformUnits(
  platformUrl = fireResourcePlatformUrl(),
  fetcher: typeof fetch = fetch,
) {
  const dataUrl = platformDataUrl(platformUrl);
  const response = await fetcher(dataUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`力量平台返回 ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error('力量平台数据格式异常。');
  const units = payload
    .filter((record): record is FireResourcePlatformRecord => Boolean(record) && typeof record === 'object')
    .map(normalizeFireResourcePlatformRecord)
    .filter((unit): unit is FireResourcePlatformUnit => unit !== null);
  return { platformUrl, dataUrl, units, fetchedAt: new Date().toISOString() };
}

function haversineKm(from: { longitude: number; latitude: number }, to: { longitude: number; latitude: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadiusKm = 6371.0088;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)) * 1000) / 1000;
}

export function unitsForLocation(units: FireResourcePlatformUnit[], input: ResourceSearchInput = {}) {
  const incidentPoint = coordinate(input.longitude, input.latitude);
  const radiusKm = number(input.radiusKm);
  if (incidentPoint) {
    const located = units
      .map((unit): LocatedFireResourceUnit => ({
        ...unit,
        distanceKm: unit.longitude === undefined || unit.latitude === undefined
          ? null
          : haversineKm(incidentPoint, { longitude: unit.longitude, latitude: unit.latitude }),
      }))
      .filter((unit) => unit.distanceKm !== null && (radiusKm === undefined || radiusKm < 0 || unit.distanceKm <= radiusKm))
      .sort((left, right) => (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY));
    return {
      units: located,
      queryScope: radiusKm !== undefined && radiusKm >= 0
        ? `按事件与队站公开坐标计算直线距离，筛选 ${radiusKm}km 范围内的登记队站；未使用路网距离或 ETA。`
        : '按事件与队站公开坐标计算直线距离；未使用路网距离或 ETA。',
      calculation: { distanceKind: 'geodesic', incidentPoint, radiusKm: radiusKm ?? null },
      excludedWithoutCoordinates: units.filter((unit) => unit.longitude === undefined || unit.latitude === undefined).length,
    };
  }

  const queryAddress = text(input.address);
  const district = queryAddress?.match(/(海棠|吉阳|天涯|崖州)(?:区)?/)?.[1];
  const matched = district ? units.filter((unit) => unit.address?.includes(`${district}区`)) : units;
  return {
    units: matched.map((unit) => ({ ...unit, distanceKm: null })),
    queryScope: district
      ? `按${district}区地址字段筛选；未提供事件坐标，不宣称距离排序或 ETA。`
      : '未提供可匹配的行政区或事件坐标，返回平台登记队站；不宣称距离排序或 ETA。',
    calculation: { distanceKind: null, incidentPoint: null, radiusKm: null },
    excludedWithoutCoordinates: 0,
  };
}

function asLevel(value: unknown): ResponseLevelCode | null {
  return typeof value === 'string' && LEVELS.includes(value as ResponseLevelCode) ? value as ResponseLevelCode : null;
}

function asPolicy(value: unknown): ForceCompositionPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  const version = text(policy.version);
  const units = policy.minUnitsByLevel;
  if (!version || !units || typeof units !== 'object' || Array.isArray(units)) return null;
  const minUnitsByLevel = Object.fromEntries(LEVELS.map((level) => [level, nonNegativeInteger((units as Record<string, unknown>)[level])])) as Record<ResponseLevelCode, number | null>;
  if (LEVELS.some((level) => minUnitsByLevel[level] === null)) return null;
  const additionalUnitsPerTrapped = nonNegativeInteger(policy.additionalUnitsPerTrapped);
  const highRiseFloor = nonNegativeInteger(policy.highRiseFloor);
  const highRiseAdditionalUnits = nonNegativeInteger(policy.highRiseAdditionalUnits);
  if (additionalUnitsPerTrapped === null || highRiseFloor === null || highRiseAdditionalUnits === null) return null;
  return { version, minUnitsByLevel: minUnitsByLevel as Record<ResponseLevelCode, number>, additionalUnitsPerTrapped, highRiseFloor, highRiseAdditionalUnits };
}

function floorNumber(value: unknown): number | null {
  const match = text(value)?.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function calculateForceComposition(
  units: FireResourcePlatformUnit[],
  input: ForceCompositionInput,
): ForceCompositionRecommendation {
  const search = unitsForLocation(units, input);
  const reviewReasons: string[] = [];
  const level = asLevel(input.responseLevel);
  const policy = asPolicy(input.forcePolicy);
  const trappedCount = nonNegativeInteger(input.trappedCount);
  const floor = floorNumber(input.floor);
  const constraints = Array.isArray(input.roadConstraints) ? input.roadConstraints.filter((item) => typeof item === 'string' && item.trim()) : [];

  if (!level || input.responseLevelConfirmed !== true) reviewReasons.push('响应等级尚未由具备权限的指挥员确认。');
  if (!policy) reviewReasons.push('未提供可追溯的力量编成规则版本。');
  if (!search.calculation.incidentPoint) reviewReasons.push('缺少经核验的事件坐标，不能按距离排序或计算 ETA。');
  if (trappedCount === null) reviewReasons.push('受困人数未核验。');
  if (constraints.length) reviewReasons.push('存在道路约束，但未提供可计算的路网通行回执。');

  const candidates = search.units.filter((unit) => unit.availabilityStatus === 'verified');
  if (!candidates.length) reviewReasons.push('平台未返回可用状态已核验的队站，不能自动选择调派力量。');
  if (reviewReasons.length || !policy || !level || trappedCount === null) {
    return { status: 'pending_manual_review', calculationVersion: policy?.version ?? null, requiredUnits: null, selectedUnits: [], candidateUnits: search.units, reviewReasons };
  }

  const highRiseUnits = floor !== null && floor >= policy.highRiseFloor ? policy.highRiseAdditionalUnits : 0;
  const requiredUnits = policy.minUnitsByLevel[level] + Math.ceil(trappedCount * policy.additionalUnitsPerTrapped) + highRiseUnits;
  const selectedUnits = candidates.slice(0, requiredUnits);
  if (selectedUnits.length < requiredUnits) {
    return {
      status: 'pending_manual_review', calculationVersion: policy.version, requiredUnits, selectedUnits: [], candidateUnits: search.units,
      reviewReasons: [`可用状态已核验的候选队站不足：需要 ${requiredUnits} 个，当前仅 ${selectedUnits.length} 个。`],
    };
  }
  return { status: 'ready', calculationVersion: policy.version, requiredUnits, selectedUnits, candidateUnits: search.units, reviewReasons: [] };
}
