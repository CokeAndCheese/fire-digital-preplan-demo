/**
 * 推演控制器：纯状态机 + 动作编排。
 *
 * 通过依赖注入使用 FireSimulationAdapter，不依赖任何三维 SDK，便于单元测试。
 * 满足任务清单的状态机规则：不并发、暂停原子化、resume 不重复成功动作、
 * previous 回退可逆动作、replay 先复位、reset 清理全部临时状态、dispose 清理计时器、
 * 所有等待可取消。
 */

import {
  DEFAULT_SIMULATION_COLORS,
  SIMULATION_STEP_CODES,
  SYSTEMIC_ERROR_CODES,
  type CreateFireSimulationControllerOptions,
  type FireSimulationAdapter,
  type FireSimulationController,
  type SimulationControllerState,
  type SimulationAction,
  type SimulationActionResult,
  type SimulationActionType,
  type SimulationErrorCode,
  type SimulationExecutionContext,
  type SimulationPlan,
  type SimulationSnapshot,
  type SimulationStep,
  type SimulationStepCode,
} from './contracts';

/** 加载非法计划时抛出，便于调用方用 try/catch 识别拒绝原因。 */
export class SimulationContractError extends Error {
  readonly errorCode: SimulationErrorCode;
  constructor(errorCode: SimulationErrorCode, message: string) {
    super(message);
    this.name = 'SimulationContractError';
    this.errorCode = errorCode;
  }
}

type ValidationResult =
  | { ok: true }
  | { ok: false; errorCode: SimulationErrorCode; message: string };

export function validateSimulationPlan(plan: unknown): ValidationResult {
  if (!plan || typeof plan !== 'object') {
    return { ok: false, errorCode: 'INVALID_PLAN', message: '计划不是合法对象' };
  }
  const p = plan as Record<string, unknown>;
  if (p.contractVersion !== '1.0') {
    return { ok: false, errorCode: 'INVALID_PLAN', message: `contractVersion 应为 '1.0'，收到 ${String(p.contractVersion)}` };
  }
  if (typeof p.eventId !== 'string' || p.eventId.trim() === '') {
    return { ok: false, errorCode: 'PLAN_REJECTED', message: '缺少 eventId' };
  }
  if (typeof p.sceneId !== 'string' || p.sceneId.trim() === '') {
    return { ok: false, errorCode: 'PLAN_REJECTED', message: '缺少 sceneId' };
  }
  if (typeof p.title !== 'string') {
    return { ok: false, errorCode: 'PLAN_REJECTED', message: '缺少 title' };
  }
  if (!Array.isArray(p.steps) || p.steps.length === 0) {
    return { ok: false, errorCode: 'PLAN_REJECTED', message: 'steps 为空' };
  }
  const orders = new Set<number>();
  for (let i = 0; i < p.steps.length; i += 1) {
    const step = p.steps[i] as Record<string, unknown>;
    if (!step || typeof step !== 'object') {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${i}] 非法` };
    }
    if (typeof step.id !== 'string' || step.id.trim() === '') {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${i}] 缺少 id` };
    }
    if (typeof step.order !== 'number' || !Number.isFinite(step.order)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${i}] order 非法` };
    }
    if (orders.has(step.order)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤 order 重复：${step.order}` };
    }
    orders.add(step.order);
    if (!(SIMULATION_STEP_CODES as readonly string[]).includes(step.code as string)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${i}] code 非法：${String(step.code)}` };
    }
    if (typeof step.title !== 'string' || typeof step.description !== 'string') {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${i}] 缺少 title/description` };
    }
    if (!Array.isArray(step.actions)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${i}] actions 非法` };
    }
    const actionError = validateActions(step.actions as unknown[], i);
    if (actionError) return actionError;
  }
  return { ok: true };
}

function validateActions(actions: unknown[], stepIndex: number): ValidationResult | null {
  const known = new Set<string>([
    'FOCUS_OBJECT',
    'HIGHLIGHT_OBJECT',
    'CLEAR_HIGHLIGHT',
    'SHOW_OBJECTS',
    'HIDE_OBJECTS',
    'SET_OPACITY',
    'RESET_OPACITY',
    'APPLY_LAYER',
    'SHOW_POLYGON',
    'MOVE_OBJECT',
    'RESTORE_OBJECT',
    'DRAW_ROUTE',
    'CLEAR_ROUTE',
    'SHOW_VIRTUAL_ROUTE',
    'DATA_GAP',
    'WAIT',
    'NOTE',
  ]);
  for (let i = 0; i < actions.length; i += 1) {
    const a = actions[i] as Record<string, unknown> | null;
    if (!a || typeof a !== 'object') {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${stepIndex}] 动作[${i}] 非法` };
    }
    if (!known.has(a.type as string)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `步骤[${stepIndex}] 动作[${i}] 类型未知：${String(a.type)}` };
    }
    const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
    const needObjectId = ['FOCUS_OBJECT', 'HIGHLIGHT_OBJECT', 'CLEAR_HIGHLIGHT', 'MOVE_OBJECT', 'RESTORE_OBJECT'];
    const needObjectIds = ['SHOW_OBJECTS', 'HIDE_OBJECTS', 'SET_OPACITY', 'RESET_OPACITY'];
    if (needObjectId.includes(a.type as string) && !nonEmpty(a.objectId)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] ${a.type} 缺少 objectId` };
    }
    if (needObjectIds.includes(a.type as string) && !Array.isArray(a.objectIds)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] ${a.type} 缺少 objectIds 数组` };
    }
    if (a.type === 'SHOW_POLYGON' && !nonEmpty(a.polygonId)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] SHOW_POLYGON 缺少 polygonId` };
    }
    if (a.type === 'DRAW_ROUTE' && !nonEmpty(a.routeKey)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] DRAW_ROUTE 缺少 routeKey` };
    }
    if (a.type === 'DRAW_ROUTE' && (!Array.isArray(a.points) || a.points.length < 2)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] DRAW_ROUTE 至少需要 2 个路径点` };
    }
    if (a.type === 'CLEAR_ROUTE' && !nonEmpty(a.routeKey)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] CLEAR_ROUTE 缺少 routeKey` };
    }
    if (a.type === 'SHOW_VIRTUAL_ROUTE' && !nonEmpty(a.routeId)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] SHOW_VIRTUAL_ROUTE 缺少 routeId` };
    }
    if (a.type === 'DATA_GAP' && !nonEmpty(a.reason)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] DATA_GAP 缺少 reason` };
    }
    if (a.type === 'WAIT' && (typeof a.durationMs !== 'number' || !Number.isFinite(a.durationMs) || a.durationMs < 0)) {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] WAIT durationMs 非法` };
    }
    if (a.type === 'NOTE' && typeof a.text !== 'string') {
      return { ok: false, errorCode: 'PLAN_REJECTED', message: `动作[${i}] NOTE 缺少 text` };
    }
  }
  return null;
}

function isSystemicErrorCode(code?: string): boolean {
  return !!code && (SYSTEMIC_ERROR_CODES as readonly string[]).includes(code);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createFireSimulationController(
  options: CreateFireSimulationControllerOptions,
): FireSimulationController {
  const adapter: FireSimulationAdapter = options.adapter;
  const onStateChange = options.onStateChange;

  let plan: SimulationPlan | null = null;
  let state: SimulationControllerState = 'idle';
  let currentStepIndex = -1;
  const resultsByStep = new Map<string, SimulationActionResult[]>();
  let allResults: SimulationActionResult[] = [];
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let error: { code: string; message: string } | null = null;

  let playing = false;
  let starting = false;
  let paused = false;
  let disposed = false;
  let runToken = 0;
  let activeWait: { cancel: () => void } | null = null;

  function emitState(): void {
    onStateChange?.(getSnapshot());
  }

  function setState(next: SimulationControllerState): void {
    state = next;
  }

  function setError(code: string, message: string): void {
    error = { code, message };
  }

  function isStepDone(stepId: string): boolean {
    const step = plan?.steps.find((s) => s.id === stepId);
    if (!step) return false;
    if (step.actions.length === 0) return true;
    const arr = resultsByStep.get(stepId) ?? [];
    for (let i = 0; i < step.actions.length; i += 1) {
      if (!arr[i]) return false;
    }
    return true;
  }

  function buildContext(step: SimulationStep): SimulationExecutionContext {
    const colors = { ...DEFAULT_SIMULATION_COLORS, ...(plan?.colors ?? {}) };
    return {
      sceneId: plan?.sceneId ?? '',
      plan: plan as SimulationPlan,
      step,
      colors,
    };
  }

  function localResult(
    step: SimulationStep,
    actionIndex: number,
    actionType: SimulationActionType,
    status: SimulationActionResult['status'],
    message?: string,
  ): SimulationActionResult {
    const finished = nowIso();
    const started = startedAt ?? finished;
    return {
      stepId: step.id,
      actionIndex,
      actionType,
      status,
      startedAt: started,
      finishedAt: finished,
      durationMs: Math.max(0, Date.parse(finished) - Date.parse(started) || 0),
      message,
    };
  }

  function waitCancelable(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        activeWait = null;
        resolve();
      }, ms);
      activeWait = {
        cancel: () => {
          clearTimeout(id);
          activeWait = null;
          resolve();
        },
      };
    });
  }

  function cancelActiveWait(): void {
    activeWait?.cancel();
    activeWait = null;
  }

  async function runAction(
    action: SimulationAction,
    context: SimulationExecutionContext,
    token: number,
    actionIndex: number,
  ): Promise<SimulationActionResult | null> {
    if (action.type === 'WAIT') {
      await waitCancelable(action.durationMs);
      if (disposed || token !== runToken) return null;
      return localResult(context.step, actionIndex, 'WAIT', 'success', `等待 ${action.durationMs}ms`);
    }
    if (action.type === 'NOTE') {
      return localResult(context.step, actionIndex, 'NOTE', 'skipped', action.text);
    }
    return adapter.execute(action, context);
  }

  async function executeStep(step: SimulationStep, token: number, auto: boolean): Promise<void> {
    const existing = resultsByStep.get(step.id) ?? [];
    const context = buildContext(step);
    for (let ai = 0; ai < step.actions.length; ai += 1) {
      if (disposed || token !== runToken) return;
      if (auto && paused) return;
      if (existing[ai]) continue;
      const action = step.actions[ai];
      const result = await runAction(action, context, token, ai);
      if (disposed || token !== runToken) return;
      if (result) {
        existing[ai] = result;
        resultsByStep.set(step.id, existing);
        allResults.push(result);
        emitState();
      }
      if (auto && paused) return;
      if (result && result.status === 'failed' && isSystemicErrorCode(result.errorCode)) {
        setError(result.errorCode as string, result.message ?? '系统性错误');
        setState('error');
        emitState();
        return;
      }
    }
  }

  async function runSteps(from: number, to: number, token: number, auto: boolean): Promise<void> {
    if (!plan) return;
    const last = plan.steps.length - 1;
    const start = Math.max(0, from);
    const end = Math.min(last, to);
    for (let i = start; i <= end; i += 1) {
      if (disposed || token !== runToken) return;
      if (auto && paused) {
        setState('paused');
        emitState();
        return;
      }
      currentStepIndex = i;
      emitState();
      await executeStep(plan.steps[i], token, auto);
      if (disposed || token !== runToken) return;
      if (auto && paused) {
        setState('paused');
        emitState();
        return;
      }
      if (auto) {
        const step = plan.steps[i];
        if (step.durationMs && step.durationMs > 0) {
          await waitCancelable(step.durationMs);
          if (disposed || token !== runToken) return;
          if (paused) {
            setState('paused');
            emitState();
            return;
          }
        }
      }
    }
    if (disposed || token !== runToken) return;
    if (auto) {
      finishedAt = nowIso();
      setState('completed');
      emitState();
    } else {
      // 手动执行后保持聚焦当前步（已执行），便于 previous 单次回退。
      setState('paused');
      emitState();
    }
  }

  async function play(): Promise<void> {
    if (disposed || playing || !plan) return;
    playing = true;
    const token = ++runToken;
    try {
      await runSteps(currentStepIndex, plan.steps.length - 1, token, true);
    } finally {
      playing = false;
    }
  }

  async function doReset(): Promise<void> {
    const token = ++runToken;
    playing = false;
    paused = false;
    cancelActiveWait();
    try {
      await adapter.reset();
    } catch {
      // 复位失败不影响状态机回到 idle
    }
    resultsByStep.clear();
    allResults = [];
    currentStepIndex = 0;
    startedAt = null;
    finishedAt = null;
    error = null;
    if (token === runToken) {
      setState('idle');
      emitState();
    }
  }

  function load(p: SimulationPlan): void {
    if (disposed) throw new SimulationContractError('DISPOSED', '推演已销毁');
    const v = validateSimulationPlan(p);
    if (!v.ok) throw new SimulationContractError(v.errorCode, v.message);
    // 同步加载：清空本地结果、定位到首步，不触发任何三维动作。
    resultsByStep.clear();
    allResults = [];
    currentStepIndex = 0;
    startedAt = null;
    finishedAt = null;
    error = null;
    plan = p;
    setState('idle');
    emitState();
  }

  async function start(): Promise<void> {
    if (playing || starting || disposed) return;
    starting = true;
    try {
      if (!plan) {
        setError('NOT_LOADED', '尚未加载计划');
        emitState();
        return;
      }
      if (state === 'completed') {
        await doReset();
        if (disposed) return;
      }
      if (!adapter.isReady()) {
        setError('SDK_NOT_READY', '场景 SDK 未就绪，无法开始推演');
        setState('error');
        emitState();
        return;
      }
      // 全新推演时清理上一轮可能存在的本推演场景临时状态（只清理自己的资源）。
      if (allResults.length === 0 && currentStepIndex === 0) {
        try {
          await adapter.reset();
        } catch {
          // ignore
        }
        if (disposed) return;
      }
      if (startedAt == null) startedAt = nowIso();
      paused = false;
      setState('running');
      emitState();
      await play();
    } finally {
      starting = false;
    }
  }

  function pause(): void {
    if (state !== 'running') return;
    paused = true;
    setState('paused');
    emitState();
  }

  async function resume(): Promise<void> {
    if (playing || starting || state !== 'paused' || disposed) return;
    starting = true;
    try {
      if (!adapter.isReady()) {
        setError('SDK_NOT_READY', '场景 SDK 未就绪，无法继续');
        setState('error');
        emitState();
        return;
      }
      paused = false;
      setState('running');
      emitState();
      await play();
    } finally {
      starting = false;
    }
  }

  async function next(): Promise<void> {
    if (playing || starting || disposed || !plan) return;
    starting = true;
    try {
      const last = plan.steps.length - 1;
      if (currentStepIndex > last) return;
      if (state === 'completed') return;
      if (!adapter.isReady()) {
        setError('SDK_NOT_READY', '场景 SDK 未就绪，无法执行下一步');
        setState('error');
        emitState();
        return;
      }
      const focused = plan.steps[currentStepIndex];
      // 若当前步已完成，则先前进到下一步再执行（「下一步」语义）。
      if (isStepDone(focused.id) && currentStepIndex < last) {
        currentStepIndex = currentStepIndex + 1;
      }
      if (startedAt == null) startedAt = nowIso();
      paused = false;
      setState('running');
      emitState();
      const token = ++runToken;
      await runSteps(currentStepIndex, currentStepIndex, token, false);
      if (disposed || token !== runToken) return;
      const nowFocused = plan.steps[currentStepIndex];
      if (isStepDone(nowFocused.id) && currentStepIndex === last) {
        finishedAt = nowIso();
        setState('completed');
        emitState();
        return;
      }
      setState('paused');
      emitState();
    } finally {
      starting = false;
    }
  }

  async function previous(): Promise<void> {
    if (playing || starting || disposed || !plan) return;
    starting = true;
    try {
      if (currentStepIndex < 0) return;
      const token = ++runToken;
      const step = plan.steps[currentStepIndex];
      const existing = resultsByStep.get(step.id) ?? [];
      if (existing.some((r) => r)) {
        const context = buildContext(step);
        for (let ai = step.actions.length - 1; ai >= 0; ai -= 1) {
          if (disposed || token !== runToken) return;
          if (!existing[ai]) continue;
          const action = step.actions[ai];
          if (action.type === 'WAIT' || action.type === 'NOTE') continue;
          try {
            await adapter.rollback(action, context);
          } catch {
            // 回退失败不影响定位
          }
        }
        resultsByStep.delete(step.id);
        allResults = allResults.filter((r) => r.stepId !== step.id);
      }
      currentStepIndex = Math.max(0, currentStepIndex - 1);
      setState('paused');
      emitState();
    } finally {
      starting = false;
    }
  }

  async function replay(): Promise<void> {
    if (playing || disposed || !plan) return;
    await doReset();
    if (disposed) return;
    await start();
  }

  async function reset(): Promise<void> {
    if (disposed) return;
    await doReset();
  }

  function getSnapshot(): SimulationSnapshot {
    const step =
      plan && currentStepIndex >= 0 && currentStepIndex < plan.steps.length
        ? plan.steps[currentStepIndex]
        : null;
    const currentStepResults = step
      ? (resultsByStep.get(step.id) ?? []).filter(Boolean)
      : [];
    const stepResults: Record<string, SimulationActionResult[]> = {};
    if (plan) {
      for (const s of plan.steps) {
        stepResults[s.id] = (resultsByStep.get(s.id) ?? []).filter(Boolean);
      }
    }
    const doneCount = plan ? plan.steps.filter((s) => isStepDone(s.id)).length : 0;
    return {
      state,
      plan,
      currentStepIndex,
      currentStep: step,
      totalSteps: plan ? plan.steps.length : 0,
      progress: { current: doneCount, total: plan ? plan.steps.length : 0 },
      results: allResults.slice(),
      currentStepResults,
      stepResults,
      startedAt,
      finishedAt,
      error,
    };
  }

  async function dispose(): Promise<void> {
    disposed = true;
    playing = false;
    paused = false;
    cancelActiveWait();
    runToken += 1;
    try {
      await adapter.dispose();
    } catch {
      // ignore
    }
    plan = null;
    resultsByStep.clear();
    allResults = [];
    currentStepIndex = -1;
    startedAt = null;
    finishedAt = null;
    error = null;
    setState('idle');
    emitState();
  }

  return {
    load,
    start,
    pause,
    resume,
    next,
    previous,
    replay,
    reset,
    getSnapshot,
    dispose,
  };
}
