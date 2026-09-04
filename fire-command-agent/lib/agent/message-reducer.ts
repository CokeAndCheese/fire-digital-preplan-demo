import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ReadonlyJSONObject, ReadonlyJSONValue } from 'assistant-stream/utils';
import type { AgentMessage, AgentStreamEvent, AuditRecord, PresentationStatus } from './types';

type MessagePart = Exclude<ThreadMessageLike['content'], string>[number];

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function parseArgs(value?: string): ReadonlyJSONObject | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as ReadonlyJSONObject
      : { value: parsed as ReadonlyJSONValue };
  } catch {
    return { raw: value };
  }
}

function parseRecord(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function publicFailure() {
  return '本次操作未完成，失败状态已保留，请查看实时过程并进行人工复核。';
}

/** Keep the chat conclusion business-facing; raw JSON, reasoning, diagnostics and IDs belong to audit only. */
export function sanitizePublicText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parsed = parseRecord(trimmed);
  if (parsed) {
    if (parsed.ok === false || parsed.status === 'error' || parsed.status === 'failed') return publicFailure();
    const candidate = [parsed.summary, parsed.message, parsed.conclusion, parsed.content]
      .find((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return candidate ? sanitizePublicText(candidate) : '结构化结果已收到，详情已记录在实时过程和审计中。';
  }
  if (/[{}\[\]]/.test(trimmed) && /"(?:ok|data|error|tool|trace|request|conversation)/i.test(trimmed)) {
    return /"ok"\s*:\s*false/i.test(trimmed) ? publicFailure() : '结构化结果已收到，详情已记录在实时过程和审计中。';
  }
  if (/(?:TypeError|ReferenceError|SyntaxError|stack trace|fetch failed|ECONN|HTTP\s*\d{3}|\b(?:401|403|404|408|429|500|502|503)\b|原始回执|raw response)/i.test(trimmed)) {
    return publicFailure();
  }
  return trimmed
    .replace(/(?:app[_ -]?id|conversation[_ -]?id|tool[_ -]?call(?:[_ -]?id)?|request[_ -]?id|trace[_ -]?id|scene[_ -]?id|plan[_ -]?id|assessment[_ -]?id|route[_ -]?package[_ -]?id)\s*[:=：]\s*["']?[A-Za-z0-9_:-]+["']?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Remove streamed orchestration narration while preserving the remote business conclusion verbatim. */
export function normalizeRemoteFinalText(value: string): string {
  const text = sanitizePublicText(value)
    .replace(/本次操作未完成，失败状态已保留，请查看实时过程并进行人工复核。/g, '')
    .trim();
  const hasNarration = /我需要|现在(?:让我|开始)|正在执行|步骤\s*[1-9]|调用.+智能体|读取第.+条/.test(text);
  if (text.length < 450 && !hasNarration) return text;

  const conclusion = /(?:\*\*)?(?:结论|最终判定|建议响应级别)(?:\*\*)?\s*[:：]\s*/g;
  const plan = /(?:^|\n|\s)(#{1,3}\s*)?(?:数字预案|结构化预案(?:草案|草稿)?)[：:\s-]*/g;
  const candidates = [conclusion, plan]
    .map((pattern, priority) => {
      const matches = [...text.matchAll(pattern)];
      const match = matches.at(-1);
      return match && (match.index ?? 0) > text.length * 0.15
        ? { index: match.index ?? 0, length: match[0].length, priority }
        : null;
    })
    .filter((item): item is { index: number; length: number; priority: number } => Boolean(item))
    .sort((left, right) => left.priority - right.priority || right.index - left.index);

  const selected = candidates[0];
  if (!selected) {
    if (!hasNarration) return text;
    const evidenceLines = [...text.matchAll(/(?:已接收火情|空间取证失败|待人工复核|建议响应级别|待核实|下一步)[^。！？\n]{0,220}[。！？]?/g)]
      .map((match) => match[0].trim())
      .filter((line, index, lines) => line && lines.indexOf(line) === index)
      .slice(0, 6);
    return evidenceLines.length
      ? `## 远端研判摘要\n\n${evidenceLines.map((line) => `- ${line}`).join('\n')}`
      : '远端已返回部分研判结果，详细过程已收起，请查看实时作战过程和审计详情。';
  }
  const heading = selected.priority === 1 ? '## 结构化预案草稿' : '## 研判结论';
  const body = text.slice(selected.index + selected.length).trim();
  return `${heading}\n\n${body}`
    .replace(/\*\*(关键证据|建议优先调派队站(?:（[^）]+）)?|待核实项|下一步)[:：]\*\*/g, '\n\n### $1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function auditStatus(value: unknown, fallback: PresentationStatus = 'success'): PresentationStatus {
  return value === false || value === 'error' || value === 'failed' ? 'failed' : fallback;
}

function evidenceRefs(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return refs.length ? refs : undefined;
}

function auditFromOutput(record: Record<string, unknown> | undefined): Pick<AuditRecord, 'status' | 'evidenceRefs' | 'ruleVersion' | 'error'> {
  const data = record && typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : undefined;
  return {
    status: (record?.ok === false || record?.status === 'error' || record?.status === 'failed' ? 'failed' : 'success') as PresentationStatus,
    evidenceRefs: evidenceRefs(record?.evidenceRefs ?? data?.evidenceRefs),
    ruleVersion: typeof record?.ruleVersion === 'string' ? record.ruleVersion : typeof data?.ruleVersion === 'string' ? data.ruleVersion : undefined,
    error: typeof record?.error === 'string' ? record.error : undefined,
  };
}

function upsertAudit(records: AuditRecord[], next: AuditRecord) {
  const index = records.findIndex((record) => record.callId === next.callId);
  if (index < 0) return [...records, next];
  return records.map((record, cursor) => cursor === index ? { ...record, ...next } : record);
}

export function createUserMessage(text: string): AgentMessage {
  return { id: makeId('user'), role: 'user', content: [{ type: 'text', text }], createdAt: new Date() };
}

export function createAssistantMessage(): AgentMessage {
  return {
    id: makeId('assistant'),
    role: 'assistant',
    content: [{ type: 'text', text: '', status: { type: 'running' } }],
    createdAt: new Date(),
    status: { type: 'running' },
    metadata: { custom: {} },
  };
}

function partsOf(message: AgentMessage): MessagePart[] {
  return typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : [...message.content];
}

function appendText(parts: MessagePart[], type: 'text' | 'reasoning', text: string): MessagePart[] {
  let index = -1;
  for (let cursor = parts.length - 1; cursor >= 0; cursor -= 1) {
    if (parts[cursor].type === type) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return [...parts, { type, text }];
  const current = parts[index];
  if (current.type !== type) return parts;
  const next = [...parts];
  next[index] = { ...current, text: current.text + text };
  return next;
}

export function applyStreamEvent(message: AgentMessage, event: AgentStreamEvent): AgentMessage {
  let content = partsOf(message);
  let status = message.status;
  const custom = { ...(message.metadata?.custom ?? {}) };
  if (event.type === 'text') {
    const publicText = sanitizePublicText(event.content);
    if (publicText) content = appendText(content, 'text', publicText);
    if (event.scope === 'task') custom.remote = true;
  }
  // Reasoning is retained only in the execution/audit metadata, never in the customer-facing thread.
  if (event.type === 'reasoning') {
    custom.execution = { source: 'upstream', phase: 'intent', title: '智能研判', detail: event.content };
  }
  if (event.type === 'tool-call') {
    const callId = event.toolCallId || makeId('tool');
    custom.audit = upsertAudit(custom.audit ?? [], {
      callId,
      toolName: event.toolName || '未命名工具',
      status: 'running',
      input: parseArgs(event.args),
      startedAt: Date.now(),
      replayable: true,
    });
    content = [...content, {
      type: 'tool-call',
      toolCallId: callId,
      toolName: event.toolName || '未命名工具',
      args: parseArgs(event.args),
      argsText: event.args,
    }];
  }
  if (event.type === 'tool-result') {
    const output = parseRecord(event.result);
    const outputState = auditFromOutput(output);
    const callId = event.toolCallId || makeId('tool');
    const existingAudit = (custom.audit ?? []).find((record) => record.callId === callId);
    custom.audit = upsertAudit(custom.audit ?? [], {
      callId,
      toolName: event.toolName || existingAudit?.toolName || 'Skill 执行',
      status: outputState.status,
      input: existingAudit?.input,
      output: event.result,
      evidenceRefs: outputState.evidenceRefs,
      ruleVersion: outputState.ruleVersion,
      error: outputState.error,
      startedAt: existingAudit?.startedAt ?? Date.now(),
      finishedAt: Date.now(),
      replayable: true,
    });
    if (outputState.status === 'failed') {
      if (event.scope === 'tool') {
        // A remote child tool can fail while the orchestrator continues and
        // produces a usable draft. Keep the failure in audit only.
        custom.reviewRequired = true;
      } else {
        const safeError = publicFailure();
        status = { type: 'incomplete', reason: 'error', error: safeError };
        custom.error = safeError;
      }
    }
    const existing = content.find((part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId);
    if (!existing) {
      content = [...content, {
        type: 'tool-call',
        toolCallId: event.toolCallId || makeId('tool'),
        toolName: event.toolName || 'Skill 执行',
        result: event.result ?? '',
      }];
    } else {
      content = content.map((part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId
        ? { ...part, result: event.result ?? '' }
        : part);
    }
  }
  if (event.type === 'tool-approval-request') {
    const callId = event.toolCallId || makeId('tool');
    const existingAudit = (custom.audit ?? []).find((record) => record.callId === callId);
    custom.audit = upsertAudit(custom.audit ?? [], {
      callId,
      toolName: event.toolName || existingAudit?.toolName || '待复核动作',
      status: 'waiting',
      input: existingAudit?.input,
      startedAt: existingAudit?.startedAt ?? Date.now(),
      replayable: true,
    });
    const approval = {
      id: event.toolCallId || makeId('approval'),
      options: [
        { id: 'approve', kind: 'allow-once' as const, label: '复核通过执行' },
        { id: 'reject', kind: 'reject-once' as const, label: '拒绝执行' },
      ],
    };
    content = content.map((part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId
      ? { ...part, approval }
      : part);
    status = { type: 'requires-action', reason: 'tool-calls' };
  }
  if (event.type === 'finish') {
    if (status?.type === 'incomplete' || status?.type === 'requires-action' || custom.reviewRequired) {
      if (custom.reviewRequired && status?.type === 'running') {
        status = { type: 'incomplete', reason: 'error', error: '部分研判完成，结果待人工复核。' };
      } else if (custom.reviewRequired && !status) {
        status = { type: 'incomplete', reason: 'error', error: '部分研判完成，结果待人工复核。' };
      }
      return { ...message, content, status, metadata: { ...(message.metadata ?? {}), custom } };
    }
    status = { type: 'complete', reason: 'stop' };
    content = content.map((part) => part.type === 'text' || part.type === 'reasoning'
      ? { ...part, ...(part.type === 'text' && custom.remote ? { text: normalizeRemoteFinalText(part.text) } : {}), status: { type: 'complete' as const } }
      : part);
  }
  if (event.type === 'error') {
    const recoverable = event.terminal === false || event.scope === 'tool';
    if (recoverable) {
      custom.reviewRequired = true;
      const activeAudit = (event.toolCallId && custom.audit?.find((record) => record.callId === event.toolCallId))
        || [...(custom.audit ?? [])].reverse().find((record) => record.status === 'running')
        || custom.audit?.at(-1);
      if (activeAudit) {
        custom.audit = upsertAudit(custom.audit ?? [], {
          ...activeAudit,
          status: 'failed',
          error: sanitizePublicText(event.content) || '子工具执行失败。',
          finishedAt: Date.now(),
        });
      }
      return { ...message, content, status, metadata: { ...(message.metadata ?? {}), custom } };
    }
    const error = sanitizePublicText(event.content) || publicFailure();
    status = { type: 'incomplete', reason: 'error', error };
    custom.error = error;
    const lastText = content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (!lastText.includes(error)) content = appendText(content, 'text', error);
    const activeAudit = (event.toolCallId && custom.audit?.find((record) => record.callId === event.toolCallId))
      || [...(custom.audit ?? [])].reverse().find((record) => record.status === 'running')
      || custom.audit?.at(-1);
    if (activeAudit) {
      custom.audit = upsertAudit(custom.audit ?? [], {
        ...activeAudit,
        status: 'failed',
        error,
        finishedAt: Date.now(),
      });
    }
  }
  if (event.agent) custom.agent = event.agent;
  if (event.phase === 'total' && typeof event.elapsedMs === 'number') custom.elapsedMs = event.elapsedMs;
  if (event.type === 'conversation_id' && event.conversation_id) custom.conversationId = event.conversation_id;
  if (event.type === 'progress') {
    const recoverable = event.status === 'error' && (event.terminal === false || event.scope === 'tool');
    if (event.status === 'error' && !recoverable) {
      status = { type: 'incomplete', reason: 'error', error: publicFailure() };
      custom.error = publicFailure();
    }
    if (recoverable) custom.reviewRequired = true;
    custom.execution = {
      source: custom.execution?.source ?? 'unknown',
      phase: event.phase,
      title: event.title,
      detail: event.description || event.content,
      progress: event.progress,
      status: event.status === 'error' ? (recoverable ? 'waiting' : 'failed') : event.status === 'waiting' ? 'waiting' : event.status === 'done' ? 'success' : 'running',
    };
  }
  return { ...message, content, status, metadata: { ...(message.metadata ?? {}), custom } };
}
