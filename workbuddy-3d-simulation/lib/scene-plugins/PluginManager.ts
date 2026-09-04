import type {
  PersistenceAdapter,
  PluginContext,
  PluginControl,
  PluginHost,
  ScenePlugin,
} from './types';

export interface PluginManagerOptions {
  viewer: PluginHost;
  getBuildings?: () => unknown[];
  scenePath?: string;
  resources?: Record<string, unknown>;
  persistence?: PersistenceAdapter;
}

interface Entry {
  plugin: ScenePlugin;
  objects: Set<{ userData?: Record<string, unknown> }>;
  roots: HTMLElement[];
  unavailable?: boolean;
}

export class PluginManager {
  private readonly viewer: PluginHost;
  private readonly getBuildings?: () => unknown[];
  private readonly scenePath?: string;
  private readonly resources?: Record<string, unknown>;
  private readonly persistence?: PersistenceAdapter;
  private readonly entries = new Map<string, Entry>();
  private readonly order: string[] = [];
  private readonly enabled = new Set<string>();
  private readonly controlErrors = new Map<string, string>();
  private readonly subscribers = new Set<() => void>();
  private readonly persistedIds: string[] | null;
  private ver = 0;

  constructor(opts: PluginManagerOptions) {
    this.viewer = opts.viewer;
    this.getBuildings = opts.getBuildings;
    this.scenePath = opts.scenePath;
    this.resources = opts.resources;
    this.persistence = opts.persistence;
    this.persistedIds = opts.persistence?.load() ?? null;
  }

  async register(plugin: ScenePlugin): Promise<void> {
    const id = plugin.manifest.id;
    const entry: Entry = { plugin, objects: new Set(), roots: [] };
    this.entries.set(id, entry);
    this.order.push(id);
    try {
      await plugin.attach(this.buildContext(id, entry));
    } catch (e) {
      console.error(`[scene-plugins] attach ${id} failed:`, e);
      entry.unavailable = true;
      return;
    }
    const alwaysEnabled = plugin.manifest.activation === 'always';
    const shouldEnable = alwaysEnabled ||
      (this.persistedIds === null ? !!plugin.manifest.defaultEnabled : this.persistedIds.includes(id));
    if (shouldEnable) this.enable(id, alwaysEnabled);
    else this.notify();
  }

  registry(): ScenePlugin[] {
    return this.order.map((id) => this.entries.get(id)!.plugin);
  }

  enabledIds(): string[] {
    return this.order.filter((id) => this.enabled.has(id));
  }

  isEnabled(id: string): boolean {
    return this.enabled.has(id);
  }

  isUnavailable(id: string): boolean {
    return this.entries.get(id)?.unavailable === true;
  }

  enable(id: string, silent = false): void {
    const entry = this.entries.get(id);
    if (!entry || this.enabled.has(id) || entry.unavailable) return;
    if (entry.plugin.manifest.activation === 'mode') {
      for (const other of [...this.enabled]) {
        if (this.entries.get(other)?.plugin.manifest.activation === 'mode') this.disable(other, true);
      }
    }
    try {
      entry.plugin.enable();
      this.enabled.add(id);
      if (silent) this.notify();
      else this.persistAndNotify();
    } catch (e) {
      console.error(`[scene-plugins] enable ${id} failed:`, e);
    }
  }

  disable(id: string, silent = false): void {
    const entry = this.entries.get(id);
    if (!entry || !this.enabled.has(id) || entry.plugin.manifest.activation === 'always') return;
    try {
      entry.plugin.disable();
    } catch (e) {
      console.error(`[scene-plugins] disable ${id} failed:`, e);
    }
    this.enabled.delete(id);
    if (!silent) this.persistAndNotify();
  }

  toggle(id: string): void {
    if (this.entries.get(id)?.plugin.manifest.activation === 'always') return;
    if (this.enabled.has(id)) this.disable(id);
    else this.enable(id);
  }

  setControl(pluginId: string, controlId: string, value: unknown): void {
    const entry = this.entries.get(pluginId);
    if (!entry) return;
    try {
      entry.plugin.onControl?.(controlId, value);
      this.controlErrors.delete(pluginId);
    } catch (e) {
      console.error(`[scene-plugins] ${pluginId}.onControl(${controlId}) failed:`, e);
      this.controlErrors.set(pluginId, e instanceof Error ? e.message : String(e));
    }
    this.notify();
  }

  getControlError(pluginId: string): string | null {
    return this.controlErrors.get(pluginId) ?? null;
  }

  getControls(pluginId: string): PluginControl[] {
    const entry = this.entries.get(pluginId);
    if (!entry) return [];
    return [...(entry.plugin.manifest.controls ?? []), ...(entry.plugin.getControls?.() ?? [])];
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  disposeAll(): void {
    for (const id of this.order) {
      const entry = this.entries.get(id)!;
      try {
        if (this.enabled.has(id)) entry.plugin.disable();
        entry.plugin.dispose();
      } catch (e) {
        console.error(`[scene-plugins] dispose ${id} failed:`, e);
      }
      entry.roots.forEach((r) => r.remove());
    }
    this.entries.clear();
    this.enabled.clear();
    this.controlErrors.clear();
    this.subscribers.clear();
    this.order.length = 0;
  }

  private buildContext(id: string, entry: Entry): PluginContext {
    return {
      viewer: this.viewer,
      pluginId: id,
      createOverlayRoot: () => {
        const root = document.createElement('div');
        root.setAttribute('data-plugin', id);
        this.viewer.el.appendChild(root);
        entry.roots.push(root);
        return root;
      },
      addObject: (obj) => {
        obj.userData = obj.userData ?? {};
        obj.userData.__pluginId = id;
        this.viewer.scene?.add?.(obj);
        entry.objects.add(obj);
        this.viewer.render?.();
      },
      removeOwnObjects: () => {
        for (const obj of entry.objects) this.viewer.scene?.remove?.(obj);
        entry.objects.clear();
        this.viewer.render?.();
      },
      getBuildings: this.getBuildings,
      getScenePath: () => this.scenePath,
      getResource: (key: string) => this.resources?.[key],
      requestRender: () => this.notify(),
    };
  }

  private persistAndNotify(): void {
    const persisted = this.enabledIds().filter(
      (id) => this.entries.get(id)?.plugin.manifest.activation !== 'always',
    );
    this.persistence?.save(persisted);
    this.notify();
  }

  private notify(): void {
    this.ver++;
    this.subscribers.forEach((cb) => cb());
  }

  getVersion(): number {
    return this.ver;
  }
}
