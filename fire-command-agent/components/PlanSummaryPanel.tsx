/**
 * 预案态势面板 · 重构版
 *
 * 设计原则：
 * - 三层信息架构：预案身份（顶部）→ 核心指标卡片（中）→ 详细状态（底部可折叠）
 * - 状态视觉语言：辉光边框 + 色块 + 图标三位一体
 * - 专业密度：预案完整性进度条、证据链可视化、模板层级突出呈现
 * - 消防主题：红色（火情/警戒）、橙色（响应级别）、青色（已核验）、灰色（待处理）
 */

'use client';

import {
  AlertCircle,
  AlertTriangle,
  BookText,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Droplets,
  FileDown,
  FileText,
  Flame,
  Layers3,
  MapPin,
  Shield,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import { isUnifiedFireRescuePlan, type UnifiedFireRescuePlan } from '@/lib/plan-contract';
import { clientPath } from '@/lib/client-path';
import { planFromRun, type LiveExecutionRun } from './ExecutionMonitor';
import type { FireResourcePlatformUnit } from '@/lib/skills/fire-resource-platform';
import { LifecycleProgress, WaterSourceBars } from './DashboardCharts';
import { useEffect, useState } from 'react';

function responseFileName(response: Response, fallback: string) {
  const header = response.headers.get('content-disposition') || '';
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return header.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

/**
 * 预案数据完整性评分。
 *
 * 匹配 plan-orchestrator 的 track() 判定逻辑，7 个维度：
 * - 空间定位、响应等级、力量编成、处置策略、路线水源、预案模板、推演映射
 *
 * 核心规则：
 * - 预案模板：层级已推导（tier 非空）即视为就绪，无需等待 status=ready
 * - 路线水源：Skill 成功 + 有水源数据
 * - 其它块：status === 'ready'
 *
 * 未携带可选块（routeWater/planTemplate）的旧版预案不计入总分母，
 * 否则既有预案会被错误标注为"不完整"。
 */
export function calculatePlanCompleteness(plan: UnifiedFireRescuePlan): { total: number; ready: number } {
  const dimensions = [
    plan.spatialTarget.status === 'ready',
    plan.responseLevel.status === 'ready',
    plan.forceComposition.status === 'ready',
    Object.values(plan.strategies).every((s) => s.status === 'ready'),
    plan.simulation.status === 'ready',
  ];

  // 可选块：旧版预案可能不含 routeWater / planTemplate，
  // 只在块存在时纳入计分。
  if (plan.routeWater) {
    dimensions.push(plan.routeWater.status === 'ready' && plan.routeWater.waterSources.length > 0);
  }
  if (plan.planTemplate) {
    dimensions.push(Boolean(plan.planTemplate.tier));
  }

  return {
    total: dimensions.length,
    ready: dimensions.filter(Boolean).length,
  };
}

type PlanDataStatus = 'ready' | 'pending_manual_review' | 'failed' | 'not_requested';

interface StatusIndicatorProps {
  status: PlanDataStatus | 'verified' | 'unresolved';
  label: string;
  Icon?: React.ComponentType<{ size?: number }>;
  compact?: boolean;
}

function StatusIndicator({ status, label, Icon, compact = false }: StatusIndicatorProps) {
  const normalized = status === 'verified' ? 'ready' : status === 'unresolved' ? 'failed' : status;

  const config = {
    ready: { color: 'teal', icon: CheckCircle2, text: '已核验' },
    pending_manual_review: { color: 'amber', icon: Clock3, text: '待核验' },
    failed: { color: 'red', icon: XCircle, text: '异常' },
    not_requested: { color: 'muted', icon: AlertCircle, text: '未请求' },
  }[normalized];

  const DisplayIcon = Icon || config.icon;

  return (
    <span className={`plan-status-badge plan-status-badge--${config.color} ${compact ? 'plan-status-badge--compact' : ''}`}>
      <DisplayIcon size={compact ? 11 : 13} />
      <span>{label || config.text}</span>
    </span>
  );
}

export function PlanSummaryPanel({
  run,
  selectedResources = [],
}: {
  run: LiveExecutionRun | null;
  selectedResources?: FireResourcePlatformUnit[];
}) {
  const livePlan = planFromRun(run);
  const [fallbackPlan, setFallbackPlan] = useState<UnifiedFireRescuePlan | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  // 页面刷新或当前 run 无回执时，从库读取最近一份预案，保证导出按钮仍可显示。
  useEffect(() => {
    if (livePlan) return;
    let active = true;
    setFallbackPlan(null);
    fetch(clientPath('/api/plans?limit=1'), { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active) return;
        const plans = Array.isArray(payload?.plans) ? payload.plans : [];
        const latest = plans[0];
        setFallbackPlan(isUnifiedFireRescuePlan(latest) ? latest : null);
      })
      .catch(() => {
        if (active) setFallbackPlan(null);
      });
    return () => {
      active = false;
    };
  }, [livePlan]);

  const plan = livePlan ?? fallbackPlan;

  const reviewItems = plan ? [...plan.missingItems, ...plan.failedItems.map((item) => item.section)] : [];
  const evidenceBlockedAfterReview = Boolean(
    plan && plan.review.status === 'approved' && reviewItems.length > 0 && plan.issuance.status === 'blocked'
  );

  const completeness = plan ? calculatePlanCompleteness(plan) : null;

  const saveWord = async () => {
    if (!plan || plan.issuance.status !== 'issued' || exporting) return;
    setExporting(true);
    setExportMessage('正在生成 Word 文件...');
    try {
      const response = await fetch(clientPath(`/api/plans/${encodeURIComponent(plan.planId)}/export`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: plan.revision, actor: '值班指挥员' }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Word 导出失败。');
      }
      const blob = await response.blob();
      const fileName = responseFileName(response, plan.document.fileName || `${plan.planId}-v${plan.version}.docx`);
      // 用 blob URL + 隐藏 <a download> 触发下载：不需要在 await 之后仍保留的
      // 用户手势，兼容所有浏览器（Firefox/Safari/Chromium）。
      // 注意不要用 showSaveFilePicker——它在 await fetch 之后会因瞬态用户手势
      // 已被消耗而抛错或卡住，表现为"点了没反应"。
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setExportMessage(`已导出：${fileName}，请查看浏览器下载记录`);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Word 导出失败。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="fire-panel" aria-labelledby="plan-summary-title">
      {/* 面板头：预案状态总览 */}
      <header className="fire-panel__header">
        <div className="fire-panel__title-group">
          <span className="fire-panel__icon fire-panel__icon--ember">
            <FileText size={16} />
          </span>
          <div>
            <span className="fire-panel__label">TACTICAL PLAN</span>
            <h2 id="plan-summary-title" className="fire-panel__title">
              预案态势
            </h2>
          </div>
        </div>
        {plan && (
          <div className="fire-panel__status-cluster">
            {plan.lifecycleStatus === 'issued' && (
              <span className="fire-badge fire-badge--success">
                <Shield size={12} />
                <span>已签发</span>
              </span>
            )}
            {plan.review.status === 'approved' && plan.lifecycleStatus !== 'issued' && (
              <span className="fire-badge fire-badge--verified">
                <ShieldCheck size={12} />
                <span>已复核</span>
              </span>
            )}
            {plan.review.status !== 'approved' && reviewItems.length > 0 && (
              <span className="fire-badge fire-badge--warning">
                <AlertTriangle size={12} />
                <span>待处理 {reviewItems.length}</span>
              </span>
            )}
          </div>
        )}
      </header>

      {!plan ? (
        <div className="fire-panel__empty">
          <FileText size={32} className="fire-panel__empty-icon" />
          <strong className="fire-panel__empty-title">
            {run ? '等待结构化预案回执' : '尚未生成预案'}
          </strong>
          <p className="fire-panel__empty-detail">
            {run ? run.currentDetail : '在右侧八维通对话中提交火情任务，生成结果会同步到这里。'}
          </p>
        </div>
      ) : (
        <div className="fire-panel__content">
          {/* 预案身份卡 */}
          <div className="plan-identity-card">
            <div className="plan-identity-card__header">
              <strong className="plan-identity-card__building">{plan.building.name || '待确认建筑'}</strong>
              <span className="plan-identity-card__version">v{plan.version}</span>
            </div>
            <div className="plan-identity-card__meta">
              <span className="plan-identity-card__id">{plan.planId}</span>
              <span className="plan-identity-card__sep">·</span>
              <span className="plan-identity-card__location">
                {[plan.spatialTarget.floor, plan.spatialTarget.room].filter(Boolean).join(' · ') || '位置待确认'}
              </span>
            </div>
            {completeness && (
              <div className="plan-completeness">
                <div className="plan-completeness__bar">
                  <div
                    className="plan-completeness__fill"
                    style={{ width: `${(completeness.ready / completeness.total) * 100}%` }}
                  />
                </div>
                <span className="plan-completeness__label">
                  数据完整性：{completeness.ready}/{completeness.total}
                </span>
              </div>
            )}
          </div>

          {/* 大屏图表：状态流转与水源距离，全部来自已落库预案字段 */}
          <div className="plan-panel__charts">
            <LifecycleProgress status={plan.lifecycleStatus} />
            {plan.routeWater?.waterSources.length ? (
              <WaterSourceBars sources={plan.routeWater.waterSources} />
            ) : null}
          </div>

          {/* 核心指标卡片网格 */}
          <div className="plan-metric-cards">
            {/* 火情 */}
            <div className="metric-card metric-card--critical">
              <div className="metric-card__icon">
                <Flame size={18} />
              </div>
              <div className="metric-card__content">
                <span className="metric-card__label">火情类型</span>
                <strong className="metric-card__value">{plan.event.fireType || '待确认'}</strong>
                {plan.incident.burnAreaSqm !== null && (
                  <small className="metric-card__detail">过火 {plan.incident.burnAreaSqm} m²</small>
                )}
              </div>
            </div>

            {/* 被困人员 */}
            <div className="metric-card metric-card--urgent">
              <div className="metric-card__icon">
                <Users size={18} />
              </div>
              <div className="metric-card__content">
                <span className="metric-card__label">被困人数</span>
                <strong className="metric-card__value">
                  {plan.incident.trappedCount === null ? '待确认' : `${plan.incident.trappedCount} 人`}
                </strong>
              </div>
            </div>

            {/* 响应等级 */}
            <div className={`metric-card metric-card--level-${plan.responseLevel.recommendation || 'pending'}`}>
              <div className="metric-card__icon">
                <TrendingUp size={18} />
              </div>
              <div className="metric-card__content">
                <span className="metric-card__label">响应等级</span>
                <strong className="metric-card__value">{plan.responseLevel.recommendation || '待评估'}</strong>
                <StatusIndicator status={plan.responseLevel.status} label="" compact />
              </div>
            </div>

            {/* 空间定位 */}
            <div className="metric-card">
              <div className="metric-card__icon">
                <MapPin size={18} />
              </div>
              <div className="metric-card__content">
                <span className="metric-card__label">空间定位</span>
                <StatusIndicator
                  status={plan.spatialTarget.status}
                  label={plan.spatialTarget.status === 'ready' ? '已核验' : '待核验'}
                  compact
                />
              </div>
            </div>
          </div>

          {/* 预案模板层级 — 新增核心展示 */}
          {plan.planTemplate && (
            <div className="plan-template-section">
              <div className="plan-section-header">
                <BookText size={14} />
                <h3>预案模板</h3>
              </div>
              <div className="plan-template-card">
                <div className="plan-template-card__tier">
                  <span className="plan-template-card__tier-badge">
                    {plan.planTemplate.tierLabel || '层级待确认'}
                  </span>
                  {plan.planTemplate.fileName && (
                    <span className="plan-template-card__filename">{plan.planTemplate.fileName}</span>
                  )}
                </div>
                <div className="plan-template-card__status-row">
                  <StatusIndicator status={plan.planTemplate.status} label="层级映射" Icon={BookText} compact />
                  {plan.planTemplate.sections && plan.planTemplate.sections.length > 0 ? (
                    <span className="plan-template-card__sections">
                      <CheckCircle2 size={11} />
                      <span>
                        章节已核对 {plan.planTemplate.sections.length}/
                        {plan.planTemplate.expectedSectionCount || '未知'}
                      </span>
                    </span>
                  ) : (
                    <span className="plan-template-card__sections plan-template-card__sections--unchecked">
                      <AlertCircle size={11} />
                      <span>章节未核对</span>
                    </span>
                  )}
                </div>
                {plan.planTemplate.warnings && plan.planTemplate.warnings.length > 0 && (
                  <div className="plan-template-card__warnings">
                    {plan.planTemplate.warnings.slice(0, 2).map((warning, idx) => (
                      <p key={idx} className="plan-template-card__warning">
                        <AlertTriangle size={10} />
                        <span>{warning}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 力量编成 */}
          <div className="plan-detail-section">
            <div className="plan-section-header">
              <Users size={14} />
              <h3>力量编成</h3>
              <StatusIndicator status={plan.forceComposition.status} label="" compact />
            </div>
            {plan.forceComposition.units.length > 0 ? (
              <ul className="plan-unit-list">
                {plan.forceComposition.units.slice(0, 5).map((unit, index) => (
                  <li key={`${unit.unitId || unit.name}-${index}`} className="plan-unit-item">
                    <div className="plan-unit-item__main">
                      <span className="plan-unit-item__name">{unit.name}</span>
                      <span className="plan-unit-item__meta">
                        {unit.personnel || '人员待核实'} ·{' '}
                        {unit.availabilityStatus === 'verified' ? '已核验' : '待核验'}
                      </span>
                    </div>
                    {unit.etaMinutes !== null && unit.etaMinutes !== undefined && (
                      <span className="plan-unit-item__eta">{unit.etaMinutes} 分钟</span>
                    )}
                  </li>
                ))}
                {plan.forceComposition.units.length > 5 && (
                  <li className="plan-unit-item plan-unit-item--more">
                    另有 {plan.forceComposition.units.length - 5} 个单位
                  </li>
                )}
              </ul>
            ) : (
              <p className="plan-section-empty">未收到可核验的力量回执。</p>
            )}
          </div>

          {/* 路线水源简要 */}
          {plan.routeWater && (
            <div className="plan-detail-section">
              <div className="plan-section-header">
                <Droplets size={14} />
                <h3>路线水源</h3>
                <StatusIndicator status={plan.routeWater.status} label="" compact />
              </div>
              <div className="plan-water-summary">
                {plan.routeWater.waterSources.length > 0 ? (
                  <p className="plan-water-summary__text">
                    已检索 {plan.routeWater.waterSources.length} 个水源，主进攻路线{' '}
                    {plan.routeWater.primaryRoute?.status === 'ready' ? '已核验' : '待现场确认'}
                  </p>
                ) : (
                  <p className="plan-section-empty">水源数据待补充。</p>
                )}
              </div>
            </div>
          )}

          {/* 可折叠的详细信息 */}
          <button
            type="button"
            className="plan-toggle-details"
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            aria-expanded={detailsExpanded}
          >
            {detailsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{detailsExpanded ? '收起' : '查看'}证据链与处置策略</span>
          </button>

          {detailsExpanded && (
            <div className="plan-expanded-details">
              {/* 证据链状态 */}
              <div className="plan-detail-section">
                <div className="plan-section-header">
                  <Shield size={14} />
                  <h3>证据链</h3>
                </div>
                <p className="plan-evidence-stat">
                  {plan.evidenceRefs.filter((ref) => ref.status === 'verified').length}/{plan.evidenceRefs.length} 项证据已核验
                </p>
              </div>

              {/* 处置策略 */}
              <div className="plan-detail-section">
                <div className="plan-section-header">
                  <Layers3 size={14} />
                  <h3>处置策略</h3>
                </div>
                <ul className="plan-strategy-list">
                  {Object.entries(plan.strategies).map(([key, strategy]) => {
                    const labels: Record<string, string> = {
                      suppression: '灭火',
                      rescue: '搜救',
                      evacuation: '疏散',
                      security: '警戒',
                      smokeControl: '排烟',
                    };
                    return (
                      <li key={key} className="plan-strategy-item">
                        <span className="plan-strategy-item__label">{labels[key]}：</span>
                        <span className="plan-strategy-item__content">{strategy.content || '待补充'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {/* 待处理项与上下文提示 */}
          {selectedResources.length > 0 && (
            <div className="plan-context-note">
              <CheckCircle2 size={13} />
              <span>已纳入下一轮八维通上下文：{selectedResources.length} 个登记力量</span>
            </div>
          )}
          {reviewItems.length > 0 && (
            <div className="plan-review-note plan-review-note--alert">
              <AlertCircle size={13} />
              <span>
                {evidenceBlockedAfterReview ? '签发暂缓：' : '待处理：'}
                {reviewItems.slice(0, 3).join('、')}
                {reviewItems.length > 3 ? ` 等 ${reviewItems.length} 项` : ''}
              </span>
            </div>
          )}

          {/* 导出操作 */}
          <div className="plan-export-actions">
            <button
              type="button"
              className="fire-action-button fire-action-button--primary"
              onClick={() => void saveWord()}
              disabled={!plan || plan.issuance.status !== 'issued' || exporting}
              title={plan?.issuance.status === 'issued' ? '选择保存位置并导出 Word' : '签发后才可导出 Word'}
            >
              <FileDown size={14} />
              <span>
                {exporting
                  ? '正在生成 Word...'
                  : plan?.issuance.status === 'issued'
                    ? '导出 Word 文档'
                    : '签发后可导出'}
              </span>
            </button>
            {exportMessage && (
              <span className="plan-export-status" role="status" aria-live="polite">
                {exportMessage}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
