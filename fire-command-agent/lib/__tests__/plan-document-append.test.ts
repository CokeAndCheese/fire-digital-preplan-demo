import { describe, expect, it } from 'vitest';
import { appendSectionParagraphs, appendSystemSection } from '../plan-document-append';

describe('appendSectionParagraphs', () => {
  it('escapes XML special characters in label and value', () => {
    const xml = appendSectionParagraphs([{ label: 'A&B', value: '<tag> "quoted" \'x\'' }]);
    expect(xml).toContain('A&amp;B');
    expect(xml).toContain('&lt;tag&gt;');
    expect(xml).toContain('&quot;quoted&quot;');
    expect(xml).toContain('&apos;x&apos;');
    expect(xml).not.toContain('<tag>');
  });

  it('converts embedded newlines into <w:br/> so Word does not swallow them', () => {
    const xml = appendSectionParagraphs([{ label: '推演记录', value: '第一步\n第二步' }]);
    expect(xml).toContain('第一步</w:t><w:br/><w:t xml:space="preserve">第二步');
  });

  it('carries a source-disclaimer paragraph ahead of the entries', () => {
    const xml = appendSectionParagraphs([{ label: 'X', value: 'Y' }]);
    const disclaimerIdx = xml.indexOf('由指挥系统根据本次接警事件自动生成');
    const entryIdx = xml.indexOf('X：');
    expect(disclaimerIdx).toBeGreaterThan(-1);
    expect(entryIdx).toBeGreaterThan(disclaimerIdx);
  });
});

describe('appendSystemSection', () => {
  const doc = '<w:document><w:body><w:p><w:r><w:t>原文档案内容</w:t></w:r></w:p><w:sectPr><w:pgSz/></w:sectPr></w:body></w:document>';

  it('inserts the new section before the trailing body-level sectPr, preserving original content', () => {
    const out = appendSystemSection(doc, '系统生成 · 本次事件数据', [{ label: '预案编号', value: 'PLAN-1' }]);
    expect(out).toContain('原文档案内容');
    expect(out.indexOf('原文档案内容')).toBeLessThan(out.indexOf('系统生成'));
    expect(out.indexOf('系统生成')).toBeLessThan(out.indexOf('<w:sectPr>'));
    expect(out).toContain('预案编号：');
    expect(out).toContain('PLAN-1');
  });

  it('targets the LAST sectPr when a template has multiple (only the final one is body-level)', () => {
    const multi = '<w:document><w:body>'
      + '<w:p><w:pPr><w:sectPr><w:pgSz w:orient="landscape"/></w:sectPr></w:pPr><w:r><w:t>节内分页</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>正文末段</w:t></w:r></w:p>'
      + '<w:sectPr><w:pgSz/></w:sectPr>'
      + '</w:body></w:document>';
    const out = appendSystemSection(multi, '标题', [{ label: 'K', value: 'V' }]);
    const bodySectPr = out.lastIndexOf('<w:sectPr>');
    expect(out.indexOf('标题')).toBeLessThan(bodySectPr);
    expect(out.indexOf('节内分页')).toBeLessThan(out.indexOf('标题'));
  });

  it('throws a clear error when the template has no <w:sectPr> at all', () => {
    expect(() => appendSystemSection('<w:document><w:body><w:p/></w:body></w:document>', 'T', []))
      .toThrow(/sectPr/);
  });
});
