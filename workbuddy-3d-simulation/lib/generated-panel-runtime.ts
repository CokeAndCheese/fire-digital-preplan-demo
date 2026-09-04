import { GENERATED_PANELS, type GeneratedPanelInfo } from './generated-panels';
import { getPanelController } from './panels';

const HIDDEN_CLASS = 'is-hidden';

export type GeneratedPanelListItem = GeneratedPanelInfo & {
  visible: boolean;
  mounted: boolean;
};

export type PanelSetVisibleParams = {
  id?: unknown;
  panelId?: unknown;
  name?: unknown;
  visible?: unknown;
};

type RuntimePanelMeta = {
  name?: unknown;
  title?: unknown;
  description?: unknown;
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function lookupKey(value: unknown): string {
  return clean(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-:/\\()[\]{}"'`.,，。；;]+/g, '');
}

function availablePanels(): GeneratedPanelInfo[] {
  const panels = GENERATED_PANELS.map((panel) => ({ ...panel }));
  if (typeof window === 'undefined') return panels;
  const runtimePanels = (window as unknown as { __panels?: RuntimePanelMeta[] }).__panels;
  if (!Array.isArray(runtimePanels)) return panels;

  for (const runtimePanel of runtimePanels) {
    const id = clean(runtimePanel?.name);
    if (!id) continue;
    const title = clean(runtimePanel.title) || id;
    const description = clean(runtimePanel.description) || title;
    const existingIndex = panels.findIndex((panel) => lookupKey(panel.id) === lookupKey(id));
    if (existingIndex >= 0) {
      panels[existingIndex] = {
        ...panels[existingIndex],
        name: title,
        description,
      };
      continue;
    }
    panels.push({
      id,
      name: title,
      domId: `panel-${id}`,
      description,
    });
  }
  return panels;
}

function panelAliases(panel: GeneratedPanelInfo): string[] {
  if (panel.aliases === undefined) return [];
  if (!Array.isArray(panel.aliases)) throw new Error(`生成面板清单配置错误: aliases 必须是字符串数组 ${clean(panel.id)}`);
  return panel.aliases.map((alias) => clean(alias)).filter(Boolean);
}

function panelLookupLabels(panel: GeneratedPanelInfo): string[] {
  return [panel.id, panel.name, ...panelAliases(panel)].map((label) => clean(label)).filter(Boolean);
}

function ensureUniquePanels(panels: GeneratedPanelInfo[]): void {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const seenDomIds = new Set<string>();
  const seenLookupKeys = new Map<string, string>();

  const registerLookupKey = (label: string, ownerId: string): void => {
    const key = lookupKey(label);
    if (!key) return;
    const existingOwnerId = seenLookupKeys.get(key);
    if (existingOwnerId && existingOwnerId !== ownerId) {
      throw new Error(`生成面板清单配置错误: name/aliases 查找名重复 ${label}`);
    }
    seenLookupKeys.set(key, ownerId);
  };

  for (const panel of panels) {
    const id = clean(panel.id);
    const name = clean(panel.name);
    const domId = clean(panel.domId);
    const description = clean(panel.description);
    if (!id || !name || !domId || !description) {
      throw new Error('生成面板清单配置错误: id/name/domId/description 均必填');
    }
    if (seenIds.has(id)) throw new Error(`生成面板清单配置错误: id 重复 ${id}`);
    if (seenNames.has(name)) throw new Error(`生成面板清单配置错误: name 重复 ${name}`);
    if (seenDomIds.has(domId)) throw new Error(`生成面板清单配置错误: domId 重复 ${domId}`);
    seenIds.add(id);
    seenNames.add(name);
    seenDomIds.add(domId);
    for (const label of panelLookupLabels(panel)) registerLookupKey(label, id);
  }
}

function panelElement(domId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(domId);
}

function dispatchPanelVisible(panel: GeneratedPanelInfo, visible: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app:panel', { detail: { name: panel.id, open: visible } }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function waitForPanelElement(domId: string): Promise<HTMLElement | null> {
  for (let i = 0; i < 3; i += 1) {
    const el = panelElement(domId);
    if (el) return el;
    await nextFrame();
  }
  return panelElement(domId);
}

async function waitForPanelController(panelId: string) {
  for (let i = 0; i < 3; i += 1) {
    const controller = getPanelController(panelId);
    if (controller) return controller;
    await nextFrame();
  }
  return getPanelController(panelId);
}

function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  return !el.classList.contains(HIDDEN_CLASS);
}

function parseVisible(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error('参数错误: visible 必须是 boolean 或字符串 true/false');
}

function findPanelById(id: string, panels: GeneratedPanelInfo[]): GeneratedPanelInfo | undefined {
  const key = lookupKey(id);
  return panels.find((item) => item.id === id || lookupKey(item.id) === key);
}

function findPanelByName(name: string, panels: GeneratedPanelInfo[]): GeneratedPanelInfo | undefined {
  const key = lookupKey(name);
  return panels.find((item) => panelLookupLabels(item).some((label) => lookupKey(label) === key));
}

function findPanel(params: PanelSetVisibleParams): GeneratedPanelInfo {
  const panels = availablePanels();
  ensureUniquePanels(panels);
  const id = clean(params.id ?? params.panelId);
  const name = clean(params.name);
  if (!id && !name) throw new Error('参数错误: id 或 name 必须提供');
  const panel = id ? findPanelById(id, panels) : findPanelByName(name, panels);
  if (!panel) throw new Error(`生成面板未找到: ${id || name}`);
  return panel;
}

export function panelList(): GeneratedPanelListItem[] {
  const panels = availablePanels();
  ensureUniquePanels(panels);
  return panels.map((panel) => {
    const el = panelElement(panel.domId);
    const controller = getPanelController(panel.id);
    return {
      ...panel,
      mounted: !!controller || !!el,
      visible: controller ? controller.getState().expanded : isVisible(el),
    };
  });
}

export async function panelSetVisible(params: PanelSetVisibleParams): Promise<GeneratedPanelListItem> {
  const visible = parseVisible(params.visible);
  const panel = findPanel(params);
  let el = panelElement(panel.domId);
  let controller = getPanelController(panel.id);
  if (!controller && !el && visible) {
    dispatchPanelVisible(panel, true);
    [controller, el] = await Promise.all([
      waitForPanelController(panel.id),
      waitForPanelElement(panel.domId),
    ]);
  }
  if (controller) {
    el?.classList.remove(HIDDEN_CLASS);
    controller.setExpanded(visible);
    await nextFrame();
    return {
      ...panel,
      mounted: true,
      visible: controller.getState().expanded,
    };
  }
  if (!el) {
    dispatchPanelVisible(panel, visible);
    return {
      ...panel,
      mounted: false,
      visible,
    };
  }
  // 兼容尚未升级 PanelShell 控制器的旧项目。
  el.classList.toggle(HIDDEN_CLASS, !visible);
  dispatchPanelVisible(panel, visible);
  return {
    ...panel,
    mounted: true,
    visible: isVisible(el),
  };
}
