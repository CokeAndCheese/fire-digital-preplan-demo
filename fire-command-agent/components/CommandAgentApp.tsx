'use client';

import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type RespondToToolApprovalOptions,
} from '@assistant-ui/react';
import {
  Activity,
  Bell,
  Bot,
  BookText,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Command,
  GitBranch,
  FileText,
  Gauge,
  History,
  LayoutDashboard,
  Droplets,
  LoaderCircle,
  Map,
  MapPinned,
  Menu,
  Network,
  Play,
  RadioTower,
  RefreshCw,
  Settings,
  ShieldCheck,
  Scale,
  Sparkles,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { ActionIcon, Alert, Badge, Select, Tooltip } from '@mantine/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ManualReviewDecision } from './ManualReviewActions';
import { applyExecutionEvent, createLiveExecution, planFromRun, type LiveExecutionRun } from './ExecutionMonitor';
import {
  RecordWorkspace,
  SkillWorkspace,
  TaskWorkspace,
  type ActivityItem,
} from './WorkspaceViews';
import { UnifiedOperationsWorkspace } from './UnifiedOperationsWorkspace';
import { ResourceWorkspace } from './ResourceWorkspace';
import { listAgentApps, streamAgentChat } from '@/lib/agent/client';
import { inferAction } from '@/lib/agent/infer-action';
import { applyStreamEvent, createAssistantMessage, createUserMessage, sanitizePublicText } from '@/lib/agent/message-reducer';
import { buildForwardedProps, latchPlanId } from '@/lib/agent/plan-latch';
import type { AgentMessage, AgentStreamEvent, ToolFeedback } from '@/lib/agent/types';
import type { SkillId, SkillRuntime } from '@/lib/skills/types';
import type { FireResourcePlatformUnit } from '@/lib/skills/fire-resource-platform';
import { isUnifiedFireRescuePlan } from '@/lib/plan-contract';
import { SCENARIO_REGISTRY } from '@/lib/scenario-registry';
import { clientPath } from '@/lib/client-path';

type WorkspaceView = 'command' | 'tasks' | 'skills' | 'resources' | 'records';

const NAV_ITEMS = [
  { id: 'command', label: '指挥台', description: '实时编排与对话', icon: LayoutDashboard },
  { id: 'tasks', label: '任务', description: '闭环流程与人工复核', icon: Command },
  { id: 'skills', label: 'Skill', description: '子项目能力中心', icon: Wrench },
  { id: 'resources', label: '力量', description: '辖区力量与水源平台', icon: MapPinned },
  { id: 'records', label: '记录', description: '演示记录与指标', icon: History },
] as const;

const SKILL_ICONS = {
  'scene-control': Box,
  'response-level': Scale,
  'route-water': Droplets,
  'plan-template': BookText,
  'rescue-plan': FileText,
  'fire-resource': RadioTower,
  'competition-orchestrator': GitBranch,
  'fire-zone-deploy': Map,
} satisfies Record<SkillId, typeof Box>;

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function randomId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function messageText(message: AppendMessage) {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function findApprovalPayload(messages: AgentMessage[], approvalId: string) {
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    const part = message.content.find((item) => item.type === 'tool-call' && item.approval?.id === approvalId);
    if (part?.type === 'tool-call') {
      return {
        toolName: part.toolName,
        args: part.argsText || (part.args ? JSON.stringify(part.args) : undefined),
      };
    }
  }
  return { toolName: 'unknown', args: undefined };
}

function markApproval(messages: AgentMessage[], approvalId: string, approved: boolean): AgentMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') return message;
    const content = message.content.map((part) => part.type === 'tool-call' && part.approval?.id === approvalId
      ? { ...part, approval: { ...part.approval, approved } }
      : part);
    return { ...message, content };
  });
}

export function CommandAgentApp() {
  const [skills, setSkills] = useState<SkillRuntime[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<SkillId>('scene-control');
  const [apps, setApps] = useState<Array<{ app_id: string; name: string; status?: string }>>([]);
  const [appId, setAppId] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'demo' | 'offline'>('connecting');
  const [activeAgent, setActiveAgent] = useState('等待任务');
  const [activities, setActivities] = useState<ActivityItem[]>([
    { id: 'boot', title: '总控台启动', detail: 'Skill 注册中心已初始化', status: 'done', time: '--:--:--' },
  ]);
  const [liveExecution, setLiveExecution] = useState<LiveExecutionRun | null>(null);
  const [selectedResources, setSelectedResources] = useState<FireResourcePlatformUnit[]>([]);
  const [notice, setNotice] = useState('');
  const [activeView, setActiveView] = useState<WorkspaceView>('command');
  const [mobilePanel, setMobilePanel] = useState<'navigation' | 'skills' | 'activity' | null>(null);
  const conversationIdRef = useRef(randomId('conversation'));
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  /** 最近一次结构化预案的编号，口径见 lib/agent/plan-latch.ts */
  const activePlanIdRef = useRef<string | null>(null);
  messagesRef.current = messages;
  activePlanIdRef.current = latchPlanId(activePlanIdRef.current, planFromRun(liveExecution)?.planId);

  useEffect(() => {
    setActivities((current) => current.map((item) => item.id === 'boot' && item.time === '--:--:--'
      ? { ...item, time: nowTime() }
      : item));
  }, []);

  const updateMessages = useCallback((updater: (current: AgentMessage[]) => AgentMessage[]) => {
    setMessages((current) => {
      const next = updater(current);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const addActivity = useCallback((item: Omit<ActivityItem, 'id' | 'time'> & { id?: string }) => {
    setActivities((current) => {
      const id = item.id || randomId('activity');
      const next = { ...item, id, time: nowTime() };
      const existing = current.findIndex((entry) => entry.id === id);
      if (existing < 0) return [next, ...current].slice(0, 20);
      return current.map((entry, index) => index === existing ? { ...entry, ...next } : entry);
    });
  }, []);

  const dispatchSceneLocate = useCallback(async (input: Record<string, unknown>) => {
    const activityId = randomId('scene-locate');
    addActivity({ id: activityId, title: '三维警情定位', detail: '正在向真实场景发送定位与高亮指令', status: 'running' });
    try {
      const response = await fetch(clientPath('/api/scene/locate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as {
        message?: string;
        visualization?: { status?: string; target?: { label?: string; name?: string; kind?: string }; incident?: { floor?: string; room?: string; trappedCount?: number } };
        data?: { highlighted?: boolean; target?: { floorName?: string; name?: string } };
      } | null;
      if (!response.ok) throw new Error(payload?.message || '三维模型定位失败。');
      const visualization = payload?.visualization;
      const bridgeTarget = visualization?.target;
      const legacyTarget = payload?.data?.target;
      const location = bridgeTarget?.label
        || [legacyTarget?.floorName, legacyTarget?.name && legacyTarget.name !== legacyTarget.floorName ? legacyTarget.name : undefined].filter(Boolean).join(' ');
      const displayed = visualization?.status === 'displayed' || payload?.data?.highlighted === true;
      addActivity({ id: activityId, title: '三维警情定位', detail: location ? `${displayed ? '已在模型中定位并高亮' : '定位指令已发送'} ${location}` : '已收到三维定位回执', status: displayed ? 'done' : 'waiting' });
    } catch (error) {
      addActivity({ id: activityId, title: '三维警情定位失败', detail: error instanceof Error ? error.message : '三维定位失败，已保留待复核状态', status: 'error' });
    }
  }, [addActivity]);

  const refreshSkills = useCallback(async () => {
    try {
      const response = await fetch(clientPath('/api/skills'), { cache: 'no-store' });
      if (!response.ok) throw new Error('Skill 状态加载失败');
      const payload = await response.json() as { skills: SkillRuntime[] };
      setSkills(payload.skills);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Skill 状态加载失败。');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshSkills();
    listAgentApps(controller.signal)
      .then((rows) => {
        setApps(rows);
        const preferred = rows[0];
        setAppId(preferred?.app_id ?? '');
        setConnection(preferred?.status === 'offline_demo' || preferred?.status === 'demo' ? 'demo' : preferred ? 'online' : 'offline');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setConnection('offline');
        setNotice(error instanceof Error ? error.message : '智能体服务连接失败。');
      });
    return () => controller.abort();
  }, [refreshSkills]);

  const applyEvent = useCallback((assistantId: string, event: AgentStreamEvent) => {
    if (event.type === 'conversation_id' && event.conversation_id) {
      conversationIdRef.current = event.conversation_id;
    }
    updateMessages((current) => current.map((message) => message.id === assistantId
      ? applyStreamEvent(message, event)
      : message));
    setLiveExecution((current) => current ? applyExecutionEvent(current, event) : current);
    if (event.agent) setActiveAgent(event.agent);
    if (event.type === 'tool-call') {
      setActiveAgent(event.toolName || 'Skill 调度器');
      addActivity({ id: event.toolCallId, title: event.toolName || 'Skill 调用', detail: '已下发调用参数', status: 'running' });
    }
    if (event.type === 'tool-approval-request') {
      addActivity({ id: event.toolCallId, title: event.toolName || '待复核动作', detail: '等待指挥员复核', status: 'waiting' });
    }
    if (event.type === 'tool-result') {
      let failed = false;
      try { failed = Boolean(event.result && JSON.parse(event.result).ok === false); } catch { /* audit keeps malformed output */ }
      const activityStatus: ActivityItem['status'] = failed && event.scope !== 'tool' ? 'error' : failed ? 'waiting' : 'done';
      setActivities((current) => {
        const target = event.toolCallId
          ? current.findIndex((item) => item.id === event.toolCallId)
          : current.findIndex((item) => item.status === 'running' && item.id !== 'boot' && item.title !== '接收指挥任务');
        if (target < 0) return current;
        return current.map((item, index) => index === target
          ? { ...item, detail: failed ? (event.scope === 'tool' ? '子工具失败，主智能体继续；详情已记录到审计' : '执行失败，详情已记录到审计') : '已收到执行回执', status: activityStatus, time: nowTime() }
          : item);
      });
    }
    if (event.type === 'error') {
      const recoverable = event.terminal === false || event.scope === 'tool';
      const title = recoverable ? '工具失败，主智能体继续' : /平台不可用|数据源.*离线/i.test(event.content || '') ? '平台不可用' : '任务执行失败';
      const detail = recoverable ? '子工具失败已保留在审计，主智能体继续生成结论' : sanitizePublicText(event.content) || '失败状态已保留，详情已记录到审计';
      const activityStatus: ActivityItem['status'] = recoverable ? 'waiting' : 'error';
      setActivities((current) => {
        const target = event.toolCallId
          ? current.findIndex((item) => item.id === event.toolCallId)
          : recoverable
            ? current.findIndex((item) => item.status === 'running' && item.id !== 'boot' && item.title !== '接收指挥任务')
            : current.findIndex((item) => item.status === 'running' && item.id !== 'boot');
        if (target >= 0) {
          return current.map((item, index) => index === target
            ? { ...item, title, detail, status: activityStatus, time: nowTime() }
            : item);
        }
        const id = event.toolCallId || randomId('activity');
        return [{ id, title, detail, status: activityStatus, time: nowTime() }, ...current].slice(0, 20);
      });
    }
  }, [addActivity, updateMessages]);

  const runAgent = useCallback(async ({ content, feedbacks }: { content?: string; feedbacks?: ToolFeedback[] }) => {
    const action = content ? inferAction(content, SCENARIO_REGISTRY.sceneId) : null;
    // In remote mode the local catalog is only a presentation/diagnostic map.
    // Its bridge health must not prevent the published uStudio agent from
    // receiving the user's task.
    const unavailableSkill = connection !== 'online' && action
      ? skills.find((skill) => skill.id === action.skillId && skill.status === 'offline')
      : undefined;
    if (unavailableSkill) {
      const detail = `${unavailableSkill.shortName} Skill 数据源离线，未向子项目下发指令。`;
      const assistant = applyStreamEvent(
        applyStreamEvent(createAssistantMessage(), { type: 'text', content: detail, agent: 'Skill 注册中心' }),
        { type: 'finish' },
      );
      updateMessages((current) => [...current, assistant]);
      setLiveExecution((current) => current ? applyExecutionEvent(current, { type: 'error', content: detail }) : current);
      setNotice(detail);
      addActivity({ title: `${unavailableSkill.shortName} 调用已拦截`, detail, status: 'error' });
      return;
    }
    if (!appId) {
      const detail = '主智能体尚未就绪，请等待连接完成后再发送任务。';
      const assistant = applyStreamEvent(
        applyStreamEvent(createAssistantMessage(), { type: 'text', content: detail, agent: '连接管理器' }),
        { type: 'finish' },
      );
      updateMessages((current) => [...current, assistant]);
      setLiveExecution((current) => current ? applyExecutionEvent(current, { type: 'error', content: detail }) : current);
      setNotice(detail);
      return;
    }
    const assistant = createAssistantMessage();
    updateMessages((current) => [...current, assistant]);
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setNotice('');
    setActiveAgent('消防指挥总控智能体');
    let awaitingApproval = false;
    let manualReview = false;
    const activePlanId = activePlanIdRef.current;
    try {
      await streamAgentChat({
        appId,
        conversationId: conversationIdRef.current,
        content,
        sceneId: SCENARIO_REGISTRY.sceneId,
        toolFeedbacks: feedbacks,
        // planId 带上当前面板正在看的预案：对话里的水源查询要绑到这一份，
        // 否则服务端只能回退取"最新落库"的那份，多预案并存时会答错对象。
        forwardedProps: buildForwardedProps(activePlanId),
        passthroughProps: {
          registered_skills: skills.map((skill) => skill.id),
          selected_resources: selectedResources.map((unit) => ({ id: unit.id, name: unit.name, availabilityStatus: unit.availabilityStatus, sourceRecordId: unit.sourceRecordId })),
        },
      }, (event) => {
        if (event.type === 'tool-approval-request') awaitingApproval = true;
        if (event.type === 'text' && /待人工复核|待核实|空间取证失败|未签发|未启动三维|等待指挥员复核/i.test(event.content || '')) manualReview = true;
        applyEvent(assistant.id, event);
      }, controller.signal);
      setConnection((current) => current === 'demo' ? 'demo' : 'online');
      setLiveExecution((current) => current ? applyExecutionEvent(current, { type: 'finish' }) : current);
      updateMessages((current) => current.map((message) => message.id === assistant.id && message.status?.type === 'running'
        ? applyStreamEvent(message, { type: 'finish' })
        : message));
    } catch (error) {
      if (!controller.signal.aborted) {
        const text = sanitizePublicText(error instanceof Error ? error.message : '') || '本次操作未完成，失败状态已保留，请查看实时过程并进行人工复核。';
        setConnection('offline');
        setNotice(text);
        applyEvent(assistant.id, { type: 'error', content: text });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsRunning(false);
      setActiveAgent(awaitingApproval || manualReview ? '等待指挥员复核' : '等待任务');
      void refreshSkills();
    }
  }, [addActivity, appId, applyEvent, connection, refreshSkills, selectedResources, skills, updateMessages]);

  const handleNewMessage = useCallback(async (message: AppendMessage) => {
    const text = messageText(message);
    if (!text) return;
    // Start the real scene preflight immediately, even when the same intake
    // also launches the structured plan workflow.
    const locationAction = inferAction(`[skill:scene-control action:locate_space] ${text}`, SCENARIO_REGISTRY.sceneId);
    if (locationAction?.skillId === 'scene-control' && locationAction.actionId === 'locate_space') {
      void dispatchSceneLocate(locationAction.input ?? {});
    }
    setLiveExecution(createLiveExecution(text));
    updateMessages((current) => [...current, createUserMessage(text)]);
    addActivity({ title: '接收指挥任务', detail: text.slice(0, 42), status: 'running' });
    await runAgent({ content: text });
  }, [addActivity, dispatchSceneLocate, runAgent, updateMessages]);

  const handleApproval = useCallback(async ({ approvalId, approved, reason }: RespondToToolApprovalOptions) => {
    const payload = findApprovalPayload(messagesRef.current, approvalId);
    updateMessages((current) => markApproval(current, approvalId, approved));
    setActivities((current) => current.map((item) => item.id === approvalId
      ? { ...item, detail: approved ? '指挥员已复核通过，正在执行' : '指挥员已拒绝', status: approved ? 'running' : 'error', time: nowTime() }
      : item));
    setLiveExecution((current) => current ? applyExecutionEvent(current, {
      type: 'progress',
      phase: 'approval',
      title: '人工复核',
      description: approved ? '指挥员已复核通过，正在继续执行' : '指挥员已拒绝本次操作',
      progress: 55,
      status: approved ? 'done' : 'error',
    }) : current);
    await runAgent({
      feedbacks: [{
        toolCallId: approvalId,
        toolName: payload.toolName,
        args: payload.args,
        result: approved ? 'APPROVED' : 'REJECTED',
        description: reason,
      }],
    });
  }, [runAgent, updateMessages]);

  const handleManualReview = useCallback(async ({ decision, reason, source = 'human' }: ManualReviewDecision) => {
    const currentRun = liveExecution;
    if (!currentRun) return;
    const candidatePlan = currentRun.output?.data && typeof currentRun.output.data === 'object' && !Array.isArray(currentRun.output.data)
      ? (currentRun.output.data as Record<string, unknown>).plan
      : undefined;
    const plan = isUnifiedFireRescuePlan(candidatePlan) ? candidatePlan : null;
    const timedOut = source === 'timeout';
    const feedbackText = decision === 'approve'
      ? timedOut
        ? '人工复核7秒内未收到操作，按超时策略自动进入下一步。请继续处理上一轮任务，并在完成后返回明确的处理结果。'
        : '复核通过。请继续处理上一轮任务，并在完成后返回明确的处理结果。'
      : `复核退回。请根据补充意见更新上一轮任务，并继续保留未核实项${reason ? `。补充意见：${reason}` : '。'}。`;
    const activityId = `manual-review-${currentRun.id}`;
    addActivity({
      id: activityId,
      title: decision === 'approve'
        ? timedOut ? '7秒无响应，系统自动继续' : '复核通过，已请求八维通继续'
        : '已退回八维通补充信息',
      detail: timedOut ? '未收到人工操作，按超时策略进入下一步' : reason ? reason.slice(0, 80) : '复核反馈已发送，等待远端返回更新结果',
      status: 'running',
    });
    setLiveExecution((current) => current ? {
      ...current,
      status: 'running',
      progress: Math.max(55, Math.min(current.progress, 72)),
      currentTitle: decision === 'approve'
        ? timedOut ? '复核超时，系统自动继续' : '复核已通过，八维通继续处理'
        : '已退回补充信息，等待八维通更新',
      currentDetail: reason || '复核反馈已发送到八维通当前会话',
      manualReview: decision === 'return',
      reviewHandled: decision === 'approve',
      partialFailure: decision === 'approve' ? false : current.partialFailure,
      awaitingApproval: false,
      finishedAt: undefined,
      phases: current.phases.map((phase) => phase.id === 'approval'
        ? { ...phase, status: decision === 'approve' ? 'done' : 'waiting', detail: decision === 'approve' ? '指挥员已复核通过' : '等待补充信息后再次复核' }
        : phase),
    } : current);
    if (decision === 'approve') {
      const reviewActivityIds = new Set(currentRun.audit
        .filter((record) => record.status === 'waiting')
        .map((record) => record.callId));
      if (reviewActivityIds.size > 0) {
        setActivities((current) => current.map((item) => reviewActivityIds.has(item.id)
          ? { ...item, status: 'done', detail: '指挥员已复核通过，继续执行', time: nowTime() }
          : item));
      }
    }
    updateMessages((current) => [...current, createUserMessage(feedbackText)]);
    try {
      const workflowFeedback: ToolFeedback | undefined = plan
        ? {
            toolCallId: `${currentRun.id}-review`,
            toolName: 'competition-orchestrator.run_approved_demo',
            args: JSON.stringify({ planId: plan.planId, incidentId: plan.event.incidentId, reviewer: '值班指挥员' }),
            result: decision === 'approve' ? 'APPROVED' : 'REJECTED',
            description: reason,
          }
        : undefined;
      await runAgent({ content: feedbackText, feedbacks: workflowFeedback ? [workflowFeedback] : undefined });
      setActivities((current) => current.map((item) => item.id === activityId
        ? { ...item, detail: '复核反馈已发送，远端结果已回到当前会话', status: 'done', time: nowTime() }
        : item));
    } catch {
      setActivities((current) => current.map((item) => item.id === activityId
        ? { ...item, detail: '复核反馈发送失败，请查看提示后重试', status: 'error', time: nowTime() }
        : item));
    }
  }, [addActivity, liveExecution, runAgent, updateMessages]);

  const runtime = useExternalStoreRuntime<AgentMessage>({
    messages,
    setMessages: (next) => {
      const typed = [...next] as AgentMessage[];
      messagesRef.current = typed;
      setMessages(typed);
    },
    isRunning,
    isSendDisabled: !appId,
    onNew: handleNewMessage,
    onCancel: async () => {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsRunning(false);
      setLiveExecution((current) => current ? {
        ...current,
        status: 'error',
        currentTitle: '任务已停止',
        currentDetail: '指挥员主动终止本次执行',
        finishedAt: Date.now(),
      } : current);
      addActivity({ title: '任务已停止', detail: '指挥员主动终止本次运行', status: 'error' });
    },
    onRespondToToolApproval: handleApproval,
    convertMessage: (message) => message,
  });

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
  const coreSkills = skills.filter((skill) => skill.role === 'core');
  const displayedActivities = useMemo(() => {
    if (!liveExecution || liveExecution.status === 'running') return activities;
    const runStatus: ActivityItem['status'] = liveExecution.status === 'done'
      ? 'done'
      : liveExecution.status === 'waiting'
        ? 'waiting'
        : 'error';
    let taskUpdated = false;
    return activities.map((item) => {
      if (!taskUpdated && item.title === '接收指挥任务') {
        taskUpdated = true;
        return {
          ...item,
          status: runStatus,
          detail: liveExecution.status === 'done' ? item.detail : liveExecution.currentDetail,
        };
      }
      return item;
    });
  }, [activities, liveExecution]);
  const manualReviewPending = Boolean(liveExecution?.status === 'waiting' && !liveExecution.reviewHandled && (liveExecution.manualReview || liveExecution.partialFailure));
  const pendingCount = displayedActivities.filter((item) => item.status === 'waiting').length + (manualReviewPending ? 1 : 0);
  const onlineCount = skills.filter((skill) => skill.status === 'online').length;
  const skillStages = useMemo(() => {
    const phase = (id: string) => liveExecution?.phases.find((item) => item.id === id);
    const done = (...ids: string[]) => ids.some((id) => phase(id)?.status === 'done');
    const active = (...ids: string[]) => ids.some((id) => ['running', 'waiting'].includes(phase(id)?.status || ''));
    return [
      { label: '火情输入', active: active('received'), done: done('intent', 'parameters', 'skill') },
      { label: '智能研判', active: active('intent', 'parameters'), done: done('skill', 'approval', 'bridge') },
      { label: 'Skill 协同', active: active('skill', 'bridge', 'execute'), done: done('result', 'complete') },
      { label: '预案 JSON', active: active('result'), done: done('complete') && Boolean(liveExecution?.toolName?.startsWith('rescue-plan')) },
      { label: '人工复核', active: active('approval'), done: done('approval', 'execute', 'result', 'complete') },
      { label: '推演 / 签发', active: false, done: done('complete') && Boolean(liveExecution?.toolName && /start_simulation|publish_plan/.test(liveExecution.toolName)) },
      { label: '指标归档', active: active('complete'), done: done('complete') },
    ];
  }, [liveExecution]);

  const launchSkillAction = useCallback((skill: SkillRuntime, actionId: string, actionName: string) => {
    if (skill.status === 'offline' && connection !== 'online') {
      setNotice(`${skill.shortName} Skill 数据源离线，未向子项目下发指令。`);
      return;
    }
    const text = `请执行“${actionName}”。[skill:${skill.id} action:${actionId}]`;
    setLiveExecution(createLiveExecution(text));
    updateMessages((current) => [...current, createUserMessage(text)]);
    void runAgent({ content: text });
  }, [connection, runAgent, updateMessages]);

  const selectWorkspace = useCallback((view: WorkspaceView) => {
    setActiveView(view);
    setMobilePanel(null);
  }, []);

  const activeNavigation = NAV_ITEMS.find((item) => item.id === activeView) ?? NAV_ITEMS[0];

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="command-app">
        <aside className="rail" aria-label="主导航">
          <div className="rail__brand"><ShieldCheck size={23} /></div>
          <nav>
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className={activeView === id ? 'rail__button rail__button--active' : 'rail__button'} title={label} aria-label={label} aria-current={activeView === id ? 'page' : undefined} onClick={() => selectWorkspace(id)}>
                <Icon size={20} /><span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="rail__bottom">
            <button type="button" className="rail__button" title="设置暂未开放" aria-label="设置暂未开放" disabled><Settings size={20} /><span>设置</span></button>
            <div className="operator" title="当前用户：值班指挥员">指</div>
          </div>
        </aside>

        <aside className={`mobile-nav${mobilePanel === 'navigation' ? ' mobile-open' : ''}`} aria-label="移动端主导航" aria-hidden={mobilePanel !== 'navigation'}>
          <header><div className="rail__brand"><ShieldCheck size={23} /></div><div><strong>工作区</strong><span>选择要查看的板块</span></div><button type="button" className="mobile-close" onClick={() => setMobilePanel(null)} aria-label="关闭导航"><X size={17} /></button></header>
          <nav>
            {NAV_ITEMS.map(({ id, label, description, icon: Icon }) => (
              <button key={id} type="button" className={activeView === id ? 'mobile-nav__item mobile-nav__item--active' : 'mobile-nav__item'} onClick={() => selectWorkspace(id)} aria-current={activeView === id ? 'page' : undefined}>
                <span><Icon size={18} /></span><span><strong>{label}</strong><small>{description}</small></span>
              </button>
            ))}
          </nav>
        </aside>

        <div className={`workspace-shell workspace-shell--${activeView}`}>
          <header className="topbar">
            <button type="button" className="mobile-menu" onClick={() => setMobilePanel('navigation')} aria-label="打开主导航" aria-expanded={mobilePanel === 'navigation'}><Menu size={20} /></button>
            <div className="product-title">
              <h1>三亚消防指挥智能体</h1>
              <span>{activeNavigation.label} · {activeNavigation.description}</span>
            </div>
            <div className="topbar__center">
              <Badge className={`connection-pill connection-pill--${connection}`} variant="light" size="lg" leftSection={
                connection === 'connecting' ? <LoaderCircle size={13} className="spin" />
                  : connection === 'online' ? <Activity size={13} />
                    : connection === 'demo' ? <Gauge size={13} />
                      : <CircleAlert size={13} />
              } color={connection === 'online' ? 'green' : connection === 'demo' ? 'gray' : connection === 'connecting' ? 'yellow' : 'red'}>
                {connection === 'online' ? '八维通已连接' : connection === 'demo' ? '本地比赛展示' : connection === 'connecting' ? '正在连接' : '平台不可用'}
              </Badge>
              <span className="active-agent"><Sparkles size={13} />{activeAgent}</span>
            </div>
            <div className="topbar__actions">
              <Select
                className="agent-select"
                value={appId || null}
                onChange={(value) => setAppId(value ?? '')}
                data={apps.map((app) => ({ value: app.app_id, label: app.name }))}
                placeholder="选择主智能体"
                aria-label="选择主智能体"
                allowDeselect={false}
                comboboxProps={{ shadow: 'md' }}
              />
              <Tooltip label="查看待复核任务" withArrow>
                <ActionIcon className="notification-button" variant="subtle" color="gray" onClick={() => selectWorkspace('tasks')} aria-label="查看待复核任务">
                <Bell size={17} />{pendingCount > 0 && <span>{pendingCount}</span>}
                </ActionIcon>
              </Tooltip>
              <Tooltip label="打开执行记录" withArrow>
                <ActionIcon className="mobile-activity" variant="subtle" color="gray" onClick={() => selectWorkspace('records')} aria-label="打开执行记录"><History size={18} /></ActionIcon>
              </Tooltip>
            </div>
          </header>

          {activeView !== 'resources' && <section className="situational-bar" aria-label="当前指挥态势">
            <div className="situational-bar__posture">
              <span className="situational-bar__eyebrow">指挥台态势</span>
              <strong>{connection === 'online' ? '远端联机运行' : connection === 'demo' ? '演示数据运行' : connection === 'connecting' ? '等待平台连接' : '平台连接异常'}</strong>
            </div>
            <div className="situational-bar__metric">
              <span>活跃警报</span>
              <strong className={pendingCount > 0 ? 'situational-bar__value situational-bar__value--alert' : 'situational-bar__value'}>{pendingCount}</strong>
            </div>
            <div className="situational-bar__metric">
              <span>当前优先级</span>
              <strong className={liveExecution?.status === 'error' ? 'situational-bar__value situational-bar__value--alert' : 'situational-bar__value'}>{liveExecution ? liveExecution.currentTitle : '待接警'}</strong>
            </div>
            <div className="situational-bar__priority">
              <span>最高优先级</span>
              <strong>{liveExecution?.task || '尚未接收新的火情任务'}</strong>
            </div>
          </section>}

          {activeView !== 'resources' && <div className="stage-strip">
            <span className="stage-strip__label">当前流程</span>
            {skillStages.map((stage, index) => (
              <div key={stage.label} className={`stage${stage.active ? ' stage--active' : ''}${stage.done ? ' stage--done' : ''}`}>
                <span>{stage.done ? <Check size={13} /> : index + 1}</span>
                <strong>{stage.label}</strong>
              </div>
            ))}
            <span className="stage-strip__summary">{coreSkills.length} 个基础 Skill · {skills.length - coreSkills.length} 个汇总引擎 · {connection === 'demo' ? '版本化本地数据' : `${onlineCount} 个当前在线`}</span>
          </div>}

          {notice && <Alert className="global-notice" color="red" variant="light" icon={<CircleAlert size={16} />} withCloseButton onClose={() => setNotice('')} title="需要注意">{notice}</Alert>}

          {activeView === 'command' && <UnifiedOperationsWorkspace
            run={liveExecution}
            selectedResources={selectedResources}
            onManualReview={handleManualReview}
            reviewDisabled={isRunning}
            offlineSkillIds={connection === 'online' ? [] : skills.filter((skill) => skill.status === 'offline').map((skill) => skill.id)}
          />}

          {activeView === 'tasks' && <TaskWorkspace run={liveExecution} activities={displayedActivities} skills={skills} onOpenCommand={() => selectWorkspace('command')} onManualReview={handleManualReview} reviewDisabled={isRunning} />}
          {activeView === 'skills' && <SkillWorkspace skills={skills} isRunning={isRunning} onRefresh={() => void refreshSkills()} onRun={(skill, actionId, actionName) => { selectWorkspace('command'); launchSkillAction(skill, actionId, actionName); }} />}
          {activeView === 'resources' && <ResourceWorkspace run={liveExecution} />}
          {activeView === 'records' && <RecordWorkspace activities={displayedActivities} />}
        </div>
        {mobilePanel && <button type="button" className="mobile-backdrop" onClick={() => setMobilePanel(null)} aria-label="关闭面板" />}
      </div>
    </AssistantRuntimeProvider>
  );
}
