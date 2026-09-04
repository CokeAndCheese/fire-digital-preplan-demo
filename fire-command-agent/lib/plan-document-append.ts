import 'server-only';

/**
 * 站/大队/支队级模板追加节。
 *
 * 这三份模板本身是某栋具体建筑（宝盛广场等）已填报的档案性预案，没有
 * {{token}} 占位符，档案里的消防站人员电话、水池容量、社会联动单位电话等
 * 字段在 UnifiedFireRescuePlan 契约里也没有对应项——不能替换，也不能编造。
 *
 * 做法：原文一字不改，在正文末尾（body 级 <w:sectPr> 之前）追加一个新分节，
 * 标题写明"系统生成·本次事件数据"，与模板原有档案内容划清来源，避免阅读者
 * 把两栋不相关建筑的信息混为一谈。
 */

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 换行转 <w:br/>，与 plan-document.ts 的 wordText 同规则，用于系统数据里的多行摘要 */
function paragraphText(value: string) {
  const escaped = xmlEscape(value);
  return escaped.includes('\n')
    ? escaped.split('\n').join('</w:t><w:br/><w:t xml:space="preserve">')
    : escaped;
}

function heading(text: string) {
  return `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr>`
    + `<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function labelValue(label: string, value: string) {
  return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr>`
    + `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}：</w:t></w:r>`
    + `<w:r><w:t xml:space="preserve">${paragraphText(value)}</w:t></w:r></w:p>`;
}

export type AppendEntry = { label: string; value: string };

/** 系统数据追加节的正文段落（不含标题），供单测直接校验内容而不必解析整篇 XML */
export function appendSectionParagraphs(entries: AppendEntry[]): string {
  const note = '<w:p><w:pPr><w:spacing w:after="160"/><w:rPr><w:i/></w:rPr></w:pPr>'
    + '<w:r><w:rPr><w:i/></w:rPr><w:t>以下内容由指挥系统根据本次接警事件自动生成，与前文模板档案信息来源不同，'
    + '不代表已核实替换模板中登记的建筑档案。</w:t></w:r></w:p>';
  return note + entries.map((entry) => labelValue(entry.label, entry.value)).join('');
}

/**
 * 在正文（body 级）最后一个 <w:sectPr> 之前插入追加节。
 *
 * body 级分节属性必须落在 body 的最后一个块级元素之后、</w:body> 之前——
 * 插在它前面而不是文档末尾，否则追加内容会被排到页面设置节之外，Word 无法解析。
 * 多分节文档（本模板有 3 个 <w:sectPr>）只有最后一个才是 body 级的，
 * 前面的都嵌在某个 <w:pPr> 内表示节内分页，因此用 lastIndexOf 定位。
 */
export function appendSystemSection(documentXml: string, title: string, entries: AppendEntry[]): string {
  const insertAt = documentXml.lastIndexOf('<w:sectPr');
  if (insertAt === -1) {
    throw new Error('模板 document.xml 缺少 <w:sectPr>，无法定位追加位置。');
  }
  const block = heading(title) + appendSectionParagraphs(entries);
  return documentXml.slice(0, insertAt) + block + documentXml.slice(insertAt);
}
