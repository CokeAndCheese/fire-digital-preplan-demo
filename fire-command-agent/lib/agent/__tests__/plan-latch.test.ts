import { describe, expect, it } from 'vitest';
import { buildForwardedProps, latchPlanId } from '../plan-latch';

describe('latchPlanId', () => {
  it('回执带来新编号时更新', () => {
    expect(latchPlanId(null, 'PLAN-8686F0C4')).toBe('PLAN-8686F0C4');
    expect(latchPlanId('PLAN-A98D6AFD', 'PLAN-8686F0C4')).toBe('PLAN-8686F0C4');
  });

  it('新一轮回执尚未回来时保留上一份，这是水源查询答错对象的根因', () => {
    // createLiveExecution 重置后 planFromRun 返回 null，此刻若清空就退化成"取最新落库"
    expect(latchPlanId('PLAN-73E3B011', undefined)).toBe('PLAN-73E3B011');
    expect(latchPlanId('PLAN-73E3B011', null)).toBe('PLAN-73E3B011');
    expect(latchPlanId('PLAN-73E3B011', '')).toBe('PLAN-73E3B011');
  });

  it('从未产生过预案时保持空', () => {
    expect(latchPlanId(null, undefined)).toBeNull();
  });
});

describe('buildForwardedProps', () => {
  it('有锁存编号就带上 planId', () => {
    expect(buildForwardedProps('PLAN-8686F0C4')).toEqual({
      source: 'independent-fire-command-agent',
      language: 'zh-CN',
      planId: 'PLAN-8686F0C4',
    });
  });

  it('无预案时不出现 planId 字段，让服务端走既有回退', () => {
    const props = buildForwardedProps(null);
    expect(props).toEqual({ source: 'independent-fire-command-agent', language: 'zh-CN' });
    expect('planId' in props).toBe(false);
  });

  it('空串不占位', () => {
    expect('planId' in buildForwardedProps('')).toBe(false);
  });
});
