/**
 * 三维推演子系统 —— 冻结输入契约与公共类型。
 *
 * 本文件只定义类型、常量与默认值，不导入 React，也不包含运行时副作用，
 * 便于主工程、单元测试与三维适配器共享同一份契约。
 *
 * 冻结字段（contractVersion / eventId / sceneId / steps / actions 等）的语义不可删除或改名；
 * 仅在末尾以「可选字段」方式扩展，兼容主工程 Codex 补充业务数据。
 */

export type Point3 = {
  x: number;
  y: number;
  z: number;
};

/**
 * 11 步推演步骤业务码（顺序即推演顺序）。
 *
 * 早期 8 步删减版（ALARM_RECEIVED..REVIEW_SIGN_EXPORT，缺水源/主路线/备用路线
 * 三步）仍在库中存在，为兼容历史预案保留；新预案统一走 11 步。
 */
export type SimulationStepCode =
  | 'ALARM_RECEIVED'
  | 'LOCATE_FIRE_ROOM'
  | 'ISOLATE_STORY_ZONE'
  | 'ANALYZE_SPREAD'
  | 'SELECT_STAGING_ENTRY'
  | 'SELECT_WATER_SOURCE'
  | 'DRAW_PRIMARY_ROUTE'
  | 'DRAW_BACKUP_ROUTE'
  | 'SHOW_FORCE_DEPLOYMENT'
  | 'PLAY_TIMELINE'
  | 'REVIEW_SIGN_EXPORT';

export const SIMULATION_STEP_CODES: readonly SimulationStepCode[] = [
  'ALARM_RECEIVED',
  'LOCATE_FIRE_ROOM',
  'ISOLATE_STORY_ZONE',
  'ANALYZE_SPREAD',
  'SELECT_STAGING_ENTRY',
  'SELECT_WATER_SOURCE',
  'DRAW_PRIMARY_ROUTE',
  'DRAW_BACKUP_ROUTE',
  'SHOW_FORCE_DEPLOYMENT',
  'PLAY_TIMELINE',
  'REVIEW_SIGN_EXPORT',
];

/** 单步可执行的真实三维动作。 */
export type SimulationAction =
  | { type: 'FOCUS_OBJECT'; objectId: string }
  | { type: 'HIGHLIGHT_OBJECT'; objectId: string; color?: string }
  | { type: 'CLEAR_HIGHLIGHT'; objectId: string }
  | { type: 'SHOW_OBJECTS'; objectIds: string[] }
  | { type: 'HIDE_OBJECTS'; objectIds: string[] }
  | { type: 'SET_OPACITY'; objectIds: string[]; opacity: number }
  | { type: 'RESET_OPACITY'; objectIds: string[] }
  | {
      type: 'APPLY_LAYER';
      buildings?: string[];
      stories?: string[];
      mode?: '2D' | '3D';
      yExtend?: boolean;
      labels?: boolean;
    }
  | { type: 'SHOW_POLYGON'; polygonId: string; visible: boolean }
  | { type: 'MOVE_OBJECT'; objectId: string; points: Point3[]; durationMs?: number }
  | { type: 'RESTORE_OBJECT'; objectId: string }
  | { type: 'DRAW_ROUTE'; routeKey: string; points: Point3[]; color?: string; routeName?: string; width?: number }
  | { type: 'CLEAR_ROUTE'; routeKey: string }
  | { type: 'SHOW_VIRTUAL_ROUTE'; routeId: string; visible: boolean }
  | { type: 'DATA_GAP'; reason: string }
  | { type: 'WAIT'; durationMs: number }
  | { type: 'NOTE'; text: string };

export const SIMULATION_ACTION_TYPES: readonly SimulationAction['type'][] = [
  'FOCUS_OBJECT',
  'HIGHLIGHT_OBJECT',
  'CLEAR_HIGHLIGHT',
  'SHOW_OBJECTS',
  'HIDE_OBJECTS',
  'SET_OPACITY',
  'RESET_OPACITY',
  'APPLY_LAYER',
  'SHOW_POLYGON',
  'MOVE_OBJECT',
  'RESTORE_OBJECT',
  'DRAW_ROUTE',
  'CLEAR_ROUTE',
  'SHOW_VIRTUAL_ROUTE',
  'DATA_GAP',
  'WAIT',
  'NOTE',
];

export type SimulationActionType = SimulationAction['type'];

export type SimulationStep = {
  id: string;
  order: number;
  code: SimulationStepCode;
  title: string;
  description: string;
  durationMs?: number;
  actions: SimulationAction[];
};

/** 颜色角色：默认值允许由计划输入覆盖。 */
export type SimulationColorRole =
  | 'fireDanger'
  | 'evacRoute'
  | 'neighborRisk'
  | 'highlightDefault';

export const DEFAULT_SIMULATION_COLORS: Record<SimulationColorRole, string> = {
  fireDanger: '#FF3B30',
  evacRoute: '#28C76F',
  neighborRisk: '#FFCC00',
  highlightDefault: '#FFCC00',
};

/**
 * 冻结输入契约。可整体交予主工程 Codex：由其业务层把等级、力量、水源、路线、
 * 对象 out_instance_id 转换为此结构。可增加可选字段，但不得删除 / 改名 / 改变已有字段语义。
 */
export type SimulationPlan = {
  contractVersion: '1.0';
  eventId: string;
  sceneId: string;
  title: string;
  createdAt: string;
  steps: SimulationStep[];
  /** 可选：覆盖默认颜色（仅补充，不削弱语义）。 */
  colors?: Partial<Record<SimulationColorRole, string>>;
};

export type SimulationActionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'skipped'
  | 'degraded'
  | 'failed';

/** 多对象动作中单个对象的执行结果，用于「部分成功 / 部分失败」记录。 */
export type SimulationActionObjectDetail = {
  objectId?: string;
  status: SimulationActionStatus;
  errorCode?: string;
  message?: string;
};

export type SimulationActionResult = {
  stepId: string;
  actionIndex: number;
  actionType: SimulationActionType;
  status: SimulationActionStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  message?: string;
  errorCode?: string;
  /** 多对象动作时记录每个对象的成败明细。 */
  details?: SimulationActionObjectDetail[];
};

export type SimulationControllerState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'resetting'
  | 'error';

/** 稳定的错误码，便于适配器把 SDK 异常转为可观察结果。 */
export type SimulationErrorCode =
  | 'SDK_NOT_READY'
  | 'OBJECT_NOT_FOUND'
  | 'INVALID_ROUTE'
  | 'ACTION_UNSUPPORTED'
  | 'SDK_ACTION_FAILED'
  | 'INVALID_PLAN'
  | 'PLAN_REJECTED'
  | 'CONCURRENT_RUN'
  | 'NOT_LOADED'
  | 'DISPOSED';

/** 系统性错误码：仅这些会导致全局 error，其余按动作级降级继续。 */
export const SYSTEMIC_ERROR_CODES: readonly SimulationErrorCode[] = [
  'SDK_NOT_READY',
  'INVALID_PLAN',
  'PLAN_REJECTED',
  'DISPOSED',
];

/** 适配器执行动作时的上下文：场景、计划、当前步骤与已合并颜色。 */
export type SimulationExecutionContext = {
  sceneId: string;
  plan: SimulationPlan;
  step: SimulationStep;
  colors: Record<SimulationColorRole, string>;
};

/** 三维场景适配器统一接口（由 ustudio-adapter.ts 实现）。 */
export interface FireSimulationAdapter {
  isReady(): boolean;
  execute(
    action: SimulationAction,
    context: SimulationExecutionContext,
  ): Promise<SimulationActionResult>;
  rollback(
    action: SimulationAction,
    context: SimulationExecutionContext,
  ): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

/** 推演控制器运行时只读快照。 */
export type SimulationSnapshot = {
  state: SimulationControllerState;
  plan: SimulationPlan | null;
  /** 当前所在步骤索引（0 基）；未加载或复位为 -1。 */
  currentStepIndex: number;
  currentStep: SimulationStep | null;
  totalSteps: number;
  /** 已完成步骤数 / 总步骤数。 */
  progress: { current: number; total: number };
  /** 全部已执行动作结果（扁平）。 */
  results: SimulationActionResult[];
  /** 当前步骤的动作结果。 */
  currentStepResults: SimulationActionResult[];
  /** 按 stepId 归集的动作结果。 */
  stepResults: Record<string, SimulationActionResult[]>;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
};

export type CreateFireSimulationControllerOptions = {
  adapter: FireSimulationAdapter;
  onStateChange?: (snapshot: SimulationSnapshot) => void;
};

export interface FireSimulationController {
  load(plan: SimulationPlan): void;
  start(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  replay(): Promise<void>;
  reset(): Promise<void>;
  getSnapshot(): SimulationSnapshot;
  dispose(): Promise<void>;
}
