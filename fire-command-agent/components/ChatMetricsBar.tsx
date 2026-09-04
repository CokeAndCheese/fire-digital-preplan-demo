'use client';

import { Activity, Zap, CheckCircle2, Clock } from 'lucide-react';
import type { UnifiedFireRescuePlan } from '@/lib/plan-contract';
import type { LiveExecutionRun } from './ExecutionMonitor';
import { useEffect, useRef, useState } from 'react';

interface MetricsSnapshot {
  orchestrationCalls: number;
  totalDurationMs: number;
  successRate: number;
  evidenceCount: number;
  verifiedCount: number;
  avgCallDurationMs: number;
}

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
  const avgCallDurationMs = totalCalls > 0 ? totalDurationMs / totalCalls : 0;
  return {
    orchestrationCalls: totalCalls,
    totalDurationMs,
    successRate,
    evidenceCount,
    verifiedCount,
    avgCallDurationMs,
  };
}

function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(value);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const start = display;
    const delta = value - start;
    if (Math.abs(delta) < 0.01) return;
    const duration = 800;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + delta * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, display]);
  return <>{display.toFixed(decimals)}</>;
}

export function ChatMetricsBar({
  plan,
  run,
}: {
  plan: UnifiedFireRescuePlan | null;
  run: LiveExecutionRun | null;
}) {
  const metrics = extractMetrics(plan, run);
  if (!metrics) return null;
  const isRunning = run?.status === 'running' || run?.status === 'waiting';

  return (
    <div className="chat-metrics-bar">
      <div className="chat-metrics-bar__shimmer" />
      <div className="chat-metrics-bar__content">
        <div className="chat-metric">
          <Activity size={14} className="chat-metric__icon" />
          <span className="chat-metric__value">
            <AnimatedNumber value={metrics.orchestrationCalls} />
          </span>
          <span className="chat-metric__label">编排调用</span>
        </div>
        <div className="chat-metric">
          <Clock size={14} className="chat-metric__icon" />
          <span className="chat-metric__value">
            <AnimatedNumber value={metrics.avgCallDurationMs} decimals={0} />
            <small>ms</small>
          </span>
          <span className="chat-metric__label">平均耗时</span>
        </div>
        <div className="chat-metric">
          <CheckCircle2 size={14} className="chat-metric__icon chat-metric__icon--success" />
          <span className="chat-metric__value">
            <AnimatedNumber value={metrics.successRate} decimals={1} />%
          </span>
          <span className="chat-metric__label">成功率</span>
        </div>
        <div className="chat-metric">
          <Zap size={14} className="chat-metric__icon chat-metric__icon--evidence" />
          <span className="chat-metric__value">
            {metrics.verifiedCount}/{metrics.evidenceCount}
          </span>
          <span className="chat-metric__label">证据链</span>
        </div>
        {isRunning && <div className="chat-metrics-bar__pulse" />}
      </div>
    </div>
  );
}
