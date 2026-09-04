'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Map, RefreshCw, LoaderCircle, CheckCircle2 } from 'lucide-react';
import { clientPath } from '@/lib/client-path';

type ZoneInfo = { id: string; name: string; color: string };
type RouteInfo = { id: string; name: string; color: string };
type DeployPayload = {
  deploy?: { zones?: ZoneInfo[]; routes?: RouteInfo[] };
  firePoint?: { x: number; y: number; z: number };
  actions?: Array<Record<string, unknown>>;
  message?: string;
};
type DrawPayload = { run?: { runId: string; status: string; detail?: string } | null; message?: string };

const STATUS_LABEL: Record<string, string> = {
  idle: '待部署',
  running: '绘制中',
  completed: '已部署',
  failed: '失败',
};

/** 作战区域含义说明（按 zone id），帮助用户理解三维中各彩色区域。 */
const ZONE_MEANING: Record<string, string> = {
  parking: '消防车停放区（车不进楼）',
  aerial: '登高操作场地（举高车作业）',
  equipment: '器材摆放区',
  cordon: '警戒区（围封外围）',
};

/** 行进/疏散路线含义说明（按 route id）。 */
const ROUTE_MEANING: Record<string, string> = {
  attack: '进攻路线（停车点→火点地面）',
  interior_attack: '内攻路线（集结点→起火层出枪阵地）',
  main_route: '主进攻路线',
  backup_route: '备用路线',
  evacuation_fire: '着火层疏散路线',
  evacuation_above: '着火层上层疏散路线',
  evacuation_below: '着火层下层疏散路线',
};

export function ZoneDeployDrivePanel({
  fireObjectId,
  sceneId,
}: {
  fireObjectId?: string | null;
  sceneId?: string | null;
}) {
  const [zones, setZones] = useState<ZoneInfo[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [firePoint, setFirePoint] = useState<{ x: number; y: number; z: number } | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawRunIdRef = useRef<string | null>(null);

  // 轮询绘制任务状态，直到完成/失败。
  const pollDraw = useCallback(async (runId: string) => {
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const response = await fetch(clientPath(`/api/zone-deploy/draw/${encodeURIComponent(runId)}`), { cache: 'no-store' });
        const payload = (await response.json()) as DrawPayload;
        if (payload.run) {
          if (payload.run.status === 'completed') {
            setStatus('completed');
            return;
          }
          if (payload.run.status === 'failed') {
            setStatus('failed');
            setError(payload.run.detail ?? '绘制失败');
            return;
          }
        }
      } catch {
        // 忽略瞬时查询错误。
      }
    }
    setStatus('idle');
  }, []);

  const deploy = async () => {
    setBusy(true);
    setError(null);
    setStatus('running');
    try {
      const body = fireObjectId ? { fireObjectId, sceneId } : { sceneId };
      const response = await fetch(clientPath('/api/zone-deploy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as DeployPayload;
      if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
      setZones(payload.deploy?.zones ?? []);
      setRoutes(payload.deploy?.routes ?? []);
      setFirePoint(payload.firePoint ?? null);
      // 把计算好的可绘制动作下发给三维场景，由无画面执行器驱动 SDK 绘制。
      const actions = payload.actions ?? [];
      if (actions.length) {
        const drawResponse = await fetch(clientPath('/api/zone-deploy/run'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId, planId: 'command-zone-deploy', actions, title: '作战区域部署' }),
        });
        const drawPayload = (await drawResponse.json()) as DrawPayload;
        if (!drawResponse.ok) throw new Error(drawPayload.message ?? `HTTP ${drawResponse.status}`);
        if (drawPayload.run?.runId) {
          drawRunIdRef.current = drawPayload.run.runId;
          void pollDraw(drawPayload.run.runId);
        } else {
          setStatus('idle');
        }
      } else {
        setStatus('completed');
      }
    } catch (e) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : '作战区域部署失败');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      drawRunIdRef.current = null;
    };
  }, []);

  return (
    <div className="zone-deploy-card zone-deploy-drive">
      <header className="zone-deploy-card__head">
        <span className="zone-deploy-card__icon"><Map size={14} /></span>
        <div><h3 className="zone-deploy-card__title">作战区域部署</h3><small className="zone-deploy-card__sub">车辆停放 / 登高作业 / 器材 / 警戒 + 进攻 / 三层疏散</small></div>
        <button type="button" className="zone-deploy-card__btn" onClick={() => void deploy()} disabled={busy}>
          {busy ? <LoaderCircle size={13} className="spin" /> : status === 'completed' ? <CheckCircle2 size={13} /> : <RefreshCw size={13} />} 部署
        </button>
      </header>
      <div className="zone-deploy-card__status">状态：{STATUS_LABEL[status] ?? status}</div>
      {firePoint && <div className="zone-deploy-card__meta">火点坐标 {firePoint.x.toFixed(1)}, {firePoint.y.toFixed(1)}, {firePoint.z.toFixed(1)}</div>}
      {/* 结构化图例：区域与路线分组，标注颜色圆点与含义，便于对照三维图形 */}
      <div className="zone-deploy-legend">
        <div className="zone-deploy-legend__group">
          <strong>作战区域</strong>
          {zones.map((z) => <div key={z.id} className="zone-deploy-legend__row"><span className="zone-deploy-legend__dot" style={{ background: z.color }} /><em>{z.name}</em><small>{ZONE_MEANING[z.id] ?? ''}</small></div>)}
          {zones.length === 0 && <span className="zone-deploy-legend__empty">—</span>}
        </div>
        <div className="zone-deploy-legend__group">
          <strong>行进路线</strong>
          {routes.map((r) => <div key={r.id} className="zone-deploy-legend__row"><span className="zone-deploy-legend__dot" style={{ background: r.color }} /><em>{r.name}</em><small>{ROUTE_MEANING[r.id] ?? ''}</small></div>)}
          {routes.length === 0 && <span className="zone-deploy-legend__empty">—</span>}
        </div>
      </div>
      {error && <div className="zone-deploy-card__error">{error}</div>}
    </div>
  );
}
