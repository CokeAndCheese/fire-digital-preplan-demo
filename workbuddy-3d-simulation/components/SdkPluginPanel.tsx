'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LayerApplyParams, LayerCommandState } from 'ustudio-sdk';
import type { GeneratedPanelListItem } from '@/lib/generated-panel-runtime';
import { sceneSdk, type SceneSdk } from '@/lib/scene-sdk';

type BusyTarget = string | null;

function boolText(value: boolean): string {
  return value ? '开' : '关';
}

function buttonClass(active: boolean): string {
  return 'sdkPanelButton' + (active ? ' isActive' : '');
}

function ensureArray(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

export function SdkPluginPanel({ sdk }: { sdk?: SceneSdk }) {
  const [state, setState] = useState<LayerCommandState | null>(null);
  const [panels, setPanels] = useState<GeneratedPanelListItem[]>([]);
  const [busy, setBusy] = useState<BusyTarget>(null);
  const [error, setError] = useState('');

  const getSdk = useCallback(() => sdk ?? sceneSdk(), [sdk]);

  const refresh = useCallback(async () => {
    const target = getSdk();
    setState(target.getSceneSetState());
    const panelResult = await target.panelList().catch(() => []);
    setPanels(Array.isArray(panelResult) ? panelResult as GeneratedPanelListItem[] : []);
  }, [getSdk]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const target = getSdk();
    try {
      setState(target.getSceneSetState());
      unsubscribe = target.subscribeSceneState?.((nextState) => {
        if (!disposed) setState(nextState);
      });
      void target.panelList()
        .then((panelResult) => {
          if (!disposed) setPanels(Array.isArray(panelResult) ? panelResult as GeneratedPanelListItem[] : []);
        })
        .catch((err) => {
          if (!disposed) setError(err instanceof Error ? err.message : String(err));
        });
    } catch (err) {
      if (!disposed) setError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [getSdk]);

  async function run(label: string, action: () => Promise<unknown> | unknown): Promise<void> {
    setBusy(label);
    setError('');
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function applyScene(label: string, patch: LayerApplyParams): Promise<void> {
    await run(label, () => {
      const layer = state?.layer;
      return getSdk().setScene({
        buildings: ensureArray(layer?.buildings),
        stories: ensureArray(layer?.stories),
        mode: layer?.mode ?? '3D',
        yExtend: layer?.yExtend ?? false,
        labels: layer?.labels ?? false,
        reachable: layer?.reachable ?? false,
        connectivity: layer?.connectivity ?? false,
        ...patch,
      });
    });
  }

  const layer = state?.layer;
  const storyIds = new Set(layer?.stories ?? []);
  const buildingIds = new Set(layer?.buildings ?? []);
  const routeCount = state?.routes.length ?? 0;
  const polygonCount = state?.polygons.length ?? 0;

  return (
    <aside className="sdkPanel thin-scroll" aria-label="插件面板">
      <header className="sdkPanelHeader">
        <div>
          <div className="sdkPanelTitle">插件面板</div>
          <div className="sdkPanelSub">SDK 内置场景与业务面板控制</div>
        </div>
        <button type="button" className="sdkPanelIconButton" onClick={() => void refresh()} disabled={!!busy} title="刷新">
          ↻
        </button>
      </header>

      {error && <div className="sdkPanelError">{error}</div>}

      <section className="sdkPanelSection">
        <div className="sdkPanelSectionTitle">视图</div>
        <div className="sdkPanelGrid two">
          <button type="button" className={buttonClass(layer?.mode !== '2D')} disabled={!!busy} onClick={() => void applyScene('3D', { mode: '3D' })}>3D</button>
          <button type="button" className={buttonClass(layer?.mode === '2D')} disabled={!!busy} onClick={() => void applyScene('2D', { mode: '2D' })}>2D</button>
          <button type="button" className={buttonClass(layer?.yExtend === true)} disabled={!!busy} onClick={() => void applyScene('yExtend', { yExtend: !(layer?.yExtend ?? false) })}>炸开 {boolText(layer?.yExtend === true)}</button>
          <button type="button" className={buttonClass(layer?.labels === true)} disabled={!!busy} onClick={() => void applyScene('labels', { labels: !(layer?.labels ?? false) })}>标注 {boolText(layer?.labels === true)}</button>
          <button type="button" className={buttonClass(state?.gis.visible === true)} disabled={!!busy || state?.gis.available === false} onClick={() => void run('gis', () => getSdk().gisSetVisible(!(state?.gis.visible ?? false)))}>GIS {boolText(state?.gis.visible === true)}</button>
          <button type="button" className={buttonClass(layer?.reachable === true)} disabled={!!busy} onClick={() => void applyScene('reachable', { reachable: !(layer?.reachable ?? false), connectivity: false, mode: !(layer?.reachable ?? false) ? '2D' : (layer?.mode ?? '3D') })}>可达 {boolText(layer?.reachable === true)}</button>
          <button type="button" className={buttonClass(layer?.connectivity === true)} disabled={!!busy} onClick={() => void applyScene('connectivity', { connectivity: !(layer?.connectivity ?? false), reachable: false, mode: !(layer?.connectivity ?? false) ? '2D' : (layer?.mode ?? '3D') })}>连通 {boolText(layer?.connectivity === true)}</button>
        </div>
      </section>

      <section className="sdkPanelSection">
        <div className="sdkPanelSectionTitle">楼栋 / 楼层</div>
        <div className="sdkPanelList">
          {(state?.available.buildings.length ?? 0) === 0 && (state?.available.stories.length ?? 0) === 0 && (
            <div className="sdkPanelEmpty">暂无楼栋楼层</div>
          )}
          {state?.available.buildings.slice(0, 10).map((building) => (
            <button
              type="button"
              key={building.buildingId}
              className={buttonClass(buildingIds.has(building.buildingId))}
              disabled={!!busy}
              onClick={() => {
                const next = new Set(buildingIds);
                if (next.has(building.buildingId)) next.delete(building.buildingId);
                else next.add(building.buildingId);
                void applyScene('building:' + building.buildingId, { buildings: [...next], stories: [...storyIds] });
              }}
            >
              {building.label}
            </button>
          ))}
          {state?.available.stories.slice(0, 16).map((story) => (
            <button
              type="button"
              key={story.storyId}
              className={buttonClass(storyIds.has(story.storyId))}
              disabled={!!busy}
              onClick={() => {
                const next = new Set(storyIds);
                if (next.has(story.storyId)) next.delete(story.storyId);
                else next.add(story.storyId);
                void applyScene('story:' + story.storyId, { stories: [...next], buildings: [...buildingIds] });
              }}
            >
              {story.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sdkPanelSection">
        <div className="sdkPanelSectionTitle">路径 / 多边形</div>
        <div className="sdkPanelList">
          {routeCount === 0 && polygonCount === 0 && <div className="sdkPanelEmpty">暂无路径或多边形</div>}
          {state?.routes.map((route) => (
            <button type="button" key={route.routeId} className={buttonClass(route.visible)} disabled={!!busy} onClick={() => void run('route:' + route.routeId, () => getSdk().virtualRouteSetVisible(route.routeId, !route.visible))}>
              {route.label}
            </button>
          ))}
          {state?.polygons.map((polygon) => (
            <button type="button" key={polygon.polygonId} className={buttonClass(polygon.visible)} disabled={!!busy} onClick={() => void run('polygon:' + polygon.polygonId, () => getSdk().polygonSetVisible(polygon.polygonId, !polygon.visible))}>
              {polygon.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sdkPanelSection">
        <div className="sdkPanelSectionTitle">业务面板</div>
        <div className="sdkPanelList">
          {panels.length === 0 && <div className="sdkPanelEmpty">暂无已登记业务面板</div>}
          {panels.map((panel) => (
            <button type="button" key={panel.id} className={buttonClass(panel.visible)} disabled={!!busy} onClick={() => void run('panel:' + panel.id, () => getSdk().panelSetVisible({ id: panel.id, visible: !panel.visible }))}>
              {panel.name}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
