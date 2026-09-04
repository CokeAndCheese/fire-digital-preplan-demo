import { describe, expect, it } from 'vitest';
import { planConsumers } from '../plan-adapters';
import { FIRE_RESCUE_PLAN_JSON_SCHEMA, isUnifiedFireRescuePlan } from '../plan-contract';
import { InMemoryPlanRepository, orchestratePlanDraft } from '../plan-orchestrator';
import type { SkillExecutionRequest, SkillExecutionResult } from '../skills/types';

function result(
  request: SkillExecutionRequest,
  data: Record<string, unknown>,
  mode: SkillExecutionResult['mode'] = 'bridge',
): SkillExecutionResult {
  return {
    executionId: `${request.skillId}-${request.actionId}-receipt`, skillId: request.skillId, actionId: request.actionId,
    ok: true, mode, startedAt: '2026-08-20T01:00:00.000Z', finishedAt: '2026-08-20T01:00:00.100Z',
    summary: `${request.skillId} receipt`, data,
  };
}

function fullReceipt(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
  if (request.skillId === 'scene-control') return Promise.resolve(result(request, {
    target: { sceneId: 'scene-demo-01', floorName: String(request.input?.floor), floorId: 'floor-8', name: String(request.input?.room), roomId: 'room-808' },
  }));
  if (request.skillId === 'response-level') return Promise.resolve(result(request, {
    recommendedLevelCode: 'III', ruleVersion: 'sanya-fire-evidence-rules-v1', missingEvidence: [],
  }, 'simulation'));
  if (request.skillId === 'fire-zone-deploy') return Promise.resolve(result(request, {
    deploy: {
      zones: [
        { id: 'parking', name: '车辆停放区', color: '#2FD4BF', polygon: [{ x: 1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, { x: 5, y: 4, z: 0 }, { x: 1, y: 4, z: 0 }] },
        { id: 'cordon', name: '警戒区', color: '#FF5B60', polygon: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 6, y: 6, z: 0 }, { x: 0, y: 6, z: 0 }] },
      ],
      routes: [
        { id: 'attack', name: '进攻路线', color: '#2FD4BF', path: [{ x: 1, y: 1, z: 0 }, { x: 3, y: 3, z: 0 }] },
        { id: 'main_route', name: '主路线', color: '#2FD4BF', path: [{ x: 1, y: 5, z: 0 }, { x: 3, y: 3, z: 0 }, { x: 3, y: 3, z: 0 }] },
        { id: 'backup_route', name: '备用路线', color: '#F0B34A', path: [{ x: 5, y: 5, z: 0 }, { x: 4, y: 2, z: 0 }, { x: 3, y: 3, z: 0 }] },
      ],
    },
    firePoint: { x: 3, y: 3, z: 8 },
  }));
  return Promise.resolve(result(request, {
    source: { name: '力量平台' },
    units: [{ id: 'unit-01', name: '吉阳消防救援站', personnel: '30', vehicles: ['水罐车'], equipment: ['热像仪'] }],
    forceComposition: {
      status: 'ready', calculationVersion: 'frozen-force-policy-v1', requiredUnits: 1,
      selectedUnits: [{ id: 'unit-01', name: '吉阳消防救援站', etaMinutes: null }],
      candidateUnits: [{ id: 'unit-01', name: '吉阳消防救援站', etaMinutes: null }],
      reviewReasons: [],
    },
  }, 'platform'));
}

const STRATEGY_RESULT: SkillExecutionResult = {
  executionId: 'rescue-plan-generate-plan-receipt', skillId: 'rescue-plan', actionId: 'generate_plan', ok: true, mode: 'bridge',
  startedAt: '2026-08-20T01:00:00.400Z', finishedAt: '2026-08-20T01:00:00.500Z', summary: 'strategy receipt',
  data: { strategies: {
    suppression: { content: '依据回执执行灭火部署。' }, rescue: { content: '依据回执执行搜救。' }, evacuation: { content: '依据回执执行疏散。' },
    security: { content: '依据回执执行警戒。' }, smokeControl: { content: '依据回执执行排烟。' },
    // 需求书 §9 策略域的通信、安全、资源协同三项
    communication: { content: '依据回执建立通信回路。' }, safety: { content: '依据回执设置安全员。' },
    resourceCoordination: { content: '依据回执统一调配保障资源。' },
  } },
};

async function fullPlan(repository: InMemoryPlanRepository, input: Record<string, unknown>) {
  return orchestratePlanDraft({ input, repository, invoke: fullReceipt, invokePlanStrategy: async () => STRATEGY_RESULT });
}

describe('unified plan contract and orchestration', () => {
  it.each([
    { incidentId: 'INC-01', building: '五矿国际广场', floor: '8F', room: '808', fireType: '电气火灾', trappedCount: 2, burnArea: 35 },
    { incidentId: 'INC-02', building: '三亚会展中心', floor: '2F', room: '会议厅', fireType: '布展材料火灾', trappedCount: 0, burnArea: 12 },
    { incidentId: 'INC-03', building: '海棠医院', floor: '5F', room: '病区', fireType: '设备间火灾', trappedCount: 6, burnArea: 48 },
  ])('keeps a complete evidence-backed receipt for $incidentId', async (input) => {
    const plan = await fullPlan(new InMemoryPlanRepository(), input);
    expect(isUnifiedFireRescuePlan(plan)).toBe(true);
    expect(FIRE_RESCUE_PLAN_JSON_SCHEMA.properties.simulation.properties.mappings.minItems).toBe(8);
    expect(plan.orchestration.map((entry) => `${entry.skillId}.${entry.actionId}`)).toEqual([
      'scene-control.locate_space', 'response-level.assess_response_level',
      'fire-resource.query_nearby_units',
      'route-water.query_nearby_water_sources', 'route-water.query_route_constraints',
      'plan-template.retrieve_template_sections',
      'rescue-plan.generate_plan',
      'fire-zone-deploy.compute_zone_deploy',
    ]);
    expect(plan.orchestration.every((entry) => entry.input && entry.output && entry.durationMs >= 0)).toBe(true);
    expect(plan.spatialTarget.status).toBe('ready');
    expect(plan.responseLevel.recommendation).toBe('III');
    expect(plan.forceComposition.units[0]?.etaMinutes).toBeNull();
    expect(Object.values(plan.strategies).every((strategy) => strategy.status === 'ready')).toBe(true);
    // 演示：主/备路线无真实路网时已用作战区域部署的主/备路线填充，非空壳。
    expect(plan.routeWater?.primaryRoute?.waypoints?.length ?? 0).toBeGreaterThan(0);
    expect(plan.routeWater?.backupRoute?.waypoints?.length ?? 0).toBeGreaterThan(0);
    expect(plan.operationsDeployment?.routes?.some((r) => r.id === 'main_route')).toBe(true);
    expect(plan.operationsDeployment?.routes?.some((r) => r.id === 'backup_route')).toBe(true);
    expect(plan.simulation.mappings).toHaveLength(11);
    expect(plan.simulation.mappings.map((mapping) => mapping.stepId)).toEqual(
      Array.from({ length: 11 }, (_, index) => `${plan.planId}:step-${String(index + 1).padStart(2, '0')}`),
    );
    expect(plan.simulation.mappings[0]).toMatchObject({
      actionId: 'receive_incident', sdkAction: 'panel_set_visible',
      input: expect.objectContaining({ planId: plan.planId, floor: input.floor, room: input.room }),
    });

    const consumers = planConsumers(plan);
    expect(consumers.word.document).toBe(plan);
    expect(consumers.scene3d.simulation).toBe(plan.simulation);
    expect(consumers.page.planId).toBe(plan.planId);
  });

  it('retains all downstream failures in a draft with traceable degradation reasons', async () => {
    const repository = new InMemoryPlanRepository();
    const failed = async (request: SkillExecutionRequest): Promise<SkillExecutionResult> => ({
      executionId: `failed-${request.skillId}`, skillId: request.skillId, actionId: request.actionId, ok: false, mode: 'bridge',
      startedAt: '2026-08-20T01:00:00.000Z', finishedAt: '2026-08-20T01:00:00.050Z', summary: 'bridge failed', error: `${request.skillId}_UNAVAILABLE`,
    });
    const plan = await orchestratePlanDraft({
      input: { incidentId: 'INC-FAIL', building: '五矿国际广场', floor: '8F', room: '808' }, repository,
      invoke: failed,
      invokePlanStrategy: async () => ({ ...await failed({ skillId: 'rescue-plan', actionId: 'generate_plan' }), skillId: 'rescue-plan' }),
    });
    expect(plan.lifecycleStatus).toBe('draft');
    expect(plan.issuance.status).toBe('not_issued');
    // 空间定位、响应等级、力量编成、处置策略、路线水源、预案模板
    expect(plan.failedItems).toHaveLength(6);
    expect(plan.orchestration.every((entry) => entry.status === 'failed' && entry.degradationReason)).toBe(true);
    expect(plan.spatialTarget.status).toBe('failed');
    expect(plan.routeWater?.status).toBe('failed');
    expect(plan.simulation.mappings.every((mapping) => mapping.status === 'pending_manual_review')).toBe(true);
  });

  it('creates a new immutable version when the input changes', async () => {
    const repository = new InMemoryPlanRepository();
    const first = await fullPlan(repository, { incidentId: 'INC-VERSION', building: '五矿国际广场', floor: '8F', room: '808', burnArea: 15 });
    const second = await fullPlan(repository, { incidentId: 'INC-VERSION', building: '五矿国际广场', floor: '8F', room: '808', burnArea: 45 });
    expect(second.version).toBe(2);
    expect(second.previousPlanId).toBe(first.planId);
    expect(second.planId).not.toBe(first.planId);
    expect(first.incident.burnAreaSqm).toBe(15);
    expect(second.incident.burnAreaSqm).toBe(45);
    expect(repository.get(first.planId)).toBe(first);
  });

  it('forwards frozen room instance IDs to spatial and force matching', async () => {
    const roomOutInstanceId = '352455b3-be38-49e3-9def-529cc1c81bcd';
    const plan = await fullPlan(new InMemoryPlanRepository(), {
      incidentId: 'INC-ROOM-ID', sceneId: '477747327523254272', building: '五矿国际广场', floor: '20F', room: '机房1', room_out_instance_id: roomOutInstanceId,
    });
    expect(plan.orchestration[0]?.input).toMatchObject({ roomOutInstanceId });
    expect(plan.orchestration[2]?.input).toMatchObject({ roomOutInstanceId });
  });

  it('keeps a floor-only scene target out of room-level simulation fields', async () => {
    const floorOnlyReceipt = async (request: SkillExecutionRequest): Promise<SkillExecutionResult> => {
      if (request.skillId === 'scene-control') return result(request, {
        target: { sceneId: 'scene-demo-01', floorName: '14F', floorId: 'floor-14', name: '14F' },
      });
      return fullReceipt(request);
    };
    const plan = await orchestratePlanDraft({
      input: { incidentId: 'INC-FLOOR-ONLY', building: '五矿国际广场', floor: '14F', trappedCount: 9 },
      repository: new InMemoryPlanRepository(),
      invoke: floorOnlyReceipt,
      invokePlanStrategy: async () => STRATEGY_RESULT,
    });

    expect(plan.spatialTarget).toMatchObject({ floor: '14F', floorId: 'floor-14', room: null, roomId: null });
    expect(plan.simulation.mappings).toHaveLength(11);
    expect(plan.simulation.mappings.every((mapping) => (
      mapping.input.floor === '14F'
      && mapping.input.floorId === 'floor-14'
      && mapping.input.room === null
      && mapping.input.roomId === null
      && mapping.input.roomOutInstanceId === null
    ))).toBe(true);
  });

  it('does not persist the browser-only scene tree in orchestration receipts', async () => {
    const sceneTreeReceipt = async (request: SkillExecutionRequest): Promise<SkillExecutionResult> => {
      if (request.skillId === 'scene-control') return result(request, {
        target: {
          sceneId: 'scene-demo-01', floorName: '14F', floorId: 'floor-14', name: '14F',
          tree: { id: 'scene-root', children: [{ id: 'floor-14', name: '14F' }] },
        },
      });
      return fullReceipt(request);
    };
    const plan = await orchestratePlanDraft({
      input: { incidentId: 'INC-COMPACT-RECEIPT', building: '五矿国际广场', floor: '14F' },
      repository: new InMemoryPlanRepository(), invoke: sceneTreeReceipt,
      invokePlanStrategy: async () => STRATEGY_RESULT,
    });
    const sceneOutput = plan.orchestration.find((entry) => entry.skillId === 'scene-control')?.output;
    const strategyInput = plan.orchestration.find((entry) => entry.skillId === 'rescue-plan')?.input;

    expect(sceneOutput).toMatchObject({ target: { floorName: '14F', floorId: 'floor-14' } });
    expect((sceneOutput?.target as Record<string, unknown>).tree).toBeUndefined();
    expect(JSON.stringify(strategyInput)).not.toContain('"tree"');
  });
});
