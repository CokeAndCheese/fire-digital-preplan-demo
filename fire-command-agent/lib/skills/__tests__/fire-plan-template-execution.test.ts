import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeSkill } from '../server';
import { findSkill } from '../catalog';

const savedUrl = process.env.PLAN_TEMPLATE_KB_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (savedUrl === undefined) delete process.env.PLAN_TEMPLATE_KB_URL;
  else process.env.PLAN_TEMPLATE_KB_URL = savedUrl;
});

describe('plan-template skill execution', () => {
  it('registers both actions in the catalog', () => {
    const skill = findSkill('plan-template');
    expect(skill?.role).toBe('core');
    expect(skill?.actions.map((action) => action.id)).toEqual([
      'select_plan_template', 'retrieve_template_sections',
    ]);
    // 模板选取不得要求审批：它是生成预案的前置步骤，
    // 卡在审批上会让整条编排流程停住。层级本身仍标记待核定。
    expect(skill?.actions.every((action) => action.requiresApproval === false)).toBe(true);
  });

  it('maps a II-level response to the brigade tier without touching the knowledge base', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await executeSkill({
      skillId: 'plan-template', actionId: 'select_plan_template',
      input: { responseLevel: 'II', sceneType: '高层公共建筑', floorsAbove: 28 },
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'pending_manual_review', tier: 'brigade', fileName: '支队级预案模版.pdf', expectedSectionCount: 10,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('picks the underground headquarters template for a I-level underground fire', async () => {
    const result = await executeSkill({
      skillId: 'plan-template', actionId: 'select_plan_template',
      input: { responseLevel: 'I', sceneType: '地下车库', isUnderground: true },
    });
    expect(result.data).toMatchObject({
      tier: 'headquarters',
      buildingCategory: 'underground',
      fileName: '总队级地下建筑火灾跨区域灭火救援预案模版.pdf',
    });
  });

  it('fails when neither a response level nor an explicit tier is given', async () => {
    const result = await executeSkill({ skillId: 'plan-template', actionId: 'select_plan_template', input: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('PLAN_TEMPLATE_TIER_UNRESOLVED');
    expect(result.data).toMatchObject({ status: 'unresolved', tier: null });
  });

  it('warns when the requested tier contradicts the level-derived tier', async () => {
    const result = await executeSkill({
      skillId: 'plan-template', actionId: 'select_plan_template',
      input: { responseLevel: 'V', requestedTier: 'headquarters' },
    });
    expect(result.data).toMatchObject({ tier: 'headquarters' });
    expect((result.data?.warnings as string[]).join()).toContain('层级差异会改变力量调派规模');
  });

  it('stays ok when the knowledge base is unreachable so plan generation is not blocked', async () => {
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('KB_DOWN'));

    const result = await executeSkill({
      skillId: 'plan-template', actionId: 'retrieve_template_sections',
      input: { responseLevel: 'III' },
    });
    // Skill 不因知识库故障而失败：层级映射已产出可用结果，
    // 章节缺口通过 sectionRetrieval 与 warnings 呈现。
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('simulation');
    expect(result.data?.tier).toBe('battalion');
    expect(result.data?.sections).toEqual([]);
    expect(result.data?.sectionRetrieval).toMatchObject({ status: 'unavailable', failureReason: 'KB_DOWN' });
  });

  it('returns retrieved chapters and flags a count mismatch', async () => {
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sections: ['单位概况', '处置力量'] }), { status: 200 }),
    );

    const result = await executeSkill({
      skillId: 'plan-template', actionId: 'retrieve_template_sections',
      input: { responseLevel: 'IV' },
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('platform');
    expect(result.data?.tier).toBe('station');
    expect(result.data?.sections).toHaveLength(2);
    expect(result.data?.sectionRetrieval).toMatchObject({ status: 'retrieved', sectionCountMatches: false });
    expect(result.summary).toContain('不一致');
  });
});
