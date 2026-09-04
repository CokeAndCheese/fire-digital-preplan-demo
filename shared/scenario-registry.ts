/**
 * 审查脚手架 —— 非交付代码。
 * 原始 shared/scenario-registry 未包含在源码包中，此文件仅为让工程能启动以观察运行时行为。
 * 字段形状按 fire-command-agent/lib/__tests__/scenario-registry.test.ts 的断言复原。
 */

export type RegistryRoom = { registryId: string; floor: string; name: string; outInstanceId: string };
export type RegistryFloor = { registryId: string; name: string };
export type RegistryRoute = { registryId: string; name: string; platformRouteId: string; startPoint: null; endPoint: null };

export const SCENARIO_REGISTRY = {
  sceneId: '477747327523254272',
  validUntil: '2027-01-01T00:00:00.000Z',
  building: { registryId: 'building:wukuang', name: '五矿国际广场', outInstanceId: '5dbe1684-152f-49d4-98b1-b53587930a6a' },
  floors: [
    { registryId: 'floor:1F', name: '1F' },
    { registryId: 'floor:20F', name: '20F' },
  ] as RegistryFloor[],
  rooms: [
    { registryId: 'room:1f-shop-1', floor: '1F', name: '商铺1', outInstanceId: 'e73835e6-9f67-4908-96ca-5a1c21f050bd' },
    { registryId: 'room:20f-machine-1', floor: '20F', name: '机房1', outInstanceId: '352455b3-be38-49e3-9def-529cc1c81bcd' },
    { registryId: 'room:20f-house-1', floor: '20F', name: '住宅1', outInstanceId: 'c6a08fd7-0000-0000-0000-000000000000' },
  ] as RegistryRoom[],
  routes: [
    { registryId: 'route:evacuation', name: '疏散路线', platformRouteId: '465057374215733248', startPoint: null, endPoint: null },
    { registryId: 'route:attack', name: '进攻路线', platformRouteId: '465057838429675520', startPoint: null, endPoint: null },
  ] as RegistryRoute[],
  externalDataKeys: {
    firePlatform: { registryId: 'external:fire-platform' },
  },
  cases: [
    { caseId: 'DEMO-A', floor: '1F', floorRegistryId: 'floor:1F', roomRegistryId: 'room:1f-shop-1', roomOutInstanceId: 'e73835e6-9f67-4908-96ca-5a1c21f050bd', buildingRegistryId: 'building:wukuang', routeRegistryIds: ['route:evacuation', 'route:attack'], externalDataRegistryIds: ['external:fire-platform'] },
    { caseId: 'DEMO-B', floor: '20F', floorRegistryId: 'floor:20F', roomRegistryId: 'room:20f-machine-1', roomOutInstanceId: '352455b3-be38-49e3-9def-529cc1c81bcd', buildingRegistryId: 'building:wukuang', routeRegistryIds: ['route:evacuation', 'route:attack'], externalDataRegistryIds: ['external:fire-platform'] },
    { caseId: 'DEMO-C', floor: '20F', floorRegistryId: 'floor:20F', roomRegistryId: 'room:20f-house-1', roomOutInstanceId: 'c6a08fd7-0000-0000-0000-000000000000', buildingRegistryId: 'building:wukuang', routeRegistryIds: ['route:evacuation', 'route:attack'], externalDataRegistryIds: ['external:fire-platform'] },
  ],
};

export type ScenarioRegistry = typeof SCENARIO_REGISTRY;

export type ScenarioValidation = {
  status: 'verified' | 'pending_manual_review';
  sceneId: string | null;
  reasons: string[];
  target: {
    building: { registryId: string; name: string } | null;
    floor: RegistryFloor | null;
    room: RegistryRoom | null;
  };
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function validateScenarioInput(
  input: Record<string, unknown>,
  registry: ScenarioRegistry = SCENARIO_REGISTRY,
): ScenarioValidation {
  const reasons: string[] = [];
  const sceneId = str(input.sceneId);
  const floorName = str(input.floor);
  const roomName = str(input.room);

  if (Date.parse(registry.validUntil) < Date.now()) reasons.push('registry_expired');

  const sceneOk = !sceneId || sceneId === registry.sceneId;
  if (!sceneOk) reasons.push('scene_conflict');

  const floorMatches = registry.floors.filter((f) => f.name === floorName);
  if (floorName && floorMatches.length === 0) reasons.push('floor_not_found');
  if (floorMatches.length > 1) reasons.push('floor_conflict');

  const roomMatches = registry.rooms.filter((r) => r.name === roomName && (!floorName || r.floor === floorName));
  if (roomName && roomMatches.length === 0) reasons.push('room_not_found');
  if (roomMatches.length > 1) reasons.push('room_conflict');

  return {
    status: reasons.length ? 'pending_manual_review' : 'verified',
    sceneId: sceneOk ? registry.sceneId : null,
    reasons,
    target: {
      building: { registryId: registry.building.registryId, name: registry.building.name },
      floor: floorMatches[0] ?? null,
      room: roomMatches[0] ?? null,
    },
  };
}
