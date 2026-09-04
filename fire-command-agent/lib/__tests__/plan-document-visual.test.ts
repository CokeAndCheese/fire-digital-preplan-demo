import { describe, expect, it } from 'vitest';
import {
  BLANK_INK_RATIO, DENSE_INK_RATIO, MARGIN_FLOOR_PX,
  countPdfPages, pageFindings, parseRendererVersion,
  visualAuditSummary, visualFailureReason, visualStatus,
  type PageMetrics,
} from '../plan-document-visual';
import type { PlanDocumentVisualCheck, PlanDocumentVisualPage } from '../plan-contract';

/** 实测正文页：816x1056，ink 0.066，内容框距边 96px */
const healthy: PageMetrics = {
  pageNumber: 1, width: 816, height: 1056, inkRatio: 0.06629,
  contentBox: { left: 96, top: 113, right: 721, bottom: 746 },
};

describe('pageFindings', () => {
  it('实测正常导出页无异常', () => {
    expect(pageFindings(healthy)).toEqual([]);
  });

  it('空白页同时报占位与无外接框，两条都要留给验收报告', () => {
    const found = pageFindings({ ...healthy, inkRatio: 0, contentBox: null });
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('空白页');
    expect(found[1]).toContain('未取到内容外接框');
  });

  it('版面过密判为叠字或底纹失控', () => {
    expect(pageFindings({ ...healthy, inkRatio: DENSE_INK_RATIO + 0.01 }).join()).toContain('版面过密');
  });

  it('内容贴边判为溢出页面，并指明是哪一边', () => {
    const found = pageFindings({ ...healthy, contentBox: { left: 2, top: 113, right: 721, bottom: 746 } });
    expect(found.join()).toContain('内容贴左边距');
  });

  it('尺寸无效时短路，不再往下判空白', () => {
    expect(pageFindings({ ...healthy, width: 0, height: 0 })).toEqual(['页面尺寸无效，渲染未产出有效位图']);
  });

  it('阈值处于合理量级，避免正文页被误判', () => {
    expect(BLANK_INK_RATIO).toBeLessThan(healthy.inkRatio);
    expect(MARGIN_FLOOR_PX).toBeLessThan(96);
  });
});

const page = (n: number, findings: string[] = []): PlanDocumentVisualPage => ({
  pageNumber: n, width: 816, height: 1056, inkRatio: 0.06, contentBox: null, findings,
});

describe('visualStatus / visualFailureReason', () => {
  it('全页无异常才算通过', () => {
    expect(visualStatus([page(1), page(2)])).toBe('passed');
    expect(visualFailureReason([page(1), page(2)])).toBeNull();
  });

  it('零页视为失败，不能当成通过', () => {
    expect(visualStatus([])).toBe('failed');
    expect(visualFailureReason([])).toContain('未渲染出任何页面');
  });

  it('失败原因带页号，指挥员要知道翻哪一页', () => {
    const reason = visualFailureReason([page(1), page(2, ['空白页：非白像素占比低于阈值'])]);
    expect(reason).toContain('第 2 页');
    expect(reason).not.toContain('第 1 页');
  });
});

describe('countPdfPages', () => {
  it('按 /Type /Page 与 /Count 取大值', () => {
    expect(countPdfPages(Buffer.from('/Type /Pages /Count 3 /Type /Page /Type /Page ', 'latin1'))).toBe(3);
  });

  it('单页 PDF 数出 1', () => {
    expect(countPdfPages(Buffer.from('/Type /Page\n/Count 1', 'latin1'))).toBe(1);
  });

  it('非 PDF 内容返回 0，交由调用方判未执行', () => {
    expect(countPdfPages(Buffer.from('not a pdf', 'latin1'))).toBe(0);
  });
});

describe('parseRendererVersion', () => {
  it('取出实测版本号', () => {
    expect(parseRendererVersion('LibreOffice 26.2.5.2 cd7284b4cbb')).toBe('LibreOffice 26.2.5.2');
  });

  it('忽略 python 告警等噪声行', () => {
    expect(parseRendererVersion('Could not find platform independent libraries\nLibreOffice 26.2.5.2 abc'))
      .toBe('LibreOffice 26.2.5.2');
  });

  it('取不到就返回 null，不编造引擎标识', () => {
    expect(parseRendererVersion('')).toBeNull();
    expect(parseRendererVersion('some unrelated output')).toBeNull();
  });
});

const check = (over: Partial<PlanDocumentVisualCheck>): PlanDocumentVisualCheck => ({
  status: 'passed', pageCount: 2, pages: [page(1), page(2)],
  renderer: 'LibreOffice 26.2.5.2', checkedAt: '2026-08-26T00:00:00.000Z', failureReason: null, ...over,
});

describe('visualAuditSummary', () => {
  it('未执行与失败必须能一眼区分', () => {
    const notRun = visualAuditSummary(check({ status: 'not_run', pageCount: 0, pages: [], failureReason: '未检测到 LibreOffice' }));
    expect(notRun).toContain('未执行');
    expect(notRun).toContain('未检测到 LibreOffice');
    expect(notRun).not.toContain('存疑');
  });

  it('通过时带页数与引擎，便于溯源', () => {
    expect(visualAuditSummary(check({}))).toBe('2 页全部通过（LibreOffice 26.2.5.2）');
  });

  it('失败时报存疑页数', () => {
    const summary = visualAuditSummary(check({
      status: 'failed', pages: [page(1), page(2, ['空白页'])], failureReason: '第 2 页：空白页',
    }));
    expect(summary).toContain('2 页中 1 页存疑');
  });

  it('引擎未知时不留 undefined 字样', () => {
    expect(visualAuditSummary(check({ renderer: null }))).toContain('渲染引擎未知');
  });
});
