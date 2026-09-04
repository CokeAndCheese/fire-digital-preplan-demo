'use client';

import { Box, ExternalLink, FileText, Layers, MessageSquareText, Play } from 'lucide-react';
import { useState } from 'react';
import type { SkillId } from '@/lib/skills/types';
import { AgentThread } from './AgentThread';
import { ExecutionMonitor, planFromRun, type LiveExecutionRun } from './ExecutionMonitor';
import { ChatMetricsBar } from './ChatMetricsBar';
import { AuditTicker, SimulationStepGrid, SkillDurationSeries } from './DashboardCharts';

import { PlanSummaryPanel } from './PlanSummaryPanel';
import { ZoneDeployDrivePanel } from './ZoneDeployDrivePanel';
import { SimulationDrivePanel } from './SimulationDrivePanel';
import type { ManualReviewDecision } from './ManualReviewActions';

const SCENE_ID = '477747327523254272';
type ContextView = 'chat' | 'plan' | 'simulation' | 'zone';

export function UnifiedOperationsWorkspace({
  run,
  selectedResources,
  onManualReview,
  reviewDisabled,
  offlineSkillIds,
}: {
  run: LiveExecutionRun | null;
  selectedResources: import('@/lib/skills/fire-resource-platform').FireResourcePlatformUnit[];
  onManualReview: (decision: ManualReviewDecision) => void | Promise<void>;
  reviewDisabled: boolean;
  offlineSkillIds: readonly SkillId[];
}) {
  const sceneBase = process.env.NEXT_PUBLIC_SCENE_URL || 'http://localhost:3000';
  const sceneUrl = `${sceneBase.replace(/\/$/, '')}/?sceneId=${SCENE_ID}&embed=1`;
  const plan = planFromRun(run);
  const [contextView, setContextView] = useState<ContextView>('chat');

  return (
    <div className="operations-workspace" aria-label="消防指挥事件指挥台">
      <section className="command-stage" aria-labelledby="scene-panel-title">
        <header className="command-stage__header">
          <div>
            <span className="command-kicker">INCIDENT COMMAND / 01</span>
            <h2 id="scene-panel-title">五矿国际广场 · 现场态势</h2>
          </div>
          <div className="command-stage__status"><span aria-hidden />{run ? (run.status === 'done' ? '闭环完成' : run.status === 'waiting' ? '待指挥员确认' : '实时编排中') : '等待接警'}</div>
          <a className="ops-icon-button" href={sceneUrl} target="_blank" rel="noreferrer" aria-label="在新窗口打开三维模型" title="新窗口打开"><ExternalLink size={14} /></a>
        </header>
        <div className="command-stage__scene">
          <div className="scene-frame"><iframe title="五矿国际广场真实三维模型" src={sceneUrl} loading="eager" /><div className="scene-frame__status"><span aria-hidden />三维场景 · 在线</div></div>
        </div>
        <div className="command-stage__monitor">
          <ChatMetricsBar plan={plan} run={run} />
          <div className="scene-panel__charts">
            {plan && <><SkillDurationSeries records={plan.orchestration} /><AuditTicker events={plan.auditEvents} /></>}
            {plan && plan.simulation.mappings.length > 0 && <SimulationStepGrid steps={plan.simulation.mappings} completedStepIds={plan.simulationVerification?.completedStepIds ?? []} failedStepIds={plan.simulationVerification?.failedStepIds ?? []} />}
          </div>
          <ExecutionMonitor run={run} onManualReview={onManualReview} reviewDisabled={reviewDisabled} />
        </div>
      </section>

      <aside className="command-context-panel" aria-label="事件上下文">
        <header className="command-context-tabs" aria-label="指挥上下文切换">
          <button type="button" className={contextView === 'chat' ? 'is-active' : ''} onClick={() => setContextView('chat')} aria-pressed={contextView === 'chat'}><MessageSquareText size={15} /><span>指挥对话</span></button>
          <button type="button" className={contextView === 'plan' ? 'is-active' : ''} onClick={() => setContextView('plan')} aria-pressed={contextView === 'plan'}><FileText size={15} /><span>预案详情</span>{plan && <b>{plan.review.status === 'approved' ? '已复核' : '待复核'}</b>}</button>
          <button type="button" className={contextView === 'simulation' ? 'is-active' : ''} onClick={() => setContextView('simulation')} aria-pressed={contextView === 'simulation'}><Play size={15} /><span>三维推演</span></button>
          <button type="button" className={contextView === 'zone' ? 'is-active' : ''} onClick={() => setContextView('zone')} aria-pressed={contextView === 'zone'}><Layers size={15} /><span>作战区域部署</span></button>
        </header>
        {contextView === 'chat' && (
          <main className="ops-panel ops-chat-panel" aria-labelledby="chat-panel-title">
            <header className="ops-panel__header"><div className="ops-panel__title"><span className="ops-panel__icon ops-panel__icon--red"><Box size={16} /></span><div><span>八维通远端编排</span><h2 id="chat-panel-title">指挥对话</h2></div></div><span className="chat-online-dot">在线</span></header>
            <div className="ops-chat-panel__body"><AgentThread offlineSkillIds={offlineSkillIds} /></div>
          </main>
        )}
        {contextView === 'plan' && (
          <div className="command-context-panel__plan"><PlanSummaryPanel run={run} selectedResources={selectedResources} /></div>
        )}
        {contextView === 'simulation' && (
          <div className="command-context-panel__sub"><SimulationDrivePanel plan={plan} /></div>
        )}
        {contextView === 'zone' && (
          <div className="command-context-panel__sub"><ZoneDeployDrivePanel fireObjectId={plan?.spatialTarget?.roomId ?? null} sceneId={SCENE_ID} /></div>
        )}
      </aside>
    </div>
  );
}
