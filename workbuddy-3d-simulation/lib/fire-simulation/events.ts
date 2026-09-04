/**
 * 浏览器事件协议：正式主工程 / 智能体通过该协议加载计划、控制推演、订阅状态。
 *
 * 事件名（只读快照 / 控制）：
 * - fire-simulation:load    detail = { plan: SimulationPlan }
 * - fire-simulation:start | pause | resume | next | previous | replay | reset（控制，无业务数据）
 * - fire-simulation:state   detail = SimulationSnapshot（只读）
 *
 * 规则：组件卸载必须移除全部监听器；不把控制器或可变对象挂到 window。
 */

import type {
  FireSimulationController,
  SimulationPlan,
  SimulationSnapshot,
} from './contracts';

export const FIRE_SIMULATION_EVENTS = {
  load: 'fire-simulation:load',
  start: 'fire-simulation:start',
  pause: 'fire-simulation:pause',
  resume: 'fire-simulation:resume',
  next: 'fire-simulation:next',
  previous: 'fire-simulation:previous',
  replay: 'fire-simulation:replay',
  reset: 'fire-simulation:reset',
  state: 'fire-simulation:state',
} as const;

export type FireSimulationControlName =
  | 'start'
  | 'pause'
  | 'resume'
  | 'next'
  | 'previous'
  | 'replay'
  | 'reset';

export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function dispatchFireSimulationEvent(name: string, detail?: unknown): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function dispatchFireSimulationLoad(plan: SimulationPlan): void {
  dispatchFireSimulationEvent(FIRE_SIMULATION_EVENTS.load, { plan });
}

export function dispatchFireSimulationControl(name: FireSimulationControlName): void {
  dispatchFireSimulationEvent(FIRE_SIMULATION_EVENTS[name]);
}

export function dispatchFireSimulationState(snapshot: SimulationSnapshot): void {
  dispatchFireSimulationEvent(FIRE_SIMULATION_EVENTS.state, { snapshot });
}

export function onFireSimulationEvent<T = unknown>(
  name: string,
  handler: (detail: T) => void,
): () => void {
  if (!isBrowser()) return () => undefined;
  const listener = (e: Event): void => handler((e as CustomEvent<T>).detail);
  window.addEventListener(name, listener as EventListener);
  return () => window.removeEventListener(name, listener as EventListener);
}

export function parseFireSimulationLoadEvent(e: Event): SimulationPlan | null {
  const detail = (e as CustomEvent<{ plan?: SimulationPlan }>).detail;
  if (detail && detail.plan) return detail.plan;
  return null;
}

/**
 * 把控制器接入浏览器事件总线（仅处理「控制事件 -> 控制器方法」）。
 * 状态变化由调用方通过 createFireSimulationController 的 onStateChange 派发 state 事件。
 * 返回清理函数，组件卸载时调用以移除全部监听器。
 */
export function bindFireSimulationEvents(controller: FireSimulationController): () => void {
  const offs: Array<() => void> = [];
  offs.push(
    onFireSimulationEvent<{ plan?: SimulationPlan }>(FIRE_SIMULATION_EVENTS.load, (detail) => {
      if (detail?.plan) {
        try {
          controller.load(detail.plan);
        } catch {
          // 非法计划：由控制器状态或调用方处理
        }
      }
    }),
  );
  offs.push(onFireSimulationEvent(FIRE_SIMULATION_EVENTS.start, () => void controller.start()));
  offs.push(onFireSimulationEvent(FIRE_SIMULATION_EVENTS.pause, () => controller.pause()));
  offs.push(onFireSimulationEvent(FIRE_SIMULATION_EVENTS.resume, () => void controller.resume()));
  offs.push(onFireSimulationEvent(FIRE_SIMULATION_EVENTS.next, () => void controller.next()));
  offs.push(onFireSimulationEvent(FIRE_SIMULATION_EVENTS.previous, () => void controller.previous()));
  offs.push(onFireSimulationEvent(FIRE_SIMULATION_EVENTS.replay, () => void controller.replay()));
  offs.push(onFireSimulationEvent(FIRE_SIMULATION_EVENTS.reset, () => void controller.reset()));
  return () => {
    for (const off of offs) off();
  };
}
