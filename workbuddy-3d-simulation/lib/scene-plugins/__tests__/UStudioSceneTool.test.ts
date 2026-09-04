import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UStudioSceneTool } from '../plugins/UStudioSceneTool';
import type { PluginContext } from '../types';

type RequestRecord = { url: string; body: Record<string, unknown> };

const treeData = {
  id: 'building-out',
  out_instance_id: 'building-out',
  twins_instance_id: 'building-node',
  twins_instance_name: 'Building A',
  twins_identifier: 'Building',
  children: [
    {
      id: 'story-out',
      out_instance_id: 'story-out',
      twins_instance_id: 'story-node',
      twins_instance_name: '1F',
      twins_identifier: 'Story',
      children: [
        {
          id: 'space-out',
          out_instance_id: 'space-out',
          twins_instance_id: 'space-node',
          twins_instance_name: 'Room A',
          twins_identifier: 'Space',
          children: [],
        },
        {
          id: 'door-out',
          out_instance_id: 'door-out',
          twins_instance_id: 'door-node',
          twins_instance_name: 'Door A',
          twins_identifier: 'Door',
          children: [],
        },
        {
          id: 'stairs-out',
          out_instance_id: 'stairs-out',
          twins_instance_id: 'stairs-node',
          twins_instance_name: 'Stairs A',
          twins_identifier: 'Stairs',
          children: [],
        },
        {
          id: 'scene-in-out',
          out_instance_id: 'scene-in-out',
          twins_instance_id: 'scene-in-node',
          twins_instance_name: 'Exit A',
          twins_identifier: 'SceneInOut',
          children: [],
        },
      ],
    },
  ],
};

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeFetchMock(records: RequestRecord[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    records.push({ url, body });
    const rows = url.includes('/reachable')
      ? [{ edge_id: 'reachable-edge', start_out_instance_id: 'door-out', end_out_instance_id: 'space-out' }]
      : url.includes('/connectivity')
        ? [{ edge_id: 'connectivity-edge', start_out_instance_id: 'space-out', end_out_instance_id: 'door-out' }]
        : [];
    return {
      ok: true,
      json: async () => rows,
    } as Response;
  });
}

function makeRuntime() {
  let clickHandler: ((info: unknown) => void) | null = null;
  const runtime = {
    setSceneClickHandler: vi.fn((handler: (info: unknown) => void) => {
      clickHandler = handler;
      return vi.fn();
    }),
    showLabels: vi.fn(),
    hideLabels: vi.fn(),
    setGisVisible: vi.fn(),
    hideGis: vi.fn(),
    showGis: vi.fn(),
    setViewMode: vi.fn(),
    syncUserAddedInstancesDisplay: vi.fn(),
    clearReachableRoutes: vi.fn(),
    drawReachableRoutes: vi.fn(),
    clearConnectivityRoutes: vi.fn(),
    drawConnectivityRoutes: vi.fn(),
    highlightObject: vi.fn(() => true),
    clearObjectHighlight: vi.fn(),
    showObject: vi.fn(),
    hideObject: vi.fn(),
    drawVirtualRoute: vi.fn(async (detail: Record<string, unknown>) => ({
      routeId: String(detail.route_id ?? ''),
      topologyId: String(detail.route_id ?? ''),
      visible: true,
    })),
    drawVirtualPolygon: vi.fn(async (detail: Record<string, unknown>) => ({
      polygonId: String(detail.polygon_id ?? ''),
      canvasId: 'polygon-' + String(detail.polygon_id ?? ''),
      visible: true,
    })),
    setVirtualRouteVisible: vi.fn(),
    setVirtualPolygonVisible: vi.fn(),
  };
  return {
    runtime,
    click: async (info: unknown) => {
      clickHandler?.(info);
      await flushAsync();
    },
  };
}

async function makeTool(options: { sdk?: Record<string, unknown> } = {}) {
  const { runtime, click } = makeRuntime();
  if (options.sdk) {
    (runtime as typeof runtime & { getSdk: () => Record<string, unknown> }).getSdk = vi.fn(() => options.sdk!);
  }
  const ctx: PluginContext = {
    viewer: { el: {} as HTMLElement },
    pluginId: 'ustudio-scene-tool',
    createOverlayRoot: vi.fn(() => ({ remove: vi.fn() }) as unknown as HTMLElement),
    addObject: vi.fn(),
    removeOwnObjects: vi.fn(),
    getResource: (key: string) => {
      if (key === 'runtime') return runtime;
      if (key === 'sceneId') return 'scene-1';
      if (key === 'treeData') return treeData;
      return undefined;
    },
    requestRender: vi.fn(),
  };
  const tool = new UStudioSceneTool();
  await tool.attach(ctx);
  await flushAsync();
  return { tool, runtime, click };
}

describe('UStudioSceneTool reachable/connectivity click filtering', () => {
  let originalFetch: typeof globalThis.fetch;
  let records: RequestRecord[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    records = [];
    globalThis.fetch = makeFetchMock(records) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GIS 底图默认开启但不触发运行时显隐', async () => {
    const { tool, runtime } = await makeTool();
    const gisControl = tool.getControls().find((control) => control.id === 'gis') as { default?: unknown } | undefined;

    expect(gisControl?.default).toBe(true);
    tool.enable();
    await flushAsync();

    expect(runtime.showGis).not.toHaveBeenCalled();
    expect(runtime.hideGis).not.toHaveBeenCalled();
  });

  it('default enable does not invoke setScene, user controls still do', async () => {
    const invokeTwinsFunction = vi.fn<(payload: Record<string, unknown>) => Promise<{ success: boolean }>>(async () => ({ success: true }));
    const { tool } = await makeTool({ sdk: { invokeTwinsFunction } });

    tool.enable();
    await flushAsync();

    expect(invokeTwinsFunction).not.toHaveBeenCalled();

    tool.onControl('mode', '2D');
    await flushAsync();

    expect(invokeTwinsFunction).toHaveBeenCalledTimes(1);
    expect(invokeTwinsFunction.mock.calls[0][0]).toMatchObject({
      function_identifier: 'setScene',
      twins_instance_id: 'building-node',
    });
  });

  it('syncs controls from SDK subscribeSceneState', async () => {
    let unsubscribeCalled = false;
    const sdk = {
      invokeTwinsFunction: vi.fn(),
      subscribeSceneState: vi.fn((listener: (state: any) => void) => {
        listener({
          layer: {
            buildings: ['building-out'],
            stories: ['story-node'],
            mode: '2D',
            yExtend: true,
            labels: true,
            reachable: true,
            connectivity: true,
            nodeId: 'door-node',
            spaceId: 'space-node',
          },
          gis: { visible: false, available: true },
          routes: [{ routeId: 'route-on', label: 'Route On', visible: true }],
          polygons: [{ polygonId: 'polygon-on', label: 'Polygon On', visible: true }],
          available: { buildings: [], stories: [] },
        });
        return () => {
          unsubscribeCalled = true;
        };
      }),
    };
    const { tool } = await makeTool({ sdk });
    await flushAsync();

    expect(tool.getLayerState()).toMatchObject({
      buildings: ['building-out'],
      stories: ['story-node'],
      mode: '2D',
      yExtend: true,
      labels: true,
      reachable: true,
      connectivity: true,
      nodeId: 'door-node',
      spaceId: 'space-node',
    });
    expect(tool.getControls().find((control) => control.id === 'gis')).toMatchObject({ default: false });
    expect(tool.getControls().find((control) => control.id === 'routes')).toMatchObject({
      items: [expect.objectContaining({ id: 'route-on', selected: true })],
    });
    expect(tool.getControls().find((control) => control.id === 'polygons')).toMatchObject({ items: [] });

    tool.dispose();
    expect(unsubscribeCalled).toBe(true);
  });

  it('keeps reachable enabled when switching back to 3D through invoke', async () => {
    const invokeTwinsFunction = vi.fn<(payload: Record<string, unknown>) => Promise<{ success: boolean }>>(async () => ({ success: true }));
    const { tool } = await makeTool({ sdk: { invokeTwinsFunction } });

    tool.onControl('reachable', true);
    await flushAsync();
    tool.onControl('mode', '3D');
    await flushAsync();

    expect(invokeTwinsFunction).toHaveBeenCalledTimes(2);
    const firstPayload = invokeTwinsFunction.mock.calls[0][0] as { input_params: Array<{ key: string; value: unknown }> };
    const secondPayload = invokeTwinsFunction.mock.calls[1][0] as { input_params: Array<{ key: string; value: unknown }> };
    expect(firstPayload.input_params).toEqual(expect.arrayContaining([
      { key: 'mode', value: '2D' },
      { key: 'reachable', value: true },
    ]));
    expect(secondPayload.input_params).toEqual(expect.arrayContaining([
      { key: 'mode', value: '3D' },
      { key: 'reachable', value: true },
      { key: 'connectivity', value: false },
    ]));
  });

  it('layerApply 兼容 buildings/stories 普通数组和 JSON 数组字符串', async () => {
    const { tool } = await makeTool();

    const jsonState = await tool.applyLayer({
      buildings: '["building-out"]',
      stories: '["story-out"]',
      yExtend: 'TrUe',
      labels: ' TRUE ',
      reachable: 'FALSE',
      connectivity: 'false',
    });
    const arrayState = await tool.applyLayer({ buildings: ['building-out'], stories: ['story-out'] });

    expect(jsonState).toMatchObject({
      buildings: ['building-out'],
      stories: ['story-node'],
      mode: '3D',
      yExtend: true,
      labels: true,
      reachable: false,
      connectivity: false,
    });
    expect(arrayState).toMatchObject({ buildings: ['building-out'], stories: ['story-node'] });
  });

  it('keeps buildings and stories empty when no layer is selected', async () => {
    const { tool, runtime } = await makeTool();

    const state = await tool.applyLayer({ mode: '2D', yExtend: true });

    expect(state).toMatchObject({
      buildings: [],
      stories: [],
      mode: '2D',
      yExtend: true,
    });
    expect(runtime.setViewMode).toHaveBeenLastCalledWith(
      [
        { type: '2D', ids: [] },
        { type: 'YExtend', ids: [] },
      ],
      treeData,
      [],
      [],
    );
  });

  it('uses all stories for graph data when layer selection is empty', async () => {
    const { tool } = await makeTool();

    const state = await tool.applyLayer({ reachable: true });
    const reachableRecord = records.find((record) => record.url.includes('/reachable'));

    expect(state.buildings).toEqual([]);
    expect(state.stories).toEqual([]);
    expect(reachableRecord?.body).toMatchObject({
      sceneId: 'scene-1',
      storyNodeIds: ['story-node'],
    });
  });

  it('shows every story label when labels are enabled without layer selection', async () => {
    const { tool, runtime } = await makeTool();

    tool.onControl('labels', true);

    expect(runtime.showLabels).toHaveBeenCalledWith(
      treeData,
      ['story-out', 'space-out', 'door-out', 'stairs-out', 'scene-in-out'],
      [],
    );
  });

  it('单独图层显隐方法兼容 visible 字符串 true/false 大小写', async () => {
    const { tool, runtime } = await makeTool();

    const gisOn = await tool.setGisVisible('TrUe');
    const gisOff = await tool.setGisVisible(' FALSE ');
    const routes = await tool.setRoutesVisible(['route-off'], 'FaLsE');
    const polygons = await tool.setPolygonsVisible(['polygon-off'], 'false');

    expect(runtime.setGisVisible).toHaveBeenCalledWith(true);
    expect(runtime.setGisVisible).toHaveBeenCalledWith(false);
    expect(gisOn).toEqual({ visible: true });
    expect(gisOff).toEqual({ visible: false });
    expect(routes).toEqual([{ routeId: 'route-off', visible: false }]);
    expect(polygons).toEqual([{ polygonId: 'polygon-off', visible: false }]);
  });

  it('连通性关闭时点击 Space 不请求、不绘制、不高亮', async () => {
    const { runtime, click } = await makeTool();
    records.length = 0;

    await click({ twins_identifier: 'Space', out_instance_id: 'space-out', twins_instance_id: 'space-node' });

    expect(records).toEqual([]);
    expect(runtime.highlightObject).not.toHaveBeenCalled();
    expect(runtime.drawConnectivityRoutes).not.toHaveBeenCalled();
  });

  it('连通性开启时点击 Space 按 spaceId 重绘并高亮', async () => {
    const { tool, runtime, click } = await makeTool();
    tool.onControl('connectivity', true);
    await flushAsync();
    expect(runtime.setViewMode).toHaveBeenCalledWith([{ type: '2D', ids: [] }], treeData, [], []);
    records.length = 0;
    vi.clearAllMocks();

    await click({ twins_identifier: 'Space', out_instance_id: 'space-out', twins_instance_id: 'space-node' });

    expect(records).toHaveLength(1);
    expect(records[0].url).toContain('/api/ustudio/connectivity');
    expect(records[0].body).toMatchObject({ sceneId: 'scene-1', spaceId: 'space-node' });
    expect(runtime.clearConnectivityRoutes).toHaveBeenCalled();
    expect(runtime.drawConnectivityRoutes).toHaveBeenCalledWith(
      [{ edge_id: 'connectivity-edge', start_out_instance_id: 'space-out', end_out_instance_id: 'door-out' }],
      treeData,
      false,
    );
    expect(runtime.highlightObject).toHaveBeenCalledWith('space-out');
  });

  it('开启可达性时同步切到 2D 以建立语义点击命中表', async () => {
    const { tool, runtime } = await makeTool();

    tool.onControl('reachable', true);
    await flushAsync();

    expect(runtime.setViewMode).toHaveBeenCalledWith([{ type: '2D', ids: [] }], treeData, [], []);
  });

  it('2D 点击回调缺少类型时可按名称反查 Space 并触发连通性筛选', async () => {
    const { tool, runtime, click } = await makeTool();
    tool.onControl('connectivity', true);
    await flushAsync();
    records.length = 0;
    vi.clearAllMocks();

    await click({ name: 'Room A' });

    expect(records).toHaveLength(1);
    expect(records[0].url).toContain('/api/ustudio/connectivity');
    expect(records[0].body).toMatchObject({ sceneId: 'scene-1', spaceId: 'space-node' });
    expect(runtime.highlightObject).toHaveBeenCalledWith('space-out');
  });

  it('再次点击同一 Space 取消筛选并恢复全量连通图', async () => {
    const { tool, runtime, click } = await makeTool();
    tool.onControl('connectivity', true);
    await flushAsync();
    await click({ twins_identifier: 'Space', out_instance_id: 'space-out', twins_instance_id: 'space-node' });
    await new Promise((resolve) => setTimeout(resolve, 160));
    records.length = 0;
    vi.clearAllMocks();

    await click({ twins_identifier: 'Space', out_instance_id: 'space-out', twins_instance_id: 'space-node' });

    expect(records).toHaveLength(1);
    expect(records[0].body.spaceId).toBeUndefined();
    expect(runtime.clearObjectHighlight).toHaveBeenCalledWith('space-out');
    expect(runtime.highlightObject).not.toHaveBeenCalled();
    expect(runtime.drawConnectivityRoutes).toHaveBeenCalled();
  });

  it.each([
    ['Door', 'door-out', 'door-node'],
    ['SceneInOut', 'scene-in-out', 'scene-in-node'],
    ['Stairs', 'stairs-out', 'stairs-node'],
  ])('可达性开启时点击 %s 按 nodeId 重绘并高亮', async (type, outId, nodeId) => {
    const { tool, runtime, click } = await makeTool();
    tool.onControl('reachable', true);
    await flushAsync();
    records.length = 0;
    vi.clearAllMocks();

    await click({ twins_identifier: type, out_instance_id: outId, twins_instance_id: nodeId });

    expect(records).toHaveLength(1);
    expect(records[0].url).toContain('/api/ustudio/reachable');
    expect(records[0].body).toMatchObject({ sceneId: 'scene-1', nodeId });
    expect(runtime.clearReachableRoutes).toHaveBeenCalled();
    expect(runtime.drawReachableRoutes).toHaveBeenCalledWith(
      [{ edge_id: 'reachable-edge', start_out_instance_id: 'door-out', end_out_instance_id: 'space-out' }],
      treeData,
      false,
    );
    expect(runtime.highlightObject).toHaveBeenCalledWith(outId);
  });

  it('可达性与连通性同时开启时按点击类型分别处理且高亮互不误清', async () => {
    const { tool, runtime, click } = await makeTool();
    tool.onControl('reachable', true);
    tool.onControl('connectivity', true);
    await flushAsync();
    records.length = 0;
    vi.clearAllMocks();

    await click({ twins_identifier: 'Space', out_instance_id: 'space-out', twins_instance_id: 'space-node' });
    await click({ twins_identifier: 'Door', out_instance_id: 'door-out', twins_instance_id: 'door-node' });

    expect(records.map((r) => r.url)).toEqual([
      '/api/ustudio/connectivity',
      '/api/ustudio/reachable',
    ]);
    expect(records[0].body.spaceId).toBe('space-node');
    expect(records[1].body.nodeId).toBe('door-node');
    expect(runtime.highlightObject).toHaveBeenCalledWith('space-out');
    expect(runtime.highlightObject).toHaveBeenCalledWith('door-out');
    expect(runtime.clearObjectHighlight).not.toHaveBeenCalledWith('space-out');
    expect(runtime.clearObjectHighlight).not.toHaveBeenCalledWith('door-out');
  });

  it('关闭某个开关只清理该功能自己的筛选、高亮和线路', async () => {
    const { tool, runtime, click } = await makeTool();
    tool.onControl('reachable', true);
    tool.onControl('connectivity', true);
    await flushAsync();
    await click({ twins_identifier: 'Space', out_instance_id: 'space-out', twins_instance_id: 'space-node' });
    await click({ twins_identifier: 'Door', out_instance_id: 'door-out', twins_instance_id: 'door-node' });
    vi.clearAllMocks();

    tool.onControl('connectivity', false);

    expect(runtime.clearConnectivityRoutes).toHaveBeenCalled();
    expect(runtime.clearReachableRoutes).not.toHaveBeenCalled();
    expect(runtime.clearObjectHighlight).toHaveBeenCalledWith('space-out');
    expect(runtime.clearObjectHighlight).not.toHaveBeenCalledWith('door-out');

    vi.clearAllMocks();
    tool.onControl('reachable', false);

    expect(runtime.clearReachableRoutes).toHaveBeenCalled();
    expect(runtime.clearObjectHighlight).toHaveBeenCalledWith('door-out');
  });

  it('路径列表名称显示 route_name', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ustudio/routes?')) {
        return {
          ok: true,
          json: async () => [{ route_id: 'route-1', route_name: '消防巡检路径' }],
        } as Response;
      }
      return {
        ok: true,
        json: async () => [],
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const { tool } = await makeTool();
    const routesControl = tool.getControls().find((control) => control.kind === 'list' && control.id === 'routes');

    expect(routesControl?.kind).toBe('list');
    if (routesControl?.kind !== 'list') throw new Error('routes control missing');
    expect(routesControl.items[0]).toMatchObject({ id: 'route-1', label: '消防巡检路径' });
  });
  it('路径详情返回其它 route_id 时仍按当前列表 id 绘制和取消', async () => {
    const { tool, runtime } = await makeTool();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ustudio/routes/detail')) {
        return {
          ok: true,
          json: async () => ({
            route_id: 'test1',
            route_name: 'test1',
            path: [0, 0, 0, 1, 0, 1],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => [],
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    tool.onControl('routes', { id: 't2', selected: true });
    await flushAsync();

    expect(runtime.drawVirtualRoute).toHaveBeenCalledWith(
      expect.objectContaining({ route_id: 't2' }),
      { id: 't2' },
    );

    tool.onControl('routes', { id: 't2', selected: false });
    await flushAsync();

    expect(runtime.setVirtualRouteVisible).toHaveBeenCalledWith('t2', false);
  });

  it('多边形详情返回其它 polygon_id 时仍按当前列表 id 绘制和取消', async () => {
    const { tool, runtime } = await makeTool();
    runtime.drawVirtualPolygon.mockResolvedValueOnce({ polygonId: 'render-polygon', canvasId: 'polygon-render-polygon', visible: true });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ustudio/polygons/detail')) {
        return {
          ok: true,
          json: async () => ({
            polygon_id: 'p1',
            polygon_name: 'p1',
            polygon: '{"shape":[0,0,1,0,1,1]}',
            centroid: '{"x":0,"y":6,"z":0}',
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => [],
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    tool.onControl('polygons', { id: 'p2', selected: true });
    await flushAsync();

    expect(runtime.drawVirtualPolygon).toHaveBeenCalledWith(
      expect.objectContaining({ polygon_id: 'p2' }),
      { id: 'p2' },
    );

    tool.onControl('polygons', { id: 'p2', selected: false });
    await flushAsync();

    expect(runtime.setVirtualPolygonVisible).toHaveBeenCalledWith('render-polygon', false);
  });
  it('source=2 polygon toggles its out_instance_id through SDK node visibility', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const rows = url.includes('/api/ustudio/polygons?')
        ? [{ polygon_id: 'source-polygon', polygon_name: 'Source Polygon', source: '2', out_instance_id: 'source-out-id' }]
        : [];
      return { ok: true, json: async () => rows } as Response;
    }) as unknown as typeof globalThis.fetch;

    const { tool, runtime } = await makeTool();
    expect(tool.getControls().find((control) => control.id === 'polygons')).toMatchObject({
      items: [expect.objectContaining({ id: 'source-polygon', selected: true })],
    });
    tool.onControl('polygons', { id: 'source-polygon', selected: true });
    await flushAsync();
    expect(runtime.showObject).toHaveBeenCalledWith('source-out-id');
    expect(runtime.drawVirtualPolygon).not.toHaveBeenCalled();

    tool.onControl('polygons', { id: 'source-polygon', selected: false });
    await flushAsync();
    expect(runtime.hideObject).toHaveBeenCalledWith('source-out-id');
    expect(runtime.setVirtualPolygonVisible).not.toHaveBeenCalled();
  });

  it('websocket 路径显隐可按 detail 渲染列表外 id', async () => {
    const { tool, runtime } = await makeTool();
    const routeId = '465465409417486340';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ustudio/routes/detail')) {
        return {
          ok: true,
          json: async () => ({
            route_id: '465465409417486336',
            route_name: 'p1',
            path: ['4.25', '6.0', '-0.7', '4.21', '6.0', '4.72'],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => [],
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const result = await tool.setRoutesVisible([routeId], true);

    expect(runtime.drawVirtualRoute).toHaveBeenCalledWith(
      expect.objectContaining({ route_id: routeId, route_name: 'p1' }),
      { id: routeId },
    );
    expect(result).toEqual([{ routeId, visible: true }]);
  });

  it('websocket 多边形显隐可渲染 polygon 为空的 mock detail', async () => {
    const { tool, runtime } = await makeTool();
    const polygonId = '465465682898690050';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ustudio/polygons/detail')) {
        return {
          ok: true,
          json: async () => ({
            polygon_id: '465465682898690048',
            polygon_name: 'p1',
            polygon: null,
            centroid: null,
            size: '15.7754',
            color: '#4C64F0',
            opacity: '0.5',
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => [],
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const result = await tool.setPolygonsVisible([polygonId], true);
    const lastCall = runtime.drawVirtualPolygon.mock.calls[runtime.drawVirtualPolygon.mock.calls.length - 1];
    const detail = lastCall?.[0] as Record<string, unknown>;

    expect(detail).toMatchObject({ polygon_id: polygonId, polygon_name: 'p1', opacity: 0.5 });
    expect(detail.points).toEqual(expect.arrayContaining([expect.objectContaining({ y: 6 })]));
    expect(result).toEqual([{ polygonId, visible: true }]);
  });

  it('多边形二维坐标优先使用 position.y 并在无效时回退 centroid.y', async () => {
    const { tool, runtime } = await makeTool();
    const details = [
      { polygon_id: 'position-first', polygon: { shape: [0, 0, 2, 0, 2, 2] }, position: '18.23&13.00&0.82', centroid: { x: 1, y: 6, z: 1 } },
      { polygon_id: 'centroid-fallback', polygon: { shape: [0, 0, 2, 0, 2, 2] }, position: 'invalid', centroid: { x: 1, y: 7, z: 1 } },
    ];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes('/detail') ? details.shift() : [],
    })) as unknown as typeof globalThis.fetch;

    await tool.setPolygonsVisible(['position-first'], true);
    await tool.setPolygonsVisible(['centroid-fallback'], true);

    const first = runtime.drawVirtualPolygon.mock.calls[0]?.[0] as { points: Array<{ y: number }> };
    const second = runtime.drawVirtualPolygon.mock.calls[1]?.[0] as { points: Array<{ y: number }> };
    expect(first.points.every((point) => point.y === 13)).toBe(true);
    expect(second.points.every((point) => point.y === 7)).toBe(true);
  });

  it('redraws reachable locally after successful SDK invoke click filtering', async () => {
    const invokeTwinsFunction = vi.fn<(payload: Record<string, unknown>) => Promise<{ success: boolean }>>(async () => ({ success: true }));
    const { tool, runtime, click } = await makeTool({ sdk: { invokeTwinsFunction } });

    tool.onControl('reachable', true);
    await flushAsync();
    records.length = 0;
    vi.clearAllMocks();

    await click({ twins_identifier: 'Door', out_instance_id: 'door-out', twins_instance_id: 'door-node' });

    expect(invokeTwinsFunction).toHaveBeenCalledTimes(1);
    expect(invokeTwinsFunction.mock.calls[0][0]).toMatchObject({
      function_identifier: 'setScene',
      input_params: expect.arrayContaining([
        { key: 'nodeId', value: 'door-node' },
      ]),
    });
    expect(records).toHaveLength(1);
    expect(records[0].body).toMatchObject({ sceneId: 'scene-1', nodeId: 'door-node' });
    expect(runtime.drawReachableRoutes).toHaveBeenCalledWith(
      [{ edge_id: 'reachable-edge', start_out_instance_id: 'door-out', end_out_instance_id: 'space-out' }],
      treeData,
      false,
    );
  });

  it('redraws connectivity locally after successful SDK invoke click filtering', async () => {
    const invokeTwinsFunction = vi.fn<(payload: Record<string, unknown>) => Promise<{ success: boolean }>>(async () => ({ success: true }));
    const { tool, runtime, click } = await makeTool({ sdk: { invokeTwinsFunction } });

    tool.onControl('connectivity', true);
    await flushAsync();
    records.length = 0;
    vi.clearAllMocks();

    await click({ twins_identifier: 'Space', out_instance_id: 'space-out', twins_instance_id: 'space-node' });

    expect(invokeTwinsFunction).toHaveBeenCalledTimes(1);
    expect(invokeTwinsFunction.mock.calls[0][0]).toMatchObject({
      function_identifier: 'setScene',
      input_params: expect.arrayContaining([
        { key: 'spaceId', value: 'space-node' },
      ]),
    });
    expect(records).toHaveLength(1);
    expect(records[0].body).toMatchObject({ sceneId: 'scene-1', spaceId: 'space-node' });
    expect(runtime.drawConnectivityRoutes).toHaveBeenCalledWith(
      [{ edge_id: 'connectivity-edge', start_out_instance_id: 'space-out', end_out_instance_id: 'door-out' }],
      treeData,
      false,
    );
  });

});
