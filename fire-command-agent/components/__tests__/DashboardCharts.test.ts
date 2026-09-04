import { describe, expect, it } from 'vitest';
import {
  lifecycleActiveIndex,
  lifecycleNodeState,
  parseDistrict,
  parsePersonnel,
  stepCellState,
  waterBarState,
} from '../DashboardCharts';

describe('parsePersonnel', () => {
  it('从 "人员23人" 提取数字', () => {
    expect(parsePersonnel('人员23人')).toBe(23);
  });

  it('从纯数字文本提取', () => {
    expect(parsePersonnel('39人')).toBe(39);
  });

  it('无数字或缺省时返回 0', () => {
    expect(parsePersonnel('人员待核实')).toBe(0);
    expect(parsePersonnel(undefined)).toBe(0);
    expect(parsePersonnel('')).toBe(0);
  });
});

describe('parseDistrict', () => {
  it('识别三亚四个行政辖区', () => {
    expect(parseDistrict('三亚市天涯区凤凰路12号')).toBe('天涯区');
    expect(parseDistrict('三亚市吉阳区迎宾路')).toBe('吉阳区');
    expect(parseDistrict('三亚市海棠区海棠北路')).toBe('海棠区');
    expect(parseDistrict('三亚市崖州区水南大道')).toBe('崖州区');
  });

  it('识别育才生态区', () => {
    expect(parseDistrict('三亚市育才生态区那受村')).toBe('育才生态区');
  });

  it('无法匹配或缺省地址归入"其他"', () => {
    expect(parseDistrict('海南省海口市美兰区')).toBe('其他');
    expect(parseDistrict(undefined)).toBe('其他');
    expect(parseDistrict('')).toBe('其他');
  });
});

describe('stepCellState', () => {
  it('失败优先于完成', () => {
    const completed = new Set(['s3']);
    const failed = new Set(['s3']);
    expect(stepCellState('s3', completed, failed)).toBe('bad');
  });

  it('已回执为 ok，未回执为 idle', () => {
    const completed = new Set(['s1']);
    const failed = new Set<string>();
    expect(stepCellState('s1', completed, failed)).toBe('ok');
    expect(stepCellState('s2', completed, failed)).toBe('idle');
  });
});

describe('waterBarState', () => {
  it('按台账 status 归一化后的可用性配色', () => {
    expect(waterBarState('available')).toBe('ok');
    expect(waterBarState('unavailable')).toBe('bad');
  });

  it('台账空值/未知一律按未核实处理，不当成可用', () => {
    expect(waterBarState('unknown')).toBe('warn');
    expect(waterBarState('')).toBe('warn');
    expect(waterBarState(undefined)).toBe('warn');
  });
});

describe('lifecycleNodeState', () => {
  it('已过的节点 done、当前节点 active、后续节点 idle', () => {
    const active = lifecycleActiveIndex('approved');
    expect(active).toBeGreaterThan(0);
    expect(lifecycleNodeState(0, active, false)).toBe('done');
    expect(lifecycleNodeState(active, active, false)).toBe('active');
    expect(lifecycleNodeState(active + 1, active, false)).toBe('idle');
  });

  it('failed 整链标红，不落在某一节点上', () => {
    expect(lifecycleNodeState(0, -1, true)).toBe('bad');
    expect(lifecycleNodeState(4, 2, true)).toBe('bad');
  });

  it('状态不在主链上时全部 idle，不猜测进度', () => {
    expect(lifecycleActiveIndex('not_a_status')).toBe(-1);
    expect(lifecycleNodeState(0, -1, false)).toBe('idle');
    expect(lifecycleNodeState(6, -1, false)).toBe('idle');
  });

  it('归档为主链末节点', () => {
    expect(lifecycleActiveIndex('archived')).toBe(6);
    expect(lifecycleNodeState(6, 6, false)).toBe('active');
  });
});
