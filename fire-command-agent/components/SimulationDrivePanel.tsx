'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, LoaderCircle } from 'lucide-react';
import { SimulationStepGrid } from './DashboardCharts';
import { isUnifiedFireRescuePlan, type UnifiedFireRescuePlan } from '@/lib/plan-contract';
import { clientPath } from '@/lib/client-path';

type RunPayload = { run?: { runId: string; status: string; completedStepIds?: string[]; failedStepIds?: string[]; detail?: string } | null; message?: string };

const STATUS_LABEL: Record<string, string> = {
  idle: '未开始',
  queued: '排队中',
  running: '推演中',
  completed: '已完成',
  failed: '失败',
  unavailable: '部分步骤缺数据',
  reset: '已复位',
};

export function SimulationDrivePanel({ plan }: { plan: UnifiedFireRescuePlan | null }) {
  const [fallbackPlan, setFallbackPlan] = useState<UnifiedFireRescuePlan | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [failedStepIds, setFailedStepIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  // 页面刷新或当前 run 无回执时，从库读取最近一份预案，保证「开始推演」始终可用。
  useEffect(() => {
    if (plan) return;
    let active = true;
    setFallbackPlan(null);
    fetch(clientPath('/api/plans?limit=1'), { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active) return;
        const plans = Array.isArray(payload?.plans) ? payload.plans : [];
        setFallbackPlan(isUnifiedFireRescuePlan(plans[0]) ? plans[0] : null);
      })
      .catch(() => { if (active) setFallbackPlan(null); });
    return () => { active = false; };
  }, [plan]);

  const activePlan = plan ?? fallbackPlan;

  const stopPoll = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const pollRun = useCallback(async (runId: string) => {
    stopPoll();
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(clientPath(`/api/scene/simulations/${encodeURIComponent(runId)}`), { cache: 'no-store' });
        const payload = (await response.json()) as RunPayload;
        if (payload.run) {
          setStatus(payload.run.status);
          setCompletedStepIds(payload.run.completedStepIds ?? []);
          setFailedStepIds(payload.run.failedStepIds ?? []);
          setDetail(payload.run.detail ?? '');
          if (['completed', 'failed', 'unavailable', 'reset'].includes(payload.run.status)) {
            stopPoll();
          }
        }
      } catch {
        // 忽略瞬时查询错误。
      }
    }, 700);
  }, []);

  const start = async () => {
    if (!activePlan) return;
    setBusy(true);
    setError(null);
    setStatus('running');
    setCompletedStepIds([]);
    setFailedStepIds([]);
    try {
      const response = await fetch(clientPath('/api/scene/simulations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: activePlan.planId,
          sceneId: activePlan.spatialTarget.sceneId,
          mappings: activePlan.simulation.mappings.map((m) => ({ stepId: m.stepId, sequence: m.sequence, title: m.title, actionId: m.actionId })),
          floorId: activePlan.spatialTarget.floorId,
          floor: activePlan.spatialTarget.floor,
          roomId: activePlan.spatialTarget.roomId,
          room: activePlan.spatialTarget.room,
        }),
      });
      const payload = (await response.json()) as RunPayload;
      if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
      if (payload.run?.runId) {
        runIdRef.current = payload.run.runId;
        setStatus('running');
        void pollRun(payload.run.runId);
      } else {
        setStatus('idle');
      }
    } catch (e) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : '三维推演启动失败');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    stopPoll();
    return () => {
      stopPoll();
      runIdRef.current = null;
    };
  }, []);

  const steps = activePlan?.simulation.mappings ?? [];

  return (
    <div className="simulation-drive-panel">
      <header className="simulation-drive-panel__head">
        <span className="simulation-drive-panel__title">三维推演 · {activePlan?.spatialTarget?.floor || '—'} {activePlan?.spatialTarget?.room || ''}</span>
        <span className="simulation-drive-panel__status">状态：{STATUS_LABEL[status] ?? status}</span>
      </header>
      {!activePlan ? (
        <div className="simulation-drive-panel__empty">暂无可用预案。请先在对话栏提交火情生成预案，或进入「预案详情」查看已生成预案。</div>
      ) : (
        <>
          <div className="scene-panel__charts">
            <SimulationStepGrid steps={steps} completedStepIds={completedStepIds} failedStepIds={failedStepIds} />
          </div>
          {detail && <div className="simulation-drive-panel__detail">{detail}</div>}
          {error && <div className="zone-deploy-card__error">{error}</div>}
          <div className="simulation-drive-panel__actions">
            <button type="button" className="simulation-drive-panel__btn simulation-drive-panel__btn--primary" onClick={() => void start()} disabled={busy}>
              {busy ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />} 开始推演
            </button>
            <button type="button" className="simulation-drive-panel__btn" onClick={() => { stopPoll(); setStatus('idle'); setCompletedStepIds([]); setFailedStepIds([]); }} disabled={busy}>
              <RotateCcw size={13} /> 重置
            </button>
          </div>
        </>
      )}
    </div>
  );
}
