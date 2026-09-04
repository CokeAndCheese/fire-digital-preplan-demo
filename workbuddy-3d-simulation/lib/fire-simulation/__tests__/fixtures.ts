import type { SimulationPlan, SimulationStep } from '../contracts';

/** 目标场景 ID（来自任务清单）。 */
export const TARGET_SCENE_ID = '477747327523254272';

const SCENE_ID = TARGET_SCENE_ID;

/**
 * 一份合法的 11 步推演计划样例（与指挥端 11 步契约一致）。
 * 注意：objectId / polygonId / 路线点均为占位标识，
 * 真实接入时需由业务层替换为 uStudio 真实的 out_instance_id / 坐标。
 */
export function makeValidPlan(): SimulationPlan {
  const steps: SimulationStep[] = [
    {
      id: 'step-1',
      order: 1,
      code: 'ALARM_RECEIVED',
      title: '接收火情',
      description: '接报火情，载入事件编号与输入摘要，不伪造三维动作。',
      actions: [
        { type: 'NOTE', text: '接报：五矿国际广场 20 层发生火灾，启动三维推演。' },
      ],
    },
    {
      id: 'step-2',
      order: 2,
      code: 'LOCATE_FIRE_ROOM',
      title: '锁定起火房间',
      description: '镜头飞向起火房间并高亮。',
      actions: [
        { type: 'FOCUS_OBJECT', objectId: 'room_fire_src' },
        { type: 'HIGHLIGHT_OBJECT', objectId: 'room_fire_src', color: '#FF3B30' },
      ],
    },
    {
      id: 'step-3',
      order: 3,
      code: 'ISOLATE_STORY_ZONE',
      title: '隔离起火楼层与防火分区',
      description: '隔离相关楼层，显示分区多边形。',
      actions: [
        { type: 'APPLY_LAYER', stories: ['story_20'], mode: '3D' },
        { type: 'SHOW_POLYGON', polygonId: 'zone_story_20', visible: true },
      ],
    },
    {
      id: 'step-4',
      order: 4,
      code: 'ANALYZE_SPREAD',
      title: '分析相邻空间与蔓延风险',
      description: '按输入高亮相邻空间、门、竖井与风险方向。',
      actions: [
        { type: 'HIGHLIGHT_OBJECT', objectId: 'space_adjacent_01', color: '#FFCC00' },
        { type: 'HIGHLIGHT_OBJECT', objectId: 'shaft_vertical', color: '#FFCC00' },
      ],
    },
    {
      id: 'step-5',
      order: 5,
      code: 'SELECT_STAGING_ENTRY',
      title: '选择停车点与进攻入口',
      description: '聚焦停车点、建筑入口对象。',
      actions: [
        { type: 'FOCUS_OBJECT', objectId: 'staging_point' },
        { type: 'HIGHLIGHT_OBJECT', objectId: 'building_entry', color: '#4C8DFF' },
      ],
    },
    {
      id: 'step-6',
      order: 6,
      code: 'SELECT_WATER_SOURCE',
      title: '水源部署',
      description: '显示主、备水源及连接关系。',
      actions: [
        { type: 'SHOW_OBJECTS', objectIds: ['hydrant_outdoor_01', 'pump_connector_01'] },
      ],
    },
    {
      id: 'step-7',
      order: 7,
      code: 'DRAW_PRIMARY_ROUTE',
      title: '绘制主进攻路线',
      description: '在模型中绘制主进攻路线并展示方向。',
      actions: [
        {
          type: 'DRAW_ROUTE',
          routeKey: 'primary_route',
          routeName: '主进攻路线',
          color: '#2FD4BF',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 5, z: 0 },
            { x: 20, y: 0, z: 0 },
          ],
        },
      ],
    },
    {
      id: 'step-8',
      order: 8,
      code: 'DRAW_BACKUP_ROUTE',
      title: '绘制疏散与备用路线',
      description: '展示备用路线及切换原因。',
      actions: [
        {
          type: 'DRAW_ROUTE',
          routeKey: 'backup_route',
          routeName: '备用路线',
          color: '#28C76F',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: -8, y: 4, z: 0 },
            { x: -16, y: 0, z: 0 },
          ],
        },
      ],
    },
    {
      id: 'step-9',
      order: 9,
      code: 'SHOW_FORCE_DEPLOYMENT',
      title: '力量部署',
      description: '显示已匹配消防救援力量。',
      actions: [{ type: 'SHOW_OBJECTS', objectIds: ['station_01', 'engine_01', 'crew_01'] }],
    },
    {
      id: 'step-10',
      order: 10,
      code: 'PLAY_TIMELINE',
      title: '时间轴同步推演',
      description: '按步骤顺序同步镜头、对象与文字。',
      actions: [
        { type: 'NOTE', text: '时间轴同步：镜头、对象与文字按步骤推进。' },
        { type: 'FOCUS_OBJECT', objectId: 'room_fire_src' },
      ],
    },
    {
      id: 'step-11',
      order: 11,
      code: 'REVIEW_SIGN_EXPORT',
      title: '复核、签发与导出',
      description: '显示完成状态；签发与 Word 由主工程处理。',
      actions: [
        { type: 'NOTE', text: '11 步三维推演完成，进入复核签发与导出。' },
      ],
    },
  ];

  return {
    contractVersion: '1.0',
    eventId: 'EVT-2026-0817-001',
    sceneId: SCENE_ID,
    title: '五矿国际广场 20 层灭火救援推演',
    createdAt: '2026-08-17T09:00:00.000Z',
    steps,
  };
}

/** 历史 8 步删减版（缺水源/主路线/备用路线三步），用于兼容性校验。 */
export function makeEightStepLegacyPlan(): SimulationPlan {
  const plan = makeValidPlan();
  const keep = new Set(['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-9', 'step-10', 'step-11']);
  const steps = plan.steps.filter((step) => keep.has(step.id)).map((step, index) => ({ ...step, order: index + 1 }));
  return { ...plan, steps };
}

export function missingEventIdPlan(): unknown {
  const plan = makeValidPlan() as Record<string, unknown>;
  delete plan.eventId;
  return plan;
}

export function wrongVersionPlan(): unknown {
  const plan = makeValidPlan() as Record<string, unknown>;
  plan.contractVersion = '2.0';
  return plan;
}

export function duplicateOrderPlan(): unknown {
  const plan = makeValidPlan();
  const steps = plan.steps.map((s) => ({ ...s }));
  steps[1].order = steps[0].order; // 重复 order
  return { ...plan, steps };
}

export function illegalActionPlan(): unknown {
  const plan = makeValidPlan();
  const steps = plan.steps.map((s) => ({ ...s, actions: [...s.actions] }));
  // 注入非法动作（缺失 objectId）
  steps[1].actions.push({ type: 'FOCUS_OBJECT', objectId: '' } as never);
  return { ...plan, steps };
}
