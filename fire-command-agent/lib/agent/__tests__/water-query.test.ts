import { describe, expect, it } from 'vitest';
import { isWaterSourceQuestion, parseWaterQuery } from '../water-query';

describe('dialogue water source query parsing', () => {
  it('recognises water questions and ignores unrelated commands', () => {
    expect(isWaterSourceQuestion('五矿国际广场附近有哪些消火栓')).toBe(true);
    expect(isWaterSourceQuestion('查一下最近的水源')).toBe(true);
    expect(isWaterSourceQuestion('周边可用的消防水池有几个')).toBe(true);
    expect(isWaterSourceQuestion('定位14层1403房间')).toBe(false);
    expect(isWaterSourceQuestion('研判响应等级')).toBe(false);
    // 只提"供水"但不是在问检索的，不抢 route-water 的整体路线约束。
    expect(isWaterSourceQuestion('生成预案')).toBe(false);
  });

  it('extracts the unit, radius, water type and availability filter', () => {
    const intent = parseWaterQuery('五矿国际广场2公里内可用的室外消火栓有哪些');
    expect(intent.unitName).toBe('五矿国际广场');
    expect(intent.radiusKm).toBe(2);
    expect(intent.waterType).toBe('outdoor_hydrant');
    expect(intent.excludeUnavailable).toBe(true);
    expect(intent.usesContextReference).toBe(false);
  });

  it('converts a metre radius and caps it inside the supported range', () => {
    expect(parseWaterQuery('800米内的水源').radiusKm).toBe(0.8);
    expect(parseWaterQuery('50公里内的水源').radiusKm).toBe(20);
    // 未说半径时与 searchNearbyWaterSources 缺省一致。
    expect(parseWaterQuery('附近的水源').radiusKm).toBe(3);
  });

  it('flags contextual references instead of guessing a location', () => {
    const intent = parseWaterQuery('这个单位附近最近的取水点在哪');
    expect(intent.usesContextReference).toBe(true);
    expect(intent.unitName).toBeNull();
  });

  it('keeps unavailable sources when the question asks for all of them', () => {
    expect(parseWaterQuery('附近所有水源，包括不可用的').excludeUnavailable).toBe(false);
  });

  it('reads an explicit result count and clamps it', () => {
    expect(parseWaterQuery('最近的5个消火栓').limit).toBe(5);
    expect(parseWaterQuery('附近的水源').limit).toBe(10);
  });
});
