import type { SoonspaceRuntime, SoonspaceSemanticClickInfo } from '@/lib/soonspace-runtime';
import { i18n, locale } from '@/lib/i18n';
import type { SceneTreeNode } from '@/lib/ustudio';
import { withBasePath } from '@/lib/client-path';
import type {
  GroupedListControlEvent,
  GroupedListGroup,
  PluginContext,
  PluginControl,
  PluginManifest,
  ScenePlugin,
} from '../types';

type ViewMode = '3D' | '2D';
type AnyObject = Record<string, unknown>;

type InvokeTarget = {
  twins_instance_id: string;
  twins_id?: string;
};

type InvokeInputParam = {
  key: string;
  value: unknown;
};

type InvokeSdk = {
  invokeTwinsFunction?: (params: {
    twins_id?: string;
    twins_instance_id: string;
    function_identifier: string;
    input_params: InvokeInputParam[];
  }) => Promise<unknown> | unknown;
  getSceneSetState?: () => LayerCommandState;
  subscribeSceneState?: (listener: (state: LayerCommandState) => void) => () => void;
};

type StoryOption = {
  key: string;
  outId: string;
  nodeId: string;
  label: string;
  node: SceneTreeNode;
};

type BuildingOption = {
  key: string;
  outId: string;
  label: string;
  node: SceneTreeNode | null;
  stories: StoryOption[];
};

type OverlayItem = {
  id: string;
  label: string;
  selected: boolean;
  loading?: boolean;
};

export type LayerApplyParams = {
  buildings?: unknown;
  stories?: unknown;
  mode?: unknown;
  yExtend?: unknown;
  labels?: unknown;
  reachable?: unknown;
  connectivity?: unknown;
  nodeId?: unknown;
  spaceId?: unknown;
};

export type LayerState = {
  buildings: string[];
  stories: string[];
  mode: ViewMode;
  yExtend: boolean;
  labels: boolean;
  reachable: boolean;
  connectivity: boolean;
  nodeId?: string;
  spaceId?: string;
};

export type LayerCommandState = {
  layer: LayerState;
  gis: { visible: boolean; available: boolean };
  routes: { routeId: string; label: string; visible: boolean }[];
  polygons: { polygonId: string; label: string; visible: boolean }[];
  available: {
    buildings: { buildingId: string; label: string }[];
    stories: { storyId: string; buildingId: string; label: string }[];
  };
};

const UI = {
  allStories: i18n('plugin.layer.allStories'),
  building: i18n('plugin.layer.building'),
  layer: i18n('plugin.layer.title'),
  buildingStories: i18n('plugin.layer.buildingStories'),
  yExtend: i18n('plugin.layer.yExtend'),
  labels: i18n('plugin.layer.labels'),
  gis: i18n('plugin.layer.gis'),
  reachable: i18n('plugin.layer.reachable'),
  connectivity: i18n('plugin.layer.connectivity'),
  routes: i18n('plugin.layer.routes'),
  polygons: i18n('plugin.layer.polygons'),
};
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed: ${url}`);
  }
  return (await response.json()) as T;
}

function normalizeList(payload: unknown): AnyObject[] {
  if (Array.isArray(payload)) return payload as AnyObject[];
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as AnyObject;
  for (const key of ['list', 'rows', 'records', 'items', 'data']) {
    const value = obj[key];
    if (Array.isArray(value)) return value as AnyObject[];
  }
  return [];
}

type Point3 = { x: number; y: number; z: number };
type RouteNode = { id?: string; position: Point3; [key: string]: unknown };

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

function toFiniteNumber(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function coordinateParts(value: unknown): unknown[] | null {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== 'string') return null;
  const text = parsed.trim();
  if (!text) return null;
  const parts = text.split(/[,&\s]+/).filter(Boolean);
  return parts.length >= 3 ? parts : null;
}

function toPoint3(value: unknown): Point3 | null {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    const x = toFiniteNumber(parsed[0]);
    const y = toFiniteNumber(parsed[1]);
    const z = toFiniteNumber(parsed[2]);
    return x === null || y === null || z === null ? null : { x, y, z };
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as AnyObject;
    const x = toFiniteNumber(obj.x);
    const y = toFiniteNumber(obj.y);
    const z = toFiniteNumber(obj.z);
    return x === null || y === null || z === null ? null : { x, y, z };
  }
  const parts = coordinateParts(parsed);
  if (!parts) return null;
  return toPoint3(parts);
}

function normalizeRoutePath(path: unknown): RouteNode[] {
  const parsed = parseMaybeJson(path);
  const source = Array.isArray(parsed) ? parsed : coordinateParts(parsed);
  if (!source) return [];

  if (source.every((item) => typeof item !== 'object' || item === null)) {
    const nodes: RouteNode[] = [];
    for (let index = 0; index + 2 < source.length; index += 3) {
      const point = toPoint3(source.slice(index, index + 3));
      if (point) nodes.push({ position: point });
    }
    return nodes;
  }

  return source
    .map((node, index): RouteNode | null => {
      if (!node || typeof node !== 'object') return null;
      const obj = node as AnyObject;
      const point = toPoint3(obj.position) ?? toPoint3(obj);
      if (!point) return null;
      return { ...obj, id: cleanString(obj.id) || String(index), position: point };
    })
    .filter((node): node is RouteNode => !!node);
}

function normalizeVirtualRouteDetail(detail: AnyObject, id: string): AnyObject {
  const normalized: AnyObject = { ...detail, route_id: id };
  const path = normalizeRoutePath(detail.path);
  if (path.length) normalized.path = path;
  const start = toPoint3(detail.start_coordinate);
  const end = toPoint3(detail.end_coordinate);
  if (start) normalized.start_coordinate = start;
  if (end) normalized.end_coordinate = end;
  return normalized;
}

function normalizePolygonPoints(points: unknown, y = 0, preferredStep?: 2 | 3): Point3[] {
  const parsed = parseMaybeJson(points);
  if (!Array.isArray(parsed)) return [];

  if (parsed.every((item) => typeof item !== 'object' || item === null)) {
    const nums = parsed.map(toFiniteNumber);
    if (nums.some((num) => num === null)) return [];
    const values = nums as number[];
    const step =
      preferredStep && values.length % preferredStep === 0
        ? preferredStep
        : values.length % 3 === 0
          ? 3
          : values.length % 2 === 0
            ? 2
            : 0;
    if (!step) return [];
    const result: Point3[] = [];
    for (let index = 0; index + step - 1 < values.length; index += step) {
      result.push(step === 3 ? { x: values[index], y: values[index + 1], z: values[index + 2] } : { x: values[index], y, z: values[index + 1] });
    }
    return result;
  }

  return parsed.map(toPoint3).filter((point): point is Point3 => !!point);
}

function fallbackPolygonPoints(detail: AnyObject, centroid: Point3 | null): Point3[] {
  const size = toFiniteNumber(detail.size);
  if (size === null || size <= 0) return [];
  const side = Math.sqrt(size);
  const half = side / 2;
  const center = centroid ?? { x: 0, y: 6, z: 0 };
  return [
    { x: center.x - half, y: center.y, z: center.z - half },
    { x: center.x + half, y: center.y, z: center.z - half },
    { x: center.x + half, y: center.y, z: center.z + half },
    { x: center.x - half, y: center.y, z: center.z + half },
  ];
}

function normalizeVirtualPolygonDetail(detail: AnyObject, id: string): AnyObject {
  const normalized: AnyObject = { ...detail, polygon_id: id };
  const center = toPoint3(detail.position) ?? toPoint3(detail.centroid);
  const parsedPolygon = parseMaybeJson(detail.polygon);
  const polygonObject = parsedPolygon && typeof parsedPolygon === 'object' && !Array.isArray(parsedPolygon) ? (parsedPolygon as AnyObject) : null;
  const pointCandidates = [
    normalizePolygonPoints(detail.points, center?.y ?? 0),
    normalizePolygonPoints(polygonObject?.points, center?.y ?? 0),
    normalizePolygonPoints(polygonObject?.shape, center?.y ?? 0, 2),
  ];
  const points = pointCandidates.find((item) => item.length) ?? fallbackPolygonPoints(detail, center);
  if (points.length) normalized.points = points;
  const opacity = toFiniteNumber(detail.opacity);
  if (opacity !== null) normalized.opacity = opacity;
  return normalized;
}

function describeError(error: unknown): AnyObject {
  if (error instanceof Error) {
    const extra = error as Error & { code?: unknown; details?: unknown; cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      code: extra.code,
      details: extra.details,
      cause: extra.cause instanceof Error ? { name: extra.cause.name, message: extra.cause.message } : extra.cause,
      stack: error.stack,
    };
  }
  if (error && typeof error === 'object') {
    const obj = error as AnyObject;
    return {
      ...obj,
      message: cleanString(obj.message),
      code: obj.code,
      details: obj.details,
    };
  }
  return { message: cleanString(error) || String(error) };
}

function pickString(item: AnyObject, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return '';
}

function cleanString(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return text.trim() ? text : '';
}

function cleanStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  let arrayValue = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      arrayValue = JSON.parse(text);
    } catch {
      throw new Error(`参数错误: ${field} 必须是数组或 JSON 数组字符串`);
    }
  }
  if (!Array.isArray(arrayValue)) throw new Error(`参数错误: ${field} 必须是数组或 JSON 数组字符串`);
  return arrayValue.map(cleanString).filter(Boolean);
}

function parseBooleanParam(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`参数错误: ${field} 必须是 boolean 或字符串 true/false`);
}

function readBooleanParam(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return parseBooleanParam(value, field);
}

function readViewMode(value: unknown, fallback: ViewMode): ViewMode {
  if (value === undefined || value === null || value === '') return fallback;
  const mode = String(value).toUpperCase();
  if (mode !== '2D' && mode !== '3D') throw new Error('参数错误: mode 只能是 2D 或 3D');
  return mode;
}

function nodeType(node: SceneTreeNode | null | undefined): string {
  return String(node?.twins_identifier ?? node?.type ?? '').toLowerCase();
}

function nodeLabel(node: SceneTreeNode | null | undefined, fallback: string): string {
  return String(node?.twins_instance_name ?? node?.name ?? fallback);
}

function nodeOutId(node: SceneTreeNode | null | undefined): string {
  return String(node?.out_instance_id ?? node?.id ?? node?.twins_instance_id ?? '');
}

function nodeTwinId(node: SceneTreeNode | null | undefined): string {
  return String(node?.twins_instance_id ?? node?.id ?? node?.out_instance_id ?? '');
}

function childrenOf(node: SceneTreeNode | null | undefined): SceneTreeNode[] {
  return Array.isArray(node?.children) ? node.children : [];
}

function walk(node: SceneTreeNode | null | undefined, visit: (node: SceneTreeNode) => void): void {
  if (!node) return;
  visit(node);
  childrenOf(node).forEach((child) => walk(child, visit));
}

function findNodeByInstanceId(treeData: SceneTreeNode | SceneTreeNode[] | null | undefined, id: string): SceneTreeNode | null {
  if (!id) return null;
  let found: SceneTreeNode | null = null;
  const roots = Array.isArray(treeData) ? treeData : treeData ? [treeData] : [];
  for (const root of roots) {
    walk(root, (node) => {
      if (found) return;
      const aliases = [
        nodeOutId(node),
        nodeTwinId(node),
        cleanString(node.id),
        cleanString(node.twins_instance_name),
        cleanString(node.name),
      ];
      if (aliases.includes(id)) found = node;
    });
    if (found) break;
  }
  return found;
}


function findSceneInvokeTarget(treeData: SceneTreeNode | SceneTreeNode[] | null | undefined): InvokeTarget | null {
  let site: InvokeTarget | null = null;
  let fallback: InvokeTarget | null = null;
  const roots = Array.isArray(treeData) ? treeData : treeData ? [treeData] : [];
  for (const root of roots) {
    walk(root, (node) => {
      const twinsInstanceId = cleanString(node.twins_instance_id);
      if (!twinsInstanceId) return;
      const twinsId = cleanString(node.twins_id);
      const target: InvokeTarget = {
        twins_instance_id: twinsInstanceId,
        ...(twinsId ? { twins_id: twinsId } : {}),
      };
      if (!fallback) fallback = target;
      const type = nodeType(node);
      const outId = cleanString(node.out_instance_id).toLowerCase();
      const id = cleanString(node.id).toLowerCase();
      if (!site && (type === 'site' || outId === 'site_root' || id === 'site_root')) {
        site = target;
      }
    });
    if (site) break;
  }
  return site ?? fallback;
}

function compactInvokeParams(params: AnyObject): AnyObject {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

function toInvokeInputParams(params: AnyObject): InvokeInputParam[] {
  return Object.entries(compactInvokeParams(params)).map(([key, value]) => ({ key, value }));
}

function isReachableClickType(type: string): boolean {
  return type === 'stairs' || type === 'door' || type === 'point' || type === 'dot' || type === 'poi' || type === 'sceneinout';
}

function collectDescendantOutIds(node: SceneTreeNode): string[] {
  const ids: string[] = [];
  walk(node, (child) => {
    const id = nodeOutId(child);
    if (id) ids.push(id);
  });
  return ids;
}

function collectTreeOutIds(treeData: SceneTreeNode | SceneTreeNode[] | null | undefined): string[] {
  const ids: string[] = [];
  const roots = Array.isArray(treeData) ? treeData : treeData ? [treeData] : [];
  for (const root of roots) {
    walk(root, (node) => {
      const id = nodeOutId(node);
      if (id) ids.push(id);
    });
  }
  return ids;
}

function isBuilding(node: SceneTreeNode): boolean {
  const type = nodeType(node);
  return type === 'building' || type.endsWith('building') || type.includes('building');
}

function isStory(node: SceneTreeNode): boolean {
  const type = nodeType(node);
  return type === 'story' || type.endsWith('story') || type.includes('floor');
}

function sortStory(a: StoryOption, b: StoryOption): number {
  const na = Number(a.label.match(/-?\d+/)?.[0] ?? Number.NaN);
  const nb = Number(b.label.match(/-?\d+/)?.[0] ?? Number.NaN);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.label.localeCompare(b.label, locale === 'en' ? 'en-US' : 'zh-Hans-CN');
}

function buildOptions(treeData: SceneTreeNode | SceneTreeNode[] | null): BuildingOption[] {
  const roots = Array.isArray(treeData) ? treeData : treeData ? [treeData] : [];
  const buildings: SceneTreeNode[] = [];
  const allStories: SceneTreeNode[] = [];

  roots.forEach((root) => {
    walk(root, (node) => {
      if (isBuilding(node)) buildings.push(node);
      if (isStory(node)) allStories.push(node);
    });
  });

  const collectStories = (node: SceneTreeNode): SceneTreeNode[] => {
    const stories: SceneTreeNode[] = [];
    walk(node, (child) => {
      if (child !== node && isStory(child)) stories.push(child);
    });
    return stories;
  };

  if (buildings.length === 0) {
    const stories = allStories.map((story, index) => ({
      key: nodeTwinId(story) || `story-${index}`,
      outId: nodeOutId(story),
      nodeId: nodeTwinId(story),
      label: nodeLabel(story, `${index + 1}F`),
      node: story,
    }));
    stories.sort(sortStory);
    return [{ key: 'all-buildings', outId: '', label: UI.allStories, node: null, stories }];
  }

  return buildings.map((building, buildingIndex) => {
    const stories = collectStories(building).map((story, storyIndex) => ({
      key: nodeTwinId(story) || `${nodeOutId(building)}-${storyIndex}`,
      outId: nodeOutId(story),
      nodeId: nodeTwinId(story),
      label: nodeLabel(story, `${storyIndex + 1}F`),
      node: story,
    }));
    stories.sort(sortStory);
    return {
      key: nodeOutId(building) || nodeTwinId(building) || `building-${buildingIndex}`,
      outId: nodeOutId(building),
      label: nodeLabel(building, `${UI.building} ${buildingIndex + 1}`),
      node: building,
      stories,
    };
  });
}

function normalizeOverlayItems(rows: unknown, idKeys: string[], labelKeys: string[], fallbackPrefix: string): OverlayItem[] {
  return normalizeList(rows)
    .map((row, index) => {
      const id = pickString(row, idKeys) || `${fallbackPrefix}-${index}`;
      const label = pickString(row, labelKeys) || `${fallbackPrefix} ${index + 1}`;
      return { id, label, selected: false };
    })
    .filter((item) => !!item.id);
}

function normalizeRouteItems(rows: unknown): OverlayItem[] {
  return normalizeList(rows)
    .map((row, index) => {
      const id = pickString(row, ['route_id', 'id', 'uuid', 'twins_route_id']) || `${UI.routes}-${index}`;
      const label =
        pickString(row, ['route_name']) ||
        pickString(row, ['name', 'label', 'twins_route_name', 'routeName']) ||
        `${UI.routes} ${index + 1}`;
      return { id, label, selected: false };
    })
    .filter((item) => !!item.id);
}

export class UStudioSceneTool implements ScenePlugin {
  readonly manifest: PluginManifest = {
    id: 'ustudio-scene-tool',
    title: UI.layer,
    activation: 'always',
    defaultOpen: true,
  };

  private ctx: PluginContext | null = null;
  private runtime: SoonspaceRuntime | null = null;
  private sceneId = '';
  private treeData: SceneTreeNode | SceneTreeNode[] | null = null;
  private sceneInvokeTarget: InvokeTarget | null = null;
  private buildings: BuildingOption[] = [];
  private selectedStoryKeys = new Set<string>();
  private selectedBuildingKeys = new Set<string>();
  private mode: ViewMode = '3D';
  private yExtendVisible = false;
  private labelsVisible = false;
  private gisVisible = true;
  private reachableVisible = false;
  private connectivityVisible = false;
  private selectedNodeId: string | null = null;
  private selectedSpaceId: string | null = null;
  private reachableHighlightOutId: string | null = null;
  private connectivityHighlightOutId: string | null = null;
  private reachableRendering = false;
  private connectivityRendering = false;
  private reachableRequestVersion = 0;
  private connectivityRequestVersion = 0;
  private routeItems: OverlayItem[] = [];
  private polygonItems: OverlayItem[] = [];
  private polygonNodeBindings = new Map<string, string>();
  private drawnRoutes = new Map<string, string>();
  private drawnPolygons = new Map<string, string>();
  private sceneClickUnsubscribe: (() => void) | null = null;
  private sceneStateUnsubscribe: (() => void) | null = null;
  private lastSceneClickKey = '';
  private lastSceneClickAt = 0;
  private disposed = false;

  async attach(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.runtime = ctx.getResource?.('runtime') as SoonspaceRuntime | null;
    this.sceneId = String(ctx.getResource?.('sceneId') ?? '');
    this.treeData = (ctx.getResource?.('treeData') as SceneTreeNode | SceneTreeNode[] | null) ?? null;
    if (!this.treeData && this.sceneId) {
      this.treeData = await fetchJson<SceneTreeNode>(withBasePath(`/api/ustudio/tree?sceneId=${encodeURIComponent(this.sceneId)}`));
    }
    this.sceneInvokeTarget = findSceneInvokeTarget(this.treeData);
    this.rebuildOptions();
    await this.loadOverlayLists();
    this.subscribeSdkSceneState();
    this.sceneClickUnsubscribe = this.runtime?.setSceneClickHandler((info) => {
      void this.handleSceneClick(info);
    }) ?? null;
    this.ctx?.requestRender?.();
  }

  enable(): void {
    this.disposed = false;
    this.runControlTask('refreshAll', this.refreshAll());
  }

  disable(): void {
    this.reachableRequestVersion += 1;
    this.connectivityRequestVersion += 1;
    this.runtime?.hideLabels();
    this.runtime?.hideGis();
    this.clearReachableSelection();
    this.clearConnectivitySelection();
    this.runtime?.clearReachableRoutes();
    this.runtime?.clearConnectivityRoutes();
    for (const [id, renderId] of this.drawnRoutes.entries()) {
      try {
        this.runtime?.setVirtualRouteVisible(renderId, false);
      } catch (error) {
        console.warn('[ustudio-scene-tool] hide virtual route on disable failed', { id, renderId, error: describeError(error) });
        this.drawnRoutes.delete(id);
      }
    }
    for (const [id, renderId] of this.drawnPolygons.entries()) {
      try {
        this.runtime?.setVirtualPolygonVisible(renderId, false);
      } catch (error) {
        console.warn('[ustudio-scene-tool] hide virtual polygon on disable failed', { id, renderId, error: describeError(error) });
        this.drawnPolygons.delete(id);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.disable();
    this.sceneClickUnsubscribe?.();
    this.sceneClickUnsubscribe = null;
    this.sceneStateUnsubscribe?.();
    this.sceneStateUnsubscribe = null;
    this.ctx = null;
    this.runtime = null;
  }

  getControls(): PluginControl[] {
    return [
      { kind: 'grouped-list', id: 'stories', label: UI.buildingStories, groups: this.toGroupedList() },
      {
        kind: 'radio',
        id: 'mode',
        options: [
          { value: '3D', label: '3D' },
          { value: '2D', label: '2D' },
        ],
        default: this.mode,
      },
      { kind: 'toggle', id: 'yExtend', label: UI.yExtend, default: this.yExtendVisible },
      { kind: 'toggle', id: 'labels', label: UI.labels, default: this.labelsVisible },
      { kind: 'toggle', id: 'gis', label: UI.gis, default: this.gisVisible },
      { kind: 'toggle', id: 'reachable', label: UI.reachable, default: this.reachableVisible },
      { kind: 'toggle', id: 'connectivity', label: UI.connectivity, default: this.connectivityVisible },
      { kind: 'list', id: 'routes', label: UI.routes, items: this.routeItems },
      { kind: 'list', id: 'polygons', label: UI.polygons, items: this.polygonItems },
    ];
  }

  async applyLayer(params: LayerApplyParams = {}): Promise<LayerState> {
    const state = this.applyLayerState(params);
    await this.invokeCurrentLayerOrRenderLocally(true);
    return state;
  }

  getLayerState(): LayerState {
    return {
      buildings: this.selectedBuildingsForState().map((building) => building.key),
      stories: this.selectedStories().map((story) => story.key),
      mode: this.mode,
      yExtend: this.yExtendVisible,
      labels: this.labelsVisible,
      reachable: this.reachableVisible,
      connectivity: this.connectivityVisible,
      nodeId: this.reachableVisible ? this.selectedNodeId ?? undefined : undefined,
      spaceId: this.connectivityVisible ? this.selectedSpaceId ?? undefined : undefined,
    };
  }

  getLayerCommandState(): LayerCommandState {
    const runtime = this.runtime as (SoonspaceRuntime & { isGisAvailable?: () => boolean }) | null;
    return {
      layer: this.getLayerState(),
      gis: { visible: this.gisVisible, available: runtime?.isGisAvailable?.() === true },
      routes: this.routeItems.map((item) => ({ routeId: item.id, label: item.label, visible: !!item.selected })),
      polygons: this.polygonItems.map((item) => ({ polygonId: item.id, label: item.label, visible: !!item.selected })),
      available: {
        buildings: this.buildings.map((building) => ({ buildingId: building.key, label: building.label })),
        stories: this.buildings.flatMap((building) =>
          building.stories.map((story) => ({ storyId: story.key, buildingId: building.key, label: story.label })),
        ),
      },
    };
  }

  async setGisVisible(visible: unknown): Promise<{ visible: boolean }> {
    const nextVisible = parseBooleanParam(visible, 'visible');
    const invoked = await this.tryInvokeSceneFunction('gisSetVisible', { visible: nextVisible });
    if (!invoked) {
      if (!this.runtime) throw new Error('场景未就绪');
      const runtime = this.runtime as SoonspaceRuntime & { setGisVisible?: (visible: boolean) => void | Promise<void> };
      if (typeof runtime.setGisVisible !== 'function') throw new Error('GIS方法未实现: setGisVisible');
      await runtime.setGisVisible(nextVisible);
    }
    this.gisVisible = nextVisible;
    this.ctx?.requestRender?.();
    return { visible: this.gisVisible };
  }

  async setRoutesVisible(routeIds: string[], visible: unknown): Promise<{ routeId: string; visible: boolean }[]> {
    const nextVisible = parseBooleanParam(visible, 'visible');
    const ids = routeIds.map(cleanString).filter(Boolean);
    if (ids.length === 0) throw new Error('参数错误: routeIds 不能为空');
    const invoked = await this.tryInvokeSceneFunction('virtualRouteSetVisible', { routeIds: ids, visible: nextVisible });
    if (invoked) this.markRoutesVisible(ids, nextVisible);
    else for (const id of ids) await this.setVirtualRouteVisible(id, nextVisible, false);
    return ids.map((routeId) => ({ routeId, visible: this.routeItems.find((item) => item.id === routeId)?.selected === true }));
  }

  async setPolygonsVisible(polygonIds: string[], visible: unknown): Promise<{ polygonId: string; visible: boolean }[]> {
    const nextVisible = parseBooleanParam(visible, 'visible');
    const ids = polygonIds.map(cleanString).filter(Boolean);
    if (ids.length === 0) throw new Error('参数错误: polygonIds 不能为空');
    const polygonIdsToRender: string[] = [];
    for (const id of ids) {
      if (this.polygonNodeBindings.has(id)) await this.setPolygonNodeVisible(id, nextVisible);
      else polygonIdsToRender.push(id);
    }
    if (polygonIdsToRender.length > 0) {
      const invoked = await this.tryInvokeSceneFunction('polygonSetVisible', { polygonIds: polygonIdsToRender, visible: nextVisible });
      if (invoked) this.markPolygonsVisible(polygonIdsToRender, nextVisible);
      else for (const id of polygonIdsToRender) await this.setVirtualPolygonVisible(id, nextVisible, false);
    }
    return ids.map((polygonId) => ({
      polygonId,
      visible: this.polygonItems.find((item) => item.id === polygonId)?.selected === true,
    }));
  }

  onControl(controlId: string, value: unknown): void {
    const useInvoke = this.hasSceneInvokeSdk();
    if (controlId === 'stories') {
      this.applyGroupedEvent(value as GroupedListControlEvent);
      if (useInvoke) this.runControlTask('setScene', this.invokeCurrentLayerOrRenderLocally());
      else void this.refreshAll();
      return;
    }
    if (controlId === 'mode') {
      this.mode = value === '2D' ? '2D' : '3D';
      if (useInvoke) this.runControlTask('setScene', this.invokeCurrentLayerOrRenderLocally());
      else void this.refreshAll();
      return;
    }
    if (controlId === 'yExtend') {
      this.yExtendVisible = Boolean(value);
      if (useInvoke) this.runControlTask('setScene', this.invokeCurrentLayerOrRenderLocally());
      else void this.refreshAll();
      return;
    }
    if (controlId === 'labels') {
      this.labelsVisible = Boolean(value);
      if (useInvoke) this.runControlTask('setScene', this.invokeCurrentLayerOrRenderLocally());
      else {
        this.syncLabels();
        this.ctx?.requestRender?.();
      }
      return;
    }
    if (controlId === 'gis') {
      this.gisVisible = Boolean(value);
      this.runControlTask('gisSetVisible', this.setGisVisible(this.gisVisible));
      return;
    }
    if (controlId === 'reachable') {
      this.reachableVisible = Boolean(value);
      if (this.reachableVisible) this.mode = '2D';
      else this.clearReachableFeature();
      if (useInvoke) this.runControlTask('setScene', this.invokeCurrentLayerOrRenderLocally());
      else if (this.reachableVisible) void this.redrawReachableAfterSemanticViewSync();
      return;
    }
    if (controlId === 'connectivity') {
      this.connectivityVisible = Boolean(value);
      if (this.connectivityVisible) this.mode = '2D';
      else this.clearConnectivityFeature();
      if (useInvoke) this.runControlTask('setScene', this.invokeCurrentLayerOrRenderLocally());
      else if (this.connectivityVisible) void this.redrawConnectivityAfterSemanticViewSync();
      return;
    }
    if (controlId === 'routes') {
      void this.toggleVirtualRoute(value as { id?: string; selected?: boolean });
      return;
    }
    if (controlId === 'polygons') {
      void this.toggleVirtualPolygon(value as { id?: string; selected?: boolean });
    }
  }

  private getSceneInvokeTarget(): InvokeTarget | null {
    this.sceneInvokeTarget = this.sceneInvokeTarget ?? findSceneInvokeTarget(this.treeData);
    return this.sceneInvokeTarget;
  }

  private subscribeSdkSceneState(): void {
    this.sceneStateUnsubscribe?.();
    this.sceneStateUnsubscribe = null;
    const sdk = this.getInvokeSdk();
    if (typeof sdk?.subscribeSceneState !== 'function') return;
    this.sceneStateUnsubscribe = sdk.subscribeSceneState((state) => {
      this.syncFromSdkSceneState(state);
    });
  }

  private syncFromSdkSceneState(state: LayerCommandState): void {
    if (!state || this.disposed) return;
    try {
      this.applyLayerState(state.layer);
    } catch (error) {
      console.warn('[ustudio-scene-tool] sync scene state failed', describeError(error));
      return;
    }
    this.gisVisible = state.gis?.visible === true;
    this.syncOverlayStateFromSdk(state.routes, 'route');
    this.syncOverlayStateFromSdk(state.polygons, 'polygon');
    this.ctx?.requestRender?.();
  }

  private syncOverlayStateFromSdk(
    source: Array<{ routeId?: string; polygonId?: string; label?: string; visible?: boolean }> | undefined,
    kind: 'route' | 'polygon',
  ): void {
    if (!Array.isArray(source)) return;
    const idKey = kind === 'route' ? 'routeId' : 'polygonId';
    const visibleById = new Map<string, { label: string; visible: boolean }>();
    for (const item of source) {
      const id = cleanString(item[idKey]);
      if (!id) continue;
      visibleById.set(id, { label: cleanString(item.label) || id, visible: item.visible === true });
    }
    const target = kind === 'route' ? this.routeItems : this.polygonItems;
    const seen = new Set<string>();
    const next = target.map((item) => {
      const incoming = visibleById.get(item.id);
      if (kind === 'polygon' && this.polygonNodeBindings.has(item.id)) {
        return { ...item, loading: false };
      }
      if (!incoming) return { ...item, selected: false, loading: false };
      seen.add(item.id);
      return { ...item, label: incoming.label || item.label, selected: incoming.visible, loading: false };
    });
    for (const [id, incoming] of visibleById) {
      if (kind === 'polygon') continue;
      if (!seen.has(id)) next.push({ id, label: incoming.label, selected: incoming.visible, loading: false });
    }
    if (kind === 'route') this.routeItems = next;
    else this.polygonItems = next;
  }

  private getInvokeSdk(): InvokeSdk | null {
    const runtime = this.runtime as (SoonspaceRuntime & { getSdk?: () => InvokeSdk | null }) | null;
    const sdk = runtime?.getSdk?.();
    return typeof sdk?.invokeTwinsFunction === 'function' ? sdk : null;
  }

  private hasSceneInvokeSdk(): boolean {
    return this.getInvokeSdk() !== null;
  }

  private async tryInvokeSceneFunction(functionIdentifier: string, params: AnyObject): Promise<boolean> {
    const sdk = this.getInvokeSdk();
    if (!sdk) return false;
    const target = this.getSceneInvokeTarget();
    if (!target) {
      console.warn('[ustudio-scene-tool] invoke skipped: Site twins_instance_id missing', { functionIdentifier });
      return false;
    }
    try {
      await sdk.invokeTwinsFunction?.({
        twins_id: target.twins_id,
        twins_instance_id: target.twins_instance_id,
        function_identifier: functionIdentifier,
        input_params: toInvokeInputParams(params),
      });
      return true;
    } catch (error) {
      console.warn('[ustudio-scene-tool] invoke failed, fallback to local runtime', {
        functionIdentifier,
        target,
        params,
        error: describeError(error),
      });
      return false;
    }
  }

  private invokeCurrentLayer(extra: AnyObject = {}): Promise<boolean> {
    return this.tryInvokeSceneFunction('setScene', this.currentLayerInvokeParams(extra));
  }

  private async invokeCurrentLayerOrRenderLocally(clearInactive = false, extra: AnyObject = {}): Promise<void> {
    const invoked = await this.invokeCurrentLayer(extra);
    if (!invoked) await this.renderCurrentLayerLocally(clearInactive);
    else this.ctx?.requestRender?.();
  }

  private currentLayerInvokeParams(extra: AnyObject = {}): AnyObject {
    const layer = this.getLayerState();
    return compactInvokeParams({
      buildings: layer.buildings,
      stories: layer.stories,
      mode: layer.mode,
      yExtend: layer.yExtend,
      labels: layer.labels,
      reachable: layer.reachable,
      connectivity: layer.connectivity,
      nodeId: layer.nodeId,
      spaceId: layer.spaceId,
      ...extra,
    });
  }

  private applyLayerState(params: LayerApplyParams = {}): LayerState {
    this.ensureReady();
    const buildingIds = cleanStringArray(params.buildings, 'buildings');
    const storyIds = cleanStringArray(params.stories, 'stories');
    const reachable = readBooleanParam(params.reachable, 'reachable', false);
    const connectivity = readBooleanParam(params.connectivity, 'connectivity', false);
    const mode = readViewMode(params.mode, reachable || connectivity ? '2D' : '3D');

    this.applySelection(buildingIds, storyIds);
    this.mode = mode;
    this.yExtendVisible = readBooleanParam(params.yExtend, 'yExtend', false);
    this.labelsVisible = readBooleanParam(params.labels, 'labels', false);
    this.reachableVisible = reachable;
    this.connectivityVisible = connectivity;
    this.selectedNodeId = reachable ? cleanString(params.nodeId) || null : null;
    this.selectedSpaceId = connectivity ? cleanString(params.spaceId) || null : null;
    return this.getLayerState();
  }

  private async renderCurrentLayerLocally(clearInactive = false): Promise<void> {
    await this.applyViewMode();
    this.syncLabels();
    if (this.reachableVisible) await this.redrawReachable();
    else if (clearInactive) this.clearReachableFeature();
    if (this.connectivityVisible) await this.redrawConnectivity();
    else if (clearInactive) this.clearConnectivityFeature();
    this.ctx?.requestRender?.();
  }

  private markRoutesVisible(ids: string[], visible: boolean): void {
    for (const id of ids) {
      const known = this.routeItems.some((item) => item.id === id);
      if (!known) {
        if (visible) this.routeItems = [...this.routeItems, { id, label: id, selected: true, loading: false }];
        continue;
      }
      this.routeItems = this.routeItems.map((item) =>
        item.id === id ? { ...item, selected: visible, loading: false } : item,
      );
    }
    this.ctx?.requestRender?.();
  }

  private markPolygonsVisible(ids: string[], visible: boolean): void {
    for (const id of ids) {
      const known = this.polygonItems.some((item) => item.id === id);
      if (!known) {
        if (visible) this.polygonItems = [...this.polygonItems, { id, label: id, selected: true, loading: false }];
        continue;
      }
      this.polygonItems = this.polygonItems.map((item) =>
        item.id === id ? { ...item, selected: visible, loading: false } : item,
      );
    }
    this.ctx?.requestRender?.();
  }

  private runControlTask(action: string, task: Promise<unknown>): void {
    void task.catch((error) => {
      console.warn(`[ustudio-scene-tool] ${action} failed`, describeError(error));
      this.ctx?.requestRender?.();
    });
  }

  private rebuildOptions(): void {
    this.buildings = buildOptions(this.treeData);
    this.selectedBuildingKeys = new Set();
    this.selectedStoryKeys = new Set();
  }

  private async loadOverlayLists(): Promise<void> {
    if (!this.sceneId) return;
    const sceneParam = encodeURIComponent(this.sceneId);
    const [routes, polygons] = await Promise.all([
      fetchJson<unknown>(withBasePath(`/api/ustudio/routes?sceneId=${sceneParam}`)).catch((error) => {
        console.warn('[ustudio-scene-tool] routes list failed', error);
        return [];
      }),
      fetchJson<unknown>(withBasePath(`/api/ustudio/polygons?sceneId=${sceneParam}`)).catch((error) => {
        console.warn('[ustudio-scene-tool] polygons list failed', error);
        return [];
      }),
    ]);
    this.routeItems = normalizeRouteItems(routes);
    const polygonRows = normalizeList(polygons);
    const sourceTwoPolygonIds = new Set(
      polygonRows
        .filter((row) => cleanString(row.source) === '2')
        .map((row) => pickString(row, ['polygon_id', 'id', 'uuid', 'twins_polygon_id']))
        .filter(Boolean),
    );
    this.polygonNodeBindings = new Map(
      polygonRows
        .map((row) => {
          const id = pickString(row, ['polygon_id', 'id', 'uuid', 'twins_polygon_id']);
          const source = cleanString(row.source);
          const outInstanceId = cleanString(row.out_instance_id);
          return source === '2' && id && outInstanceId ? [id, outInstanceId] as const : null;
        })
        .filter((entry): entry is readonly [string, string] => entry !== null),
    );
    this.polygonItems = normalizeOverlayItems(
      polygonRows,
      ['polygon_id', 'id', 'uuid', 'twins_polygon_id'],
      ['polygon_name', 'name', 'label', 'twins_polygon_name'],
      UI.polygons,
    ).map((item) => sourceTwoPolygonIds.has(item.id) ? { ...item, selected: true } : item);
    console.info('[ustudio-scene-tool] overlay lists loaded', {
      rawRoutes: routes,
      rawPolygons: polygons,
      routeCount: this.routeItems.length,
      polygonCount: this.polygonItems.length,
    });
  }

  private ensureReady(): void {
    if (!this.runtime || !this.treeData) throw new Error('场景未就绪');
  }

  private selectedBuildingsForState(): BuildingOption[] {
    return this.buildings.filter((building) => {
      if (this.selectedBuildingKeys.has(building.key)) return true;
      return building.stories.some((story) => this.selectedStoryKeys.has(story.key));
    });
  }

  private buildingAliases(building: BuildingOption): string[] {
    return [
      building.key,
      building.outId,
      nodeTwinId(building.node),
      cleanString(building.node?.id),
      building.label,
    ].filter(Boolean);
  }

  private storyAliases(story: StoryOption): string[] {
    return [
      story.key,
      story.outId,
      story.nodeId,
      nodeOutId(story.node),
      nodeTwinId(story.node),
      cleanString(story.node.id),
      story.label,
    ].filter(Boolean);
  }

  private findBuildingById(id: string): BuildingOption | null {
    return this.buildings.find((building) => this.buildingAliases(building).includes(id)) ?? null;
  }

  private findStoryById(id: string): StoryOption | null {
    return this.buildings.flatMap((building) => building.stories).find((story) => this.storyAliases(story).includes(id)) ?? null;
  }

  private buildingForStory(story: StoryOption): BuildingOption | null {
    return this.buildings.find((building) => building.stories.some((item) => item.key === story.key)) ?? null;
  }

  private applySelection(buildingIds: string[], storyIds: string[]): void {
    const hasExplicitBuildingSelection = buildingIds.length > 0;
    const hasExplicitStorySelection = storyIds.length > 0;

    if (!hasExplicitBuildingSelection && !hasExplicitStorySelection) {
      this.selectedBuildingKeys = new Set();
      this.selectedStoryKeys = new Set();
      return;
    }

    const requestedBuildings = hasExplicitBuildingSelection
      ? buildingIds.map((id) => ({ id, building: this.findBuildingById(id) }))
      : [];
    const missingBuildings = requestedBuildings.filter((item) => !item.building).map((item) => item.id);
    if (missingBuildings.length > 0) throw new Error(`楼栋对象未找到: ${missingBuildings.join(', ')}`);

    const buildings = requestedBuildings.map((item) => item.building).filter((item): item is BuildingOption => !!item);
    const buildingKeys = new Set(buildings.map((building) => building.key));
    const stories = hasExplicitStorySelection
      ? storyIds.map((id) => ({ id, story: this.findStoryById(id) }))
      : buildings.flatMap((building) => building.stories).map((story) => ({ id: story.key, story }));
    const missingStories = stories.filter((item) => !item.story).map((item) => item.id);
    if (missingStories.length > 0) throw new Error(`楼层对象未找到: ${missingStories.join(', ')}`);

    const selectedStories = stories.map((item) => item.story).filter((item): item is StoryOption => !!item);
    if (hasExplicitBuildingSelection && hasExplicitStorySelection) {
      const outOfScope = selectedStories.filter((story) => {
        const building = this.buildingForStory(story);
        return !building || !buildingKeys.has(building.key);
      });
      if (outOfScope.length > 0) throw new Error(`楼层不属于已选楼栋: ${outOfScope.map((story) => story.key).join(', ')}`);
    }

    this.selectedBuildingKeys = new Set(buildings.map((building) => building.key));
    for (const story of selectedStories) {
      const building = this.buildingForStory(story);
      if (building) this.selectedBuildingKeys.add(building.key);
    }
    this.selectedStoryKeys = new Set(selectedStories.map((story) => story.key));
  }

  private clearReachableFeature(): void {
    this.reachableRequestVersion += 1;
    this.clearReachableSelection();
    this.runtime?.clearReachableRoutes();
  }

  private clearConnectivityFeature(): void {
    this.connectivityRequestVersion += 1;
    this.clearConnectivitySelection();
    this.runtime?.clearConnectivityRoutes();
  }

  private toGroupedList(): GroupedListGroup[] {
    return this.buildings.map((building) => {
      const selectedStoryCount = building.stories.filter((story) => this.selectedStoryKeys.has(story.key)).length;
      return {
        id: building.key,
        label: building.label,
        selected:
          building.stories.length > 0
            ? selectedStoryCount === building.stories.length
            : this.selectedBuildingKeys.has(building.key),
        items: building.stories.map((story) => ({
          id: story.key,
          label: story.label,
          selected: this.selectedStoryKeys.has(story.key),
        })),
      };
    });
  }

  private applyGroupedEvent(event: GroupedListControlEvent): void {
    if (!event) return;
    if (event.type === 'all') {
      this.selectedBuildingKeys = new Set(event.selected ? this.buildings.map((b) => b.key) : []);
      this.selectedStoryKeys = new Set(event.selected ? this.buildings.flatMap((b) => b.stories.map((s) => s.key)) : []);
      return;
    }
    const building = this.buildings.find((b) => b.key === event.groupId);
    if (!building) return;
    if (event.type === 'group') {
      if (event.selected) this.selectedBuildingKeys.add(building.key);
      else this.selectedBuildingKeys.delete(building.key);
      for (const story of building.stories) {
        if (event.selected) this.selectedStoryKeys.add(story.key);
        else this.selectedStoryKeys.delete(story.key);
      }
      return;
    }
    if (event.type === 'item') {
      if (event.selected) this.selectedStoryKeys.add(event.itemId);
      else this.selectedStoryKeys.delete(event.itemId);
      const hasSelectedStory = building.stories.some((story) => this.selectedStoryKeys.has(story.key));
      if (hasSelectedStory) this.selectedBuildingKeys.add(building.key);
      else this.selectedBuildingKeys.delete(building.key);
    }
  }

  private selectedStories(): StoryOption[] {
    return this.buildings
      .flatMap((building) => building.stories)
      .filter((story) => this.selectedStoryKeys.has(story.key));
  }

  private hasLayerSelection(): boolean {
    return this.selectedBuildingKeys.size > 0 || this.selectedStoryKeys.size > 0;
  }

  private labelStories(): StoryOption[] {
    const selectedStories = this.selectedStories();
    if (this.hasLayerSelection()) return selectedStories;
    return this.buildings.flatMap((building) => building.stories);
  }

  private selectedStoryOutIds(): string[] {
    return this.selectedStories()
      .map((story) => story.outId)
      .filter(Boolean);
  }

  private selectedStoryNodeIds(): string[] {
    const stories = this.hasLayerSelection()
      ? this.selectedStories()
      : this.buildings.flatMap((building) => building.stories);
    return stories
      .map((story) => story.nodeId)
      .filter(Boolean);
  }

  private selectedBuildingOutIds(): string[] {
    return this.buildings
      .filter((building) => {
        if (this.selectedBuildingKeys.has(building.key)) return true;
        return building.stories.some((story) => this.selectedStoryKeys.has(story.key));
      })
      .map((building) => building.outId)
      .filter(Boolean);
  }

  private labelOutIds(): string[] {
    const ids = new Set<string>();
    for (const story of this.labelStories()) collectDescendantOutIds(story.node).forEach((id) => ids.add(id));
    if (ids.size === 0 && !this.hasLayerSelection()) {
      collectTreeOutIds(this.treeData).forEach((id) => ids.add(id));
    }
    return [...ids];
  }

  private labelStoryOutIds(): string[] {
    return this.hasLayerSelection() ? this.selectedStoryOutIds() : [];
  }

  private async refreshAll(): Promise<void> {
    if (this.disposed) return;
    await this.applyViewMode();
    this.syncLabels();
    if (this.reachableVisible) await this.redrawReachable();
    if (this.connectivityVisible) await this.redrawConnectivity();
    this.ctx?.requestRender?.();
  }

  private async applyViewMode(): Promise<void> {
    if (!this.runtime || !this.treeData) return;
    const storyOutIds = this.selectedStoryOutIds();
    const buildingOutIds = this.selectedBuildingOutIds();
    const params: AnyObject[] = [{ type: this.mode, ids: storyOutIds }];
    if (this.yExtendVisible) params.push({ type: 'YExtend', ids: storyOutIds });
    await this.runtime.setViewMode(params, this.treeData, storyOutIds, buildingOutIds);
    this.runtime.syncUserAddedInstancesDisplay({
      treeData: this.treeData,
      is2D: this.mode === '2D',
      isYExtend: this.yExtendVisible,
      selectedPoiId: null,
    });
  }

  private async applySemanticClickViewMode(): Promise<void> {
    if (this.mode !== '2D') this.mode = '2D';
    await this.applyViewMode();
  }

  private syncLabels(): void {
    if (!this.runtime || !this.treeData) return;
    if (!this.labelsVisible) {
      this.runtime.hideLabels();
      return;
    }
    this.runtime.showLabels(this.treeData, this.labelOutIds(), this.labelStoryOutIds());
  }

  private async reachableEdges(nodeId = this.selectedNodeId): Promise<AnyObject[]> {
    if (!this.sceneId) return [];
    return fetchJson<AnyObject[]>(withBasePath('/api/ustudio/reachable'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneId: this.sceneId,
        storyNodeIds: this.selectedStoryNodeIds(),
        nodeId: nodeId || undefined,
      }),
    }).catch(() => []);
  }

  private async redrawReachable(): Promise<void> {
    if (!this.runtime || !this.treeData) return;
    const version = ++this.reachableRequestVersion;
    this.runtime.clearReachableRoutes();
    const edges = await this.reachableEdges();
    if (version !== this.reachableRequestVersion) return;
    if (edges.length > 0) this.runtime.drawReachableRoutes(edges, this.treeData, this.yExtendVisible);
    this.restoreReachableHighlight();
  }

  private async redrawReachableAfterSemanticViewSync(): Promise<void> {
    await this.applySemanticClickViewMode();
    await this.redrawReachable();
    this.ctx?.requestRender?.();
  }

  private async connectivityEdges(spaceId = this.selectedSpaceId): Promise<AnyObject[]> {
    if (!this.sceneId) return [];
    return fetchJson<AnyObject[]>(withBasePath('/api/ustudio/connectivity'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneId: this.sceneId,
        storyNodeIds: this.selectedStoryNodeIds(),
        spaceId: spaceId || undefined,
      }),
    }).catch(() => []);
  }

  private async redrawConnectivity(): Promise<void> {
    if (!this.runtime || !this.treeData) return;
    const version = ++this.connectivityRequestVersion;
    this.runtime.clearConnectivityRoutes();
    const edges = await this.connectivityEdges();
    if (version !== this.connectivityRequestVersion) return;
    if (edges.length > 0) this.runtime.drawConnectivityRoutes(edges, this.treeData, this.yExtendVisible);
    this.restoreConnectivityHighlight();
  }

  private async redrawConnectivityAfterSemanticViewSync(): Promise<void> {
    await this.applySemanticClickViewMode();
    await this.redrawConnectivity();
    this.ctx?.requestRender?.();
  }

  private async handleSceneClick(info: SoonspaceSemanticClickInfo | null): Promise<void> {
    if (!info) {
      console.info('[ustudio-scene-tool] scene click ignored: empty semantic info');
      return;
    }
    const enriched = this.enrichClickInfo(info);
    const type = String(enriched.twins_identifier ?? '').toLowerCase();
    console.info('[ustudio-scene-tool] scene click', {
      raw: info,
      enriched,
      type,
      reachableVisible: this.reachableVisible,
      connectivityVisible: this.connectivityVisible,
      selectedNodeId: this.selectedNodeId,
      selectedSpaceId: this.selectedSpaceId,
    });
    const key = `${type}:${enriched.out_instance_id ?? enriched.twins_instance_id ?? ''}`;
    const now = Date.now();
    if (key !== ':' && this.lastSceneClickKey === key && now - this.lastSceneClickAt < 150) {
      console.info('[ustudio-scene-tool] scene click ignored: duplicate debounce', { key });
      return;
    }
    this.lastSceneClickKey = key;
    this.lastSceneClickAt = now;
    if (this.connectivityVisible && type === 'space') {
      await this.applySpaceConnectivity(enriched);
      return;
    }
    if (this.reachableVisible && isReachableClickType(type)) {
      await this.applyDoorReachable(enriched);
      return;
    }
    console.info('[ustudio-scene-tool] scene click ignored: no matching enabled feature', {
      type,
      reachableVisible: this.reachableVisible,
      connectivityVisible: this.connectivityVisible,
    });
  }

  private enrichClickInfo(info: SoonspaceSemanticClickInfo): SoonspaceSemanticClickInfo {
    const outId = cleanString(info.out_instance_id ?? info['outInstanceId'] ?? info['outId'] ?? info['id']);
    const twinId = cleanString(info.twins_instance_id ?? info['twinsInstanceId'] ?? info['node_id'] ?? info['nodeId']);
    const name = cleanString(info['twins_instance_name'] ?? info['twinsInstanceName'] ?? info['name']);
    const node = findNodeByInstanceId(this.treeData, outId) ?? findNodeByInstanceId(this.treeData, twinId) ?? findNodeByInstanceId(this.treeData, name);
    return {
      ...info,
      twins_identifier: cleanString(node?.twins_identifier ?? info.twins_identifier ?? info['twinsIdentifier']),
      out_instance_id: nodeOutId(node) || outId || twinId,
      twins_instance_id: nodeTwinId(node) || twinId || outId,
      story_id: cleanString(info.story_id ?? info['storyId']),
    };
  }

  private async applyDoorReachable(info: SoonspaceSemanticClickInfo): Promise<void> {
    if (!this.reachableVisible || this.reachableRendering) return;
    const nodeId = cleanString(info.twins_instance_id ?? info.out_instance_id);
    const outId = cleanString(info.out_instance_id ?? info.twins_instance_id);
    if (!nodeId) return;
    this.reachableRendering = true;
    try {
      if (this.selectedNodeId === nodeId) {
        this.clearReachableSelection(outId);
      } else {
        this.selectedNodeId = nodeId;
        this.setReachableHighlight(outId);
      }
      await this.invokeCurrentLayer({
        nodeId: this.selectedNodeId ?? undefined,
      });
      await this.redrawReachable();
    } finally {
      this.reachableRendering = false;
      this.ctx?.requestRender?.();
    }
  }

  private async applySpaceConnectivity(info: SoonspaceSemanticClickInfo): Promise<void> {
    if (!this.connectivityVisible || this.connectivityRendering) return;
    const spaceId = cleanString(info.twins_instance_id ?? info.out_instance_id);
    const outId = cleanString(info.out_instance_id ?? info.twins_instance_id);
    if (!spaceId) return;
    this.connectivityRendering = true;
    try {
      if (this.selectedSpaceId === spaceId) {
        this.clearConnectivitySelection(outId);
      } else {
        this.selectedSpaceId = spaceId;
        this.setConnectivityHighlight(outId);
      }
      await this.invokeCurrentLayer({
        spaceId: this.selectedSpaceId ?? undefined,
      });
      await this.redrawConnectivity();
    } finally {
      this.connectivityRendering = false;
      this.ctx?.requestRender?.();
    }
  }

  private setReachableHighlight(outId: string): void {
    if (this.reachableHighlightOutId && this.reachableHighlightOutId !== outId) {
      this.runtime?.clearObjectHighlight(this.reachableHighlightOutId);
    }
    this.reachableHighlightOutId = null;
    if (outId && this.runtime?.highlightObject(outId)) this.reachableHighlightOutId = outId;
  }

  private setConnectivityHighlight(outId: string): void {
    if (this.connectivityHighlightOutId && this.connectivityHighlightOutId !== outId) {
      this.runtime?.clearObjectHighlight(this.connectivityHighlightOutId);
    }
    this.connectivityHighlightOutId = null;
    if (outId && this.runtime?.highlightObject(outId)) this.connectivityHighlightOutId = outId;
  }

  private clearReachableSelection(fallbackOutId = ''): void {
    const outId = this.reachableHighlightOutId || fallbackOutId;
    if (outId) this.runtime?.clearObjectHighlight(outId);
    this.reachableHighlightOutId = null;
    this.selectedNodeId = null;
  }

  private clearConnectivitySelection(fallbackOutId = ''): void {
    const outId = this.connectivityHighlightOutId || fallbackOutId;
    if (outId) this.runtime?.clearObjectHighlight(outId);
    this.connectivityHighlightOutId = null;
    this.selectedSpaceId = null;
  }

  private restoreReachableHighlight(): void {
    if (this.reachableVisible && this.reachableHighlightOutId) {
      this.runtime?.highlightObject(this.reachableHighlightOutId);
    }
  }

  private restoreConnectivityHighlight(): void {
    if (this.connectivityVisible && this.connectivityHighlightOutId) {
      this.runtime?.highlightObject(this.connectivityHighlightOutId);
    }
  }

  private async setVirtualRouteVisible(id: string, visible: boolean, validateKnown = true): Promise<void> {
    if (!this.runtime) throw new Error('场景未就绪');
    const known = this.routeItems.some((item) => item.id === id);
    if (validateKnown && !known) throw new Error(`路径对象未找到: ${id}`);
    if (!known) {
      if (!visible) return;
      this.routeItems = [...this.routeItems, { id, label: id, selected: false }];
    }
    this.routeItems = this.routeItems.map((item) =>
      item.id === id ? { ...item, selected: visible, loading: visible } : item,
    );
    this.ctx?.requestRender?.();
    try {
      if (!visible) {
        const renderId = this.drawnRoutes.get(id);
        if (renderId) this.runtime.setVirtualRouteVisible(renderId, false);
        return;
      }
      const renderedRouteId = this.drawnRoutes.get(id);
      if (renderedRouteId) {
        try {
          this.runtime.setVirtualRouteVisible(renderedRouteId, true);
          return;
        } catch (error) {
          console.warn('[ustudio-scene-tool] show virtual route failed, redraw', { id, renderId: renderedRouteId, error: describeError(error) });
          this.drawnRoutes.delete(id);
        }
      }
      if (!this.sceneId) throw new Error('场景未就绪');
      const detail = await fetchJson<AnyObject>(
        withBasePath(`/api/ustudio/routes/detail?sceneId=${encodeURIComponent(this.sceneId)}&routeId=${encodeURIComponent(id)}`),
      );
      const normalizedDetail = normalizeVirtualRouteDetail(detail, id);
      const label = cleanString(normalizedDetail.route_name);
      if (label) this.routeItems = this.routeItems.map((item) => (item.id === id ? { ...item, label } : item));
      const renderInfo = await this.runtime.drawVirtualRoute(normalizedDetail, { id });
      if (!renderInfo) throw new Error('路径方法未实现: drawVirtualRoute');
      this.drawnRoutes.set(id, cleanString((renderInfo as AnyObject).routeId) || id);
    } catch (error) {
      if (visible) {
        this.drawnRoutes.delete(id);
        this.routeItems = this.routeItems.map((item) => (item.id === id ? { ...item, selected: false } : item));
      }
      throw error;
    } finally {
      this.routeItems = this.routeItems.map((item) => (item.id === id ? { ...item, loading: false } : item));
      this.ctx?.requestRender?.();
    }
  }
  private async toggleVirtualRoute(value: { id?: string; selected?: boolean }): Promise<void> {
    const id = cleanString(value?.id);
    try {
      if (!id) return;
      if (this.hasSceneInvokeSdk()) {
        const visible = !!value.selected;
        const invoked = await this.tryInvokeSceneFunction('virtualRouteSetVisible', { routeIds: [id], visible });
        if (invoked) {
          this.markRoutesVisible([id], visible);
          return;
        }
      }
      await this.setVirtualRouteVisible(id, !!value.selected, false);
    } catch (error) {
      console.warn('[ustudio-scene-tool] virtual route failed', { id, error: describeError(error) });
    }
  }

  private async setVirtualPolygonVisible(id: string, visible: boolean, validateKnown = true): Promise<void> {
    if (!this.runtime) throw new Error('场景未就绪');
    const known = this.polygonItems.some((item) => item.id === id);
    if (validateKnown && !known) throw new Error(`多边形对象未找到: ${id}`);
    if (!known) {
      if (!visible) return;
      this.polygonItems = [...this.polygonItems, { id, label: id, selected: false }];
    }
    this.polygonItems = this.polygonItems.map((item) =>
      item.id === id ? { ...item, selected: visible, loading: visible } : item,
    );
    this.ctx?.requestRender?.();
    try {
      if (!visible) {
        const renderId = this.drawnPolygons.get(id);
        if (renderId) this.runtime.setVirtualPolygonVisible(renderId, false);
        return;
      }
      const renderedPolygonId = this.drawnPolygons.get(id);
      if (renderedPolygonId) {
        try {
          this.runtime.setVirtualPolygonVisible(renderedPolygonId, true);
          return;
        } catch (error) {
          console.warn('[ustudio-scene-tool] show virtual polygon failed, redraw', { id, renderId: renderedPolygonId, error: describeError(error) });
          this.drawnPolygons.delete(id);
        }
      }
      if (!this.sceneId) throw new Error('场景未就绪');
      const detail = await fetchJson<AnyObject>(
        withBasePath(`/api/ustudio/polygons/detail?sceneId=${encodeURIComponent(this.sceneId)}&polygonId=${encodeURIComponent(id)}`),
      );
      const normalizedDetail = normalizeVirtualPolygonDetail(detail, id);
      const label = cleanString(normalizedDetail.polygon_name);
      if (label) this.polygonItems = this.polygonItems.map((item) => (item.id === id ? { ...item, label } : item));
      const renderInfo = await this.runtime.drawVirtualPolygon(normalizedDetail, { id });
      if (!renderInfo) throw new Error('多边形方法未实现: drawVirtualPolygon');
      this.drawnPolygons.set(id, cleanString((renderInfo as AnyObject).polygonId) || cleanString((renderInfo as AnyObject).canvasId) || id);
    } catch (error) {
      if (visible) {
        this.drawnPolygons.delete(id);
        this.polygonItems = this.polygonItems.map((item) => (item.id === id ? { ...item, selected: false } : item));
      }
      throw error;
    } finally {
      this.polygonItems = this.polygonItems.map((item) => (item.id === id ? { ...item, loading: false } : item));
      this.ctx?.requestRender?.();
    }
  }
  private async setPolygonNodeVisible(id: string, visible: boolean): Promise<void> {
    if (!this.runtime) throw new Error('Scene runtime is not ready');
    const outInstanceId = this.polygonNodeBindings.get(id);
    if (!outInstanceId) throw new Error(`Polygon node binding not found: ${id}`);
    const previousVisible = this.polygonItems.find((item) => item.id === id)?.selected === true;
    this.polygonItems = this.polygonItems.map((item) =>
      item.id === id ? { ...item, selected: visible, loading: true } : item,
    );
    this.ctx?.requestRender?.();
    try {
      if (visible) this.runtime.showObject(outInstanceId);
      else this.runtime.hideObject(outInstanceId);
    } catch (error) {
      this.polygonItems = this.polygonItems.map((item) =>
        item.id === id ? { ...item, selected: previousVisible } : item,
      );
      throw error;
    } finally {
      this.polygonItems = this.polygonItems.map((item) =>
        item.id === id ? { ...item, loading: false } : item,
      );
      this.ctx?.requestRender?.();
    }
  }

  private async toggleVirtualPolygon(value: { id?: string; selected?: boolean }): Promise<void> {
    const id = cleanString(value?.id);
    try {
      if (!id) return;
      if (this.polygonNodeBindings.has(id)) {
        await this.setPolygonNodeVisible(id, !!value.selected);
        return;
      }
      if (this.hasSceneInvokeSdk()) {
        const visible = !!value.selected;
        const invoked = await this.tryInvokeSceneFunction('polygonSetVisible', { polygonIds: [id], visible });
        if (invoked) {
          this.markPolygonsVisible([id], visible);
          return;
        }
      }
      await this.setVirtualPolygonVisible(id, !!value.selected, false);
    } catch (error) {
      console.warn('[ustudio-scene-tool] virtual polygon failed', { id, error: describeError(error) });
    }
  }
}
