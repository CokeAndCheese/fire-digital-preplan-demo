/**
 * 面板注册表 —— 生成的面板（PanelShell）挂载时注册、卸载时注销，维持一份"当前可用面板清单"。
 * 用途：① 运行期多智能体发现有哪些面板可调；
 *      ② 调试 / 联动时从 window.__panels 取当前面板。
 */
export type PanelMeta = {
  /** 唯一名，运行期 agent 用 togglePanel(name) / movePanel(name) 引用本面板。 */
  name: string;
  /** 面板标题（展示用）。 */
  title: string;
  /** 一句话说明这个面板是干啥的 —— 让 agent 知道"什么时候该调它"。 */
  description?: string;
  /** 当前所在角落（PanelShell 自动避让用：新面板挑没被占的角，避免盖住已有面板）。 */
  corner?: string;
};

export type PanelRuntimeState = {
  expanded: boolean;
};

export type PanelController = PanelMeta & {
  getState: () => PanelRuntimeState;
  setExpanded: (expanded: boolean) => void;
};

export type PanelSnapshot = PanelMeta & {
  visible: boolean;
};

const registry = new Map<string, PanelController>();

/** 四角优先序（自动避让按此找空位）。 */
const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

/** 挑一个不与现有面板重叠的角：preferred 没被占就用它，否则按顺序找第一个空角；四角占满则退回 preferred。 */
export function pickFreeCorner(preferred: string): string {
  const taken = new Set([...registry.values()].map((p) => p.corner).filter(Boolean));
  if (!taken.has(preferred)) return preferred;
  return CORNERS.find((c) => !taken.has(c)) ?? preferred;
}

function sync(): void {
  if (typeof window !== 'undefined') {
    (window as unknown as { __panels?: PanelMeta[] }).__panels = listPanels();
  }
}

/** 注册面板（PanelShell 挂载时自动调；同名覆盖）。 */
export function registerPanel(controller: PanelController): void {
  registry.set(controller.name, controller);
  sync();
}

/** 注销面板（PanelShell 卸载时自动调）——生命周期收口，清单不残留已销毁的面板。 */
export function unregisterPanel(name: string): void {
  registry.delete(name);
  sync();
}

/** 当前可用面板清单。 */
export function getPanelController(name: string): PanelController | undefined {
  return registry.get(name);
}

/** PanelShell 状态变化后刷新调试快照；真实状态始终由控制器的 getState() 提供。 */
export function refreshPanelRegistry(): void {
  sync();
}

/** 当前可用面板清单。 */
export function listPanels(): PanelSnapshot[] {
  return [...registry.values()].map((controller) => ({
    name: controller.name,
    title: controller.title,
    description: controller.description,
    corner: controller.corner,
    visible: controller.getState().expanded,
  }));
}
