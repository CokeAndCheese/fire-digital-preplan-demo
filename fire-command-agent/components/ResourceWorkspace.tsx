'use client';

import { AlertCircle, ExternalLink, LoaderCircle, MapPin, Maximize2, Minimize2, RefreshCw, RadioTower, ShieldCheck, Droplets, Truck, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DistrictBars, WaterSourceBars } from './DashboardCharts';
import { planFromRun, type LiveExecutionRun } from './ExecutionMonitor';
import type { FireResourcePlatformUnit } from '@/lib/skills/fire-resource-platform';
import { clientPath } from '@/lib/client-path';

type ResourcesPayload = {
  ok: true;
  platformUrl: string;
  units: FireResourcePlatformUnit[];
  fetchedAt: string;
} | { ok: false; platformUrl: string; message: string };

function personnelOf(unit: FireResourcePlatformUnit): number {
  if (typeof unit.personnelCount === 'number') return unit.personnelCount;
  const match = unit.personnel?.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function timeOf(value?: string): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ResourceWorkspace({ run }: { run: LiveExecutionRun | null }) {
  const [payload, setPayload] = useState<ResourcesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platformFocused, setPlatformFocused] = useState(false);
  const plan = planFromRun(run);
  const waterSources = plan?.routeWater?.waterSources ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(clientPath('/api/resources'), { cache: 'no-store' });
      const next = await response.json() as ResourcesPayload;
      if (!response.ok || !next.ok) throw new Error(next.ok ? '力量平台返回异常。' : next.message);
      setPayload(next);
    } catch (cause) {
      setPayload(null);
      setError(cause instanceof Error ? cause.message : '救援力量平台暂时不可用。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!platformFocused) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlatformFocused(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [platformFocused]);

  const units = payload?.ok ? payload.units : [];
  const verified = units.filter((unit) => unit.availabilityStatus === 'verified').length;
  const personnel = useMemo(() => units.reduce((sum, unit) => sum + personnelOf(unit), 0), [units]);
  const vehicles = useMemo(() => units.reduce((sum, unit) => sum + unit.vehicles.length, 0), [units]);
  const nearestWater = waterSources.length ? [...waterSources].sort((a, b) => a.distanceKm - b.distanceKm)[0] : null;

  return (
    <main className="resource-workspace" aria-labelledby="resource-workspace-title">
      <header className="resource-workspace__header">
        <div>
          <span className="command-kicker">RESOURCE COMMAND / 04</span>
          <h2 id="resource-workspace-title">辖区救援力量</h2>
          <p>直接查看八维通力量平台。上方指标来自当前同步数据，事件水源随预案查询回执更新。</p>
        </div>
        <div className="resource-workspace__actions">
          <span className={`resource-sync-status${loading ? ' is-loading' : ''}`}><span aria-hidden />{loading ? '同步中' : error ? '同步异常' : `已同步 ${timeOf(payload?.ok ? payload.fetchedAt : undefined)}`}</span>
          <button type="button" className="ops-icon-button" onClick={() => void load()} disabled={loading} aria-label="刷新力量数据" title="刷新力量数据"><RefreshCw size={15} className={loading ? 'spin' : undefined} /></button>
          {payload?.ok && <a className="resource-open-link" href={payload.platformUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />新窗口打开</a>}
        </div>
      </header>

      <section className="resource-summary" aria-label="辖区力量与水源概览">
        <div className="resource-summary__card resource-summary__card--accent"><RadioTower size={18} /><span>登记队站</span><strong>{loading ? '—' : units.length}</strong><small>辖区平台登记</small></div>
        <div className="resource-summary__card"><ShieldCheck size={18} /><span>已核验可用</span><strong>{loading ? '—' : verified}</strong><small>可进入编成候选</small></div>
        <div className="resource-summary__card"><Users size={18} /><span>登记人员</span><strong>{loading ? '—' : personnel}</strong><small>按平台字段汇总</small></div>
        <div className="resource-summary__card"><Truck size={18} /><span>登记车辆</span><strong>{loading ? '—' : vehicles}</strong><small>不代表实时在位</small></div>
        <div className="resource-summary__card resource-summary__card--water"><Droplets size={18} /><span>事件水源</span><strong>{waterSources.length || '—'}</strong><small>{nearestWater ? `最近 ${nearestWater.distanceKm.toFixed(2)} km` : '随事件查询接入'}</small></div>
      </section>

      <section className="resource-insights" aria-label="数据概览图表">
        {payload?.ok && <DistrictBars units={units} />}
        {waterSources.length > 0 ? <WaterSourceBars sources={waterSources} /> : <div className="resource-water-empty"><Droplets size={19} /><div><strong>水源数据</strong><p>当前没有绑定事件水源。完成一次水源查询后，候选点和直线距离会显示在这里。</p></div></div>}
      </section>

      <section className={`resource-platform-frame${platformFocused ? ' is-focused' : ''}`} aria-label="八维通救援力量平台">
        <div className="resource-platform-frame__head">
          <div><span>EXTERNAL PLATFORM</span><strong>八维通 · 救援力量平台</strong></div>
          <div className="resource-platform-frame__tools">
            <span><MapPin size={13} />辖区登记与详情</span>
            <button type="button" className="ops-icon-button" onClick={() => setPlatformFocused((current) => !current)} aria-label={platformFocused ? '退出专注查看' : '全屏查看力量平台'} title={platformFocused ? '退出专注查看（Esc）' : '全屏查看力量平台'}>
              {platformFocused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>
        {loading && <div className="resource-platform-frame__loading"><LoaderCircle size={21} className="spin" /><span>正在连接力量平台…</span></div>}
        {error && <div className="resource-platform-frame__error"><AlertCircle size={19} /><div><strong>力量平台暂时不可用</strong><p>{error}</p><button type="button" className="ops-text-button" onClick={() => void load()}>重试同步</button></div></div>}
        {!loading && !error && payload?.ok && <iframe title="八维通救援力量平台" src={payload.platformUrl} loading="eager" />}
      </section>
    </main>
  );
}
