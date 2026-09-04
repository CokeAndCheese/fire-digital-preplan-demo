import { getRuntimeConfig } from './app-key';

export type UStudioApiResponse<T> = {
  success: boolean;
  code: string;
  message: string;
  result: T;
};

export type UStudioSceneSummary = {
  scene_id: string;
  scene_name?: string;
  cover_page_path?: string;
  out_scene_id?: string;
  out_scene_name?: string;
};

export type SceneBootstrap = {
  scene: UStudioSceneSummary;
  sceneCount: number;
  /** 全部场景（用于前端切换下拉框）。 */
  scenes: UStudioSceneSummary[];
};

export type EmptySceneBootstrap = {
  empty: true;
  message: string;
  scene: null;
  sceneCount: 0;
  /** 全部场景（用于前端切换下拉框）。空态下固定为空数组。 */
  scenes: UStudioSceneSummary[];
};

export type SceneBootstrapResponse = SceneBootstrap | EmptySceneBootstrap;

const RUNTIME_CONFIG = getRuntimeConfig();
const X_APP_KEY = RUNTIME_CONFIG.appKey;
const USTUDIO_GATEWAY = RUNTIME_CONFIG.hostUrl;
const HTTP_BASE_URL = (process.env.USTUDIO_HTTP_BASE_URL || USTUDIO_GATEWAY + '/dt-ustudio-service')
  .trim()
  .replace(/\/+$/, '');
const ASSET_BASE_URL = (process.env.USTUDIO_ASSET_BASE_URL || USTUDIO_GATEWAY).trim().replace(/\/+$/, '');

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export type UStudioRequestMeta = {
  endpoint: string;
  upstreamUrl: string;
  upstreamMethod: 'POST';
  upstreamParams: unknown;
  xAppKey: string;
};

export class UStudioRequestError extends Error {
  endpoint: string;
  upstreamUrl: string;
  upstreamMethod: 'POST';
  upstreamParams: unknown;
  xAppKey: string;
  upstreamStatus?: number;
  upstreamStatusText?: string;
  upstreamResponse?: unknown;

  constructor(
    message: string,
    meta: UStudioRequestMeta,
    options: { status?: number; statusText?: string; response?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'UStudioRequestError';
    this.endpoint = meta.endpoint;
    this.upstreamUrl = meta.upstreamUrl;
    this.upstreamMethod = meta.upstreamMethod;
    this.upstreamParams = meta.upstreamParams;
    this.xAppKey = meta.xAppKey;
    this.upstreamStatus = options.status;
    this.upstreamStatusText = options.statusText;
    this.upstreamResponse = options.response;
    if (options.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

/** 凭据脱敏：只保留前 4 位，其余以 *** 代替，避免 App Key 进入日志/回执。 */
function maskKey(value: string): string {
  if (!value) return '';
  return value.length <= 4 ? `${value[0] ?? ''}***` : `${value.slice(0, 4)}***`;
}

export function describeUStudioError(error: unknown) {
  if (!(error instanceof UStudioRequestError)) return null;
  return {
    endpoint: error.endpoint,
    upstreamUrl: error.upstreamUrl,
    upstreamMethod: error.upstreamMethod,
    upstreamParams: error.upstreamParams,
    upstreamStatus: error.upstreamStatus,
    upstreamStatusText: error.upstreamStatusText,
    upstreamResponse: error.upstreamResponse,
    xAppKey: maskKey(error.xAppKey),
  };
}

export function isEmptySceneBootstrap(bootstrap: SceneBootstrapResponse): bootstrap is EmptySceneBootstrap {
  return (bootstrap as EmptySceneBootstrap).empty === true;
}

function createEmptySceneBootstrap(message = 'ustudio 场景列表为空。'): EmptySceneBootstrap {
  return {
    empty: true,
    message,
    scene: null,
    sceneCount: 0,
    scenes: [],
  };
}

function createRequestMeta(endpoint: string, body: unknown): UStudioRequestMeta {
  return {
    endpoint,
    upstreamUrl: joinUrl(HTTP_BASE_URL, endpoint),
    upstreamMethod: 'POST',
    upstreamParams: body ?? {},
    xAppKey: X_APP_KEY,
  };
}

export function joinAssetUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return new URL(path.replace(/^\/+/, ''), `${ASSET_BASE_URL}/`).toString();
}

// 后端间歇性卡死（约 40% 请求长时间无响应，其余 2-6s 正常）。单次设较短超时快速判定卡死，
// 卡死/网络错误时自动重试几次——大概率命中正常的那批（3 次重试成功率 ~94%）。
const USTUDIO_TIMEOUT_MS = 12000;
const USTUDIO_MAX_ATTEMPTS = 4;

async function fetchOnce(endpoint: string, bodyStr: string, upstreamUrl = joinUrl(HTTP_BASE_URL, endpoint)): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), USTUDIO_TIMEOUT_MS);
  try {
    let bodyForLog: unknown = bodyStr;
    try {
      bodyForLog = JSON.parse(bodyStr) as unknown;
    } catch {
      /* keep raw bodyStr */
    }
    console.info('[ustudio] request', {
      url: upstreamUrl,
      method: 'POST',
      xAppKey: maskKey(X_APP_KEY),
      body: bodyForLog,
    });
    return await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': X_APP_KEY },
      body: bodyStr,
      cache: 'no-store',
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 底层 POST 逃生口（含 12s 超时 + 4 次重试）。优先用上面/下面封装好的具名 SDK 函数；
 * 仅当某 ustudio 端点还没封装时，在服务端 route 里用它直接调（appKey 已内置，勿在浏览器用）。
 */
export async function postUStudio<TRequest, TResult>(endpoint: string, body: TRequest) {
  const requestBody = body ?? {};
  const bodyStr = JSON.stringify(requestBody);
  const meta = createRequestMeta(endpoint, requestBody);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= USTUDIO_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchOnce(endpoint, bodyStr, meta.upstreamUrl);
      const payload = (await response.json()) as UStudioApiResponse<TResult>;
      if (!response.ok || !payload.success) {
        throw new UStudioRequestError(payload.message || `ustudio request failed: ${endpoint}`, meta, {
          status: response.status,
          statusText: response.statusText,
          response: payload,
        });
      }
      return payload.result;
    } catch (e) {
      lastErr = e;
      if (e instanceof UStudioRequestError) throw e;
      const timedOut = (e as Error)?.name === 'AbortError';
      const networkErr = e instanceof TypeError;
      if ((timedOut || networkErr) && attempt < USTUDIO_MAX_ATTEMPTS) {
        console.warn(`[ustudio] ${endpoint} 第${attempt}次${timedOut ? '超时' : '网络错误'}，重试…`, {
          url: meta.upstreamUrl,
          method: meta.upstreamMethod,
          xAppKey: maskKey(meta.xAppKey),
          params: meta.upstreamParams,
        });
        continue;
      }
      const message = timedOut
        ? `ustudio 接口 ${endpoint} 连续 ${USTUDIO_MAX_ATTEMPTS} 次超时，后端不可用，请稍后重试。`
        : e instanceof Error
          ? e.message
          : String(e ?? `ustudio request failed: ${endpoint}`);
      throw new UStudioRequestError(message, meta, { cause: e });
    }
  }
  throw lastErr;
}

export async function getSceneBootstrap(input: { sceneId?: string; sceneName?: string } = {}): Promise<SceneBootstrapResponse> {
  const rows = await postUStudio<{ scene_name?: string }, unknown>(
    '/api/twins/scene/v1/list',
    { scene_name: input.sceneName },
  );
  const scenes = Array.isArray(rows) ? (rows as UStudioSceneSummary[]) : [];

  const requestedSceneId = input.sceneId?.trim();
  let scene = requestedSceneId
    ? scenes.find((item) => item.scene_id === requestedSceneId)
    : undefined;
  if (!scene && input.sceneName) {
    const matched = scenes.filter((item) => item.scene_name?.includes(input.sceneName!));
    if (matched.length > 1) {
      throw new Error(`场景名称 "${input.sceneName}" 匹配到多个场景，请传入 sceneId。`);
    }
    scene = matched[0];
  }
  scene ??= scenes[0];

  if (!scene) {
    return createEmptySceneBootstrap();
  }

  return {
    scene,
    sceneCount: scenes.length,
    scenes,
  };
}

/**
 * 解析场景 ID：给了就用；没给（或空）→ 自动用当前加载的场景（getSceneBootstrap 取 scene_id）。
 * 这样面板即使没把 sceneId 传进来，服务端也能拿到真实场景，**永不"场景 ID 未配置"**。
 * 前端拿 sceneId 用 `useSceneId()`（lib/useSceneId）传进来更准（跟随切场景）；不传则走这里兜底。
 */
async function resolveSceneId(sceneId?: string): Promise<string> {
  if (sceneId && sceneId.trim()) return sceneId;
  const boot = await getSceneBootstrap();
  if (isEmptySceneBootstrap(boot)) throw new Error(boot.message);
  return boot.scene.scene_id;
}

/* ──────────────────────────────────────────────────────────────────────────
 * 实例层 SDK（运行时数据访问）
 *
 * 边界（见 docs/空间编程MCP-SDK与提速设计.md）：
 *   · 类型 / 定义（有哪些本体、属性、方法、关系）→ 设计时用 MCP 发现，别在这里查；
 *   · 实例 / 值（具体实例、数据、层级、路径）→ 运行时走下面这些 SDK 函数。
 * 全部复用上面的 postUStudio（12s 超时 + 4 次重试，治后端间歇卡死）。
 * JSON 字段用 snake_case，与 getSceneBootstrap / 服务端 Jackson 策略一致。
 * 返回值随本体定义而变，统一松类型 Record；按需在调用处断言具体字段。
 * ────────────────────────────────────────────────────────────────────────── */

/** 实例属性项。值优先用 property_format_value（已格式化），回退 property_value。 */
export type TwinsInstanceProperty = {
  twins_property_identifier: string; // 属性标识（要知道哪个是「状态」等，查本体定义 getTwinsDefinitionDetail）
  property_value?: string;
  property_format_value?: string;
  property_unit?: string;
  property_type?: string;
};
/**
 * 孪生体实例（listTwinsInstances 返回）。字段为 snake_case（与服务端 @JsonProperty 一致）。
 * 渲染面板时：展示名→twins_instance_name；分组/聚合→twins_identifier 或 twins_name；
 * 属性值→twins_instance_property_list；联动 3D（window.__scene.fly/heighLight）→ **out_instance_id**。
 * 别用 name/status/id 这种猜的字段——服务端没有，会全是空。
 */
/** 归一化属性项（identifier/value 一定有，免去猜字段）。 */
export type NormalizedProperty = {
  identifier: string; // = twins_property_identifier
  value: string; // = property_value
  formatValue: string; // = property_format_value（优先展示，回退 value）
  unit: string; // = property_unit
};
/**
 * 孪生体实例（listTwinsInstances 已归一化）。**直接用干净字段，别猜：**
 *   id（=out_instance_id，window.__scene.fly/heighLight 用它）/ name（展示名）/
 *   type（本体标识，分组聚合用）/ typeName（类型中文名）/ properties（属性数组）。
 * 原始 snake_case 字段也一并保留（兼容）。属性的中文标签 / 某 identifier 的含义 →
 * 查本体定义 getTwinsDefinitionDetail 的 metadata。
 */
export type TwinsInstance = {
  id: string;
  name: string;
  type: string;
  typeName: string;
  properties: NormalizedProperty[];
  // —— 原始字段（snake_case，需要时取）——
  twins_instance_id: string;
  twins_instance_name: string;
  twins_identifier: string;
  twins_id: string;
  twins_type?: string;
  twins_name?: string;
  geometry_type?: string;
  out_instance_id: string;
  sid?: string;
  twins_instance_property_list?: TwinsInstanceProperty[];
  [k: string]: unknown;
};
/** 坐标点（最短路径 source/target）。按场景坐标系给 x/y/z。 */
export type GeoLocation = { x?: number; y?: number; z?: number; [k: string]: unknown };

/** 把服务端 snake_case 实例归一化成干净字段（+ 保留原始字段）。 */
function normalizeInstance(r: Record<string, unknown>): TwinsInstance {
  const rawProps = Array.isArray(r.twins_instance_property_list)
    ? (r.twins_instance_property_list as TwinsInstanceProperty[])
    : [];
  return {
    ...r,
    id: String(r.out_instance_id ?? r.twins_instance_id ?? ''),
    name: String(r.twins_instance_name ?? ''),
    type: String(r.twins_identifier ?? ''),
    typeName: String(r.twins_name ?? ''),
    properties: rawProps.map((p) => ({
      identifier: String(p.twins_property_identifier ?? ''),
      value: String(p.property_value ?? ''),
      formatValue: String(p.property_format_value ?? p.property_value ?? ''),
      unit: String(p.property_unit ?? ''),
    })),
  } as TwinsInstance;
}

/**
 * ⚠️ 用户标注层实例（user-twins-instances），**不是**「场景全部设备本体」。
 * 只返回用户在场景里手画/额外添加的孪生体——Line 路线 / Polygon 多边形 / 标记点等标注层。
 * 模型自带的设备本体（消火栓/风机/报警器…）不在这里，在 getSceneInstanceTree 的层级树里。
 *
 * 要「场景里有哪些设备本体」→ 用 getSceneInstanceTree（拿到树自己拍平/按 node.type 过滤）。
 * 本函数只在你确实要「用户画的路线/多边形标注」时用。已归一化；excludeTwinsIdentifiers 可排除某些类型。
 */
export async function listTwinsInstances(input: {
  sceneId?: string;
  excludeTwinsIdentifiers?: string[];
} = {}): Promise<TwinsInstance[]> {
  const sceneId = await resolveSceneId(input.sceneId);
  const rows = await postUStudio<
    { scene_id: string; exclude_twins_identifiers?: string[] },
    Record<string, unknown>[]
  >('/api/twins/scene/v1/user-twins-instances', {
    scene_id: sceneId,
    exclude_twins_identifiers: input.excludeTwinsIdentifiers,
  });
  return (Array.isArray(rows) ? rows : []).map(normalizeInstance);
}

/**
 * 场景实例树节点（getSceneInstanceTree 已归一化）。**直接用干净字段，别猜：**
 *   id（=out_instance_id，window.__scene.fly/heighLight 用它）/ name（展示名）/
 *   type（本体标识，分组用）/ children（子节点，递归）。原始 snake_case 字段也保留。
 */
export type SceneTreeNode = {
  id: string;
  name: string;
  type: string;
  children: SceneTreeNode[];
  // —— 原始字段（snake_case，需要时取）——
  twins_instance_id: string;
  twins_instance_name: string;
  twins_identifier: string;
  out_instance_id: string;
  parent_out_instance_id?: string;
  source?: string;
  [k: string]: unknown;
};

/** 递归把服务端 snake_case 树节点归一化（名=twins_instance_name，id=out_instance_id，类型=twins_identifier）。 */
function normalizeTreeNode(r: Record<string, unknown>): SceneTreeNode {
  const kids = Array.isArray(r.children) ? (r.children as Record<string, unknown>[]) : [];
  return {
    ...r,
    id: String(r.out_instance_id ?? r.twins_instance_id ?? ''),
    name: String(r.twins_instance_name ?? ''),
    type: String(r.twins_identifier ?? ''),
    children: kids.map(normalizeTreeNode),
  } as SceneTreeNode;
}

/**
 * 场景实例树（按层级：楼栋 / 楼层 / 空间 / 设备本体，已归一化）。返回根节点，children 递归。
 * **这才是「场景全部设备本体」的来源**——设备本体（消火栓/风机/报警器…）挂在空间下面、是叶子。
 * 做「设备清单/统计/楼层分布」用它：拿到树自己递归拍平叶子、按本场景实际的 node.type 过滤成要的设备
 *（容器/结构如 Space/Wall/Window/Door 按需排掉）。node 已归一化：直接用 node.id/name/type/children。
 */
export async function getSceneInstanceTree(input: {
  sceneId?: string;
  excludeTwinsIdentifiers?: string[];
} = {}): Promise<SceneTreeNode> {
  const sceneId = await resolveSceneId(input.sceneId);
  const root = await postUStudio<{ scene_id: string; exclude_twins_identifiers?: string[] }, Record<string, unknown>>(
    '/api/twins/scene/v1/instance-tree',
    { scene_id: sceneId, exclude_twins_identifiers: input.excludeTwinsIdentifiers },
  );
  return normalizeTreeNode(root ?? {});
}

/** 单个实例详情（含属性当前值）。 */
export function getTwinsInstanceDetail(input: { twinsInstanceId: string }) {
  return postUStudio<{ twins_instance_id: string }, Record<string, unknown>>(
    '/api/twins/twins-instance/v1/detail',
    { twins_instance_id: input.twinsInstanceId },
  );
}

/** 最短路径（source / target 为坐标点；costModel 可选成本模型）。sceneId 不传自动用当前场景。 */
export async function findShortestPath(input: { sceneId?: string; source: GeoLocation; target: GeoLocation; costModel?: unknown }) {
  const sceneId = await resolveSceneId(input.sceneId);
  return postUStudio<{ scene_id: string; source: GeoLocation; target: GeoLocation; cost_model?: unknown }, Record<string, unknown>>(
    '/api/kgraph/v1/shortest-path',
    { scene_id: sceneId, source: input.source, target: input.target, cost_model: input.costModel },
  );
}

/** 可达图（从若干楼层 / 空间节点出发的可达关系）。sceneId 不传自动用当前场景。 */
export async function getReachableGraph(input: { sceneId?: string; storyNodeIds: string[]; nodeId?: string }) {
  const sceneId = await resolveSceneId(input.sceneId);
  return postUStudio<{ scene_id: string; story_node_ids: string[]; node_id?: string }, Record<string, unknown>>(
    '/api/kgraph/v1/get-reachable-graph',
    { scene_id: sceneId, story_node_ids: input.storyNodeIds, node_id: input.nodeId },
  );
}

/** 空间连通图（从若干楼层 / 空间节点出发的连通关系）。sceneId 不传自动用当前场景。 */
export async function getSpaceReachableGraph(input: { sceneId?: string; storyNodeIds: string[]; spaceId?: string }) {
  const sceneId = await resolveSceneId(input.sceneId);
  return postUStudio<{ scene_id: string; story_node_ids: string[]; space_id?: string }, Record<string, unknown>>(
    '/api/kgraph/v1/get-space-reachable-graph',
    { scene_id: sceneId, story_node_ids: input.storyNodeIds, space_id: input.spaceId },
  );
}

/**
 * 运行时按值查（Cypher）。注意：**设计时探结构 / 关系请用 MCP 的 cypherQuery**（让大模型现场生成）；
 * 这里是给生成出来的应用在运行时按已知模式查值用的。
 */
export async function queryCypher(input: { sceneId?: string; cypher: string }) {
  const sceneId = await resolveSceneId(input.sceneId);
  return postUStudio<{ scene_id: string; cypher: string }, Record<string, unknown>>(
    '/api/kgraph/v1/cypher-query',
    { scene_id: sceneId, cypher: input.cypher },
  );
}

export type UserSceneInstance = TwinsInstance & {
  model_url?: string;
  twins_model_url?: string;
  display?: boolean;
};

function normalizeAssetFields<T extends Record<string, unknown>>(item: T): T {
  const rawUrl = item.model_url ?? item.twins_model_url ?? item.url;
  if (typeof rawUrl === 'string' && rawUrl.trim()) {
    const assetUrl = joinAssetUrl(rawUrl);
    return { ...item, model_url: assetUrl, twins_model_url: assetUrl };
  }
  return item;
}

export async function listUserSceneInstances(input: { sceneId?: string } = {}): Promise<UserSceneInstance[]> {
  const sceneId = await resolveSceneId(input.sceneId);
  const rows = await postUStudio<{ scene_id: string }, Record<string, unknown>[]>(
    '/api/twins/scene/v1/user-twins-instances',
    { scene_id: sceneId },
  );
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeAssetFields(row))
    .map(normalizeInstance) as UserSceneInstance[];
}

function valueOf(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return '';
}

function normalizeArrayPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['list', 'rows', 'records', 'items', 'data']) {
    const value = obj[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }
  return [];
}

function normalizeGraphSceneEdges(raw: unknown): Record<string, unknown>[] {
  const graph = (raw ?? {}) as Record<string, unknown>;
  const nodes = normalizeArrayPayload(graph.nodes);
  const edges = normalizeArrayPayload(graph.edges);
  const nodeMap = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    const nodeId = valueOf(node, ['node_id', 'id', 'twins_instance_id', 'out_instance_id']);
    if (nodeId) nodeMap.set(nodeId, node);
  }
  return edges
    .map((edge) => {
      const startNode = nodeMap.get(valueOf(edge, ['start_node_id', 'source_node_id', 'from_node_id']));
      const endNode = nodeMap.get(valueOf(edge, ['end_node_id', 'target_node_id', 'to_node_id']));
      const startOut = valueOf(edge, ['start_out_instance_id', 'source_out_instance_id', 'from_out_instance_id']) ||
        (startNode ? valueOf(startNode, ['out_instance_id', 'id']) : '');
      const endOut = valueOf(edge, ['end_out_instance_id', 'target_out_instance_id', 'to_out_instance_id']) ||
        (endNode ? valueOf(endNode, ['out_instance_id', 'id']) : '');
      return {
        ...edge,
        start_out_instance_id: startOut,
        end_out_instance_id: endOut,
      };
    })
    .filter((edge) => edge.start_out_instance_id && edge.end_out_instance_id);
}

export async function getReachableSceneEdges(input: {
  sceneId?: string;
  storyNodeIds: string[];
  nodeId?: string;
}): Promise<Record<string, unknown>[]> {
  const raw = await getReachableGraph(input);
  return normalizeGraphSceneEdges(raw);
}

export async function getConnectivitySceneEdges(input: {
  sceneId?: string;
  storyNodeIds: string[];
  spaceId?: string;
}): Promise<Record<string, unknown>[]> {
  const raw = await getSpaceReachableGraph(input);
  return normalizeGraphSceneEdges(raw);
}

export async function listSceneRoutes(input: { sceneId?: string } = {}) {
  const sceneId = await resolveSceneId(input.sceneId);
  const payload = await postUStudio<{ scene_id: string }, unknown>('/api/twins/route/v1/list', { scene_id: sceneId });
  return normalizeArrayPayload(payload);
}

export async function getSceneRouteDetail(input: { sceneId?: string; routeId: string }) {
  const sceneId = await resolveSceneId(input.sceneId);
  return postUStudio<{ scene_id: string; route_id: string }, Record<string, unknown>>('/api/twins/route/v1/detail', {
    scene_id: sceneId,
    route_id: input.routeId,
  });
}

export async function listScenePolygons(input: { sceneId?: string } = {}) {
  const sceneId = await resolveSceneId(input.sceneId);
  const payload = await postUStudio<{ scene_id: string }, unknown>('/api/twins/polygon/v1/list', { scene_id: sceneId });
  return normalizeArrayPayload(payload);
}

export async function getScenePolygonDetail(input: { sceneId?: string; polygonId: string }) {
  const sceneId = await resolveSceneId(input.sceneId);
  return postUStudio<{ scene_id: string; polygon_id: string }, Record<string, unknown>>('/api/twins/polygon/v1/detail', {
    scene_id: sceneId,
    polygon_id: input.polygonId,
  });
}
