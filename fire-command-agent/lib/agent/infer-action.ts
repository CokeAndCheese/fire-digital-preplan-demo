import { findSkill, findSkillAction } from '@/lib/skills/catalog';
import type { SkillExecutionRequest, SkillId } from '@/lib/skills/types';
import { SCENARIO_REGISTRY } from '@/lib/scenario-registry';

type FireContext = {
  address?: string;
  building?: string;
  burnArea?: number;
  casualtyCount?: number;
  facilityStatus?: string;
  firePartition?: string;
  fireType?: string;
  floor?: string;
  level?: string;
  missingPersonCount?: number;
  planId?: string;
  radiusKm?: number;
  reviewer?: string;
  roadConstraints?: string[];
  room?: string;
  sceneId?: string;
  sceneType?: string;
  specialHazards?: string[];
  spreadTrend?: string;
  trappedCount?: number;
  unitId?: string;
  weatherConstraints?: string[];
};

const DEFAULT_BUILDING = SCENARIO_REGISTRY.building.name;
const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseCount(value?: string): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '十') return 10;
  const [tens, ones] = value.split('十');
  if (value.includes('十')) {
    return (tens ? CHINESE_DIGITS[tens] : 1) * 10 + (ones ? CHINESE_DIGITS[ones] : 0);
  }
  if (value.length === 1) return CHINESE_DIGITS[value];
  const digits = [...value].map((character) => CHINESE_DIGITS[character]);
  return digits.every((digit) => digit !== undefined) ? Number(digits.join('')) : undefined;
}

function firstMatch(content: string, expressions: RegExp[]): string | undefined {
  for (const expression of expressions) {
    const match = content.match(expression);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractFloor(content: string): string | undefined {
  const basement = content.match(/(?:\bB\s*(\d+)\s*(?:F|层|楼)?|(?:地下|负)\s*([零〇一二两三四五六七八九十\d]+)\s*(?:层|楼))/i);
  const basementNumber = basement?.[1] ? Number(basement[1]) : parseCount(basement?.[2]);
  if (basementNumber !== undefined) return `B${basementNumber}`;
  // 地面楼层同时支持阿拉伯数字与中文数字（8层→8F、五楼→5F、十二楼→12F）。
  // 否则指挥员口述"五楼着火"时 floor 解析失败，火情分支与定位分支都无法命中，
  // inferAction 会返回 null，对话流水线只能报"当前未识别到闭环动作"。
  const aboveGround = content.match(/(?:第\s*)?([零〇一二两三四五六七八九十\d]+)\s*(?:F|层|楼)/i);
  const aboveGroundNumber = aboveGround?.[1] ? parseCount(aboveGround[1]) : undefined;
  return aboveGroundNumber !== undefined ? `${aboveGroundNumber}F` : undefined;
}

function extractBuilding(content: string): string | undefined {
  const match = content.match(/([一-鿿A-Za-z0-9·-]{2,32}?(?:大厦|广场|中心|酒店|商场|医院|学校|小区|园区|仓库|厂房))/);
  return match?.[1]
    ?.replace(/^(?:请帮我|请|帮我|请对|对于|对|针对|根据|位于|事发地|查询|查找|检索|定位|研判|判定|评估|确认|在|为)+/, '')
    .trim() || undefined;
}

function extractContext(content: string): FireContext {
  const trapped = firstMatch(content, [
    /([\d零〇一二两三四五六七八九十]+)\s*(?:人|名)(?:员)?\s*(?:被困|受困)/,
    /(?:被困|受困)(?:人员)?\s*([\d零〇一二两三四五六七八九十]+)/,
  ]);
  const missingPerson = firstMatch(content, [
    /([\d零〇一二两三四五六七八九十]+)\s*(?:人|名)(?:员)?\s*失联/,
    /失联(?:人员)?\s*([\d零〇一二两三四五六七八九十]+)/,
  ]);
  const casualties = firstMatch(content, [
    /([\d零〇一二两三四五六七八九十]+)\s*(?:人|名)(?:员)?\s*(?:伤亡|死亡|受伤)/,
    /(?:伤亡|死亡|受伤)(?:人员)?\s*([\d零〇一二两三四五六七八九十]+)/,
  ]);
  const burnArea = firstMatch(content, [
    /(?:过火|燃烧|起火)?面积(?:约|为|是)?\s*(\d+(?:\.\d+)?)\s*(?:平方米|平米|㎡)/,
    /(\d+(?:\.\d+)?)\s*(?:平方米|平米|㎡)/,
  ]);
  const radius = firstMatch(content, [/(\d+(?:\.\d+)?)\s*(?:公里|千米|km)s*(?:范围|内)?/i]);
  const specialHazards = [...content.matchAll(/危化品|易燃易爆|爆炸物|高压电|油品|燃气泄漏|储罐|锂电池/g)].map((match) => match[0]);
  const explicitNoHazards = /(?:无|未发现)(?:特殊危险源|危险源|危化品|易燃易爆物)/.test(content);
  const weatherConstraints = [...content.matchAll(/台风|暴雨|大风|雷暴|高温/g)].map((match) => match[0]);
  const explicitNoWeatherConstraint = /(?:天气正常|无恶劣天气|气象条件正常)/.test(content);
  const roadConstraints = [...content.matchAll(/道路拥堵|道路封闭|道路中断|道路受阻|交通拥堵|交通中断|通道封闭|通道受阻/g)].map((match) => match[0]);
  const explicitNoRoadConstraint = /(?:道路畅通|交通正常|通道畅通)/.test(content);

  return {
    address: firstMatch(content, [
      /(?:地址|地点|事发地)(?:为|是|在|：|:)?\s*([^,，。；;\n]{2,40})/,
      /((?:三亚市)?(?:海棠|吉阳|天涯|崖州)区)/,
    ]),
    building: extractBuilding(content),
    burnArea: burnArea === undefined ? undefined : Number(burnArea),
    casualtyCount: parseCount(casualties),
    facilityStatus: firstMatch(content, [
      /((?:消防)?(?:喷淋|消火栓|报警系统|排烟系统|消防设施)[^,，。；;\n]{0,16}(?:故障|失效|损坏|不可用|正常|可用))/, 
    ]),
    firePartition: firstMatch(content, [/(?:防火分区|分区)(?:为|是|：|:)?\s*([A-Za-z0-9_-]{1,40})/]),
    fireType: firstMatch(content, [
      /((?:电气|燃气|油类|厨房|车辆|锂电池|危化品|固体物质|高层建筑|仓库)火灾)/,
      /((?:电气设备|燃气|车辆|厨房|仓库|商铺)起火)/,
      // 泛化/普通可燃物火灾：明确不是电气类，供下级规则走"非电气"基线处置。
      /((?:一般|普通|固体可燃物|可燃物|杂物|纸箱|布料|木质|办公用品)(?:火灾)?)/,
    ]),
    floor: extractFloor(content),
    level: firstMatch(content, [/(特别重大|重大|较大|一般|一级|二级|三级|四级)(?:火情|灾情|响应)?/]),
    missingPersonCount: parseCount(missingPerson),
    planId: firstMatch(content, [/(PLAN-[A-Za-z0-9_-]+)/i, /(?:预案ID|预案编号)(?:为|是|：|:)?\s*([A-Za-z0-9_-]+)/i]),
    radiusKm: radius === undefined ? undefined : Number(radius),
    reviewer: firstMatch(content, [/(?:复核人|签发人|审批人)(?:为|是|：|:)?\s*([^,，。；;\n]{2,20})/]),
    sceneId: firstMatch(content, [/(?:场景ID|sceneId|scene_id)(?:为|是|：|:)?\s*([A-Za-z0-9_-]+)/i]),
    room: firstMatch(content, [
      /\b(Space[_\s-]?\d+)\b/i,
      /(?:房间|房号|空间)(?:为|是|：|:)?\s*([A-Za-z0-9_-]+)/i,
      /\b(\d{2,6})\s*(?:室|房间)/,
    ]),
    sceneType: firstMatch(content, [/(高层公共建筑|高层住宅|地下建筑|商业综合体|化工场所|仓储场所|仓库|厂房)/]),
    specialHazards: specialHazards.length ? [...new Set(specialHazards)] : explicitNoHazards ? [] : undefined,
    spreadTrend: firstMatch(content, [/(快速蔓延|火势失控|剧烈燃烧|正在蔓延|火势蔓延|火势扩大|已控制|控制住|未蔓延)/]),
    trappedCount: parseCount(trapped),
    unitId: firstMatch(content, [/(?:单位ID|单位编号|消防站ID)(?:为|是|：|:)?\s*([A-Za-z0-9_-]+)/i]),
    weatherConstraints: weatherConstraints.length ? [...new Set(weatherConstraints)] : explicitNoWeatherConstraint ? [] : undefined,
    roadConstraints: roadConstraints.length ? [...new Set(roadConstraints)] : explicitNoRoadConstraint ? [] : undefined,
  };
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ''));
}

function intakeHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function callerReportField(value: unknown, source: { sourceId: string; collectedAt: string }, status: 'reported' | 'not_observed' = 'reported') {
  const isPresent = value !== undefined;
  return {
    value: isPresent ? value : null,
    status: isPresent ? status : 'missing',
    source: isPresent
      ? { sourceId: source.sourceId, sourceType: 'caller_report', collectedAt: source.collectedAt }
      : { sourceId: null, sourceType: 'not_collected', collectedAt: null },
    confidence: isPresent ? 0.55 : 0,
    collectedAt: isPresent ? source.collectedAt : null,
    manuallyConfirmed: false,
  };
}

function incidentEvidenceFromCallerReport(content: string, context: FireContext) {
  const collectedAt = new Date().toISOString();
  const sourceId = `caller-report-${intakeHash(content.trim().normalize('NFKC'))}`;
  const source = { sourceId, collectedAt };
  const notObserved = (value: string[] | undefined) => value?.length === 0 ? 'not_observed' : 'reported';
  return {
    incidentId: `INTAKE-${intakeHash(content.trim().normalize('NFKC'))}`,
    receivedAt: collectedAt,
    building: callerReportField(context.building, source),
    floor: callerReportField(context.floor, source),
    room: callerReportField(context.room, source),
    firePartition: callerReportField(context.firePartition, source),
    venueType: callerReportField(context.sceneType, source),
    fireMaterialOrType: callerReportField(context.fireType, source),
    burnAreaSqm: callerReportField(context.burnArea, source),
    spreadTrend: callerReportField(context.spreadTrend, source),
    trappedCount: callerReportField(context.trappedCount, source),
    casualtyCount: callerReportField(context.casualtyCount, source),
    missingPersonCount: callerReportField(context.missingPersonCount, source),
    specialHazards: callerReportField(context.specialHazards, source, notObserved(context.specialHazards)),
    facilityStatus: callerReportField(context.facilityStatus, source),
    weatherConstraints: callerReportField(context.weatherConstraints, source, notObserved(context.weatherConstraints)),
    roadConstraints: callerReportField(context.roadConstraints, source, notObserved(context.roadConstraints)),
  };
}

function inputForExplicitAction(skillId: string, actionId: string, context: FireContext, content: string) {
  if (skillId === 'response-level' && actionId === 'assess_response_level') {
    return { incident: incidentEvidenceFromCallerReport(content, context) };
  }
  const example = { ...(findSkillAction(skillId, actionId)?.inputExample ?? {}) };
  // Manifest examples describe the contract only. A scene ID is valid only
  // when it came from the current request/registered runtime context.
  delete example.sceneId;
  const common = compact({
    address: context.address,
    building: context.building,
    burnArea: context.burnArea,
    fireType: context.fireType,
    floor: context.floor,
    level: context.level,
    planId: context.planId,
    radiusKm: context.radiusKm,
    reviewer: context.reviewer,
    room: context.room,
    sceneType: context.sceneType,
    trappedCount: context.trappedCount,
      unitId: context.unitId,
      sceneId: context.sceneId,
  });
  return { ...example, ...common };
}

export function inferAction(content: string, sceneId?: string): SkillExecutionRequest | null {
  const context = extractContext(content);
  context.sceneId = sceneId?.trim() || context.sceneId;
  const explicit = content.match(/\[skill:([a-z-]+)\s+action:([a-z_]+)\]/);
  if (explicit && findSkill(explicit[1]) && findSkillAction(explicit[1], explicit[2])) {
    return {
      skillId: explicit[1] as SkillId,
      actionId: explicit[2],
      input: inputForExplicitAction(explicit[1], explicit[2], context, content),
    };
  }

  if (/(全链路|闭环|比赛演示|一键.*(?:预案|演示)|完整.*(?:预案|推演))/.test(content)) {
    return {
      skillId: 'competition-orchestrator',
      actionId: 'prepare_competition_run',
      input: compact({
        sceneId: context.sceneId,
        building: context.building,
        floor: context.floor,
        room: context.room,
        fireType: context.fireType ?? '火灾类型待确认',
        trappedCount: context.trappedCount,
        burnArea: context.burnArea,
      }),
    };
  }

  if (/(查询|检索|历史|查找).*预案|预案.*(查询|检索|历史|查找)/.test(content)) {
    return {
      skillId: 'rescue-plan',
      actionId: 'query_plan',
      input: compact({ building: context.building, limit: 5 }),
    };
  }
  // "生成可人工复核的预案" 之类的措辞里，"复核" 只是描述预案要达到的状态，
  // 不是"提交复核"的动作；显式生成动词必须先于提交/复核意图判断，
  // 否则会被下面的提交模式误命中，进而因缺少 planId 而 PLAN_NOT_FOUND。
  if (/(生成|编制|起草|制定|拟制|形成).*预案|预案.*(生成|编制|起草|制定|拟制|形成)/.test(content)) {
    return {
      skillId: 'rescue-plan',
      actionId: 'generate_plan',
      input: compact({
        building: context.building,
        floor: context.floor,
        room: context.room,
        fireType: context.fireType ?? '火灾类型待确认',
        trappedCount: context.trappedCount,
        burnArea: context.burnArea,
      }),
    };
  }
  if (/(提交|发布|签发|复核).*预案|预案.*(提交|发布|签发|复核)/.test(content)) {
    return {
      skillId: 'rescue-plan',
      actionId: 'publish_plan',
      input: compact({ planId: context.planId, reviewer: context.reviewer ?? '值班指挥员' }),
    };
  }
  if (/预案|方案|处置/.test(content)) {
    return {
      skillId: 'rescue-plan',
      actionId: 'generate_plan',
      input: compact({
        building: context.building,
        floor: context.floor,
        room: context.room,
        fireType: context.fireType ?? '火灾类型待确认',
        trappedCount: context.trappedCount,
        burnArea: context.burnArea,
      }),
    };
  }
  if (/(研判|判定|评估|确定|建议).*(响应|火情|灾情)?(?:等级|级别)|(?:Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ|I|II|III|IV|V)[-—~至到](?:Ⅴ|V)级/i.test(content)) {
    return {
      skillId: 'response-level',
      actionId: 'assess_response_level',
      input: { incident: incidentEvidenceFromCallerReport(content, context) },
    };
  }
  if (/联系|电话|联络/.test(content) && /单位|消防站|救援力量/.test(content)) {
    return { skillId: 'fire-resource', actionId: 'get_unit_contact', input: compact({ unitId: context.unitId }) };
  }
  if (/调度|力量编成|调派|增援/.test(content)) {
    return {
      skillId: 'fire-resource',
      actionId: 'dispatch_recommendation',
      input: compact({ level: context.level ?? '待定级', sceneType: context.sceneType ?? '待确认', verifiedUnitIds: [] }),
    };
  }
  if (/力量|消防站|车辆|附近单位/.test(content)) {
    return {
      skillId: 'fire-resource',
      actionId: 'query_nearby_units',
      input: compact({ address: context.address ?? context.building ?? '三亚市', radiusKm: context.radiusKm ?? 10 }),
    };
  }
  if (/推演|演练/.test(content)) {
    return {
      skillId: 'scene-control',
      actionId: 'start_simulation',
      input: compact({
        sceneId: context.sceneId,
        floor: context.floor,
        room: context.room,
        fireType: context.fireType ?? '火灾类型待确认',
        level: context.level ?? '待定级',
        burnArea: context.burnArea,
        trappedCount: context.trappedCount,
      }),
    };
  }
  if (/切换.*(二维|2D)/i.test(content)) {
    return { skillId: 'scene-control', actionId: 'set_view_mode', input: { mode: '2D' } };
  }
  if (/切换.*(三维|3D)/i.test(content)) {
    return { skillId: 'scene-control', actionId: 'set_view_mode', input: { mode: '3D' } };
  }
  if ((context.building === DEFAULT_BUILDING || !context.building)
    && (context.fireType || /火灾|火警|起火|着火|燃烧/.test(content))
    && (context.floor || context.room)) {
    return {
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: compact({
        sceneId: context.sceneId,
        floor: context.floor,
        room: context.room,
        fireType: context.fireType,
        burnArea: context.burnArea,
        trappedCount: context.trappedCount,
      }),
    };
  }
  if (/定位|高亮|房间|楼层|空间|防火分区/.test(content)) {
    return {
      skillId: 'scene-control',
      actionId: 'locate_space',
      input: compact({
        sceneId: context.sceneId,
        floor: context.floor,
        room: context.room,
        fireType: context.fireType,
        burnArea: context.burnArea,
        trappedCount: context.trappedCount,
      }),
    };
  }
  return null;
}
