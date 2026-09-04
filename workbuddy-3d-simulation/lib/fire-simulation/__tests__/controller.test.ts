import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFireSimulationController,
  SimulationContractError,
  type FireSimulationAdapter,
  type SimulationAction,
  type SimulationActionResult,
  type SimulationActionType,
  type SimulationExecutionContext,
  type SimulationPlan,
} from '../index';
import {
  duplicateOrderPlan,
  illegalActionPlan,
  makeEightStepLegacyPlan,
  makeValidPlan,
  missingEventIdPlan,
  wrongVersionPlan,
} from './fixtures';

class MockAdapter implements FireSimulationAdapter {
  ready = true;
  calls: SimulationAction[] = [];
  rollbackCalls: SimulationAction[] = [];
  resetCalls = 0;
  disposeCalls = 0;
  failObjectIds = new Set<string>();
  failTypes = new Set<SimulationActionType>();
  onExecute: ((action: SimulationAction, context: SimulationExecutionContext) => void) | null = null;

  isReady(): boolean {
    return this.ready;
  }

  async execute(
    action: SimulationAction,
    context: SimulationExecutionContext,
  ): Promise<SimulationActionResult> {
    this.calls.push(action);
    this.onExecute?.(action, context);
    const base: Omit<SimulationActionResult, 'status'> = {
      stepId: context.step.id,
      actionIndex: context.step.actions.indexOf(action),
      actionType: action.type,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
    };
    if (this.failTypes.has(action.type)) {
      return { ...base, status: 'failed', errorCode: 'SDK_ACTION_FAILED', message: 'forced fail' };
    }
    if (
      (action.type === 'FOCUS_OBJECT' ||
        action.type === 'HIGHLIGHT_OBJECT' ||
        action.type === 'CLEAR_HIGHLIGHT' ||
        action.type === 'MOVE_OBJECT' ||
        action.type === 'RESTORE_OBJECT') &&
      this.failObjectIds.has(action.objectId)
    ) {
      return { ...base, status: 'failed', errorCode: 'OBJECT_NOT_FOUND', message: 'object not found' };
    }
    if (action.type === 'SHOW_OBJECTS') {
      const details = action.objectIds.map((id) =>
        this.failObjectIds.has(id)
          ? { objectId: id, status: 'failed' as const, errorCode: 'OBJECT_NOT_FOUND', message: 'nf' }
          : { objectId: id, status: 'success' as const },
      );
      const anyFail = details.some((d) => d.status === 'failed');
      return {
        ...base,
        status: anyFail ? (details.every((d) => d.status === 'failed') ? 'failed' : 'degraded') : 'success',
        details,
      };
    }
    return { ...base, status: 'success' };
  }

  async rollback(action: SimulationAction): Promise<void> {
    this.rollbackCalls.push(action);
  }

  async reset(): Promise<void> {
    this.resetCalls += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }

}

/** 仅统计会真正调用适配器的动作（WAIT/NOTE 由控制器内部处理，不计入 adapter.calls）。 */
function adapterActionCount(plan: SimulationPlan): number {
  return plan.steps.reduce(
    (n, s) => n + s.actions.filter((a) => a.type !== 'WAIT' && a.type !== 'NOTE').length,
    0,
  );
}

describe('fire simulation controller - 加载与校验', () => {
  it('合法 11 步计划可以加载', () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    expect(() => controller.load(makeValidPlan())).not.toThrow();
    expect(controller.getSnapshot().totalSteps).toBe(11);
  });

  it('历史 8 步计划仍可兼容加载', () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    expect(() => controller.load(makeEightStepLegacyPlan())).not.toThrow();
    expect(controller.getSnapshot().totalSteps).toBe(8);
  });

  it('缺失 eventId 拒绝加载', () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    expect(() => controller.load(missingEventIdPlan() as SimulationPlan)).toThrow(SimulationContractError);
  });

  it('错误 contractVersion 拒绝加载', () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    expect(() => controller.load(wrongVersionPlan() as SimulationPlan)).toThrow(/contractVersion/);
  });

  it('重复 order 拒绝加载', () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    expect(() => controller.load(duplicateOrderPlan() as SimulationPlan)).toThrow(/order/);
  });

  it('非法动作拒绝加载', () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    expect(() => controller.load(illegalActionPlan() as SimulationPlan)).toThrow();
  });
});

describe('fire simulation controller - 状态机控制', () => {
  it('start 依次执行全部 11 步', async () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    await controller.start();
    const snap = controller.getSnapshot();
    expect(snap.state).toBe('completed');
    expect(snap.progress.current).toBe(11);
    expect(adapter.calls.length).toBeGreaterThan(0);
  });

  it('重复 start 不会并发执行两个推演', async () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    const p1 = controller.start();
    const p2 = controller.start();
    await Promise.all([p1, p2]);
    // 每个动作只执行一次（无重复推演）
    const adapterActions = adapterActionCount(makeValidPlan());
    expect(adapter.calls.length).toBe(adapterActions);
    expect(adapter.resetCalls).toBeLessThanOrEqual(1);
  });

  it('pause/resume 不重复已成功动作', async () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    // 在第 2 步首个动作（FOCUS_OBJECT room_fire_src）首次执行时暂停一次；
    // 该对象在第 10 步再次出现，需避免 resume 时重复触发暂停。
    let pausedOnce = false;
    adapter.onExecute = (action) => {
      if (!pausedOnce && action.type === 'FOCUS_OBJECT' && action.objectId === 'room_fire_src') {
        pausedOnce = true;
        controller.pause();
      }
    };
    await controller.start();
    expect(controller.getSnapshot().state).toBe('paused');
    const afterPause = adapter.calls.length;
    expect(afterPause).toBeGreaterThan(0);
    await controller.resume();
    const snap = controller.getSnapshot();
    expect(snap.state).toBe('completed');
    // 每个动作只执行一次（无重复推演 / 无重复成功动作）
    expect(adapter.calls.length).toBe(adapterActionCount(makeValidPlan()));
    // 已完成
    expect(snap.progress.current).toBe(11);
  });

  it('next/previous 状态正确', async () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    await controller.next();
    expect(controller.getSnapshot().currentStepIndex).toBe(0); // 执行第 1 步，聚焦该步
    expect(controller.getSnapshot().state).toBe('paused');
    await controller.next();
    expect(controller.getSnapshot().currentStepIndex).toBe(1); // 前进并执行第 2 步
    await controller.previous();
    expect(controller.getSnapshot().currentStepIndex).toBe(0);
    expect(controller.getSnapshot().state).toBe('paused');
  });

  it('replay 先复位再从头执行', async () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    await controller.start();
    expect(controller.getSnapshot().state).toBe('completed');
    const beforeReset = adapter.resetCalls;
    await controller.replay();
    expect(adapter.resetCalls).toBeGreaterThan(beforeReset);
    expect(controller.getSnapshot().state).toBe('completed');
    const adapterActions = adapterActionCount(makeValidPlan());
    expect(adapter.calls.length).toBe(adapterActions * 2);
  });

  it('reset/dispose 清理计时器与本次推演资源', async () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    await controller.start();
    const resetBefore = adapter.resetCalls;
    await controller.reset();
    expect(adapter.resetCalls).toBe(resetBefore + 1);
    expect(controller.getSnapshot().state).toBe('idle');
    expect(controller.getSnapshot().currentStepIndex).toBe(0);
    await controller.dispose();
    expect(adapter.disposeCalls).toBe(1);
  });

  it('reset 取消进行中的等待并停止推演', async () => {
    const adapter = new MockAdapter();
    const controller = createFireSimulationController({ adapter });
    const plan = makeValidPlan();
    plan.steps[0].actions.push({ type: 'WAIT', durationMs: 5000 });
    controller.load(plan);
    const startP = controller.start();
    // 在 WAIT 挂起后再调用 reset，验证等待被取消且推演停止。
    setTimeout(() => controller.reset(), 50);
    await Promise.race([startP, new Promise((r) => setTimeout(r, 300))]);
    expect(controller.getSnapshot().state).toBe('idle');
  });
});

describe('fire simulation controller - 失败与降级', () => {
  it('单动作失败仍能继续并产生 degraded/failed 结果', async () => {
    const adapter = new MockAdapter();
    adapter.failTypes.add('HIGHLIGHT_OBJECT');
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    await controller.start();
    const snap = controller.getSnapshot();
    expect(snap.state).toBe('completed'); // 单动作失败不影响整体完成
    const failed = snap.results.filter((r) => r.status === 'failed' || r.status === 'degraded');
    expect(failed.length).toBeGreaterThan(0);
  });

  it('SDK 未就绪进入明确错误状态', async () => {
    const adapter = new MockAdapter();
    adapter.ready = false;
    const controller = createFireSimulationController({ adapter });
    controller.load(makeValidPlan());
    await controller.start();
    const snap = controller.getSnapshot();
    expect(snap.state).toBe('error');
    expect(snap.error?.code).toBe('SDK_NOT_READY');
  });

  it('多对象动作记录部分成功与部分失败', async () => {
    const adapter = new MockAdapter();
    adapter.failObjectIds.add('engine_01');
    const controller = createFireSimulationController({ adapter });
    const plan = makeValidPlan();
    plan.steps[5].actions = [{ type: 'SHOW_OBJECTS', objectIds: ['station_01', 'engine_01'] }];
    controller.load(plan);
    await controller.start();
    const snap = controller.getSnapshot();
    const showResult = snap.results.find((r) => r.actionType === 'SHOW_OBJECTS');
    expect(showResult).toBeTruthy();
    expect(showResult?.status).toBe('degraded');
    const failedDetail = showResult?.details?.find((d) => d.status === 'failed');
    expect(failedDetail?.objectId).toBe('engine_01');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
