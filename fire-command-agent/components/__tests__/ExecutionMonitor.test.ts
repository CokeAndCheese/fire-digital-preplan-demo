import { describe, expect, it } from 'vitest';
import { applyExecutionEvent, createLiveExecution } from '../ExecutionMonitor';

describe('execution monitor', () => {
  it('keeps every streamed phase visible and updates the current progress', () => {
    const run = createLiveExecution('定位 B2 层 Space_451');
    const next = applyExecutionEvent(run, {
      type: 'progress',
      phase: 'parameters',
      title: '提取参数',
      description: '已提取 3 项参数',
      progress: 36,
      status: 'done',
    });
    expect(next.progress).toBe(36);
    expect(next.currentDetail).toBe('已提取 3 项参数');
    expect(next.phases.find((phase) => phase.id === 'parameters')).toMatchObject({ status: 'done' });
  });

  it('holds the task in a waiting state until approval arrives', () => {
    const run = createLiveExecution('启动三维推演');
    const waiting = applyExecutionEvent(run, {
      type: 'tool-approval-request',
      description: '需要指挥员确认',
    });
    const afterStreamEnd = applyExecutionEvent(waiting, { type: 'finish' });
    expect(waiting.status).toBe('waiting');
    expect(afterStreamEnd.status).toBe('waiting');
  });

  it('preserves a failed child-project result as an error', () => {
    const run = createLiveExecution('查询附近消防力量');
    const failed = applyExecutionEvent(run, {
      type: 'tool-result',
      result: JSON.stringify({ ok: false, error: '数据源不可用' }),
    });
    expect(failed.status).toBe('error');
    expect(failed.currentDetail).toBe('数据源不可用');
  });

  it('keeps a remote child-tool failure reviewable while the orchestrator continues', () => {
    const run = createLiveExecution('生成火情预案');
    const failed = applyExecutionEvent(run, {
      type: 'tool-result',
      scope: 'tool',
      terminal: false,
      toolCallId: 'call-fires',
      toolName: 'list_fires',
      result: JSON.stringify({ ok: false, error: '力量数据暂未返回' }),
    });
    const finished = applyExecutionEvent(
      applyExecutionEvent(failed, { type: 'text', content: '预案草稿已生成' }),
      { type: 'finish' },
    );

    expect(finished.status).toBe('waiting');
    expect(finished.currentTitle).toBe('部分研判完成，待人工复核');
    expect(finished.audit[0]).toMatchObject({ toolName: 'list_fires', status: 'failed' });
  });

  it('turns a remote text-only review signal into an actionable waiting run', () => {
    const run = createLiveExecution('七层起火，5人被困');
    const draft = applyExecutionEvent(run, {
      type: 'text',
      content: '已生成预案草稿，等待指挥员复核。',
    });
    const finished = applyExecutionEvent(draft, { type: 'finish' });

    expect(draft.manualReview).toBe(true);
    expect(finished.status).toBe('waiting');
    expect(finished.currentTitle).toBe('结果待人工复核');
    expect(finished.currentDetail).toBe('远端已返回待复核结论，等待指挥员确认后继续闭环。');
  });

  it('does not re-arm a review after the operator has approved it', () => {
    const run = createLiveExecution('八层起火，2人被困');
    const handled = {
      ...run,
      status: 'running' as const,
      reviewHandled: true,
      manualReview: false,
    };
    const lateReviewSignal = applyExecutionEvent(handled, {
      type: 'text',
      content: '预案结果已返回，当前待人工复核。',
    });

    expect(lateReviewSignal.reviewHandled).toBe(true);
    expect(lateReviewSignal.manualReview).toBe(false);
    expect(lateReviewSignal.status).toBe('running');
  });

  it('indexes the full tool exchange by call ID for the audit layer', () => {
    const called = applyExecutionEvent(createLiveExecution('计算路线'), {
      type: 'tool-call',
      toolCallId: 'call-route-1',
      toolName: 'fire-resource.query_nearby_units',
      args: '{"floor":"8F"}',
    });
    const waiting = applyExecutionEvent(called, {
      type: 'tool-approval-request',
      toolCallId: 'call-route-1',
      toolName: 'fire-resource.query_nearby_units',
      description: '需要复核',
    });
    const completed = applyExecutionEvent(waiting, {
      type: 'tool-result',
      toolCallId: 'call-route-1',
      toolName: 'fire-resource.query_nearby_units',
      result: '{"ok":true,"evidenceRefs":["route-source"],"data":{"ruleVersion":"v1"}}',
    });

    expect(completed.audit).toHaveLength(1);
    expect(completed.audit[0]).toMatchObject({
      callId: 'call-route-1',
      status: 'success',
      input: { floor: '8F' },
      evidenceRefs: ['route-source'],
      ruleVersion: 'v1',
    });
  });

  it('keeps platform failure visible as a failure rather than completion', () => {
    const run = createLiveExecution('查询平台');
    const failed = applyExecutionEvent(run, { type: 'error', content: 'HTTP 503 internal upstream error' });
    const finished = applyExecutionEvent(failed, { type: 'finish' });
    expect(finished.status).toBe('error');
    expect(finished.currentTitle).toBe('任务执行失败');
  });

  it('labels an unavailable platform separately from a business completion', () => {
    const run = createLiveExecution('连接八维通');
    const failed = applyExecutionEvent(run, { type: 'error', content: '平台不可用：八维通请求失败' });
    expect(failed.status).toBe('error');
    expect(failed.currentTitle).toBe('平台不可用');
  });

  it('updates the matching audit record when an error names a tool call', () => {
    const called = applyExecutionEvent(applyExecutionEvent(createLiveExecution('查询路线和力量'), {
      type: 'tool-call', toolCallId: 'call-force', toolName: 'fire-resource', args: '{}',
    }), {
      type: 'tool-call', toolCallId: 'call-fires', toolName: 'list_fires', args: '{}',
    });
    const failed = applyExecutionEvent(called, {
      type: 'error', scope: 'tool', terminal: false, toolCallId: 'call-fires', content: '力量平台未返回',
    });

    expect(failed.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'call-fires', status: 'failed', error: '力量平台未返回' }),
      expect.objectContaining({ callId: 'call-force', status: 'running' }),
    ]));
  });

  it('does not let text after a terminal error reopen the run', () => {
    const failed = applyExecutionEvent(createLiveExecution('连接八维通'), {
      type: 'error', content: 'HTTP 503 internal upstream error', terminal: true,
    });
    const afterText = applyExecutionEvent(failed, { type: 'text', content: '已完成答复' });
    const afterFinish = applyExecutionEvent(afterText, { type: 'finish' });

    expect(afterText.status).toBe('error');
    expect(afterFinish.status).toBe('error');
  });

  it('does not let a complete progress event hide a prior child-tool failure', () => {
    const failed = applyExecutionEvent(createLiveExecution('生成预案'), {
      type: 'tool-result', scope: 'tool', terminal: false, toolCallId: 'call-fires', toolName: 'list_fires',
      result: JSON.stringify({ ok: false, error: '力量平台未返回' }),
    });
    const completed = applyExecutionEvent(failed, {
      type: 'progress', phase: 'complete', status: 'done', progress: 100,
    });

    expect(completed.status).toBe('waiting');
    expect(completed.progress).toBeLessThan(100);
  });

  it('keeps an in-flight audit visible as in progress rather than all normal', () => {
    const called = applyExecutionEvent(createLiveExecution('查询力量'), {
      type: 'tool-call', toolCallId: 'call-fires', toolName: 'list_fires', args: '{}',
    });
    expect(called.audit[0]).toMatchObject({ status: 'running' });
  });
});
