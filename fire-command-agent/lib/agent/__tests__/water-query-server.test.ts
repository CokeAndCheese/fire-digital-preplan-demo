import { describe, expect, it } from 'vitest';
import { planOrigin, resolveWaterQueryOrigin } from '../water-query-server';
import { parseWaterQuery } from '../water-query';
import { InMemoryPlanRepository } from '../../plan-orchestrator';
import { createCompletePlan } from '../../__tests__/plan-test-fixture';

// 平台记录用 lng/lat 字段名，与契约里的 longitude/latitude 不同。
const UNITS = [
  { id: 'U-1', name: '三亚市消防救援支队吉阳大队', lng: 109.55, lat: 18.26 },
  { id: 'U-2', name: '无坐标中队', address: '三亚市天涯区' },
];

function unitFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(UNITS), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

function failingFetch(): typeof fetch {
  return (async () => { throw new Error('platform down'); }) as unknown as typeof fetch;
}

describe('water query origin resolution', () => {
  it('prefers explicit coordinates written in the question', async () => {
    const intent = parseWaterQuery('109.512, 18.252 周边2公里的水源');
    const result = await resolveWaterQueryOrigin(intent, { fetcher: failingFetch() });
    expect(result).toMatchObject({ ok: true, origin: { longitude: 109.512, latitude: 18.252, basis: 'explicit_coordinates' } });
  });

  it('resolves a named unit against the platform ledger', async () => {
    const intent = parseWaterQuery('吉阳大队附近的消火栓');
    const result = await resolveWaterQueryOrigin(intent, { fetcher: unitFetch() });
    expect(result.ok).toBe(true);
    expect(result.ok && result.origin).toMatchObject({ longitude: 109.55, latitude: 18.26, basis: 'platform_unit' });
  });

  it('asks for clarification instead of substituting a default location', async () => {
    const intent = parseWaterQuery('附近有哪些水源');
    const result = await resolveWaterQueryOrigin(intent, { fetcher: unitFetch() });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.clarification).toContain('无法定位');
  });

  it('falls back to the current plan origin for a contextual reference', async () => {
    const plan = await createCompletePlan(new InMemoryPlanRepository(), 'INC-WATER-CONTEXT');
    const origin = planOrigin(plan);
    expect(origin).toMatchObject({ basis: 'current_plan' });
    const intent = parseWaterQuery('这个单位附近的水源');
    const result = await resolveWaterQueryOrigin(intent, { plan, fetcher: failingFetch() });
    expect(result.ok).toBe(true);
    expect(result.ok && result.origin.basis).toBe('current_plan');
  });

  it('does not answer with the plan origin when a named unit was not found', async () => {
    const plan = await createCompletePlan(new InMemoryPlanRepository(), 'INC-WATER-MISMATCH');
    const intent = parseWaterQuery('海棠湾国际购物中心2公里内的消火栓');
    const result = await resolveWaterQueryOrigin(intent, { plan, fetcher: unitFetch() });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.clarification).toContain('没有匹配到');
  });
});
