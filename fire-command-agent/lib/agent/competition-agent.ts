import type { AgentApp } from './types';
import type { UnifiedFireRescuePlan } from '@/lib/plan-contract';

export const LOCAL_COMPETITION_AGENT_ID = 'sanya-fire-competition-orchestrator-local';
export const COMPETITION_AGENT_NAME = '三亚消防比赛闭环指挥智能体';

export type CompetitionRuntimeMode = 'remote' | 'offline_demo';

export function competitionRuntimeMode(): CompetitionRuntimeMode {
  return process.env.AGENT_RUNTIME_MODE?.trim() === 'offline_demo' ? 'offline_demo' : 'remote';
}

export function isOfflineDemoMode() {
  return competitionRuntimeMode() === 'offline_demo';
}

export function configuredCompetitionAgentId() {
  return (process.env.AGENT_COMPETITION_APP_ID || '').trim();
}

export function preferredAgentId() {
  return configuredCompetitionAgentId();
}

export function localCompetitionAgent(): AgentApp {
  return {
    app_id: LOCAL_COMPETITION_AGENT_ID,
    name: COMPETITION_AGENT_NAME,
    description: '本地比赛展示编排器；使用版本化演示数据，不代表八维通实时状态。',
    status: 'offline_demo',
  };
}

export function orderAgentApps<T extends { app_id?: unknown }>(apps: T[]) {
  const preferredId = preferredAgentId();
  return [...apps].sort((left, right) => {
    const leftPreferred = preferredId && left.app_id === preferredId ? 1 : 0;
    const rightPreferred = preferredId && right.app_id === preferredId ? 1 : 0;
    return rightPreferred - leftPreferred;
  });
}

export function resolveUpstreamAgentId(requestedAppId?: string) {
  const requested = requestedAppId?.trim();
  const configured = configuredCompetitionAgentId();
  if (!configured) throw new Error('未配置唯一比赛智能体 AGENT_COMPETITION_APP_ID。');
  if (requested && requested !== configured) {
    throw new Error('比赛运行时只能调用已固定的 AGENT_COMPETITION_APP_ID。');
  }
  return configured;
}

/** Upstream agent calls receive plan identity, never independently assembled plan fields. */
export function planContextForAgent(plan: UnifiedFireRescuePlan) {
  return {
    planId: plan.planId,
    planVersion: plan.version,
    incidentId: plan.event.incidentId,
    lifecycleStatus: plan.lifecycleStatus,
    evidenceReferenceIds: plan.evidenceRefs.map((reference) => reference.referenceId),
  };
}
