'use client';

import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import {
  ArrowDown,
  Bot,
  Building2,
  Check,
  CircleAlert,
  Clipboard,
  Clock3,
  FileText,
  Flame,
  Layers3,
  LoaderCircle,
  MapPin,
  RadioTower,
  Ruler,
  Scale,
  SendHorizontal,
  ShieldAlert,
  Square,
  Users,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import type { SkillId } from '@/lib/skills/types';
import { isUnifiedFireRescuePlan } from '@/lib/plan-contract';
import { clientPath } from '@/lib/client-path';

const QUICK_TASKS = [
  { skillId: 'rescue-plan', label: '生成结构化预案', prompt: '为五矿国际广场 8 层 808 房间电气火灾生成可人工复核的结构化预案 JSON。' },
  { skillId: 'response-level', label: '研判Ⅰ-Ⅴ级响应', prompt: '研判五矿国际广场 8 层电气火灾的Ⅰ-Ⅴ级响应建议，被困2人，过火面积35平方米。' },
  { skillId: 'fire-resource', label: '匹配救援力量', prompt: '为三亚市吉阳区高层公共建筑火灾查询附近消防力量，并基于核实数据形成力量匹配建议。' },
] as const;

function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="message-markdown" />;
}

function ReasoningPart({ text, status }: ReasoningMessagePartProps) {
  // 编排过程已在实时作战过程面板展示，不在对话区重复输出。
  void text;
  void status;
  return null;
  const running = status?.type === 'running';
  return (
    <details className="reasoning" open={running}>
      <summary>
        {running ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
        {running ? '正在分析与选择 Skill' : '查看编排过程'}
      </summary>
      <p>{text}</p>
    </details>
  );
}

function pretty(value: unknown) {
  if (value === undefined) return '';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

type JsonRecord = Record<string, unknown>;

const INPUT_LABELS: Record<string, string> = {
  address: '事发地址',
  assessmentId: '等级研判编号',
  building: '建筑名称',
  burnArea: '过火面积',
  fireType: '火灾类型',
  floor: '楼层',
  level: '灾情等级',
  mode: '场景视图',
  planId: '预案编号',
  radiusKm: '查询半径',
  reviewer: '复核人',
  room: '房间 / 空间',
  sceneId: '场景编号',
  sceneType: '场所类型',
  trappedCount: '被困人数',
  unitId: '单位编号',
  verifiedUnitIds: '已核实单位',
};

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function parsePayload(value: unknown): JsonRecord | undefined {
  if (typeof value !== 'string') return asRecord(value);
  try { return asRecord(JSON.parse(value)); } catch { return undefined; }
}

function text(value: unknown, fallback = '未提供') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function summarizeRegisteredItems(value: unknown, fallback = '待核实') {
  const items = text(value, '').split(/[、，,]/).map((item) => item.trim()).filter(Boolean);
  if (!items.length) return fallback;
  const sample = items.slice(0, 2).join('、');
  return items.length > 2 ? `${sample}等 ${items.length} 项` : sample;
}

function displayValue(key: string, value: unknown) {
  if (key === 'trappedCount') return `${String(value)} 人`;
  if (key === 'burnArea') return `${String(value)} ㎡`;
  if (key === 'radiusKm') return `${String(value)} km`;
  if (Array.isArray(value)) return value.length ? value.join('、') : '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '未提供');
}

function InputVisualization({ payload }: { payload: JsonRecord }) {
  return (
    <section className="skill-visual skill-visual--input">
      <div className="skill-visual__heading"><Layers3 size={14} /><strong>已识别执行参数</strong></div>
      <div className="parameter-grid">
        {Object.entries(payload).map(([key, value]) => (
          <div key={key} className="parameter-item">
            <span>{INPUT_LABELS[key] || key}</span>
            <strong>{displayValue(key, value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlanVisualization({ payload }: { payload: JsonRecord }) {
  const skillData = asRecord(payload.data);
  const plan = skillData?.plan;
  if (!isUnifiedFireRescuePlan(plan)) return null;
  const deployments = plan.forceComposition.units;
  const mappings = plan.simulation.mappings;
  const strategies = Object.entries(plan.strategies);
  const locationLabel = [plan.building.name, plan.spatialTarget.floor, plan.spatialTarget.room].filter(Boolean).join(' · ');
  const lifecycleLabel = plan.lifecycleStatus === 'issued'
    ? '已签发'
    : plan.lifecycleStatus === 'approved'
      ? '已复核'
      : plan.lifecycleStatus === 'pending_manual_review'
        ? '待人工复核'
        : '草稿待复核';
  return (
    <section className="skill-visual skill-result skill-result--plan">
      <div className="result-hero">
        <span className="result-hero__icon"><FileText size={17} /></span>
        <div><span>统一预案契约</span><h4>{locationLabel || '位置待确认'}</h4><small>{plan.planId} · v{plan.version} · {plan.createdAt}</small></div>
        <b className="result-status">{lifecycleLabel}</b>
      </div>
      <div className="result-metrics">
        <span><Building2 size={14} /><b>{text(plan.building.name)}</b><small>建筑</small></span>
        <span><Layers3 size={14} /><b>{text(plan.spatialTarget.floor)}</b><small>楼层</small></span>
        {plan.spatialTarget.room && <span><MapPin size={14} /><b>{plan.spatialTarget.room}</b><small>空间</small></span>}
        <span><Flame size={14} /><b>{text(plan.event.fireType)}</b><small>火情</small></span>
        <span><Users size={14} /><b>{plan.incident.trappedCount ?? '待确认'}{plan.incident.trappedCount === null ? '' : ' 人'}</b><small>被困</small></span>
        <span><Scale size={14} /><b>{plan.responseLevel.recommendation ?? '待复核'}</b><small>响应建议</small></span>
      </div>
      <div className="result-section">
        <h5><Users size={14} />力量编成</h5>
        <div className="deployment-list">
          {deployments.map((deployment, index) => (
            <div key={`${deployment.name}-${index}`}>
              <span>{index + 1}</span><strong>{deployment.name}</strong><b>{deployment.personnel ?? '人员待核实'}</b><p>车辆 {summarizeRegisteredItems(deployment.vehicles)} · ETA 待人工核验</p>
            </div>
          ))}
          {!deployments.length && <p>未收到可核验的力量 Skill 回执。</p>}
        </div>
      </div>
      <div className="result-section result-strategy">
        <h5><ShieldAlert size={14} />处置策略</h5>
        <p>{strategies.map(([kind, strategy]) => strategy.content ? `${kind}：${strategy.content}` : `${kind}待 Skill 回执`).join('；')}</p>
        {plan.missingItems.length > 0 && <div>{plan.missingItems.map((item) => <span key={item}>{item}</span>)}</div>}
      </div>
      <div className="result-section">
        <h5><Clock3 size={14} />精简三维推演映射</h5>
        <ol className="result-timeline">
          {mappings.map((item) => (
            <li key={item.sequence}><b>步骤 {item.sequence}</b><span>{item.title}</span></li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SceneVisualization({ payload }: { payload: JsonRecord }) {
  const skillData = asRecord(payload.data);
  const visualization = asRecord(skillData?.visualization);
  const bridgeData = asRecord(visualization?.data) ?? asRecord(skillData?.data);
  const target = asRecord(visualization?.target) ?? asRecord(bridgeData?.target) ?? asRecord(skillData?.target);
  const incident = asRecord(visualization?.incident);
  const trappedCount = bridgeData?.trappedCount ?? incident?.trappedCount;
  const status = text(visualization?.status ?? skillData?.status);
  const highlighted = status === 'displayed' || bridgeData?.highlighted === true;
  if (!skillData || (!target && !visualization && !bridgeData)) return null;
  return (
    <section className="skill-visual skill-result skill-result--scene">
      <div className="result-hero">
        <span className="result-hero__icon"><MapPin size={17} /></span>
        <div><span>三维定位结果</span><h4>{target ? text(target.name ?? target.label) : '场景操作已执行'}</h4><small>{typeof trappedCount === 'number' ? `现场 ${trappedCount} 人` : '现场人数待补充'}{highlighted ? ' · 已高亮' : ''}</small></div>
        <b className={`result-status result-status--${status}`}>{status === 'displayed' || status === 'completed' ? '已完成' : status || '待执行'}</b>
      </div>
      <div className="scene-result-grid">
        {target && <div><span>{target.kind === 'space' ? '定位空间' : '所在楼层'}</span><strong>{text(target.floorName ?? target.label)}</strong></div>}
        {target && target.kind === 'space' && <div><span>对象编号</span><strong>{text(target.objectId)}</strong></div>}
        {bridgeData?.highlighted !== undefined && <div><span>风险高亮</span><strong>{highlighted ? '已高亮' : '未高亮'}</strong></div>}
        {bridgeData?.mode !== undefined && <div><span>当前视图</span><strong>{text(bridgeData.mode)}</strong></div>}
        {bridgeData?.simulationStarted !== undefined && <div><span>灾情推演</span><strong>{bridgeData.simulationStarted ? '已启动' : '未启动'}</strong></div>}
      </div>
    </section>
  );
}

function ResourceVisualization({ payload }: { payload: JsonRecord }) {
  const skillData = asRecord(payload.data);
  const source = asRecord(skillData?.source);
  const units = Array.isArray(skillData?.units) ? skillData.units.map(asRecord).filter(Boolean) as JsonRecord[] : [];
  if (payload.ok === false) {
    return (
      <section className="skill-visual skill-result skill-result--error">
        <div className="result-error"><CircleAlert size={18} /><div><strong>力量数据源不可用</strong><p>{text(payload.error, '未返回任何单位或联络数据')}</p></div></div>
      </section>
    );
  }
  if (!skillData) return null;
  const sourceName = text(source?.name, '力量数据源');
  const sourceTime = text(source?.fetchedAt, '');
  const queryScope = text(skillData.queryScope, '');
  const boundary = text(skillData.message, '');
  return (
    <section className="skill-visual skill-result skill-result--resource">
      <div className="result-hero"><span className="result-hero__icon"><RadioTower size={17} /></span><div><span>消防救援力量</span><h4>已返回 {units.length} 条登记力量</h4><small>{sourceTime ? `${sourceName} · ${sourceTime}` : sourceName}</small></div></div>
      <div className="resource-list">
        {units.map((unit, index) => {
          const distance = unit.distanceKm;
          const distanceText = typeof distance === 'number' ? `${distance} km` : '相关登记力量';
          const address = text(unit.address, '驻地待核实');
          const personnel = text(unit.personnel, '待核实').replace(/^人员/, '');
          const vehicles = summarizeRegisteredItems(unit.vehicles);
          return <div key={`${text(unit.id)}-${index}`}><strong>{text(unit.name, `救援单位 ${index + 1}`)}</strong><span>{distanceText}</span><p>{address} · 人员 {personnel}</p><p>车辆 {vehicles} · 电话 {text(unit.contact, '待核实')}</p></div>;
        })}
      </div>
      {(queryScope || boundary) && <p className="resource-boundary">{queryScope || boundary}</p>}
    </section>
  );
}

function LevelVisualization({ payload }: { payload: JsonRecord }) {
  const skillData = asRecord(payload.data);
  if (!skillData) return null;
  const evidence = Array.isArray(skillData.evidence) ? skillData.evidence.filter((item): item is string => typeof item === 'string') : [];
  const missingEvidence = Array.isArray(skillData.missingEvidence) ? skillData.missingEvidence.filter((item): item is string => typeof item === 'string') : [];
  return (
    <section className="skill-visual skill-result skill-result--level">
      <div className="result-hero">
        <span className="result-hero__icon"><Scale size={17} /></span>
        <div><span>Ⅰ-Ⅴ级判定结果</span><h4>{text(skillData.recommendedLevel, '待规则库计算')}</h4><small>{text(skillData.message, '等待等级证据')}</small></div>
        <b className="result-status">{skillData.reviewRequired ? '待人工复核' : '已研判'}</b>
      </div>
      {evidence.length > 0 && <div className="level-evidence"><span>命中依据</span>{evidence.map((item) => <p key={item}>{item}</p>)}</div>}
      {missingEvidence.length > 0 && <p className="level-missing">待补充：{missingEvidence.join('、')}</p>}
    </section>
  );
}

/**
 * 写回前先取当前 revision：卡片停留期间预案可能已被其它动作推进，
 * 直接用回执里的旧 revision 会稳定撞 409。
 */
async function bindWaterSourceRequest(planId: string, sourceId: string, action: 'primary' | 'backup' | 'plan' | 'reverify') {
  const current = await fetch(clientPath(`/api/plans/${encodeURIComponent(planId)}`), { cache: 'no-store' });
  if (!current.ok) throw new Error('读取预案当前版本失败，未写回。');
  const plan = asRecord(((await current.json()) as JsonRecord).plan);
  const revision = typeof plan?.revision === 'number' ? plan.revision : null;
  if (revision === null) throw new Error('预案版本号缺失，未写回。');
  // "加入预案"即把候选水源标为人工确认，但不指派主备；主备是另外两个动作。
  const role = action === 'plan' ? 'unassign' : action;
  const response = await fetch(clientPath(`/api/plans/${encodeURIComponent(planId)}/water-source`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceId, role, revision, actor: '值班指挥员' }),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || '水源写回失败。');
  return action === 'primary' ? '已设为主水源，并记为人工确认。'
    : action === 'backup' ? '已设为备用水源，并记为人工确认。'
    : action === 'reverify' ? '已标记需重新核验，核验时间已清空。'
    : '已确认加入预案候选，未指派主备。';
}

/** 需求书 §8.3.1 水源卡片的五个动作 */
const WATER_ACTIONS = [
  { key: 'locate', label: '三维定位' },
  { key: 'primary', label: '设为主水源' },
  { key: 'backup', label: '设为备用水源' },
  { key: 'plan', label: '加入预案' },
  { key: 'reverify', label: '重新核验' },
] as const;

type WaterActionKey = (typeof WATER_ACTIONS)[number]['key'];

function WaterSourceVisualization({ payload }: { payload: JsonRecord }) {
  const skillData = asRecord(payload.data);
  const context = asRecord(payload.waterQueryContext);
  const sources = Array.isArray(skillData?.sources)
    ? skillData.sources.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry))
    : [];
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  // 仅在对话水源查询（带 waterQueryContext）时渲染卡片；其它 route-water 动作走通用结果。
  if (!context) return <GenericResult payload={payload} />;
  if (payload.ok === false) {
    return (
      <section className="skill-visual skill-result skill-result--water">
        <div className="result-error"><CircleAlert size={18} /><div><strong>水源台账不可用</strong><p>{text(payload.error, '未返回水源记录')}</p></div></div>
      </section>
    );
  }
  const planId = typeof context.planId === 'string' ? context.planId : '';
  const origin = asRecord(context.origin);
  const runAction = async (action: WaterActionKey, source: JsonRecord) => {
    const sourceId = text(source.id, '');
    if (!sourceId || busy) return;
    if (action === 'locate') {
      setMessage(`已在对话中标注 ${text(source.code, sourceId)} 的坐标；三维定位需在三维视图页面执行。`);
      return;
    }
    if (!planId) {
      setMessage('当前会话没有关联预案，无法写回。请先生成结构化预案。');
      return;
    }
    setBusy(`${sourceId}:${action}`);
    setMessage('');
    try {
      setMessage(await bindWaterSourceRequest(planId, sourceId, action));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '写回失败。');
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="skill-visual skill-result skill-result--water">
      <div className="result-hero">
        <span className="result-hero__icon"><Ruler size={17} /></span>
        <div>
          <span>周边水源查询</span>
          <h4>命中 {sources.length} 条水源</h4>
          <small>{text(origin?.label, '检索起点未标注')} · 半径 {text(context.radiusKm, '3')} km · 直线距离</small>
        </div>
      </div>
      <div className="water-list">
        {sources.map((source, index) => (
          <div key={`${text(source.id, String(index))}`} className="water-card">
            <strong>{text(source.code, text(source.id, `水源 ${index + 1}`))}</strong>
            <span>{typeof source.distanceKm === 'number' ? `${source.distanceKm.toFixed(2)} km` : '距离未知'}</span>
            <p>{text(source.address, '地址未登记')}</p>
            <p>{text(source.usability) === 'available' ? '台账标注可用' : text(source.usability) === 'unavailable' ? '台账标注不可用' : '可用状态未登记'} · 类型/口径/压力未登记</p>
            <div className="water-actions">
              {WATER_ACTIONS.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => runAction(action.key, source)}
                  disabled={busy === `${text(source.id, '')}:${action.key}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {message && <p className="water-message">{message}</p>}
      <p className="resource-boundary">距离为直线距离，非路网距离；台账未登记水源类型、口径与压力，供水能力不可核算，取水前须现场确认。</p>
    </section>
  );
}

function GenericResult({ payload }: { payload: JsonRecord }) {
  return (
    <section className="skill-visual skill-result skill-result--generic">
      <div className="skill-visual__heading"><Check size={14} /><strong>执行结果</strong></div>
      <div className="parameter-grid">
        {Object.entries(payload).filter(([key]) => key !== 'data').map(([key, value]) => (
          <div key={key} className="parameter-item"><span>{key}</span><strong>{displayValue(key, value)}</strong></div>
        ))}
      </div>
    </section>
  );
}

function SkillResultVisualization({ toolName, result }: { toolName?: string; result: unknown }) {
  const payload = parsePayload(result);
  if (!payload) return null;
  if (toolName?.startsWith('route-water')) return <WaterSourceVisualization payload={payload} />;
  if (toolName?.startsWith('rescue-plan')) return <PlanVisualization payload={payload} />;
  if (toolName?.startsWith('scene-control')) return <SceneVisualization payload={payload} />;
  if (toolName?.startsWith('response-level')) return <LevelVisualization payload={payload} />;
  if (toolName?.startsWith('fire-resource')) return <ResourceVisualization payload={payload} />;
  return <GenericResult payload={payload} />;
}

function ToolCallCard({
  toolName,
  args,
  argsText,
  result,
  isError,
  approval,
  respondToApproval,
}: ToolCallMessagePartProps) {
  const waiting = Boolean(approval && approval.approved === undefined && !approval.resolution);
  // Tool arguments/results stay in the audit layer; the chat only exposes the approval decision.
  if (!waiting) return null;
  void toolName;
  void args;
  void argsText;
  void result;
  void isError;
  return (
    <section className="tool-call tool-call--approval">
      <header>
        <span className="tool-call__icon"><ShieldAlert size={14} /></span>
        <strong>需要指挥员复核</strong>
        <span className="tool-state tool-state--waiting">等待复核</span>
      </header>
      <div className="tool-approval">
        <div>
          <strong>业务动作已冻结</strong>
          <p>请在实时过程和审计详情中核对证据后决定是否继续。</p>
        </div>
        <button type="button" className="button button--ghost" onClick={() => respondToApproval({ approved: false })}>
          <X size={15} />拒绝
        </button>
        <button type="button" className="button button--approve" onClick={() => respondToApproval({ approved: true })}>
          <Check size={15} />复核通过执行
        </button>
      </div>
    </section>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message message--user">
      <div className="message__avatar"><UserRound size={16} /></div>
      <div className="message__content">
        <span className="message__author">指挥员</span>
        <div className="message__bubble"><MessagePrimitive.Parts components={{ Text: MarkdownText }} /></div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message message--assistant">
      <div className="message__avatar"><Bot size={17} /></div>
      <div className="message__content">
        <span className="message__author">消防指挥总控智能体</span>
        <div className="message__bubble">
          <MessagePrimitive.Parts
            components={{ Text: MarkdownText, Reasoning: ReasoningPart, tools: { Fallback: ToolCallCard } }}
          />
        </div>
        <ActionBarPrimitive.Root className="message__actions" hideWhenRunning>
          <ActionBarPrimitive.Copy className="icon-button" aria-label="复制回复" title="复制回复">
            <Clipboard size={14} />
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

function Welcome({ offlineSkillIds }: { offlineSkillIds: readonly SkillId[] }) {
  return (
    <ThreadPrimitive.Empty>
      <div className="welcome">
        <span className="welcome__eyebrow">当前工作区</span>
        <h2>今天需要处理什么任务？</h2>
        <p>输入火情或报警信息。主智能体会协同空间定位、等级判定和力量匹配，形成结构化预案并进入人工复核。</p>
        <div className="welcome__status-grid" aria-label="指挥台摘要">
          <div><span>当前工作区</span><strong>火情接警与研判</strong><small>等待新的指挥任务</small></div>
          <div><span>处置方式</span><strong>八维通远端编排</strong><small>结果返回后进入人工复核</small></div>
          <div><span>数据留痕</span><strong>全程记录</strong><small>调用、回执与复核可追溯</small></div>
        </div>
        <div className="quick-actions">
          {QUICK_TASKS.map((task) => {
            const unavailable = offlineSkillIds.includes(task.skillId);
            return (
              <ThreadPrimitive.Suggestion key={task.label} prompt={task.prompt} send className="quick-action" disabled={unavailable} title={unavailable ? '当前 Skill 数据源离线' : task.label}>
                <span>{task.label}</span><SendHorizontal size={15} />
              </ThreadPrimitive.Suggestion>
            );
          })}
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
}

function Composer() {
  return (
    <ThreadPrimitive.ViewportFooter className="composer-wrap">
      <ThreadPrimitive.ScrollToBottom className="scroll-bottom" aria-label="滚动到底部" title="滚动到底部">
        <ArrowDown size={16} />
      </ThreadPrimitive.ScrollToBottom>
      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input
          className="composer__input"
          placeholder="输入火情，例如：五矿国际广场 8 层电气火灾，2 人被困"
          submitMode="enter"
          aria-label="向消防指挥智能体发送消息"
        />
        <div className="composer__bottom">
          <span>执行动作会记录到审计日志</span>
          <span className="keyboard-hint">Shift + Enter 换行</span>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel className="send-button send-button--stop" aria-label="停止生成" title="停止生成">
              <Square size={14} fill="currentColor" />
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send className="send-button" aria-label="发送" title="发送">
              <SendHorizontal size={17} />
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
        </div>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.ViewportFooter>
  );
}

export function AgentThread({ offlineSkillIds = [] }: { offlineSkillIds?: readonly SkillId[] }) {
  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread__viewport">
        <Welcome offlineSkillIds={offlineSkillIds} />
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <Composer />
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
