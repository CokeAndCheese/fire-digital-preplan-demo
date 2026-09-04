import 'server-only';

/**
 * 预案模板选取。
 *
 * 知识库「消防预案库」（应用 ID 2086971423845441537，36 个文件）中的模板 PDF：
 *   站级预案模版.pdf
 *   大队级预案模板.pdf
 *   支队级预案模版.pdf
 *   总队级高层建筑火灾跨区域灭火救援预案模版.pdf
 *   总队级地下建筑火灾跨区域灭火救援预案模版.pdf
 *   总队级大型城市商业综合体火灾跨区域灭火救援预案模版.pdf
 *
 * 这里存在一层此前完全缺失的映射：
 * - 模板按**编制机构层级**分（站级/大队级/支队级/总队级）——决定谁编制、调多少力量、章节多少
 * - 本地按**火灾响应等级**分（Ⅰ–Ⅴ级）——决定火情有多严重
 *
 * 两者不是同一维度，不能直接等同。但存在业务上的对应关系：响应等级越高，
 * 需要的指挥层级越高。本模块把这层对应显式化，并且**恒不自动定稿**——
 * 层级选取影响力量调派规模，必须由指挥员确认。
 *
 * 总队级模板还按建筑类型细分（高层/地下/商业综合体），需要建筑类型二次匹配。
 */

export type PlanTemplateTier = 'station' | 'battalion' | 'brigade' | 'headquarters';

export type ResponseLevelCode = 'I' | 'II' | 'III' | 'IV' | 'V';

export type BuildingCategory = 'high_rise' | 'underground' | 'commercial_complex' | 'other';

export type PlanTemplateDescriptor = {
  tier: PlanTemplateTier;
  tierLabel: string;
  /** 知识库中的文件名，检索时按此定位 */
  fileName: string;
  /** 该层级模板的章节数，用于校验检索到的内容是否完整 */
  expectedSectionCount: number;
  buildingCategory: BuildingCategory | null;
};

/** 知识库「消防预案库」应用 ID */
export const PLAN_TEMPLATE_KB_ID = '2086971423845441537';

const TIER_LABELS: Record<PlanTemplateTier, string> = {
  station: '站级',
  battalion: '大队级',
  brigade: '支队级',
  headquarters: '总队级',
};

/**
 * 章节数来自平台 fire-rescue-plan Skill 的模板规范：
 * 站级 6 章（单位概况/处置力量/社会联动/特别警示/安全事项/图纸附件），
 * 支队级 10 章（增加组织架构/专家库/通信方式/战勤保障）。
 * 大队级与总队级的章节数以支队级为下限——总队级为跨区域调派，不少于支队级。
 */
const TIER_SECTION_COUNTS: Record<PlanTemplateTier, number> = {
  station: 6,
  battalion: 8,
  brigade: 10,
  headquarters: 10,
};

const HEADQUARTERS_TEMPLATES: Record<Exclude<BuildingCategory, 'other'>, string> = {
  high_rise: '总队级高层建筑火灾跨区域灭火救援预案模版.pdf',
  underground: '总队级地下建筑火灾跨区域灭火救援预案模版.pdf',
  commercial_complex: '总队级大型城市商业综合体火灾跨区域灭火救援预案模版.pdf',
};

const TIER_TEMPLATES: Record<Exclude<PlanTemplateTier, 'headquarters'>, string> = {
  station: '站级预案模版.pdf',
  battalion: '大队级预案模板.pdf',
  brigade: '支队级预案模版.pdf',
};

/**
 * 响应等级 → 编制机构层级。
 *
 * Ⅰ级最重（规则分值 ≥16），Ⅴ级最轻。对应关系：
 *   Ⅰ 级 → 总队级（跨区域增援）
 *   Ⅱ 级 → 支队级
 *   Ⅲ 级 → 大队级
 *   Ⅳ/Ⅴ 级 → 站级
 *
 * 这是业务惯例的映射，不是规范强制条文。因此返回值一律标记为待确认，
 * 由指挥员核定后方可定稿——层级直接决定力量调派规模。
 */
export function tierForResponseLevel(level: ResponseLevelCode | null): PlanTemplateTier | null {
  switch (level) {
    case 'I': return 'headquarters';
    case 'II': return 'brigade';
    case 'III': return 'battalion';
    case 'IV':
    case 'V': return 'station';
    default: return null;
  }
}

/**
 * 建筑类型归类。用于总队级模板的二次匹配。
 *
 * 判定依据仅为文本关键词，不足以区分"高层"与"超高层"等规范细分，
 * 因此归类结果同样需人工确认。
 */
export function categorizeBuilding(
  sceneType: string | null,
  floorsAbove: number | null,
  isUnderground: boolean,
): BuildingCategory {
  const text = (sceneType ?? '').trim();
  if (isUnderground || /地下|人防|地铁|隧道/.test(text)) return 'underground';
  if (/综合体|商业综合体|购物中心|万达|广场/.test(text)) return 'commercial_complex';
  // 《建筑设计防火规范》以 24 m 划分高层，此处无高度数据时以 10 层近似
  if (/高层|超高层/.test(text) || (floorsAbove !== null && floorsAbove >= 10)) return 'high_rise';
  return 'other';
}

export function resolvePlanTemplate(
  tier: PlanTemplateTier,
  buildingCategory: BuildingCategory,
): PlanTemplateDescriptor {
  if (tier === 'headquarters') {
    const category = buildingCategory === 'other' ? 'high_rise' : buildingCategory;
    return {
      tier,
      tierLabel: TIER_LABELS[tier],
      fileName: HEADQUARTERS_TEMPLATES[category],
      expectedSectionCount: TIER_SECTION_COUNTS[tier],
      buildingCategory: category,
    };
  }
  return {
    tier,
    tierLabel: TIER_LABELS[tier],
    fileName: TIER_TEMPLATES[tier],
    expectedSectionCount: TIER_SECTION_COUNTS[tier],
    buildingCategory: null,
  };
}

export type PlanTemplateSelection = {
  /** 恒为 pending_manual_review：层级决定调派规模，须指挥员核定 */
  status: 'pending_manual_review' | 'unresolved';
  template: PlanTemplateDescriptor | null;
  knowledgeBaseId: string;
  /** 供 file_search 使用的检索线索 */
  retrievalHints: string[];
  /** 选取依据，写入预案便于追溯 */
  rationale: string[];
  warnings: string[];
};

export type PlanTemplateSelectionInput = {
  responseLevel: ResponseLevelCode | null;
  /** 指挥员显式指定的层级，优先于响应等级推导 */
  requestedTier?: PlanTemplateTier | null;
  sceneType?: string | null;
  floorsAbove?: number | null;
  isUnderground?: boolean;
};

/**
 * 选取预案模板。
 *
 * 输出恒不定稿——响应等级到机构层级是业务惯例映射而非规范条文，
 * 且总队级模板还需建筑类型二次匹配，两处判断都可能与现场判定不一致。
 */
export function selectPlanTemplate(input: PlanTemplateSelectionInput): PlanTemplateSelection {
  const rationale: string[] = [];
  const warnings: string[] = [];

  const derivedTier = tierForResponseLevel(input.responseLevel);
  const tier = input.requestedTier ?? derivedTier;

  if (input.requestedTier) {
    rationale.push(`按指挥员指定层级选取：${TIER_LABELS[input.requestedTier]}。`);
    if (derivedTier && derivedTier !== input.requestedTier) {
      warnings.push(
        `指定层级为${TIER_LABELS[input.requestedTier]}，而 ${input.responseLevel} 级响应按惯例对应`
        + `${TIER_LABELS[derivedTier]}；层级差异会改变力量调派规模，请确认。`,
      );
    }
  } else if (derivedTier) {
    rationale.push(`按 ${input.responseLevel} 级响应建议推导层级：${TIER_LABELS[derivedTier]}（业务惯例映射，非规范强制条文）。`);
  }

  if (!tier) {
    warnings.push('响应等级未确定且未指定编制层级，无法选取模板；请先完成等级判定或直接指定层级。');
    return {
      status: 'unresolved',
      template: null,
      knowledgeBaseId: PLAN_TEMPLATE_KB_ID,
      retrievalHints: [],
      rationale,
      warnings,
    };
  }

  const category = categorizeBuilding(
    input.sceneType ?? null,
    input.floorsAbove ?? null,
    input.isUnderground === true,
  );
  const template = resolvePlanTemplate(tier, category);

  if (tier === 'headquarters') {
    rationale.push(`总队级模板按建筑类型二次匹配：${category}。`);
    if (category === 'other') {
      warnings.push('建筑类型无法归类，总队级模板暂按高层建筑选取；请确认是否应改用地下建筑或商业综合体模板。');
    }
  }
  warnings.push('模板层级依据业务惯例推导，直接影响力量调派规模与章节完整性，须由指挥员核定后定稿。');

  return {
    status: 'pending_manual_review',
    template,
    knowledgeBaseId: PLAN_TEMPLATE_KB_ID,
    retrievalHints: [template.fileName, `${template.tierLabel}预案`, `${template.tierLabel}预案模板章节`],
    rationale,
    warnings,
  };
}
