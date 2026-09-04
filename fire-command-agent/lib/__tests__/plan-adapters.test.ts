import { describe, expect, it } from 'vitest';
import { planChatSummary } from '../plan-adapters';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';

describe('public plan summary', () => {
  it('keeps a saved draft conclusion visible when a downstream adapter has technical failures', async () => {
    const plan = await createCompletePlan(new InMemoryPlanRepository());
    const summary = planChatSummary({
      ...plan,
      missingItems: ['响应等级缺少可核验的 Skill/MCP 回执'],
      failedItems: [{ section: '处置策略', reason: 'fetch failed' }],
    });

    expect(summary).toContain('已生成预案草稿');
    expect(summary).toContain('处置策略：未返回可核验回执');
    expect(summary).not.toContain('fetch failed');
  });

  it('preserves user-facing scenario review reasons while hiding raw machine codes', async () => {
    const plan = await createCompletePlan(new InMemoryPlanRepository());
    const summary = planChatSummary({
      ...plan,
      missingItems: [],
      failedItems: [{ section: '空间定位', reason: '场景/对象 ID 待人工复核：scene_id_missing、floor_missing' }],
    });

    expect(summary).toContain('场景/对象 ID 待人工复核');
    expect(summary).not.toContain('scene_id_missing');
  });
});
