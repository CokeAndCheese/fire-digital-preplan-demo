import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTemplateSections, retrieveTemplateSections } from '../fire-plan-template-kb';
import { resolvePlanTemplate } from '../fire-plan-template';

const savedUrl = process.env.PLAN_TEMPLATE_KB_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (savedUrl === undefined) delete process.env.PLAN_TEMPLATE_KB_URL;
  else process.env.PLAN_TEMPLATE_KB_URL = savedUrl;
});

const brigade = resolvePlanTemplate('brigade', 'other');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('template section parsing', () => {
  it('accepts a plain string array and numbers sections from 1', () => {
    expect(parseTemplateSections(['单位概况', '处置力量'])).toEqual([
      { ordinal: 1, title: '单位概况' },
      { ordinal: 2, title: '处置力量' },
    ]);
  });

  it('reads title, heading or name from object entries', () => {
    const sections = parseTemplateSections([
      { title: '单位概况' }, { heading: '组织架构' }, { name: '战勤保障' },
    ]);
    expect(sections.map((entry) => entry.title)).toEqual(['单位概况', '组织架构', '战勤保障']);
  });

  it('unwraps sections nested under data', () => {
    expect(parseTemplateSections({ data: { sections: ['专家库'] } })).toEqual([{ ordinal: 1, title: '专家库' }]);
  });

  it('drops blank titles instead of emitting empty sections', () => {
    // 空标题混进章节表会让复核员以为该章已核对过。
    expect(parseTemplateSections(['单位概况', '   ', '', { title: '  ' }])).toEqual([
      { ordinal: 1, title: '单位概况' },
    ]);
  });

  it('returns an empty list for unparseable payloads', () => {
    expect(parseTemplateSections(null)).toEqual([]);
    expect(parseTemplateSections({ unexpected: true })).toEqual([]);
  });
});

describe('template section retrieval', () => {
  it('skips retrieval when no endpoint is configured and warns that nothing was checked', async () => {
    delete process.env.PLAN_TEMPLATE_KB_URL;
    const retrieval = await retrieveTemplateSections(brigade);
    expect(retrieval.status).toBe('not_configured');
    expect(retrieval.sections).toEqual([]);
    expect(retrieval.sectionCountMatches).toBeNull();
    expect(retrieval.fileName).toBe('支队级预案模版.pdf');
    expect(retrieval.warnings.join()).toContain('需人工比对');
  });

  it('reports a match when the retrieved chapter count equals the spec count', async () => {
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    const titles = Array.from({ length: 10 }, (_, index) => `第${index + 1}章`);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ sections: titles }));

    const retrieval = await retrieveTemplateSections(brigade);
    expect(retrieval.status).toBe('retrieved');
    expect(retrieval.sections).toHaveLength(10);
    expect(retrieval.sectionCountMatches).toBe(true);
    expect(retrieval.warnings).toEqual([]);
  });

  it('keeps the retrieved chapters intact and warns when the count differs from spec', async () => {
    // 章节数不符时既不裁剪也不补齐——差异本身要交指挥员判断。
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ sections: ['第1章', '第2章', '第3章'] }));

    const retrieval = await retrieveTemplateSections(brigade);
    expect(retrieval.status).toBe('retrieved');
    expect(retrieval.sections).toHaveLength(3);
    expect(retrieval.sectionCountMatches).toBe(false);
    expect(retrieval.expectedSectionCount).toBe(10);
    expect(retrieval.warnings.join()).toContain('检索到 3 个章节');
    expect(retrieval.warnings.join()).toContain('规范为 10 章');
  });

  it('never fabricates chapters from the spec count when the knowledge base fails', async () => {
    // 这是本模块最重要的一条约束：编造出的章节表会让复核员
    // 误以为模板已核对，比没有章节更危险。
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'not found' }, 404));

    const retrieval = await retrieveTemplateSections(brigade);
    expect(retrieval.status).toBe('unavailable');
    expect(retrieval.sections).toEqual([]);
    expect(retrieval.sections).not.toHaveLength(retrieval.expectedSectionCount ?? -1);
    expect(retrieval.failureReason).toContain('404');
  });

  it('treats an empty chapter list as unavailable rather than a valid zero-chapter template', async () => {
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ sections: [] }));

    const retrieval = await retrieveTemplateSections(brigade);
    expect(retrieval.status).toBe('unavailable');
    expect(retrieval.sectionCountMatches).toBeNull();
  });

  it('degrades to unavailable when the fetch throws', async () => {
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('KB_TIMEOUT'));

    const retrieval = await retrieveTemplateSections(brigade);
    expect(retrieval.status).toBe('unavailable');
    expect(retrieval.sections).toEqual([]);
    expect(retrieval.failureReason).toBe('KB_TIMEOUT');
  });

  it('reports not_configured without a template instead of throwing', async () => {
    process.env.PLAN_TEMPLATE_KB_URL = 'http://kb.test';
    const retrieval = await retrieveTemplateSections(null);
    expect(retrieval.status).toBe('not_configured');
    expect(retrieval.fileName).toBeNull();
    expect(retrieval.expectedSectionCount).toBeNull();
  });
});
