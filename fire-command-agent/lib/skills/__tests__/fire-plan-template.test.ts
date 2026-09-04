import { describe, expect, it } from 'vitest';
import {
  categorizeBuilding,
  PLAN_TEMPLATE_KB_ID,
  resolvePlanTemplate,
  selectPlanTemplate,
  tierForResponseLevel,
} from '../fire-plan-template';

describe('response level to organisational tier', () => {
  it('maps I to headquarters and IV/V to station', () => {
    expect(tierForResponseLevel('I')).toBe('headquarters');
    expect(tierForResponseLevel('II')).toBe('brigade');
    expect(tierForResponseLevel('III')).toBe('battalion');
    expect(tierForResponseLevel('IV')).toBe('station');
    expect(tierForResponseLevel('V')).toBe('station');
  });

  it('returns null when the response level is undetermined', () => {
    expect(tierForResponseLevel(null)).toBeNull();
  });
});

describe('building categorisation', () => {
  it('detects underground regardless of scene text', () => {
    expect(categorizeBuilding('地下车库', null, false)).toBe('underground');
    expect(categorizeBuilding('办公楼', 20, true)).toBe('underground');
  });

  it('detects commercial complexes before falling back to high rise', () => {
    expect(categorizeBuilding('大型城市商业综合体', 30, false)).toBe('commercial_complex');
  });

  it('treats 10 floors or more as high rise when no scene keyword matches', () => {
    expect(categorizeBuilding('办公建筑', 22, false)).toBe('high_rise');
    expect(categorizeBuilding('办公建筑', 4, false)).toBe('other');
  });
});

describe('template resolution', () => {
  it('picks the tier-specific file for non-headquarters tiers', () => {
    expect(resolvePlanTemplate('station', 'other')).toMatchObject({
      fileName: '站级预案模版.pdf', expectedSectionCount: 6, buildingCategory: null,
    });
    expect(resolvePlanTemplate('brigade', 'high_rise')).toMatchObject({
      fileName: '支队级预案模版.pdf', expectedSectionCount: 10,
    });
  });

  it('picks the building-specific file for headquarters tier', () => {
    expect(resolvePlanTemplate('headquarters', 'underground').fileName)
      .toBe('总队级地下建筑火灾跨区域灭火救援预案模版.pdf');
    expect(resolvePlanTemplate('headquarters', 'commercial_complex').fileName)
      .toBe('总队级大型城市商业综合体火灾跨区域灭火救援预案模版.pdf');
  });
});

describe('template selection', () => {
  it('never auto-finalises: tier drives dispatch scale', () => {
    const selection = selectPlanTemplate({ responseLevel: 'II', sceneType: '高层公共建筑', floorsAbove: 22 });
    expect(selection.status).toBe('pending_manual_review');
    expect(selection.warnings.some((w) => w.includes('须由指挥员核定'))).toBe(true);
  });

  it('emits retrieval hints pointing at the knowledge base file', () => {
    const selection = selectPlanTemplate({ responseLevel: 'II' });
    expect(selection.knowledgeBaseId).toBe(PLAN_TEMPLATE_KB_ID);
    expect(selection.retrievalHints).toContain('支队级预案模版.pdf');
  });

  it('records the mapping as convention rather than regulation', () => {
    const selection = selectPlanTemplate({ responseLevel: 'III' });
    expect(selection.rationale.some((r) => r.includes('业务惯例映射，非规范强制条文'))).toBe(true);
  });

  it('flags a conflict when the requested tier differs from the derived one', () => {
    const selection = selectPlanTemplate({ responseLevel: 'V', requestedTier: 'headquarters' });
    expect(selection.template?.tier).toBe('headquarters');
    expect(selection.warnings.some((w) => w.includes('层级差异会改变力量调派规模'))).toBe(true);
  });

  it('stays unresolved when neither level nor tier is known', () => {
    const selection = selectPlanTemplate({ responseLevel: null });
    expect(selection.status).toBe('unresolved');
    expect(selection.template).toBeNull();
    expect(selection.retrievalHints).toEqual([]);
  });

  it('warns when a headquarters plan cannot categorise the building', () => {
    const selection = selectPlanTemplate({ responseLevel: 'I', sceneType: '厂房', floorsAbove: 3 });
    expect(selection.template?.fileName).toContain('高层建筑');
    expect(selection.warnings.some((w) => w.includes('建筑类型无法归类'))).toBe(true);
  });
});
