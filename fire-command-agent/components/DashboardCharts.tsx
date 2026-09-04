/**
 * 可视化大屏图表层
 *
 * 全部基于真实数据，无模拟值：
 * - /api/resources：19 条平台登记力量的人员数、车辆数、辖区分布
 * - plan.orchestration[]：Skill 调用耗时序列
 * - run.phases[]：执行阶段状态机
 *
 * 无预案时用平台力量数据驱动，保证界面始终有动态内容。
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type ChartUnit = {
  id: string;
  name: string;
  address?: string;
  personnel?: string;
  personnelCount?: number | null;
  vehicles: readonly unknown[];
};

/** 从 "人员23人" / "39人" 提取数字 */
export function parsePersonnel(text?: string): number {
  const m = String(text || '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** 从地址提取辖区（天涯区/吉阳区/海棠区/崖州区） */
export function parseDistrict(address?: string): string {
  const m = String(address || '').match(/(天涯区|吉阳区|海棠区|崖州区|育才生态区)/);
  return m ? m[1] : '其他';
}

/** 辖区力量分布柱状图 */
export function DistrictBars({ units }: { units: ChartUnit[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, { count: number; personnel: number; vehicles: number }>();
    for (const u of units) {
      const d = parseDistrict(u.address);
      const cur = map.get(d) || { count: 0, personnel: 0, vehicles: 0 };
      cur.count += 1;
      cur.personnel += typeof u.personnelCount === 'number' ? u.personnelCount : parsePersonnel(u.personnel);
      cur.vehicles += Array.isArray(u.vehicles) ? u.vehicles.length : 0;
      map.set(d, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].personnel - a[1].personnel);
  }, [units]);

  const max = Math.max(...groups.map(([, g]) => g.personnel), 1);
  if (!groups.length) return null;

  return (
    <div className="ds-chart">
      <div className="ds-chart__head">
        <span className="ds-chart__title">辖区力量分布</span>
        <span className="ds-chart__note">{units.length} 站 · 按人员</span>
      </div>
      <div className="ds-bars">
        {groups.map(([name, g], i) => (
          <div className="ds-bar-row" key={name}>
            <span className="ds-bar-row__name">{name}</span>
            <div className="ds-bar-row__track">
              <div
                className="ds-bar-row__fill"
                style={{ width: `${(g.personnel / max) * 100}%`, animationDelay: `${i * 0.12}s` }}
              />
            </div>
            <span className="ds-bar-row__val">{g.personnel}<small>人</small></span>
            <span className="ds-bar-row__sub">{g.count}站 {g.vehicles}车</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type InvocationLike = {
  sequence?: number;
  skillId?: string;
  actionId?: string;
  durationMs?: number;
  status?: string;
  finishedAt?: string;
};

const SKILL_LABEL: Record<string, string> = {
  'fire-event-parser': '事件解析',
  'building-profile': '建筑画像',
  'spatial-target': '空间定位',
  'incident-model': '灾情推演',
  'response-level': '响应分级',
  'force-composition': '力量编成',
  'tactical-strategy': '战术策略',
  'simulation-mapping': '三维映射',
  'plan-document': '文档生成',
};

function labelOf(v: InvocationLike): string {
  const id = String(v.skillId || v.actionId || '');
  return SKILL_LABEL[id] || id.replace(/-/g, ' ') || '未知';
}

/** 技能耗时序列（真实 plan.orchestration） */
export function SkillDurationSeries({ records }: { records: InvocationLike[] }) {
  const rows = useMemo(
    () => [...records].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)),
    [records],
  );
  if (!rows.length) return null;

  const max = Math.max(...rows.map((r) => r.durationMs ?? 0), 1);
  const total = rows.reduce((s, r) => s + (r.durationMs ?? 0), 0);

  return (
    <div className="ds-chart">
      <div className="ds-chart__head">
        <span className="ds-chart__title">技能调用耗时</span>
        <span className="ds-chart__note">{rows.length} 次 · {(total / 1000).toFixed(1)}s</span>
      </div>
      <div className="ds-series">
        {rows.map((r, i) => {
          const ms = r.durationMs ?? 0;
          const state =
            r.status === 'succeeded' ? 'ok' : r.status === 'degraded' ? 'warn' : 'bad';
          return (
            <div className={`ds-series__col ds-series__col--${state}`} key={`${r.sequence}-${i}`}>
              <span className="ds-series__ms">{ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}</span>
              <div className="ds-series__track">
                <div
                  className="ds-series__fill"
                  style={{ height: `${Math.max((ms / max) * 100, 4)}%`, animationDelay: `${i * 0.09}s` }}
                />
              </div>
              <span className="ds-series__label">{labelOf(r)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type AuditLike = { at?: string; actor?: string; detail?: string; evidenceRefs?: string[] };

function clockOf(at?: string): string {
  if (!at) return '--:--:--';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 审计事件滚动播报（真实 plan.auditEvents） */
export function AuditTicker({ events }: { events: AuditLike[] }) {
  const rows = useMemo(() => [...events].reverse(), [events]);
  const [cursor, setCursor] = useState(0);
  const lenRef = useRef(rows.length);

  useEffect(() => {
    lenRef.current = rows.length;
    setCursor(0);
  }, [rows.length]);

  useEffect(() => {
    if (rows.length <= 1) return;
    const timer = window.setInterval(() => {
      setCursor((c) => (c + 1) % Math.max(lenRef.current, 1));
    }, 3200);
    return () => window.clearInterval(timer);
  }, [rows.length]);

  if (!rows.length) return null;
  const view = rows.slice(cursor, cursor + 3).concat(rows.slice(0, Math.max(0, cursor + 3 - rows.length)));

  return (
    <div className="ds-chart ds-ticker">
      <div className="ds-chart__head">
        <span className="ds-chart__title">审计事件流</span>
        <span className="ds-chart__note">{rows.length} 条 · 实时</span>
      </div>
      <ul className="ds-ticker__list">
        {view.map((e, i) => (
          <li className="ds-ticker__item" key={`${e.at}-${cursor}-${i}`} style={{ animationDelay: `${i * 0.08}s` }}>
            <span className="ds-ticker__time">{clockOf(e.at)}</span>
            <span className="ds-ticker__actor">{e.actor || '系统'}</span>
            <span className="ds-ticker__detail">{e.detail || '—'}</span>
            {e.evidenceRefs?.length ? <span className="ds-ticker__badge">{e.evidenceRefs.length}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type SimulationStepLike = {
  stepId: string;
  sequence: number;
  title: string;
  status?: string;
};

/** 11 步推演进度栅格（真实 plan.simulation.mappings + simulationVerification） */
export function SimulationStepGrid({
  steps,
  completedStepIds = [],
  failedStepIds = [],
}: {
  steps: SimulationStepLike[];
  completedStepIds?: readonly string[];
  failedStepIds?: readonly string[];
}) {
  const rows = useMemo(() => [...steps].sort((a, b) => a.sequence - b.sequence), [steps]);
  if (!rows.length) return null;
  const done = new Set(completedStepIds);
  const failed = new Set(failedStepIds);
  const okCount = rows.filter((step) => done.has(step.stepId)).length;

  return (
    <div className="ds-chart">
      <div className="ds-chart__head">
        <span className="ds-chart__title">推演步骤回执</span>
        <span className="ds-chart__note">{okCount}/{rows.length} 步已回执</span>
      </div>
      <div className="ds-steps">
        {rows.map((step, index) => {
          const state = stepCellState(step.stepId, done, failed);
          return (
            <div
              className={`ds-steps__cell ds-steps__cell--${state}`}
              key={step.stepId}
              title={`${step.sequence}. ${step.title}`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <b>{step.sequence}</b>
              <span>{step.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 单步回执状态：失败优先于完成，未回执即 idle */
export function stepCellState(stepId: string, completed: Set<string>, failed: Set<string>) {
  if (failed.has(stepId)) return 'bad';
  if (completed.has(stepId)) return 'ok';
  return 'idle';
}

export type WaterSourceLike = {
  id: string;
  code?: string | null;
  distanceKm: number;
  usability?: string;
  role?: string | null;
};

/** 水源距离分布（真实 plan.routeWater.waterSources） */
/** 预案栏宽度有限，只画最近 6 条；条数标注仍报全量，避免看起来只检索到 6 个 */
const WATER_BAR_LIMIT = 6;

export function WaterSourceBars({ sources }: { sources: WaterSourceLike[] }) {
  const rows = useMemo(
    () => [...sources].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, WATER_BAR_LIMIT),
    [sources],
  );
  if (!rows.length) return null;
  const max = Math.max(...rows.map((entry) => entry.distanceKm), 0.1);
  const available = sources.filter((entry) => entry.usability === 'available').length;

  return (
    <div className="ds-chart">
      <div className="ds-chart__head">
        <span className="ds-chart__title">周边水源直线距离</span>
        <span className="ds-chart__note">
          近 {rows.length}/{sources.length} 条 · 可用 {available}
        </span>
      </div>
      <div className="ds-bars">
        {rows.map((entry, index) => {
          const state = waterBarState(entry.usability);
          const roleTag = entry.role === 'primary' ? '主' : entry.role === 'backup' ? '备' : '';
          return (
            <div className={`ds-bars__row ds-bars__row--${state}`} key={entry.id}>
              <span className="ds-bars__label">{entry.code || entry.id.slice(-6)}{roleTag && <b>{roleTag}</b>}</span>
              <div className="ds-bars__track">
                <div
                  className="ds-bars__fill"
                  style={{ width: `${Math.max((entry.distanceKm / max) * 100, 3)}%`, animationDelay: `${index * 0.06}s` }}
                />
              </div>
              <span className="ds-bars__value">{entry.distanceKm.toFixed(2)} km</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 水源可用性配色：available=ok，unavailable=bad，其余（含台账空值）按未核实处理 */
export function waterBarState(usability?: string) {
  if (usability === 'available') return 'ok';
  if (usability === 'unavailable') return 'bad';
  return 'warn';
}

/** 需求书 §10 的八状态流转，按真实 plan.lifecycleStatus 定位当前节点 */
const LIFECYCLE_STAGES = [
  { key: 'draft', label: '草稿' },
  { key: 'pending_manual_review', label: '待复核' },
  { key: 'approved', label: '已复核' },
  { key: 'simulation_running', label: '推演中' },
  { key: 'simulation_completed', label: '推演完成' },
  { key: 'issued', label: '已签发' },
  { key: 'archived', label: '已归档' },
] as const;

/**
 * 单节点状态。failed 不在主链上，整链标红；status 不在链上（未知值）则全部 idle，
 * 不猜测进度——猜错会让指挥员以为预案已过了某个环节。
 */
export function lifecycleNodeState(index: number, activeIndex: number, failed: boolean) {
  if (failed) return 'bad';
  if (activeIndex < 0) return 'idle';
  if (index < activeIndex) return 'done';
  return index === activeIndex ? 'active' : 'idle';
}

export function lifecycleActiveIndex(status: string) {
  return LIFECYCLE_STAGES.findIndex((stage) => stage.key === status);
}

export function LifecycleProgress({ status }: { status: string }) {
  // failed 不在主链上：显示为整链告警而不是某一节点。
  const failed = status === 'failed';
  const activeIndex = lifecycleActiveIndex(status);
  return (
    <div className="ds-chart">
      <div className="ds-chart__head">
        <span className="ds-chart__title">预案状态流转</span>
        <span className="ds-chart__note">{failed ? '存在失败状态' : LIFECYCLE_STAGES[activeIndex]?.label ?? '未知状态'}</span>
      </div>
      <div className="ds-flow">
        {LIFECYCLE_STAGES.map((stage, index) => {
          const state = lifecycleNodeState(index, activeIndex, failed);
          return (
            <div className={`ds-flow__node ds-flow__node--${state}`} key={stage.key}>
              <i />
              <span>{stage.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
