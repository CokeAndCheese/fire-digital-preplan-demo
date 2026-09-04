import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FilePlanRepository, PlanConflictError, PlanStorageError } from '../plan-persistence';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fire-plan-persistence-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('file plan repository', () => {
  it('recovers persisted plans after a repository restart without changing their revision', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'plans.json');
    const source = new InMemoryPlanRepository();
    const plan = await createCompletePlan(source, 'INC-RESTART');
    const first = new FilePlanRepository(filePath);
    await first.append(plan);

    const restarted = new FilePlanRepository(filePath);
    const restored = await restarted.get(plan.planId);

    expect(restored).toMatchObject({ planId: plan.planId, revision: 1, version: 1 });
    expect((await restarted.latest('INC-RESTART'))?.planId).toBe(plan.planId);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 1, plans: [{ planId: plan.planId }] });
  });

  it('compacts browser-only scene trees from legacy persisted receipts', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'plans.json');
    const source = new InMemoryPlanRepository();
    const plan = await createCompletePlan(source, 'INC-LEGACY-SCENE-TREE');
    const sceneInvocation = plan.orchestration.find((entry) => entry.skillId === 'scene-control')!;
    const strategyInvocation = plan.orchestration.find((entry) => entry.skillId === 'rescue-plan')!;
    sceneInvocation.output = { data: { target: { id: 'floor-14', tree: { id: 'root' } } } };
    strategyInvocation.input.spatial = { data: { target: { id: 'floor-14', tree: { id: 'root' } } } };
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, plans: [plan] }), 'utf8');

    const repository = new FilePlanRepository(filePath);
    const restored = await repository.get(plan.planId);

    expect(JSON.stringify(restored)).not.toContain('"tree"');
    expect(restored?.orchestration).toHaveLength(plan.orchestration.length);
  });

  it('fails closed for corrupt stored data and does not start with an empty repository', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'plans.json');
    await writeFile(filePath, '{not-json', 'utf8');

    await expect(new FilePlanRepository(filePath).list()).rejects.toBeInstanceOf(PlanStorageError);
  });

  it('fails closed when persisted JSON omits required plan contract fields', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'plans.json');
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      plans: [{ schemaVersion: 'fire-rescue-plan/v1', planId: 'partial', version: 1, revision: 1, simulation: { mappings: [] }, evidenceRefs: [], auditEvents: [], orchestration: [] }],
    }), 'utf8');

    await expect(new FilePlanRepository(filePath).list()).rejects.toBeInstanceOf(PlanStorageError);
  });

  it('does not allow concurrent appends to silently overwrite one plan ID', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'plans.json');
    const source = new InMemoryPlanRepository();
    const plan = await createCompletePlan(source, 'INC-DUPLICATE');
    const repository = new FilePlanRepository(filePath);

    const results = await Promise.allSettled([repository.append(plan), repository.append(plan)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await repository.get(plan.planId))?.revision).toBe(1);
  });

  it('rejects stale revisions and preserves the recorded version', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'plans.json');
    const source = new InMemoryPlanRepository();
    const plan = await createCompletePlan(source, 'INC-CONFLICT');
    const repository = new FilePlanRepository(filePath);
    await repository.append(plan);
    const updated = await repository.update(plan.planId, 1, (next) => ({ ...next, revision: 2, updatedAt: '2026-08-21T01:00:00.000Z' }));

    await expect(repository.update(plan.planId, 1, (next) => ({ ...next, revision: 2 }))).rejects.toBeInstanceOf(PlanConflictError);
    expect((await repository.get(plan.planId))?.revision).toBe(updated.revision);
  });

  it('filters archived records by every 12.3 query dimension', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'plans.json');
    const source = new InMemoryPlanRepository();
    const wanted = await createCompletePlan(source, 'INC-QUERY-HIT');
    const other = await createCompletePlan(source, 'INC-QUERY-MISS');
    const repository = new FilePlanRepository(filePath);
    await repository.append(wanted);
    await repository.append(other);

    const ids = async (filters: Parameters<typeof repository.list>[2]) =>
      (await repository.list(undefined, 100, filters)).map((plan) => plan.planId);

    expect(await ids({ incidentId: 'INC-QUERY-HIT' })).toEqual([wanted.planId]);
    expect(await ids({ planId: wanted.planId })).toEqual([wanted.planId]);
    expect(await ids({ sceneId: 'scene-fixture', floor: '8F', version: 1 })).toHaveLength(2);
    expect(await ids({ sceneId: 'no-such-scene' })).toEqual([]);
    expect(await ids({ version: 9 })).toEqual([]);
    expect(await ids({ createdFrom: '2000-01-01T00:00:00.000Z' })).toHaveLength(2);
    expect(await ids({ createdTo: '2000-01-01T00:00:00.000Z' })).toEqual([]);
    expect(await repository.list('测试大厦', 100)).toHaveLength(2);
    expect(await repository.list('不存在的楼', 100)).toEqual([]);
  });

  it('rolls in-memory changes back when the atomic disk write fails', async () => {
    const directory = await temporaryDirectory();
    const blockedParent = path.join(directory, 'blocked-parent');
    const filePath = path.join(blockedParent, 'plans.json');
    const source = new InMemoryPlanRepository();
    const plan = await createCompletePlan(source, 'INC-ROLLBACK');
    const repository = new FilePlanRepository(filePath);
    await repository.append(plan);
    await rm(blockedParent, { recursive: true, force: true });
    await writeFile(blockedParent, 'not a directory', 'utf8');

    await expect(repository.update(plan.planId, 1, (next) => ({ ...next, revision: 2 }))).rejects.toBeInstanceOf(PlanStorageError);
    expect((await repository.get(plan.planId))?.revision).toBe(1);
  });
});
