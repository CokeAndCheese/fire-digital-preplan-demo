import { describe, expect, it, vi } from 'vitest';
import {
  createUStudioAdapter,
  type UStudioSceneSdk,
  DEFAULT_SIMULATION_COLORS,
  type SimulationAction,
  type SimulationExecutionContext,
  type SimulationPlan,
  type SimulationStep,
} from '../index';

function makeMockSdk(overrides: Partial<UStudioSceneSdk> = {}): UStudioSceneSdk & {
  fly: ReturnType<typeof vi.fn>;
  heighLight: ReturnType<typeof vi.fn>;
  cancelHeighLight: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  setOpacity: ReturnType<typeof vi.fn>;
  unSetOpacity: ReturnType<typeof vi.fn>;
  setScene: ReturnType<typeof vi.fn>;
  drawRoute: ReturnType<typeof vi.fn>;
  deleteRoute: ReturnType<typeof vi.fn>;
  pathMove: ReturnType<typeof vi.fn>;
  pathRestore: ReturnType<typeof vi.fn>;
  polygonSetVisible: ReturnType<typeof vi.fn>;
  virtualRouteSetVisible: ReturnType<typeof vi.fn>;
} {
  return {
    fly: vi.fn(),
    heighLight: vi.fn(),
    cancelHeighLight: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    setOpacity: vi.fn(),
    unSetOpacity: vi.fn(),
    setScene: vi.fn().mockResolvedValue(undefined),
    drawRoute: vi.fn().mockResolvedValue('rt-returned'),
    deleteRoute: vi.fn(),
    pathMove: vi.fn().mockReturnValue({ play: vi.fn() }),
    pathRestore: vi.fn(),
    polygonSetVisible: vi.fn().mockResolvedValue(undefined),
    virtualRouteSetVisible: vi.fn().mockResolvedValue(undefined),
    getSceneSetState: vi.fn().mockReturnValue({ polygons: [], routes: [] }),
    ...overrides,
  } as never;
}

function makeContext(action: SimulationAction): SimulationExecutionContext {
  const step: SimulationStep = {
    id: 'step-x',
    order: 1,
    code: 'LOCATE_FIRE_ROOM',
    title: 't',
    description: 'd',
    actions: [action],
  };
  const plan: SimulationPlan = {
    contractVersion: '1.0',
    eventId: 'EVT-1',
    sceneId: '477747327523254272',
    title: 't',
    createdAt: '2026-08-17T00:00:00.000Z',
    steps: [step],
  };
  return { sceneId: plan.sceneId, plan, step, colors: { ...DEFAULT_SIMULATION_COLORS } };
}

describe('ustudio adapter - 动作映射', () => {
  it('isReady 随 sdkProvider 变化', () => {
    const adapter = createUStudioAdapter({ sdkProvider: () => null });
    expect(adapter.isReady()).toBe(false);
    const sdk = makeMockSdk();
    const adapter2 = createUStudioAdapter({ sdkProvider: () => sdk });
    expect(adapter2.isReady()).toBe(true);
  });

  it('FOCUS_OBJECT 调用 fly', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'FOCUS_OBJECT', objectId: 'room_1' };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.fly).toHaveBeenCalledWith('room_1');
    expect(res.status).toBe('success');
  });

  it('HIGHLIGHT_OBJECT 调用 heighLight 并使用指定颜色', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'HIGHLIGHT_OBJECT', objectId: 'room_1', color: '#FF3B30' };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.heighLight).toHaveBeenCalledWith('room_1', '#FF3B30');
    expect(res.status).toBe('success');
  });

  it('HIGHLIGHT_OBJECT 缺省使用高亮默认色', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'HIGHLIGHT_OBJECT', objectId: 'room_1' };
    await adapter.execute(action, makeContext(action));
    expect(sdk.heighLight).toHaveBeenCalledWith('room_1', DEFAULT_SIMULATION_COLORS.highlightDefault);
  });

  it('SHOW_OBJECTS 逐对象调用 show，部分失败降级', async () => {
    const sdk = makeMockSdk({
      show: vi.fn((id: unknown) => {
        if (id === 'bad_id') throw new Error('not found');
        return undefined;
      }),
    });
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'SHOW_OBJECTS', objectIds: ['ok_1', 'bad_id', 'ok_2'] };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.show).toHaveBeenCalledTimes(3); // 尝试每个对象
    expect(res.status).toBe('degraded');
    expect(res.details?.find((d) => d.objectId === 'bad_id')?.status).toBe('failed');
    expect(res.details?.filter((d) => d.status === 'success').length).toBe(2);
  });

  it('SET_OPACITY 非法 opacity 不调用 SDK 且返回失败', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'SET_OPACITY', objectIds: ['o1'], opacity: 5 };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.setOpacity).not.toHaveBeenCalled();
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('SDK_ACTION_FAILED');
  });

  it('APPLY_LAYER 调用 setScene 透传参数', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'APPLY_LAYER', stories: ['story_20'], mode: '3D', yExtend: true };
    await adapter.execute(action, makeContext(action));
    expect(sdk.setScene).toHaveBeenCalledWith(
      expect.objectContaining({ stories: ['story_20'], mode: '3D', yExtend: true }),
    );
  });

  it('SHOW_POLYGON 调用 polygonSetVisible', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'SHOW_POLYGON', polygonId: 'zone_1', visible: true };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.polygonSetVisible).toHaveBeenCalledWith('zone_1', true);
    expect(res.status).toBe('success');
  });

  it('MOVE_OBJECT 调用 pathMove 并 play', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = {
      type: 'MOVE_OBJECT',
      objectId: 'engine_1',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
      ],
    };
    await adapter.execute(action, makeContext(action));
    expect(sdk.pathMove).toHaveBeenCalledWith('engine_1', [0, 0, 0, 1, 1, 1]);
  });

  it('SDK 未就绪时动作返回 SDK_NOT_READY', async () => {
    const adapter = createUStudioAdapter({ sdkProvider: () => null });
    const action: SimulationAction = { type: 'FOCUS_OBJECT', objectId: 'room_1' };
    const res = await adapter.execute(action, makeContext(action));
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('SDK_NOT_READY');
  });
});

describe('ustudio adapter - 路线与数据缺口', () => {
  it('DRAW_ROUTE 调用 drawRoute 并扁平化坐标', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = {
      type: 'DRAW_ROUTE',
      routeKey: 'primary',
      routeName: '主进攻路线',
      color: '#2FD4BF',
      points: [
        { x: 1, y: 2, z: 3 },
        { x: 4, y: 5, z: 6 },
      ],
    };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.drawRoute).toHaveBeenCalledWith(
      [1, 2, 3, 4, 5, 6],
      'primary',
      expect.objectContaining({ route_name: '主进攻路线', route_color: '#2FD4BF' }),
    );
    expect(res.status).toBe('success');
  });

  it('DRAW_ROUTE 非法坐标不调用 SDK 且返回 INVALID_ROUTE', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'DRAW_ROUTE', routeKey: 'primary', points: [] };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.drawRoute).not.toHaveBeenCalled();
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('INVALID_ROUTE');
  });

  it('CLEAR_ROUTE 调用 deleteRoute', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'CLEAR_ROUTE', routeKey: 'primary' };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.deleteRoute).toHaveBeenCalledWith('primary');
    expect(res.status).toBe('success');
  });

  it('SHOW_VIRTUAL_ROUTE 调用 virtualRouteSetVisible', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'SHOW_VIRTUAL_ROUTE', routeId: 'evac_1', visible: true };
    const res = await adapter.execute(action, makeContext(action));
    expect(sdk.virtualRouteSetVisible).toHaveBeenCalledWith(['evac_1'], true);
    expect(res.status).toBe('success');
  });

  it('DATA_GAP 不调用 SDK 且返回 degraded（如实标注数据缺口）', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'DATA_GAP', reason: '路线几何数据未就绪。' };
    const res = await adapter.execute(action, makeContext(action));
    expect(res.status).toBe('degraded');
    expect(res.message).toBe('路线几何数据未就绪。');
  });
});

describe('ustudio adapter - 复位与回退', () => {
  it('reset 清理高亮、显隐等本推演资源', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    await adapter.execute({ type: 'HIGHLIGHT_OBJECT', objectId: 'room_1', color: '#FF3B30' }, makeContext({ type: 'HIGHLIGHT_OBJECT', objectId: 'room_1' }));
    await adapter.reset();
    expect(sdk.cancelHeighLight).toHaveBeenCalledWith('room_1');
  });

  it('rollback(HIGHLIGHT_OBJECT) 调用 cancelHeighLight', async () => {
    const sdk = makeMockSdk();
    const adapter = createUStudioAdapter({ sdkProvider: () => sdk });
    const action: SimulationAction = { type: 'HIGHLIGHT_OBJECT', objectId: 'room_1' };
    await adapter.execute(action, makeContext(action));
    await adapter.rollback(action, makeContext(action));
    expect(sdk.cancelHeighLight).toHaveBeenCalledWith('room_1');
  });
});
