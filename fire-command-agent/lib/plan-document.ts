import 'server-only';
import JSZip from 'jszip';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UnifiedFireRescuePlan } from './plan-contract';
import { appendSystemSection, type AppendEntry } from './plan-document-append';

export class PlanDocumentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PlanDocumentError';
  }
}

const TOKEN_NAMES = [
  'plan_id', 'version', 'building', 'fire_location', 'trapped_count', 'incident', 'response_level',
  'plan_template', 'force_composition',
  'water_sources', 'primary_route', 'backup_route', 'road_constraints',
  'strategies',
  // 需求书 §12.1 要求文档内容包含三维推演记录与等级依据；
  // 此前 19 个占位符里没有推演字段，签发出去的预案看不到推演结果。
  'simulation_record', 'level_basis', 'casualty_summary', 'audit_summary',
  'evidence', 'reviewer', 'issuer', 'issued_at',
  'operations_deployment',
] as const;

/**
 * 已废弃的占位符。保留列表以便旧模板中的残留标记被清空而不是原样渲染出来。
 *
 * 注意：primary_route / backup_route / water_sources 曾被移入此列表（连同 11 步
 * 推演降为 8 步），现已随路线水源一并恢复为正式字段，不再清空。
 */
const REMOVED_TOKEN_NAMES = [] as const;

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * 转成 Word 可用的行内文本。
 *
 * 占位符位于 <w:t> 内，裸换行在 Word 里不换行而是被吞掉，
 * 推演记录和审计摘要是逐行内容，必须换成 <w:br/>。
 */
function wordText(value: string) {
  const escaped = xmlEscape(value);
  return escaped.includes('\n')
    ? escaped.split('\n').join('</w:t><w:br/><w:t xml:space="preserve">')
    : escaped;
}

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '未提供';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function vehicleDescription(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const description = (value as { description?: unknown }).description;
    if (typeof description === 'string' && description.trim()) return description.trim();
  }
  return display(value);
}

function forceSummary(plan: UnifiedFireRescuePlan) {
  if (!plan.forceComposition.units.length) return '暂无已核验力量编成';
  return plan.forceComposition.units.map((unit) => {
    const details = [
      unit.personnel === null ? null : `${unit.personnel} 人`,
      unit.etaMinutes === null ? null : `预计 ${unit.etaMinutes} 分钟`,
      unit.vehicles.length ? `车辆 ${unit.vehicles.map(vehicleDescription).join('、')}` : null,
    ].filter((item): item is string => Boolean(item));
    return `${unit.name}${details.length ? `（${details.join('；')}）` : ''}`;
  }).join('；');
}

/**
 * 水源摘要。必须带出可用性与数据缺口——台账口径压力全空、约 27% 无坐标，
 * 只列水源名称会让阅读者误以为供水能力已核实。
 */
function waterSourceSummary(plan: UnifiedFireRescuePlan) {
  const routeWater = plan.routeWater;
  if (!routeWater) return '本预案未包含水源检索结果';
  if (!routeWater.waterSources.length) {
    return routeWater.failureReason || '未检索到候选水源，需人工核实就近取水点';
  }
  const usabilityLabel = { available: '可用', unavailable: '已报不可用', unknown: '状态未知' } as const;
  const listed = routeWater.waterSources.map((source) => {
    const name = source.code || source.address || source.id;
    const distance = `${(source.distanceKm * 1000).toFixed(0)} 米`;
    const capacity = source.diameterMm === null && source.pressureMpa === null
      ? '口径压力未登记'
      : [source.diameterMm === null ? null : `DN${source.diameterMm}`, source.pressureMpa === null ? null : `${source.pressureMpa}MPa`]
        .filter(Boolean).join('/');
    return `${name}（${distance}，${usabilityLabel[source.usability]}，${capacity}）`;
  }).join('；');
  const coverage = routeWater.coverage
    ? `　台账覆盖率 ${(routeWater.coverage.coverageRatio * 100).toFixed(1)}%（${routeWater.coverage.usableRecords}/${routeWater.coverage.totalRecords} 条有坐标）`
    : '';
  return `${listed}${coverage}　供水能力须现场核算，取水前确认水源状态。`;
}

/** 路线摘要。恒附待确认说明——主备路线需指挥员在现场核定。 */
function routeSummary(plan: UnifiedFireRescuePlan, kind: 'primaryRoute' | 'backupRoute') {
  const routeWater = plan.routeWater;
  if (!routeWater) return '本预案未包含路线规划结果';
  const route = routeWater[kind];
  if (!route) return '路线未生成';
  const entry = route.entryPoint ? `进攻入口：${route.entryPoint}` : '进攻入口待现场确认';
  const waypoints = route.waypoints.length ? `途经：${route.waypoints.join(' → ')}` : '途经点待现场勘定';
  const reason = route.failureReason ? `　${route.failureReason}` : '';
  return `${entry}；${waypoints}${reason}`;
}

/** 道路与气象约束。仅作否定依据，不产出行车时间。 */
function roadConstraintSummary(plan: UnifiedFireRescuePlan) {
  const accessibility = plan.routeWater?.accessibility;
  if (!accessibility) return '未取得实时路况与气象数据，道路可达性未经核验';
  const parts: string[] = [];
  if (accessibility.overallLevel) parts.push(`城市整体路况：${accessibility.overallLevel}`);
  if (accessibility.blockingRoads.length) {
    parts.push(`阻断路段：${accessibility.blockingRoads.map((road) => {
      const trend = road.trend === 'WORSE' ? '恶化中' : road.trend === 'BETTER' ? '缓解中' : '趋势未知';
      return `${road.roadName ?? '未命名'}（${road.levelLabel ?? '拥堵'}，${road.speedKmh ?? '?'}km/h，${trend}）`;
    }).join('、')}`);
  } else {
    parts.push('未发现拥堵或严重拥堵路段');
  }
  const weather = accessibility.weather;
  if (weather) {
    parts.push(`气象：${[weather.condition, weather.temperatureCelsius === null ? null : `${weather.temperatureCelsius}℃`,
      weather.windDirection && weather.windPower ? `${weather.windDirection}风${weather.windPower}级` : null]
      .filter(Boolean).join(' ')}`);
  }
  parts.push('路况为城市整体态势，可用于避让，不足以确认路线可通或推算到场时间。');
  return parts.join('；');
}

/**
 * 编制层级摘要。
 *
 * 写清模板出处与章节数，便于复核人比对纸质模版；
 * 层级由响应等级推导而来，会决定调派规模，因此必须标注待核定。
 */
function planTemplateSummary(plan: UnifiedFireRescuePlan) {
  const template = plan.planTemplate;
  if (!template) return '编制层级待确认（未选取模板）。';
  if (!template.tier || !template.tierLabel) {
    const reason = template.warnings.length ? template.warnings.join('；') : '响应等级未确认，无法推导编制层级。';
    return `编制层级待确认：${reason}`;
  }
  // 章节核对状态必须写清：章节表为空时不能让复核员以为模板已核对过。
  const sections = template.sections ?? [];
  const sectionNote = (() => {
    switch (template.sectionRetrievalStatus) {
      case 'retrieved':
        return template.sectionCountMatches === false
          ? `已取到 ${sections.length} 个章节，与规范 ${template.expectedSectionCount} 章不一致，请核对模板版本`
          : `已取到并核对 ${sections.length} 个章节`;
      case 'unavailable':
        return '知识库未取到章节，章节完整性未核验，须人工比对纸质模版';
      case 'not_configured':
        return '未接入知识库，章节完整性未核验，须人工比对纸质模版';
      default:
        return template.expectedSectionCount === null ? null : `应含 ${template.expectedSectionCount} 个章节（未核对）`;
    }
  })();
  const parts = [
    `参照${template.tierLabel}模板`,
    template.fileName ? `模板文件：${template.fileName}` : null,
    sectionNote,
    ...template.rationale,
  ].filter((item): item is string => Boolean(item));
  return `${parts.join('；')}。层级决定调派规模，须指挥员核定。`;
}

/**
 * 策略中文名。后三项为需求书 §9 要求的通信、安全、资源协同，
 * 既有预案缺这三块时 Object.entries 自然跳过，不输出「待补充」占位。
 */
const STRATEGY_LABELS: Record<string, string> = {
  suppression: '灭火', rescue: '搜救', evacuation: '疏散', security: '警戒', smokeControl: '排烟',
  communication: '通信', safety: '安全', resourceCoordination: '资源协同',
};

function strategySummary(plan: UnifiedFireRescuePlan) {
  return Object.entries(plan.strategies)
    .flatMap(([key, strategy]) => (strategy
      ? [`${STRATEGY_LABELS[key] || key}：${strategy.content || '待补充'}`]
      : []))
    .join('；');
}

/**
 * 三维推演记录。需求书 §12.1 与 §11：每步都要能追溯到回执。
 *
 * 以 simulationVerification 的完成/失败步集为准，而不是 mappings 的 status——
 * mappings 只表示映射已生成，回执才代表动作真正执行过。
 */
function simulationSummary(plan: UnifiedFireRescuePlan) {
  const verification = plan.simulationVerification;
  const completed = new Set(verification?.completedStepIds ?? []);
  const failed = new Set(verification?.failedStepIds ?? []);
  const steps = plan.simulation.mappings
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((mapping) => {
      const state = failed.has(mapping.stepId) ? '失败'
        : completed.has(mapping.stepId) ? '已回执'
          : '无回执';
      return `${mapping.sequence}. ${mapping.title}（${mapping.sdkAction}，${state}）`;
    });
  if (!steps.length) return '未生成推演步骤映射。';
  const header = verification
    ? `推演 ${verification.runId} 第 ${verification.attempt} 次，状态 ${verification.status}，共 ${steps.length} 步`
    : `共 ${steps.length} 步，尚无推演回执`;
  return [header, ...steps].join('\n');
}

/** 等级依据。需求书 §9 等级域要求风险分数与命中规则进入文档。 */
function levelBasisSummary(plan: UnifiedFireRescuePlan) {
  const level = plan.responseLevel;
  const parts = [
    level.confirmedLevel ? `正式核定等级 ${level.confirmedLevel} 级（${display(level.confirmedBy)}）` : '正式等级待指挥员核定',
    level.recommendation ? `规则建议 ${level.recommendation} 级` : '规则建议待生成',
    level.ruleVersion ? `规则版本 ${level.ruleVersion}` : null,
    typeof level.riskScore === 'number' ? `风险分数 ${level.riskScore}` : null,
    level.matchedRules?.length ? `命中规则：${level.matchedRules.map((rule) => `${rule.name}(+${rule.score})`).join('、')}` : null,
    level.missingEvidence.length ? `缺失证据：${level.missingEvidence.join('、')}` : null,
    level.conflictingEvidence?.length ? `冲突证据：${level.conflictingEvidence.join('、')}` : null,
  ];
  return parts.filter((item): item is string => Boolean(item)).join('；');
}

/** 伤亡与失联。null 输出「未核实」，不写 0 人。 */
function casualtySummary(plan: UnifiedFireRescuePlan) {
  const value = (input: number | null | undefined) => (typeof input === 'number' ? `${input} 人` : '未核实');
  return [
    `被困 ${value(plan.incident.trappedCount)}`,
    `伤亡 ${value(plan.incident.casualtyCount)}`,
    `失联 ${value(plan.incident.missingPersonCount)}`,
  ].join('；');
}

/** 审计摘要。需求书 §12.1 要求文档含审计信息。 */
function auditSummary(plan: UnifiedFireRescuePlan) {
  const events = plan.auditEvents.slice(-6);
  if (!events.length) return '无审计事件。';
  return events
    .map((event) => `${event.at} ${event.actor}（${event.actorType || '来源未记录'}）${event.type}${typeof event.revision === 'number' ? ` @r${event.revision}` : ''}：${event.detail}`)
    .join('\n');
}

/** 作战区域部署摘要。需求书：车辆停放/登高作业/器材/警戒 + 进攻/三层疏散。 */
function operationsDeploymentSummary(plan: UnifiedFireRescuePlan) {
  const dep = plan.operationsDeployment;
  if (!dep || !dep.zones.length) return '本预案未包含作战区域部署。';
  const zones = dep.zones.map((z) => z.name).join('、');
  const routes = dep.routes.map((r) => r.name).join('、');
  const statusLabel = dep.status === 'ready' ? '已部署' : dep.status === 'pending_manual_review' ? '待人工复核' : dep.status;
  const fp = dep.firePoint ? `（火点 ${dep.firePoint.x.toFixed(1)}, ${dep.firePoint.y.toFixed(1)}, ${dep.firePoint.z.toFixed(1)}）` : '';
  return `${statusLabel}${fp}\n区域：${zones}\n路线：${routes}${dep.failureReason ? `\n${dep.failureReason}` : ''}`;
}

function fields(plan: UnifiedFireRescuePlan): Record<(typeof TOKEN_NAMES)[number], string> {
  return {
    plan_id: plan.planId,
    version: `v${plan.version}`,
    building: display(plan.building.name),
    fire_location: [plan.spatialTarget.floor, plan.spatialTarget.room].filter(Boolean).join(' / ') || '待确认',
    trapped_count: plan.incident.trappedCount === null ? '待确认' : `${plan.incident.trappedCount} 人`,
    incident: [
      `事件 ${plan.event.incidentId}`,
      plan.event.fireType || '火灾类型待确认',
      plan.incident.burnAreaSqm === null ? '过火面积待确认' : `过火面积 ${plan.incident.burnAreaSqm} 平方米`,
      plan.incident.spreadTrend || '蔓延趋势待确认',
      plan.incident.specialHazards.length ? `特殊危险：${plan.incident.specialHazards.join('、')}` : null,
    ].filter((item): item is string => Boolean(item)).join('；'),
    response_level: plan.responseLevel.recommendation ? `${plan.responseLevel.recommendation} 级` : '待确认',
    plan_template: planTemplateSummary(plan),
    force_composition: forceSummary(plan),
    water_sources: waterSourceSummary(plan),
    primary_route: routeSummary(plan, 'primaryRoute'),
    backup_route: routeSummary(plan, 'backupRoute'),
    road_constraints: roadConstraintSummary(plan),
    strategies: strategySummary(plan),
    simulation_record: simulationSummary(plan),
    level_basis: levelBasisSummary(plan),
    casualty_summary: casualtySummary(plan),
    audit_summary: auditSummary(plan),
    evidence: `${plan.evidenceRefs.filter((reference) => reference.status === 'verified').length}/${plan.evidenceRefs.length} 项证据已核验`,
    reviewer: display(plan.review.reviewer),
    issuer: display(plan.issuance.issuer),
    issued_at: display(plan.issuance.issuedAt),
    operations_deployment: operationsDeploymentSummary(plan),
  };
}

export type RenderedPlanDocument = {
  buffer: Buffer;
  fileName: string;
  templateName: string;
  checkedFields: string[];
  /** 服务端实际落盘路径，供界面显示真实位置（需求书 §12.3） */
  savedPath: string;
  templateId: string;
  templateVersion: string | null;
  templateSource: 'knowledge_base' | 'local_demo';
};

/** 字段中文标签。demoTemplate 的占位符标注与追加节的 label/value 列表共用同一份，避免两处措辞不一致。 */
const TOKEN_LABELS: Record<(typeof TOKEN_NAMES)[number], string> = {
  plan_id: '预案编号', version: '版本', building: '建筑', fire_location: '起火位置', trapped_count: '被困人数',
  incident: '事件摘要', response_level: '响应等级', plan_template: '编制层级与模板',
  force_composition: '力量编成',
  water_sources: '周边水源', primary_route: '主进攻路线', backup_route: '疏散/备用路线',
  road_constraints: '道路与气象约束',
  strategies: '处置策略',
  simulation_record: '三维推演记录', level_basis: '等级判定依据',
  casualty_summary: '人员情况', audit_summary: '审计摘要',
  evidence: '证据状态', reviewer: '复核人', issuer: '签发人', issued_at: '签发时间',
  operations_deployment: '作战区域部署',
};

/** 供追加模式（站/大队/支队级档案模板）使用：把系统字段整理成 label/value 列表 */
function appendEntries(plan: UnifiedFireRescuePlan): AppendEntry[] {
  const values = fields(plan);
  return TOKEN_NAMES.map((token) => ({ label: TOKEN_LABELS[token], value: values[token] }));
}

async function demoTemplate() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const labels = TOKEN_LABELS;
  const paragraphs = [
    '<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>灭火救援指挥预案</w:t></w:r></w:p>',
    ...TOKEN_NAMES.map((token) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${labels[token]}：</w:t></w:r><w:r><w:t>{{${token}}}</w:t></w:r></w:p>`),
  ].join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * 建筑静态档案（固定事实，非动态计算）。
 *
 * 参考用户提供的《五矿国际广场"8·8"电气火灾灭火救援预案》，其中的
 * "三、基本情况"与"四、毗邻情况"属于建筑固定事实，不在 UnifiedFireRescuePlan
 * 动态字段里，需按建筑名归档。未建档建筑使用 UNKNOWN_PROFILE 且明确标"待核实/以现场为准"，
 * 杜绝编造建筑参数。（今后接入建筑档案库后从这里替换。）
 */
type BuildingProfile = {
  /** 登记/完整单位名称（如"三亚五矿国际广场"），区别于场景短名"五矿国际广场"。 */
  unitName: string;
  address: string;
  params: string;
  functionZones: string;
  fireFacilities: string;
  verticalTransport: string;
  fireControlRoom: string;
  safetyOfficer: string;
  safetyManager: string;
  neighbors: Array<{ direction: string; place: string; width: string }>;
};

const BUILDING_PROFILES: Record<string, BuildingProfile> = {
  '五矿国际广场': {
    unitName: '三亚五矿国际广场',
    address: '海南省三亚市吉阳区迎宾路128号',
    params: '高度99.98m；地上22层、地下2层；钢筋混凝土，耐火等级一级；总建筑面积55799.15㎡',
    functionZones: '商业办公楼；重点风险部位：地下一层变配电室（电气火灾高危）、4楼餐厅（明火/油烟）',
    fireFacilities: '室内消火栓199个；室外消火栓2个；自动报警、自动喷淋、应急广播、机械防排烟、气体灭火齐全',
    verticalTransport: '消防电梯2部（大楼西北侧）；疏散楼梯6部；安全出口6个',
    fireControlRoom: '地下一层电梯厅旁',
    safetyOfficer: '吉高琅 18389204311',
    safetyManager: '袁月伟 13876885230',
    neighbors: [
      { direction: '东', place: '25度阳光小区 / 河东路', width: '18m · 举高车可作业' },
      { direction: '西', place: '保利国际广场 / 川西路', width: '10m · 举高车可作业' },
      { direction: '南', place: '金鸡岭花园山庄 / 迎宾路', width: '21m · 举高车可作业（主要进攻面）' },
      { direction: '北', place: '世贸国际金融中心 / 盐蚌街', width: '7m · 举高车不可作业' },
    ],
  },
};

const UNKNOWN_PROFILE: BuildingProfile = {
  unitName: '待确认',
  address: '待现场核实',
  params: '待现场核实',
  functionZones: '以现场图纸/物管确认为准',
  fireFacilities: '以现场核实为准',
  verticalTransport: '以现场核实为准',
  fireControlRoom: '以现场核实为准',
  safetyOfficer: '待核实',
  safetyManager: '待核实',
  neighbors: [],
};

function buildingProfileOf(name: string | null): BuildingProfile {
  return (name && BUILDING_PROFILES[name]) || UNKNOWN_PROFILE;
}

/* ---------- 参考结构文档的 XML 构件（标题 + 表格） ---------- */

function wp(text: string, bold = false, big = false): string {
  const rpr = (bold || big) ? `<w:rPr>${bold ? '<w:b/>' : ''}${big ? '<w:sz w:val="32"/>' : ''}</w:rPr>` : '';
  return `<w:p><w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}
function heading(text: string): string { return wp(text, true, true); }
function p(text: string): string { return wp(text); }

function cellXml(text: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${wp(text)}</w:tc>`;
}
function tableXml(rows: string[][]): string {
  const trs = rows.map((row) => `<w:tr>${row.map(cellXml).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${trs}</w:tbl>`;
}

const LEVEL_LABEL: Record<string, string> = {
  I: '一级火警（F1）', II: '二级火警（F2）', III: '三级火警（F3）', IV: '四级火警（F4）', V: '五级火警（F5）',
};
const STRATEGY_KEY_LABEL: Record<string, string> = {
  suppression: '灭火处置', rescue: '搜救', evacuation: '疏散', security: '警戒',
  smokeControl: '排烟控制', communication: '通信', safety: '安全防护', resourceCoordination: '资源协同',
};

function floorText(floor: string | null): string {
  if (!floor) return '待确认';
  return floor.replace(/F$/i, '层').replace(/^(\d+)层$/, '$1层');
}

/** 起火部位（楼层/房间/场景空间）描述。 */
function fireLocationText(plan: UnifiedFireRescuePlan): string {
  const spatial = plan.spatialTarget;
  const room = spatial.room?.trim();
  const roomSpace = spatial.roomId && /Space[\s_-]?/i.test(spatial.roomId) ? spatial.roomId : null;
  const parts = [floorText(spatial.floor), room ? `${room}房间` : null].filter(Boolean);
  const location = parts.join('');
  const spaceNote = roomSpace ? `（场景空间：${roomSpace}）` : spatial.room ? '' : '（场景空间待确认）';
  return `${location || '待确认'}${spaceNote}`;
}

function basicProfileRows(profile: BuildingProfile): string[][] {
  return [
    ['单位名称', profile.unitName],
    ['地址', profile.address],
    ['建筑参数', profile.params],
    ['功能分区', profile.functionZones],
    ['消防设施', profile.fireFacilities],
    ['垂直交通', profile.verticalTransport],
    ['消防控制室', profile.fireControlRoom],
    ['安全责任人', profile.safetyOfficer],
    ['安全管理人', profile.safetyManager],
  ];
}

/** 判定依据：优先用命中规则的证据字段推导"要素/事实/依据"，与参考预案一致；缺失时用分项或通用说明。 */
const FIELD_DIM: Record<string, string> = { trappedCount: '被困人数', burnAreaSqm: '过火面积', spreadTrend: '蔓延趋势', fireType: '火灾类型', building: '建筑类型', specialHazards: '特殊危险源' };

function fieldValue(plan: UnifiedFireRescuePlan, field: string): string {
  switch (field) {
    case 'trappedCount': return plan.incident.trappedCount === null ? '待核实' : `${plan.incident.trappedCount}人`;
    case 'burnAreaSqm': return plan.incident.burnAreaSqm === null ? '待确认' : `约${plan.incident.burnAreaSqm}㎡`;
    case 'spreadTrend': return plan.incident.spreadTrend || '待确认';
    case 'fireType': return plan.event.fireType || '待确认';
    case 'building': return plan.building.name || '待确认';
    case 'specialHazards': return plan.incident.specialHazards?.length ? plan.incident.specialHazards.join('、') : '待确认';
    default: return '';
  }
}

function levelBasisRows(plan: UnifiedFireRescuePlan): string[][] {
  const level = plan.responseLevel;
  const rows: string[][] = [];
  const rules = level.matchedRules ?? [];
  const breakdown = level.scoreBreakdown ?? [];
  if (rules.length) {
    for (const rule of rules) {
      const field = rule.fieldPaths?.[0] || '';
      const dim = (field && FIELD_DIM[field]) || rule.name || rule.ruleId || '判定项';
      const fact = field ? fieldValue(plan, field) : `+${rule.score} 分`;
      rows.push([dim, fact, rule.explanation || rule.name || '命中该规则。']);
    }
  } else if (breakdown.length) {
    for (const item of breakdown) {
      rows.push([item.dimension || '判定项', item.value ?? '—', `${item.score} 分`]);
    }
  } else {
    rows.push(['综合判定', '—', level.riskScore !== null ? `风险分数 ${level.riskScore}（规则版本 ${level.ruleVersion || '未配置'}）。` : '缺少风险分数，仅作建议。']);
  }
  if (level.missingEvidence?.length) rows.push(['缺失证据', '—', level.missingEvidence.join('；')]);
  if (level.conflictingEvidence?.length) rows.push(['冲突证据', '—', level.conflictingEvidence.join('；')]);
  return rows;
}

/** 预案模板来源说明（保留"编制层级/模板文件/章节来源"信息，便于复核人核对模板版本）。 */
function planTemplateNote(plan: UnifiedFireRescuePlan): string {
  const t = plan.planTemplate;
  if (!t) return '';
  const tierLabel = t.tierLabel || t.tier || '未配置模板';
  const fileName = t.fileName ? `（${t.fileName}）` : '';
  const sectionStatus = t.sectionRetrievalStatus === 'retrieved'
    ? `已取到并核对 ${t.sections?.length ?? 0} 个章节`
    : t.sectionRetrievalStatus === 'unavailable'
      ? '知识库未取到章节，章节完整性未核验'
      : '未接入知识库，章节完整性未核验';
  return `编制层级与模板：${tierLabel}模板${fileName}；${sectionStatus}。`;
}

function strategyRows(strategies: UnifiedFireRescuePlan['strategies']): string[][] {  const rows: string[][] = [];
  const entries = Object.entries(strategies) as Array<[string, { status: string; content: string | null; failureReason?: string }]>;
  for (const [key, strategy] of entries) {
    if (!strategy) continue;
    const label = STRATEGY_KEY_LABEL[key] || key;
    const content = strategy.content || (strategy.status === 'failed' ? (strategy.failureReason || '本项处置未生成。') : '此项处置待补充；需复核确认。');
    rows.push([label, content]);
  }
  return rows.length ? rows : [['处置要点', '本预案未生成处置策略，需人工研判。']];
}

function forceRows(force: UnifiedFireRescuePlan['forceComposition']): string[][] {
  const rows: string[][] = [];
  for (const unit of force.units) {
    const vehicles = unit.vehicles.map((v) => typeof v === 'string' ? v : (v as { description?: string })?.description ?? '').filter(Boolean).join('、');
    const personnel = unit.personnel !== null && unit.personnel !== undefined ? `${typeof unit.personnel === 'number' ? `${unit.personnel} 人` : unit.personnel}` : '';
    const vehiclesOrPersonnel = [vehicles, personnel].filter(Boolean).join(' · ') || '待核实';
    const eta = unit.etaMinutes !== null ? `（约${unit.etaMinutes}分钟）` : '';
    const distance = unit.distanceKm != null ? `约${unit.distanceKm.toFixed(1)}km` : '';
    const task = unit.engagementStatus === 'dispatched' ? '已调派' : unit.engagementStatus === 'in_plan' ? '纳入预案' : unit.engagementStatus === 'candidate_recommended' ? '候选推荐' : unit.availabilityStatus === 'verified' ? '可用（待复核指派）' : '待复核';
    rows.push([`${unit.name}${eta}${distance ? '，' + distance : ''}`, vehiclesOrPersonnel || '待核实', task]);
  }
  if (!rows.length) {
    rows.push(['暂无已核验力量编成', '—', '待人工匹配（来源：力量平台，需复核可用性与距离）']);
  }
  return rows;
}

/** 标准消防组织编成（结合预案已生成的处置策略），非虚构现场事实，属通用组织架构。 */
function fireOrgText(plan: UnifiedFireRescuePlan): string {
  const s = plan.strategies;
  const groups = ['总指挥（支队全勤指挥部指挥长）', '作战组（内攻灭火/搜救/堵截）', '侦察组（无人机/热成像）', '供水组（室外消火栓+水泵接合器加压）', '警戒组（封锁周边）', '保障组（气瓶/医疗/饮食）', '通信组（现场网络）'];
  if (s.rescue?.content) groups.push('搜救组（按搜救顺序组织救人）');
  if (s.evacuation?.content) groups.push('疏散组（起火层及上下层分区疏散）');
  if (s.safety?.content) groups.push('安全员（结构/回燃风险监控）');
  return groups.join('；') + '。';
}

function pendingList(plan: UnifiedFireRescuePlan): string[] {
  const items: string[] = [];
  const level = plan.responseLevel;
  const spatial = plan.spatialTarget;
  const route = plan.routeWater;
  const incident = plan.incident;
  if (spatial.status !== 'ready') items.push(`起火楼层/房间精确解析：${spatial.failureReason || '以现场核实为准'}`);
  if (incident.trappedCount === null) items.push('被困人数/位置待核实');
  if (incident.burnAreaSqm === null) items.push('过火面积待确认');
  if (!incident.spreadTrend) items.push('蔓延方向/速度待侦察（烟气经管道井/外窗向上层蔓延）');
  if (!incident.specialHazards?.length) items.push('爆炸/特殊危险源待排查（锂电池/压力容器等）');
  if (level.missingEvidence?.length) items.push(...level.missingEvidence);
  if (route?.failureReason) items.push(`路线/水源：${route.failureReason}`);
  for (const source of route?.waterSources ?? []) {
    if (source.diameterMm === null && source.pressureMpa === null) items.push(`水源「${source.code || source.address || source.id}」口径/压力未登记，供水能力待核算`);
  }
  return items;
}

/** 依据知识库模板章节标题推断其对应的内容段落类型。 */
function kindFromTitle(title: string): string {
  const t = title;
  if (/三维|场景|到场|截图/.test(t)) return 'scene';
  if (/现场态势|现场情况|火情概况|现场概/.test(t)) return 'situation';
  if (/基本情况|单位|建筑概况|建筑信息/.test(t)) return 'basic';
  if (/毗邻|四邻|周边/.test(t)) return 'neighbor';
  if (/功能分区|消防组织|组织/.test(t)) return 'function';
  if (/等级|判定|研判/.test(t)) return 'level';
  if (/处置|要点|措施|安全提醒|行动/.test(t)) return 'measures';
  if (/力量|编成|调派|增援/.test(t)) return 'force';
  if (/待核实|待定|核实清单|风险|缺失/.test(t)) return 'pending';
  return 'unknown';
}

/**
 * 按参考《五矿国际广场"8·8"电气火灾灭火救援预案》结构生成完整预案 Word。
 *
 * 动态字段取 UnifiedFireRescuePlan 真实数据；建筑固定事实取 BUILDING_PROFILES；
 * 找不到真实来源的字段一律标"待核实/以现场为准"，绝不编造。
 */
export async function generateReferenceDocument(plan: UnifiedFireRescuePlan): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');

  const b = buildingProfileOf(plan.building.name);
  const buildingName = plan.building.name || '待确认';
  const level = plan.responseLevel;
  const incident = plan.incident;
  const spatial = plan.spatialTarget;
  const force = plan.forceComposition;
  const locationText = fireLocationText(plan);
  const levelConclusion = level.recommendation
    ? `${LEVEL_LABEL[level.recommendation]}`
    : '待人工核定（暂时仅有规则建议，未确认）';
  const fireType = plan.event.fireType || '火灾类型待确认';
  const trapped = incident.trappedCount === null ? '待核实' : `${incident.trappedCount}人（待核实具体位置/生命体征）`;
  const burnArea = incident.burnAreaSqm === null ? '待确认' : `约${incident.burnAreaSqm}㎡`;
  const spread = incident.spreadTrend || '待确认（需侦察烟气是否经管道井/外窗向上层蔓延）';
  const hazard = incident.specialHazards?.length ? incident.specialHazards.join('、') : '待确认（排查锂电池/压力容器等）';

  const neighborRows = b.neighbors.length
    ? [['方向', '毗邻/道路', '宽度/登高作业'], ...b.neighbors.map((n) => [n.direction, n.place, n.width])]
    : [['方向', '毗邻/道路', '宽度/登高作业'], ['四邻', '以现场确认为准', '待核实']];

  const pending = pendingList(plan);
  const pendingItems = pending.length ? pending.map((item, i) => `${i + 1}. ${item}`).join('\n') : '暂无待核实项（仍需现场复核）。';

  const situationRows: string[][] = [
    ['起火单位', b.unitName],
    ['起火部位', locationText],
    ['火灾类型', fireType],
    ['被困人员', trapped],
    ['过火面积', burnArea],
    ['蔓延趋势', spread],
    ['爆炸风险', hazard],
    ['固定消防设施', b.fireFacilities],
  ];

  // 章节渲染器：kind -> (title) => XML。知识库模板有章节时按模板标题出骨架；否则按参考结构。
  const renderSection = (kind: string, title: string): string => {
    switch (kind) {
      case 'scene': return `${heading(title)}${p(`起火部位：${locationText} · ${buildingName} J3D 三维指挥台`)}${p('')}`;
      case 'situation': return `${heading(title)}${tableXml([['项目', '内容'], ...situationRows])}${p('')}`;
      case 'basic': return `${heading(title)}${tableXml(basicProfileRows(b))}${p('')}`;
      case 'neighbor': return `${heading(title)}${tableXml(neighborRows)}${p('')}`;
      case 'function': return `${heading(title)}${p(`功能分区：起火层 ${floorText(spatial.floor)}（${spatial.room ? spatial.room + ' 及周边' : '周边区域'}，搜救/灭火核心区）；内攻集结与器材前置层见处置要点；利用${b.verticalTransport.includes('疏散楼梯6部') ? '6部疏散楼梯及前室' : '疏散楼梯及前室'}引导疏散；地面设前沿指挥部，${b.fireControlRoom.includes('地下一层') ? '地下消防控制室' : '消防控制室'}设技术支援组。`)}${p(`消防组织：${fireOrgText(plan)}`)}${p('')}`;
      case 'level': return `${heading(title)}${p(`判定结论：${levelConclusion}`)}${p('判定依据：')}${tableXml([['要素', '事实', '依据'], ...levelBasisRows(plan)])}${p('')}`;
      case 'measures': return `${heading(title)}${p('（来源：《消防救援队伍作战训练安全手册》《高层建筑火灾扑救行动指南》XF/T1191—2014、《大型商业综合体灭火救援工作指南》《典型灾害事故处置安全行动要点提示》）')}${tableXml([['要点', '内容'], ...strategyRows(plan.strategies)])}${p('')}`;
      case 'force': return `${heading(title)}${p('（来源：三亚消防力量平台；距离/ETA/道路通行/取水能力/水压 待接入/待核实，不作为调派唯一依据）')}${tableXml([['队站', '车辆/人员', '任务'], ...forceRows(force)])}${p('')}`;
      case 'pending': return `${heading(title)}${wp(pendingItems)}${p('')}${p('三维场景定位、高亮、隔离、路线动画、Word 导出、签发、外部通知——须指挥员复核后执行。')}`;
      default: return `${heading(title)}${p('以知识库模板为准，本节内容需由知识库/现场资料填充（当前预案未提供该段落数据）。')}${p('')}`;
    }
  };

  // 知识库模板章节（若有）作为权威骨架；否则按参考《五矿国际广场"8·8"预案》结构。
  const kbSections = plan.planTemplate?.sections ?? [];
  const sections: Array<{ kind: string; title: string }> = kbSections.length
    ? kbSections.map((s) => ({ kind: kindFromTitle(s.title), title: s.title }))
    : [
        { kind: 'scene', title: '一、三维到场态势（场景截图）' },
        { kind: 'situation', title: '二、现场态势' },
        { kind: 'basic', title: '三、基本情况' },
        { kind: 'neighbor', title: '四、毗邻情况' },
        { kind: 'function', title: '五、功能分区与消防组织' },
        { kind: 'level', title: '六、火灾等级判定' },
        { kind: 'measures', title: '七、处置要点与安全提醒' },
        { kind: 'force', title: '八、力量编成建议（待指挥员复核）' },
        { kind: 'pending', title: '九、待核实清单 & 人工复核' },
      ];

  const body = [
    heading(`${buildingName}灭火救援预案`),
    p('（数字预案编制闭环 · 智能体生成 · 人工待复核）'),
    planTemplateNote(plan) ? p(planTemplateNote(plan)) : p(''),
    p(''),
    sections.map(({ kind, title }) => renderSection(kind, title)).join(''),
  ].join('');

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * 站级档案模板：知识库来源的宝盛广场档案预案，没有 {{token}} 占位符，
 * 走追加模式（见 plan-document-append.ts），不走下方的占位符替换路径。
 * 大队/支队/总队三级暂未接入真实模板文件，继续走占位符路径的本地兜底。
 */
const STATION_TEMPLATE_PATH = path.join(process.cwd(), 'lib', 'templates', 'station.docx');

/** 各内置模板自带的"示例建筑名"，用于在追加模式下把示例建筑替换成真实预案建筑（栏目深度填充）。 */
const TEMPLATE_SAMPLE_BUILDINGS: Record<string, string[]> = {
  'station-archive-template': ['三亚宝盛广场管理有限公司', '宝盛广场'],
  'battalion-template': ['美丽亚家居博览中心'],
  'brigade-template': ['美丽亚家居博览中心'],
  'headquarters-highrise-template': [],
  'headquarters-underground-template': [],
  'headquarters-commercial-template': [],
};

/** 内置的知识库模板 → 对应文档底座（tier + buildingCategory）。无占位符，走追加模式。 */
const BUNDLED_TEMPLATES: Array<{ tier: string; category?: string; file: string; templateId: string }> = [
  { tier: 'station', file: 'station.docx', templateId: 'station-archive-template' },
  { tier: 'battalion', file: 'battalion.docx', templateId: 'battalion-template' },
  { tier: 'brigade', file: 'detachment.docx', templateId: 'brigade-template' },
  { tier: 'headquarters', category: 'high_rise', file: 'corps-highrise.docx', templateId: 'headquarters-highrise-template' },
  { tier: 'headquarters', category: 'underground', file: 'corps-underground.docx', templateId: 'headquarters-underground-template' },
  { tier: 'headquarters', category: 'commercial_complex', file: 'corps-commercial.docx', templateId: 'headquarters-commercial-template' },
];

/** 返回与预案 tier/buildingCategory 匹配的内置模板路径；无匹配返回 null（走本地占位符兜底）。 */
function bundledTemplateFor(plan: UnifiedFireRescuePlan): { path: string; templateId: string } | null {
  const tier = plan.planTemplate?.tier ?? null;
  if (!tier) return null;
  const category = plan.planTemplate?.buildingCategory ?? null;
  let match: { file: string; templateId: string } | undefined;
  if (tier === 'headquarters') {
    // 总队级按建筑类型细分；未归类/其它时默认高层（与选取逻辑一致）。
    match = BUNDLED_TEMPLATES.find((entry) => entry.tier === 'headquarters' && entry.category === category)
      ?? BUNDLED_TEMPLATES.find((entry) => entry.tier === 'headquarters' && entry.category === 'high_rise');
  } else {
    match = BUNDLED_TEMPLATES.find((entry) => entry.tier === tier);
  }
  if (!match) return null;
  return { path: path.join(process.cwd(), 'lib', 'templates', match.file), templateId: match.templateId };
}

async function renderAppendModeTemplate(
  plan: UnifiedFireRescuePlan,
  templatePath: string,
  templateId: string,
): Promise<RenderedPlanDocument> {
  const outputDirectory = process.env.FIRE_PLAN_EXPORT_DIR?.trim() || path.join(process.cwd(), '.data', 'fire-rescue-exports');
  let source: Buffer;
  try {
    source = await readFile(templatePath);
  } catch (error) {
    throw new PlanDocumentError(`无法读取 Word 模板：${templatePath}`, error);
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(source);
  } catch (error) {
    throw new PlanDocumentError('Word 模板不是有效的 .docx/.dotx 压缩包。', error);
  }
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) {
    throw new PlanDocumentError('模板缺少 word/document.xml，无法追加系统数据节。');
  }
  const xml = await documentPart.async('string');
  // 栏目深度填充：把模板自带的示例建筑名替换成真实预案建筑，使正文/页眉页脚反映实际事件。
  const sampleNames = TEMPLATE_SAMPLE_BUILDINGS[templateId] ?? [];
  const buildingName = plan.building?.name?.trim();
  const replaceSample = (value: string) => {
    let out = value;
    for (const sample of sampleNames) {
      if (sample.trim() && buildingName) out = out.split(sample).join(buildingName);
    }
    return out;
  };
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(document|header\d+|footer\d+)\.xml$/.test(name)) {
      const part = zip.file(name);
      if (part) zip.file(name, replaceSample(await part.async('string')));
    }
  }
  const entries: AppendEntry[] = appendEntries(plan);
  zip.file('word/document.xml', appendSystemSection(replaceSample(xml), '系统生成 · 本次事件数据', entries));
  await mkdir(outputDirectory, { recursive: true });
  const fileName = `${plan.planId}-v${plan.version}.docx`;
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const savedPath = path.join(outputDirectory, fileName);
  await writeFile(savedPath, buffer);
  return {
    buffer, fileName, savedPath,
    checkedFields: entries.map((entry) => entry.label),
    templateName: path.basename(templatePath),
    templateId,
    templateVersion: process.env.FIRE_PLAN_TEMPLATE_VERSION?.trim() || null,
    templateSource: 'knowledge_base' as const,
  };
}

export async function renderPlanDocument(plan: UnifiedFireRescuePlan): Promise<RenderedPlanDocument> {
  const templatePath = process.env.FIRE_PLAN_TEMPLATE_PATH?.trim();
  // 默认（未指定客户/知识库模板）按参考《五矿国际广场"8·8"电气火灾灭火救援预案》结构生成完整预案：
  // 用 plan 的真实数据 + 建筑档案（BUILDING_PROFILES）产出九节结构化文档，而不是旧的线性占位符列表。
  // 只有显式指定 FIRE_PLAN_TEMPLATE_PATH 时才用该模板（含占位符走替换，无占位符走追加模式）。
  if (!templatePath) {
    const outputDirectory = process.env.FIRE_PLAN_EXPORT_DIR?.trim() || path.join(process.cwd(), '.data', 'fire-rescue-exports');
    const buffer = await generateReferenceDocument(plan);
    await mkdir(outputDirectory, { recursive: true });
    const fileName = `${plan.planId}-v${plan.version}.docx`;
    const savedPath = path.join(outputDirectory, fileName);
    await writeFile(savedPath, buffer);
    return {
      buffer, fileName, savedPath,
      checkedFields: [],
      templateName: 'local-demo-template.docx',
      templateId: 'local-demo',
      templateVersion: process.env.FIRE_PLAN_TEMPLATE_VERSION?.trim() || null,
      templateSource: 'local_demo' as const,
    };
  }
  const outputDirectory = process.env.FIRE_PLAN_EXPORT_DIR?.trim() || path.join(process.cwd(), '.data', 'fire-rescue-exports');
  let source: Buffer;
  if (!templatePath) {
    source = await demoTemplate();
  } else {
    try {
      source = await readFile(templatePath);
    } catch (error) {
      throw new PlanDocumentError(`无法读取 Word 模板：${templatePath}`, error);
    }
  }
  // 检测模板是否含 {{token}} 占位符：无占位符的知识库模板走追加模式。
  const hasPlaceholder = await (async () => {
    try {
      const probeZip = await JSZip.loadAsync(source);
      const parts = Object.keys(probeZip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
      for (const part of parts) {
        const xml = await probeZip.file(part)!.async('string');
        if (/\{\{[a-z_]+\}\}/i.test(xml)) return true;
      }
    } catch {
      // 模板解析失败按占位符路径处理，交由后续校验报错。
    }
    return false;
  })();
  if (templatePath && !hasPlaceholder) {
    // 知识库模板（无占位符）走追加模式。templateId 用于栏目深度填充的示例建筑替换，
    // 优先从内置模板表按文件名匹配出标准 templateId，避免 basename 与替换映射键不一致。
    const fileName = path.basename(templatePath);
    const bundledId = BUNDLED_TEMPLATES.find((entry) => entry.file === fileName)?.templateId;
    return renderAppendModeTemplate(plan, templatePath, bundledId ?? path.basename(templatePath, path.extname(templatePath)));
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(source);
  } catch (error) {
    throw new PlanDocumentError('Word 模板不是有效的 .docx/.dotx 压缩包。', error);
  }
  const values = fields(plan);
  const parts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
  const replacements = new Map([
    ...TOKEN_NAMES.map((token) => [`{{${token}}}`, wordText(values[token])] as const),
    ...REMOVED_TOKEN_NAMES.map((token) => [`{{${token}}}`, ''] as const),
  ]);
  const checkedFields: string[] = [];
  for (const part of parts) {
    const entry = zip.file(part);
    if (!entry) continue;
    let xml = await entry.async('string');
    for (const [marker, replacement] of replacements) {
      if (xml.includes(marker)) {
        if ((TOKEN_NAMES as readonly string[]).some((token) => marker === `{{${token}}}`)) checkedFields.push(marker);
        xml = xml.split(marker).join(replacement);
      }
    }
    for (const token of REMOVED_TOKEN_NAMES) {
      xml = xml.split(`${token}:`).join('').split(`${token}：`).join('').split(token).join('');
    }
    zip.file(part, xml);
  }
  const missing = TOKEN_NAMES.map((token) => `{{${token}}}`).filter((marker) => !checkedFields.includes(marker));
  if (missing.length) {
    throw new PlanDocumentError(`Word 模板缺少未拆分的字段占位符：${missing.join(', ')}`);
  }
  await mkdir(outputDirectory, { recursive: true });
  const fileName = `${plan.planId}-v${plan.version}.docx`;
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const savedPath = path.join(outputDirectory, fileName);
  await writeFile(savedPath, buffer);
  return {
    buffer, fileName, checkedFields, savedPath,
    templateName: templatePath ? path.basename(templatePath) : 'local-demo-template.docx',
    // 模板溯源。需求书 §12.1 与验收清单第 462 条要求模板编号与版本可追溯。
    // 未配置 FIRE_PLAN_TEMPLATE_PATH 时来源必须标成 local_demo，
    // 不能让本地兜底版式被当作知识库正式模板。
    templateId: templatePath ? path.basename(templatePath, path.extname(templatePath)) : 'local-demo',
    templateVersion: process.env.FIRE_PLAN_TEMPLATE_VERSION?.trim() || null,
    templateSource: templatePath ? 'knowledge_base' as const : 'local_demo' as const,
  };
}
