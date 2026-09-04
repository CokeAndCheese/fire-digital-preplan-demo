import { describe, expect, it, vi } from 'vitest';
import { SoonspaceRuntime } from '@/lib/soonspace-runtime';
import { RenderSettingsTool } from '../plugins/RenderSettingsTool';
import type { PluginContext } from '../types';

function makeHarness() {
  const target = { copy: vi.fn() };
  const atmospherePlugin = {
    date: new Date(2026, 6, 13, 10, 0),
    longitude: 120,
    latitude: 30,
    altitude: 20,
    distance: 300,
    target,
    start: vi.fn(),
    stop: vi.fn(),
    updateModelLightingMask: vi.fn(),
  };
  const box = {
    getCenter: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    getSize: vi.fn(() => ({ length: () => 640 })),
  };
  const cps = {
    atmospherePlugin,
    metaData: {
      gisSettings: { enabled: true, longitude: 121.5, latitude: 31.2, altitude: 18 },
    },
    sceneGroup: { getBoundingBox: vi.fn(() => box) },
  };
  const ssp = {
    setToneMapping: vi.fn(),
    render: vi.fn(),
  };
  const runtime = {
    getCps: vi.fn(() => cps),
    getSsp: vi.fn(() => ssp),
    setRenderOrigin: vi.fn(),
  };
  const requestRender = vi.fn();
  const ctx: PluginContext = {
    viewer: { el: {} as HTMLElement },
    pluginId: 'render-settings',
    createOverlayRoot: vi.fn(() => ({ remove: vi.fn() }) as unknown as HTMLElement),
    addObject: vi.fn(),
    removeOwnObjects: vi.fn(),
    getResource: (key) => (key === 'runtime' ? runtime : undefined),
    requestRender,
  };
  return { atmospherePlugin, box, cps, ssp, runtime, requestRender, ctx };
}

describe('RenderSettingsTool', () => {
  it('SoonspaceRuntime 同步更新 CPS 大气位置和已加载 GIS 原点', () => {
    const runtime = new SoonspaceRuntime();
    const atmospherePlugin = { longitude: 120, latitude: 30, altitude: 20 };
    const invalidate = vi.fn();
    (runtime as unknown as { cps: unknown }).cps = {
      atmospherePlugin,
      terrainTilesRenderer: { invalidate },
    };
    (runtime as unknown as { ssp: unknown }).ssp = { render: vi.fn() };

    runtime.setRenderOrigin(116.4, 39.9, 42);

    expect(atmospherePlugin).toMatchObject({ longitude: 116.4, latitude: 39.9, altitude: 42 });
    expect(invalidate).toHaveBeenCalledWith(116.4, 39.9, 42);
  });

  it('SoonspaceRuntime 在 GIS 延迟创建后应用待同步原点', async () => {
    const runtime = new SoonspaceRuntime();
    const invalidate = vi.fn();
    const enable = vi.fn();
    const cps: Record<string, unknown> = {
      atmospherePlugin: { longitude: 120, latitude: 30, altitude: 20 },
    };
    (runtime as unknown as { cps: unknown }).cps = cps;
    (runtime as unknown as { ssp: unknown }).ssp = { render: vi.fn() };
    (runtime as unknown as { originalCpsPresetGis: () => Promise<void> }).originalCpsPresetGis = async () => {
      cps.terrainTilesRenderer = { invalidate, enable };
    };

    runtime.setRenderOrigin(116.4, 39.9, 42);
    await runtime.setGisVisible(true);

    expect(invalidate).toHaveBeenCalledWith(116.4, 39.9, 42);
    expect(enable).toHaveBeenCalledOnce();
  });

  it('作为常驻折叠模块并从 CPS GIS 元数据初始化坐标', async () => {
    const { ctx } = makeHarness();
    const tool = new RenderSettingsTool();

    await tool.attach(ctx);

    expect(tool.manifest.activation).toBe('always');
    expect(tool.getControls()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'number', id: 'longitude', default: 121.5 }),
      expect.objectContaining({ kind: 'number', id: 'latitude', default: 31.2 }),
      expect.objectContaining({ kind: 'number', id: 'altitude', default: 18 }),
      expect.objectContaining({
        kind: 'select',
        id: 'toneMapping',
        options: expect.arrayContaining([
          { value: 'None', label: '无' },
          { value: 'Neutral', label: '中性' },
        ]),
      }),
    ]));
  });

  it('开启大气时按 CPS 示例设置场景范围并恢复用户 Tone Mapping', async () => {
    const { ctx, atmospherePlugin, box, ssp } = makeHarness();
    const tool = new RenderSettingsTool();
    await tool.attach(ctx);

    tool.onControl('toneMapping', 'Neutral');
    tool.onControl('exposure', 1.6);
    tool.onControl('atmosphere', true);

    expect(box.getCenter).toHaveBeenCalledOnce();
    expect(box.getSize).toHaveBeenCalledOnce();
    expect(atmospherePlugin.target.copy).toHaveBeenCalledWith({ x: 1, y: 2, z: 3 });
    expect(atmospherePlugin.distance).toBe(640);
    expect(atmospherePlugin.start).toHaveBeenCalledOnce();
    expect(atmospherePlugin.updateModelLightingMask).toHaveBeenCalledOnce();
    expect(ssp.setToneMapping).toHaveBeenLastCalledWith({ type: 'Neutral', exposure: 1.6 });
  });

  it('未主动调整 Tone Mapping 时保留 AtmospherePlugin 的内部默认设置', async () => {
    const { ctx, ssp } = makeHarness();
    const tool = new RenderSettingsTool();
    await tool.attach(ctx);

    tool.onControl('atmosphere', true);
    expect(tool.getControls()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'toneMapping', default: 'AGX' }),
      expect.objectContaining({ id: 'exposure', default: 10 }),
    ]));
    tool.onControl('atmosphere', false);
    expect(tool.getControls()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'toneMapping', default: 'ACESFilmic' }),
      expect.objectContaining({ id: 'exposure', default: 0.8 }),
    ]));

    expect(ssp.setToneMapping).not.toHaveBeenCalled();
  });

  it('更新时间和坐标时调用现有 Atmosphere/GIS 能力', async () => {
    const { ctx, atmospherePlugin, runtime, ssp } = makeHarness();
    const tool = new RenderSettingsTool();
    await tool.attach(ctx);

    tool.onControl('datetime', '2026-12-21T16:45');
    expect(atmospherePlugin.date.getFullYear()).toBe(2026);
    expect(atmospherePlugin.date.getMonth()).toBe(11);
    expect(atmospherePlugin.date.getDate()).toBe(21);
    expect(atmospherePlugin.date.getHours()).toBe(16);
    expect(atmospherePlugin.date.getMinutes()).toBe(45);
    expect(ssp.render).toHaveBeenCalled();

    tool.onControl('longitude', 116.4);
    tool.onControl('latitude', 39.9);
    tool.onControl('altitude', 42);
    tool.onControl('applyOrigin', true);
    expect(runtime.setRenderOrigin).toHaveBeenCalledWith(116.4, 39.9, 42);
  });

  it('坐标输入清空后禁止使用旧值应用', async () => {
    const { ctx, runtime } = makeHarness();
    const tool = new RenderSettingsTool();
    await tool.attach(ctx);

    tool.onControl('longitude', '');

    expect(() => tool.onControl('applyOrigin', true)).toThrow('经度不能为空');
    expect(runtime.setRenderOrigin).not.toHaveBeenCalled();
  });

  it('关闭大气时调用 stop 并保持面板 Tone Mapping', async () => {
    const { ctx, atmospherePlugin, ssp } = makeHarness();
    const tool = new RenderSettingsTool();
    await tool.attach(ctx);

    tool.onControl('toneMapping', 'Cineon');
    tool.onControl('exposure', 0.6);
    tool.onControl('atmosphere', false);

    expect(atmospherePlugin.stop).toHaveBeenCalledOnce();
    expect(ssp.setToneMapping).toHaveBeenLastCalledWith({ type: 'Cineon', exposure: 0.6 });
  });
});
