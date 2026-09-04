'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createFireSimulationController,
  createUStudioAdapter,
  type FireSimulationAdapter,
  type FireSimulationController,
  type SimulationPlan,
  type SimulationSnapshot,
} from '@/lib/fire-simulation';
import styles from './ZoneDeployPanel.module.css';
import { withBasePath } from '@/lib/client-path';

type FirePoint = { x: number; y: number; z: number };

type ZoneDeployResponse = {
  deploy: {
    zones: Array<{ id: string; name: string; color: string }>;
    routes: Array<{ id: string; name: string; color: string }>;
  };
  actions: Array<Record<string, unknown>>;
  firePoint: FirePoint;
};

const STATUS_LABEL: Record<string, string> = {
  idle: '待部署',
  running: '部署中',
  completed: '已部署',
  error: '错误',
};

export function ZoneDeployPanel() {
  const adapterRef = useRef<FireSimulationAdapter | null>(null);
  const controllerRef = useRef<FireSimulationController | null>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [deploy, setDeploy] = useState<ZoneDeployResponse | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);

  const ensureController = (): FireSimulationController | null => {
    if (controllerRef.current) return controllerRef.current;
    const adapter = createUStudioAdapter({ getSceneId: () => window.__sceneId });
    const controller = createFireSimulationController({
      adapter,
      onStateChange: (snap) => setSnapshot(snap),
    });
    adapterRef.current = adapter;
    controllerRef.current = controller;
    setSnapshot(controller.getSnapshot());
    return controller;
  };

  useEffect(() => {
    ensureController();
    return () => {
      const c = controllerRef.current;
      controllerRef.current = null;
      adapterRef.current = null;
      void c?.dispose();
    };
  }, []);

  const buildPlan = (resp: ZoneDeployResponse): SimulationPlan => ({
    contractVersion: '1.0',
    eventId: `ZONE-${Date.now()}`,
    sceneId: window.__sceneId ?? '477747327523254272',
    title: '作战区域部署',
    createdAt: new Date().toISOString(),
    steps: [
      {
        id: 'zone-deploy',
        order: 1,
        code: 'ANALYZE_SPREAD',
        title: '作战区域部署',
        description: '车辆停放区/登高作业面/器材摆放区/警戒区 + 进攻/三层疏散路线。',
        actions: resp.actions as never,
      },
    ],
  });

  const deployZone = async (fireObjectId?: string) => {
    setError(null);
    setStatus('running');
    try {
      const response = await fetch(withBasePath('/api/zone-deploy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fireObjectId ? { fireObjectId, sceneId: window.__sceneId ?? '477747327523254272' } : { sceneId: window.__sceneId ?? '477747327523254272' }),
      });
      const payload = (await response.json()) as ZoneDeployResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
      setDeploy(payload);
      const ctrl = ensureController();
      if (!ctrl) throw new Error('三维控制器未就绪');
      await ctrl.reset();
      ctrl.load(buildPlan(payload));
      await ctrl.start();
      setStatus('completed');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : '部署失败');
    }
  };

  const ctrl = controllerRef.current;
  const snap = snapshot;
  const zoneNames = deploy?.deploy.zones.map((z) => z.name) ?? [];
  const routeNames = deploy?.deploy.routes.map((r) => r.name) ?? [];

  return (
    <section className={styles.panel} aria-label="作战区域部署">
      <div className={styles.header}>
        <div>
          <h2 className={styles.headerTitle}>作战区域部署</h2>
          <span className={styles.badge + ' ' + styles[`badge${status === 'completed' ? 'Done' : status === 'running' ? 'Running' : status === 'error' ? 'Error' : 'Idle'}`]}>
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.legend}>
          <span className={styles.legendTitle}>区域</span>
          {zoneNames.map((n) => <span key={n} className={styles.legendItem}>{n}</span>)}
          {zoneNames.length === 0 && <span className={styles.empty}>尚未部署区域</span>}
        </div>
        <div className={styles.legend}>
          <span className={styles.legendTitle}>路线</span>
          {routeNames.map((n) => <span key={n} className={styles.legendItem}>{n}</span>)}
          {routeNames.length === 0 && <span className={styles.empty}>尚未部署路线</span>}
        </div>
        {error && <div className={styles.errorBox}>{error}</div>}
        {snap?.error && <div className={styles.errorBox}>绘制错误 [{snap.error.code}]：{snap.error.message}</div>}
      </div>
      <div className={styles.controls}>
        <button type="button" className={styles.btn} disabled={status === 'running'} onClick={() => void deployZone()}>
          部署（默认火点）
        </button>
        <button type="button" className={styles.btn} disabled={status === 'running'} onClick={() => void ctrl?.reset()}>
          复位
        </button>
      </div>
    </section>
  );
}
