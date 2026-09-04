'use client';

import { AlertCircle, Database, ExternalLink, MapPin, RefreshCw, ShieldCheck, Truck, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FireResourcePlatformUnit, ResourceAvailabilityStatus } from '@/lib/skills/fire-resource-platform';
import { clientPath } from '@/lib/client-path';
import { DistrictBars } from './DashboardCharts';

type ResourcesPayload = {
  ok: true;
  platformUrl: string;
  dataUrl: string;
  units: FireResourcePlatformUnit[];
  fetchedAt: string;
} | {
  ok: false;
  platformUrl: string;
  message: string;
};

function availabilityLabel(status: ResourceAvailabilityStatus) {
  if (status === 'verified') return '平台已核验';
  if (status === 'reported_unavailable') return '登记不可用';
  return '状态待核实';
}

function availabilityClass(status: ResourceAvailabilityStatus) {
  if (status === 'verified') return 'available';
  if (status === 'reported_unavailable') return 'unavailable';
  return 'unknown';
}

function timeLabel(value?: string) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function ResourcePlatformPanel({
  selectedIds,
  onSelectionChange,
}: {
  selectedIds: string[];
  onSelectionChange: (units: FireResourcePlatformUnit[]) => void;
}) {
  const [payload, setPayload] = useState<ResourcesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platformOpen, setPlatformOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(clientPath('/api/resources'), { cache: 'no-store' });
      const next = await response.json() as ResourcesPayload;
      if (!response.ok || !next.ok) throw new Error(!next.ok ? next.message : '救援力量平台返回异常。');
      setPayload(next);
    } catch (cause) {
      setPayload(null);
      setError(cause instanceof Error ? cause.message : '救援力量平台暂时不可用。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedUnits = useMemo(() => payload?.ok ? payload.units.filter((unit) => selectedIds.includes(unit.id)) : [], [payload, selectedIds]);
  const toggleUnit = (unit: FireResourcePlatformUnit) => {
    const next = selectedIds.includes(unit.id) ? selectedIds.filter((id) => id !== unit.id) : [...selectedIds, unit.id];
    const units = payload?.ok ? payload.units.filter((candidate) => next.includes(candidate.id)) : selectedUnits;
    onSelectionChange(units);
  };

  return (
    <section className="ops-panel resource-platform-panel" aria-labelledby="resource-panel-title">
      <header className="ops-panel__header">
        <div className="ops-panel__title"><span className="ops-panel__icon ops-panel__icon--teal"><ShieldCheck size={16} /></span><div><span>八维通数据源</span><h2 id="resource-panel-title">救援力量</h2></div></div>
        <div className="ops-panel__header-actions"><button type="button" className="ops-icon-button" onClick={() => void load()} disabled={loading} aria-label="刷新救援力量" title="刷新"><RefreshCw size={14} className={loading ? 'spin' : undefined} /></button><button type="button" className="ops-icon-button" onClick={() => setPlatformOpen(true)} aria-label="展开救援力量平台" title="展开平台"><ExternalLink size={14} /></button></div>
      </header>
      <div className="resource-platform-panel__meta"><span><Database size={12} />{payload?.ok ? `${payload.units.length} 条平台登记` : '平台登记'}</span><span>{payload?.ok ? `同步 ${timeLabel(payload.fetchedAt)}` : '等待同步'}</span></div>
      {loading && <div className="ops-empty ops-empty--compact"><RefreshCw size={17} className="spin" /><span>正在读取八维通力量平台…</span></div>}
      {!loading && error && <div className="ops-error"><AlertCircle size={17} /><div><strong>力量平台不可用</strong><p>{error}</p><button type="button" className="ops-text-button" onClick={() => void load()}>重试同步</button></div></div>}
      {!loading && !error && payload?.ok && <>
        <div className="resource-list resource-list--compact">
          {payload.units.slice(0, 12).map((unit) => <button type="button" key={unit.id} className={`resource-row${selectedIds.includes(unit.id) ? ' resource-row--selected' : ''}`} onClick={() => toggleUnit(unit)} aria-pressed={selectedIds.includes(unit.id)}>
            <span className={`resource-row__status resource-row__status--${availabilityClass(unit.availabilityStatus)}`} aria-hidden />
            <span className="resource-row__body"><strong>{unit.name}</strong><small><MapPin size={11} />{unit.address || '驻地待核实'}</small><small><Users size={11} />{unit.personnel || '人员待核实'} · <Truck size={11} />{unit.vehicles.length || 0} 辆车</small></span>
            <span className="resource-row__state">{availabilityLabel(unit.availabilityStatus)}</span>
          </button>)}
          {payload.units.length === 0 && <div className="ops-empty ops-empty--compact"><Database size={17} /><span>平台暂无可展示登记</span></div>}
        </div>
        {payload.units.length > 12 && <button type="button" className="ops-text-button resource-more" onClick={() => setPlatformOpen(true)}>展开全部 {payload.units.length} 条登记</button>}
        <DistrictBars units={payload.units} />
        <div className="resource-selection"><span>当前上下文</span><strong>{selectedUnits.length ? `已选择 ${selectedUnits.length} 个力量` : '未选择力量'}</strong><small>选择后会随下一条消息发送给八维通，不代表已调派。</small></div>
      </>}
      {platformOpen && <div className="platform-drawer-overlay"><button type="button" className="platform-drawer-scrim" onClick={() => setPlatformOpen(false)} aria-label="关闭救援力量平台" /><aside className="platform-drawer" role="dialog" aria-modal="true" aria-labelledby="platform-drawer-title"><header><div><span>外部平台</span><h2 id="platform-drawer-title">救援力量平台</h2></div><button type="button" className="ops-icon-button" onClick={() => setPlatformOpen(false)} aria-label="关闭平台"><X size={17} /></button></header><iframe title="八维通救援力量平台" src={payload?.ok ? payload.platformUrl : 'https://platform.sanya119.online/'} loading="eager" /></aside></div>}
    </section>
  );
}
