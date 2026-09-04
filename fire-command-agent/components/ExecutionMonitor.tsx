'use client';

import {
  Activity,
  Check,
  CircleAlert,
  Clock3,
  FileSearch,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentStreamEvent, AuditRecord, PresentationStatus } from '@/lib/agent/types';
import { sanitizePublicText } from '@/lib/agent/message-reducer';
import { isUnifiedFireRescuePlan, type UnifiedFireRescuePlan } from '@/lib/plan-contract';
import { ManualReviewActions, type ManualReviewDecision } from './ManualReviewActions';

export type ExecutionStatus = 'pending' | 'running' | 'done' | 'waiting' | 'error';

export type ExecutionPhase = {
  id: string;
  title: string;
  detail: string;
  status: ExecutionStatus;
};

export type LiveExecutionRun = {
  id: string;
  task: string;
  source: 'unknown' | 'local' | 'upstream';
  status: Exclude<ExecutionStatus, 'pending'>;
  progress: number;
  currentTitle: string;
  currentDetail: string;
  startedAt: number;
  finishedAt?: number;
  phases: ExecutionPhase[];
  toolName?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  audit: AuditRecord[];
  partialFailure?: boolean;
  manualReview?: boolean;
  /** Prevents a handled review from being re-armed by late stream events. */
  reviewHandled?: boolean;
  awaitingApproval?: boolean;
};

/**
 * 从 Skill 回执里取出当前运行的预案。
 * 与 LiveExecutionRun 同处一个模块，避免各面板各写一份产生口径漂移。
 */
export function planFromRun(run: LiveExecutionRun | null): UnifiedFireRescuePlan | null {
  const data = run?.output?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const plan = (data as Record<string, unknown>).plan;
  return isUnifiedFireRescuePlan(plan) ? plan : null;
}

const PHASES: Array<Pick<ExecutionPhase, 'id' | 'title'>> = [
  { id: 'received', title: '火情输入' },
  { id: 'intent', title: '智能研判' },
  { id: 'parameters', title: '要素提取' },
  { id: 'skill', title: 'Skill 协同' },
  { id: 'approval', title: '人工复核' },
  { id: 'bridge', title: '连接数据源' },
  { id: 'execute', title: '执行能力' },
  { id: 'result', title: '结构化结果' },
  { id: 'complete', title: '指标归档' },
];

const FIELD_LABELS: Record<string, string> = {
  address: '地址',
  building: '建筑',
  burnArea: '过火面积',
  fireType: '火灾类型',
  floor: '楼层',
  level: '响应等级',
  mode: '视图',
  radiusKm: '查询半径',
  reviewer: '复核人',
  room: '空间',
  sceneType: '场所类型',
  trappedCount: '被困人数',
};

function parseRecord(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function upsertAudit(records: AuditRecord[], next: AuditRecord) {
  const index = records.findIndex((record) => record.callId === next.callId);
  if (index < 0) return [...records, next];
  return records.map((record, cursor) => cursor === index ? { ...record, ...next } : record);
}

function auditLabel(status: PresentationStatus) {
  if (status === 'running') return '执行中';
  if (status === 'success') return '成功';
  if (status === 'waiting') return '待复核';
  if (status === 'offline') return '平台离线';
  return '失败';
}

function auditJson(value: unknown) {
  if (value === undefined) return '未返回';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function hasStructuredPlan(output?: Record<string, unknown>) {
  const data = output?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const plan = (data as Record<string, unknown>).plan;
  return isUnifiedFireRescuePlan(plan);
}

function hasFailedAudit(run: LiveExecutionRun) {
  return run.audit.some((record) => record.status === 'failed');
}

function phaseAfterRemoteFinish(run: LiveExecutionRun, needsReview: boolean, failureTool?: string) {
  return run.phases.map((phase) => {
    if (phase.id === 'approval' && needsReview) {
      return { ...phase, status: 'waiting' as const, detail: failureTool ? `${failureTool} 失败，等待指挥员复核` : '等待指挥员复核' };
    }
    if (phase.id === 'result' && needsReview) {
      return { ...phase, status: 'waiting' as const, detail: '部分研判已返回，结构化预案尚未完成' };
    }
    if (phase.id === 'complete' && needsReview) {
      return { ...phase, status: 'pending' as const, detail: '待复核后归档' };
    }
    if (phase.status === 'running' && needsReview) {
      return { ...phase, status: 'waiting' as const };
    }
    return phase;
  });
}

export function createLiveExecution(task: string): LiveExecutionRun {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    task,
    source: 'unknown',
    status: 'running',
    progress: 3,
    currentTitle: '火情输入',
    currentDetail: '火情信息已进入闭环编排队列',
    startedAt: Date.now(),
    phases: PHASES.map((phase, index) => ({
      ...phase,
      detail: index === 0 ? '等待服务端确认' : '待执行',
      status: index === 0 ? 'running' : 'pending',
    })),
    audit: [],
  };
}

export function applyExecutionEvent(run: LiveExecutionRun, event: AgentStreamEvent): LiveExecutionRun {
  if (event.type === 'progress' && event.phase) {
    if (run.status === 'error') return run;
    const eventStatus = event.status ?? 'running';
    const phases = run.phases.map((phase) => {
      if (phase.id === event.phase) {
        return {
          ...phase,
          title: event.title || phase.title,
          detail: event.description || event.content || phase.detail,
          status: eventStatus,
        };
      }
      if (eventStatus !== 'waiting' && phase.status === 'running') return { ...phase, status: 'done' as const };
      return phase;
    });
    const businessBlocked = run.partialFailure || run.manualReview || hasFailedAudit(run);
    const status = eventStatus === 'error'
      ? 'error'
      : eventStatus === 'waiting'
        ? 'waiting'
        : event.phase === 'complete' && eventStatus === 'done' && !businessBlocked
          ? 'done'
          : 'running';
    const safeStatus = businessBlocked && status === 'running' ? 'waiting' : status;
    return {
      ...run,
      source: 'local',
      phases,
      status: safeStatus,
      progress: safeStatus === 'waiting' ? Math.min(96, event.progress ?? run.progress) : event.progress ?? run.progress,
      currentTitle: event.title || run.currentTitle,
      currentDetail: event.description || event.content || run.currentDetail,
      finishedAt: safeStatus === 'done' || safeStatus === 'error' ? Date.now() : run.finishedAt,
    };
  }
  if (event.type === 'tool-call') {
    const upstreamTool = run.source !== 'local';
    const callId = event.toolCallId || `${run.id}-tool`;
    const existing = run.audit.find((record) => record.callId === callId);
    const audit = upsertAudit(run.audit, {
      callId,
      toolName: event.toolName || '未命名工具',
      status: 'running',
      input: parseRecord(event.args),
      startedAt: existing?.startedAt ?? Date.now(),
      replayable: true,
    });
    return {
      ...run,
      audit,
      source: upstreamTool ? 'upstream' : run.source,
      status: 'running',
      toolName: event.toolName,
      input: parseRecord(event.args) ?? run.input,
      progress: upstreamTool ? Math.max(run.progress, 64) : run.progress,
      currentTitle: upstreamTool ? '八维通正在调用工具' : run.currentTitle,
      currentDetail: upstreamTool ? (event.toolName || '工具调用已开始') : run.currentDetail,
      phases: upstreamTool ? run.phases.map((phase) => ['received', 'intent', 'parameters'].includes(phase.id)
        ? { ...phase, status: 'done' }
        : phase.id === 'skill' || phase.id === 'bridge'
          ? { ...phase, status: 'running', detail: event.toolName || '工具调用已开始' }
          : phase.id === 'approval'
            ? { ...phase, status: run.manualReview || run.partialFailure ? 'waiting' : 'pending', detail: run.manualReview || run.partialFailure ? '等待指挥员复核' : '尚未收到复核请求' }
        : phase.id === 'execute'
          ? { ...phase, status: 'running', detail: event.toolName || '工具调用已开始' }
          : phase) : run.phases,
    };
  }
  if (event.type === 'tool-approval-request') {
    const callId = event.toolCallId || `${run.id}-tool`;
    const existing = run.audit.find((record) => record.callId === callId);
    return {
      ...run,
      audit: upsertAudit(run.audit, {
        callId,
        toolName: event.toolName || existing?.toolName || '待复核动作',
        status: 'waiting',
        input: existing?.input,
        startedAt: existing?.startedAt ?? Date.now(),
        replayable: true,
      }),
      status: 'waiting',
      awaitingApproval: true,
      currentTitle: '等待指挥员复核',
      currentDetail: event.description || '参数已冻结，尚未向子项目发送指令',
    };
  }
  if (event.type === 'tool-result') {
    const output = parseRecord(event.result);
    const outputFailed = output?.ok === false || output?.status === 'error' || output?.status === 'failed';
    const ok = Boolean(output) && !outputFailed;
    const callId = event.toolCallId || `${run.id}-tool`;
    const existing = run.audit.find((record) => record.callId === callId);
    const data = output?.data && typeof output.data === 'object' && !Array.isArray(output.data) ? output.data as Record<string, unknown> : undefined;
    const structuredPlan = data?.plan && typeof data.plan === 'object' && !Array.isArray(data.plan) ? data.plan as Record<string, unknown> : undefined;
    const planNeedsReview = structuredPlan?.review && typeof structuredPlan.review === 'object'
      ? (structuredPlan.review as Record<string, unknown>).status === 'pending_manual_review'
      : false;
    const partialFailure = run.partialFailure || (!ok && event.scope === 'tool');
    const needsReview = !run.reviewHandled && (run.manualReview || !ok || planNeedsReview);
    return {
      ...run,
      audit: upsertAudit(run.audit, {
        callId,
        toolName: event.toolName || existing?.toolName || 'Skill 执行',
        status: outputFailed ? 'failed' : 'success',
        input: existing?.input,
        output: event.result,
        evidenceRefs: Array.isArray(output?.evidenceRefs) ? output.evidenceRefs.filter((item): item is string => typeof item === 'string') : Array.isArray(data?.evidenceRefs) ? data.evidenceRefs.filter((item): item is string => typeof item === 'string') : undefined,
        ruleVersion: typeof output?.ruleVersion === 'string' ? output.ruleVersion : typeof data?.ruleVersion === 'string' ? data.ruleVersion : undefined,
        error: typeof output?.error === 'string' ? output.error : undefined,
        startedAt: existing?.startedAt ?? Date.now(),
        finishedAt: Date.now(),
        replayable: true,
      }),
      output: output ?? run.output,
      partialFailure,
      manualReview: needsReview,
      awaitingApproval: false,
      status: ok ? (needsReview ? 'waiting' : 'running') : event.scope === 'tool' ? 'waiting' : 'error',
      currentTitle: ok ? '已收到执行回执' : event.scope === 'tool' ? '工具失败，主智能体继续' : '子项目执行失败',
      currentDetail: ok ? '正在结构化展示结果' : event.scope === 'tool'
        ? `${event.toolName || '子工具'} 未返回有效结果，后续结论将保留待人工复核。`
        : sanitizePublicText(output?.error) || '本次操作未完成，请查看审计详情。',
      finishedAt: ok ? run.finishedAt : event.scope === 'tool' ? run.finishedAt : Date.now(),
    };
  }
  if (event.type === 'error') {
    const recoverable = event.terminal === false || event.scope === 'tool';
    const active = (event.toolCallId && run.audit.find((record) => record.callId === event.toolCallId))
      || [...run.audit].reverse().find((record) => record.status === 'running')
      || run.audit.at(-1);
    const detail = sanitizePublicText(event.content) || '本次操作未完成，请查看审计详情。';
    const platformOffline = /平台不可用|平台.*离线|数据源.*离线|八维通.*不可用/i.test(event.content || '');
    if (recoverable) {
      return {
        ...run,
        partialFailure: true,
        manualReview: true,
        audit: active ? upsertAudit(run.audit, { ...active, status: 'failed', error: detail, finishedAt: Date.now() }) : run.audit,
        status: 'waiting',
        currentTitle: '工具失败，主智能体继续',
        currentDetail: `${active?.toolName || '子工具'} 未返回有效结果，后续结论将保留待人工复核。`,
      };
    }
    return {
      ...run,
      audit: active ? upsertAudit(run.audit, { ...active, status: 'failed', error: event.content || '任务执行失败。', finishedAt: Date.now() }) : run.audit,
      status: 'error',
      currentTitle: platformOffline ? '平台不可用' : '任务执行失败',
      currentDetail: detail,
      finishedAt: Date.now(),
    };
  }
  if (event.type === 'finish') {
    // A transport finish only closes the stream. A remote business run is
    // complete only after a structured plan has arrived without failures or
    // review signals; otherwise it remains explicitly reviewable.
    if (run.status === 'error' || run.awaitingApproval) return run;
    if (run.source === 'local' && (run.manualReview || run.partialFailure)) {
      return {
        ...run,
        status: 'waiting',
        progress: Math.min(96, Math.max(run.progress, 82)),
        finishedAt: Date.now(),
        currentTitle: '预案待人工复核',
        currentDetail: '预案已生成，等待人工确认；7 秒无响应将自动继续。',
        phases: phaseAfterRemoteFinish(run, true),
      };
    }
    if (run.source === 'upstream' || !run.toolName) {
      const failed = run.partialFailure || hasFailedAudit(run);
      const needsReview = failed || run.manualReview || !hasStructuredPlan(run.output);
      if (needsReview) {
        const failedTool = run.audit.find((record) => record.status === 'failed')?.toolName;
        return {
          ...run,
          status: 'waiting',
          progress: Math.min(96, Math.max(run.progress, 82)),
          finishedAt: Date.now(),
          manualReview: true,
          currentTitle: failed ? '部分研判完成，待人工复核' : '结果待人工复核',
          currentDetail: failed
            ? `${failedTool || '子工具'} 查询失败，已保留已完成研判，等待指挥员复核。`
            : '远端已返回待复核结论，等待指挥员确认后继续闭环。',
          phases: phaseAfterRemoteFinish(run, true, failedTool),
        };
      }
      return {
        ...run,
        status: 'done',
        progress: 100,
        finishedAt: Date.now(),
        currentTitle: '闭环结果已生成',
        currentDetail: '八维通已返回结构化预案，当前运行完成。',
        phases: run.phases.map((phase) => ({ ...phase, status: 'done' as const })),
      };
    }
    return { ...run, status: 'done', progress: 100, finishedAt: Date.now() };
  }
  if (event.type === 'reasoning' && run.progress <= 3) {
    return {
      ...run,
      source: 'upstream',
      progress: 20,
      currentTitle: '八维通正在分析',
      currentDetail: event.content || '正在理解指令',
      phases: run.phases.map((phase) => phase.id === 'received'
        ? { ...phase, status: 'done' }
        : phase.id === 'intent'
          ? { ...phase, status: 'running', detail: event.content || '正在理解指令' }
          : phase),
    };
  }
  if (event.type === 'text' && run.source !== 'local') {
    const reviewSignal = /待人工复核|待核实|空间取证失败|未签发|未启动三维|等待指挥员复核/i.test(event.content || '');
    if (run.status === 'error') return run;
    const nextManualReview = !run.reviewHandled && (run.manualReview || reviewSignal);
    return {
      ...run,
      source: 'upstream',
      status: nextManualReview || run.partialFailure ? 'waiting' : 'running',
      manualReview: nextManualReview,
      progress: 72,
      currentTitle: nextManualReview || run.partialFailure ? '结果待人工复核' : '八维通正在生成回复',
      currentDetail: nextManualReview || run.partialFailure ? '远端已返回部分结论，等待复核后继续闭环。' : '内容正在实时输出',
      phases: run.phases.map((phase) => ['received', 'intent', 'parameters'].includes(phase.id)
        ? { ...phase, status: 'done' }
        : phase.id === 'skill' || phase.id === 'bridge'
          ? { ...phase, status: nextManualReview || run.partialFailure ? 'waiting' : 'running' }
          : phase.id === 'approval'
            ? { ...phase, status: nextManualReview || run.partialFailure ? 'waiting' : 'pending', detail: nextManualReview || run.partialFailure ? '等待指挥员复核' : '尚未收到复核请求' }
        : phase.id === 'execute'
          ? { ...phase, status: nextManualReview || run.partialFailure ? 'waiting' : 'running', detail: nextManualReview || run.partialFailure ? '等待复核后继续' : '八维通主智能体正在输出内容' }
          : phase),
    };
  }
  return run;
}

function formatValue(key: string, value: unknown) {
  if (key === 'trappedCount') return `${String(value)} 人`;
  if (key === 'burnArea') return `${String(value)} ㎡`;
  if (key === 'radiusKm') return `${String(value)} km`;
  if (Array.isArray(value)) return value.length ? value.join('、') : '无';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function PhaseIcon({ status }: { status: ExecutionStatus }) {
  if (status === 'done') return <Check size={12} />;
  if (status === 'running') return <LoaderCircle size={12} className="spin" />;
  if (status === 'waiting') return <ShieldCheck size={12} />;
  if (status === 'error') return <CircleAlert size={12} />;
  return <span />;
}

export function ExecutionMonitor({
  run,
  onManualReview,
  reviewDisabled = false,
}: {
  run: LiveExecutionRun | null;
  onManualReview?: (decision: ManualReviewDecision) => void | Promise<void>;
  reviewDisabled?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [auditOpen, setAuditOpen] = useState(false);
  useEffect(() => {
    if (!run || run.status === 'done' || run.status === 'error') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run]);
  useEffect(() => setAuditOpen(false), [run?.id]);
  useEffect(() => {
    if (!auditOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAuditOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [auditOpen]);
  const elapsed = run ? Math.max(0.1, ((run.finishedAt ?? now) - run.startedAt) / 1000) : 0;
  const elapsedLabel = elapsed < 10 ? `${elapsed.toFixed(1)}s` : `${Math.round(elapsed)}s`;
  const visibleInputs = useMemo(
    () => Object.entries(run?.input ?? {}).filter(([key, value]) => FIELD_LABELS[key] && value !== undefined && value !== ''),
    [run?.input],
  );
  if (!run) return null;
  const failedAuditCount = run.audit.filter((record) => record.status === 'failed').length;
  const runningAuditCount = run.audit.filter((record) => record.status === 'running').length;
  const waitingAuditCount = run.audit.filter((record) => record.status === 'waiting').length;
  const auditSummary = [
    failedAuditCount ? `${failedAuditCount} 条失败` : '',
    runningAuditCount ? `${runningAuditCount} 条执行中` : '',
    waitingAuditCount ? `${waitingAuditCount} 条待复核` : '',
  ].filter(Boolean).join(' · ') || '全部已返回';

  return (
    <>
      <section className={`execution-monitor execution-monitor--${run.status}`} aria-live="polite" aria-label="实时作战过程">
        <header className="execution-monitor__header">
          <div className="execution-monitor__title">
            <Activity size={15} />
            <div><h2>实时作战过程</h2></div>
          </div>
          <div className="execution-monitor__current">
            {run.status === 'running' && <LoaderCircle size={14} className="spin" />}
            {run.status === 'waiting' && <ShieldCheck size={14} />}
            {run.status === 'done' && <Check size={14} />}
            {run.status === 'error' && <CircleAlert size={14} />}
            <strong>{run.currentTitle}</strong>
            <span><Clock3 size={12} />{elapsedLabel}</span>
            <b>{Math.round(run.progress)}%</b>
          </div>
          {run.audit.length > 0 && (
            <button type="button" className="execution-audit-trigger" onClick={() => setAuditOpen(true)} aria-label={`查看审计详情，共 ${run.audit.length} 条`}>
              <FileSearch size={14} />
              <span>审计 {run.audit.length}</span>
              {failedAuditCount > 0 && <b>{failedAuditCount} 失败</b>}
            </button>
          )}
        </header>
        <div className="execution-progress" aria-label={`执行进度 ${Math.round(run.progress)}%`}>
          <span style={{ width: `${Math.max(2, run.progress)}%` }} />
        </div>
        <div className="execution-monitor__summary">
          <p><strong>当前指令</strong>{run.task}</p>
          <p><strong>实时状态</strong>{run.currentDetail}</p>
        </div>
        {visibleInputs.length > 0 && (
          <div className="execution-inputs" aria-label="已识别参数">
            {run.toolName && <span className="execution-input execution-input--tool"><b>Skill</b>{run.toolName}</span>}
            {visibleInputs.map(([key, value]) => (
              <span key={key} className="execution-input"><b>{FIELD_LABELS[key]}</b>{formatValue(key, value)}</span>
            ))}
          </div>
        )}
        <div className="execution-phases">
          {run.phases.map((phase) => (
            <div key={phase.id} className={`execution-phase execution-phase--${phase.status}`} title={phase.detail}>
              <span><PhaseIcon status={phase.status} /></span>
              <strong>{phase.title}</strong>
            </div>
          ))}
        </div>
        {onManualReview && run.status === 'waiting' && (run.manualReview || run.partialFailure) && !run.awaitingApproval && !run.reviewHandled && (
          <ManualReviewActions onReview={onManualReview} disabled={reviewDisabled} />
        )}
      </section>
      {auditOpen && typeof document !== 'undefined' && createPortal(
        <div className="execution-audit-overlay" role="presentation">
          <button type="button" className="execution-audit-scrim" onClick={() => setAuditOpen(false)} aria-label="关闭审计详情" />
          <aside className="execution-audit-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-drawer-title">
            <header>
              <span className="execution-audit-drawer__icon"><ShieldCheck size={18} /></span>
              <div><h2 id="audit-drawer-title">审计详情</h2><p>{run.audit.length} 条调用记录 · {auditSummary}</p></div>
              <button type="button" onClick={() => setAuditOpen(false)} aria-label="关闭审计详情" title="关闭" autoFocus><X size={18} /></button>
            </header>
            <div className="execution-audit__list">
              {run.audit.map((record) => (
                <details key={record.callId} className={`execution-audit__item execution-audit__item--${record.status}`}>
                  <summary><span>{record.toolName}</span><b>{auditLabel(record.status)}</b><code>{record.callId}</code></summary>
                  <div className="execution-audit__body">
                    {record.evidenceRefs?.length ? <p><strong>证据引用</strong>{record.evidenceRefs.join('、')}</p> : null}
                    {record.ruleVersion ? <p><strong>规则版本</strong>{record.ruleVersion}</p> : null}
                    {record.error ? <p className="execution-audit__error"><strong>错误</strong>{record.error}</p> : null}
                    <div><strong>输入</strong><pre>{auditJson(record.input)}</pre></div>
                    <div><strong>输出</strong><pre>{auditJson(record.output)}</pre></div>
                    <small>{record.replayable ? '可按原调用记录重放' : '不可重放'} · {record.finishedAt ? `${Math.max(0, record.finishedAt - record.startedAt)} ms` : '进行中'}</small>
                  </div>
                </details>
              ))}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
