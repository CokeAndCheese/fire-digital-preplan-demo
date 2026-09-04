import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildRealtimeWarnings,
  clearRealtimeCache,
  getPlatformRealtime,
  parseReservoirs,
  parseTraffic,
  parseWeather,
} from '../fire-platform-realtime';

/** 取自 /api/realtime 的真实响应形状 */
const LIVE_SHAPE = {
  weather: {
    ok: true,
    data: {
      city: '三亚市', adcode: '460200', weather: '阴',
      temperature: '29', temperatureFloat: '29.0',
      windDirection: '西南', windPower: '5', humidity: '82',
      reportTime: '2026-08-25 13:01:51', fetchedAt: '2026-08-25T05:14:22.236Z',
    },
  },
  traffic: {
    ok: true,
    data: {
      city: '三亚市',
      center: { lat: 18.252, lng: 109.508 },
      evaluation: { status: 1, statusDesc: '畅通' },
      description: '该区域整体畅通。',
      congestedRoads: [
        { roadName: '跃进街', sectionDesc: '东向西,立新巷附近', status: 4, statusDesc: '严重拥堵', speed: 3.36, distance: 60, trend: 'WORSE' },
        { roadName: '建港路', sectionDesc: '北向南', status: 3, statusDesc: '拥堵', speed: 12.61, distance: 70, trend: 'WORSE' },
        { roadName: '吉祥街', sectionDesc: '西向东', status: 2, statusDesc: '缓行', speed: 16.34, distance: 50, trend: 'WORSE' },
      ],
    },
  },
  hydrology: {
    ok: true,
    data: {
      fetchedAt: '2026-08-25T05:08:48.670Z',
      reservoirs: [
        { name: '松涛水库', waterLevel: 186.06 },
        { name: '大隆水库', waterLevel: 57.1 },
      ],
    },
  },
  errors: {},
};

describe('realtime parsing', () => {
  it('parses weather including string-encoded numbers', () => {
    const weather = parseWeather(LIVE_SHAPE.weather);
    expect(weather).toMatchObject({
      city: '三亚市', weather: '阴',
      temperatureCelsius: 29, windDirection: '西南',
      windPower: '5', humidityPercent: 82,
    });
  });

  it('maps Amap status codes to congestion levels', () => {
    const traffic = parseTraffic(LIVE_SHAPE.traffic);
    expect(traffic?.congestedRoads.map((r) => r.level)).toEqual(['severe', 'congested', 'slow']);
  });

  it('keeps overall evaluation separate from per-road status', () => {
    // 实测矛盾：整体报"畅通"，同时存在严重拥堵路段。不可只读整体评价。
    const traffic = parseTraffic(LIVE_SHAPE.traffic);
    expect(traffic?.overallLevel).toBe('clear');
    expect(traffic?.congestedRoads.some((r) => r.level === 'severe')).toBe(true);
  });

  it('preserves speed, length and trend for each congested road', () => {
    const traffic = parseTraffic(LIVE_SHAPE.traffic);
    expect(traffic?.congestedRoads[0]).toMatchObject({
      roadName: '跃进街', speedKmh: 3.36, distanceMeters: 60, trend: 'WORSE',
    });
  });

  it('parses reservoirs', () => {
    expect(parseReservoirs(LIVE_SHAPE.hydrology)).toEqual([
      { name: '松涛水库', waterLevelMeters: 186.06 },
      { name: '大隆水库', waterLevelMeters: 57.1 },
    ]);
  });

  it('returns null rather than a hollow object when a block is absent', () => {
    expect(parseWeather(undefined)).toBeNull();
    expect(parseTraffic({ ok: false })).toBeNull();
    expect(parseReservoirs({})).toEqual([]);
  });

  it('treats unknown status codes as unknown instead of guessing', () => {
    const traffic = parseTraffic({ data: { congestedRoads: [{ roadName: 'X', status: 99 }] } });
    expect(traffic?.congestedRoads[0].level).toBe('unknown');
    expect(traffic?.congestedRoads[0].trend).toBe('UNKNOWN');
  });
});

describe('route constraint warnings', () => {
  it('raises one warning per congested or severe road, ignoring 缓行', () => {
    const warnings = buildRealtimeWarnings({
      weather: parseWeather(LIVE_SHAPE.weather),
      traffic: parseTraffic(LIVE_SHAPE.traffic),
      reservoirs: parseReservoirs(LIVE_SHAPE.hydrology),
    });
    expect(warnings.filter((w) => w.includes('调派路线应避让'))).toHaveLength(2);
    expect(warnings.some((w) => w.includes('跃进街') && w.includes('仍在恶化'))).toBe(true);
    expect(warnings.some((w) => w.includes('吉祥街'))).toBe(false);
  });

  it('always states that traffic cannot confirm a route', () => {
    const warnings = buildRealtimeWarnings({ weather: null, traffic: null, reservoirs: [] });
    expect(warnings.some((w) => w.includes('不足以确认路线可通'))).toBe(true);
  });

  it('flags each missing block explicitly', () => {
    const warnings = buildRealtimeWarnings({ weather: null, traffic: null, reservoirs: [] });
    expect(warnings.some((w) => w.includes('未返回天气'))).toBe(true);
    expect(warnings.some((w) => w.includes('未返回路况'))).toBe(true);
    expect(warnings.some((w) => w.includes('未返回水库水位'))).toBe(true);
  });
});

describe('realtime fetch', () => {
  beforeEach(() => clearRealtimeCache());

  const stub = (async () => new Response(JSON.stringify(LIVE_SHAPE), { status: 200 })) as unknown as typeof fetch;

  it('reports ready when all three blocks are present', async () => {
    const snapshot = await getPlatformRealtime('https://platform.test', stub);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.sourceUrl).toBe('https://platform.test/api/realtime');
  });

  it('reports partial when a block is missing', async () => {
    const partial = (async () => new Response(
      JSON.stringify({ ...LIVE_SHAPE, hydrology: { ok: false }, traffic: { ok: false } }),
      { status: 200 },
    )) as unknown as typeof fetch;
    const snapshot = await getPlatformRealtime('https://platform.test', partial);
    expect(snapshot.status).toBe('partial');
  });

  it('caches within the TTL', async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify(LIVE_SHAPE), { status: 200 });
    }) as unknown as typeof fetch;
    await getPlatformRealtime('https://platform.test', counting);
    await getPlatformRealtime('https://platform.test', counting);
    expect(calls).toBe(1);
  });

  it('throws rather than returning stale traffic on HTTP failure', async () => {
    const failing = (async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
    await expect(getPlatformRealtime('https://platform.test', failing)).rejects.toThrow(/500/);
  });
});
