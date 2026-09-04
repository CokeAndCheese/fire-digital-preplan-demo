import { describe, expect, it } from 'vitest';
import { inferAction } from '../infer-action';
import { SCENARIO_REGISTRY } from '@/lib/scenario-registry';

describe('inferAction', () => {
  it('does not fabricate a default scene ID for an explicit action', () => {
    const action = inferAction('[skill:scene-control action:locate_space]');

    expect(action?.input).not.toHaveProperty('sceneId');
  });

  it('uses a scene ID only when the caller explicitly injects the registered value', () => {
    const action = inferAction('[skill:scene-control action:locate_space]', SCENARIO_REGISTRY.sceneId);

    expect(action?.input?.sceneId).toBe(SCENARIO_REGISTRY.sceneId);
  });

  it('extracts real fire context for a rescue plan', () => {
    expect(inferAction('请为五矿国际广场B2层Space_451的电气火灾生成预案，2人被困，过火面积35平方米')).toEqual({
      skillId: 'rescue-plan',
      actionId: 'generate_plan',
      input: {
        building: '五矿国际广场',
        floor: 'B2',
        room: 'Space_451',
        fireType: '电气火灾',
        trappedCount: 2,
        burnArea: 35,
      },
    });
  });

  it('normalizes Chinese floor and trapped-person numbers', () => {
    expect(inferAction('在五矿国际广场地下二层808室开展燃气火灾推演，被困三人，面积12.5平米')).toMatchObject({
      skillId: 'scene-control',
      actionId: 'start_simulation',
      input: {
        floor: 'B2',
        room: '808',
        fireType: '燃气火灾',
        trappedCount: 3,
        burnArea: 12.5,
      },
    });
  });

  it('routes historical plan searches without generating a new plan', () => {
    expect(inferAction('查询五矿国际广场历史预案')).toEqual({
      skillId: 'rescue-plan',
      actionId: 'query_plan',
      input: { building: '五矿国际广场', limit: 5 },
    });
  });

  it('routes a competition closed-loop request to the orchestration skill', () => {
    expect(inferAction('为五矿国际广场8层电气火灾准备完整比赛闭环，2人被困，面积35平方米')).toEqual({
      skillId: 'competition-orchestrator',
      actionId: 'prepare_competition_run',
      input: {
        building: '五矿国际广场',
        floor: '8F',
        fireType: '电气火灾',
        trappedCount: 2,
        burnArea: 35,
      },
    });
  });

  it('extracts a room target for an approved locate command', () => {
    expect(inferAction('定位并高亮B2层Space_451空间')).toEqual({
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: { floor: 'B2', room: 'Space_451' },
    });
  });

  it('keeps a bare Wukuang fire report in the local approved scene workflow', () => {
    expect(inferAction('五矿国际广场8层电气火灾，2人被困')).toEqual({
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: { floor: '8F', fireType: '电气火灾', trappedCount: 2 },
    });
  });

  it('parses a Chinese-numeral floor so a spoken fire report can drive the closed loop', () => {
    // Regression: "五楼" is Chinese, not arabic, so extractFloor must map it to 5F;
    // otherwise inferAction returns null and the chat reports "未识别到闭环动作".
    expect(inferAction('五楼着火，4人被困')).toMatchObject({
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: { floor: '5F', trappedCount: 4 },
    });
  });

  it('normalizes an above-ground Chinese floor to an integer level', () => {
    expect(inferAction('五矿国际广场十二楼燃气火灾，被困三人')).toMatchObject({
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: { floor: '12F', fireType: '燃气火灾', trappedCount: 3 },
    });
  });

  it('keeps a floor-only report visual and carries the on-site headcount', () => {
    expect(inferAction('定位五矿国际广场8层，现场有3人')).toEqual({
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: { floor: '8F' },
    });
  });

  it('keeps quick actions executable while allowing prompt overrides', () => {
    expect(inferAction('请执行“生成预案草案”。[skill:rescue-plan action:generate_plan]')).toMatchObject({
      skillId: 'rescue-plan',
      actionId: 'generate_plan',
      input: { building: '五矿国际广场', floor: '8F', room: '808' },
    });
  });

  it('keeps the complete Sanya district in a nearby-resource query', () => {
    expect(inferAction('查询三亚市吉阳区10公里内可用消防力量')).toEqual({
      skillId: 'fire-resource',
      actionId: 'query_nearby_units',
      input: { address: '三亚市吉阳区', radiusKm: 10 },
    });
  });

  it('routes response-level assessment to the dedicated core skill', () => {
    expect(inferAction('研判五矿国际广场8层电气火灾的Ⅰ-Ⅴ级响应，被困2人，过火面积35平方米')).toMatchObject({
      skillId: 'response-level',
      actionId: 'assess_response_level',
      input: {
        incident: {
          incidentId: expect.stringMatching(/^INTAKE-/),
          building: expect.objectContaining({ value: '五矿国际广场', status: 'reported', confidence: 0.55 }),
          floor: expect.objectContaining({ value: '8F', status: 'reported' }),
          venueType: expect.objectContaining({ value: null, status: 'missing', confidence: 0 }),
          fireMaterialOrType: expect.objectContaining({ value: '电气火灾', status: 'reported' }),
          burnAreaSqm: expect.objectContaining({ value: 35, status: 'reported' }),
          trappedCount: expect.objectContaining({ value: 2, status: 'reported' }),
          casualtyCount: expect.objectContaining({ value: null, status: 'missing' }),
        },
      },
    });
  });

  it('routes the quick-action generate prompt to generate_plan, not publish_plan', () => {
    // Regression: "生成可人工复核的结构化预案" previously matched the
    // publish/submit-review pattern (because "复核" appears before "预案"),
    // routing to publish_plan without a planId and failing with PLAN_NOT_FOUND.
    expect(inferAction('为五矿国际广场8层808房间电气火灾生成可人工复核的结构化预案JSON。')).toMatchObject({
      skillId: 'rescue-plan',
      actionId: 'generate_plan',
    });
  });

  it('removes directive prefixes before storing the building name', () => {
    expect(inferAction('请对五矿国际广场8层电气火灾、2人被困进行Ⅰ-Ⅴ级响应研判')).toMatchObject({
      skillId: 'response-level',
      actionId: 'assess_response_level',
      input: {
        incident: {
          building: expect.objectContaining({ value: '五矿国际广场' }),
          floor: expect.objectContaining({ value: '8F' }),
          trappedCount: expect.objectContaining({ value: 2 }),
        },
      },
    });
  });

});
