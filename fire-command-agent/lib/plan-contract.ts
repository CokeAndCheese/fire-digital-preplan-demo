export const PLAN_CONTRACT_VERSION = 'fire-rescue-plan/v1' as const;

export type PlanDataStatus = 'ready' | 'pending_manual_review' | 'failed' | 'not_requested';
/**
 * 预案生命周期。需求书 §10 状态机的全部 8 态。
 *
 * simulation_running / simulation_completed / archived / failed 为后补状态：
 * 早期实现只有 4 态，推演中与推演完成无法区分、归档态不存在。
 * 历史预案落库值仍在前 4 态内，读取兼容。
 */
export type PlanLifecycleStatus =
  | 'draft'
  | 'pending_manual_review'
  | 'approved'
  | 'simulation_running'
  | 'simulation_completed'
  | 'issued'
  | 'archived'
  | 'failed';
export const PLAN_LIFECYCLE_STATUSES: readonly PlanLifecycleStatus[] = [
  'draft', 'pending_manual_review', 'approved', 'simulation_running',
  'simulation_completed', 'issued', 'archived', 'failed',
];
export type PlanEvidenceKind = 'input' | 'skill' | 'mcp' | 'platform' | 'rule';

export type PlanChange = {
  path: string;
  before: string | null;
  after: string | null;
};

export type PlanEvidenceReference = {
  referenceId: string;
  kind: PlanEvidenceKind;
  sourceId: string;
  sourceName: string;
  collectedAt: string;
  status: 'verified' | 'unavailable' | 'conflict' | 'missing';
  fieldPaths: string[];
  note?: string;
};

export type PlanAuditActorType = 'human' | 'system' | 'skill' | 'platform';

export type PlanAuditEvent = {
  eventId: string;
  type:
    | 'created'
    | 'input_revised'
    | 'orchestration_completed'
    | 'review_recorded'
    | 'review_returned'
    | 'review_timeout'
    | 'simulation_recorded'
    | 'simulation_started'
    | 'issuance_blocked'
    | 'issued'
    | 'exported'
    | 'export_failed'
    | 'water_source_queried'
    | 'water_source_bound'
    | 'visual_check_completed'
    | 'archived';
  at: string;
  actor: string;
  detail: string;
  evidenceRefs: string[];
  /**
   * 需求书 §16 要求的审计四要素。可选字段：历史审计记录不含，
   * 缺失时按 unknown 显示，不回填伪造值。
   */
  actorType?: PlanAuditActorType;
  /** 事件发生时的预案版本；缺失表示无法定位到具体版本 */
  revision?: number;
  /** 触发来源：ui / api / skill:<id> / platform:<name> */
  source?: string;
  /** 请求链路标识，用于跨服务对账 */
  requestId?: string;
};

export type PlanSimulationVerification = {
  runId: string;
  attempt: number;
  status: 'completed' | 'failed' | 'reset' | 'unavailable';
  verifiedAt: string;
  completedStepIds: string[];
  failedStepIds: string[];
  detail: string;
};

export type PlanDocumentExport = {
  status: 'not_requested' | 'ready' | 'failed';
  fileName: string | null;
  generatedAt: string | null;
  templateName: string | null;
  /**
   * 模板溯源。需求书 §12.1 与验收清单第 462 条要求模板编号与版本可追溯。
   * 可选字段：既有导出记录只留了 templateName。
   * templateSource 用 'knowledge_base' 与 'local_demo' 区分是否真正取自知识库，
   * 避免本地兜底模板被当成知识库正式版式。
   */
  templateId?: string | null;
  templateVersion?: string | null;
  templateSource?: 'knowledge_base' | 'local_demo' | 'unknown' | null;
  verification: {
    status: 'passed' | 'failed' | 'not_run';
    checkedFields: string[];
    missingFields: string[];
    /**
     * 需求书 §12.1.1 逐页视觉验收。字段级校验看不到"占位符替换了但版面塌了"，
     * 所以额外把文档渲成每页位图再判。可选字段：既有导出记录没有这一块。
     */
    visual?: PlanDocumentVisualCheck | null;
  };
  failureReason: string | null;
};

/** 单页视觉度量。inkRatio 为非白像素占比，contentBox 为内容外接框（像素）。 */
export type PlanDocumentVisualPage = {
  pageNumber: number;
  width: number;
  height: number;
  inkRatio: number;
  contentBox: { left: number; top: number; right: number; bottom: number } | null;
  findings: string[];
};

export type PlanDocumentVisualCheck = {
  /**
   * pending：文档含图片页多、逐页渲染耗时可到分钟级（实测 21 页含楼层图约 25 分钟），
   * 导出接口不能同步等这么久，先落盘返回文件，验收转后台异步跑，跑完再回填本字段。
   */
  status: 'passed' | 'failed' | 'not_run' | 'pending';
  pageCount: number;
  pages: PlanDocumentVisualPage[];
  /** 渲染引擎标识，验收要能追溯是哪套版式引擎出的图 */
  renderer: string | null;
  checkedAt: string | null;
  failureReason: string | null;
};

/**
 * 归档域。需求书 §12.3 要求归档包含预案 JSON、Word、三维回执、复核记录、
 * 签发记录、平台数据引用和完整审计链，且支持只读导出。
 * 可选字段：既有预案无归档块。
 */
export type PlanArchive = {
  status: 'not_archived' | 'archived';
  archivedAt: string | null;
  archivedBy: string | null;
  /** 归档索引：按事件/建筑/场景/楼层/预案/版本检索的冗余键 */
  index: {
    incidentId: string;
    building: string | null;
    sceneId: string | null;
    floor: string | null;
    planId: string;
    revision: number;
  } | null;
  /** 归档内容清单，记录每类材料的条目数，供只读导出核对 */
  contents: {
    planJson: boolean;
    documentFileName: string | null;
    simulationReceipts: number;
    reviewRecords: number;
    auditEvents: number;
    platformReferences: number;
  } | null;
  failureReason: string | null;
};

export type PlanInvocationRecord = {
  sequence: number;
  invocationId: string;
  skillId: string;
  actionId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: 'succeeded' | 'failed' | 'degraded';
  degradationReason?: string;
};

/**
 * 对话栏周边水源查询记录。需求书 §8.3.1 要求每次查询留存
 * queryId、查询文本、解析目标、半径、过滤条件、数据源、返回时间、结果数和 evidenceRefs。
 */
export type PlanWaterSourceQuery = {
  queryId: string;
  /** 原始自然语言问题，不做改写 */
  question: string;
  askedAt: string;
  /** 解析出的查询目标；解析失败时为 null 并在 clarification 说明缺什么 */
  resolved: {
    unitName: string | null;
    address: string | null;
    sceneId: string | null;
    floor: string | null;
    room: string | null;
    longitude: number | null;
    latitude: number | null;
    radiusKm: number;
    waterType: string | null;
    excludeUnavailable: boolean;
  } | null;
  /** 距离计算口径，需求书要求明确标注 */
  distanceBasis: 'straight_line' | 'road_network' | 'platform_relation' | null;
  dataSource: string | null;
  resultCount: number;
  status: 'ready' | 'needs_clarification' | 'no_result' | 'failed';
  /** 缺定位信息时的补充要求，不猜对象 */
  clarification: string | null;
  evidenceRefs: string[];
  failureReason?: string;
};

export type SimulationActionMapping = {
  stepId: string;
  sequence: number;
  title: string;
  sdkAction: string;
  input: Record<string, unknown>;
  actionId: string | null;
  status: PlanDataStatus;
  evidenceRefs: string[];
  failureReason?: string;
};

export type UnifiedFireRescuePlan = {
  schemaVersion: typeof PLAN_CONTRACT_VERSION;
  planId: string;
  version: number;
  revision: number;
  previousPlanId: string | null;
  versionDiff: PlanChange[];
  inputFingerprint: string;
  event: {
    incidentId: string;
    receivedAt: string | null;
    fireType: string | null;
    evidenceRefs: string[];
  };
  building: {
    name: string | null;
    buildingId: string | null;
  };
  spatialTarget: {
    sceneId: string | null;
    floor: string | null;
    floorId: string | null;
    room: string | null;
    roomId: string | null;
    firePartition: string | null;
    status: PlanDataStatus;
    evidenceRefs: string[];
    failureReason?: string;
  };
  incident: {
    trappedCount: number | null;
    burnAreaSqm: number | null;
    spreadTrend: string | null;
    /** 可选：v1 早期已落库的预案不含此字段 */
    timeOfDay?: 'day' | 'night' | null;
    /**
     * 伤亡与失联人数。需求书 §4.2 列为必备灾情要素。
     * 可选字段：早期预案未落这两项（输入侧一直能解析，只是没进契约）。
     * null 表示未知，不用 0 静默补值——0 人伤亡与未核实是两件事。
     */
    casualtyCount?: number | null;
    missingPersonCount?: number | null;
    specialHazards: string[];
    evidenceRefs: string[];
  };
  responseLevel: {
    /** 规则引擎给出的建议等级，永远不等于正式签发等级 */
    recommendation: 'I' | 'II' | 'III' | 'IV' | 'V' | null;
    /**
     * 指挥员核定的正式等级。需求书 §6：系统不得把规则建议自动写成正式签发等级。
     * 可选字段 + 默认 null：只能由复核动作写入，编排流程不得填充。
     */
    confirmedLevel?: 'I' | 'II' | 'III' | 'IV' | 'V' | null;
    confirmedBy?: string | null;
    confirmedAt?: string | null;
    ruleVersion: string | null;
    /** 风险分数与命中规则。需求书 §9 等级域必备，此前只留在 orchestration[] 里 */
    riskScore?: number | null;
    matchedRules?: Array<{
      ruleId: string;
      name: string;
      score: number;
      explanation: string | null;
      fieldPaths: string[];
    }>;
    /** 计算分项，供复核界面解释得分构成 */
    scoreBreakdown?: Array<{ dimension: string; value: string | null; score: number }>;
    /** 冲突证据清单，与 missingEvidence 分列 */
    conflictingEvidence?: string[];
    status: PlanDataStatus;
    evidenceRefs: string[];
    missingEvidence: string[];
  };
  forceComposition: {
    status: PlanDataStatus;
    units: Array<{
      unitId: string | null;
      name: string;
      personnel: string | number | null;
      vehicles: unknown[];
      equipment: unknown[];
      etaMinutes: number | null;
      availabilityStatus: 'verified' | 'pending_manual_review';
      /**
       * 力量参与状态。需求书 §7.1：平台登记、候选推荐、纳入预案、已调派
       * 必须使用不同状态，不能混用。
       * dispatched 只能由外部调派系统回执写入，本工程不自行置位。
       * 可选字段：既有预案只有 availabilityStatus。
       */
      engagementStatus?: 'platform_registered' | 'candidate_recommended' | 'in_plan' | 'dispatched';
      /** 队站到事件点距离与口径。需求书 §7.2 要求明确距离类型 */
      distanceKm?: number | null;
      distanceBasis?: 'straight_line' | 'road_network' | null;
      evidenceRefs: string[];
    }>;
    evidenceRefs: string[];
    failureReason?: string;
  };
  /**
   * 处置策略。前 5 项为既有必备键；communication / safety / resourceCoordination
   * 是需求书 §9 策略域要求的通信、安全、资源协同三项，按可选键补入，
   * 既有预案缺失时按未产出处理，不阻塞主流程。
   */
  strategies: Record<'suppression' | 'rescue' | 'evacuation' | 'security' | 'smokeControl', {
    status: PlanDataStatus;
    content: string | null;
    evidenceRefs: string[];
    failureReason?: string;
  }> & Partial<Record<'communication' | 'safety' | 'resourceCoordination', {
    status: PlanDataStatus;
    content: string | null;
    evidenceRefs: string[];
    failureReason?: string;
  }>>;
  /**
   * 预案模板选取。来自知识库「消防预案库」的 站级/大队级/支队级/总队级 模板。
   *
   * 机构层级与 Ⅰ–Ⅴ 响应等级是两个维度：前者定谁编制、调多少力量，
   * 后者定火情多严重。两者的对应关系是业务惯例，故 status 恒为
   * pending_manual_review，须指挥员核定层级后方可定稿。
   *
   * 可选字段：既有预案不含此块。
   */
  planTemplate?: {
    status: 'pending_manual_review' | 'unresolved';
    tier: 'station' | 'battalion' | 'brigade' | 'headquarters' | null;
    tierLabel: string | null;
    /** 知识库中的模板文件名 */
    fileName: string | null;
    expectedSectionCount: number | null;
    buildingCategory: 'high_rise' | 'underground' | 'commercial_complex' | 'other' | null;
    knowledgeBaseId: string;
    retrievalHints: string[];
    /**
     * 从知识库取到的模板章节。
     *
     * 空数组表示未核对过模板（知识库未配置或不可达），
     * 不表示模板没有章节——绝不用 expectedSectionCount 编造标题填充。
     */
    sections?: Array<{ ordinal: number; title: string }>;
    sectionRetrievalStatus?: 'retrieved' | 'unavailable' | 'not_configured' | null;
    /** 检索章节数与规范章节数是否一致；null 表示未检索 */
    sectionCountMatches?: boolean | null;
    rationale: string[];
    warnings: string[];
    evidenceRefs: string[];
    failureReason?: string;
  };
  /**
   * 路线与水源。11 步推演法第 5–8 步的数据来源。
   *
   * 字段结构与主库 124 条既有预案一致，未改名——历史预案按这些字段落库，
   * 改名会让已归档预案的路线水源数据读不出来。
   *
   * 可选字段：早期 demo 库删掉了这一整块（连带 11 步降为 8 步），读取时兼容。
   */
  routeWater?: {
    status: PlanDataStatus;
    calculationVersion: string | null;
    /** 道路可达性约束，来自平台实时路况；不含行车时间 */
    accessibility: {
      overallLevel: string | null;
      blockingRoads: Array<{
        roadName: string | null;
        levelLabel: string | null;
        speedKmh: number | null;
        trend: string | null;
      }>;
      weather: {
        condition: string | null;
        temperatureCelsius: number | null;
        windDirection: string | null;
        windPower: string | null;
      } | null;
    } | null;
    primaryRoute: {
      /** 停车点与进攻入口 */
      entryPoint: string | null;
      waypoints: string[];
      status: PlanDataStatus;
      failureReason?: string;
    } | null;
    backupRoute: {
      entryPoint: string | null;
      waypoints: string[];
      status: PlanDataStatus;
      failureReason?: string;
    } | null;
    /** 按距离升序的候选水源；距离口径见 distanceBasis */
    waterSources: Array<{
      id: string;
      code: string | null;
      address: string | null;
      distanceKm: number;
      usability: 'available' | 'unavailable' | 'unknown';
      /** 源数据缺口：口径与压力全空，供水能力不可核算 */
      diameterMm: number | null;
      pressureMpa: number | null;
      /**
       * 需求书 §8.3 要求的水源类型、坐标、核验时间与来源。
       * 可选字段：既有预案的水源条目只有上面 7 项。
       * verifiedAt 为 null 表示台账未记核验时间，不可显示为已核验。
       */
      waterType?: 'municipal_pipe' | 'pool' | 'pump_house' | 'siamese' | 'outdoor_hydrant' | 'indoor_hydrant' | 'other' | null;
      longitude?: number | null;
      latitude?: number | null;
      verifiedAt?: string | null;
      source?: string | null;
      sourceRecordId?: string | null;
      distanceBasis?: 'straight_line' | 'road_network' | 'platform_relation' | null;
      /** 主/备水源指派，需求书 §8.3 要求支持按主备排序；仅人工确认后写入 */
      role?: 'primary' | 'backup' | null;
      /** 平台登记 / 现场核验 / 人工确认 / 未知，需求书 §8.3.1 要求标明 */
      confirmation?: 'platform_registered' | 'field_verified' | 'manually_confirmed' | 'unknown' | null;
    }>;
    /** 水源台账清洗覆盖率，避免把部分结果当全量 */
    coverage: {
      totalRecords: number;
      usableRecords: number;
      coverageRatio: number;
    } | null;
    evidenceRefs: string[];
    failureReason?: string;
  };
  /**
   * 昼夜场景差异化处置。预留块：知识库补充昼夜处置资料后填充。
   * 当前实现返回 status='not_requested'，不产出内容，也不阻塞主流程。
   * 可选字段：v1 早期已落库的预案不含此块，读取时按缺省处理，不做迁移。
   */
  dayNightStrategy?: {
    status: PlanDataStatus;
    mode: 'day' | 'night' | null;
    /** 相对基准处置方案的调整项，例如夜间照明、疏散广播、人员集结时间 */
    adjustments: Array<{
      dimension: 'lighting' | 'evacuation' | 'assembly' | 'visibility' | 'staffing' | 'other';
      content: string;
      evidenceRefs: string[];
    }>;
    /** 知识库来源标识，便于后续接入 file_search 检索结果 */
    knowledgeRefs: string[];
    evidenceRefs: string[];
    failureReason?: string;
  };
  /**
   * 作战区域部署。需求书：车辆停放区/登高作业面/器材摆放区/警戒区 + 进攻/三层疏散路线，三维可视化。
   * 可选字段：既有预案无此块，读取时按未部署处理，不做迁移。
   */
  operationsDeployment?: {
    status: PlanDataStatus;
    firePoint?: { x: number; y: number; z: number } | null;
    zones: Array<{ id: string; name: string; color: string; polygon: Array<{ x: number; y: number; z: number }> }>;
    routes: Array<{ id: string; name: string; color: string; path: Array<{ x: number; y: number; z: number }> }>;
    failureReason?: string | null;
  };
  simulation: {
    status: PlanDataStatus;
    mappings: SimulationActionMapping[];
    evidenceRefs: string[];
  };
  simulationVerification: PlanSimulationVerification | null;
  risks: string[];
  missingItems: string[];
  failedItems: Array<{ section: string; reason: string }>;
  review: {
    status: 'pending_manual_review' | 'approved' | 'rejected';
    comments: Array<{ author: string; content: string; at: string }>;
    reviewer: string | null;
    reviewedAt: string | null;
  };
  issuance: {
    status: 'not_issued' | 'issued' | 'blocked';
    issuer: string | null;
    issuedAt: string | null;
    blockReason: string | null;
  };
  document: PlanDocumentExport;
  /** 归档域。可选字段：既有预案无此块，读取时按未归档处理 */
  archive?: PlanArchive;
  /**
   * 对话栏水源查询留痕。需求书 §8.3.1 与验收清单第 457 条要求保留
   * queryId / evidenceRef 和人工复核链。可选字段：既有预案无此块。
   */
  waterQueries?: PlanWaterSourceQuery[];
  lifecycleStatus: PlanLifecycleStatus;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  evidenceRefs: PlanEvidenceReference[];
  auditEvents: PlanAuditEvent[];
  orchestration: PlanInvocationRecord[];
};

/** The published runtime schema; TypeScript types remain the authoring contract. */
export const FIRE_RESCUE_PLAN_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://fire-command-agent.local/schemas/fire-rescue-plan/v1',
  title: 'Unified Fire Rescue Plan',
  type: 'object',
  required: [
    'schemaVersion', 'planId', 'version', 'revision', 'previousPlanId', 'versionDiff', 'inputFingerprint',
    'event', 'building', 'spatialTarget', 'incident', 'responseLevel',
    'forceComposition', 'strategies', 'simulation', 'simulationVerification', 'risks',
    'missingItems', 'failedItems', 'review', 'issuance', 'lifecycleStatus',
    'document', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'evidenceRefs',
    'auditEvents', 'orchestration',
  ],
  properties: {
    schemaVersion: { const: PLAN_CONTRACT_VERSION },
    planId: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 1 },
    revision: { type: 'integer', minimum: 1 },
    versionDiff: { type: 'array' },
    previousPlanId: { type: ['string', 'null'] },
    inputFingerprint: { type: 'string', minLength: 1 },
    event: { type: 'object' },
    building: { type: 'object' },
    spatialTarget: { type: 'object' },
    incident: { type: 'object' },
    responseLevel: { type: 'object' },
    forceComposition: { type: 'object' },
    strategies: { type: 'object' },
    planTemplate: {
      type: 'object',
      required: ['status', 'knowledgeBaseId', 'retrievalHints', 'evidenceRefs'],
      properties: {
        tier: { type: ['string', 'null'] },
        fileName: { type: ['string', 'null'] },
        retrievalHints: { type: 'array' },
        sections: { type: 'array' },
        sectionRetrievalStatus: { type: ['string', 'null'] },
        sectionCountMatches: { type: ['boolean', 'null'] },
        rationale: { type: 'array' },
        warnings: { type: 'array' },
      },
    },
    routeWater: {
      type: 'object',
      required: ['status', 'waterSources', 'evidenceRefs'],
      properties: {
        calculationVersion: { type: ['string', 'null'] },
        accessibility: { type: ['object', 'null'] },
        primaryRoute: { type: ['object', 'null'] },
        backupRoute: { type: ['object', 'null'] },
        waterSources: { type: 'array' },
        coverage: { type: ['object', 'null'] },
      },
    },
    dayNightStrategy: {
      type: 'object',
      required: ['status', 'mode', 'adjustments', 'knowledgeRefs', 'evidenceRefs'],
      properties: {
        mode: { type: ['string', 'null'], enum: ['day', 'night', null] },
        adjustments: { type: 'array' },
        knowledgeRefs: { type: 'array' },
      },
    },
    simulation: {
      type: 'object',
      required: ['status', 'mappings', 'evidenceRefs'],
      // 11 步推演法为准（主库 124 条预案即 11 步）；早期 demo 库的 8 步为
      // 删减路线水源后的产物，读取时兼容，新建一律 11 步。
      properties: { mappings: { type: 'array', minItems: 8, maxItems: 11 } },
    },
    operationsDeployment: {
      type: 'object',
      required: ['status', 'zones', 'routes'],
      properties: {
        status: { type: 'string' },
        firePoint: { type: ['object', 'null'] },
        zones: { type: 'array' },
        routes: { type: 'array' },
        failureReason: { type: ['string', 'null'] },
      },
    },
    archive: {
      type: 'object',
      required: ['status', 'archivedAt', 'archivedBy', 'index', 'contents', 'failureReason'],
      properties: {
        status: { type: 'string', enum: ['not_archived', 'archived'] },
        index: { type: ['object', 'null'] },
        contents: { type: ['object', 'null'] },
      },
    },
    waterQueries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['queryId', 'question', 'askedAt', 'resultCount', 'status', 'evidenceRefs'],
        properties: {
          resolved: { type: ['object', 'null'] },
          distanceBasis: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['ready', 'needs_clarification', 'no_result', 'failed'] },
        },
      },
    },
    evidenceRefs: { type: 'array' },
    auditEvents: { type: 'array' },
    orchestration: { type: 'array' },
  },
  additionalProperties: false,
} as const;

/** 模板选取块校验。缺失即通过：既有预案不含此块。 */
function isPlanTemplate(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  // 章节表允许缺失（早期只做层级映射，未接知识库），
  // 但存在时必须是数组——半填充的章节表会让复核员误以为模板已核对。
  if (block.sections !== undefined && !Array.isArray(block.sections)) return false;
  if (block.sectionRetrievalStatus !== undefined && block.sectionRetrievalStatus !== null
    && !['retrieved', 'unavailable', 'not_configured'].includes(String(block.sectionRetrievalStatus))) return false;
  return ['pending_manual_review', 'unresolved'].includes(String(block.status))
    && typeof block.knowledgeBaseId === 'string'
    && Array.isArray(block.retrievalHints)
    && Array.isArray(block.evidenceRefs);
}

/**
 * 路线水源块校验。缺失即通过：早期 demo 库删掉了这一整块。
 * 存在时必须有 status / waterSources / evidenceRefs，
 * 避免半填充的块被当作已完成的路线规划使用。
 */
function isRouteWater(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return ['ready', 'pending_manual_review', 'failed', 'not_requested'].includes(String(block.status))
    && Array.isArray(block.waterSources)
    && Array.isArray(block.evidenceRefs);
}

/**
 * 昼夜处置块校验。缺失即通过：v1 早期落库的预案不含此块，不做迁移。
 * 存在时必须结构完整，避免半填充的块被当成已就绪数据使用。
 */
function isDayNightStrategy(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return ['ready', 'pending_manual_review', 'failed', 'not_requested'].includes(String(block.status))
    && (block.mode === null || ['day', 'night'].includes(String(block.mode)))
    && Array.isArray(block.adjustments)
    && Array.isArray(block.knowledgeRefs)
    && Array.isArray(block.evidenceRefs);
}

/** 需求书「完整版本边界」规定的推演步数。新建预案必须等于此值。 */
export const REQUIRED_SIMULATION_STEP_COUNT = 11;

/**
 * 新建预案的严格校验。
 *
 * isUnifiedFireRescuePlan 对 8 步保持宽松，是为了读出早期 demo 库删减后的
 * 历史预案；但需求书第 16 行「完整版本边界」写明 11 步不能删，
 * 所以新建路径必须走这里，不能让 8 步预案重新落库。
 */
export function isCompleteFireRescuePlan(value: unknown): value is UnifiedFireRescuePlan {
  if (!isUnifiedFireRescuePlan(value)) return false;
  return value.simulation.mappings.length === REQUIRED_SIMULATION_STEP_COUNT;
}

/** 归档块校验。缺失即通过：既有预案无归档块。 */
function isArchive(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return ['not_archived', 'archived'].includes(String(block.status))
    && (block.archivedAt === null || typeof block.archivedAt === 'string')
    && (block.index === null || Boolean(block.index && typeof block.index === 'object'))
    && (block.contents === null || Boolean(block.contents && typeof block.contents === 'object'));
}

/**
 * 水源查询留痕校验。缺失即通过：既有预案无此块。
 * 存在时逐条要求 queryId 与 status，避免半填充记录被当作已核验查询。
 */
function isWaterQueries(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const query = item as Record<string, unknown>;
    return typeof query.queryId === 'string' && query.queryId.length > 0
      && typeof query.question === 'string'
      && typeof query.askedAt === 'string'
      && Number.isFinite(Number(query.resultCount))
      && ['ready', 'needs_clarification', 'no_result', 'failed'].includes(String(query.status))
      && Array.isArray(query.evidenceRefs);
  });
}

export function isUnifiedFireRescuePlan(value: unknown): value is UnifiedFireRescuePlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(plan, key);
  const object = (input: unknown): Record<string, unknown> | null => input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  const nullableString = (input: unknown) => input === null || typeof input === 'string';
  const event = object(plan.event);
  const building = object(plan.building);
  const spatialTarget = object(plan.spatialTarget);
  const incident = object(plan.incident);
  const responseLevel = object(plan.responseLevel);
  const forceComposition = object(plan.forceComposition);
  const strategies = object(plan.strategies);
  const simulation = object(plan.simulation);
  const review = object(plan.review);
  const issuance = object(plan.issuance);
  const document = object(plan.document);
  const required = [
    'schemaVersion', 'planId', 'version', 'revision', 'previousPlanId', 'versionDiff', 'inputFingerprint',
    'event', 'building', 'spatialTarget', 'incident', 'responseLevel', 'forceComposition',
    'strategies', 'simulation', 'simulationVerification', 'risks', 'missingItems', 'failedItems', 'review',
    'issuance', 'document', 'lifecycleStatus', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt',
    'evidenceRefs', 'auditEvents', 'orchestration',
  ];
  if (!event || !building || !spatialTarget || !incident || !responseLevel
    || !forceComposition || !strategies || !simulation
    || !review || !issuance || !document) return false;
  return required.every(has)
    && plan.schemaVersion === PLAN_CONTRACT_VERSION
    && typeof plan.planId === 'string' && plan.planId.length > 0
    && Number.isInteger(plan.version) && (plan.version as number) >= 1
    && Number.isInteger(plan.revision) && (plan.revision as number) >= 1
    && nullableString(plan.previousPlanId)
    && typeof plan.inputFingerprint === 'string' && plan.inputFingerprint.length > 0
    && typeof event.incidentId === 'string' && nullableString(event.receivedAt) && nullableString(event.fireType) && Array.isArray(event.evidenceRefs)
    && nullableString(building.name) && nullableString(building.buildingId)
    && nullableString(spatialTarget.sceneId) && nullableString(spatialTarget.floor) && nullableString(spatialTarget.floorId) && nullableString(spatialTarget.room) && nullableString(spatialTarget.roomId) && nullableString(spatialTarget.firePartition) && ['ready', 'pending_manual_review', 'failed', 'not_requested'].includes(String(spatialTarget.status)) && Array.isArray(spatialTarget.evidenceRefs)
    && (incident.trappedCount === null || typeof incident.trappedCount === 'number') && (incident.burnAreaSqm === null || typeof incident.burnAreaSqm === 'number') && nullableString(incident.spreadTrend) && (incident.timeOfDay === undefined || incident.timeOfDay === null || ['day', 'night'].includes(String(incident.timeOfDay))) && Array.isArray(incident.specialHazards) && Array.isArray(incident.evidenceRefs)
    && nullableString(responseLevel.recommendation) && nullableString(responseLevel.ruleVersion) && ['ready', 'pending_manual_review', 'failed', 'not_requested'].includes(String(responseLevel.status)) && Array.isArray(responseLevel.evidenceRefs) && Array.isArray(responseLevel.missingEvidence)
    && ['ready', 'pending_manual_review', 'failed', 'not_requested'].includes(String(forceComposition.status)) && Array.isArray(forceComposition.units) && Array.isArray(forceComposition.evidenceRefs)
    && ['suppression', 'rescue', 'evacuation', 'security', 'smokeControl'].every((key) => Boolean(object(strategies[key])))
    && isPlanTemplate(plan.planTemplate)
    && isRouteWater(plan.routeWater)
    && isDayNightStrategy(plan.dayNightStrategy)
     && ['ready', 'pending_manual_review', 'failed', 'not_requested'].includes(String(simulation.status)) && Array.isArray(simulation.mappings) && simulation.mappings.length >= 8 && simulation.mappings.length <= 11 && Array.isArray(simulation.evidenceRefs)
    && (plan.simulationVerification === null || Boolean(object(plan.simulationVerification)))
    && Array.isArray(plan.risks) && Array.isArray(plan.missingItems) && Array.isArray(plan.failedItems)
    && ['pending_manual_review', 'approved', 'rejected'].includes(String(review.status)) && Array.isArray(review.comments) && nullableString(review.reviewer) && nullableString(review.reviewedAt)
    && ['not_issued', 'issued', 'blocked'].includes(String(issuance.status)) && nullableString(issuance.issuer) && nullableString(issuance.issuedAt) && nullableString(issuance.blockReason)
    && ['not_requested', 'ready', 'failed'].includes(String(document.status)) && nullableString(document.fileName) && nullableString(document.generatedAt) && nullableString(document.templateName) && Boolean(object(document.verification)) && nullableString(document.failureReason)
    && isArchive(plan.archive)
    && isWaterQueries(plan.waterQueries)
    && (PLAN_LIFECYCLE_STATUSES as readonly string[]).includes(String(plan.lifecycleStatus))
    && typeof plan.createdBy === 'string' && typeof plan.createdAt === 'string' && typeof plan.updatedBy === 'string' && typeof plan.updatedAt === 'string'
    && Array.isArray(plan.evidenceRefs) && Array.isArray(plan.auditEvents) && Array.isArray(plan.orchestration);
}
