'use client';

import { useEffect, useRef } from 'react';
import {
  createFireSimulationController,
  createUStudioAdapter,
  type FireSimulationAdapter,
  type FireSimulationController,
  type SimulationAction,
  type SimulationPlan,
} from '@/lib/fire-simulation';
import { withBasePath } from '@/lib/client-path';

const WUKUANG_SCENE_ID = '477747327523254272';

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

type PendingPayload = { run?: { runId: string; actions: SimulationAction[] } | null } | null;

/**
 * 无画面作战区域绘制执行器。
 *
 * 三维页面上不再渲染「作战区域部署」大面板；本组件只负责轮询远端下发的绘制动作，
 * 通过控制器驱动 SDK 在模型上绘制区域多边形与进攻/疏散路线，完成后回写状态。
 * 不渲染任何 UI，保持三维模型页面干净。
 */
export function SceneDeployRunner({ sceneId }: { sceneId?: string }) {
  const controllerRef = useRef<FireSimulationController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const activeSceneId = sceneId ?? (typeof window !== 'undefined' ? window.__sceneId : undefined) ?? '';
    const adapter = createUStudioAdapter({ getSceneId: () => activeSceneId });
    const controller = createFireSimulationController({ adapter, onStateChange: () => {} });
    controllerRef.current = controller;
    let stopped = false;
    let pollTimer: number | undefined;

    const report = async (runId: string, status: 'completed' | 'failed', detail: string) => {
      await fetch(withBasePath(`/api/zone-deploy/draw/${encodeURIComponent(runId)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, detail }),
      }).catch(() => {});
    };

    const runDraw = async (runId: string, actions: SimulationAction[]) => {
      const plan: SimulationPlan = {
        contractVersion: '1.0',
        eventId: `ZONE-${Date.now()}`,
        sceneId: activeSceneId || WUKUANG_SCENE_ID,
        title: '作战区域部署',
        createdAt: new Date().toISOString(),
        steps: [
          {
            id: 'zone-deploy',
            order: 1,
            code: 'ANALYZE_SPREAD',
            title: '作战区域部署',
            description: '车辆停放区/登高作业面/器材摆放区/警戒区 + 进攻/三层疏散路线。',
            actions,
          },
        ],
      };
      try {
        await controller.reset();
        controller.load(plan);
        await controller.start();
        await report(runId, 'completed', '作战区域与路线已绘制。');
      } catch (error) {
        await report(runId, 'failed', error instanceof Error ? error.message : '作战区域绘制失败。');
      }
    };

    const poll = async () => {
      if (stopped) return;
      if (activeRunIdRef.current) return;
      try {
        const response = await fetch(withBasePath(`/api/zone-deploy/pending?sceneId=${encodeURIComponent(activeSceneId)}`), { cache: 'no-store' });
        const payload = (response.ok ? await response.json().catch(() => null) : null) as PendingPayload;
        if (payload?.run) {
          activeRunIdRef.current = payload.run.runId;
          await runDraw(payload.run.runId, payload.run.actions);
          activeRunIdRef.current = null;
          pollTimer = window.setTimeout(() => void poll(), 300);
          return;
        }
      } catch {
        // 忽略瞬时错误，继续轮询。
      }
      pollTimer = window.setTimeout(() => void poll(), 600);
    };

    pollTimer = window.setTimeout(() => void poll(), 500);
    return () => {
      stopped = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      void controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  return null;
}
