import { describe, expect, it } from 'vitest';
import { bindWaterSource, PlanLifecycleError, recordWaterSourceQuery } from '../plan-lifecycle';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';

const FIXTURE_SOURCE_ID = 'hyd-fixture-1';

async function planWithWaterSources() {
  const repository = new InMemoryPlanRepository();
  const plan = await createCompletePlan(repository, `INC-WATER-${crypto.randomUUID()}`);
  expect(plan.routeWater?.waterSources.map((entry) => entry.id)).toContain(FIXTURE_SOURCE_ID);
  return { repository, plan };
}

describe('dialogue water source write-back', () => {
  it('assigns a primary water source and records a manual confirmation', async () => {
    const { repository, plan } = await planWithWaterSources();
    const bound = await bindWaterSource(plan.planId, { sourceId: FIXTURE_SOURCE_ID, role: 'primary', revision: plan.revision }, repository);
    const entry = bound.routeWater?.waterSources.find((item) => item.id === FIXTURE_SOURCE_ID);

    expect(entry).toMatchObject({ role: 'primary', confirmation: 'manually_confirmed' });
    expect(entry?.verifiedAt).toBeTruthy();
    expect(bound.auditEvents.at(-1)).toMatchObject({ type: 'water_source_bound', actorType: 'human' });
    expect(bound.revision).toBe(plan.revision + 1);
  });

  it('clears the confirmation when a source is sent back for re-verification', async () => {
    const { repository, plan } = await planWithWaterSources();
    const bound = await bindWaterSource(plan.planId, { sourceId: FIXTURE_SOURCE_ID, role: 'primary', revision: plan.revision }, repository);
    const rechecked = await bindWaterSource(plan.planId, { sourceId: FIXTURE_SOURCE_ID, role: 'reverify', revision: bound.revision }, repository);
    const entry = rechecked.routeWater?.waterSources.find((item) => item.id === FIXTURE_SOURCE_ID);

    expect(entry).toMatchObject({ confirmation: 'unknown', verifiedAt: null });
    // reverify 不动主备指派：撤销指派是另一个动作。
    expect(entry?.role).toBe('primary');
  });

  it('refuses to bind a source that is not among the plan candidates', async () => {
    const { repository, plan } = await planWithWaterSources();
    await expect(bindWaterSource(plan.planId, { sourceId: 'hyd-not-in-plan', role: 'primary', revision: plan.revision }, repository))
      .rejects.toBeInstanceOf(PlanLifecycleError);
  });

  it('rejects a stale revision', async () => {
    const { repository, plan } = await planWithWaterSources();
    await bindWaterSource(plan.planId, { sourceId: FIXTURE_SOURCE_ID, role: 'backup', revision: plan.revision }, repository);
    await expect(bindWaterSource(plan.planId, { sourceId: FIXTURE_SOURCE_ID, role: 'primary', revision: plan.revision }, repository))
      .rejects.toMatchObject({ status: 409 });
  });

  it('keeps every dialogue query in the audit trail with its resolved conditions', async () => {
    const { repository, plan } = await planWithWaterSources();
    const updated = await recordWaterSourceQuery(plan.planId, {
      queryId: 'query-1', question: '这个单位附近2公里的消火栓', askedAt: '2026-08-26T02:00:00.000Z',
      resolved: {
        unitName: null, address: null, sceneId: 'scene-fixture', floor: null, room: null,
        longitude: 109.512, latitude: 18.252, radiusKm: 2, waterType: null, excludeUnavailable: false,
      },
      distanceBasis: 'straight_line', dataSource: 'https://platform.test/hydrants.json',
      resultCount: 3, status: 'ready', clarification: null, evidenceRefs: ['https://platform.test/hydrants.json'],
    }, {}, repository);

    expect(updated.waterQueries).toHaveLength(1);
    expect(updated.waterQueries?.[0]).toMatchObject({ queryId: 'query-1', distanceBasis: 'straight_line', resultCount: 3 });
    expect(updated.auditEvents.at(-1)).toMatchObject({ type: 'water_source_queried', source: 'api:agent-chat', requestId: 'query-1' });
  });
});
