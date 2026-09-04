import { describe, expect, it } from 'vitest';
import { generateRescuePlan, riskLevelFrom, signPlan } from '../fire-rescue-plan';

const baseSituation = {
  floorId: 'f3',
  floorName: '3F',
  roomId: 'r301',
  roomName: '301会议室',
  fireLocation: '301会议室西南角电气柜',
  trappedCount: 8,
  burnArea: 45,
};

describe('fire-rescue-plan', () => {
  it('根据燃烧面积和被困人数判断风险等级', () => {
    expect(riskLevelFrom(150, 0)).toBe('urgent');
    expect(riskLevelFrom(0, 25)).toBe('urgent');
    expect(riskLevelFrom(60, 5)).toBe('high');
    expect(riskLevelFrom(25, 2)).toBe('medium');
    expect(riskLevelFrom(5, 0)).toBe('low');
  });

  it('生成的预案包含完整字段', () => {
    const plan = generateRescuePlan(baseSituation, '五矿国际广场-新');
    expect(plan.title).toContain('301会议室');
    expect(plan.riskLevel).toBe('medium');
    expect(plan.deployments.length).toBeGreaterThan(0);
    expect(plan.priorities).toContain('人员搜救');
    expect(plan.fireStrategy).toContain('断电');
    expect(plan.timeline.length).toBeGreaterThan(0);
    expect(plan.signedAt).toBeUndefined();
  });

  it('签发后增加签发信息', () => {
    const plan = generateRescuePlan(baseSituation, '五矿国际广场-新');
    const signed = signPlan(plan, '张指挥');
    expect(signed.signedBy).toBe('张指挥');
    expect(signed.signedAt).toBeDefined();
  });
});
