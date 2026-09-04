import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATED_PANELS } from '../generated-panels';
import { panelList, panelSetVisible } from '../generated-panel-runtime';
import { registerPanel, unregisterPanel } from '../panels';

function createElementStub(): HTMLElement {
  const classes = new Set<string>();
  return {
    classList: {
      contains: (name: string) => classes.has(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        const shouldAdd = force ?? !classes.has(name);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
    },
  } as unknown as HTMLElement;
}

afterEach(() => {
  GENERATED_PANELS.splice(0, GENERATED_PANELS.length);
  vi.unstubAllGlobals();
});

describe('generated panel runtime', () => {
  it('静态清单尚未热更新时仍返回 PanelShell 运行时登记的面板', () => {
    GENERATED_PANELS.splice(0, GENERATED_PANELS.length);
    const el = createElementStub();
    vi.stubGlobal('window', {
      __panels: [
        {
          name: 'stats',
          title: '信息统计面板',
          description: '统计当前场景信息',
        },
      ],
    });
    vi.stubGlobal('document', {
      getElementById: vi.fn((domId: string) => (domId === 'panel-stats' ? el : null)),
    });

    expect(panelList()).toEqual([
      {
        id: 'stats',
        name: '信息统计面板',
        domId: 'panel-stats',
        description: '统计当前场景信息',
        mounted: true,
        visible: true,
      },
    ]);
  });

  it('通过 PanelShell 控制器关闭时最小化且不添加隐藏类', async () => {
    const el = createElementStub();
    let expanded = true;
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    vi.stubGlobal('document', {
      getElementById: vi.fn((domId: string) => (domId === 'panel-device-stats' ? el : null)),
    });
    GENERATED_PANELS.push({
      id: 'device-stats',
      name: '设备统计',
      domId: 'panel-device-stats',
      description: '展示设备统计业务面板',
    });
    registerPanel({
      name: 'device-stats',
      title: '设备统计',
      description: '展示设备统计业务面板',
      getState: () => ({ expanded }),
      setExpanded: (next) => {
        expanded = next;
      },
    });

    try {
      const minimized = await panelSetVisible({ id: 'device-stats', visible: false });
      expect(minimized).toMatchObject({ mounted: true, visible: false });
      expect(el.classList.contains('is-hidden')).toBe(false);
      expect(panelList()[0]).toMatchObject({ mounted: true, visible: false });

      const restored = await panelSetVisible({ id: 'device-stats', visible: true });
      expect(restored).toMatchObject({ mounted: true, visible: true });
    } finally {
      unregisterPanel('device-stats');
    }
  });

  it('根据英文别名 name 显示隐藏中文面板', async () => {
    const el = createElementStub();
    vi.stubGlobal('document', {
      getElementById: vi.fn((domId: string) => (domId === 'panel-floor-info' ? el : null)),
    });
    GENERATED_PANELS.push({
      id: 'floor-info',
      name: '楼层信息统计',
      aliases: ['Floor Info', 'Floor Information Stats'],
      domId: 'panel-floor-info',
      description: '展示楼层信息统计业务面板',
    });

    const result = await panelSetVisible({ name: 'floor info', visible: false });

    expect(result.id).toBe('floor-info');
    expect(result.visible).toBe(false);
    expect(el.classList.contains('is-hidden')).toBe(true);
  });

  it('兼容 visible 字符串 true/false 大小写', async () => {
    const el = createElementStub();
    vi.stubGlobal('document', {
      getElementById: vi.fn((domId: string) => (domId === 'panel-device-overview' ? el : null)),
    });
    GENERATED_PANELS.push({
      id: 'device-overview',
      name: '设备总览',
      aliases: ['Device Overview'],
      domId: 'panel-device-overview',
      description: '展示设备总览业务面板',
    });

    const hidden = await panelSetVisible({ id: 'device-overview', visible: 'FaLsE' });
    const shown = await panelSetVisible({ id: 'device-overview', visible: ' TRUE ' });

    expect(hidden.visible).toBe(false);
    expect(shown.visible).toBe(true);
    expect(el.classList.contains('is-hidden')).toBe(false);
  });

  it('显示已卸载面板时先通知 PanelShell 挂载，不再抛 DOM 未找到', async () => {
    const el = createElementStub();
    let mounted = false;
    const dispatchEvent = vi.fn((event: { detail?: { name?: string; open?: boolean } }) => {
      if (event.detail?.name === 'building-list' && event.detail.open === true) mounted = true;
      return true;
    });
    vi.stubGlobal('CustomEvent', class {
      detail?: unknown;
      constructor(_type: string, init?: { detail?: unknown }) {
        this.detail = init?.detail;
      }
    });
    vi.stubGlobal('window', {
      dispatchEvent,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    vi.stubGlobal('document', {
      getElementById: vi.fn((domId: string) => (mounted && domId === 'panel-building-list' ? el : null)),
    });
    GENERATED_PANELS.push({
      id: 'building-list',
      name: '楼栋列表',
      aliases: ['Building List'],
      domId: 'panel-building-list',
      description: '展示场景中所有楼栋',
    });

    const result = await panelSetVisible({ id: 'building-list', visible: true });

    expect(dispatchEvent).toHaveBeenCalled();
    expect(dispatchEvent.mock.calls[0][0].detail).toEqual({ name: 'building-list', open: true });
    expect(result).toMatchObject({ id: 'building-list', mounted: true, visible: true });
  });
});
