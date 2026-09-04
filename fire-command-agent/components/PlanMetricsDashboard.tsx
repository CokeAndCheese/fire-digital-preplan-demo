/**
 * 预案态势实时指标层
 *
 * 可视化大屏风格的动态指标面板，所有动效映射真实数据变化：
 * - Orchestration 调用链：Skill 调用次数、总耗时、成功率
 * - Evidence 证据流：5 种证据来源的分布与核验状态
 * - Audit 事件流：生命周期事件时间线
 * - Phase 转换：9 阶段状态机进度
 * - Performance 性能：平均响应时长、最慢调用识别
 *
 * 设计原则：
 * - 数字跳动 → 真实数据变化驱动（CountUp 动画）
 * - 流动渐变 → 证据核验进度流动
 * - 脉冲效果 → 新 Skill 调用事件触发
 * - 时间线粒子 → Orchestration 调用序列可视化
 */

'use client';

import { Activity, CheckCircle2, Clock, Database, GitBranch, Zap } from 'lucide-react';
import type { UnifiedFireRescuePlan } from '@/lib/plan-contract';
import type { LiveExecutionRun } from './ExecutionMonitor';
import { useEffect, useRef, useState } from 'react';

export type MetricsSnapshot = {
  totalCalls: number;
  totalDurationMs: number;
  successRate: number;
  evidenceCount: number;
  verifiedCount: number;
  auditEventCount: number;
  simulationSteps: number;
  averageCallMs: number;
  phasesPassed: number;
  totalPhases: number;
};

/**
 * 从预案与执行流中提取实时指标。
 *
 * 全部取自真实数据链，无模拟值：
 * - orchestration[]：Skill 调用次数、各次 durationMs、succeeded/degraded/failed
 * - evidenceRefs[]：证据条数与 verified 占比
 * - auditEvents[]：生命周期事件数
 * - simulation.mappings[]：推演步骤数（8 步旧版 / 11 步新版）
 * - run.phases[]：执行阶段状态机进度
 */
export function extractMetrics(
  plan: UnifiedFireRescuePlan | null,
  run: LiveExecutionRun | null
): MetricsSnapshot | null {
  if (!plan) return null;

  const totalCalls = plan.orchestration.length;
  const totalDurationMs = plan.orchestration.reduce((sum, call) => sum + call.durationMs, 0);
  const successCount = plan.orchestration.filter((call) => call.status === 'succeeded').length;
  const successRate = totalCalls > 0 ? (successCount / totalCalls) * 100 : 0;

  const evidenceCount = plan.evidenceRefs.length;
  const verifiedCount = plan.evidenceRefs.filter((ref) => ref.status === 'verified').length;

  const auditEventCount = plan.auditEvents.length;
  const simulationSteps = plan.simulation.mappings.length;
  const averageCallMs = totalCalls > 0 ? Math.round(totalDurationMs / totalCalls) : 0;

  const phasesPassed = run ? run.phases.filter((p) => p.status === 'done').length : 0;
  const totalPhases = run ? run.phases.length : 9;

  return {
    totalCalls,
    totalDurationMs,
    successRate,
    evidenceCount,
    verifiedCount,
    auditEventCount,
    simulationSteps,
    averageCallMs,
    phasesPassed,
    totalPhases,
  };
}

function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const start = previousValueRef.current;
    const end = value;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const current = Math.round(start + (end - start) * eased);
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        previousValueRef.current = end;
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return <span className="metrics-animated-number">{displayValue}</span>;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  trend,
  color,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: number;
  unit?: string;
  trend?: 'up' | 'stable' | 'down';
  color?: 'teal' | 'amber' | 'red' | 'blue';
}) {
  return (
    <div className={`metrics-card metrics-card--${color || 'teal'}`}>
      <div className="metrics-card__icon">
        <Icon size={16} />
      </div>
      <div className="metrics-card__content">
        <span className="metrics-card__label">{label}</span>
        <div className="metrics-card__value-row">
          <strong className="metrics-card__value">
            <AnimatedNumber value={value} />
            {unit && <span className="metrics-card__unit">{unit}</span>}
          </strong>
          {trend && <span className={`metrics-card__trend metrics-card__trend--${trend}`} />}
        </div>
      </div>
    </div>
  );
}

function EvidenceFlowBar({ verified, total }: { verified: number; total: number }) {
  const percentage = total > 0 ? (verified / total) * 100 : 0;

  return (
    <div className="evidence-flow-bar">
      <div className="evidence-flow-bar__track">
        <div className="evidence-flow-bar__fill" style={{ width: `${percentage}%` }}>
          <div className="evidence-flow-bar__shimmer" />
        </div>
      </div>
      <span className="evidence-flow-bar__label">
        证据核验：<strong>{verified}</strong>/{total} ({Math.round(percentage)}%)
      </span>
    </div>
  );
}

function OrchestrationTimeline({ plan }: { plan: UnifiedFireRescuePlan }) {
  // 色块按各次调用占本轮总耗时的比例分配宽度。
  // 用 flex-grow 而非百分比宽度：百分比之和会超过 100% 撑破容器，
  // 且固定 ms 基准在慢速链路下会让所有色块顶到满宽、失去区分度。
  const totalMs = plan.orchestration.reduce((sum, call) => sum + call.durationMs, 0);

  return (
    <div className="orchestration-timeline">
      <div className="orchestration-timeline__track">
        {plan.orchestration.map((call, index) => {
          const statusColor = call.status === 'succeeded' ? 'teal' : call.status === 'degraded' ? 'amber' : 'red';
          // 0ms 调用（纯本地规则计算）仍需可见，故给最小占比兜底。
          const share = totalMs > 0 ? call.durationMs / totalMs : 0;
          return (
            <div
              key={`${call.invocationId}-${index}`}
              className={`orchestration-timeline__call orchestration-timeline__call--${statusColor}`}
              style={{ flexGrow: Math.max(share, 0.06), flexBasis: 0 }}
              title={`${call.skillId}.${call.actionId} · ${call.durationMs}ms · ${call.status}`}
            >
              <span className="orchestration-timeline__seq">{call.sequence}</span>
            </div>
          );
        })}
      </div>
      <div className="orchestration-timeline__legend">
        <span>Skill 调用序列（色块宽度 = 耗时）</span>
        <div className="orchestration-timeline__legend-items">
          <span>
            <i className="orchestration-timeline__legend-dot orchestration-timeline__legend-dot--teal" />
            成功
          </span>
          <span>
            <i className="orchestration-timeline__legend-dot orchestration-timeline__legend-dot--amber" />
            降级
          </span>
          <span>
            <i className="orchestration-timeline__legend-dot orchestration-timeline__legend-dot--red" />
            失败
          </span>
        </div>
      </div>
    </div>
  );
}

export function PlanMetricsDashboard({ plan, run }: { plan: UnifiedFireRescuePlan | null; run: LiveExecutionRun | null }) {
  const metrics = extractMetrics(plan, run);
  const [pulse, setPulse] = useState(false);

  // 触发脉冲动画：orchestration 调用次数变化时
  useEffect(() => {
    if (metrics && metrics.totalCalls > 0) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(timer);
    }
  }, [metrics?.totalCalls]);

  if (!metrics || !plan) {
    return (
      <div className="metrics-dashboard metrics-dashboard--empty">
        <Activity size={20} className="metrics-dashboard__empty-icon" />
        <span>等待预案数据流...</span>
      </div>
    );
  }

  return (
    <div className={`metrics-dashboard ${pulse ? 'metrics-dashboard--pulse' : ''}`}>
      {/* 顶部实时指标卡片网格 */}
      <div className="metrics-dashboard__grid">
        <MetricCard icon={GitBranch} label="Skill 调用" value={metrics.totalCalls} color="teal" trend="stable" />
        <MetricCard icon={Zap} label="总耗时" value={metrics.totalDurationMs} unit="ms" color="amber" />
        <MetricCard
          icon={CheckCircle2}
          label="成功率"
          value={Math.round(metrics.successRate)}
          unit="%"
          color={metrics.successRate === 100 ? 'teal' : 'amber'}
        />
        <MetricCard icon={Clock} label="平均响应" value={metrics.averageCallMs} unit="ms" color="blue" />
        <MetricCard icon={Database} label="审计事件" value={metrics.auditEventCount} color="teal" />
        <MetricCard
          icon={Activity}
          label="推演步骤"
          value={metrics.simulationSteps}
          unit={metrics.simulationSteps === 11 ? '/11' : '/8'}
          color="teal"
        />
      </div>

      {/* 证据核验流动条 */}
      <EvidenceFlowBar verified={metrics.verifiedCount} total={metrics.evidenceCount} />

      {/* Orchestration 调用时间线 */}
      {plan.orchestration.length > 0 && <OrchestrationTimeline plan={plan} />}

      {/* 阶段进度指示 */}
      {run && (
        <div className="metrics-phase-progress">
          <span className="metrics-phase-progress__label">执行阶段进度</span>
          <div className="metrics-phase-progress__bar">
            <div
              className="metrics-phase-progress__fill"
              style={{ width: `${(metrics.phasesPassed / metrics.totalPhases) * 100}%` }}
            />
          </div>
          <span className="metrics-phase-progress__count">
            {metrics.phasesPassed} / {metrics.totalPhases}
          </span>
        </div>
      )}
    </div>
  );
}
