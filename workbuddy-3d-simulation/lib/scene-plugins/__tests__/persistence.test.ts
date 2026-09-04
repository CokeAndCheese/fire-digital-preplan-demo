import { describe, it, expect, beforeEach } from 'vitest';
import { localStoragePersistence } from '../persistence';

beforeEach(() => {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  };
});

describe('localStoragePersistence', () => {
  it('从未保存返回 null，save 后 load 回读', () => {
    const p = localStoragePersistence('scene-1');
    expect(p.load()).toBeNull();
    p.save(['floor', 'minimap']);
    expect(localStoragePersistence('scene-1').load()).toEqual(['floor', 'minimap']);
  });

  it('按 sceneId 隔离', () => {
    localStoragePersistence('scene-1').save(['floor']);
    expect(localStoragePersistence('scene-2').load()).toBeNull();
  });

  it('损坏数据返回 null', () => {
    (globalThis as any).localStorage.setItem('scene-plugins:enabled:scene-1', '{bad json');
    expect(localStoragePersistence('scene-1').load()).toBeNull();
  });

  it('save 空数组后 load 返回 []（区别于从未保存的 null）', () => {
    const p = localStoragePersistence('scene-1');
    p.save([]);
    expect(localStoragePersistence('scene-1').load()).toEqual([]);
  });
});
