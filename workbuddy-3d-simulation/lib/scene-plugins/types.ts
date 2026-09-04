export type PluginHost = {
  el: HTMLElement;
  scene?: {
    add?: (obj: unknown) => void;
    remove?: (obj: unknown) => void;
  };
  render?: () => void;
  getObjectById?: (id: string) => unknown;
  [key: string]: unknown;
};

export type ListItem = {
  id: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

export type GroupedListItem = ListItem;

export type GroupedListGroup = {
  id: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  items: GroupedListItem[];
};

export type GroupedListControlEvent =
  | { type: 'all'; selected: boolean }
  | { type: 'group'; groupId: string; selected: boolean }
  | { type: 'item'; groupId: string; itemId: string; selected: boolean };

export type PluginControl =
  | { kind: 'toggle'; id: string; label: string; default?: boolean }
  | { kind: 'select'; id: string; label: string; options: { value: string; label: string }[]; default?: string }
  | { kind: 'radio'; id: string; label?: string; options: { value: string; label: string }[]; default?: string }
  | { kind: 'slider'; id: string; label: string; min: number; max: number; step?: number; default?: number }
  | { kind: 'number'; id: string; label: string; min?: number; max?: number; step?: number; default?: number; value?: string }
  | { kind: 'datetime'; id: string; label: string; default?: string }
  | { kind: 'button'; id: string; label: string }
  | {
      kind: 'list';
      id: string;
      label: string;
      collapsible?: boolean;
      items: ListItem[];
    }
  | {
      kind: 'grouped-list';
      id: string;
      label: string;
      collapsible?: boolean;
      groups: GroupedListGroup[];
    };

export interface PluginManifest {
  id: string;
  title: string;
  icon?: string;
  group?: string;
  activation: 'always' | 'toggle' | 'mode';
  controls?: PluginControl[];
  defaultEnabled?: boolean;
  defaultOpen?: boolean;
}

export interface PluginContext {
  viewer: PluginHost;
  pluginId: string;
  createOverlayRoot(): HTMLElement;
  addObject(obj: { userData?: Record<string, unknown> }): void;
  removeOwnObjects(): void;
  getBuildings?: () => unknown[];
  getScenePath?: () => string | undefined;
  getResource?: (key: string) => unknown;
  requestRender?: () => void;
}

export interface ScenePlugin {
  readonly manifest: PluginManifest;
  attach(ctx: PluginContext): void | Promise<void>;
  enable(): void;
  disable(): void;
  dispose(): void;
  getControls?(): PluginControl[];
  onControl?(controlId: string, value: unknown): void;
  on?(event: string, cb: (payload: unknown) => void): () => void;
}

export interface PersistenceAdapter {
  load(): string[] | null;
  save(enabledIds: string[]): void;
}
