'use client';

import { useEffect, useRef, useState } from 'react';
import {
  bindFireSimulationEvents,
  createFireSimulationController,
  createUStudioAdapter,
  dispatchFireSimulationState,
  type SimulationActionStatus,
  type FireSimulationAdapter,
  type FireSimulationController,
  type SimulationPlan,
  type SimulationSnapshot,
} from '@/lib/fire-simulation';
import styles from './FireSimulationPanel.module.css';
import { withBasePath } from '@/lib/client-path';

const STATUS_LABEL: Record<SimulationActionStatus, string> = {
  pending: '等待',
  running: '执行中',
  success: '成功',
  skipped: '跳过',
  degraded: '降级',
  failed: '失败',
};

const STATE_LABEL: Record<string, string> = {
  idle: '空闲',
  running: '推演中',
  paused: '已暂停',
  completed: '已完成',
  resetting: '复位中',
  error: '错误',
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type FireSimulationPanelProps = {
  /** Optional plan for isolated SDK tests; normal runs arrive from the command bridge. */
  initialPlan?: SimulationPlan;
  /** 覆盖场景 ID（默认读取 window.__sceneId）。 */
  sceneId?: string;
  /** 无画面执行模式：启动认领/驱动/回执循环，但不渲染任何面板（供三维工程保持画面干净）。 */
  minimal?: boolean;
};

export function FireSimulationPanel({
  initialPlan,
  sceneId,
  minimal = false,
}: FireSimulationPanelProps) {
  const adapterRef = useRef<FireSimulationAdapter | null>(null);
  const controllerRef = useRef<FireSimulationController | null>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const reportedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const adapter = createUStudioAdapter({
      getSceneId: () =>
        sceneId ?? (typeof window !== 'undefined' ? window.__sceneId : undefined),
    });
    const controller = createFireSimulationController({
      adapter,
      onStateChange: (snap) => {
        setSnapshot(snap);
        dispatchFireSimulationState(snap);
      },
    });
    adapterRef.current = adapter;
    controllerRef.current = controller;
    const unbind = bindFireSimulationEvents(controller);
    let pollTimer: number | undefined;
    let stopped = false;
    const pollSimulation = async () => {
      if (stopped || activeRunIdRef.current) return;
      const activeSceneId = sceneId ?? (typeof window !== 'undefined' ? window.__sceneId : undefined) ?? '';
      if (activeSceneId) {
        const response = await fetch(withBasePath(`/simulations/pending?sceneId=${encodeURIComponent(activeSceneId)}`), { cache: 'no-store' }).catch(() => null);
        const payload = response?.ok ? await response.json().catch(() => null) as { run?: { runId: string; plan: SimulationPlan } } | null : null;
        if (payload?.run) {
          activeRunIdRef.current = payload.run.runId;
          reportedRunIdRef.current = null;
          try {
            // Clear the previous controller state before accepting another
            // bridge run. This prevents a completed first run from leaking
            // its step results into the next incident.
            if (controller.getSnapshot().plan) await controller.reset();
            controller.load(payload.run.plan);
            void controller.start();
          } catch (error) {
            setLoadError(error instanceof Error ? error.message : '远程推演计划非法');
          }
          return;
        }
      }
      pollTimer = window.setTimeout(() => void pollSimulation(), 500);
    };
    const resumePolling = () => {
      if (stopped || activeRunIdRef.current) return;
      if (pollTimer) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => void pollSimulation(), 100);
    };
    window.addEventListener('fire-simulation-run-finished', resumePolling);
    pollTimer = window.setTimeout(() => void pollSimulation(), 500);
    if (initialPlan) {
      try {
        controller.load(initialPlan);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : '计划加载失败');
      }
    } else {
      setSnapshot(controller.getSnapshot());
    }
    return () => {
      stopped = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      window.removeEventListener('fire-simulation-run-finished', resumePolling);
      unbind();
      void controller.dispose();
      adapterRef.current = null;
      controllerRef.current = null;
    };
    // 仅在挂载时创建一次控制器；后续通过事件 / 控件驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const runId = activeRunIdRef.current;
    if (!runId || !snapshot || (snapshot.state !== 'completed' && snapshot.state !== 'error')) return;
    if (reportedRunIdRef.current === runId) return;
    reportedRunIdRef.current = runId;
    // 需求书 §11：回执如实反映"哪些完成、哪些未完成、哪些等待真实数据"。
    // 只有全部动作 success（真实场景动作）或 skipped（NOTE/WAIT 非视觉）才算完成；
    // hard failed（SDK/对象错误）算失败；degraded（DATA_GAP=缺真实数据）应视为"待补数据"，
    // 归入 unavailable，绝不算失败，也绝不算已完成。
    const isCompletedStep = (results: Array<{ status: SimulationActionStatus }>): boolean =>
      results.length > 0 && results.every((result) => result.status === 'success' || result.status === 'skipped');
    const hasHardFailure = (results: Array<{ status: SimulationActionStatus }>): boolean =>
      results.some((result) => result.status === 'failed');
    const hasDataGap = (results: Array<{ status: SimulationActionStatus }>): boolean =>
      results.some((result) => result.status === 'degraded');
    const stepRows = Object.entries(snapshot.stepResults);
    const anyHardFailure = stepRows.some(([, results]) => hasHardFailure(results));
    const anyDataGap = stepRows.some(([, results]) => hasDataGap(results));
    // 硬失败 → failed；仅数据缺口(降级) → unavailable(待真实数据)；全成功 → completed。
    const status = anyHardFailure ? 'failed'
      : (snapshot.state === 'completed' && !anyDataGap) ? 'completed'
        : 'unavailable';
    void (async () => {
      let reported = false;
      try {
        const response = await fetch(withBasePath(`/simulations/${encodeURIComponent(runId)}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            completedStepIds: stepRows.filter(([, results]) => isCompletedStep(results)).map(([stepId]) => stepId),
            failedStepIds: stepRows.filter(([, results]) => hasHardFailure(results)).map(([stepId]) => stepId),
            detail: status === 'completed' ? '三维推演已完成。'
              : status === 'unavailable'
                ? '部分步骤缺少真实场景数据（路线/水源/力量等），已保留待补数据状态。'
                : snapshot.error?.message || '三维推演存在失败项。',
          }),
        });
        reported = response.ok;
      } catch {
        reported = false;
      }
      if (!reported) reportedRunIdRef.current = null;
      activeRunIdRef.current = null;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('fire-simulation-run-finished'));
    })();
  }, [snapshot]);

  const ctrl = controllerRef.current;
  const snap = snapshot;
  if (minimal) return null;
  if (!snap) return null;

  const state = snap.state;
  const isRunning = state === 'running';
  const hasPlan = !!snap.plan;
  const onPrimary = (): void => {
    if (!ctrl) return;
    if (state === 'paused') void ctrl.resume();
    else void ctrl.start();
  };
  const primaryLabel = isRunning
    ? '推演中…'
    : state === 'paused'
      ? '继续'
      : state === 'completed'
        ? '重新推演'
        : '开始推演';

  return (
    <section className={styles.panel} aria-label="三维推演面板">
      <div className={styles.header}>
        <div>
          <h2 className={styles.headerTitle}>{snap.plan?.title ?? '三维推演'}</h2>
          {snap.plan && <div className={styles.headerEvent}>事件编号：{snap.plan.eventId}</div>}
        </div>
        <span className={`${styles.badge} ${styles['badge' + capitalize(state)]}`}>
          {STATE_LABEL[state] ?? state}
        </span>
      </div>

      <div className={styles.body}>
        {!hasPlan && (
          <div className={styles.empty}>
            <div>等待指挥台人工复核后下发精简三维推演。</div>
          </div>
        )}

        {hasPlan && (
          <>
            <div className={styles.progress}>
              <span>
                第 {snap.currentStepIndex + 1}/{snap.totalSteps} 步
              </span>
              <span>
                {snap.progress.current}/{snap.totalSteps}
              </span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${(snap.progress.current / Math.max(1, snap.totalSteps)) * 100}%`,
                }}
              />
            </div>

            {snap.currentStep && (
              <>
                <div className={styles.stepTitle}>{snap.currentStep.title}</div>
                <p className={styles.stepDesc}>{snap.currentStep.description}</p>
              </>
            )}

            <ul className={styles.actions}>
              {snap.currentStepResults.length === 0 && (
                <li className={styles.actionItem}>
                  <span className={`${styles.actionDot} ${styles.dotPending}`} />
                  <div className={styles.actionMain}>
                    <div className={styles.actionType}>等待执行</div>
                  </div>
                </li>
              )}
              {snap.currentStepResults.map((r) => (
                <li key={r.actionIndex} className={styles.actionItem}>
                  <span className={`${styles.actionDot} ${styles['dot' + capitalize(r.status)]}`} />
                  <div className={styles.actionMain}>
                    <div className={styles.actionType}>
                      {r.actionType} · {STATUS_LABEL[r.status]}
                    </div>
                    {(r.message || r.errorCode) && (
                      <div className={styles.actionMsg}>
                        {r.message ?? ''}
                        {r.errorCode ? ` [${r.errorCode}]` : ''}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {snap.error && (
              <div className={styles.errorBox}>
                错误 [{snap.error.code}]：{snap.error.message}
              </div>
            )}
          </>
        )}

        {loadError && <div className={styles.errorBox}>{loadError}</div>}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={isRunning || !hasPlan}
          onClick={onPrimary}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!isRunning}
          onClick={() => ctrl?.pause()}
        >
          暂停
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={isRunning || !hasPlan || state === 'completed' || snap.currentStepIndex <= 0}
          onClick={() => void ctrl?.previous()}
        >
          上一步
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={isRunning || !hasPlan || state === 'completed'}
          onClick={() => void ctrl?.next()}
        >
          下一步
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          disabled={isRunning || !hasPlan}
          onClick={() => void ctrl?.replay()}
        >
          重放
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!hasPlan}
          onClick={() => void ctrl?.reset()}
        >
          复位
        </button>
      </div>
    </section>
  );
}
