'use client';

import type {
  CustomFunctionUStudioSdk,
  LayerApplyParams,
  LayerCommandState,
  LayerState,
  Semantic2dClickInfo,
  UStudioSdk,
  ViewModeParams,
} from 'ustudio-sdk';
import type { RuntimeConfig } from './app-key';
import { i18n } from './i18n';
import { panelList, panelSetVisible, type PanelSetVisibleParams } from './generated-panel-runtime';
import { showUStudioVideo } from './video-runtime';
import type { SceneTreeNode } from './ustudio';
import type { PluginHost } from './scene-plugins/types';
import { withBasePath } from './client-path';

type AnyObject = Record<string, any>;
type SceneSdk = CustomFunctionUStudioSdk<UStudioSdk>;
type RenderOrigin = { longitude: number; latitude: number; altitude: number };

export type SoonspaceInitProgress = {
  stage: 'setup' | 'loading' | 'ready';
  message: string;
  percent?: number;
};

export type SoonspaceSemanticClickInfo = Semantic2dClickInfo & Record<string, unknown>;

export type ScriptMethods = {
  fly: (id: unknown) => unknown;
  heighLight: (id: unknown, color?: string | number) => unknown;
  highlight: (id: unknown, color?: string | number) => unknown;
  cancelHeighLight: (id: unknown) => unknown;
  clearHighlight: (id: unknown) => unknown;
  hide: (id: unknown) => unknown;
  show: (id: unknown) => unknown;
  setOpacity: (id: unknown, opacity: unknown) => unknown;
  unSetOpacity: (id: unknown) => unknown;
  drawRoute: (...args: unknown[]) => unknown;
  deleteRoute: (id: unknown) => unknown;
  pathMove: (id: unknown, path: unknown) => unknown;
  pathRestore: (id: unknown) => unknown;
  setScene: (params?: LayerApplyParams) => Promise<LayerState>;
  getSceneSetState: () => LayerCommandState;
  gisSetVisible: (visible: boolean) => Promise<{ visible: boolean }>;
  virtualRouteSetVisible: (routeIds: string | string[], visible: boolean) => Promise<unknown>;
  polygonSetVisible: (polygonIds: string | string[], visible: boolean) => Promise<unknown>;
  panelList: typeof panelList;
  panelSetVisible: (params: PanelSetVisibleParams) => ReturnType<typeof panelSetVisible>;
  showVideo: (params?: unknown) => unknown;
};

const showVideo = showUStudioVideo;

function normalizeTree(treeData: unknown): SceneTreeNode[] {
  if (Array.isArray(treeData)) return treeData as SceneTreeNode[];
  if (treeData && typeof treeData === 'object') return [treeData as SceneTreeNode];
  return [];
}

function progressStage(progress: { status?: string; percent?: number; message?: string }): SoonspaceInitProgress['stage'] {
  if (progress.status === 'complete') return 'ready';
  if (progress.status === 'loading') return 'loading';
  return 'setup';
}

function mapProgress(progress: { status?: string; percent?: number; message?: string }): SoonspaceInitProgress {
  const stage = progressStage(progress);
  const message = stage === 'ready'
    ? i18n('viewer.loading.done')
    : stage === 'loading'
      ? i18n('viewer.loading.scene')
      : i18n('viewer.loading.soonspace');
  return { stage, message, percent: progress.percent };
}

export class SoonspaceRuntime {
  private sdk: SceneSdk | null = null;
  private sceneId = '';
  private semanticClickHandler: ((info: SoonspaceSemanticClickInfo | null, event?: unknown) => void) | null = null;
  private pendingRenderOrigin: RenderOrigin | null = null;
  private cps: AnyObject | null = null;
  private ssp: AnyObject | null = null;
  private originalCpsPresetGis?: () => Promise<void>;

  async init(
    container: HTMLElement,
    sceneId: string,
    runtimeConfig: RuntimeConfig,
    onProgress?: (progress: SoonspaceInitProgress) => void,
  ): Promise<void> {
    this.sceneId = sceneId;
    const { createUStudioSdk } = await import('ustudio-sdk');
    const sdk = createUStudioSdk();
    this.sdk = sdk;
    await sdk.init({
      config: { hostUrl: runtimeConfig.hostUrl, appKey: runtimeConfig.appKey },
      locale: { lang: runtimeConfig.locale },
      commandBridge: { panelList, panelSetVisible, showVideo },
    });
    await sdk.initScene(this.sceneId, {
      dracoDecoderPath: withBasePath('/draco/gltf/'),
      soonspace: {
        el: container,
        options: {
          background: { color: '#d8dddc', alpha: false },
          showGrid: false,
          showInfo: true,
          hoverEnabled: false,
          showViewHelper: true,
        },
      },
      onProgress(progress) {
        onProgress?.(mapProgress(progress));
      },
      onSemantic2dClick: (info, event) => {
        this.semanticClickHandler?.(info as SoonspaceSemanticClickInfo | null, event);
      },
    });
    this.ssp = this.safeGetSoonSpace();
    this.cps = this.resolveCpsManager();
    this.installWindowSceneBridge();
  }

  async dispose(): Promise<void> {
    const sdk = this.sdk;
    const sceneId = this.sceneId;
    this.sdk = null;
    this.sceneId = '';
    if (typeof window !== 'undefined') {
      if (sdk && window.__scene === sdk) delete window.__scene;
      if (sceneId && window.__sceneId === sceneId) delete window.__sceneId;
      try {
        const topWin = window.top;
        if (topWin && topWin !== window) {
          if (sdk && topWin.__scene === sdk) delete topWin.__scene;
          if (sceneId && topWin.__sceneId === sceneId) delete topWin.__sceneId;
        }
      } catch {
        // ignore cross-origin top frame
      }
      window.dispatchEvent(new CustomEvent('ustudio:scene', { detail: { sceneId: '' } }));
    }
    await sdk?.destroy();
  }

  getSdk(): SceneSdk | null {
    return this.sdk;
  }

  getSsp(): AnyObject | null {
    return this.ssp ?? this.safeGetSoonSpace();
  }

  getCps(): AnyObject | null {
    return this.cps ?? this.resolveCpsManager();
  }

  getPluginHost(): PluginHost {
    const ssp = this.getSsp();
    return {
      el: (ssp?.el ?? (typeof document !== 'undefined' ? document.body : null)) as HTMLElement,
      scene: ssp?.scene,
      render: () => this.render(),
      getObjectById: (id: string) => this.getObjectById(id),
    };
  }

  async loadUserAddedInstances(): Promise<unknown> {
    return this.sdk?.getPlacementState?.() ?? { placed: [], skipped: [], apiModelIds: [] };
  }

  clearUserAddedInstances(): void {}

  getUserPlacementResult(): unknown {
    return this.sdk?.getPlacementState?.() ?? { placed: [], skipped: [], apiModelIds: [] };
  }

  setSceneClickHandler(handler: (info: SoonspaceSemanticClickInfo | null, event?: unknown) => void): () => void {
    this.semanticClickHandler = handler;
    this.sdk?.setSemantic2dClickHandler?.((info, event) => handler(info as SoonspaceSemanticClickInfo | null, event));
    return () => this.clearSceneClickHandler(handler);
  }

  clearSceneClickHandler(handler?: (info: SoonspaceSemanticClickInfo | null, event?: unknown) => void): void {
    if (!handler || this.semanticClickHandler === handler) {
      this.semanticClickHandler = null;
      this.sdk?.clearSemantic2dClickHandler?.();
    }
  }

  syncUserAddedInstancesDisplay(patch: AnyObject = {}): unknown {
    return this.sdk?.syncUserInstancePlacementDisplay?.(patch) ?? { placed: [], skipped: [], apiModelIds: [] };
  }

  async setViewMode(params: unknown, treeData: SceneTreeNode | SceneTreeNode[], selectedStoryIds?: string[], selectedBuildingIds?: string[]): Promise<void> {
    await this.sdk?.setViewMode(params as ViewModeParams | ViewModeParams[], normalizeTree(treeData) as any, selectedStoryIds, selectedBuildingIds);
  }

  showGis(): void {
    void this.setGisVisible(true);
  }

  hideGis(): void {
    void this.setGisVisible(false);
  }

  isGisAvailable(): boolean {
    const state = this.sdk?.getSceneSetState?.();
    if (typeof state?.gis?.available === 'boolean') return state.gis.available;
    const ssp = this.getSsp();
    return !!(
      ssp?.setGisVisible ||
      ssp?.showGis ||
      ssp?.hideGis ||
      this.getCps()?.terrainTilesRenderer
    );
  }

  async setGisVisible(visible: boolean): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.gisSetVisible(visible);
        this.applyPendingRenderOrigin();
        return;
      } catch (error) {
        if (!this.setGisVisibleOnCps(visible)) throw error;
        this.applyPendingRenderOrigin();
        return;
      }
    }
    if (visible && this.originalCpsPresetGis) await this.originalCpsPresetGis();
    this.setGisVisibleOnCps(visible);
    this.applyPendingRenderOrigin();
  }

  setRenderOrigin(longitude: number, latitude: number, altitude: number): void {
    this.pendingRenderOrigin = { longitude, latitude, altitude };
    this.applyPendingRenderOrigin();
  }

  showLabels(treeData?: SceneTreeNode | SceneTreeNode[], outInstanceIds?: string[], storyIds?: string[]): void {
    this.sdk?.showTwinsNameLabels?.(normalizeTree(treeData) as any, outInstanceIds, storyIds);
  }

  hideLabels(): void {
    this.sdk?.hideTwinsNameLabels?.();
  }

  drawReachableRoutes(edges: AnyObject[], treeData: SceneTreeNode | SceneTreeNode[], yExtend?: boolean, mode2d?: boolean): unknown {
    return this.sdk?.drawReachableRoutes?.(edges as any, normalizeTree(treeData) as any, !!yExtend, !!mode2d);
  }

  clearReachableRoutes(): void {
    this.sdk?.clearReachableRoutes?.();
  }

  drawConnectivityRoutes(edges: AnyObject[], treeData: SceneTreeNode | SceneTreeNode[], yExtend?: boolean): unknown {
    return this.sdk?.drawConnectivityRoutes?.(edges as any, normalizeTree(treeData) as any, !!yExtend);
  }

  clearConnectivityRoutes(): void {
    this.sdk?.clearConnectivityRoutes?.();
  }

  highlightObject(id: string, color?: string | number): boolean {
    this.sdk?.heighLight?.(id, color);
    return true;
  }

  clearObjectHighlight(id: string): void {
    this.sdk?.cancelHeighLight?.(id);
  }

  showObject(id: string): void {
    this.sdk?.show?.(id);
  }

  hideObject(id: string): void {
    this.sdk?.hide?.(id);
  }

  drawVirtualRoute(detail: AnyObject, options?: AnyObject): Promise<unknown> | undefined {
    return this.sdk?.drawVirtualRoute?.(detail as any, options as any);
  }

  setVirtualRouteVisible(routeId: string, visible: boolean): unknown {
    return this.sdk?.setVirtualRouteVisible?.(routeId, visible);
  }

  clearVirtualRoute(routeId: string): void {
    this.sdk?.clearVirtualRoute?.(routeId);
  }

  drawVirtualPolygon(detail: AnyObject, options?: AnyObject): Promise<unknown> | undefined {
    return this.sdk?.drawVirtualPolygon?.(detail as any, options as any);
  }

  setVirtualPolygonVisible(polygonId: string, visible: boolean): unknown {
    return this.sdk?.setVirtualPolygonVisible?.(polygonId, visible);
  }

  clearVirtualPolygon(polygonId: string): void {
    this.sdk?.clearVirtualPolygon?.(polygonId);
  }

  getObjectById(id: string): unknown {
    return this.sdk?.getObjectById?.(id) ?? this.getSsp()?.getObjectById?.(id) ?? null;
  }

  createScriptMethods(): ScriptMethods {
    const call = (name: keyof ScriptMethods) => (...args: unknown[]) => {
      const sdk = this.sdk as unknown as Record<string, (...values: unknown[]) => unknown> | null;
      return sdk?.[name]?.(...args);
    };
    return {
      fly: call('fly'),
      heighLight: call('heighLight'),
      highlight: call('heighLight'),
      cancelHeighLight: call('cancelHeighLight'),
      clearHighlight: call('cancelHeighLight'),
      hide: call('hide'),
      show: call('show'),
      setOpacity: call('setOpacity'),
      unSetOpacity: call('unSetOpacity'),
      drawRoute: call('drawRoute'),
      deleteRoute: call('deleteRoute'),
      pathMove: call('pathMove'),
      pathRestore: call('pathRestore'),
      setScene: (params = {}) => this.sdk!.setScene(params),
      getSceneSetState: () => this.sdk!.getSceneSetState(),
      gisSetVisible: (visible) => this.sdk!.gisSetVisible(visible),
      virtualRouteSetVisible: (routeIds, visible) => this.sdk!.virtualRouteSetVisible(routeIds, visible),
      polygonSetVisible: (polygonIds, visible) => this.sdk!.polygonSetVisible(polygonIds, visible),
      panelList,
      panelSetVisible,
      showVideo,
    };
  }

  render(): void {
    const ssp = this.getSsp();
    if (typeof ssp?.requestRender === 'function') ssp.requestRender();
    else ssp?.render?.();
  }

  private resolveCpsManager(): AnyObject | null {
    const sdkAny = this.sdk as unknown as AnyObject | null;
    const direct = sdkAny?.getCpsManager?.() ?? sdkAny?.cpsManager ?? sdkAny?.cps;
    if (direct) return direct as AnyObject;
    const ssp = this.getSsp() as AnyObject | null;
    const names = ['cpsSoonmanager', 'cpsSoonmanagerPlugin'];
    for (const name of names) {
      const existing = ssp?.getPlugin?.(name) ?? ssp?.plugins?.[name] ?? ssp?.pluginMap?.get?.(name);
      if (existing) return existing as AnyObject;
    }
    return null;
  }

  private setGisVisibleOnCps(visible: boolean): boolean {
    const terrain = this.getCps()?.terrainTilesRenderer;
    if (!terrain) return false;
    if (visible) terrain.enable?.();
    else terrain.disable?.();
    this.render();
    return true;
  }

  private safeGetSoonSpace(): AnyObject | null {
    try {
      return this.sdk?.getSoonSpace?.() as AnyObject;
    } catch {
      return this.ssp;
    }
  }

  private applyPendingRenderOrigin(): void {
    const origin = this.pendingRenderOrigin;
    if (!origin) return;
    const cps = this.getCps();
    const atmosphere = cps?.atmospherePlugin;
    if (atmosphere) {
      atmosphere.longitude = origin.longitude;
      atmosphere.latitude = origin.latitude;
      atmosphere.altitude = origin.altitude;
    }
    const gisSettings = cps?.metaData?.gisSettings;
    if (gisSettings) {
      gisSettings.longitude = origin.longitude;
      gisSettings.latitude = origin.latitude;
      gisSettings.altitude = origin.altitude;
    }
    cps?.terrainTilesRenderer?.invalidate?.(origin.longitude, origin.latitude, origin.altitude);
    this.render();
  }

  private installWindowSceneBridge(): void {
    if (typeof window === 'undefined' || !this.sdk) return;
    window.__scene = this.sdk;
    window.__sceneId = this.sceneId;
    try {
      const topWin = window.top;
      if (topWin && topWin !== window) {
        topWin.__scene = this.sdk;
        topWin.__sceneId = this.sceneId;
      }
    } catch {
      // ignore cross-origin top frame
    }
    window.dispatchEvent(new CustomEvent('ustudio:scene', { detail: { sceneId: this.sceneId } }));
  }
}
