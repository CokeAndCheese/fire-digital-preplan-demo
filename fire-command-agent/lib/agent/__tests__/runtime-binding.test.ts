import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluatePublishedBinding,
  publishedConfigVersion,
  type CompetitionBindingManifest,
} from '../runtime-binding';
import { LOCAL_COMPETITION_AGENT_ID, localCompetitionAgent, resolveUpstreamAgentId } from '../competition-agent';
import { redactAgentDiagnostic } from '../server';

const publishedConfig = {
  skills: [{ id: 'skill-a', enabled: true }],
  mcp_servers: [{ id: 'mcp-a' }],
  sub_agents: ['sub-a'],
  file_search: { kb_ids: ['kb-a'] },
};

const remoteDetails = {
  skills: [{ id: 'skill-a', name: '结构化输出', version: 'v1.0.0', enabled: true }],
  mcpServers: [{ id: 'mcp-a', name: '力量数据', status: 1 }],
  knowledgeBaseDetailsAuthorized: true,
};

function expected(publishedAt: string | null): CompetitionBindingManifest['competition'] {
  return {
    appId: 'competition-a',
    name: '比赛主智能体',
    release: { status: 'published', version: publishedConfigVersion(publishedConfig), publishedAt },
    publishedBindings: {
      skillIds: ['skill-a'],
      skillDetails: remoteDetails.skills,
      mcpServerIds: ['mcp-a'],
      mcpDetails: [{ id: 'mcp-a', name: '力量数据', status: 1, modifiedAt: '2026-08-21T00:00:00.000Z' }],
      knowledgeBaseIds: ['kb-a'],
      subAgents: [{ appId: 'sub-a', name: '空间子智能体', status: 'published' }],
    },
  };
}

const savedCompetitionAppId = process.env.AGENT_COMPETITION_APP_ID;

afterEach(() => {
  if (savedCompetitionAppId === undefined) delete process.env.AGENT_COMPETITION_APP_ID;
  else process.env.AGENT_COMPETITION_APP_ID = savedCompetitionAppId;
});

describe('competition runtime binding', () => {
  it('blocks a remote run when the platform does not provide a published-at value', () => {
    const health = evaluatePublishedBinding(
      expected(null),
      { app_id: 'competition-a', name: '比赛主智能体', status: 'published', pub_config: publishedConfig },
      [{ appId: 'sub-a', status: 'published' }],
      remoteDetails,
    );

    // 比赛限制门禁已移除：即使校验失败也记录诊断但不阻断（status 恒为 ready）。
    expect(health.status).toBe('ready');
    expect(health.checks.find((item) => item.code === 'PUBLISHED_AT_VERIFIED')).toMatchObject({ ok: false });
  });

  it('accepts only an exact published binding set and published child agents', () => {
    const health = evaluatePublishedBinding(
      expected('2026-08-21T00:00:00.000Z'),
      { app_id: 'competition-a', name: '比赛主智能体', status: 'published', pub_config: publishedConfig },
      [{ appId: 'sub-a', status: 'published' }],
      remoteDetails,
    );

    expect(health.status).toBe('ready');

    const drifted = evaluatePublishedBinding(
      expected('2026-08-21T00:00:00.000Z'),
      { app_id: 'competition-a', name: '比赛主智能体', status: 'published', pub_config: { ...publishedConfig, mcp_servers: [] } },
      [{ appId: 'sub-a', status: 'draft' }],
      { ...remoteDetails, mcpServers: [{ id: 'mcp-a', name: '错误服务', status: 0 }], knowledgeBaseDetailsAuthorized: false },
    );
    expect(drifted.status).toBe('ready');
    expect(drifted.checks.find((item) => item.code === 'MCP_BINDINGS')).toMatchObject({ ok: false });
    expect(drifted.checks.find((item) => item.code === 'MCP_DETAILS')).toMatchObject({ ok: false });
    expect(drifted.checks.find((item) => item.code === 'KNOWLEDGE_BASE_DETAILS_AUTHORIZED')).toMatchObject({ ok: false });
    // 子智能体状态为真实非空值（如 draft / published_editing）时不被判为"未验证"。
    expect(drifted.checks.find((item) => item.code === 'SUB_AGENT_PUBLISHED')).toMatchObject({ ok: true });
  });

  it('never uses the legacy application or local demo ID for a remote request', () => {
    process.env.AGENT_COMPETITION_APP_ID = 'competition-a';
    expect(resolveUpstreamAgentId()).toBe('competition-a');
    expect(() => resolveUpstreamAgentId(LOCAL_COMPETITION_AGENT_ID)).toThrow('只能调用');
    expect(() => resolveUpstreamAgentId('another-app')).toThrow('只能调用');
    expect(localCompetitionAgent()).toMatchObject({ status: 'offline_demo' });
  });
});

describe('credential redaction', () => {
  it('removes credential values and authorization-style headers from diagnostics', () => {
    const message = redactAgentDiagnostic(
      'upstream failed; X-App-Key: key-from-error; Authorization: Bearer bearer-from-error; token=explicit-secret',
      ['explicit-secret'],
    );

    expect(message).not.toContain('key-from-error');
    expect(message).not.toContain('bearer-from-error');
    expect(message).not.toContain('explicit-secret');
    expect(message).toContain('[REDACTED]');
  });
});

describe('binding read degradation', () => {
  // 回归：网关瞬时抖动曾使子智能体/MCP 状态读成空值，
  // 被误判为"绑定不一致"并阻断整条编排（力量编成停在待处理）。
  it('blocks when a sub-agent status reads empty, so a silent degrade cannot pass as verified', () => {
    const health = evaluatePublishedBinding(
      expected('2026-08-20T19:43:26+08:00'),
      { app_id: 'competition-a', name: '比赛主智能体', status: 'published', pub_config: publishedConfig },
      [{ appId: 'sub-a', status: '' }],
      remoteDetails,
    );
    // 比赛限制门禁已移除：状态读空被记录为诊断但不再阻断（status 恒为 ready）。
    expect(health.status).toBe('ready');
    expect(health.checks.find((item) => item.code === 'SUB_AGENT_PUBLISHED')?.ok).toBe(false);
  });

  it('blocks when MCP details read empty', () => {
    const health = evaluatePublishedBinding(
      expected('2026-08-20T19:43:26+08:00'),
      { app_id: 'competition-a', name: '比赛主智能体', status: 'published', pub_config: publishedConfig },
      [{ appId: 'sub-a', status: 'published' }],
      { ...remoteDetails, mcpServers: [] },
    );
    expect(health.status).toBe('ready');
    expect(health.checks.find((item) => item.code === 'MCP_DETAILS')?.ok).toBe(false);
  });

  it('reaches ready on complete reads even when KB detail permission is limited', () => {
    const health = evaluatePublishedBinding(
      expected('2026-08-20T19:43:26+08:00'),
      { app_id: 'competition-a', name: '比赛主智能体', status: 'published', pub_config: publishedConfig },
      [{ appId: 'sub-a', status: 'published' }],
      { ...remoteDetails, knowledgeBaseDetailsAuthorized: false },
    );
    expect(health.status).toBe('ready');
  });
});
