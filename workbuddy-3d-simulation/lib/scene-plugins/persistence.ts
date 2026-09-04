import type { PersistenceAdapter } from './types';

export function localStoragePersistence(sceneId: string): PersistenceAdapter {
  const key = `scene-plugins:enabled:${sceneId}`;
  return {
    load(): string[] | null {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null; // 从未保存：返回 null，让 manager 应用 defaultEnabled
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null;
      } catch {
        return null;
      }
    },
    save(enabledIds: string[]): void {
      try {
        localStorage.setItem(key, JSON.stringify(enabledIds));
      } catch {
        /* ignore quota/denied */
      }
    },
  };
}
