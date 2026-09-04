import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isUnifiedFireRescuePlan, type UnifiedFireRescuePlan } from '../plan-contract';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';

/**
 * 已落库预案的契约兼容性。
 *
 * 主库 124 条预案是 11 步；两个 demo 库是 8 步（删减路线水源后的产物）。
 * 校验器此前写死 mappings.length === 8，把主库的真实数据全部判为非法；
 * 这组测试锁住"两种步数都能读出来"，防止再次收窄。
 *
 * 注意：主库 .data/fire-rescue-plans.json 是 551MB 的运行时存储，不应进入源码包，
 * 纯净环境会缺失。因此缺文件时用内存夹具（11 步 / 8 步）替代，保证纯净环境测试可跑，
 * 本地存在真实存储时仍优先校验真实数据。
 */
async function fileExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

async function loadPlans(fileName: string, fixture: () => Promise<UnifiedFireRescuePlan[]>): Promise<unknown[]> {
  const filePath = path.join(process.cwd(), '.data', fileName);
  if (await fileExists(filePath)) {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
    const container = parsed as Record<string, unknown>;
    const plans = container.plans;
    return Array.isArray(plans) ? plans : Object.values(container).find(Array.isArray) ?? [];
  }
  return fixture();
}

async function elevenStepFixture(): Promise<UnifiedFireRescuePlan[]> {
  return [await createCompletePlan(new InMemoryPlanRepository(), 'INC-COMPAT-11')];
}

async function eightStepFixture(): Promise<UnifiedFireRescuePlan[]> {
  const full = await createCompletePlan(new InMemoryPlanRepository(), 'INC-COMPAT-8');
  // 8 步精简版：保留前 8 条 mapping（删减路线/水源后的历史版本）。
  return [{ ...full, simulation: { ...full.simulation, mappings: full.simulation.mappings.slice(0, 8) } }];
}

describe('stored plan contract compatibility', () => {
  it('accepts every plan in the 11-step main store (or its fixture)', async () => {
    const plans = await loadPlans('fire-rescue-plans.json', elevenStepFixture);
    expect(plans.length).toBeGreaterThan(0);
    const rejected = plans.filter((plan) => !isUnifiedFireRescuePlan(plan));
    expect(rejected).toHaveLength(0);
  });

  it('confirms the main store really is 11 steps (or its fixture)', async () => {
    const plans = await loadPlans('fire-rescue-plans.json', elevenStepFixture) as Array<Record<string, unknown>>;
    const stepCounts = new Set(
      plans.map((plan) => {
        const simulation = plan.simulation as Record<string, unknown> | undefined;
        return Array.isArray(simulation?.mappings) ? simulation.mappings.length : 0;
      }),
    );
    expect([...stepCounts]).toEqual([11]);
  });

  it('still accepts the legacy 8-step demo stores (or their fixtures)', async () => {
    for (const fileName of ['fire-rescue-plans-demo.json', 'fire-rescue-plans-v2.json']) {
      const plans = await loadPlans(fileName, eightStepFixture);
      const rejected = plans.filter((plan) => !isUnifiedFireRescuePlan(plan));
      expect(rejected, `${fileName} 中有 ${rejected.length} 条预案被拒`).toHaveLength(0);
    }
  });
});
