import { describe, expect, it } from 'vitest';
import { executeSkill } from '@/lib/skills/server';
import { SCENARIO_REGISTRY, validateScenarioInput } from '@/lib/scenario-registry';

const validRoomInput = {
  sceneId: SCENARIO_REGISTRY.sceneId,
  building: SCENARIO_REGISTRY.building.name,
  floor: '1F',
  room: '商铺1',
};

describe('scenario registry validation', () => {
  it('maps every frozen case to one registered floor, room, route, and external data set', () => {
    expect(SCENARIO_REGISTRY.cases).toHaveLength(3);

    for (const scenarioCase of SCENARIO_REGISTRY.cases) {
      const floor = SCENARIO_REGISTRY.floors.find((item) => item.registryId === scenarioCase.floorRegistryId);
      const room = SCENARIO_REGISTRY.rooms.find((item) => item.registryId === scenarioCase.roomRegistryId);

      expect(floor?.name).toBe(scenarioCase.floor);
      expect(room).toMatchObject({
        floor: scenarioCase.floor,
        outInstanceId: scenarioCase.roomOutInstanceId,
      });
      expect(scenarioCase.buildingRegistryId).toBe(SCENARIO_REGISTRY.building.registryId);
      expect(scenarioCase.routeRegistryIds).toEqual(SCENARIO_REGISTRY.routes.map((route) => route.registryId));
      expect(scenarioCase.externalDataRegistryIds).toEqual(
        Object.values(SCENARIO_REGISTRY.externalDataKeys).map((item) => item.registryId),
      );
    }
  });

  it('accepts an exactly registered scene and room ID mapping', () => {
    const result = validateScenarioInput(validRoomInput);

    expect(result).toMatchObject({
      status: 'verified',
      sceneId: SCENARIO_REGISTRY.sceneId,
      target: { room: { registryId: 'room:1f-shop-1', outInstanceId: 'e73835e6-9f67-4908-96ca-5a1c21f050bd' } },
    });
  });

  it('requires manual review when a registered name is ambiguous', () => {
    const floor = SCENARIO_REGISTRY.floors.find((item) => item.name === '1F');
    if (!floor) throw new Error('1F test fixture is missing');
    const registry = {
      ...SCENARIO_REGISTRY,
      floors: [...SCENARIO_REGISTRY.floors, { ...floor, registryId: 'floor:1F-duplicate' }],
    };

    const result = validateScenarioInput(validRoomInput, registry);

    expect(result.status).toBe('pending_manual_review');
    expect(result.reasons).toContain('floor_conflict');
  });

  it('requires manual review when the floor is not registered', () => {
    const result = validateScenarioInput({ ...validRoomInput, floor: '99F' });

    expect(result.status).toBe('pending_manual_review');
    expect(result.reasons).toContain('floor_not_found');
  });

  it('requires manual review when the room is not registered', () => {
    const result = validateScenarioInput({ ...validRoomInput, room: '不存在的房间' });

    expect(result.status).toBe('pending_manual_review');
    expect(result.reasons).toContain('room_not_found');
  });

  it('requires manual review when the registry has expired', () => {
    const registry = { ...SCENARIO_REGISTRY, validUntil: '2020-01-01T00:00:00.000Z' };
    const result = validateScenarioInput(validRoomInput, registry);

    expect(result.status).toBe('pending_manual_review');
    expect(result.reasons).toContain('registry_expired');
  });

  it('blocks a conflicting scene before it can dispatch a scene operation', async () => {
    const result = await executeSkill({
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: { ...validRoomInput, sceneId: '463601914351104000' },
    });

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ status: 'pending_manual_review', executionBlocked: true });
    expect(result.data?.registryValidation).toMatchObject({ sceneId: null, reasons: expect.arrayContaining(['scene_conflict']) });
  });
});
