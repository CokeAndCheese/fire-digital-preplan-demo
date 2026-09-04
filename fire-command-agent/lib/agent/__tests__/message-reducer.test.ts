import { describe, expect, it } from 'vitest';
import { applyStreamEvent, createAssistantMessage, normalizeRemoteFinalText, sanitizePublicText } from '../message-reducer';

describe('three-layer message reducer', () => {
  it('keeps raw structured output and internal IDs out of the chat conclusion', () => {
    expect(sanitizePublicText('{"ok":true,"conversation_id":"c-123","data":{"secret":"value"}}')).toBe('结构化结果已收到，详情已记录在实时过程和审计中。');
    expect(sanitizePublicText('已完成 scene_id=477747327523254272 的定位。')).toBe('已完成 的定位。');
  });

  it('drops reasoning from the customer-facing message while retaining execution metadata', () => {
    const next = applyStreamEvent(createAssistantMessage(), {
      type: 'reasoning',
      content: '正在选择内部 Skill 和路由参数。',
    });

    expect(next.content).toEqual([{ type: 'text', text: '', status: { type: 'running' } }]);
    expect(next.metadata?.custom?.execution).toMatchObject({ phase: 'intent', detail: '正在选择内部 Skill 和路由参数。' });
  });

  it('keeps tool input/output in the audit record and marks failed results incomplete', () => {
    const called = applyStreamEvent(createAssistantMessage(), {
      type: 'tool-call',
      toolCallId: 'call-42',
      toolName: 'fire-resource.query_nearby_units',
      args: '{"floor":"8F","scene_id":"internal-scene"}',
    });
    const failed = applyStreamEvent(called, {
      type: 'tool-result',
      toolCallId: 'call-42',
      toolName: 'fire-resource.query_nearby_units',
      result: '{"ok":false,"error":"graph unavailable","evidenceRefs":["route-source"]}',
    });

    expect(failed.status).toMatchObject({ type: 'incomplete', reason: 'error' });
    const parts = typeof failed.content === 'string' ? [] : failed.content;
    expect(parts.some((part) => part.type === 'text' && part.text.includes('graph unavailable'))).toBe(false);
    expect(failed.metadata?.custom?.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'call-42', status: 'failed', output: expect.stringContaining('graph unavailable'), evidenceRefs: ['route-source'] }),
    ]));
  });

  it('does not turn a failed execution into a completed assistant message', () => {
    const called = applyStreamEvent(createAssistantMessage(), { type: 'tool-call', toolCallId: 'call-7', toolName: 'fire-resource.query', args: '{}' });
    const failed = applyStreamEvent(called, { type: 'tool-result', toolCallId: 'call-7', result: '{"ok":false}' });
    const finished = applyStreamEvent(failed, { type: 'finish' });
    expect(finished.status?.type).toBe('incomplete');
  });

  it('keeps a remote child-tool failure in audit while allowing the final answer', () => {
    const called = applyStreamEvent(createAssistantMessage(), {
      type: 'tool-call', scope: 'tool', toolCallId: 'call-remote', toolName: 'list_fires', args: '{}',
    });
    const failed = applyStreamEvent(called, {
      type: 'tool-result', scope: 'tool', terminal: false, toolCallId: 'call-remote', toolName: 'list_fires',
      result: '{"ok":false,"error":"力量数据暂未返回"}',
    });
    const finished = applyStreamEvent(
      applyStreamEvent(failed, { type: 'text', content: '已生成预案草稿，待人工复核。' }),
      { type: 'finish' },
    );

    expect(finished.status?.type).toBe('incomplete');
    expect(finished.metadata?.custom?.reviewRequired).toBe(true);
    expect(finished.metadata?.custom?.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'call-remote', status: 'failed' }),
    ]));
  });

  it('collapses long remote narration to the business conclusion sections', () => {
    const narration = `${'我需要先读取知识库并调用子智能体。'.repeat(60)}**结论：**三级火警（F3），建议按 III 级响应。**关键证据：**5 人被困。**待核实项：**空间布局、路线 ETA。**下一步：**等待指挥员复核。`;
    const normalized = normalizeRemoteFinalText(narration);

    expect(normalized).toContain('## 研判结论');
    expect(normalized).toContain('三级火警（F3）');
    expect(normalized).toContain('### 关键证据');
    expect(normalized).toContain('### 待核实项');
    expect(normalized).not.toContain('我需要先读取知识库');
  });

  it('keeps a rejected approval in a failed state', () => {
    const rejected = applyStreamEvent(createAssistantMessage(), {
      type: 'progress',
      phase: 'approval',
      status: 'error',
      title: '人工复核',
      description: '指挥员已拒绝',
    });
    const finished = applyStreamEvent(rejected, { type: 'finish' });
    expect(finished.status?.type).toBe('incomplete');
  });
});
