/**
 * uStudio 三维适配器：把冻结契约中的标准动作翻译为 uStudio SDK 调用。
 *
 * 设计要点：
 * - 只依赖注入的「最小 SDK 结构类型」，便于在单元测试中用 mock 替换 window.__scene。
 * - 集中处理 SDK 拼写差异（heighLight 是真实拼写，不擅自改成 highlight）。
 * - 维护「本推演自己」的资源清单，复位 / 回退只清理自己创建或改变的内容，
 *   不触碰推演前已存在的系统路径或多边形。
 * - 任何 SDK 调用异常都转为稳定错误码，不向上抛出原始异常。
 */

import { sceneSdk } from '@/lib/scene-sdk';
import type {
  FireSimulationAdapter,
  Point3,
  SimulationAction,
  SimulationActionObjectDetail,
  SimulationActionResult,
  SimulationActionStatus,
  SimulationActionType,
  SimulationErrorCode,
  SimulationExecutionContext,
} from './contracts';

/** 本子系统实际调用的 SDK 能力（结构类型，与 ustudio-sdk 真实方法对齐）。 */
export type UStudioSceneSdk = {
  fly(id: unknown): unknown;
  heighLight(id: unknown, color?: string | number): unknown;
  cancelHeighLight(id: unknown): unknown;
  show(id: unknown): unknown;
  hide(id: unknown): unknown;
  setOpacity(id: unknown, opacity: unknown): unknown;
  unSetOpacity(id: unknown): unknown;
  setScene(params?: unknown): Promise<unknown>;
  pathMove(id: unknown, path: unknown): unknown;
  pathRestore(id: unknown): unknown;
  polygonSetVisible(polygonIds: unknown, visible: boolean): Promise<unknown>;
  drawRoute?(routePoints: number[], routeKey: string, options?: Record<string, unknown>): unknown;
  deleteRoute?(routeKey: string): unknown;
  virtualRouteSetVisible?(routeIds: string[], visible: boolean): unknown;
  getSceneSetState?(): unknown;
};

export type CreateUStudioAdapterOptions = {
  /** 返回当前场景 SDK 实例，未就绪返回 null。默认读取 window.__scene。 */
  sdkProvider?: () => UStudioSceneSdk | null;
  /** 返回当前场景 ID。默认读取 window.__sceneId。 */
  getSceneId?: () => string | undefined;
};

const defaultSdkProvider = (): UStudioSceneSdk | null => {
  if (typeof window === 'undefined') return null;
  try {
    return (sceneSdk() as unknown as UStudioSceneSdk) ?? null;
  } catch {
    return null;
  }
};

const defaultGetSceneId = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window.__sceneId;
};

type Manifest = {
  highlights: Set<string>;
  opacities: Set<string>;
  showObjects: Set<string>;
  hideObjects: Set<string>;
  moves: Set<string>;
  polygons: Map<string, { prior?: boolean; touched: boolean }>;
  routes: Set<string>;
  virtualRoutes: Map<string, { prior?: boolean; touched: boolean }>;
  layerTouched: boolean;
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function flattenPoints(points: Point3[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y, p.z);
  return out;
}

function isValidPoints(points: Point3[] | undefined): points is Point3[] {
  if (!Array.isArray(points) || points.length < 2) return false;
  return points.every(
    (p) => p != null && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z),
  );
}

function classifyError(error: unknown): { errorCode: SimulationErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  // SDK 抛出的已知形态可在此映射；默认归为通用动作失败。
  return { errorCode: 'SDK_ACTION_FAILED', message };
}

export function createUStudioAdapter(
  options: CreateUStudioAdapterOptions = {},
): FireSimulationAdapter {
  const sdkProvider = options.sdkProvider ?? defaultSdkProvider;
  const getSceneId = options.getSceneId ?? defaultGetSceneId;

  const manifest: Manifest = {
    highlights: new Set(),
    opacities: new Set(),
    showObjects: new Set(),
    hideObjects: new Set(),
    moves: new Set(),
    polygons: new Map(),
    routes: new Set(),
    virtualRoutes: new Map(),
    layerTouched: false,
  };
  let disposed = false;

  const nowIso = (): string => new Date().toISOString();

  const getSdk = (): UStudioSceneSdk | null => {
    if (disposed) return null;
    return sdkProvider();
  };

  const actionIndex = (action: SimulationAction, context: SimulationExecutionContext): number =>
    context.step.actions.findIndex((a) => a === action);

  function makeResult(
    context: SimulationExecutionContext,
    action: SimulationAction,
    status: SimulationActionStatus,
    startedAt: string,
    extra?: {
      errorCode?: SimulationErrorCode;
      message?: string;
      details?: SimulationActionObjectDetail[];
    },
  ): SimulationActionResult {
    const finishedAt = nowIso();
    return {
      stepId: context.step.id,
      actionIndex: actionIndex(action, context),
      actionType: action.type,
      status,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt) || 0),
      errorCode: extra?.errorCode,
      message: extra?.message,
      details: extra?.details,
    };
  }

  function capturePolygonPrior(polygonId: string): boolean | undefined {
    const sdk = getSdk();
    if (!sdk?.getSceneSetState) return undefined;
    try {
      const state = sdk.getSceneSetState() as {
        polygons?: Array<{ polygonId: string; visible: boolean }>;
      };
      const entry = (state.polygons ?? []).find((p) => p.polygonId === polygonId);
      return entry ? !!entry.visible : undefined;
    } catch {
      return undefined;
    }
  }

  function captureVirtualRoutePrior(routeId: string): boolean | undefined {
    const sdk = getSdk();
    if (!sdk?.getSceneSetState) return undefined;
    try {
      const state = sdk.getSceneSetState() as {
        virtualRoutes?: Array<{ routeId: string; visible: boolean }>;
      };
      const entry = (state.virtualRoutes ?? []).find((r) => r.routeId === routeId);
      return entry ? !!entry.visible : undefined;
    } catch {
      return undefined;
    }
  }


  function isReady(): boolean {
    return getSdk() != null;
  }

  async function execute(
    action: SimulationAction,
    context: SimulationExecutionContext,
  ): Promise<SimulationActionResult> {
    const startedAt = nowIso();
    const sdk = getSdk();

    switch (action.type) {
      case 'FOCUS_OBJECT': {
        if (!nonEmptyString(action.objectId)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'objectId 为空',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        try {
          sdk.fly(action.objectId);
          return makeResult(context, action, 'success', startedAt, {
            message: `镜头飞向 ${action.objectId}`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'HIGHLIGHT_OBJECT': {
        if (!nonEmptyString(action.objectId)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'objectId 为空',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        const color = action.color ?? context.colors.highlightDefault;
        try {
          sdk.heighLight(action.objectId, color);
          manifest.highlights.add(action.objectId);
          return makeResult(context, action, 'success', startedAt, {
            message: `高亮 ${action.objectId}（${color}）`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'CLEAR_HIGHLIGHT': {
        if (!nonEmptyString(action.objectId)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'objectId 为空',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        try {
          sdk.cancelHeighLight(action.objectId);
          manifest.highlights.delete(action.objectId);
          return makeResult(context, action, 'success', startedAt, {
            message: `取消高亮 ${action.objectId}`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'SHOW_OBJECTS':
      case 'HIDE_OBJECTS': {
        const ids = action.objectIds;
        if (!Array.isArray(ids) || ids.length === 0) {
          return makeResult(context, action, 'skipped', startedAt, {
            message: '对象列表为空，无可执行对象',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        const show = action.type === 'SHOW_OBJECTS';
        const details: SimulationActionObjectDetail[] = [];
        let anyFailed = false;
        for (const id of ids) {
          if (!nonEmptyString(id)) {
            details.push({ objectId: id, status: 'failed', errorCode: 'OBJECT_NOT_FOUND', message: 'objectId 为空' });
            anyFailed = true;
            continue;
          }
          try {
            if (show) {
              sdk.show(id);
              manifest.showObjects.add(id);
            } else {
              sdk.hide(id);
              manifest.hideObjects.add(id);
            }
            details.push({ objectId: id, status: 'success' });
          } catch (error) {
            const e = classifyError(error);
            details.push({ objectId: id, status: 'failed', errorCode: e.errorCode, message: e.message });
            anyFailed = true;
          }
        }
        const status: SimulationActionStatus = anyFailed
          ? details.every((d) => d.status === 'failed')
            ? 'failed'
            : 'degraded'
          : 'success';
        return makeResult(context, action, status, startedAt, {
          message: show ? '显示对象' : '隐藏对象',
          details,
        });
      }

      case 'SET_OPACITY':
      case 'RESET_OPACITY': {
        const ids = action.objectIds;
        if (!Array.isArray(ids) || ids.length === 0) {
          return makeResult(context, action, 'skipped', startedAt, {
            message: '对象列表为空，无可执行对象',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        const set = action.type === 'SET_OPACITY';
        if (set && (!isFiniteNumber(action.opacity) || action.opacity < 0 || action.opacity > 1)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_ACTION_FAILED',
            message: `opacity 非法：${String(action.opacity)}，应为 0~1`,
          });
        }
        const details: SimulationActionObjectDetail[] = [];
        let anyFailed = false;
        for (const id of ids) {
          if (!nonEmptyString(id)) {
            details.push({ objectId: id, status: 'failed', errorCode: 'OBJECT_NOT_FOUND', message: 'objectId 为空' });
            anyFailed = true;
            continue;
          }
          try {
            if (set) {
              sdk.setOpacity(id, action.opacity);
              manifest.opacities.add(id);
            } else {
              sdk.unSetOpacity(id);
              manifest.opacities.delete(id);
            }
            details.push({ objectId: id, status: 'success' });
          } catch (error) {
            const e = classifyError(error);
            details.push({ objectId: id, status: 'failed', errorCode: e.errorCode, message: e.message });
            anyFailed = true;
          }
        }
        const status: SimulationActionStatus = anyFailed
          ? details.every((d) => d.status === 'failed')
            ? 'failed'
            : 'degraded'
          : 'success';
        return makeResult(context, action, status, startedAt, {
          message: set ? `设置透明度 ${action.opacity}` : '复位透明度',
          details,
        });
      }

      case 'APPLY_LAYER': {
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        try {
          await sdk.setScene({
            buildings: action.buildings,
            stories: action.stories,
            mode: action.mode,
            yExtend: action.yExtend,
            labels: action.labels,
          });
          manifest.layerTouched = true;
          return makeResult(context, action, 'success', startedAt, {
            message: `应用图层（stories=${action.stories?.length ?? 0}, mode=${action.mode ?? '默认'}）`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'SHOW_POLYGON': {
        if (!nonEmptyString(action.polygonId)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'polygonId 为空',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        const entry = manifest.polygons.get(action.polygonId) ?? { touched: false };
        if (entry.prior === undefined) entry.prior = capturePolygonPrior(action.polygonId);
        entry.touched = true;
        manifest.polygons.set(action.polygonId, entry);
        try {
          await sdk.polygonSetVisible(action.polygonId, action.visible);
          return makeResult(context, action, 'success', startedAt, {
            message: `多边形 ${action.polygonId} 可见=${action.visible}`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'MOVE_OBJECT': {
        if (!nonEmptyString(action.objectId)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'objectId 为空',
          });
        }
        if (!isValidPoints(action.points)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'INVALID_ROUTE',
            message: '移动路径非法：至少需要 2 个且坐标必须为有限数字',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        const flat = flattenPoints(action.points);
        try {
          const anim = sdk.pathMove(action.objectId, flat) as { play?: () => void } | undefined;
          anim?.play?.();
          manifest.moves.add(action.objectId);
          return makeResult(context, action, 'success', startedAt, {
            message: `已发起 ${action.objectId} 移动动画`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'RESTORE_OBJECT': {
        if (!nonEmptyString(action.objectId)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'objectId 为空',
          });
        }
        if (!sdk) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪',
          });
        }
        try {
          sdk.pathRestore(action.objectId);
          manifest.moves.delete(action.objectId);
          return makeResult(context, action, 'success', startedAt, {
            message: `复位 ${action.objectId}`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'DRAW_ROUTE': {
        if (!nonEmptyString(action.routeKey)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'routeKey 为空',
          });
        }
        if (!isValidPoints(action.points)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'INVALID_ROUTE',
            message: '路线路径非法：至少需要 2 个且坐标必须为有限数字',
          });
        }
        if (!sdk || typeof sdk.drawRoute !== 'function') {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪或当前场景不支持路线绘制',
          });
        }
        const flat = flattenPoints(action.points);
        try {
          sdk.drawRoute(flat, action.routeKey, {
            route_color: action.color,
            route_name: action.routeName,
            userData: action.width === undefined ? undefined : { width: action.width },
          });
          manifest.routes.add(action.routeKey);
          return makeResult(context, action, 'success', startedAt, {
            message: `已绘制路线 ${action.routeKey}（${action.points.length} 点）`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'CLEAR_ROUTE': {
        if (!nonEmptyString(action.routeKey)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'routeKey 为空',
          });
        }
        if (!sdk || typeof sdk.deleteRoute !== 'function') {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪或当前场景不支持路线清理',
          });
        }
        try {
          sdk.deleteRoute(action.routeKey);
          manifest.routes.delete(action.routeKey);
          return makeResult(context, action, 'success', startedAt, {
            message: `已清除路线 ${action.routeKey}`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'SHOW_VIRTUAL_ROUTE': {
        if (!nonEmptyString(action.routeId)) {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'OBJECT_NOT_FOUND',
            message: 'routeId 为空',
          });
        }
        if (!sdk || typeof sdk.virtualRouteSetVisible !== 'function') {
          return makeResult(context, action, 'failed', startedAt, {
            errorCode: 'SDK_NOT_READY',
            message: '场景 SDK 未就绪或当前场景不支持虚拟路线显隐',
          });
        }
        const entry = manifest.virtualRoutes.get(action.routeId) ?? { touched: false };
        if (entry.prior === undefined) entry.prior = captureVirtualRoutePrior(action.routeId);
        entry.touched = true;
        manifest.virtualRoutes.set(action.routeId, entry);
        try {
          sdk.virtualRouteSetVisible([action.routeId], action.visible);
          return makeResult(context, action, 'success', startedAt, {
            message: `虚拟路线 ${action.routeId} 可见=${action.visible}`,
          });
        } catch (error) {
          const e = classifyError(error);
          return makeResult(context, action, 'failed', startedAt, e);
        }
      }

      case 'DATA_GAP':
        return makeResult(context, action, 'degraded', startedAt, {
          errorCode: 'SDK_ACTION_FAILED',
          message: action.reason,
        });

      case 'NOTE':
        return makeResult(context, action, 'skipped', startedAt, {
          message: action.text,
        });

      case 'WAIT':
        // WAIT 由控制器做可取消等待，不通过 SDK。适配器兜底返回 skipped。
        return makeResult(context, action, 'skipped', startedAt, {
          message: '等待动作由控制器处理',
        });

      default: {
        // 未知动作类型（类型系统应已拦截，防御性兜底）。
        const unknown = action as { type?: string };
        return makeResult(context, action, 'failed', startedAt, {
          errorCode: 'ACTION_UNSUPPORTED',
          message: `不支持的动作类型：${String(unknown.type)}`,
        });
      }
    }
  }

  async function rollback(
    action: SimulationAction,
    context: SimulationExecutionContext,
  ): Promise<void> {
    const sdk = getSdk();
    if (!sdk) return;
    try {
      switch (action.type) {
        case 'HIGHLIGHT_OBJECT':
          sdk.cancelHeighLight(action.objectId);
          manifest.highlights.delete(action.objectId);
          break;
        case 'SET_OPACITY':
          for (const id of action.objectIds) {
            sdk.unSetOpacity(id);
            manifest.opacities.delete(id);
          }
          break;
        case 'SHOW_OBJECTS':
          for (const id of action.objectIds) {
            sdk.hide(id);
            manifest.showObjects.delete(id);
          }
          break;
        case 'HIDE_OBJECTS':
          for (const id of action.objectIds) {
            sdk.show(id);
            manifest.hideObjects.delete(id);
          }
          break;
        case 'MOVE_OBJECT':
          sdk.pathRestore(action.objectId);
          manifest.moves.delete(action.objectId);
          break;
        case 'SHOW_POLYGON': {
          const entry = manifest.polygons.get(action.polygonId);
          if (entry?.prior !== undefined) sdk.polygonSetVisible(action.polygonId, entry.prior);
          break;
        }
        case 'APPLY_LAYER':
          if (manifest.layerTouched) {
            await sdk.setScene({});
            manifest.layerTouched = false;
          }
          break;
        case 'DRAW_ROUTE':
          if (typeof sdk.deleteRoute === 'function') {
            sdk.deleteRoute(action.routeKey);
            manifest.routes.delete(action.routeKey);
          }
          break;
        case 'SHOW_VIRTUAL_ROUTE': {
          const entry = manifest.virtualRoutes.get(action.routeId);
          if (typeof sdk.virtualRouteSetVisible === 'function') {
            sdk.virtualRouteSetVisible([action.routeId], entry?.prior ?? false);
          }
          break;
        }
        // CLEAR_HIGHLIGHT / RESET_OPACITY / RESTORE_OBJECT / FOCUS_OBJECT / WAIT / NOTE 无可逆效果
        default:
          break;
      }
    } catch {
      // 回退失败不影响状态机继续；记录交给调用方。
    }
  }

  async function reset(): Promise<void> {
    const sdk = getSdk();
    if (sdk) {
      for (const id of manifest.highlights) safe(() => sdk.cancelHeighLight(id));
      for (const id of manifest.opacities) safe(() => sdk.unSetOpacity(id));
      for (const id of manifest.showObjects) safe(() => sdk.hide(id));
      for (const id of manifest.hideObjects) safe(() => sdk.show(id));
      for (const id of manifest.moves) safe(() => sdk.pathRestore(id));
      for (const [pid, entry] of manifest.polygons) {
        if (entry.prior !== undefined) {
          const prior = entry.prior;
          safe(() => sdk.polygonSetVisible(pid, prior));
        }
      }
      for (const routeKey of manifest.routes) {
        const del = sdk.deleteRoute;
        if (typeof del === 'function') safe(() => del(routeKey));
      }
      for (const [routeId, entry] of manifest.virtualRoutes) {
        const setVisible = sdk.virtualRouteSetVisible;
        if (typeof setVisible === 'function') safe(() => setVisible([routeId], entry.prior ?? false));
      }
      if (manifest.layerTouched) safe(() => sdk.setScene({}));
    }
    manifest.highlights.clear();
    manifest.opacities.clear();
    manifest.showObjects.clear();
    manifest.hideObjects.clear();
    manifest.moves.clear();
    manifest.polygons.clear();
    manifest.routes.clear();
    manifest.virtualRoutes.clear();
    manifest.layerTouched = false;
  }

  async function dispose(): Promise<void> {
    await reset();
    disposed = true;
  }

  return {
    isReady,
    execute,
    rollback,
    reset,
    dispose,
  };
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // 单个资源清理失败不影响其它资源清理。
  }
}
