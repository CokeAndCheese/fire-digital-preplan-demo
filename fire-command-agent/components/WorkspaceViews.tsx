'use client';

import {
  Activity,
  ArrowRight,
  BookText,
  Box,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Command,
  Database,
  FileCheck2,
  FileText,
  GitBranch,
  Droplets,
  History,
  LoaderCircle,
  Map,
  Network,
  Play,
  RadioTower,
  RefreshCw,
  Scale,
  ShieldCheck,
  Siren,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { planFromRun, type LiveExecutionRun } from './ExecutionMonitor';
import { ManualReviewActions, type ManualReviewDecision } from './ManualReviewActions';
import { isUnifiedFireRescuePlan } from '@/lib/plan-contract';
import type { UnifiedFireRescuePlan } from '@/lib/plan-contract';
import type { SkillId, SkillRuntime } from '@/lib/skills/types';

export type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  status: 'running' | 'done' | 'waiting' | 'error';
  time: string;
};

type ActivityStatus = ActivityItem['status'];

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

const STATUS_LABELS: Record<ActivityStatus, string> = {
  running: '执行中',
  done: '已完成',
  waiting: '待复核',
  error: '异常',
};

const RUN_STATUS_LABELS: Record<LiveExecutionRun['status'], string> = {
  running: '执行中',
  done: '闭环完成',
  waiting: '结果待复核',
  error: '执行失败',
};

function StatusIcon({ status }: { status: ActivityStatus }) {
  if (status === 'running') return <LoaderCircle size={14} className="spin" />;
  if (status === 'done') return <CheckCircle2 size={14} />;
  if (status === 'waiting') return <ShieldCheck size={14} />;
  return <XCircle size={14} />;
}


export function TaskWorkspace({
  run,
  activities,
  skills,
  onOpenCommand,
  onManualReview,
  reviewDisabled = false,
}: {
  run: LiveExecutionRun | null;
  activities: ActivityItem[];
  skills: SkillRuntime[];
  onOpenCommand: () => void;
  onManualReview?: (decision: ManualReviewDecision) => void | Promise<void>;
  reviewDisabled?: boolean;
}) {
  const waiting = activities.filter((item) => item.status === 'waiting');
  const taskEvents = activities.filter((item) => item.id !== 'boot');
  const coreSkills = skills.filter((skill) => skill.role === 'core').sort((left, right) => left.order - right.order);
  const planEngine = skills.find((skill) => skill.id === 'rescue-plan');
  const sceneSkill = skills.find((skill) => skill.id === 'scene-control');
  const plan = planFromRun(run);
  const planReviewItems = plan ? [...plan.missingItems, ...plan.failedItems.map((item) => item.section)] : [];
  const planReviewPending = Boolean(plan && plan.review.status !== 'approved' && planReviewItems.length > 0);
  const planEvidenceBlocked = Boolean(plan && plan.review.status === 'approved' && planReviewItems.length > 0 && plan.issuance.status === 'blocked');
  const remoteReviewPending = Boolean(run && run.status === 'waiting' && !run.reviewHandled && (run.manualReview || run.partialFailure) && !run.awaitingApproval);
  const reviewQueue: ActivityItem[] = remoteReviewPending
    ? [{ id: `${run?.id}-remote-review`, title: '八维通远端草稿', detail: run?.currentDetail || '等待指挥员复核', status: 'waiting', time: '--:--:--' }, ...waiting]
    : waiting;
  const phaseStatus = (...ids: string[]) => {
    const statuses = ids.map((id) => run?.phases.find((phase) => phase.id === id)?.status).filter(Boolean);
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('waiting')) return 'waiting';
    if (statuses.includes('running')) return 'running';
    if (statuses.includes('done')) return 'done';
    return 'pending';
  };
  const closureStages = [
    { id: 'input', label: '火情输入', detail: '报警/人工录入', icon: Siren, status: phaseStatus('received') },
    { id: 'analysis', label: '主智能体研判', detail: '意图与要素解析', icon: Activity, status: phaseStatus('intent', 'parameters') },
    { id: 'skills', label: '三类 Skill 协同', detail: '空间/等级/力量', icon: Wrench, status: phaseStatus('skill', 'bridge', 'execute') },
    { id: 'plan', label: '结构化预案', detail: '汇总为 JSON', icon: Braces, status: plan ? plan.failedItems.length ? 'error' : 'done' : 'pending' },
    { id: 'review', label: '人工复核', detail: '证据与版本确认', icon: ShieldCheck, status: plan ? plan.review.status === 'approved' ? 'done' : 'waiting' : phaseStatus('approval') },
    { id: 'delivery', label: '推演与签发', detail: '精简三维 / Word', icon: FileCheck2, status: plan ? plan.issuance.status === 'issued' && plan.simulation.status === 'ready' ? 'done' : 'waiting' : 'pending' },
    { id: 'archive', label: '记录与指标', detail: '全链路归档', icon: Database, status: phaseStatus('complete') },
  ] as const;

  return (
    <main className="workspace-view" aria-labelledby="task-workspace-title">
      <header className="workspace-view__header">
        <div><span>CLOSED-LOOP OPERATIONS</span><h2 id="task-workspace-title">闭环任务中心</h2><p>从火情输入到三维推演、Word 签发和指标归档，全流程可见、可复核、可追溯。</p></div>
        <button type="button" className="workspace-primary" onClick={onOpenCommand}><Command size={15} />进入指挥台</button>
      </header>

      <div className="workspace-metrics closure-metrics" aria-label="闭环概览">
        <div><Siren size={17} /><span>火情入口</span><strong>{run ? '已接收' : '待命'}</strong></div>
        <div><Wrench size={17} /><span>基础 Skill</span><strong>{coreSkills.length}</strong></div>
        <div><ShieldCheck size={17} /><span>{planEvidenceBlocked ? '待补充证据' : '待人工复核'}</span><strong>{plan ? (planEvidenceBlocked ? planReviewItems.length : Math.max(planReviewPending ? planReviewItems.length : 0, remoteReviewPending ? 1 : 0)) : reviewQueue.length}</strong></div>
        <div><FileCheck2 size={17} /><span>交付通道</span><strong>2</strong></div>
      </div>

      <section className="closure-pipeline" aria-label="产品闭环流程">
        {closureStages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div key={stage.id} className={`closure-stage closure-stage--${stage.status}`}>
              <span className="closure-stage__number">{stage.status === 'done' ? <CheckCircle2 size={14} /> : index + 1}</span>
              <span className="closure-stage__icon"><Icon size={17} /></span>
              <span><strong>{stage.label}</strong><small>{stage.detail}</small></span>
              {index < closureStages.length - 1 && <ChevronRight className="closure-stage__arrow" size={15} />}
            </div>
          );
        })}
      </section>

      <section className="workspace-panel skill-collaboration-panel">
        <header className="workspace-panel__header"><div><span>CORE SKILL COLLABORATION</span><h3>三类基础研判能力</h3></div><span className="workspace-count">{coreSkills.length}</span></header>
        <div className="closure-skill-grid">
          {coreSkills.map((skill) => {
            const Icon = SKILL_ICONS[skill.id];
            return (
              <article key={skill.id}>
                <header><span><Icon size={17} /></span><div><strong>{skill.name}</strong><small>{skill.targetProject}</small></div><i className={`status-dot status-dot--${skill.status}`} title={skill.status} /></header>
                <div><span>输入</span><p>{skill.inputs.join(' · ')}</p></div>
                <footer><span>产出</span><strong>{skill.output}</strong></footer>
              </article>
            );
          })}
        </div>
      </section>

      <section className="delivery-lane" aria-label="闭环产物与交付通道">
        <div className="delivery-node"><span><Braces size={17} /></span><div><small>汇总产物</small><strong>结构化预案 JSON</strong><p>{planEngine?.status === 'online' ? '预案引擎已接入' : '等待预案引擎接入'}</p></div><b className={`workspace-status workspace-status--${planEngine?.status ?? 'standby'}`}>{planEngine?.status === 'online' ? '可生成' : '待接入'}</b></div>
        <ChevronRight size={16} />
        <div className="delivery-node"><span><ShieldCheck size={17} /></span><div><small>质量闸门</small><strong>{planEvidenceBlocked ? '补充力量证据' : '人工复核'}</strong><p>{planEvidenceBlocked ? '签发前补齐 Skill/MCP 回执' : '确认等级、力量与版本'}</p></div><b className={`workspace-status workspace-status--${planEvidenceBlocked || reviewQueue.length ? 'waiting' : 'standby'}`}>{planEvidenceBlocked ? `${planReviewItems.length} 项待补证` : reviewQueue.length ? `${reviewQueue.length} 项待复核` : '等待预案'}</b></div>
        <ChevronRight size={16} />
        <div className="delivery-branches">
          <div><Box size={16} /><span><strong>精简三维推演</strong><small>{sceneSkill?.status === 'online' ? 'uStudio 通道已接入' : '等待三维通道'}</small></span></div>
          <div><FileText size={16} /><span><strong>Word 导出与版本签发</strong><small>{planEngine?.status === 'online' ? '预案流程已接入' : '等待签发通道'}</small></span></div>
        </div>
        <ChevronRight size={16} />
        <div className="delivery-node delivery-node--archive"><span><Database size={17} /></span><div><small>闭环沉淀</small><strong>演示记录与指标</strong><p>任务、复核、回执和版本统一归档</p></div></div>
      </section>

      <div className="task-workspace-grid">
        <section className="workspace-panel current-task-panel">
          <header className="workspace-panel__header"><div><span>ACTIVE INCIDENT</span><h3>当前火情任务</h3></div>{run && <span className={`workspace-status workspace-status--${run.status}`}>{RUN_STATUS_LABELS[run.status]}</span>}</header>
          {run ? (
            <div className="current-task">
              <p className="current-task__name">{run.task}</p>
              <div className="current-task__progress"><span><b style={{ width: `${Math.max(2, run.progress)}%` }} /></span><strong>{run.status === 'done' ? '100%' : `${Math.round(run.progress)}%`}</strong></div>
              <div className="current-task__detail"><span>当前阶段</span><strong>{run.currentTitle}</strong><p>{run.currentDetail}</p></div>
              <div className="phase-grid">
                {run.phases.map((phase) => <span key={phase.id} className={`phase-chip phase-chip--${phase.status}`}>{phase.title}</span>)}
              </div>
              {remoteReviewPending && onManualReview && <ManualReviewActions onReview={onManualReview} disabled={reviewDisabled} compact />}
              <button type="button" className="workspace-secondary" onClick={onOpenCommand}>查看实时过程<ArrowRight size={14} /></button>
            </div>
          ) : (
            <div className="workspace-empty"><Siren size={26} /><strong>等待火情输入</strong><p>从指挥台录入报警或火情后，七段闭环状态会在这里同步更新。</p><button type="button" className="workspace-secondary" onClick={onOpenCommand}>录入火情<ArrowRight size={14} /></button></div>
          )}
        </section>

        <section className="workspace-panel approval-panel">
          <header className="workspace-panel__header"><div><span>HUMAN REVIEW</span><h3>人工复核队列</h3></div><span className="workspace-count">{reviewQueue.length}</span></header>
          <div className="compact-list">
            {reviewQueue.length ? reviewQueue.map((item) => (
              <button key={item.id} type="button" onClick={onOpenCommand}>
                <span className="compact-list__icon compact-list__icon--waiting"><ShieldCheck size={15} /></span>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <ArrowRight size={14} />
              </button>
            )) : <div className="workspace-empty workspace-empty--compact"><ShieldCheck size={23} /><strong>暂无待复核项</strong><p>等级结论、力量匹配和签发动作会进入此队列。</p></div>}
          </div>
        </section>
      </div>

      <section className="workspace-panel session-tasks">
        <header className="workspace-panel__header"><div><span>SESSION TASKS</span><h3>本次会话任务</h3></div><span className="workspace-count">{taskEvents.length}</span></header>
        <div className="task-table" role="table" aria-label="本次会话任务列表">
          {taskEvents.length ? taskEvents.map((item) => (
            <div key={`${item.id}-${item.time}`} className="task-table__row" role="row">
              <span className={`record-status record-status--${item.status}`}><StatusIcon status={item.status} />{STATUS_LABELS[item.status]}</span>
              <strong>{item.title}</strong><p>{item.detail}</p><time>{item.time}</time>
            </div>
          )) : <div className="workspace-empty workspace-empty--compact"><Clock3 size={23} /><strong>还没有任务记录</strong><p>任务开始后会自动形成会话级记录。</p></div>}
        </div>
      </section>
    </main>
  );
}

export function SkillWorkspace({
  skills,
  isRunning,
  onRefresh,
  onRun,
}: {
  skills: SkillRuntime[];
  isRunning: boolean;
  onRefresh: () => void;
  onRun: (skill: SkillRuntime, actionId: string, actionName: string) => void;
}) {
  const onlineCount = skills.filter((skill) => skill.status === 'online').length;
  const coreSkills = skills.filter((skill) => skill.role === 'core').sort((left, right) => left.order - right.order);
  const orchestrationSkills = skills.filter((skill) => skill.role === 'orchestration').sort((left, right) => left.order - right.order);
  const renderSkill = (skill: SkillRuntime) => {
    const Icon = SKILL_ICONS[skill.id];
    return (
      <article key={skill.id} className={`skill-registry-card skill-registry-card--${skill.role}`}>
        <header>
          <span className="skill-registry-card__icon"><Icon size={20} /></span>
          <div><span>{skill.packageName}</span><h3>{skill.name}</h3><p>{skill.targetProject}</p></div>
          <span className={`workspace-status workspace-status--${skill.status}`}>{skill.status === 'online' ? '在线' : skill.status === 'standby' ? '待接入' : '离线'}</span>
        </header>
        <p className="skill-registry-card__description">{skill.description}</p>
        <div className="skill-data-flow"><span><small>输入</small>{skill.inputs.join(' · ')}</span><ArrowRight size={13} /><span><small>产出</small>{skill.output}</span></div>
        <div className="skill-registry-card__meta"><span><Network size={13} />远端执行由八维通主智能体负责</span><span><Clock3 size={13} />{skill.latencyMs ? `${skill.latencyMs} ms` : '随主智能体调用'}</span></div>
        <div className="skill-action-table">
          {skill.actions.map((action) => (
            <div key={action.id}>
              <span><strong>{action.name}</strong><small>{action.description}</small></span>
              <span className={action.requiresApproval ? 'approval-tag' : 'direct-tag'}>{action.requiresApproval ? '需复核' : '直接执行'}</span>
              <button type="button" onClick={() => onRun(skill, action.id, action.name)} disabled={isRunning} title={`通过八维通主智能体执行${action.name}`} aria-label={`执行${action.name}`}><Play size={14} /></button>
            </div>
          ))}
        </div>
      </article>
    );
  };

  return (
    <main className="workspace-view" aria-labelledby="skill-workspace-title">
      <header className="workspace-view__header">
        <div><span>CLOSED-LOOP SKILL REGISTRY</span><h2 id="skill-workspace-title">Skill 中心</h2><p>空间定位、等级判定和力量匹配负责研判，结构化预案引擎负责汇总、复核和签发。</p></div>
        <button type="button" className="workspace-primary" onClick={onRefresh}><RefreshCw size={15} />刷新状态</button>
      </header>
      <div className="registry-summary">
        <span><Wrench size={15} />基础 Skill <strong>{coreSkills.length}</strong></span>
        <span><Braces size={15} />汇总引擎 <strong>{orchestrationSkills.length}</strong></span>
        <span><Network size={15} />真实在线 <strong>{onlineCount}</strong></span>
        <span><ShieldCheck size={15} />复核受控 <strong>{skills.flatMap((skill) => skill.actions).filter((action) => action.requiresApproval).length}</strong></span>
      </div>
      <section className="skill-registry-section">
        <header><div><span>FOUNDATION</span><h3>基础研判 Skill</h3></div><p>并行读取空间、规则和救援力量数据。</p></header>
        <div className="skill-registry-grid">{coreSkills.map(renderSkill)}</div>
      </section>
      <section className="skill-registry-section skill-registry-section--orchestration">
        <header><div><span>ORCHESTRATION</span><h3>汇总与交付能力</h3></div><p>将基础结果汇总为结构化预案并进入人工复核和版本签发。</p></header>
        <div className="skill-registry-grid skill-registry-grid--orchestration">{orchestrationSkills.map(renderSkill)}</div>
      </section>
    </main>
  );
}

export function RecordWorkspace({ activities }: { activities: ActivityItem[] }) {
  const [filter, setFilter] = useState<'all' | ActivityStatus>('all');
  const filtered = useMemo(() => filter === 'all' ? activities : activities.filter((item) => item.status === filter), [activities, filter]);
  const filters: Array<{ id: 'all' | ActivityStatus; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'running', label: '执行中' },
    { id: 'waiting', label: '待复核' },
    { id: 'done', label: '已完成' },
    { id: 'error', label: '异常' },
  ];

  return (
    <main className="workspace-view" aria-labelledby="record-workspace-title">
      <header className="workspace-view__header">
        <div><span>CLOSED-LOOP EVIDENCE</span><h2 id="record-workspace-title">演示记录与指标</h2><p>火情输入、Skill 调用、人工复核、推演与签发回执统一沉淀为闭环证据。</p></div>
        <span className="audit-enabled"><ShieldCheck size={15} />审计已启用</span>
      </header>
      <div className="record-toolbar" aria-label="记录筛选">
        {filters.map((item) => <button key={item.id} type="button" className={filter === item.id ? 'record-filter record-filter--active' : 'record-filter'} onClick={() => setFilter(item.id)} aria-pressed={filter === item.id}>{item.label}<span>{item.id === 'all' ? activities.length : activities.filter((activity) => activity.status === item.id).length}</span></button>)}
      </div>
      <section className="record-ledger">
        <header><span>状态</span><span>事件</span><span>详细信息</span><span>时间</span><span>追踪编号</span></header>
        <div>
          {filtered.length ? filtered.map((item) => (
            <article key={`${item.id}-${item.time}`}>
              <span className={`record-status record-status--${item.status}`}><StatusIcon status={item.status} />{STATUS_LABELS[item.status]}</span>
              <strong>{item.title}</strong><p>{item.detail}</p><time>{item.time}</time><code>{item.id}</code>
            </article>
          )) : <div className="workspace-empty"><History size={25} /><strong>此筛选条件下没有记录</strong><p>切换筛选条件可查看其他执行事件。</p></div>}
        </div>
      </section>
    </main>
  );
}
