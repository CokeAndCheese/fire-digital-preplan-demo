'use client';

import { useEffect, useState } from 'react';

/**
 * 当前场景 ID 的【唯一可靠来源】。
 *
 * Viewer 加载 / 切换场景时会把真实 scene_id 挂到 `window.__sceneId` 并派发 `ustudio:scene` 事件
 * （见 components/UStudioSceneViewer.tsx）。面板要拿 sceneId，**只用这个 hook**：
 *   - 挂载时立刻读 `window.__sceneId`；
 *   - 监听 `ustudio:scene`，切场景自动更新。
 *
 * 【不要】自己读 window / 读 env / 写 `if(!sceneId) "场景ID未配置"` 守卫 —— 那是"未配置"的根源。
 * 初次渲染 sceneId 可能短暂为空（Viewer 还在加载），显示「加载中…」即可，场景一就绪 hook 会自动给值。
 * 另外服务端 SDK（@/lib/ustudio）不传 sceneId 也会自动用当前场景兜底，所以接口侧也不会"未配置"。
 */
export function useSceneId(): string {
  const [sceneId, setSceneId] = useState<string>('');
  useEffect(() => {
    const w = window as unknown as { __sceneId?: string };
    if (w.__sceneId) setSceneId(w.__sceneId);
    const onScene = (e: Event): void => {
      const id = (e as CustomEvent<{ sceneId?: string }>).detail?.sceneId;
      if (id) setSceneId(String(id));
    };
    window.addEventListener('ustudio:scene', onScene);
    return () => window.removeEventListener('ustudio:scene', onScene);
  }, []);
  return sceneId;
}
