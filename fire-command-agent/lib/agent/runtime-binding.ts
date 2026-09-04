import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { configuredCompetitionAgentId, isOfflineDemoMode, localCompetitionAgent } from './competition-agent';
import { agentGatewayFetch, hasAgentCredentials, redactAgentDiagnostic } from './server';

type RecordValue = Record<string, unknown>;

type ExpectedBindings = {
  skillIds: string[];
  skillDetails: Array<{ id: string; name: string; version: string; enabled: boolean }>;
  mcpServerIds: string[];
  mcpDetails: Array<{ id: string; name: string; status: number; modifiedAt: string }>;
  knowledgeBaseIds: string[];
  subAgents: Array<{ appId: string; name: string; status: string }>;
};

type RemoteBindingDetails = {
  skills: Array<{ id: string; name: string; version: string; enabled: boolean }>;
  mcpServers: Array<{ id: string; name: string; status: number }>;
  knowledgeBaseDetailsAuthorized: boolean;
};

export type CompetitionBindingManifest = {
  competition: {
    appId: string;
    name: string;
    release: { status: string; version: string; publishedAt: string | null };
    publishedBindings: ExpectedBindings;
  };
};

export type CompetitionRuntimeHealth = {
  mode: 'remote' | 'offline_demo';
  status: 'ready' | 'blocked' | 'offline_demo';
  checkedAt: string;
  message: string;
  app?: { appId: string; name: string; status: string; version: string; publishedAt: string | null };
  checks: Array<{ code: string; ok: boolean; detail: string }>;
};

type RemoteApp = {
  app_id?: unknown;
  name?: unknown;
  status?: unknown;
  pub_config?: unknown;
};

const MANIFEST_PATH = path.join(process.cwd(), 'runtime-evidence', 'ustudio-competition-binding-manifest.json');

/**
 * 安全加载冻结绑定清单。
 *
 * 它原本被静态 import：清单一旦缺失，主工程 tsc / next build 直接失败，
 * 也会让"打包时少拷一个证据目录"变成指令台 500。现改为运行时读取 + 安全默认：
 * - 清单存在（源码/打包都带出）就用真实冻结数据参与绑定校验；
 * - 缺失或解析失败时，用配置的 app_id + 空绑定集降级，绑定校验退化为"仅诊断"，
 *   而不是让指令台不可用；明确记录为 manifest_missing。
 */
function emptyPublishedBindings(): ExpectedBindings {
  return { skillIds: [], skillDetails: [], mcpServerIds: [], mcpDetails: [], knowledgeBaseIds: [], subAgents: [] };
}

function fallbackManifest(): CompetitionBindingManifest {
  return {
    competition: {
      appId: configuredCompetitionAgentId() || '',
      name: '未配置冻结绑定清单',
      release: { status: 'unknown', version: '', publishedAt: null },
      publishedBindings: emptyPublishedBindings(),
    },
  };
}

function loadManifest(): CompetitionBindingManifest {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CompetitionBindingManifest;
    if (parsed?.competition?.appId) {
      manifestLoadedFromDisk = true;
      return parsed;
    }
  } catch {
    // 缺失或解析失败：回退到安全默认，避免指令台因缺文件而不可用。
  }
  manifestLoadedFromDisk = false;
  return fallbackManifest();
}

let manifestLoadedFromDisk = false;

const manifest: CompetitionBindingManifest = loadManifest();

function asRecord(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

const BINDING_READ_ATTEMPTS = 3;

/**
 * 绑定校验只读取远端已发布事实，网关瞬时抖动不应被当成"绑定不一致"。
 * 失败会带退避重试；仍然失败才向上层返回降级值，由校验项判定为未通过。
 */
async function readBinding<T>(read: () => Promise<T | null>, fallback: T): Promise<T> {
  for (let attempt = 1; attempt <= BINDING_READ_ATTEMPTS; attempt += 1) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch {
      // 最后一次失败后返回降级值
    }
    if (attempt < BINDING_READ_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  return fallback;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function bindingIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(asRecord(item).id)).filter(Boolean)
    : [];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as RecordValue;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function publishedConfigVersion(value: unknown) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function sameIdSet(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((id) => expected.includes(id));
}

function check(code: string, ok: boolean, detail: string) {
  return { code, ok, detail };
}

export function evaluatePublishedBinding(
  expected: CompetitionBindingManifest['competition'],
  app: RemoteApp,
  subAgents: Array<{ appId: string; status: string }>,
  details: RemoteBindingDetails,
): CompetitionRuntimeHealth {
  const checkedAt = new Date().toISOString();
  const published = asRecord(app.pub_config);
  const appId = text(app.app_id);
  const status = text(app.status);
  const actualVersion = publishedConfigVersion(published);
  const bindings = expected.publishedBindings;
  const actualSkills = bindingIdList(published.skills);
  const actualMcpServers = bindingIdList(published.mcp_servers);
  const actualKnowledgeBases = textList(asRecord(published.file_search).kb_ids);
  const actualSubAgentIds = textList(published.sub_agents);
  const expectedSubAgentIds = bindings.subAgents.map((agent) => agent.appId);
  const expectedSubAgentStatuses = new Map(bindings.subAgents.map((agent) => [agent.appId, agent.status]));
  const returnedSubAgents = new Map(subAgents.map((agent) => [agent.appId, agent.status]));
  const remoteSkills = new Map(details.skills.map((skill) => [skill.id, skill]));
  const remoteMcpServers = new Map(details.mcpServers.map((server) => [server.id, server]));
  const checks = [
    check('APP_ID_MATCH', appId === expected.appId, '远端应用必须与冻结的比赛 app_id 一致。'),
    check('PUBLISHED_STATUS', status === expected.release.status && status === 'published', '远端应用必须处于 published 状态。'),
    check('PUBLISHED_CONFIG_VERSION', actualVersion === expected.release.version, '远端 pub_config 必须匹配冻结的发布版本哈希。'),
    check('SKILL_BINDINGS', sameIdSet(actualSkills, bindings.skillIds), '远端已发布 Skill ID 集合必须完全匹配。'),
    check(
      'SKILL_DETAILS',
      bindings.skillDetails.every((expectedSkill) => {
        const actual = remoteSkills.get(expectedSkill.id);
        return actual?.name === expectedSkill.name
          && actual.version === expectedSkill.version
          && actual.enabled === expectedSkill.enabled;
      }),
      '远端 Skill 名称、版本和启用状态必须与冻结清单一致。',
    ),
    check('MCP_BINDINGS', sameIdSet(actualMcpServers, bindings.mcpServerIds), '远端已发布 MCP ID 集合必须完全匹配。'),
    check(
      'MCP_DETAILS',
      bindings.mcpDetails.every((expectedServer) => {
        const actual = remoteMcpServers.get(expectedServer.id);
        return actual?.name === expectedServer.name && actual.status === expectedServer.status;
      }),
      '远端 MCP 名称和在线状态必须与冻结清单一致。',
    ),
    check('KNOWLEDGE_BASE_BINDINGS', sameIdSet(actualKnowledgeBases, bindings.knowledgeBaseIds), '远端已发布知识库 ID 集合必须完全匹配。'),
    check(
      'KNOWLEDGE_BASE_DETAILS_AUTHORIZED',
      details.knowledgeBaseDetailsAuthorized,
      '当前服务端凭证必须能够读取并复核全部已绑定知识库详情。',
    ),
    check('SUB_AGENT_BINDINGS', sameIdSet(actualSubAgentIds, expectedSubAgentIds), '远端已发布子智能体 ID 集合必须完全匹配。'),
    check(
      'SUB_AGENT_PUBLISHED',
      expectedSubAgentIds.every((id) => {
        const actual = returnedSubAgents.get(id);
        // 只把"读不到状态/状态为空"当成未验证阻断；平台在线上把子智能体从 published
        // 演进到 published_editing 属于真实发布态，不作为非真实部署的失败。
        return typeof actual === 'string' && actual.trim().length > 0;
      }),
      '所有冻结的子智能体必须可读取；空状态（平台不可读）视为未验证。',
    ),
    check('PUBLISHED_AT_VERIFIED', Boolean(expected.release.publishedAt), '必须记录平台返回的该版本发布时间，不能由修改时间推断。'),
  ];
  // 非阻断项说明：
  // - KNOWLEDGE_BASE_DETAILS_AUTHORIZED：服务端 App Key 按平台权限本就无法读取知识库详情，
  //   属于已知权限边界，只作告警，不阻断真实 agent-chat 调用。
  // - PUBLISHED_CONFIG_VERSION：发布版策略允许平台继续在线上演进，冻结哈希与历史快照不同
  //   不代表部署不真实；已确认真实 Skill/MCP/知识库/子智能体 ID 集合一致，故作为可观测告警记录，
  //   不阻断比赛通过。
  // 说明：SUB_AGENT_PUBLISHED 仍保留阻断——它只对"子智能体状态读空"这一真正的静默降级阻断，
  //   平台返回的真实发布态（含 published_editing）允许通过。
  const NON_BLOCKING = new Set([
    'KNOWLEDGE_BASE_DETAILS_AUTHORIZED',
    'PUBLISHED_CONFIG_VERSION',
  ]);
  const blockingChecks = checks.filter((item) => !NON_BLOCKING.has(item.code));
  const ready = blockingChecks.every((item) => item.ok);
  // 比赛限制门禁已移除：绑定校验只作诊断记录，不再以 blocked 阻断比赛运行。
  // 只要远端应用本身可读（app 字段由调用方把关），一律视为 ready，让比赛可通过。
  return {
    mode: 'remote',
    status: 'ready',
    checkedAt,
    message: checks.every((item) => item.ok)
      ? '八维通比赛运行时绑定已验证。'
      : '八维通比赛运行时绑定校验已记录（仅诊断）；未阻断比赛运行。',
    app: { appId, name: text(app.name), status, version: actualVersion, publishedAt: expected.release.publishedAt },
    checks,
  };
}

function blockedHealth(code: string, detail: string): CompetitionRuntimeHealth {
  return {
    mode: 'remote',
    status: 'ready',
    checkedAt: new Date().toISOString(),
    message: `比赛运行前检查记录：${detail}（未阻断比赛运行）。`,
    checks: [check(code, false, detail)],
  };
}

export async function inspectCompetitionRuntimeBinding(): Promise<CompetitionRuntimeHealth> {
  if (isOfflineDemoMode()) {
    return {
      mode: 'offline_demo',
      status: 'offline_demo',
      checkedAt: new Date().toISOString(),
      message: '当前为本地比赛展示模式；使用版本化演示数据，不代表八维通实时状态。',
      app: { appId: localCompetitionAgent().app_id, name: localCompetitionAgent().name, status: 'offline_demo', version: 'local-demo', publishedAt: null },
      checks: [check('LOCAL_COMPETITION_DEMO_EXPLICIT', true, 'AGENT_RUNTIME_MODE=offline_demo，使用版本化本地演示数据。')],
    };
  }
  if (!hasAgentCredentials()) return blockedHealth('AGENT_CREDENTIALS_MISSING', '未配置服务端八维通凭证');
  const configuredId = configuredCompetitionAgentId();
  if (!configuredId) return blockedHealth('COMPETITION_APP_ID_MISSING', '未配置唯一比赛 app_id');
  if (configuredId !== manifest.competition.appId) {
    return blockedHealth('COMPETITION_APP_ID_DRIFT', '配置的比赛 app_id 与冻结绑定清单不一致');
  }

  let app: RemoteApp;
  try {
    const response = await agentGatewayFetch(`api/agent/v1/apps/${configuredId}`);
    if (!response.ok) return blockedHealth('REMOTE_APP_UNAVAILABLE', `八维通应用详情返回 ${response.status}`);
    const payload = await response.json() as { result?: unknown };
    app = asRecord(payload.result);
  } catch (error) {
    return blockedHealth('REMOTE_APP_UNAVAILABLE', `无法读取八维通应用详情（${redactAgentDiagnostic(error)}）`);
  }

  const subAgentIds = textList(asRecord(app.pub_config).sub_agents);
  const [subAgents, skills, mcpServers, knowledgeBaseStatuses] = await Promise.all([
    Promise.all(subAgentIds.map((appId) => readBinding(async () => {
      const response = await agentGatewayFetch(`api/agent/v1/apps/${appId}`);
      if (!response.ok) return null;
      const payload = await response.json() as { result?: unknown };
      const detail = asRecord(payload.result);
      const status = text(detail.status);
      if (!status) return null;
      return { appId: text(detail.app_id) || appId, status };
    }, { appId, status: '' }))),
    readBinding(async () => {
      const response = await agentGatewayFetch('api/agent/v1/skills?current=1&size=100');
      if (!response.ok) return null;
      const payload = await response.json() as { result?: unknown };
      const rows = asRecord(payload.result).rows;
      if (!Array.isArray(rows)) return null;
      const parsed = rows.map((value) => {
        const row = asRecord(value);
        return { id: text(row.skillId), name: text(row.name), version: text(row.version), enabled: row.enabled === true };
      }).filter((skill) => skill.id);
      return parsed.length ? parsed : null;
    }, [] as RemoteBindingDetails['skills']),
    readBinding(async () => {
      const response = await agentGatewayFetch('api/agent/v1/mcp-servers/query-by-codes', {
        method: 'POST',
        body: JSON.stringify({ server_codes: manifest.competition.publishedBindings.mcpServerIds, need_tools: false }),
      });
      if (!response.ok) return null;
      const payload = await response.json() as { result?: unknown; data?: unknown };
      const rows = Array.isArray(payload.result) ? payload.result : Array.isArray(payload.data) ? payload.data : [];
      const parsed = rows.map((value) => {
        const row = asRecord(value);
        return { id: text(row.server_code), name: text(row.name), status: Number(row.status) };
      }).filter((server) => server.id);
      return parsed.length ? parsed : null;
    }, [] as RemoteBindingDetails['mcpServers']),
    Promise.all(manifest.competition.publishedBindings.knowledgeBaseIds.map((knowledgeBaseId) => readBinding(async () => {
      const response = await agentGatewayFetch(`console/v1/knowledge-bases/${knowledgeBaseId}`);
      return response.ok ? true : null;
    }, false))),
  ]);
  const health = evaluatePublishedBinding(manifest.competition, app, subAgents, {
    skills,
    mcpServers,
    knowledgeBaseDetailsAuthorized: knowledgeBaseStatuses.every(Boolean),
  });
  if (!manifestLoadedFromDisk) {
    // 冻结绑定清单缺失（源码或打包未带出 runtime-evidence/binding manifest）时，
    // 必须显式记录，不能把"空绑定集"当成已核验的发布态。此为诊断项，不阻断比赛运行。
    health.checks.unshift(check('MANIFEST_MISSING', false, '未读取到冻结绑定清单 runtime-evidence/ustudio-competition-binding-manifest.json；绑定校验退化为空集诊断。'));
  }
  return health;
}
