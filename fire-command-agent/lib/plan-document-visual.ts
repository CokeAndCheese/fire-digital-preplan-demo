/**
 * 需求书 §12.1.1 导出文档逐页视觉验收。
 *
 * 为什么需要这一层：字段级校验只能证明占位符被替换了，证明不了版面没塌。
 * 模板换版、字号溢出、分页错位、内容跑出页边距，这些在 XML 层都是"正常"的，
 * 只有把每页渲成位图看才发现。这里走 LibreOffice headless：
 *   docx --PageRange=N--> 单页 pdf --draw_png_Export--> png --sharp--> 度量
 *
 * 判定阈值与纯函数集中在本文件上半部分，可脱离 LibreOffice 单测。
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { PlanDocumentVisualCheck, PlanDocumentVisualPage } from './plan-contract';

const run = promisify(execFile);

/** 低于此非白像素占比即视为空白页：正文页实测约 0.066，空白页约 0 */
export const BLANK_INK_RATIO = 0.0015;
/** 高于此占比说明版面糊死（叠字、底纹失控），不是正常文本页 */
export const DENSE_INK_RATIO = 0.45;
/** 内容外接框距页边小于此像素数即判为跑出页边距（96dpi 下约 6mm） */
export const MARGIN_FLOOR_PX = 24;

export type PageMetrics = {
  pageNumber: number;
  width: number;
  height: number;
  inkRatio: number;
  contentBox: { left: number; top: number; right: number; bottom: number } | null;
};

/**
 * 单页判定。空的 contentBox 说明整页无内容，与 inkRatio 判定重复但不冲突——
 * 两条都记，验收报告要能区分"渲染出来是白纸"和"渲染失败没拿到框"。
 */
export function pageFindings(metrics: PageMetrics): string[] {
  const findings: string[] = [];
  if (metrics.width <= 0 || metrics.height <= 0) {
    findings.push('页面尺寸无效，渲染未产出有效位图');
    return findings;
  }
  if (metrics.inkRatio < BLANK_INK_RATIO) findings.push('空白页：非白像素占比低于阈值');
  if (metrics.inkRatio > DENSE_INK_RATIO) findings.push('版面过密：疑似叠字或底纹失控');
  const box = metrics.contentBox;
  if (!box) {
    findings.push('未取到内容外接框');
    return findings;
  }
  const gaps = {
    左: box.left,
    上: box.top,
    右: metrics.width - box.right,
    下: metrics.height - box.bottom,
  };
  for (const [edge, gap] of Object.entries(gaps)) {
    if (gap < MARGIN_FLOOR_PX) findings.push(`内容贴${edge}边距（${gap}px），疑似溢出页面`);
  }
  return findings;
}

/** 整份文档判定：零页视为未通过，任一页有问题即整体失败。 */
export function visualStatus(pages: PlanDocumentVisualPage[]): 'passed' | 'failed' {
  if (!pages.length) return 'failed';
  return pages.every((page) => page.findings.length === 0) ? 'passed' : 'failed';
}

/** 汇总失败原因，供界面直接显示；全通过时返回 null。 */
export function visualFailureReason(pages: PlanDocumentVisualPage[]): string | null {
  if (!pages.length) return '未渲染出任何页面，无法完成逐页视觉验收。';
  const bad = pages.filter((page) => page.findings.length > 0);
  if (!bad.length) return null;
  return bad.map((page) => `第 ${page.pageNumber} 页：${page.findings.join('；')}`).join(' | ');
}

/** 审计日志一行摘要。未执行与判定失败要能一眼区分，不能都写成"未通过"。 */
export function visualAuditSummary(check: PlanDocumentVisualCheck): string {
  if (check.status === 'pending') return '正在后台渲染中（结果将回填，导出文件本身已可用）';
  if (check.status === 'not_run') return `未执行（${check.failureReason ?? '原因未记录'}）`;
  if (check.status === 'passed') return `${check.pageCount} 页全部通过（${check.renderer ?? '渲染引擎未知'}）`;
  const bad = check.pages.filter((page) => page.findings.length > 0).length;
  return `${check.pageCount} 页中 ${bad} 页存疑：${check.failureReason ?? '原因未记录'}`;
}

/** 导出接口立即返回时占位用：真实结果由 verifyDocumentVisually 在后台跑完后回填 */
export function pendingVisualCheck(): PlanDocumentVisualCheck {
  return { status: 'pending', pageCount: 0, pages: [], renderer: null, checkedAt: null, failureReason: null };
}

/**
 * 数 PDF 页数。不引入 PDF 解析库：只认 /Type /Page 对象与页树 /Count，
 * 两者取大值。LibreOffice 自己导出的 PDF 结构稳定，够用且零依赖。
 */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const objects = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  return Math.max(objects, counts.length ? Math.max(...counts) : 0);
}

/** 从 `soffice --version` 首行取引擎标识，取不到就返回 null，不编造。 */
export function parseRendererVersion(output: string): string | null {
  const line = output.split(/\r?\n/).map((item) => item.trim()).find((item) => /LibreOffice\s+\d/.test(item));
  if (!line) return null;
  const match = line.match(/LibreOffice\s+([\d.]+)/);
  return match ? `LibreOffice ${match[1]}` : null;
}

/**
 * 定位 soffice。Windows 上必须用 soffice.com 而不是 .exe：
 * .exe 会立刻脱离控制台返回，execFile 等不到转换结束就继续，拿到空目录。
 */
export function resolveSoffice(): string | null {
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\LibreOffice\\program\\soffice.com', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com']
    : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice'];
  return candidates.find((item) => existsSync(item)) ?? null;
}

/** 单次转换超时。冷启动首次转换会慢，给足 90s。 */
const CONVERT_TIMEOUT_MS = 90_000;

/**
 * 调一次 soffice。每次都指定独立 UserInstallation：
 * 并发导出时共享用户目录会互相锁死，症状是第二个进程静默退出、输出目录为空。
 */
async function convert(soffice: string, profile: string, filter: string, outDir: string, input: string) {
  const { stdout, stderr } = await run(soffice, [
    '--headless', '--norestore', '--invisible',
    `-env:UserInstallation=file:///${profile.replace(/\\/g, '/')}`,
    '--convert-to', filter, '--outdir', outDir, input,
  ], { timeout: CONVERT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return `${stdout}\n${stderr}`;
}

/** 量一页位图：非白像素占比 + 内容外接框。阈值 250 而非 255，容忍抗锯齿灰边。 */
export async function measurePage(png: Buffer, pageNumber: number): Promise<PageMetrics> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let ink = 0;
  let left = info.width; let top = info.height; let right = -1; let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] >= 250) continue;
      ink += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const total = info.width * info.height;
  return {
    pageNumber,
    width: info.width,
    height: info.height,
    inkRatio: total ? Number((ink / total).toFixed(5)) : 0,
    contentBox: right < 0 ? null : { left, top, right, bottom },
  };
}

/**
 * 渲第 N 页。先用 PageRange 导出只含该页的 PDF，再交 Draw 过滤器转 PNG——
 * writer/draw 的 PNG 过滤器都只输出首页，所以必须先拆页，不能一次转全篇。
 */
async function renderPage(soffice: string, profile: string, work: string, source: string, page: number) {
  const pageDir = path.join(work, `p${page}`);
  const filter = `pdf:writer_pdf_Export:{"PageRange":{"type":"string","value":"${page}"}}`;
  await convert(soffice, profile, filter, pageDir, source);
  const singlePdf = path.join(pageDir, 'plan.pdf');
  if (!existsSync(singlePdf)) throw new Error(`第 ${page} 页未导出成单页 PDF`);
  await convert(soffice, profile, 'png:draw_png_Export', pageDir, singlePdf);
  const png = path.join(pageDir, 'plan.png');
  if (!existsSync(png)) throw new Error(`第 ${page} 页未渲染出位图`);
  return measurePage(await readFile(png), page);
}

/** 未装 LibreOffice 时的返回值：状态是 not_run 而不是 failed——环境缺件不等于版面有问题。 */
function notRun(reason: string): PlanDocumentVisualCheck {
  return { status: 'not_run', pageCount: 0, pages: [], renderer: null, checkedAt: null, failureReason: reason };
}

/**
 * 对 .docx 做逐页视觉验收。
 * 全程在临时目录里做，结束即删——导出目录只该存交付物，不该混渲染中间件。
 */
export async function verifyDocumentVisually(docx: Buffer, checkedAt: string): Promise<PlanDocumentVisualCheck> {
  // 默认开启。单测里关掉是因为一次渲染要 5~9s，而那些用例验的是字段映射不是版面；
  // 关掉后状态如实记成 not_run，不会伪造成"已通过"。
  if (process.env.FIRE_PLAN_VISUAL_CHECK === '0') return notRun('逐页视觉验收已由 FIRE_PLAN_VISUAL_CHECK=0 关闭。');
  const soffice = resolveSoffice();
  if (!soffice) return notRun('未检测到 LibreOffice，逐页视觉验收未执行。可设 LIBREOFFICE_PATH 指向 soffice。');

  const work = await mkdtemp(path.join(os.tmpdir(), 'plan-visual-'));
  const profile = path.join(work, 'profile');
  try {
    let renderer: string | null = null;
    try {
      const { stdout } = await run(soffice, ['--version'], { timeout: 30_000, windowsHide: true });
      renderer = parseRendererVersion(stdout);
    } catch {
      // 版本取不到不阻断验收，只是溯源信息缺一项
    }

    const source = path.join(work, 'plan.docx');
    await writeFile(source, docx);
    await convert(soffice, profile, 'pdf', work, source);
    const fullPdf = path.join(work, 'plan.pdf');
    if (!existsSync(fullPdf)) return notRun('LibreOffice 未产出 PDF，逐页视觉验收未执行。');
    const pageCount = countPdfPages(await readFile(fullPdf));
    if (pageCount < 1) return notRun('无法判定页数，逐页视觉验收未执行。');

    const pages: PlanDocumentVisualPage[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const metrics = await renderPage(soffice, profile, work, source, page);
      pages.push({ ...metrics, findings: pageFindings(metrics) });
    }
    return {
      status: visualStatus(pages),
      pageCount,
      pages,
      renderer,
      checkedAt,
      failureReason: visualFailureReason(pages),
    };
  } catch (error) {
    return notRun(`逐页视觉验收执行失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
