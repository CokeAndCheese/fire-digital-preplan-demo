/**
 * 三维推演子系统公共入口。只导出稳定的公共类型与 API。
 * 主工程与组件统一从 '@/lib/fire-simulation' 引入。
 */

export * from './contracts';
export {
  createFireSimulationController,
  validateSimulationPlan,
  SimulationContractError,
} from './controller';
export {
  createUStudioAdapter,
  type UStudioSceneSdk,
  type CreateUStudioAdapterOptions,
} from './ustudio-adapter';
export {
  FIRE_SIMULATION_EVENTS,
  dispatchFireSimulationLoad,
  dispatchFireSimulationControl,
  dispatchFireSimulationState,
  onFireSimulationEvent,
  parseFireSimulationLoadEvent,
  bindFireSimulationEvents,
  isBrowser,
  type FireSimulationControlName,
} from './events';
export {
  parsePoint,
  parsePathPoints,
  extractScenePosition,
  collectEquipmentObjectIds,
  collectWaterSourceObjectIds,
  WATER_SOURCE_KEYWORDS,
  toGeoLocation,
  resolveSceneInteriorRoute,
  resolveSceneObjects,
  resolveObjectPosition,
  resolveGroundHeight,
} from './scene-route-resolver';
export {
  generateZoneDeploy,
  zoneDeployToActions,
  type ZoneDeploy,
  type DeployZone,
  type DeployRoute,
  type ZoneDeployOptions,
  type ZoneId,
} from './zone-deploy';
