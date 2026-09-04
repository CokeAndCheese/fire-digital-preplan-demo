import 'server-only';
import { PLAN_TEMPLATE_KB_ID, type PlanTemplateDescriptor } from './fire-plan-template';

/**
 * 消防预案库检索。
 *
 * 模板 PDF 存放在知识库应用 2086971423845441537。本模块只做一件事：
 * 把某个层级模板的**章节结构**取回来，用于校验预案是否章节齐全。
 *
 * 三条硬性约束——
 *
 * 1. **不推测章节。** 知识库不可达时回传 `unavailable` 并说明原因，
 *    绝不用 `TIER_SECTION_COUNTS` 里的数字去编造同等数量的章节标题。
 *    编造出来的章节会让复核员以为模板已核对过，这比没有章节更危险。
 *
 * 2. **章节数不符即告警。** 检索到的章节数与规范章节数不一致时，
 *    照实回传检索结果并记入 warnings，不裁剪也不补齐——
 *    差异本身是需要指挥员判断的信息。
 *
 * 3. **恒不定稿。** 无论检索成功与否，模板层级都要人工核定，
 *    因为层级由响应等级按业务惯例推导而来，直接决定力量调派规模。
 */

export type TemplateSection = {
  /** 章节序号，从 1 起 */
  ordinal: number;
  title: string;
};

export type TemplateRetrievalStatus = 'retrieved' | 'unavailable' | 'not_configured';

export type TemplateSectionRetrieval = {
  status: TemplateRetrievalStatus;
  knowledgeBaseId: string;
  fileName: string | null;
  sections: TemplateSection[];
  /** 规范章节数，来自模板描述符 */
  expectedSectionCount: number | null;
  /** 检索到的章节数与规范章节数是否一致 */
  sectionCountMatches: boolean | null;
  warnings: string[];
  failureReason: string | null;
};

/** 知识库检索端点，未配置则跳过检索而不是报错 */
function knowledgeBaseEndpoint(): string {
  return (process.env.PLAN_TEMPLATE_KB_URL || '').trim().replace(/\/+$/, '');
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 解析知识库返回的章节清单。
 *
 * 容忍两种形状：字符串数组，或带 title/heading 字段的对象数组。
 * 解析不出标题的条目直接丢弃——宁可少一章并触发数量告警，
 * 也不要把空标题混进章节表。
 */
export function parseTemplateSections(payload: unknown): TemplateSection[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { sections?: unknown } | null)?.sections)
      ? (payload as { sections: unknown[] }).sections
      : Array.isArray((payload as { data?: { sections?: unknown } } | null)?.data?.sections)
        ? ((payload as { data: { sections: unknown[] } }).data.sections)
        : [];

  const sections: TemplateSection[] = [];
  for (const entry of raw) {
    const title = typeof entry === 'string'
      ? textValue(entry)
      : textValue((entry as Record<string, unknown> | null)?.title)
        ?? textValue((entry as Record<string, unknown> | null)?.heading)
        ?? textValue((entry as Record<string, unknown> | null)?.name);
    if (!title) continue;
    sections.push({ ordinal: sections.length + 1, title });
  }
  return sections;
}

/**
 * 构造未检索到章节时的结果。
 *
 * 章节表留空是刻意的：调用方看到空表就知道没核对过模板，
 * 而看到一份编造的章节表则会误以为已核对。
 */
function withoutSections(
  status: Exclude<TemplateRetrievalStatus, 'retrieved'>,
  template: PlanTemplateDescriptor | null,
  failureReason: string,
  warnings: string[],
): TemplateSectionRetrieval {
  return {
    status,
    knowledgeBaseId: PLAN_TEMPLATE_KB_ID,
    fileName: template?.fileName ?? null,
    sections: [],
    expectedSectionCount: template?.expectedSectionCount ?? null,
    sectionCountMatches: null,
    warnings,
    failureReason,
  };
}

/**
 * 检索某层级模板的章节结构。
 *
 * 端点未配置时返回 `not_configured`——这是部署状态而非故障，
 * 预案仍可凭映射结果标注参照层级，只是少了章节核对。
 */
export async function retrieveTemplateSections(
  template: PlanTemplateDescriptor | null,
  options: { timeoutMs?: number } = {},
): Promise<TemplateSectionRetrieval> {
  if (!template) {
    return withoutSections('not_configured', null, '模板层级未确定，无从检索章节。', []);
  }

  const endpoint = knowledgeBaseEndpoint();
  if (!endpoint) {
    return withoutSections(
      'not_configured',
      template,
      '未配置 PLAN_TEMPLATE_KB_URL，跳过章节检索。',
      [`模板章节未与《${template.fileName}》核对；预案章节完整性需人工比对纸质模版。`],
    );
  }

  try {
    const url = new URL(`${endpoint}/v1/knowledge-base/sections`);
    url.searchParams.set('applicationId', PLAN_TEMPLATE_KB_ID);
    url.searchParams.set('fileName', template.fileName);
    const headers = new Headers({ Accept: 'application/json' });
    const token = (process.env.PLAN_TEMPLATE_KB_TOKEN || '').trim();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: 'no-store',
    });
    if (!response.ok) {
      return withoutSections(
        'unavailable',
        template,
        `知识库返回 HTTP ${response.status}。`,
        [`《${template.fileName}》章节检索失败；不得以其他层级模板替代。`],
      );
    }

    const payload = await response.json().catch(() => null);
    const sections = parseTemplateSections(payload);
    if (sections.length === 0) {
      return withoutSections(
        'unavailable',
        template,
        '知识库未返回可解析的章节标题。',
        [`《${template.fileName}》未取到章节标题；章节完整性需人工比对。`],
      );
    }

    const warnings: string[] = [];
    const matches = sections.length === template.expectedSectionCount;
    if (!matches) {
      warnings.push(
        `《${template.fileName}》检索到 ${sections.length} 个章节，`
        + `而${template.tierLabel}模板规范为 ${template.expectedSectionCount} 章；`
        + '差异未做裁剪或补齐，请人工核对模板版本。',
      );
    }
    return {
      status: 'retrieved',
      knowledgeBaseId: PLAN_TEMPLATE_KB_ID,
      fileName: template.fileName,
      sections,
      expectedSectionCount: template.expectedSectionCount,
      sectionCountMatches: matches,
      warnings,
      failureReason: null,
    };
  } catch (error) {
    return withoutSections(
      'unavailable',
      template,
      error instanceof Error ? error.message : 'KB_FETCH_FAILED',
      [`《${template.fileName}》章节检索异常；章节完整性未核验。`],
    );
  }
}
