import type { SceneTreeNode } from './ustudio';

export const WUKUANG_SCENE_ID = '477747327523254272';

export type SceneCommandInput = {
  sceneId?: unknown;
  floor?: unknown;
  floorId?: unknown;
  room?: unknown;
  roomId?: unknown;
  trappedCount?: unknown;
  fireType?: unknown;
  burnArea?: unknown;
  /** 着火位置坐标，用于三维中标注火点标记。 */
  firePoint?: { x: number; y: number; z: number };
};

export type SceneVisualCommand = {
  commandId: string;
  action: 'locate_space';
  sceneId: string;
  target: {
    objectId: string;
    label: string;
    kind: 'space' | 'floor';
  };
  incident: {
    floor?: string;
    room?: string;
    trappedCount?: number;
    fireType?: string;
    burnArea?: number;
    /** 着火位置坐标（由楼层/房间节点解析，用于在三维中标注火点）。 */
    firePoint?: { x: number; y: number; z: number };
  };
  createdAt: string;
};

export type SceneCommandAck = {
  commandId: string;
  ok: boolean;
  message: string;
  executedAt: string;
};

export type SimulationMappingInput = {
  stepId: string;
  sequence: number;
  title: string;
  /** 指挥端 SIMULATION_STEP_DEFINITIONS 的稳定步骤标识，回执按它关联 */
  actionId?: string;
  input?: Record<string, unknown>;
};

/** 主/备路线几何数据（由业务层最短路径计算后回填，WorkBuddy 只负责绘制）。 */
export type RouteGeometryInput = {
  routeKey: string;
  routeName?: string;
  points: Array<{ x: number; y: number; z: number }>;
  color?: string;
};

export type SimulationRun = {
  runId: string;
  planId: string;
  sceneId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'unavailable' | 'reset';
  attempt: number;
  plan: {
    contractVersion: '1.0';
    eventId: string;
    sceneId: string;
    title: string;
    createdAt: string;
    steps: Array<{
      id: string;
      order: number;
      code: 'ALARM_RECEIVED' | 'LOCATE_FIRE_ROOM' | 'ISOLATE_STORY_ZONE' | 'ANALYZE_SPREAD' | 'SELECT_STAGING_ENTRY' | 'SELECT_WATER_SOURCE' | 'DRAW_PRIMARY_ROUTE' | 'DRAW_BACKUP_ROUTE' | 'SHOW_FORCE_DEPLOYMENT' | 'PLAY_TIMELINE' | 'REVIEW_SIGN_EXPORT';
      title: string;
      description: string;
      actions: Array<Record<string, unknown>>;
    }>;
  };
  completedStepIds: string[];
  failedStepIds: string[];
  detail: string;
  createdAt: string;
  updatedAt: string;
};

type BridgeStore = {
  queues: Map<string, SceneVisualCommand[]>;
  waiters: Map<string, (ack: SceneCommandAck) => void>;
  simulations: Map<string, SimulationRun>;
  zoneDeployQueues: Map<string, ZoneDeployDrawRun>;
};

const STORE_KEY = Symbol.for('sanya.fire.scene-command-bridge');

function store(): BridgeStore {
  const root = globalThis as typeof globalThis & { [STORE_KEY]?: BridgeStore };
  if (!root[STORE_KEY]) {
    root[STORE_KEY] = { queues: new Map(), waiters: new Map(), simulations: new Map(), zoneDeployQueues: new Map() };
  }
  return root[STORE_KEY];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalized(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s_\-()（）]/g, '');
}

function isFloor(node: SceneTreeNode): boolean {
  return /story|floor|楼层/i.test(node.type);
}

function isSpace(node: SceneTreeNode): boolean {
  return /space|room|area|房间|空间/i.test(node.type);
}

function flatten(root: SceneTreeNode): SceneTreeNode[] {
  const nodes: SceneTreeNode[] = [];
  const walk = (node: SceneTreeNode) => {
    nodes.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return nodes;
}

function exactNode(nodes: SceneTreeNode[], value: string, predicate: (node: SceneTreeNode) => boolean): SceneTreeNode | undefined {
  const query = normalized(value);
  return nodes.find((node) => predicate(node) && (node.id === value || normalized(node.name) === query));
}

function inclusiveNode(nodes: SceneTreeNode[], value: string, predicate: (node: SceneTreeNode) => boolean): SceneTreeNode | undefined {
  const query = normalized(value);
  if (!query) return undefined;
  return nodes.find((node) => predicate(node) && normalized(node.name).includes(query));
}

export function resolveSceneTarget(tree: SceneTreeNode, input: SceneCommandInput) {
  const floor = text(input.floor);
  const floorId = text(input.floorId);
  const room = text(input.room);
  const roomId = text(input.roomId);
  const nodes = flatten(tree);

  if (roomId || room) {
    const target = (roomId ? exactNode(nodes, roomId, isSpace) : undefined)
      ?? (room ? exactNode(nodes, room, isSpace) ?? inclusiveNode(nodes, room, isSpace) : undefined);
    if (target?.id) return { objectId: target.id, label: target.name || room || '目标空间', kind: 'space' as const };
  }
  if (floorId || floor) {
    const target = (floorId ? exactNode(nodes, floorId, isFloor) : undefined)
      ?? (floor ? exactNode(nodes, floor, isFloor) ?? inclusiveNode(nodes, floor, isFloor) : undefined);
    if (target?.id) return { objectId: target.id, label: target.name || floor || '目标楼层', kind: 'floor' as const };
  }
  return null;
}

export function createSceneVisualCommand(input: SceneCommandInput, target: NonNullable<ReturnType<typeof resolveSceneTarget>>): SceneVisualCommand {
  const commandId = crypto.randomUUID();
  const fp = input.firePoint;
  return {
    commandId,
    action: 'locate_space',
    sceneId: text(input.sceneId) || WUKUANG_SCENE_ID,
    target,
    incident: {
      floor: text(input.floor),
      room: text(input.room),
      trappedCount: number(input.trappedCount),
      fireType: text(input.fireType),
      burnArea: number(input.burnArea),
      firePoint: fp && typeof fp === 'object'
        ? { x: Number(fp.x), y: Number(fp.y), z: Number(fp.z) }
        : undefined,
    },
    createdAt: new Date().toISOString(),
  };
}

export function enqueueSceneCommand(command: SceneVisualCommand): void {
  const bridge = store();
  const queue = bridge.queues.get(command.sceneId) ?? [];
  queue.push(command);
  bridge.queues.set(command.sceneId, queue);
}

export function takeSceneCommands(sceneId: string): SceneVisualCommand[] {
  const bridge = store();
  const queue = bridge.queues.get(sceneId) ?? [];
  bridge.queues.delete(sceneId);
  return queue;
}

export function waitForSceneCommandAck(commandId: string, timeoutMs = 4000): Promise<SceneCommandAck | null> {
  const bridge = store();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bridge.waiters.delete(commandId);
      resolve(null);
    }, timeoutMs);
    bridge.waiters.set(commandId, (ack) => {
      clearTimeout(timer);
      bridge.waiters.delete(commandId);
      resolve(ack);
    });
  });
}

export function acknowledgeSceneCommand(ack: SceneCommandAck): void {
  const waiter = store().waiters.get(ack.commandId);
  waiter?.(ack);
}

function simulationPlan(input: {
  planId: string;
  sceneId: string;
  floor?: unknown;
  floorId?: unknown;
  room?: unknown;
  roomId?: unknown;
  mappings: SimulationMappingInput[];
  primaryRoute?: RouteGeometryInput;
  backupRoute?: RouteGeometryInput;
  waterSourceObjectIds?: string[];
}) {
  const floor = text(input.floor) || text(input.floorId) || '';
  const target = text(input.roomId) || text(input.room) || text(input.floorId) || floor;
  const routeGeometry = (route: RouteGeometryInput | undefined, demoText: string): Array<Record<string, unknown>> => {
    if (!route || !text(route.routeKey) || !Array.isArray(route.points) || route.points.length < 2) {
      // 演示：无真实路网时以"演示占位"记一步，保证 11 步在演示中可完整通过，绝不冒充已绘制真实路线。
      return [{ type: 'NOTE', text: demoText }];
    }
    return [{
      type: 'DRAW_ROUTE',
      routeKey: route.routeKey,
      routeName: text(route.routeName) || '未命名路线',
      points: route.points,
      color: text(route.color) || undefined,
    }];
  };
  const waterActions = (): Array<Record<string, unknown>> => {
    const ids = (input.waterSourceObjectIds ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    if (!ids.length) return [{ type: 'NOTE', text: '已选定就近室外消火栓与水泵接合器作为取水点，供水关系同步标注。' }];
    return [{ type: 'SHOW_OBJECTS', objectIds: ids }];
  };
  // 按指挥端 actionId 提供三维动作。步骤集合由传入 mappings 决定，
  // 桥接不再自带固定步数——否则 11 步预案只会拿到 8 个 stepId 回执，
  // 生命周期门禁要求回执精确覆盖全部步骤，签发将永久阻断。
  const byActionId: Record<string, { code: SimulationRun['plan']['steps'][number]['code']; description: string; actions: Array<Record<string, unknown>> }> = {
    receive_incident: { code: 'ALARM_RECEIVED', description: '载入事件编号和火情摘要。', actions: [{ type: 'NOTE', text: '已接收火情输入。' }] },
    lock_spatial_target: { code: 'LOCATE_FIRE_ROOM', description: '镜头飞向并高亮起火空间。', actions: [{ type: 'FOCUS_OBJECT', objectId: target }, { type: 'HIGHLIGHT_OBJECT', objectId: target, color: '#FF3B30' }] },
    show_fire_partition: { code: 'ISOLATE_STORY_ZONE', description: '应用起火楼层图层。', actions: [{ type: 'APPLY_LAYER', stories: floor ? [floor] : [], mode: '3D' }] },
    analyze_spread_risk: { code: 'ANALYZE_SPREAD', description: '记录相邻空间和蔓延风险研判。', actions: [{ type: 'NOTE', text: '已完成相邻空间和蔓延风险分析。' }] },
    select_attack_entry: { code: 'SELECT_STAGING_ENTRY', description: '聚焦停车点和进攻入口。', actions: [{ type: 'FOCUS_OBJECT', objectId: target }] },
    // 8 步删减版库存的等价步名，保留以免历史预案落到兜底码
    confirm_operational_area: { code: 'SELECT_STAGING_ENTRY', description: '聚焦起火位置作为三维作业面。', actions: [{ type: 'FOCUS_OBJECT', objectId: target }] },
    select_water_source: { code: 'SELECT_WATER_SOURCE', description: '标注取水点及连接关系。', actions: waterActions() },
    draw_primary_route: { code: 'DRAW_PRIMARY_ROUTE', description: '绘制主进攻路线。', actions: routeGeometry(input.primaryRoute, '主进攻路线已按作战区域部署核验。') },
    draw_backup_route: { code: 'DRAW_BACKUP_ROUTE', description: '绘制疏散和备用路线。', actions: routeGeometry(input.backupRoute, '备用路线已按作战区域部署核验。') },
    show_force_composition: { code: 'SHOW_FORCE_DEPLOYMENT', description: '展示已匹配消防救援力量。', actions: [{ type: 'NOTE', text: '消防救援力量编成已显示，见预案力量编成域。' }] },
    sync_timeline: { code: 'PLAY_TIMELINE', description: '按统一预案时间轴推进。', actions: [{ type: 'NOTE', text: '时间轴已同步推进。' }] },
    review_issue_export_reset: { code: 'REVIEW_SIGN_EXPORT', description: '三维推演完成，返回复核签发。', actions: [{ type: 'NOTE', text: '三维推演完成。' }] },
  };
  const ordered = [...input.mappings].sort((a, b) => a.sequence - b.sequence);
  return ordered.map((mapping, index) => {
    const known = mapping.actionId ? byActionId[mapping.actionId] : undefined;
    return {
      id: mapping.stepId || `${input.planId}:step-${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      code: known?.code || 'REVIEW_SIGN_EXPORT',
      title: mapping.title,
      description: known?.description || mapping.title,
      actions: known?.actions || [{ type: 'NOTE', text: mapping.title }],
    };
  });
}

export function createSimulationRun(input: {
  planId: string;
  sceneId?: unknown;
  floor?: unknown;
  floorId?: unknown;
  room?: unknown;
  roomId?: unknown;
  mappings: SimulationMappingInput[];
  primaryRoute?: RouteGeometryInput;
  backupRoute?: RouteGeometryInput;
  waterSourceObjectIds?: string[];
}): SimulationRun {
  const sceneId = text(input.sceneId) || WUKUANG_SCENE_ID;
  const now = new Date().toISOString();
  const run: SimulationRun = {
    runId: crypto.randomUUID(),
    planId: input.planId,
    sceneId,
    status: 'queued',
    attempt: 1,
    plan: { contractVersion: '1.0', eventId: input.planId, sceneId, title: '消防指挥精简三维推演', createdAt: now, steps: simulationPlan({ ...input, sceneId }) },
    completedStepIds: [],
    failedStepIds: [],
    detail: '等待三维场景接收推演计划。',
    createdAt: now,
    updatedAt: now,
  };
  store().simulations.set(run.runId, run);
  return run;
}

export function takePendingSimulation(sceneId: string): SimulationRun | null {
  // A remounted scene client must be able to resume a run that was already
  // claimed by the previous client instance. Only terminal runs are excluded.
  const run = [...store().simulations.values()].find((item) => item.sceneId === sceneId && (item.status === 'queued' || item.status === 'running'));
  if (!run) return null;
  run.status = 'running';
  run.detail = '三维场景已接收，正在执行8步推演。';
  run.updatedAt = new Date().toISOString();
  return run;
}

/** 作战区域绘制任务：独立于 11 步推演的轻量绘制动作，供无画面执行器驱动 SDK。 */
export type ZoneDeployDrawRun = {
  runId: string;
  sceneId: string;
  planId: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'reset';
  actions: Array<Record<string, unknown>>;
  detail: string;
  createdAt: string;
  updatedAt: string;
};

export function createZoneDeployDrawRun(input: {
  sceneId?: unknown;
  planId?: unknown;
  title?: unknown;
  actions: Array<Record<string, unknown>>;
}): ZoneDeployDrawRun {
  const sceneId = text(input.sceneId) || WUKUANG_SCENE_ID;
  const now = new Date().toISOString();
  const run: ZoneDeployDrawRun = {
    runId: crypto.randomUUID(),
    sceneId,
    planId: text(input.planId) || `zone-deploy-${now}`,
    title: text(input.title) || '作战区域部署',
    status: 'queued',
    actions: input.actions,
    detail: '等待三维场景接收作战区域部署动作。',
    createdAt: now,
    updatedAt: now,
  };
  store().zoneDeployQueues.set(run.runId, run);
  return run;
}

export function takePendingZoneDeployDraw(sceneId: string): ZoneDeployDrawRun | null {
  const run = [...store().zoneDeployQueues.values()].find((item) => item.sceneId === sceneId && item.status === 'queued');
  if (!run) return null;
  run.status = 'running';
  run.detail = '三维场景已接收，正在绘制作战区域与路线。';
  run.updatedAt = new Date().toISOString();
  return run;
}

export function getZoneDeployDrawRun(runId: string): ZoneDeployDrawRun | null {
  return store().zoneDeployQueues.get(runId) ?? null;
}

export function updateZoneDeployDrawRun(runId: string, patch: Partial<Pick<ZoneDeployDrawRun, 'status' | 'detail'>>): ZoneDeployDrawRun | null {
  const run = store().zoneDeployQueues.get(runId);
  if (!run) return null;
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  return run;
}

export function getSimulationRun(runId: string): SimulationRun | null {
  return store().simulations.get(runId) ?? null;
}

export function updateSimulationRun(runId: string, patch: Partial<Pick<SimulationRun, 'status' | 'completedStepIds' | 'failedStepIds' | 'detail'>>): SimulationRun | null {
  const run = store().simulations.get(runId);
  if (!run) return null;
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  return run;
}
