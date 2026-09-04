import { describe, expect, it, beforeEach } from 'vitest';
import {
  cleanWaterSourceRecords,
  clearWaterSourceCache,
  searchNearbyWaterSources,
} from '../fire-water-source';

/** 三亚五矿国际广场，取自 units.json 登记坐标 */
const WULIANG = { longitude: 109.504601, latitude: 18.267177 };

function hydrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hyd_test_1',
    code: 'TEST-001',
    address: '三亚市吉阳区迎宾路128号',
    lat: 18.267,
    lng: 109.5046,
    diameter: '',
    pressure: '',
    type: '',
    status: '可用',
    remark: '',
    ...overrides,
  };
}

describe('water source cleaning', () => {
  it('keeps records that carry coordinates inside Sanya', () => {
    const { records, dataQuality } = cleanWaterSourceRecords([hydrant()]);
    expect(records).toHaveLength(1);
    expect(records[0].usability).toBe('available');
    expect(dataQuality.usableRecords).toBe(1);
    expect(dataQuality.coverageRatio).toBe(1);
  });

  it('drops records with null coordinates and counts them separately', () => {
    const { records, dataQuality } = cleanWaterSourceRecords([
      hydrant(),
      hydrant({ id: 'h2', lat: null, lng: null }),
    ]);
    expect(records).toHaveLength(1);
    expect(dataQuality.droppedMissingCoordinate).toBe(1);
    expect(dataQuality.coverageRatio).toBeCloseTo(0.5);
  });

  it('drops out-of-bounds coordinates produced by arithmetic backfill', () => {
    // HX 序列实测 Δlng 恒为 0.062495，末尾漂到 110.19，远出三亚东界
    const { records, dataQuality } = cleanWaterSourceRecords([
      hydrant(),
      hydrant({ id: 'h3', code: 'HX-013', lat: 18.241951, lng: 110.194647 }),
    ]);
    expect(records).toHaveLength(1);
    expect(dataQuality.droppedOutOfBounds).toBe(1);
  });

  it('treats corrupted status text as unknown rather than guessing', () => {
    const { records, dataQuality } = cleanWaterSourceRecords([
      hydrant({ status: '��可用' }),
    ]);
    expect(records[0].usability).toBe('unknown');
    expect(dataQuality.corruptedStatusRecords).toBe(1);
  });

  it('classifies 无水 and 锈蚀 as unavailable', () => {
    const { records } = cleanWaterSourceRecords([
      hydrant({ id: 'a', status: '无水' }),
      hydrant({ id: 'b', status: '锈蚀（无法开启）' }),
      hydrant({ id: 'c', status: '不可用' }),
    ]);
    expect(records.map((r) => r.usability)).toEqual(['unavailable', 'unavailable', 'unavailable']);
  });

  it('counts duplicate coordinate groups', () => {
    const { dataQuality } = cleanWaterSourceRecords([
      hydrant({ id: 'a' }),
      hydrant({ id: 'b' }),
      hydrant({ id: 'c', lat: 18.3, lng: 109.6 }),
    ]);
    expect(dataQuality.duplicateCoordinateGroups).toBe(1);
  });

  it('reports supply capacity as unavailable when diameter and pressure are blank', () => {
    const { dataQuality, warnings } = cleanWaterSourceRecords([hydrant()]);
    expect(dataQuality.supplyCapacityAvailable).toBe(false);
    expect(warnings.some((w) => w.includes('供水能力无法核算'))).toBe(true);
  });

  it('falls back to code when id is missing rather than dropping the record', () => {
    const { records } = cleanWaterSourceRecords([hydrant({ id: null, code: 'BDX-009' })]);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('code-BDX-009');
  });

  it('drops malformed entries', () => {
    const { records, dataQuality } = cleanWaterSourceRecords([null, 'x', [], hydrant()]);
    expect(records).toHaveLength(1);
    expect(dataQuality.droppedMalformed).toBe(3);
  });
});

describe('proximity search', () => {
  beforeEach(() => clearWaterSourceCache());

  const payload = [
    hydrant({ id: 'near', code: 'WML-001', lat: 18.26918, lng: 109.50592, status: '可用' }),
    hydrant({ id: 'mid', code: 'WML-003', lat: 18.27100, lng: 109.50800, status: '不可用' }),
    hydrant({ id: 'far', code: 'FAR-001', lat: 18.40000, lng: 109.70000, status: '可用' }),
    hydrant({ id: 'nocoord', lat: null, lng: null }),
  ];

  const stubFetch = (async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;

  it('sorts by ascending distance and honours the radius', async () => {
    const result = await searchNearbyWaterSources(
      { ...WULIANG, radiusKm: 3 },
      'https://platform.test',
      stubFetch,
    );
    expect(result.sources.map((s) => s.id)).toEqual(['near', 'mid']);
    expect(result.sources[0].distanceKm).toBeLessThan(result.sources[1].distanceKm);
  });

  it('never reports ready: source data is too incomplete for unattended decisions', async () => {
    const result = await searchNearbyWaterSources(WULIANG, 'https://platform.test', stubFetch);
    expect(result.status).toBe('pending_manual_review');
  });

  it('surfaces the missing-coordinate gap in warnings', async () => {
    const result = await searchNearbyWaterSources(WULIANG, 'https://platform.test', stubFetch);
    expect(result.dataQuality.droppedMissingCoordinate).toBe(1);
    expect(result.warnings.some((w) => w.includes('无坐标'))).toBe(true);
  });

  it('flags unavailable hydrants among the returned set', async () => {
    const result = await searchNearbyWaterSources(WULIANG, 'https://platform.test', stubFetch);
    expect(result.warnings.some((w) => w.includes('已报不可用'))).toBe(true);
  });

  it('can exclude unavailable hydrants on request', async () => {
    const result = await searchNearbyWaterSources(
      { ...WULIANG, excludeUnavailable: true },
      'https://platform.test',
      stubFetch,
    );
    expect(result.sources.map((s) => s.id)).toEqual(['near']);
  });

  it('respects the limit', async () => {
    const result = await searchNearbyWaterSources(
      { ...WULIANG, radiusKm: 50, limit: 1 },
      'https://platform.test',
      stubFetch,
    );
    expect(result.sources).toHaveLength(1);
  });

  it('warns when nothing is in range instead of widening the radius silently', async () => {
    const result = await searchNearbyWaterSources(
      { ...WULIANG, radiusKm: 0.01 },
      'https://platform.test',
      stubFetch,
    );
    expect(result.sources).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('未检索到'))).toBe(true);
  });

  it('reuses the cached payload within the TTL', async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;
    await searchNearbyWaterSources(WULIANG, 'https://platform.test', counting);
    await searchNearbyWaterSources(WULIANG, 'https://platform.test', counting);
    expect(calls).toBe(1);
  });

  it('propagates a fetch failure rather than returning stale defaults', async () => {
    const failing = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    await expect(searchNearbyWaterSources(WULIANG, 'https://platform.test', failing))
      .rejects.toThrow(/502/);
  });
});
