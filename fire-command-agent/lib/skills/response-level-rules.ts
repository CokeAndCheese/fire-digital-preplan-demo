export const RESPONSE_RULE_VERSION = 'sanya-fire-evidence-rules-v1';

export type EvidenceStatus = 'reported' | 'not_observed' | 'missing' | 'conflict';

export type IncidentEvidenceSource = {
  sourceId: string | null;
  sourceType: 'caller_report' | 'dispatch_system' | 'scene_model' | 'manual' | 'external_system' | 'not_collected';
  collectedAt: string | null;
};

export type IncidentEvidenceField = {
  value: unknown;
  status: EvidenceStatus;
  source: IncidentEvidenceSource;
  confidence: number;
  collectedAt: string | null;
  manuallyConfirmed: boolean;
  conflicts?: Array<{ value: unknown; sourceId?: string | null }>;
};

export type IncidentEvidence = {
  incidentId: string;
  receivedAt: string;
  building: IncidentEvidenceField;
  floor: IncidentEvidenceField;
  room: IncidentEvidenceField;
  firePartition: IncidentEvidenceField;
  venueType: IncidentEvidenceField;
  fireMaterialOrType: IncidentEvidenceField;
  burnAreaSqm: IncidentEvidenceField;
  spreadTrend: IncidentEvidenceField;
  trappedCount: IncidentEvidenceField;
  casualtyCount: IncidentEvidenceField;
  missingPersonCount: IncidentEvidenceField;
  specialHazards: IncidentEvidenceField;
  facilityStatus: IncidentEvidenceField;
  weatherConstraints: IncidentEvidenceField;
  roadConstraints: IncidentEvidenceField;
};

export type ResponseLevelAssessmentInput = {
  incident?: unknown;
};

export type ResponseLevelCode = 'I' | 'II' | 'III' | 'IV' | 'V';

export type ResponseLevelAssessment = {
  assessmentId: string;
  ruleVersion: typeof RESPONSE_RULE_VERSION;
  assessmentStatus: 'recommended' | 'pending_manual_review';
  recommendedLevel: string | null;
  recommendedLevelCode: ResponseLevelCode | null;
  officialIssuedLevel: null;
  officialIssuanceStatus: 'not_issued';
  reviewRequired: true;
  nonAutomatableFields: string[];
  riskScore: number | null;
  calculationItems: Array<{
    ruleId: string;
    label: string;
    points: number;
    evidenceFields: string[];
  }>;
  evidence: Array<{
    field: string;
    label: string;
    value: unknown;
    status: EvidenceStatus;
    source: IncidentEvidenceSource;
    confidence: number;
    collectedAt: string | null;
    manuallyConfirmed: boolean;
    conflicts?: Array<{ value: unknown; sourceId?: string | null }>;
  }>;
  missingEvidence: string[];
  conflictFields: string[];
  retryPolicy: 'not_needed' | 'sealed_pending_human_evidence';
  message: string;
};

type EvidenceKey = Exclude<keyof IncidentEvidence, 'incidentId' | 'receivedAt'>;

const EVIDENCE_FIELDS: Array<{ key: EvidenceKey; label: string; type: 'text' | 'count' | 'list' }> = [
  { key: 'building', label: '建筑', type: 'text' },
  { key: 'floor', label: '楼层', type: 'text' },
  { key: 'room', label: '房间', type: 'text' },
  { key: 'firePartition', label: '防火分区', type: 'text' },
  { key: 'venueType', label: '场所类型', type: 'text' },
  { key: 'fireMaterialOrType', label: '起火物质/火灾类型', type: 'text' },
  { key: 'burnAreaSqm', label: '过火面积', type: 'count' },
  { key: 'spreadTrend', label: '燃烧蔓延趋势', type: 'text' },
  { key: 'trappedCount', label: '受困人数', type: 'count' },
  { key: 'casualtyCount', label: '伤亡人数', type: 'count' },
  { key: 'missingPersonCount', label: '失联人数', type: 'count' },
  { key: 'specialHazards', label: '特殊危险源', type: 'list' },
  { key: 'facilityStatus', label: '消防设施状态', type: 'text' },
  { key: 'weatherConstraints', label: '气象约束', type: 'list' },
  { key: 'roadConstraints', label: '道路约束', type: 'list' },
];

const NON_AUTOMATABLE_FIELDS = [
  '正式签发响应等级',
  '响应力量调派',
  '预案签发',
  '三维推演启动',
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => Boolean(text(item))).map((item) => item.trim());
  return values.length === value.length ? values : undefined;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function missingField(): IncidentEvidenceField {
  return {
    value: null,
    status: 'missing',
    source: { sourceId: null, sourceType: 'not_collected', collectedAt: null },
    confidence: 0,
    collectedAt: null,
    manuallyConfirmed: false,
  };
}

function normaliseField(raw: unknown): IncidentEvidenceField {
  const record = asRecord(raw);
  if (!record) return missingField();
  const sourceRecord = asRecord(record.source);
  const status = text(record.status);
  const sourceType = text(sourceRecord?.sourceType);
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? record.confidence
    : Number.NaN;
  const conflicts = Array.isArray(record.conflicts)
    ? record.conflicts.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({
      value: item.value,
      ...(text(item.sourceId) ? { sourceId: text(item.sourceId) } : {}),
    }))
    : undefined;

  return {
    value: record.value ?? null,
    status: status === 'reported' || status === 'not_observed' || status === 'missing' || status === 'conflict'
      ? status
      : 'missing',
    source: {
      sourceId: text(sourceRecord?.sourceId) ?? null,
      sourceType: sourceType === 'caller_report' || sourceType === 'dispatch_system' || sourceType === 'scene_model'
        || sourceType === 'manual' || sourceType === 'external_system' || sourceType === 'not_collected'
        ? sourceType
        : 'not_collected',
      collectedAt: text(sourceRecord?.collectedAt) ?? null,
    },
    confidence,
    collectedAt: text(record.collectedAt) ?? null,
    manuallyConfirmed: record.manuallyConfirmed === true,
    ...(conflicts?.length ? { conflicts } : {}),
  };
}

function normaliseIncident(value: unknown): IncidentEvidence {
  const record = asRecord(value) ?? {};
  const incidentId = text(record.incidentId) ?? 'missing-incident-id';
  const receivedAt = text(record.receivedAt) ?? 'missing-received-at';
  const fields = Object.fromEntries(EVIDENCE_FIELDS.map(({ key }) => [key, normaliseField(record[key])])) as Record<EvidenceKey, IncidentEvidenceField>;
  return { incidentId, receivedAt, ...fields };
}

function valueMatchesType(field: IncidentEvidenceField, type: 'text' | 'count' | 'list'): boolean {
  if (field.status === 'missing' || field.status === 'conflict') return false;
  if (!field.source.sourceId || !field.source.collectedAt || !field.collectedAt) return false;
  if (!Number.isFinite(field.confidence) || field.confidence < 0.5 || field.confidence > 1) return false;
  if (type === 'text') return Boolean(text(field.value));
  if (type === 'count') return nonNegativeNumber(field.value) !== undefined;
  return stringList(field.value) !== undefined;
}

function levelName(level: ResponseLevelCode): string {
  return `${({ I: 'Ⅰ', II: 'Ⅱ', III: 'Ⅲ', IV: 'Ⅳ', V: 'Ⅴ' } as const)[level]}级响应建议`;
}

function levelRank(level: ResponseLevelCode): number {
  return ({ I: 5, II: 4, III: 3, IV: 2, V: 1 } as const)[level];
}

function higherLevel(left: ResponseLevelCode, right: ResponseLevelCode): ResponseLevelCode {
  return levelRank(left) >= levelRank(right) ? left : right;
}

function levelForScore(score: number): ResponseLevelCode {
  if (score >= 16) return 'I';
  if (score >= 11) return 'II';
  if (score >= 6) return 'III';
  if (score >= 3) return 'IV';
  return 'V';
}

function fieldSnapshot(key: EvidenceKey, label: string, field: IncidentEvidenceField) {
  return {
    field: key,
    label,
    value: field.value,
    status: field.status,
    source: field.source,
    confidence: field.confidence,
    collectedAt: field.collectedAt,
    manuallyConfirmed: field.manuallyConfirmed,
    ...(field.conflicts?.length ? { conflicts: field.conflicts } : {}),
  };
}

function assessmentFingerprint(incident: IncidentEvidence) {
  return {
    incidentId: incident.incidentId,
    fields: Object.fromEntries(EVIDENCE_FIELDS.map(({ key }) => {
      const field = incident[key];
      return [key, {
        value: field.value,
        status: field.status,
        sourceId: field.source.sourceId,
        sourceType: field.source.sourceType,
        confidence: field.confidence,
        manuallyConfirmed: field.manuallyConfirmed,
        conflicts: field.conflicts ?? [],
      }];
    })),
  };
}

/**
 * This is the project-controlled assessment rule set. It produces a proposal
 * only; its output can never become the formal issued response level.
 */
export function assessResponseLevel(input: ResponseLevelAssessmentInput): ResponseLevelAssessment {
  const incident = normaliseIncident(input.incident);
  const evidence = EVIDENCE_FIELDS.map(({ key, label }) => fieldSnapshot(key, label, incident[key]));
  const missingEvidence: string[] = [];
  const conflictFields: string[] = [];

  if (incident.incidentId === 'missing-incident-id') missingEvidence.push('事件编号');
  if (incident.receivedAt === 'missing-received-at') missingEvidence.push('接警时间');

  for (const { key, label, type } of EVIDENCE_FIELDS) {
    const field = incident[key];
    if (field.status === 'conflict' || field.conflicts?.length) conflictFields.push(label);
    if (!valueMatchesType(field, type)) {
      missingEvidence.push(field.status === 'conflict' || field.conflicts?.length ? `${label}存在冲突` : label);
    }
  }

  // Collection times stay in the evidence but cannot bypass an unchanged evidence seal.
  const assessmentId = `RLA-${stableHash(JSON.stringify({
    ruleVersion: RESPONSE_RULE_VERSION,
    incident: assessmentFingerprint(incident),
  }))}`;
  if (missingEvidence.length || conflictFields.length) {
    return {
      assessmentId,
      ruleVersion: RESPONSE_RULE_VERSION,
      assessmentStatus: 'pending_manual_review',
      recommendedLevel: null,
      recommendedLevelCode: null,
      officialIssuedLevel: null,
      officialIssuanceStatus: 'not_issued',
      reviewRequired: true,
      nonAutomatableFields: NON_AUTOMATABLE_FIELDS,
      riskScore: null,
      calculationItems: [],
      evidence,
      missingEvidence: [...new Set(missingEvidence)],
      conflictFields: [...new Set(conflictFields)],
      retryPolicy: 'sealed_pending_human_evidence',
      message: '关键灾情证据缺失、冲突或缺少可追溯元数据，规则不生成响应等级建议；请由人工补证并创建新的证据修订后复核。',
    };
  }

  const floor = text(incident.floor.value)!;
  const burnArea = nonNegativeNumber(incident.burnAreaSqm.value)!;
  const spreadTrend = text(incident.spreadTrend.value)!;
  const trappedCount = nonNegativeNumber(incident.trappedCount.value)!;
  const casualtyCount = nonNegativeNumber(incident.casualtyCount.value)!;
  const missingPersonCount = nonNegativeNumber(incident.missingPersonCount.value)!;
  const hazards = stringList(incident.specialHazards.value)!;
  const facilityStatus = text(incident.facilityStatus.value)!;
  const weatherConstraints = stringList(incident.weatherConstraints.value)!;
  const roadConstraints = stringList(incident.roadConstraints.value)!;
  const calculationItems: ResponseLevelAssessment['calculationItems'] = [];
  let score = 0;
  let forcedLevel: ResponseLevelCode | undefined;
  const add = (ruleId: string, label: string, points: number, evidenceFields: string[]) => {
    if (!points) return;
    score += points;
    calculationItems.push({ ruleId, label, points, evidenceFields });
  };

  const floorNumber = Number((floor.match(/\d+/)?.[0] ?? ''));
  if (/^B\d+/i.test(floor)) add('RL-FLOOR-BASEMENT', '地下楼层增加排烟与疏散组织复杂度', 1, ['floor']);
  else if (Number.isFinite(floorNumber) && floorNumber >= 15) add('RL-FLOOR-HIGH', '十五层及以上增加垂直救援组织复杂度', 2, ['floor']);

  if (burnArea >= 100) add('RL-AREA-100', '过火面积达到 100 平方米', 5, ['burnAreaSqm']);
  else if (burnArea >= 30) add('RL-AREA-30', '过火面积达到 30 平方米', 3, ['burnAreaSqm']);
  else if (burnArea >= 10) add('RL-AREA-10', '过火面积达到 10 平方米', 1, ['burnAreaSqm']);

  if (/快速|失控|剧烈/.test(spreadTrend)) add('RL-SPREAD-RAPID', '火势快速蔓延或失控', 5, ['spreadTrend']);
  else if (/蔓延|扩大|发展/.test(spreadTrend)) add('RL-SPREAD-GROWING', '火势存在蔓延趋势', 3, ['spreadTrend']);

  if (trappedCount >= 10) {
    add('RL-TRAPPED-10', '受困人数达到 10 人', 8, ['trappedCount']);
    forcedLevel = higherLevel(forcedLevel ?? 'V', 'I');
  } else if (trappedCount >= 4) {
    add('RL-TRAPPED-4', '受困人数达到 4 人', 6, ['trappedCount']);
    forcedLevel = higherLevel(forcedLevel ?? 'V', 'II');
  } else if (trappedCount >= 1) add('RL-TRAPPED-1', '存在受困人员', 3, ['trappedCount']);

  if (casualtyCount > 0) {
    add('RL-CASUALTY', '已报告伤亡人员', 10, ['casualtyCount']);
    forcedLevel = higherLevel(forcedLevel ?? 'V', 'I');
  }
  if (missingPersonCount > 0) {
    add('RL-MISSING', '已报告失联人员', 10, ['missingPersonCount']);
    forcedLevel = higherLevel(forcedLevel ?? 'V', 'I');
  }

  if (hazards.some((item) => /危化|爆炸|油品|燃气泄漏|储罐/.test(item))) add('RL-HAZARD-MAJOR', '存在燃爆或危化危险源', 5, ['specialHazards']);
  else if (hazards.length > 0) add('RL-HAZARD', '存在已报告特殊危险源', 2, ['specialHazards']);

  if (/故障|失效|损坏|不可用/.test(facilityStatus)) add('RL-FACILITY-FAILED', '消防设施存在故障或失效', 2, ['facilityStatus']);
  if (weatherConstraints.length) add('RL-WEATHER', '存在已报告气象约束', 1, ['weatherConstraints']);
  if (roadConstraints.length) add('RL-ROAD', '存在已报告道路约束', 1, ['roadConstraints']);

  if (hazards.some((item) => /危化|爆炸|油品|燃气泄漏|储罐/.test(item)) && /快速|失控|剧烈/.test(spreadTrend)) {
    forcedLevel = higherLevel(forcedLevel ?? 'V', 'II');
  }

  const recommendedLevelCode = forcedLevel ? higherLevel(forcedLevel, levelForScore(score)) : levelForScore(score);
  return {
    assessmentId,
    ruleVersion: RESPONSE_RULE_VERSION,
    assessmentStatus: 'recommended',
    recommendedLevel: levelName(recommendedLevelCode),
    recommendedLevelCode,
    officialIssuedLevel: null,
    officialIssuanceStatus: 'not_issued',
    reviewRequired: true,
    nonAutomatableFields: NON_AUTOMATABLE_FIELDS,
    riskScore: score,
    calculationItems,
    evidence,
    missingEvidence: [],
    conflictFields: [],
    retryPolicy: 'not_needed',
    message: '该结果是项目规则版本的响应建议，不是正式签发等级；必须由具备权限的指挥员复核并在后续签发流程中确认。',
  };
}
