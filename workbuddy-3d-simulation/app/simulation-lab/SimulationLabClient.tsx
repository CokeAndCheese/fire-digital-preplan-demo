'use client';

import { SoonspaceSceneViewer } from '@/components/SoonspaceSceneViewer';
import { FireSimulationPanel } from '@/components/fire-simulation';
import type { RuntimeConfig } from '@/lib/app-key';

/**
 * 三维推演独立测试页（不接正式业务首页）。
 * 复用官方 SoonspaceSceneViewer 加载 uStudio 场景（挂到 window.__scene），
 * 在其上叠加 FireSimulationPanel，用 /demo/fire-simulation-sample.json 验证组件。
 */
export function SimulationLabClient({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <SoonspaceSceneViewer runtimeConfig={runtimeConfig} />
      <div style={{ position: 'fixed', top: 16, left: 16, zIndex: 40 }}>
        <FireSimulationPanel />
      </div>
    </main>
  );
}
