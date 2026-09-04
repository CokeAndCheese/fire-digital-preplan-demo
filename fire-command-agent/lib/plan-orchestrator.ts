import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  PLAN_CONTRACT_VERSION,
  type PlanDataStatus,
  type PlanEvidenceReference,
  type PlanInvocationRecord,
  type UnifiedFireRescuePlan,
} from './plan-contract';
import { planConsumers } from './plan-adapters';
import { PLAN_TEMPLATE_KB_ID } from './skills/fire-plan-template';
import type { SkillExecutionRequest, SkillExecutionResult } from './skills/types';

type PlanInput = Record<string, unknown>;
type InvokeSkill = (request: SkillExecutionRequest) => Promise<SkillExecutionResult>;
type InvokePlanStrategy = (input: Record<string, unknown>) => Promise<SkillExecutionResult>;

export type PlanRepository = {
  append(plan: UnifiedFireRescuePlan): UnifiedFireRescuePlan | Promise<UnifiedFireRescuePlan>;
  get(planId: string): UnifiedFireRescuePlan | undefined | Promise<UnifiedFireRescuePlan | undefined>;
  list(building?: string, limit?: number): UnifiedFireRescuePlan[] | Promise<UnifiedFireRescuePlan[]>;
  latest(incidentId: string): UnifiedFireRescuePlan | undefined | Promise<UnifiedFireRescuePlan | undefined>;
};

export type MutablePlanRepository = PlanRepository & {
  update(
    planId: string,
    expectedRevision: number,
    mutate: (plan: UnifiedFireRescuePlan) => UnifiedFireRescuePlan,
  ): UnifiedFireRescuePlan | Promise<UnifiedFireRescuePlan>;
};

export class InMemoryPlanRepository {
  private readonly plans = new Map<string, UnifiedFireRescuePlan>();
  private readonly versionsByIncident = new Map<string, UnifiedFireRescuePlan[]>();

  append(plan: UnifiedFireRescuePlan) {
    this.plans.set(plan.planId, plan);
    const versions = this.versionsByIncident.get(plan.event.incidentId) ?? [];
    versions.push(plan);
    this.versionsByIncident.set(plan.event.incidentId, versions);
    return plan;
  }

  get(planId: string) {
    return this.plans.get(planId);
  }

  list(building?: string, limit = 5) {
    return [...this.plans.values()]
      .filter((plan) => !building || plan.building.name === building)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, limit));
  }

  latest(incidentId: string) {
    const versions = this.versionsByIncident.get(incidentId) ?? [];
    return versions.at(-1);
  }

  update(planId: string, expectedRevision: number, mutate: (plan: UnifiedFireRescuePlan) => UnifiedFireRescuePlan) {
    const current = this.plans.get(planId);
    if (!current) throw new Error('未找到指定预案。');
    if (current.revision !== expectedRevision) throw new Error('预案已被其他操作更新，请刷新后重试。');
    const next = mutate(structuredClone(current));
    if (next.planId !== planId || next.revision !== current.revision + 1) {
      throw new Error('预案更新必须保持编号且递增 revision。');
    }
    this.plans.set(planId, next);
    const versions = this.versionsByIncident.get(current.event.incidentId) ?? [];
    const index = versions.findIndex((plan) => plan.planId === planId);
    if (index >= 0) versions[index] = next;
    return next;
  }
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const normalizedLocationLabel = (value: unknown): string | null => text(value)?.replace(/\s+/g, '').toLocaleLowerCase() ?? null;
const count = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : null;
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.map(record).filter((item): item is Record<string, unknown> => Boolean(item))
  : [];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonical(source[key])]));
}

function fingerprint(value: unknown) {
  const source = JSON.stringify(canonical(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableText(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(canonical(value));
}

function businessProjection(plan: UnifiedFireRescuePlan) {
  return {
    event: { incidentId: plan.event.incidentId, receivedAt: plan.event.receivedAt, fireType: plan.event.fireType },
    building: plan.building,
    spatialTarget: {
      sceneId: plan.spatialTarget.sceneId, floor: plan.spatialTarget.floor, floorId: plan.spatialTarget.floorId,
      room: plan.spatialTarget.room, roomId: plan.spatialTarget.roomId, firePartition: plan.spatialTarget.firePartition,
    },
    incident: {
      trappedCount: plan.incident.trappedCount, burnAreaSqm: plan.incident.burnAreaSqm,
      spreadTrend: plan.incident.spreadTrend, specialHazards: plan.incident.specialHazards,
    },
    responseLevel: plan.responseLevel.recommendation,
    forceComposition: plan.forceComposition.units.map((unit) => ({
      unitId: unit.unitId, name: unit.name, personnel: unit.personnel, vehicles: unit.vehicles,
      equipment: unit.equipment, etaMinutes: unit.etaMinutes, availabilityStatus: unit.availabilityStatus,
    })),
    strategies: Object.fromEntries(Object.entries(plan.strategies).map(([key, strategy]) => [key, strategy.content])),
  };
}

function difference(before: unknown, after: unknown, path = ''): UnifiedFireRescuePlan['versionDiff'] {
  if (Object.is(before, after)) return [];
  const beforeRecord = record(before);
  const afterRecord = record(after);
  if (beforeRecord && afterRecord) {
    return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
      .sort()
      .flatMap((key) => difference(beforeRecord[key], afterRecord[key], path ? `${path}.${key}` : key));
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
  }
  return [{ path: path || '$', before: stableText(before), after: stableText(after) }];
}

function asEvidenceRef(result: SkillExecutionResult, fieldPaths: string[], trusted: boolean): PlanEvidenceReference {
  return {
    referenceId: `evidence-${result.executionId}`,
    kind: result.skillId === 'response-level' ? 'rule' : result.mode === 'platform' ? 'platform' : result.mode === 'bridge' ? 'skill' : 'skill',
    sourceId: result.executionId,
    sourceName: `${result.skillId}.${result.actionId}`,
    collectedAt: result.finishedAt,
    status: trusted ? 'verified' : result.ok ? 'unavailable' : 'missing',
    fieldPaths,
    ...(trusted ? {} : { note: result.error || result.summary }),
  };
}

function resultPayload(result: SkillExecutionResult) {
  const data = result.data ?? {};
  // Skill bridges return an envelope ({ ok, status, data }). Keep the
  // customer-facing audit payload intact, but let orchestration consume the
  // business data inside that envelope.
  const nested = record(data)?.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : data;
}

/**
 * 回执是否可引用。
 *
 * bridge/platform 表示数据来自外部系统，可核验。
 * response-level 与 plan-template 例外——两者都是本地确定性规则运算：
 * 等级由规则分值算出，层级由等级映射得出，不含对外部状态的断言，
 * 因此 simulation 模式同样可引用。
 *
 * 注意 plan-template 的知识库章节部分**是**外部断言，
 * 但那部分单独用 sectionRetrievalStatus 与 warnings 呈现，
 * 且该块 status 恒为 pending_manual_review，不会被误当作已核对。
 */
function trusted(result: SkillExecutionResult) {
  return result.ok && (
    result.mode === 'bridge'
    || result.mode === 'platform'
    || result.skillId === 'response-level'
    || result.skillId === 'plan-template'
  );
}

function removeTargetTree(value: Record<string, unknown> | null): void {
  if (!value) return;
  const target = record(value.target);
  if (target) delete target.tree;
  removeTargetTree(record(value.data));
  removeTargetTree(record(value.spatial));
}

function compactScenePayload(value: Record<string, unknown>): Record<string, unknown> {
  const output = structuredClone(value);
  removeTargetTree(output);
  return output;
}

function compactInvocationOutput(result: SkillExecutionResult): Record<string, unknown> | null {
  if (!result.data) return null;
  const output = structuredClone(result.data);
  if (result.skillId !== 'scene-control') return output;
  removeTargetTree(output);
  return output;
}

const DEMO_FORCE_POLICY = {
  version: 'sanya-fire-demo-force-v1',
  minUnitsByLevel: { I: 4, II: 3, III: 2, IV: 1, V: 1 },
  additionalUnitsPerTrapped: 1,
  highRiseFloor: 15,
  highRiseAdditionalUnits: 1,
};

function withDemoDefaults(input: PlanInput): PlanInput {
  return {
    ...input,
    building: input.building ?? '五矿国际广场',
    fireType: input.fireType ?? '电气火灾',
    sceneType: input.sceneType ?? '高层公共建筑',
    firePartition: input.firePartition ?? `起火楼层 ${text(input.floor) ?? '目标楼层'} 防火分区`,
    burnArea: input.burnArea ?? 35,
    spreadTrend: input.spreadTrend ?? '正在蔓延',
    casualtyCount: input.casualtyCount ?? 0,
    missingPersonCount: input.missingPersonCount ?? 0,
    specialHazards: input.specialHazards ?? [],
    facilityStatus: input.facilityStatus ?? '消防设施正常',
    weatherConstraints: input.weatherConstraints ?? [],
    roadConstraints: input.roadConstraints ?? [],
    longitude: input.longitude ?? 109.512,
    latitude: input.latitude ?? 18.252,
    radiusKm: input.radiusKm ?? 20,
    responseLevelConfirmed: input.responseLevelConfirmed ?? true,
    forcePolicy: input.forcePolicy ?? DEMO_FORCE_POLICY,
  };
}

/**
 * 预案模板块。
 *
 * 数据来自 plan-template Skill 的 retrieve_template_sections 动作：
 * 先按响应等级推导编制层级，再从消防预案库取模板章节结构。
 *
 * status 恒为 pending_manual_review——层级映射是业务惯例而非规范条文，
 * 且直接决定力量调派规模。知识库不可达时章节表为空，
 * 这时 sectionRetrieval.status 会说明原因，不用规范章节数编造标题。
 */
function planTemplateBlock(
  result: SkillExecutionResult | null,
  evidenceRefs: string[],
): UnifiedFireRescuePlan['planTemplate'] {
  const payload = result ? record(result.data) ?? {} : {};
  const tier = text(payload.tier);
  const sections = records(payload.sections)
    .map((entry) => ({ ordinal: count(entry.ordinal) ?? 0, title: text(entry.title) ?? '' }))
    .filter((entry) => entry.ordinal > 0 && entry.title.length > 0);
  const retrieval = record(payload.sectionRetrieval);
  const resolved = tier === 'station' || tier === 'battalion' || tier === 'brigade' || tier === 'headquarters'
    ? tier
    : null;
  const category = text(payload.buildingCategory);
  return {
    status: resolved && result?.ok ? 'pending_manual_review' : 'unresolved',
    tier: resolved,
    tierLabel: text(payload.tierLabel),
    fileName: text(payload.fileName),
    expectedSectionCount: count(payload.expectedSectionCount),
    buildingCategory: category === 'high_rise' || category === 'underground'
      || category === 'commercial_complex' || category === 'other'
      ? category
      : null,
    knowledgeBaseId: text(payload.knowledgeBaseId) ?? PLAN_TEMPLATE_KB_ID,
    retrievalHints: Array.isArray(payload.retrievalHints)
      ? payload.retrievalHints.filter((item): item is string => typeof item === 'string')
      : [],
    sections,
    sectionRetrievalStatus: (() => {
      const status = text(retrieval?.status);
      return status === 'retrieved' || status === 'unavailable' || status === 'not_configured' ? status : null;
    })(),
    sectionCountMatches: typeof retrieval?.sectionCountMatches === 'boolean' ? retrieval.sectionCountMatches : null,
    rationale: Array.isArray(payload.rationale)
      ? payload.rationale.filter((item): item is string => typeof item === 'string')
      : [],
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter((item): item is string => typeof item === 'string')
      : [],
    evidenceRefs,
    ...(resolved && result?.ok ? {} : {
      failureReason: result?.error || text(retrieval?.failureReason) || '未收到可引用的模板选取回执。',
    }),
  };
}

/**
 * 路线水源块。
 *
 * 数据来自 route-water Skill 的两个动作：
 * - query_nearby_water_sources → 按距离排序的候选水源 + 台账覆盖率
 * - query_route_constraints    → 实时路况与天气，作为道路可达性约束
 *
 * status 判定：
 * - 无坐标输入            → failed，无法按距离检索
 * - 有水源但路线未核验    → pending_manual_review
 * - 恒不置 ready          → 主备路线需要已核验的场景对象 ID 与现场确认，
 *                            水源台账口径压力全空、26% 无坐标，不支持无人复核取水
 */
function routeWaterBlock(
  waterResult: SkillExecutionResult | null,
  constraintResult: SkillExecutionResult | null,
  evidenceRefs: string[],
): UnifiedFireRescuePlan['routeWater'] {
  const waterData = record(waterResult?.data);
  const constraintData = record(constraintResult?.data);

  const rawSources = Array.isArray(waterData?.sources) ? waterData.sources : [];
  const waterSources = rawSources
    .map((entry) => record(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      id: text(entry.id) ?? '未编号水源',
      code: text(entry.code),
      address: text(entry.address),
      distanceKm: typeof entry.distanceKm === 'number' ? entry.distanceKm : 0,
      usability: (entry.usability === 'available' || entry.usability === 'unavailable'
        ? entry.usability
        : 'unknown') as 'available' | 'unavailable' | 'unknown',
      diameterMm: typeof entry.diameterMm === 'number' ? entry.diameterMm : null,
      pressureMpa: typeof entry.pressureMpa === 'number' ? entry.pressureMpa : null,
      // 坐标与 sourceRecordId 台账里本来就有，此前被编排层丢掉，
      // 导致需求书 §8.3 要求的"真实 ID 或坐标"在预案里只剩 ID。
      longitude: count(entry.longitude), latitude: count(entry.latitude),
      sourceRecordId: text(entry.sourceRecordId),
      // 台账 type 列 3990 条全空，无法判定室内/室外/水池/水泵接合器，
      // 保持 null 而不按 code 前缀猜（BDX-001 是位置编号，不是类型码）。
      waterType: null,
      // importedAt 是台账导入时间，不是水源核验时间，不能当 verifiedAt 用。
      verifiedAt: null,
      source: '三亚消防水源台账（hydrants.json）',
      distanceBasis: 'straight_line' as const,
      // 只到平台登记这一档；现场核验和人工确认必须由复核动作写入。
      confirmation: 'platform_registered' as const,
      role: null,
    }));

  const quality = record(waterData?.dataQuality);
  const coverage = quality
    ? {
      totalRecords: count(quality.totalRecords) ?? 0,
      usableRecords: count(quality.usableRecords) ?? 0,
      coverageRatio: typeof quality.coverageRatio === 'number' ? quality.coverageRatio : 0,
    }
    : null;

  const traffic = record(constraintData?.traffic);
  const weatherRaw = record(constraintData?.weather);
  const blocking = Array.isArray(constraintData?.blockingRoads) ? constraintData.blockingRoads : [];
  const accessibility = traffic || weatherRaw
    ? {
      overallLevel: text(traffic?.overallLabel),
      blockingRoads: blocking
        .map((entry) => record(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((road) => ({
          roadName: text(road.roadName),
          levelLabel: text(road.levelLabel),
          speedKmh: typeof road.speedKmh === 'number' ? road.speedKmh : null,
          trend: text(road.trend),
        })),
      weather: weatherRaw
        ? {
          condition: text(weatherRaw.weather),
          temperatureCelsius: typeof weatherRaw.temperatureCelsius === 'number' ? weatherRaw.temperatureCelsius : null,
          windDirection: text(weatherRaw.windDirection),
          windPower: text(weatherRaw.windPower),
        }
        : null,
    }
    : null;

  const hasWater = waterSources.length > 0;
  const status: PlanDataStatus = waterResult === null
    ? 'not_requested'
    : waterResult.ok === false
      ? 'failed'
      : 'pending_manual_review';

  const routeFailure = hasWater
    ? '主备路线需在已核验的场景对象上绘制，并结合现场进攻面确认。'
    : '未取得候选水源，主备路线无法生成。';

  return {
    status,
    calculationVersion: hasWater ? 'sanya-route-water-v1' : null,
    accessibility,
    primaryRoute: { entryPoint: null, waypoints: [], status: 'pending_manual_review', failureReason: routeFailure },
    backupRoute: { entryPoint: null, waypoints: [], status: 'pending_manual_review', failureReason: routeFailure },
    waterSources,
    coverage,
    evidenceRefs,
    ...(status === 'failed'
      ? { failureReason: waterResult?.error || waterResult?.summary || '水源检索失败。' }
      : hasWater
        ? {}
        : { failureReason: '未取得可用水源；需补测坐标或人工核实就近取水点。' }),
  };
}

/**
 * 昼夜差异化处置块。
 *
 * 预留实现：只回传调用方声明的昼夜模式，不产出任何处置内容。
 * 知识库补充昼夜处置资料后，在此接入 file_search 检索并填充 adjustments/knowledgeRefs，
 * 届时 status 才可置为 'ready'。当前一律不置 'ready'，避免空块被下游当作已就绪证据。
 */
function dayNightBlock(input: PlanInput): UnifiedFireRescuePlan['dayNightStrategy'] {
  const raw = text(input.timeOfDay);
  const mode = raw === 'day' || raw === 'night' ? raw : null;
  return {
    status: 'not_requested',
    mode,
    adjustments: [],
    knowledgeRefs: [],
    evidenceRefs: [],
    failureReason: mode
      ? '昼夜处置知识库尚未接入；差异化调整项需人工补充。'
      : '未声明昼夜场景；差异化处置未启用。',
  };
}

function statusFor(result: SkillExecutionResult, hasUsablePayload: boolean): PlanDataStatus {
  if (!result.ok) return 'failed';
  return trusted(result) && hasUsablePayload ? 'ready' : 'pending_manual_review';
}

function inputEvidence(input: PlanInput, now: string, incidentId: string): PlanEvidenceReference {
  return {
    referenceId: `input-${fingerprint(input)}`,
    kind: 'input',
    sourceId: `incident-input-${incidentId}`,
    sourceName: '指挥台录入',
    collectedAt: now,
    status: 'verified',
    fieldPaths: Object.keys(input).sort(),
  };
}

function incidentEvidence(input: PlanInput, incidentId: string, now: string) {
  const provided = record(input.incident);
  if (provided) return provided;
  const source = { sourceId: `incident-input-${incidentId}`, sourceType: 'manual', collectedAt: now };
  const field = (value: unknown) => value === undefined ? {
    value: null, status: 'missing', source: { sourceId: null, sourceType: 'not_collected', collectedAt: null }, confidence: 0, collectedAt: null, manuallyConfirmed: false,
  } : {
    value, status: 'reported', source, confidence: 0.55, collectedAt: now, manuallyConfirmed: false,
  };
  return {
    incidentId,
    receivedAt: now,
    building: field(input.building),
    floor: field(input.floor),
    // Floor-only intake is valid for the real scene tree. The rule engine
    // still needs a textual incident area, so keep that evidence separate
    // from the scene locator's floor-only target.
    room: field(input.room ?? `${text(input.floor) ?? '目标楼层'} 起火区域`),
    firePartition: field(input.firePartition),
    venueType: field(input.sceneType),
    fireMaterialOrType: field(input.fireType),
    burnAreaSqm: field(input.burnArea),
    spreadTrend: field(input.spreadTrend),
    trappedCount: field(input.trappedCount),
    casualtyCount: field(input.casualtyCount),
    missingPersonCount: field(input.missingPersonCount),
    specialHazards: field(input.specialHazards),
    facilityStatus: field(input.facilityStatus),
    weatherConstraints: field(input.weatherConstraints),
    roadConstraints: field(input.roadConstraints),
  };
}

/**
 * 从等级 Skill 回执里取命中规则。
 *
 * 规则引擎的 calculationItems 一直带着 ruleId/label/points/evidenceFields，
 * 只是从未写进预案契约，导致复核界面和 Word 取不到得分构成（需求书 §9 等级域必备）。
 */
function levelMatchedRules(levelData: Record<string, unknown>) {
  return records(levelData.calculationItems).map((item) => ({
    ruleId: text(item.ruleId) || 'UNKNOWN_RULE',
    name: text(item.label) || text(item.ruleId) || '未命名规则',
    score: count(item.points) ?? 0,
    explanation: text(item.explanation ?? item.label),
    fieldPaths: Array.isArray(item.evidenceFields)
      ? item.evidenceFields.filter((field): field is string => typeof field === 'string')
      : [],
  }));
}

/** 计算分项。取证据字段的标签与值，供复核员核对得分来源。 */
function levelScoreBreakdown(levelData: Record<string, unknown>) {
  return records(levelData.calculationItems).map((item) => ({
    dimension: text(item.label) || text(item.ruleId) || '未命名分项',
    value: text(item.value),
    score: count(item.points) ?? 0,
  }));
}

/**
 * 冲突证据清单。需求书 §6 要求冲突与缺失分列，
 * 此前两者都塞进 missingEvidence，复核员分不清是没采到还是采到两个互斥值。
 */
function levelConflicts(levelData: Record<string, unknown>) {
  return records(levelData.evidence)
    .filter((item) => Array.isArray(item.conflicts) && item.conflicts.length > 0)
    .map((item) => `${text(item.label) || text(item.field) || '未命名字段'}存在冲突取值`);
}

/**
 * 11 步推演法的步骤定义。
 *
 * 与主库 124 条预案的既有 actionId/sdkAction 完全一致，不引入新命名——
 * 已落库的 stepId 和三维回执按 actionId 关联，改名会让历史回执失配。
 *
 * 第 5–8 步（进攻入口、水源、主路线、备用路线）是路线水源环节。
 * 早期 demo 库删掉这四步得到 8 步版本，那是删减产物而非设计。
 */
const SIMULATION_STEP_DEFINITIONS = [
  ['receive_incident', '接收火情并创建事件编号', 'panel_set_visible'],
  ['lock_spatial_target', '锁定建筑、楼层和房间', 'locate_space'],
  ['show_fire_partition', '展示起火楼层和防火分区', 'highlight_floor'],
  ['analyze_spread_risk', '分析相邻空间和蔓延风险', 'analyze_adjacency'],
  ['select_attack_entry', '选择停车点和进攻入口', 'select_attack_entry'],
  ['select_water_source', '选择水源', 'select_water_source'],
  ['draw_primary_route', '绘制主进攻路线', 'draw_primary_route'],
  ['draw_backup_route', '绘制疏散/备用路线', 'draw_backup_route'],
  ['show_force_composition', '展示力量编成', 'panel_set_visible'],
  ['sync_timeline', '按时间轴同步推演', 'set_view_mode'],
  ['review_issue_export_reset', '复核、签发、导出和复位', 'review_issue_export'],
] as const;

export const SIMULATION_STEP_COUNT = SIMULATION_STEP_DEFINITIONS.length;

/** 依赖路线水源数据的步序，缺数据时按此判定降级范围 */
const ROUTE_WATER_STEP_SEQUENCES = [5, 6, 7, 8] as const;

function simulationMappings(planId: string, input: PlanInput, context: Record<string, unknown>) {
  const routeWater = record(context.routeWater);
  const routeWaterReady = text(routeWater?.status) === 'ready';
  const waterSourceCount = Array.isArray(routeWater?.waterSources) ? routeWater.waterSources.length : 0;

  return SIMULATION_STEP_DEFINITIONS.map(([actionId, title, sdkAction], index) => {
    const sequence = index + 1;
    const dependsOnRouteWater = (ROUTE_WATER_STEP_SEQUENCES as readonly number[]).includes(sequence);
    const failureReason = dependsOnRouteWater && !routeWaterReady
      ? waterSourceCount > 0
        ? '已检索到候选水源，但主备路线尚未核验；进攻路线与取水点需人工确认后方可推演。'
        : '路线水源数据未就绪：需要已核验的场景对象 ID 与周边水源检索结果。'
      : '三维动作必须以已核验的场景对象和 SDK 回执为准；未核验数据只保留待人工复核。';

    return {
      stepId: `${planId}:step-${String(sequence).padStart(2, '0')}`,
      sequence,
      title,
      sdkAction,
      input: { planId, incidentId: text(input.incidentId), sceneId: text(input.sceneId), ...context },
      actionId,
      status: 'pending_manual_review' as const,
      evidenceRefs: [],
      failureReason,
    };
  });
}

async function invokeRecorded(
  invocations: PlanInvocationRecord[],
  invoke: InvokeSkill,
  request: SkillExecutionRequest,
) {
  const started = Date.now();
  const result = await invoke(request);
  const usable = trusted(result) && Boolean(result.data);
  invocations.push({
    sequence: invocations.length + 1,
    invocationId: result.executionId,
    skillId: result.skillId,
    actionId: result.actionId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: Math.max(Date.now() - started, Date.parse(result.finishedAt) - Date.parse(result.startedAt), 0),
    input: request.input ?? {},
    output: compactInvocationOutput(result),
    status: result.ok && usable ? 'succeeded' : result.ok ? 'degraded' : 'failed',
    ...(result.ok && usable ? {} : { degradationReason: result.error || result.summary }),
  });
  return result;
}

async function strategyRecorded(
  invocations: PlanInvocationRecord[],
  invoke: InvokePlanStrategy,
  input: Record<string, unknown>,
) {
  const started = Date.now();
  const result = await invoke(input);
  const usable = trusted(result) && Boolean(result.data);
  invocations.push({
    sequence: invocations.length + 1,
    invocationId: result.executionId,
    skillId: result.skillId,
    actionId: result.actionId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: Math.max(Date.now() - started, Date.parse(result.finishedAt) - Date.parse(result.startedAt), 0),
    input,
    output: result.data ?? null,
    status: result.ok && usable ? 'succeeded' : result.ok ? 'degraded' : 'failed',
    ...(result.ok && usable ? {} : { degradationReason: result.error || result.summary }),
  });
  return result;
}

export async function orchestratePlanDraft({
  input,
  createdBy = 'local-competition-orchestrator',
  repository,
  invoke,
  invokePlanStrategy,
  now = () => new Date().toISOString(),
}: {
  input: PlanInput;
  createdBy?: string;
  repository: PlanRepository;
  invoke: InvokeSkill;
  invokePlanStrategy: InvokePlanStrategy;
  now?: () => string;
}): Promise<UnifiedFireRescuePlan> {
  input = withDemoDefaults(input);
  const createdAt = now();
  const incidentId = text(input.incidentId) || text(record(input.incident)?.incidentId) || `INC-${fingerprint({
    building: input.building, sceneId: input.sceneId, floor: input.floor, floorId: input.floorId, room: input.room, roomId: input.roomId,
  }).toUpperCase()}`;
  const prior = await repository.latest(incidentId);
  const planId = `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const evidenceRefs: PlanEvidenceReference[] = [inputEvidence(input, createdAt, incidentId)];
  const invocations: PlanInvocationRecord[] = [];
  const roomOutInstanceId = input.roomOutInstanceId ?? input.room_out_instance_id;
  const spatial = await invokeRecorded(invocations, invoke, {
    skillId: 'scene-control', actionId: 'locate_space', taskId: planId,
    input: {
      sceneId: input.sceneId, building: input.building, floor: input.floor, floorId: input.floorId,
      room: input.room, roomId: input.roomId, roomOutInstanceId, twinsInstanceId: input.twinsInstanceId,
      trappedCount: input.trappedCount, fireType: input.fireType, burnArea: input.burnArea,
    },
  });
  const level = await invokeRecorded(invocations, invoke, {
    skillId: 'response-level', actionId: 'assess_response_level', taskId: planId,
    input: { incident: incidentEvidence(input, incidentId, createdAt) },
  });
  const force = await invokeRecorded(invocations, invoke, {
    skillId: 'fire-resource', actionId: 'query_nearby_units', taskId: planId,
    input: {
      address: input.address ?? input.building,
      longitude: input.longitude,
      latitude: input.latitude,
      radiusKm: input.radiusKm ?? 10,
      responseLevel: resultPayload(level).recommendedLevelCode,
      responseLevelConfirmed: input.responseLevelConfirmed,
      forcePolicy: input.forcePolicy,
      trappedCount: input.trappedCount,
      floor: input.floor,
      roomOutInstanceId,
      roadConstraints: input.roadConstraints,
    },
  });
  // 11 步推演法第 5–8 步的数据来源。需要起火点坐标；缺坐标时跳过检索，
  // 由 routeWaterBlock 按 not_requested 处理，不用编造坐标凑一次调用。
  const hasOrigin = Number.isFinite(Number(input.longitude)) && Number.isFinite(Number(input.latitude));
  const water = hasOrigin
    ? await invokeRecorded(invocations, invoke, {
      skillId: 'route-water', actionId: 'query_nearby_water_sources', taskId: planId,
      input: {
        longitude: input.longitude,
        latitude: input.latitude,
        radiusKm: input.waterSearchRadiusKm ?? 3,
        limit: input.waterSourceLimit ?? 10,
      },
    })
    : null;
  const routeConstraints = await invokeRecorded(invocations, invoke, {
    skillId: 'route-water', actionId: 'query_route_constraints', taskId: planId,
    input: {},
  });
  // 模板层级依赖响应等级，须在 level 之后调用。
  const planTemplate = await invokeRecorded(invocations, invoke, {
    skillId: 'plan-template', actionId: 'retrieve_template_sections', taskId: planId,
    input: {
      responseLevel: resultPayload(level).recommendedLevelCode,
      requestedTier: input.planTemplateTier,
      sceneType: input.sceneType,
      floorsAbove: input.floorsAbove,
      isUnderground: input.isUnderground,
    },
  });

  const strategy = await strategyRecorded(invocations, invokePlanStrategy, {
    incidentId, planId, input, spatial: compactScenePayload(resultPayload(spatial)), responseLevel: resultPayload(level), force: resultPayload(force),
    routeWater: { water: water ? resultPayload(water) : null, constraints: resultPayload(routeConstraints) },
  });

  const addEvidence = (result: SkillExecutionResult, fields: string[]) => {
    const evidence = asEvidenceRef(result, fields, trusted(result));
    evidenceRefs.push(evidence);
    return evidence.referenceId;
  };
  const spatialRef = addEvidence(spatial, ['spatialTarget']);
  const levelRef = addEvidence(level, ['responseLevel']);
  const forceRef = addEvidence(force, ['forceComposition']);
  const strategyRef = addEvidence(strategy, ['strategies']);
  const waterRef = water ? addEvidence(water, ['routeWater.waterSources']) : null;
  const constraintRef = addEvidence(routeConstraints, ['routeWater.accessibility']);
  const templateRef = addEvidence(planTemplate, ['planTemplate']);
  const routeWaterData = routeWaterBlock(
    water,
    routeConstraints,
    [waterRef, constraintRef].filter((ref): ref is string => typeof ref === 'string'),
  );

  const spatialPayload = resultPayload(spatial);
  // The scene bridge returns its business payload under `visualization`.
  // Keep accepting the older/direct `target` shape so a bridge upgrade does
  // not silently turn a verified scene result into a manual-review failure.
  const visualization = record(spatialPayload.visualization);
  const spatialData = record(spatialPayload.data) ?? spatialPayload;
  const target = record(spatialData.target) ?? record(visualization?.target);
  const targetObjectId = text(target?.objectId ?? target?.id ?? target?.roomId ?? target?.floorId);
  const targetLabel = text(target?.label ?? target?.name);
  const targetKind = text(target?.kind) ?? (
    text(target?.roomId) && normalizedLocationLabel(target?.name) !== normalizedLocationLabel(target?.floorName)
      ? 'space'
      : text(target?.floorId) ? 'floor' : null
  );
  const levelData = resultPayload(level);
  const forceData = resultPayload(force);
  const strategyData = resultPayload(strategy);
  const incidentRecord = record(input.incident);
  const incidentHazards = record(incidentRecord?.specialHazards);
  const forceRecommendation = record(forceData.forceComposition);
  const forceUnits = records(forceRecommendation?.selectedUnits);
  const forceCandidates = records(forceRecommendation?.candidateUnits);
  const availableUnits = forceUnits.length > 0 ? forceUnits : forceCandidates;
  const missingItems: string[] = [];
  const failedItems: UnifiedFireRescuePlan['failedItems'] = [];
  const track = (section: string, result: SkillExecutionResult, usable: boolean) => {
    if (!result.ok) failedItems.push({ section, reason: result.error || result.summary });
    else if (!usable) missingItems.push(`${section}缺少可核验的 Skill/MCP 回执`);
  };
  track('空间定位', spatial, trusted(spatial) && Boolean(target && targetObjectId));
  track('响应等级', level, trusted(level) && Boolean(levelData.recommendedLevelCode));
  track('力量编成', force, trusted(force) && availableUnits.length > 0);
  track('处置策略', strategy, trusted(strategy) && Boolean(strategyData.strategies));
  // 路线水源：回执可用即视为已就绪，不因为"主备路线待现场确认"而计入缺失项。
  //
  // 区分两件事——
  // - 缺回执：Skill 没返回可用数据，属于缺口，必须挡住签发；
  // - 待现场确认：水源已检索到，但进攻路线需指挥员在现场核定，
  //   这是流程的正常一环，不是数据缺口。
  // 若混为一谈，routeWater 恒不 ready 会让任何预案都无法签发。
  if (water) {
    const waterPayload = record(water.data);
    const hasSources = Array.isArray(waterPayload?.sources) && waterPayload.sources.length > 0;
    track('路线水源', water, trusted(water) && hasSources);
  }
  // 模板层级：只要推导出层级即视为已就绪。
  // 章节未取到（知识库未配置或不可达）不计入缺失项——
  // 层级本身已能指明参照哪份模板，章节缺口通过 warnings 呈现，
  // 否则未部署知识库的环境将无法签发任何预案。
  track('预案模板', planTemplate, trusted(planTemplate) && Boolean(text(record(planTemplate.data)?.tier)));

  const readStrategy = (key: string) => {
    const raw = record(record(strategyData.strategies)?.[key]);
    const content = text(raw?.content ?? record(strategyData.strategies)?.[key]);
    const ready = trusted(strategy) && Boolean(content);
    return {
      status: ready ? 'ready' as const : !strategy.ok ? 'failed' as const : 'pending_manual_review' as const,
      content,
      evidenceRefs: [strategyRef],
      ...(ready ? {} : { failureReason: strategy.error || '未收到可引用的策略 Skill 回执。' }),
    };
  };
  const forceReady = trusted(force) && availableUnits.length > 0;
  const levelReady = trusted(level) && typeof levelData.recommendedLevelCode === 'string';
  const resolvedResponseLevel = levelData.recommendedLevelCode === 'I' || levelData.recommendedLevelCode === 'II'
    || levelData.recommendedLevelCode === 'III' || levelData.recommendedLevelCode === 'IV'
    || levelData.recommendedLevelCode === 'V'
    ? levelData.recommendedLevelCode
    : null;
  const planTemplateData = planTemplateBlock(planTemplate, [levelRef, templateRef]);
  const spatialReady = trusted(spatial) && Boolean(target && targetObjectId);
  const resolvedFloor = targetKind === 'floor'
    ? targetLabel
    : text(target?.floorName ?? input.floor);
  const targetName = text(target?.name ?? target?.label);
  const floorLevelTarget = Boolean(
    targetName
    && resolvedFloor
    && normalizedLocationLabel(targetName) === normalizedLocationLabel(resolvedFloor),
  );
  const resolvedRoom = targetKind === 'space'
    ? targetLabel
    : floorLevelTarget ? null : text(target?.name ?? input.room);
  const resolvedRoomId = targetKind === 'space'
    ? targetObjectId
    : floorLevelTarget ? null : text(target?.roomId ?? input.roomId);
  const resolvedFloorId = targetKind === 'floor'
    ? targetObjectId
    : text(target?.floorId ?? input.floorId);
  const resolvedRoomOutInstanceId = floorLevelTarget
    ? null
    : text(input.room_out_instance_id ?? input.roomOutInstanceId);
  // 作战区域部署（best-effort，不阻断预案生成、不计入签发闸门）：
  // 按火点对象计算车辆停放/登高作业/器材/警戒区 + 进攻/三层疏散路线。
  let zoneDeployResult: SkillExecutionResult | null = null;
  const zoneFireObjectId = text(targetObjectId) || text(resolvedRoomOutInstanceId) || text(roomOutInstanceId);
  if (zoneFireObjectId) {
    try {
      zoneDeployResult = await invokeRecorded(invocations, invoke, {
        skillId: 'fire-zone-deploy', actionId: 'compute_zone_deploy', taskId: planId,
        input: { fireObjectId: zoneFireObjectId, sceneId: text(input.sceneId), floor: resolvedFloor, room: resolvedRoom },
      });
    } catch {
      zoneDeployResult = null;
    }
  }
  const zoneDeployPayload = record(zoneDeployResult?.data);
  const zoneDeployData = record(zoneDeployPayload?.deploy);
  const mapPoint = (p: unknown): { x: number; y: number; z: number } => {
    const r = record(p);
    return { x: count(r?.x) ?? 0, y: count(r?.y) ?? 0, z: count(r?.z) ?? 0 };
  };
  const zoneDeployZones = records(zoneDeployData?.zones).map((z) => ({
    id: text(z.id) ?? '', name: text(z.name) ?? '', color: text(z.color) ?? '', polygon: records(z.polygon).map(mapPoint),
  }));
  const zoneDeployRoutes = records(zoneDeployData?.routes).map((r) => ({
    id: text(r.id) ?? '', name: text(r.name) ?? '', color: text(r.color) ?? '', path: records(r.path).map(mapPoint),
  }));
  const zoneDeployFirePoint = record(zoneDeployPayload?.firePoint);
  const operationsDeployment = {
    status: (zoneDeployResult?.ok && zoneDeployZones.length ? 'ready' : 'pending_manual_review') as PlanDataStatus,
    firePoint: zoneDeployFirePoint
      ? { x: count(zoneDeployFirePoint.x) ?? 0, y: count(zoneDeployFirePoint.y) ?? 0, z: count(zoneDeployFirePoint.z) ?? 0 }
      : null,
    zones: zoneDeployZones,
    routes: zoneDeployRoutes,
    ...(zoneDeployZones.length ? {} : { failureReason: text(zoneDeployPayload?.message) ?? '作战区域部署未生成。' }),
  };

  // 演示：主/备路线无真实路网时，用作战区域部署的主/备路线（真实火点坐标）作为演示填充，
  // 避免预案的 routeWater.primaryRoute/backupRoute 恒为空壳（演示方向，非真实路网）。
  const mainDemoRoute = zoneDeployRoutes.find((r) => r.id === 'main_route');
  const backupDemoRoute = zoneDeployRoutes.find((r) => r.id === 'backup_route');
  if (routeWaterData && mainDemoRoute && !routeWaterData.primaryRoute?.waypoints?.length) {
    routeWaterData.primaryRoute = {
      entryPoint: '首层东侧消防通道（车辆停放区正对）',
      waypoints: mainDemoRoute.path.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`),
      status: 'pending_manual_review',
      failureReason: '主路线为作战区域部署近似路线（非真实路网），需现场核定路径与可达性；不标记为已就绪。',
    };
  }
  if (routeWaterData && backupDemoRoute && !routeWaterData.backupRoute?.waypoints?.length) {
    routeWaterData.backupRoute = {
      entryPoint: '首层西侧登高作业面（消防登高场地）',
      waypoints: backupDemoRoute.path.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`),
      status: 'pending_manual_review',
      failureReason: '备用路线为作战区域部署近似路线（非真实路网），需现场核定路径与可达性；不标记为已就绪。',
    };
  }

  const plan: UnifiedFireRescuePlan = {
    schemaVersion: PLAN_CONTRACT_VERSION,
    planId,
    version: (prior?.version ?? 0) + 1,
    revision: 1,
    previousPlanId: prior?.planId ?? null,
    versionDiff: [],
    inputFingerprint: fingerprint(input),
    event: { incidentId, receivedAt: text(record(input.incident)?.receivedAt), fireType: text(input.fireType), evidenceRefs: [evidenceRefs[0].referenceId] },
    building: { name: text(input.building), buildingId: text(input.buildingId) },
    spatialTarget: {
      sceneId: text(visualization?.sceneId ?? target?.sceneId ?? input.sceneId), floor: resolvedFloor, floorId: resolvedFloorId,
      room: resolvedRoom, roomId: resolvedRoomId, firePartition: text(input.firePartition),
      status: statusFor(spatial, Boolean(target && targetObjectId)), evidenceRefs: [spatialRef],
      ...(spatialReady ? {} : { failureReason: spatial.error || '空间目标尚未得到可引用的场景 Skill 回执。' }),
    },
    incident: {
      trappedCount: count(input.trappedCount), burnAreaSqm: count(input.burnArea), spreadTrend: text(input.spreadTrend),
      timeOfDay: text(input.timeOfDay) === 'day' || text(input.timeOfDay) === 'night' ? text(input.timeOfDay) as 'day' | 'night' : null,
      // 输入侧一直解析这两项（infer-action 的失联/伤亡正则），此前没进契约。
      // 用 count 而非 ?? 0：未知保持 null，不把「未核实」写成「0 人」。
      casualtyCount: count(input.casualtyCount), missingPersonCount: count(input.missingPersonCount),
      specialHazards: Array.isArray(input.specialHazards) ? input.specialHazards.filter((item): item is string => typeof item === 'string') : [],
      evidenceRefs: [evidenceRefs[0].referenceId],
    },
    responseLevel: {
      recommendation: resolvedResponseLevel,
      // 需求书 §6：编排流程不得写正式等级，只能由指挥员复核动作写入。
      confirmedLevel: null, confirmedBy: null, confirmedAt: null,
      ruleVersion: text(levelData.ruleVersion), status: statusFor(level, levelReady), evidenceRefs: [levelRef],
      riskScore: count(levelData.riskScore),
      matchedRules: levelMatchedRules(levelData),
      scoreBreakdown: levelScoreBreakdown(levelData),
      conflictingEvidence: levelConflicts(levelData),
      missingEvidence: Array.isArray(levelData.missingEvidence) ? levelData.missingEvidence.filter((item): item is string => typeof item === 'string') : [],
    },
    forceComposition: {
      status: statusFor(force, forceReady), evidenceRefs: [forceRef],
      units: availableUnits.map((unit) => ({
        unitId: text(unit.id), name: text(unit.name) || '未命名登记单位', personnel: typeof unit.personnelCount === 'number' ? unit.personnelCount : typeof unit.personnel === 'number' || typeof unit.personnel === 'string' ? unit.personnel : null,
        vehicles: Array.isArray(unit.vehicles) ? unit.vehicles : text(unit.vehicles) ? [unit.vehicles] : [],
        equipment: Array.isArray(unit.equipment) ? unit.equipment : text(unit.equipment) ? [unit.equipment] : [],
        etaMinutes: count(unit.etaMinutes), availabilityStatus: unit.availabilityStatus === 'verified' ? 'verified' : 'pending_manual_review',
        // 需求书 §7.1：四态互不混用。编排产出的是「纳入预案」，
        // dispatched 只能由外部调派系统回执写入，本工程不自行置位。
        engagementStatus: 'in_plan' as const,
        // 平台按 geodesic 算的直线距离，口径必须随值一起落库，
        // 否则复核员无法判断这是直线还是路网距离。
        distanceKm: count(unit.distanceKm),
        distanceBasis: count(unit.distanceKm) === null ? null : 'straight_line' as const,
        evidenceRefs: [forceRef],
      })),
      ...(forceReady ? {} : { failureReason: force.error || '力量平台未返回可核验的编成；ETA 与可用状态必须人工确认。' }),
    },
    // 后三项为需求书 §9 策略域要求的通信、安全、资源协同。
    // Skill 未产出内容时 readStrategy 返回 pending_manual_review，
    // 显式建块而不省略，让「策略缺失」在复核界面可见而不是静默消失。
    strategies: {
      suppression: readStrategy('suppression'), rescue: readStrategy('rescue'), evacuation: readStrategy('evacuation'),
      security: readStrategy('security'), smokeControl: readStrategy('smokeControl'),
      communication: readStrategy('communication'), safety: readStrategy('safety'),
      resourceCoordination: readStrategy('resourceCoordination'),
    },
    routeWater: routeWaterData,
    planTemplate: planTemplateData,
    dayNightStrategy: dayNightBlock(input),
    operationsDeployment,
    simulation: {
      status: 'pending_manual_review',
      mappings: simulationMappings(planId, input, {
        building: text(input.building),
        floor: resolvedFloor, floorId: resolvedFloorId,
        room: resolvedRoom, roomId: resolvedRoomId,
        roomOutInstanceId: resolvedRoomOutInstanceId,
        firePartition: text(input.firePartition),
        forceComposition: availableUnits,
        routeWater: routeWaterData,
        lifecycleStatus: 'draft', issuanceStatus: 'not_issued',
      }),
      evidenceRefs: [],
    },
    risks: [...new Set([
      ...(Array.isArray(incidentHazards?.value) ? incidentHazards.value.filter((item): item is string => typeof item === 'string') : []),
      ...failedItems.map((item) => `${item.section}失败`),
      ...missingItems,
    ])],
    missingItems: [...new Set(missingItems)], failedItems,
    review: { status: 'pending_manual_review', comments: [], reviewer: null, reviewedAt: null },
    issuance: { status: 'not_issued', issuer: null, issuedAt: null, blockReason: '预案必须先补齐失败/缺失项并完成人工复核。' },
    document: {
      status: 'not_requested', fileName: null, generatedAt: null, templateName: null,
      templateId: null, templateVersion: null, templateSource: null,
      verification: { status: 'not_run', checkedFields: [], missingFields: [] }, failureReason: null,
    },
    archive: { status: 'not_archived', archivedAt: null, archivedBy: null, index: null, contents: null, failureReason: null },
    waterQueries: [],
    simulationVerification: null,
    lifecycleStatus: 'draft', createdBy, createdAt, updatedBy: createdBy, updatedAt: now(), evidenceRefs,
    auditEvents: [
      // revision 固定 1：这两条事件产生于草稿创建时刻。
      // 需求书 §16 要求审计带 actorType/revision/source/requestId。
      {
        eventId: randomUUID(), type: prior ? 'input_revised' : 'created', at: createdAt, actor: createdBy,
        actorType: 'system', revision: 1, source: 'skill:fire-rescue-plan', requestId: planId,
        detail: prior ? `基于 ${prior.planId} 创建输入修订版本。` : '创建预案草稿。',
        evidenceRefs: [evidenceRefs[0].referenceId],
      },
      {
        eventId: randomUUID(), type: 'orchestration_completed', at: now(), actor: createdBy,
        actorType: 'system', revision: 1, source: 'skill:fire-rescue-plan', requestId: planId,
        detail: `已记录 ${invocations.length} 次编排调用；失败和降级项保留在草稿中。`,
        evidenceRefs: evidenceRefs.slice(1).map((item) => item.referenceId),
      },
    ],
    orchestration: invocations,
  };
  plan.versionDiff = prior ? difference(businessProjection(prior), businessProjection(plan)) : [];
  return await repository.append(plan);
}

export function planExecutionResult(request: SkillExecutionRequest, plan: UnifiedFireRescuePlan, executionId: string, startedAt: string): SkillExecutionResult {
  return {
    executionId, skillId: request.skillId, actionId: request.actionId, ok: true, mode: 'simulation', startedAt, finishedAt: new Date().toISOString(),
    summary: plan.missingItems.length || plan.failedItems.length ? '预案草稿已保存，缺失和失败项已转人工复核。' : '预案草稿已保存，等待人工复核。',
    data: { plan, consumers: planConsumers(plan), pendingReview: [...plan.missingItems, ...plan.failedItems.map((item) => item.section)] },
  };
}
