import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from '../PluginManager';
import type { ScenePlugin, PluginContext, PluginManifest } from '../types';

function fakeViewer() {
  const added: any[] = [];
  const children: any[] = [];
  return {
    scene: { add: (o: any) => added.push(o), remove: (o: any) => { const i = added.indexOf(o); if (i >= 0) added.splice(i, 1); } },
    el: {
      appendChild: (n: any) => { children.push(n); return n; },
      removeChild: (n: any) => { const i = children.indexOf(n); if (i >= 0) children.splice(i, 1); },
    },
    _added: added,
    _children: children,
  } as any;
}

function makePlugin(id: string, activation: PluginManifest['activation'] = 'toggle', defaultEnabled = false) {
  const manifest: PluginManifest = { id, title: id, activation, defaultEnabled };
  let ctx: PluginContext | undefined;
  const p: ScenePlugin = {
    manifest,
    attach: vi.fn((c: PluginContext) => { ctx = c; }),
    enable: vi.fn(),
    disable: vi.fn(),
    dispose: vi.fn(),
  };
  return { p, getCtx: () => ctx! };
}

describe('PluginManager', () => {
  it('register 后进 registry 并按 pluginId attach 专属 ctx', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const { p, getCtx } = makePlugin('a');
    await m.register(p);
    expect(m.registry().map((x) => x.manifest.id)).toEqual(['a']);
    expect(p.attach).toHaveBeenCalledOnce();
    expect(getCtx().pluginId).toBe('a');
  });

  it('toggle 维护启用集并调 enable/disable', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const { p } = makePlugin('a');
    await m.register(p);
    expect(m.isEnabled('a')).toBe(false);
    m.toggle('a');
    expect(m.isEnabled('a')).toBe(true);
    expect(p.enable).toHaveBeenCalledOnce();
    m.toggle('a');
    expect(m.isEnabled('a')).toBe(false);
    expect(p.disable).toHaveBeenCalledOnce();
  });

  it('mode 互斥：启用一个 mode 自动停其它 mode；toggle 不受影响', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const a = makePlugin('a', 'mode');
    const b = makePlugin('b', 'mode');
    const c = makePlugin('c', 'toggle');
    await m.register(a.p); await m.register(b.p); await m.register(c.p);
    m.enable('c'); m.enable('a');
    expect(m.enabledIds().sort()).toEqual(['a', 'c']);
    m.enable('b');
    expect(m.isEnabled('a')).toBe(false);
    expect(m.isEnabled('b')).toBe(true);
    expect(m.isEnabled('c')).toBe(true);
  });

  it('subscribe 在变化时广播', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const { p } = makePlugin('a');
    await m.register(p);
    const cb = vi.fn();
    m.subscribe(cb);
    m.toggle('a');
    expect(cb).toHaveBeenCalled();
  });

  it('持久化：启用集变化触发 save，初始按 load 恢复', async () => {
    const store = { ids: ['a'] };
    const persistence = { load: () => store.ids, save: vi.fn((ids: string[]) => { store.ids = ids; }) };
    const m = new PluginManager({ viewer: fakeViewer(), persistence });
    const a = makePlugin('a'); const b = makePlugin('b');
    await m.register(a.p); await m.register(b.p);
    expect(m.isEnabled('a')).toBe(true);
    expect(a.p.enable).toHaveBeenCalledOnce();
    m.enable('b');
    expect(persistence.save).toHaveBeenCalledWith(['a', 'b']);
  });

  it('无持久化(首次)时 defaultEnabled 插件默认启用', async () => {
    const m = new PluginManager({ viewer: fakeViewer() }); // 无 persistence → load 视为 null
    const g = makePlugin('g', 'toggle', true);
    await m.register(g.p);
    expect(m.isEnabled('g')).toBe(true);
    expect(g.p.enable).toHaveBeenCalledOnce();
  });

  it('有持久化记录(即使为空数组)时忽略 defaultEnabled', async () => {
    const persistence = { load: () => [] as string[], save: vi.fn() };
    const m = new PluginManager({ viewer: fakeViewer(), persistence });
    const g = makePlugin('g', 'toggle', true);
    await m.register(g.p);
    expect(m.isEnabled('g')).toBe(false);
  });

  it('always 插件始终启用且不受持久化或 toggle 影响', async () => {
    const persistence = { load: () => [] as string[], save: vi.fn() };
    const m = new PluginManager({ viewer: fakeViewer(), persistence });
    const fixed = makePlugin('fixed', 'always');

    await m.register(fixed.p);
    expect(m.isEnabled('fixed')).toBe(true);
    expect(fixed.p.enable).toHaveBeenCalledOnce();
    expect(persistence.save).not.toHaveBeenCalled();

    m.toggle('fixed');
    expect(m.isEnabled('fixed')).toBe(true);
    expect(fixed.p.disable).not.toHaveBeenCalled();
  });

  it('控制调用失败时暴露错误，下一次成功调用后清除', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const { p } = makePlugin('a');
    let shouldFail = true;
    p.onControl = vi.fn(() => {
      if (shouldFail) throw new Error('坐标无效');
    });
    await m.register(p);

    m.setControl('a', 'apply', true);
    expect(m.getControlError('a')).toBe('坐标无效');

    shouldFail = false;
    m.setControl('a', 'apply', true);
    expect(m.getControlError('a')).toBeNull();
  });

  it('隔离：ctx.addObject 打 __pluginId 标签，removeOwnObjects 只清自己的', async () => {
    const viewer = fakeViewer();
    const m = new PluginManager({ viewer });
    const a = makePlugin('a'); const b = makePlugin('b');
    await m.register(a.p); await m.register(b.p);
    const oa = { userData: {} as Record<string, unknown> };
    const ob = { userData: {} as Record<string, unknown> };
    a.getCtx().addObject(oa);
    b.getCtx().addObject(ob);
    expect(oa.userData.__pluginId).toBe('a');
    expect(viewer._added).toContain(oa);
    a.getCtx().removeOwnObjects();
    expect(viewer._added).not.toContain(oa);
    expect(viewer._added).toContain(ob);
  });

  it('隔离：createOverlayRoot 各插件不同节点且挂到 viewer.el', async () => {
    const viewer = fakeViewer();
    viewer.el.appendChild = (n: any) => { viewer._children.push(n); return n; };
    const origDoc = (globalThis as any).document;
    try {
      (globalThis as any).document = { createElement: () => ({ setAttribute() {}, remove() {} }) };
      const m = new PluginManager({ viewer });
      const a = makePlugin('a'); const b = makePlugin('b');
      await m.register(a.p); await m.register(b.p);
      const ra = a.getCtx().createOverlayRoot();
      const rb = b.getCtx().createOverlayRoot();
      expect(ra).not.toBe(rb);
      expect(viewer._children).toContain(ra);
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('disposeAll 调每个插件 dispose', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const a = makePlugin('a'); const b = makePlugin('b');
    await m.register(a.p); await m.register(b.p);
    m.disposeAll();
    expect(a.p.dispose).toHaveBeenCalledOnce();
    expect(b.p.dispose).toHaveBeenCalledOnce();
  });

  // I2: disposeAll 后 registry() 返回 [] 且不抛
  it('disposeAll 后 registry() 返回 [] 且不抛', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const a = makePlugin('a'); const b = makePlugin('b');
    await m.register(a.p); await m.register(b.p);
    m.disposeAll();
    expect(() => m.registry()).not.toThrow();
    expect(m.registry()).toEqual([]);
  });

  // I1: enable() 抛异常时 isEnabled 为 false 且订阅者不被调用
  it('enable() 抛异常时 isEnabled 为 false 且订阅者不被调用', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const { p } = makePlugin('a');
    (p.enable as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('boom'); });
    await m.register(p);
    const cb = vi.fn();
    m.subscribe(cb);
    m.enable('a');
    expect(m.isEnabled('a')).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  // I3: attach() reject 时 register 不抛，isUnavailable 为 true，plugin 仍在 registry，后续插件正常注册
  it('attach() reject 时 register 不抛，isUnavailable 为 true，plugin 仍在 registry，后续插件正常注册', async () => {
    const m = new PluginManager({ viewer: fakeViewer() });
    const bad = makePlugin('bad');
    (bad.p.attach as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('attach fail'));
    const good = makePlugin('good');
    await expect(m.register(bad.p)).resolves.toBeUndefined();
    expect(m.isUnavailable('bad')).toBe(true);
    expect(m.registry().map((x) => x.manifest.id)).toContain('bad');
    await m.register(good.p);
    expect(m.registry().map((x) => x.manifest.id)).toContain('good');
    expect(m.isUnavailable('good')).toBe(false);
  });
});
