'use client';

import { useState } from 'react';
import { Map, RefreshCw, LoaderCircle } from 'lucide-react';
import { clientPath } from '@/lib/client-path';

type ZoneInfo = { id: string; name: string; color: string };
type RouteInfo = { id: string; name: string; color: string };
type Payload = {
  deploy?: { zones?: ZoneInfo[]; routes?: RouteInfo[] };
  firePoint?: { x: number; y: number; z: number };
  message?: string;
};

export function ZoneDeployPanel({ fireObjectId, sceneId }: { fireObjectId?: string | null; sceneId?: string | null }) {
  const [zones, setZones] = useState<ZoneInfo[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firePoint, setFirePoint] = useState<{ x: number; y: number; z: number } | null>(null);

  const deploy = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = fireObjectId ? { fireObjectId, sceneId } : { sceneId };
      const response = await fetch(clientPath('/api/zone-deploy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
      setZones(payload.deploy?.zones ?? []);
      setRoutes(payload.deploy?.routes ?? []);
      setFirePoint(payload.firePoint ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '作战区域部署失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="zone-deploy-card">
      <header className="zone-deploy-card__head">
        <span className="zone-deploy-card__icon"><Map size={14} /></span>
        <div><h3 className="zone-deploy-card__title">作战区域部署</h3><small className="zone-deploy-card__sub">车辆停放 / 登高作业 / 器材 / 警戒 + 进攻 / 三层疏散</small></div>
        <button type="button" className="zone-deploy-card__btn" onClick={() => void deploy()} disabled={busy}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />} 生成
        </button>
      </header>
      {firePoint && <div className="zone-deploy-card__meta">火点坐标 {firePoint.x.toFixed(1)}, {firePoint.y.toFixed(1)}, {firePoint.z.toFixed(1)}</div>}
      {zones.length > 0 && <div className="zone-deploy-card__zones">{zones.map((z) => <span key={z.id} className="zone-deploy-card__tag" style={{ borderColor: z.color, color: z.color }}>{z.name}</span>)}</div>}
      {routes.length > 0 && <div className="zone-deploy-card__zones">{routes.map((r) => <span key={r.id} className="zone-deploy-card__tag" style={{ borderColor: r.color, color: r.color }}>{r.name}</span>)}</div>}
      {error && <div className="zone-deploy-card__error">{error}</div>}
    </div>
  );
}
