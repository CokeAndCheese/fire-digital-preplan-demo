import { NextResponse } from 'next/server';
import type { AgentChatRequest, AgentStreamEvent } from '@/lib/agent/types';
import { agentGatewayFetch, agentStreamTimeoutMs, proxyResponse } from '@/lib/agent/server';
import { findSkill, findSkillAction } from '@/lib/skills/catalog';
import { inferAction } from '@/lib/agent/infer-action';
import { executeSkill } from '@/lib/skills/server';
import type { SkillExecutionResult, SkillId } from '@/lib/skills/types';
import { isOfflineDemoMode, resolveUpstreamAgentId } from '@/lib/agent/competition-agent';
import { inspectCompetitionRuntimeBinding } from '@/lib/agent/runtime-binding';
import { planChatSummary } from '@/lib/plan-adapters';
import { isUnifiedFireRescuePlan, type PlanWaterSourceQuery, type UnifiedFireRescuePlan } from '@/lib/plan-contract';
import { normalizeRemoteFinalText, sanitizePublicText } from '@/lib/agent/message-reducer';
import { isWaterSourceQuestion, parseWaterQuery } from '@/lib/agent/water-query';
import { resolveWaterQueryOrigin } from '@/lib/agent/water-query-server';
import { getPlanRepository } from '@/lib/plan-persistence';
import { recordWaterSourceQuery } from '@/lib/plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventEmitter = (event: AgentStreamEvent) => void;
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asCount(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function conciseUnitLine(unit: Record<string, unknown>, index: number) {
  const name = asText(unit.name) || `登记队站 ${index + 1}`;
  const address = asText(unit.address)?.replace(/^海南省三亚市/, '') || '驻地待核实';
  const personnel = asText(unit.personnel)?.replace(/^人员/, '') || '待核实';
  const contact = asText(unit.contact) || '待核实';
  return `- **${name}**：${address}，人员 ${personnel}，电话 ${contact}`;
}

function userFacingReply(result: SkillExecutionResult) {
  if (!result.ok) {
    if (result.skillId === 'scene-control') return '三维模型连接正在恢复，请查看三维视图中的警情定位。';
    if (result.skillId === 'fire-resource') return '关联力量数据暂未返回，请稍后重新查询。';
    if (result.skillId === 'response-level') return '响应等级暂无法完成初判，请由指挥员复核。';
    return '本次操作未完成，请稍后重试。';
  }
  const plan = result.data?.plan;
  if (isUnifiedFireRescuePlan(plan)) {
    return planChatSummary(plan);
  }
  if (result.skillId === 'scene-control' && result.actionId === 'locate_space') {
    const visualization = asRecord(result.data?.visualization);
    const status = asText(visualization?.status ?? result.data?.status);
    if (status === 'queued') return '三维模型尚未返回执行结果，定位指令已保留，待模型页面连接后自动展示。';
    const data = asRecord(visualization?.data) ?? asRecord(result.data?.data);
    const target = asRecord(visualization?.target) ?? asRecord(data?.target) ?? asRecord(result.data?.target);
    const floor = asText(target?.floorName ?? (visualization?.incident && asRecord(visualization.incident)?.floor));
    const name = asText(target?.name ?? target?.label);
    const location = [floor, name && name !== floor ? name : undefined].filter(Boolean).join(' ');
    const incident = asRecord(visualization?.incident);
    const trappedCount = asCount(data?.trappedCount ?? incident?.trappedCount);
    if (location && status !== 'displayed') {
      return `已定位：${location}${trappedCount === undefined ? '。' : `；现场 ${trappedCount} 人。`}三维模型正在重连，请查看三维视图。`;
    }
    return location
      ? `已在三维模型定位并高亮：${location}${trappedCount === undefined ? '。' : `；现场 ${trappedCount} 人。`}`
      : '已向三维模型发送定位指令。';
  }
  if (result.skillId === 'response-level' && result.actionId === 'assess_response_level') {
    const status = asText(result.data?.assessmentStatus);
    if (status === 'pending_manual_review') {
      const missing = Array.isArray(result.data?.missingEvidence)
        ? result.data.missingEvidence.filter((item): item is string => typeof item === 'string')
        : [];
      const conflicts = Array.isArray(result.data?.conflictFields)
        ? result.data.conflictFields.filter((item): item is string => typeof item === 'string')
        : [];
      const details = [...missing.map((item) => `缺少${item}`), ...conflicts.map((item) => `${item}存在冲突`)];
      return `等级建议已停止在待人工复核状态${details.length ? `：${details.join('、')}。` : '。'}未生成等级，也不会自动重试。`;
    }
    const level = asText(result.data?.recommendedLevel) || '等级待规则计算';
    return `规则建议：${level}。该结果尚未签发，须由具备权限的指挥员复核。`;
  }
  if (result.skillId !== 'fire-resource') return result.summary;

  const units = Array.isArray(result.data?.units)
    ? result.data.units.map(asRecord).filter((unit): unit is Record<string, unknown> => Boolean(unit))
    : [];
  const names = units.map((unit) => asText(unit.name)).filter((name): name is string => Boolean(name));

  if (result.actionId === 'query_nearby_units') {
    const displayedUnits = units.slice(0, 5);
    return names.length
      ? `已查询到 ${units.length} 个登记队站，以下列出前 ${displayedUnits.length} 条：\n${displayedUnits.map(conciseUnitLine).join('\n')}`
      : '未查询到符合条件的登记队站。';
  }
  if (result.actionId === 'get_unit_contact') {
    const unit = units[0];
    const name = asText(unit?.name) || '该单位';
    const contact = asText(unit?.contact);
    return contact ? `${name}登记电话：${contact}。` : `${name}暂未登记联系电话。`;
  }
  if (result.actionId === 'dispatch_recommendation') {
    return names.length
      ? `已返回 ${names.length} 个已核实队站：${names.join('、')}。未自动生成调度编成。`
      : '未匹配到已核实队站，未生成调度编成。';
  }
  return result.summary;
}

function approvalReply(skillId: SkillId, actionId: string, input: Record<string, unknown>) {
  if (skillId === 'competition-orchestrator' && actionId === 'run_approved_demo') {
    return '将启动精简三维推演并展示已复核预案，请确认执行。';
  }
  if (skillId === 'scene-control' && actionId === 'locate_space') {
    const floor = asText(input.floor) || '目标楼层';
    const room = asText(input.room);
    const target = room ? `${floor} ${room}` : floor;
    return `已识别五矿国际广场 ${target} 电气火灾，将定位并高亮目标空间，请确认执行。`;
  }
  return '该操作会改变受控子项目状态，请确认后执行。';
}

function streamSse(run: (emit: EventEmitter) => Promise<void> | void) {
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: EventEmitter = (event) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      void Promise.resolve(run(emit))
      .catch((error) => {
        console.error('[agent-chat] local workflow failed', error);
        emit({
        type: 'error',
        scope: 'transport',
        terminal: true,
        content: '本次操作未完成，失败状态已保留，请查看实时过程并进行人工复核。',
        });
      })
        .finally(() => {
          if (closed) return;
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          closed = true;
        });
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function sse(events: AgentStreamEvent[]) {
  return streamSse((emit) => events.forEach(emit));
}

function streamWithDeadline(stream: ReadableStream<Uint8Array>, timeoutMs: number) {
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = stream.getReader();
      timer = setTimeout(() => {
        if (closed) return;
        closed = true;
        void reader?.cancel('Agent stream timed out.');
        const seconds = Math.round(timeoutMs / 1000);
        const event: AgentStreamEvent = {
          type: 'error',
          scope: 'transport',
          terminal: true,
          content: `八维通处理超过 ${seconds} 秒，已停止等待。未完成项已保留为待人工复核，可在工作台重新发起。`,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }, timeoutMs);

      void (async () => {
        try {
          while (!closed) {
            const { done, value } = reader
              ? await reader.read()
              : { done: true, value: undefined as Uint8Array | undefined };
            if (done) break;
            if (value && !closed) controller.enqueue(value);
          }
        } catch (error) {
          if (!closed) controller.error(error);
        } finally {
          if (!closed) {
            closed = true;
            if (timer) clearTimeout(timer);
            controller.close();
          }
        }
      })();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
      void reader?.cancel();
    },
  });
}

/**
 * Establish a real session with the published uStudio agent before running
 * the local, auditable bridge workflow.  The published app may continue
 * working on its own tools for a long time; the command console only needs a
 * receipt that the remote session accepted this incident.  We cancel the
 * remote stream after the first frame so a slow child MCP cannot block the
 * controlled scene/plan bridge or make the UI look disconnected.
 */
async function remoteSessionHandshake(input: AgentChatRequest): Promise<{ ok: true; conversationId?: string } | { ok: false; message: string }> {
  const body = {
    app_id: resolveUpstreamAgentId(input.appId),
    ...(input.conversationId?.trim() ? { conversation_id: input.conversationId.trim() } : {}),
    ...(input.content?.trim() ? { content: input.content.trim() } : {}),
    ...(input.toolFeedbacks?.length ? { tool_feedbacks: input.toolFeedbacks } : {}),
    forwarded_props: {
      ...asObject(input.forwardedProps),
      ...(input.sceneId?.trim() ? { scene_id: input.sceneId.trim() } : {}),
      source: 'independent-fire-command-agent',
    },
    passthrough_props: {
      ...asObject(input.passthroughProps),
      ...(input.sceneId?.trim() ? { scene_id: input.sceneId.trim() } : {}),
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const upstream = await agentGatewayFetch('api/agent/v1/apps/agent-chat', {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) return { ok: false, message: `八维通远端会话返回 ${upstream.status}。` };
    reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const data = block.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = asRecord(JSON.parse(data)) ?? {};
          const conversationId = asText(event.conversation_id) || asText(event.conversationId);
          return { ok: true, ...(conversationId ? { conversationId } : {}) };
        } catch {
          return { ok: true };
        }
      }
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? '八维通远端会话在 8 秒内未返回接收回执。'
      : `八维通远端会话连接失败：${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => undefined);
    controller.abort();
  }
}

async function forwardSseResponse(response: Response, emit: EventEmitter) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (data && data !== '[DONE]') {
          try { emit(JSON.parse(data) as AgentStreamEvent); } catch { /* omit malformed local frames */ }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function publicFailureMessage() {
  return '本次操作未完成，失败状态已保留，请查看实时过程并进行人工复核。';
}

function upstreamScope(record: Record<string, unknown>): AgentStreamEvent['scope'] {
  const scope = asText(record.scope) || asText(record.level) || asText(record.kind);
  return scope === 'tool' || scope === 'transport' || scope === 'task' ? scope : undefined;
}

function upstreamErrorText(record: Record<string, unknown>) {
  return sanitizePublicText(record.error ?? record.message ?? record.content ?? record.detail) || '子工具执行失败。';
}

function publicUpstreamEvent(value: unknown): AgentStreamEvent | null {
  const record = asRecord(value);
  if (!record) return null;
  const rawType = asText(record.type) || (typeof record.content === 'string' ? 'text' : 'unknown');
  const toolCallId = asText(record.toolCallId) || asText(record.tool_call_id);
  const toolName = asText(record.toolName) || asText(record.tool_name);
  const scope = upstreamScope(record);
  if (rawType === 'text' || rawType === 'message' || rawType === 'answer' || rawType === 'delta') {
    const content = sanitizePublicText(record.content ?? record.text ?? record.answer ?? record.message);
    return content ? { type: 'text', scope: 'task', terminal: false, content, agent: asText(record.agent) } : null;
  }
  if (rawType === 'reasoning' || rawType === 'thought') return { type: 'reasoning', scope: 'task', terminal: false, content: '正在分析任务并整理业务结论。' };
  if (rawType === 'error' || rawType === 'exception') {
    const toolScoped = scope === 'tool' || Boolean(toolName || toolCallId);
    if (toolScoped) {
      return {
        type: 'tool-result',
        scope: 'tool',
        terminal: false,
        toolCallId,
        toolName,
        result: JSON.stringify({ ok: false, error: upstreamErrorText(record) }),
      };
    }
    return { type: 'error', scope: scope === 'transport' ? 'transport' : 'task', terminal: true, content: publicFailureMessage() };
  }
  if (rawType === 'progress' || rawType === 'status') {
    const status = asText(record.status);
    return {
      type: 'progress',
      scope: scope || 'task',
      terminal: status === 'error' && scope !== 'tool',
      phase: asText(record.phase),
      title: sanitizePublicText(record.title) || '实时处理',
      description: sanitizePublicText(record.description ?? record.content) || '正在处理，请查看实时过程。',
      progress: typeof record.progress === 'number' ? record.progress : undefined,
      status: status === 'waiting' ? 'waiting' : status === 'error' ? 'error' : status === 'done' || status === 'success' ? 'done' : 'running',
    };
  }
  if (rawType === 'conversation_id' || rawType === 'conversation') {
    return { type: 'conversation_id', conversation_id: asText(record.conversation_id) || asText(record.conversationId) };
  }
  if (rawType === 'tool-call' || rawType === 'tool_call') {
    return { type: 'tool-call', scope: 'tool', terminal: false, toolCallId, toolName, args: typeof record.args === 'string' ? record.args : record.arguments ? JSON.stringify(record.arguments) : undefined };
  }
  if (rawType === 'tool-result' || rawType === 'tool_result') {
    return { type: 'tool-result', scope: 'tool', terminal: false, toolCallId, toolName, result: typeof record.result === 'string' ? record.result : JSON.stringify(record.result ?? record.output ?? {}) };
  }
  if (rawType === 'tool-approval-request' || rawType === 'tool_approval_request') {
    return { type: 'tool-approval-request', scope: 'tool', terminal: false, toolCallId, toolName, description: '该动作需要指挥员复核。' };
  }
  // uStudio can emit nested done/finish frames for child agents. The stream
  // terminator is the only authoritative run-level completion signal.
  if (rawType === 'finish' || rawType === 'done') return null;
  return null;
}

/** Normalize upstream SSE before it reaches the browser: public text is safe, raw tool data remains audit-only. */
function sanitizeAgentStream(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let buffer = '';
  let closed = false;
  let textBuffer = '';
  let finalEmitted = false;
  let lastToolFailure = false;
  const emitFinal = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (finalEmitted) return;
    finalEmitted = true;
    const finalText = normalizeRemoteFinalText(textBuffer);
    if (finalText) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', scope: 'task', terminal: false, content: finalText })}\n\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'finish', scope: 'task', terminal: true })}\n\n`));
  };
  const emitBlock = (controller: ReadableStreamDefaultController<Uint8Array>, block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      emitFinal(controller);
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      return;
    }
    try {
      const normalized = publicUpstreamEvent(JSON.parse(data));
      if (!normalized) return;
      if (normalized.type === 'tool-result') {
        try {
          const output = normalized.result ? JSON.parse(normalized.result) as Record<string, unknown> : undefined;
          lastToolFailure = output?.ok === false || output?.status === 'error' || output?.status === 'failed';
        } catch {
          lastToolFailure = false;
        }
      }
      if (normalized.type === 'error' && normalized.scope === 'task' && lastToolFailure) {
        normalized.scope = 'tool';
        normalized.terminal = false;
      }
      if (normalized.type === 'text') {
        textBuffer += normalized.content || '';
        return;
      }
      if (normalized.type === 'finish') return;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(normalized)}\n\n`));
    } catch {
      // Malformed upstream frames are deliberately omitted from customer-facing output.
    }
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = stream.getReader();
      void (async () => {
        try {
          while (!closed) {
            const { done, value } = await reader!.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              emitBlock(controller, buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf('\n\n');
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) emitBlock(controller, buffer);
          emitFinal(controller);
        } catch {
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', scope: 'transport', terminal: true, content: publicFailureMessage() })}\n\n`));
        } finally {
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      closed = true;
      void reader?.cancel();
    },
  });
}

function progress(
  emit: EventEmitter,
  phase: string,
  title: string,
  description: string,
  percent: number,
  status: AgentStreamEvent['status'] = 'running',
) {
  emit({ type: 'progress', phase, title, description, progress: percent, status });
}

async function executeWithVisibility(
  request: Parameters<typeof executeSkill>[0],
  emit: EventEmitter,
) {
  const skill = findSkill(request.skillId);
  const localOrchestration = request.skillId === 'rescue-plan' || request.skillId === 'competition-orchestrator';
  const usingBridge = Boolean(skill && (skill.id === 'fire-resource' || process.env[skill.endpointEnv]?.trim()));
  const usingResourcePlatform = skill?.id === 'fire-resource';
  const usingLocalRules = skill?.id === 'response-level' && request.actionId === 'assess_response_level';
  progress(
    emit,
    'bridge',
    usingResourcePlatform ? '读取力量平台' : usingLocalRules ? '规则初判' : localOrchestration ? '闭环预案编排' : usingBridge ? '连接数据源' : '受控桥接',
    usingResourcePlatform
      ? '正在读取三亚消防救援力量与重点单位信息平台的只读登记数据'
      : usingLocalRules ? '正在按版本化证据规则计算响应等级建议，并保留人工复核边界'
      : localOrchestration ? '正在汇总已核验 Skill 结果并保存可复核预案草稿'
      : usingBridge ? '正在验证受鉴权桥接并建立连接' : '当前数据源尚未接入，执行结果将明确标注数据边界',
    62,
  );
  const executionStarted = Date.now();
  const execution = executeSkill(request);
  await delay(180);
  progress(
    emit,
    'bridge',
    usingResourcePlatform ? '读取力量平台' : usingLocalRules ? '规则初判' : localOrchestration ? '闭环预案编排' : usingBridge ? '连接数据源' : '受控桥接',
    usingResourcePlatform
      ? '已获取平台登记数据，正在按条件核验队站记录'
      : usingLocalRules ? '正在核对灾情证据的来源、置信度、采集时间和冲突状态'
      : localOrchestration ? '预案编排引擎已接管，外部缺失项将保留为待人工复核'
      : usingBridge ? '鉴权连接已建立，指令已发送' : '已保留当前输入证据，不生成虚构业务数据',
    70,
    'done',
  );
  progress(
    emit,
    'execute',
    '执行能力',
    usingResourcePlatform
      ? '正在整理队站、人员、装备、车辆和登记联络字段'
      : usingLocalRules ? '正在生成可解释的等级建议与待补充证据'
      : localOrchestration ? '正在生成预案草稿，已保留失败与缺失项'
      : usingBridge ? '子项目正在处理指令，等待执行回执' : '正在生成带数据边界标注的受控结果',
    78,
  );
  const pulse = setInterval(() => {
    const elapsed = Math.max(1, Math.round((Date.now() - executionStarted) / 1000));
    progress(
      emit,
      'execute',
      '执行能力',
      usingResourcePlatform
        ? `正在核验力量平台回执，已等待 ${elapsed} 秒`
        : usingLocalRules ? `正在核对等级规则与证据，已等待 ${elapsed} 秒`
        : localOrchestration ? `正在保存预案草稿，已等待 ${elapsed} 秒`
        : usingBridge ? `子项目仍在执行，已等待 ${elapsed} 秒` : `正在生成受控结果，已等待 ${elapsed} 秒`,
      Math.min(90, 78 + elapsed),
    );
  }, 900);
  try {
    const [result] = await Promise.all([execution, delay(550)]);
    return result;
  } finally {
    clearInterval(pulse);
  }
}

function parseToolName(name?: string): { skillId: SkillId; actionId: string } | null {
  const [skillId, actionId] = (name || '').split('.');
  return findSkill(skillId) && findSkillAction(skillId, actionId)
    ? { skillId: skillId as SkillId, actionId }
    : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function upstreamAgentResponse(input: AgentChatRequest): Promise<Response> {
  const body = {
    app_id: resolveUpstreamAgentId(input.appId),
    ...(input.conversationId?.trim() ? { conversation_id: input.conversationId.trim() } : {}),
    ...(input.content?.trim() ? { content: input.content.trim() } : {}),
    ...(input.toolFeedbacks?.length ? { tool_feedbacks: input.toolFeedbacks } : {}),
    forwarded_props: {
      ...asObject(input.forwardedProps),
      ...(input.sceneId?.trim() ? { scene_id: input.sceneId.trim() } : {}),
      source: 'independent-fire-command-agent',
    },
    passthrough_props: {
      ...asObject(input.passthroughProps),
      ...(input.sceneId?.trim() ? { scene_id: input.sceneId.trim() } : {}),
    },
  };
  const upstream = await agentGatewayFetch('api/agent/v1/apps/agent-chat', {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!upstream.ok || !upstream.body) return proxyResponse(upstream);
  return new Response(sanitizeAgentStream(streamWithDeadline(upstream.body, agentStreamTimeoutMs())), {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** 取对话上下文预案：优先显式 planId，否则用最近一条已落库预案 */
async function contextPlan(input: AgentChatRequest) {
  const explicit = asText(input.forwardedProps?.planId);
  try {
    const repository = getPlanRepository();
    if (explicit) return await repository.get(explicit);
    const [latest] = await repository.list(undefined, 1);
    return latest;
  } catch {
    // 预案库不可用不影响"给出坐标就能查水源"，交由解析链处理。
    return undefined;
  }
}

function waterSourceLine(source: Record<string, unknown>, index: number) {
  const distance = Number(source.distanceKm);
  const usability = asText(source.usability);
  const state = usability === 'available' ? '标注可用' : usability === 'unavailable' ? '标注不可用' : '状态未登记';
  // 台账坐标只到 6 位小数，距离保留 2 位即到 10 m 量级；再多位是虚假精度。
  const distanceText = Number.isFinite(distance) ? `${distance.toFixed(2)} km` : '距离未知';
  return `${index + 1}. ${asText(source.code) || asText(source.id) || '未编号水源'}｜${asText(source.address) || '地址未登记'}｜直线 ${distanceText}｜${state}`;
}

function waterAnswerText(
  intent: ReturnType<typeof parseWaterQuery>,
  origin: { basis: string; label: string },
  sources: Record<string, unknown>[],
) {
  const basisLabel = origin.basis === 'explicit_coordinates' ? `按给定经纬度（${origin.label}）`
    : origin.basis === 'platform_unit' ? `按力量平台登记坐标（${origin.label}）`
    // current_plan 的 label 已含"当前预案（建筑）"，不再重复前缀。
    : `按${origin.label}`;
  if (!sources.length) {
    return `${basisLabel}在 ${intent.radiusKm} km 内未找到有坐标的水源记录。`
      + '台账中约四分之一记录无坐标，未参与距离排序；需人工核实就近取水点。';
  }
  const available = sources.filter((entry) => asText(entry.usability) === 'available').length;
  const head = `${basisLabel}在 ${intent.radiusKm} km 内检索到 ${sources.length} 条水源`
    + `（标注可用 ${available} 条），按直线距离升序：`;
  // 需求书 §8.3.1 五个卡片动作。类型/口径/压力在台账中全空，故不虚构展示。
  const actions = '可对任一条执行：三维定位、设为主水源、设为备用水源、加入预案、重新核验。'
    + '（说明：台账未登记水源类型、口径与压力，供水能力不可核算；距离为直线距离，非路网距离。）';
  return [head, sources.map(waterSourceLine).join('\n'), actions].join('\n');
}

type WaterReplyInput = {
  emit: EventEmitter;
  intent: ReturnType<typeof parseWaterQuery>;
  origin: { longitude: number; latitude: number; basis: string; label: string };
  result: SkillExecutionResult;
  plan: UnifiedFireRescuePlan | undefined;
  queryId: string;
  askedAt: string;
};

async function replyWaterSources({ emit, intent, origin, result, plan, queryId, askedAt }: WaterReplyInput) {
  const sources = Array.isArray(result.data?.sources)
    ? result.data.sources.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const dataSource = asText(asRecord(result.data?.source)?.dataUrl) ?? null;
  const resolved = {
    unitName: intent.unitName, address: intent.address, sceneId: plan?.spatialTarget.sceneId ?? null,
    floor: intent.floor, room: intent.room, longitude: origin.longitude, latitude: origin.latitude,
    radiusKm: intent.radiusKm, waterType: intent.waterType, excludeUnavailable: intent.excludeUnavailable,
  };
  const status = !result.ok ? 'failed' as const : sources.length ? 'ready' as const : 'no_result' as const;
  await saveWaterQuery(plan?.planId, {
    queryId, question: intent.question, askedAt, resolved,
    distanceBasis: 'straight_line', dataSource, resultCount: sources.length, status,
    clarification: null, evidenceRefs: dataSource ? [dataSource] : [],
    ...(result.ok ? {} : { failureReason: result.error || 'WATER_SOURCE_QUERY_FAILED' }),
  });

  if (!result.ok) {
    progress(emit, 'result', '查询失败', '水源台账读取未成功', 100, 'error');
    emit({ type: 'text', content: '水源台账暂时读取失败，未返回结果，也未使用历史缓存代替。请稍后重查。', agent: '水源查询' });
    emit({ type: 'finish' });
    return;
  }
  progress(emit, 'result', '结构化结果', `命中 ${sources.length} 条水源记录`, 96, 'done');
  emit({ type: 'text', content: waterAnswerText(intent, origin, sources), agent: '水源查询' });
  progress(emit, 'complete', '查询归档', '查询条件与结果已留痕', 100, 'done');
  emit({ type: 'finish' });
}

/** 尽力留痕：无预案上下文或写入冲突都不影响对话回答 */
async function saveWaterQuery(planId: string | undefined, query: PlanWaterSourceQuery) {
  if (!planId) return;
  try {
    await recordWaterSourceQuery(planId, query);
  } catch {
    // 留痕失败不回滚已给出的查询结果；审计缺口由 revision 冲突日志侧发现。
  }
}

async function runWaterSourceQuery(input: AgentChatRequest, emit: EventEmitter) {
  const question = input.content || '';
  const queryId = crypto.randomUUID();
  const askedAt = new Date().toISOString();
  const intent = parseWaterQuery(question);
  progress(emit, 'intent', '识别水源查询', '正在解析查询对象、半径与水源类型', 20, 'done');

  const plan = await contextPlan(input);
  const resolution = await resolveWaterQueryOrigin(intent, { plan });
  if (!resolution.ok) {
    progress(emit, 'result', '需要澄清', '未解析出可核验的检索起点', 100, 'error');
    emit({ type: 'text', content: resolution.clarification, agent: '水源查询' });
    await saveWaterQuery(plan?.planId, {
      queryId, question, askedAt, resolved: null, distanceBasis: null, dataSource: null,
      resultCount: 0, status: 'needs_clarification', clarification: resolution.clarification, evidenceRefs: [],
    });
    emit({ type: 'finish' });
    return;
  }

  const origin = resolution.origin;
  progress(emit, 'bridge', '读取水源台账', `检索起点：${origin.label}；半径 ${intent.radiusKm} km`, 55);
  const toolCallId = crypto.randomUUID();
  const args = {
    longitude: origin.longitude, latitude: origin.latitude,
    radiusKm: intent.radiusKm, limit: intent.limit, excludeUnavailable: intent.excludeUnavailable,
  };
  emit({ type: 'tool-call', toolCallId, toolName: 'route-water.query_nearby_water_sources', args: JSON.stringify(args) });
  const result = await executeSkill({ skillId: 'route-water', actionId: 'query_nearby_water_sources', input: args });
  // 卡片动作要写回预案，需要 planId/revision 与检索起点；只带上下文，不改 Skill 回执本体。
  const enriched = {
    ...result,
    waterQueryContext: {
      planId: plan?.planId ?? null, revision: plan?.revision ?? null,
      sceneId: plan?.spatialTarget.sceneId ?? null,
      origin: { longitude: origin.longitude, latitude: origin.latitude, basis: origin.basis, label: origin.label },
      radiusKm: intent.radiusKm, distanceBasis: 'straight_line' as const,
    },
  };
  emit({ type: 'tool-result', toolCallId, toolName: 'route-water.query_nearby_water_sources', result: JSON.stringify(enriched) });
  await replyWaterSources({ emit, intent, origin, result, plan, queryId, askedAt });
}

function localOrchestratorResponse(input: AgentChatRequest) {
  const feedback = input.toolFeedbacks?.[0];
  if (feedback) {
    const parsed = parseToolName(feedback.toolName);
    if (!parsed) return sse([{ type: 'error', content: '无法识别待执行的 Skill。' }]);
    if (feedback.result === 'REJECTED') {
      return streamSse(async (emit) => {
        progress(emit, 'approval', '人工复核', '指挥员已拒绝，未向子项目发送指令', 55, 'error');
        emit({ type: 'text', content: '已拒绝本次操作，未向子项目发送任何指令。', agent: '复核控制' });
        emit({ type: 'finish' });
      });
    }
    return streamSse(async (emit) => {
      const args = JSON.parse(feedback.args || '{}') as Record<string, unknown>;
      const toolCallId = feedback.toolCallId || crypto.randomUUID();
      progress(emit, 'approval', '人工复核', '复核已通过，即将执行已确认参数', 55, 'done');
      emit({ type: 'reasoning', content: '复核通过，正在通过 Skill Bridge 调度目标子项目。' });
      emit({ type: 'tool-call', toolCallId, toolName: feedback.toolName, args: feedback.args });
      const result = await executeWithVisibility({ ...parsed, input: args, approved: true }, emit);
      progress(
        emit,
        'result',
        '结构化结果',
        result.ok
          ? result.mode === 'platform' ? '已获取力量平台登记回执' : result.mode === 'bridge' ? '已获取子项目执行回执' : '受控桥接已完成，数据边界已标注'
          : publicFailureMessage(),
        96,
        result.ok ? 'done' : 'error',
      );
      emit({ type: 'tool-result', toolCallId, toolName: feedback.toolName, result: JSON.stringify(result) });
      emit({ type: 'text', content: userFacingReply(result), agent: 'Skill 调度器' });
      progress(emit, 'complete', result.ok ? '指标归档' : '任务失败', result.ok ? '执行过程和结果已归档' : '失败原因已记录', 100, result.ok ? 'done' : 'error');
      emit({ type: 'finish' });
    });
  }

  // 需求书 §8.3.1：对话栏周边水源查询要先解析定位对象再检索，
  // 走不通就明确要澄清；不能落到通用 inferAction 的无坐标调用上。
  if (isWaterSourceQuestion(input.content || '')) {
    return streamSse((emit) => runWaterSourceQuery(input, emit));
  }

  let actionRequest = inferAction(input.content || '', input.sceneId);
  if (!actionRequest) {
    return sse([
      { type: 'text', content: '当前未识别到闭环动作。请说明要定位空间、判定Ⅰ-Ⅴ级、匹配救援力量，或生成结构化预案。', agent: '消防指挥总控智能体' },
      { type: 'finish' },
    ]);
  }
  // In the local presentation runtime a concise fire intake is the full
  // workflow trigger. The client has already dispatched a parallel scene
  // preflight, so the orchestrator can continue with the structured plan.
  if (actionRequest.skillId === 'scene-control'
    && actionRequest.actionId === 'locate_space'
    && /火灾|火警|起火|着火|燃烧/.test(input.content || '')
    && actionRequest.input?.floor
    && actionRequest.input?.trappedCount !== undefined
    && !/(?:只|仅|先)?(?:定位|高亮|查看三维)/.test(input.content || '')) {
    const sceneInput = actionRequest.input;
    actionRequest = {
      skillId: 'competition-orchestrator',
      actionId: 'prepare_competition_run',
      input: {
        ...sceneInput,
        building: sceneInput?.building ?? '五矿国际广场',
        fireType: sceneInput?.fireType ?? '电气火灾',
        sceneType: sceneInput?.sceneType ?? '高层公共建筑',
      },
    };
  }
  const skill = findSkill(actionRequest.skillId)!;
  const action = findSkillAction(actionRequest.skillId, actionRequest.actionId)!;
  const toolCallId = crypto.randomUUID();
  const toolName = `${skill.id}.${action.id}`;
  const args = JSON.stringify(actionRequest.input ?? {});
  return streamSse(async (emit) => {
    emit({ type: 'conversation_id', conversation_id: input.conversationId || crypto.randomUUID() });
    progress(emit, 'received', '火情输入', input.content?.trim() || '已接收复核结果', 8, 'done');
    await delay(90);
    progress(emit, 'intent', '智能研判', `已识别执行目标：${action.name}`, 22, 'done');
    emit({ type: 'reasoning', content: `已识别任务目标，选择 ${skill.name}。` });
    await delay(90);
    progress(emit, 'parameters', '要素提取', `已提取 ${Object.keys(actionRequest.input ?? {}).length} 项可执行参数`, 36, 'done');
    await delay(90);
    progress(emit, 'skill', 'Skill 协同', `${skill.name} / ${action.name}`, 48, 'done');

    emit({ type: 'tool-call', toolCallId, toolName, args });
    if (action.requiresApproval) {
      emit({ type: 'text', content: approvalReply(actionRequest.skillId, actionRequest.actionId, actionRequest.input ?? {}), agent: '消防指挥总控智能体' });
      progress(emit, 'approval', '人工复核', '该操作会改变子项目状态，正在等待指挥员确认', 55, 'waiting');
      emit({
        type: 'tool-approval-request',
        toolCallId,
        toolName,
        args,
        description: '该操作会改变子项目状态，需要指挥员确认。',
      });
      return;
    }
    progress(emit, 'approval', '人工复核', '本动作不改变受控场景状态，无需人工复核', 55, 'done');
    const result = await executeWithVisibility({ ...actionRequest, approved: true }, emit);
    progress(
      emit,
      'result',
      '结构化结果',
      result.ok
        ? result.mode === 'platform' ? '已获取力量平台登记回执' : result.mode === 'bridge' ? '已获取子项目执行回执' : '受控桥接已完成，数据边界已标注'
        : publicFailureMessage(),
      96,
      result.ok ? 'done' : 'error',
    );
    emit({ type: 'tool-result', toolCallId, toolName, result: JSON.stringify(result) });
    emit({
      type: 'text',
      content: userFacingReply(result),
      agent: 'Skill 调度器',
    });
    progress(emit, 'complete', result.ok ? '指标归档' : '任务失败', result.ok ? '执行过程和结果已归档' : '失败原因已记录', 100, result.ok ? 'done' : 'error');
    emit({ type: 'finish' });
  });
}

function remoteControlledResponse(input: AgentChatRequest) {
  return streamSse(async (emit) => {
    progress(emit, 'remote', '八维通远端运行时', '正在连接已发布的比赛主智能体', 4);
    const handshake = await remoteSessionHandshake(input);
    if (!handshake.ok) {
      emit({ type: 'error', scope: 'transport', terminal: true, content: handshake.message });
      return;
    }
    if (handshake.conversationId) emit({ type: 'conversation_id', conversation_id: handshake.conversationId });
    emit({ type: 'reasoning', scope: 'task', content: '八维通已接收火情，正在把结果交给受控场景与预案桥接执行。', agent: '八维通 MultiAgent' });
    progress(emit, 'remote', '八维通远端运行时', '远端会话已建立，已发布 Skill/MCP 绑定通过健康检查', 12, 'done');
    // The local response is deliberately kept behind an explicit remote
    // receipt. It owns the auditable scene/plan bridge because the published
    // agent does not have permission to sign or mutate the live scene.
    await forwardSseResponse(
      localOrchestratorResponse({ ...input, conversationId: handshake.conversationId || input.conversationId }),
      emit,
    );
  });
}

export async function POST(request: Request) {
  const input = (await request.json().catch(() => null)) as AgentChatRequest | null;
  if (!input?.appId) return NextResponse.json({ message: '缺少 appId。' }, { status: 400 });
  if (!input.content?.trim() && !input.toolFeedbacks?.length) {
    return NextResponse.json({ message: '消息内容或复核结果不能为空。' }, { status: 400 });
  }
  const runtime = await inspectCompetitionRuntimeBinding();
  if (runtime.status !== 'ready') {
    return NextResponse.json({ message: runtime.message, runtime }, { status: 503 });
  }
  if (isOfflineDemoMode()) return localOrchestratorResponse(input);
  return remoteControlledResponse(input);
}
