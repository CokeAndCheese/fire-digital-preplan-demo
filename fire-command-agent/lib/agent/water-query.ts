/**
 * 需求书 §8.3.1：对话栏周边水源查询。
 *
 * 只做"把自然语言问题解析为一次可核验的水源检索"，不猜坐标：
 * 解析不出定位对象时返回 needs_clarification，由指挥员补充，
 * 绝不用默认坐标冒充"用户问的那个位置"。
 */

export type WaterQueryIntent = {
  /** 原始问题，不改写，用于留痕 */
  question: string;
  unitName: string | null;
  address: string | null;
  floor: string | null;
  room: string | null;
  radiusKm: number;
  waterType: string | null;
  excludeUnavailable: boolean;
  /** 指代型问法（"这个单位""附近""最近"），需要用当前预案上下文补全 */
  usesContextReference: boolean;
  limit: number;
};

const WATER_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/市政(?:消火栓|管网)/, 'municipal_pipe'],
  [/消防水池|water\s*pool|水池/i, 'pool'],
  [/泵房|水泵房/, 'pump_house'],
  [/水泵接合器|接合器/, 'siamese'],
  [/室外(?:消火栓|栓)/, 'outdoor_hydrant'],
  [/室内(?:消火栓|栓)/, 'indoor_hydrant'],
];

const CONTEXT_REFERENCE = /(这个|该|此|当前|本)(?:单位|建筑|楼|大厦|位置|现场|场景)|附近|周边|就近|最近|旁边/;

function firstGroup(content: string, expressions: RegExp[]) {
  for (const expression of expressions) {
    const match = content.match(expression);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function parseRadiusKm(content: string) {
  const km = content.match(/(\d+(?:\.\d+)?)\s*(?:公里|千米|km)/i);
  if (km) return Math.min(Math.max(Number(km[1]), 0.1), 20);
  const meters = content.match(/(\d+)\s*(?:米|m)(?![a-z])/i);
  if (meters) return Math.min(Math.max(Number(meters[1]) / 1000, 0.1), 20);
  // 缺省 3 km 与 searchNearbyWaterSources 保持一致，避免两处口径漂移。
  return 3;
}

export function parseWaterQuery(content: string): WaterQueryIntent {
  const text = content || '';
  const waterType = WATER_TYPE_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const limit = Number(text.match(/(?:前|最近的?|取)\s*(\d{1,2})\s*(?:个|条|处)/)?.[1]) || 10;
  return {
    question: text,
    unitName: firstGroup(text, [
      /([一-鿿A-Za-z0-9·-]{2,32}?(?:大厦|广场|中心|酒店|商场|医院|学校|小区|园区|仓库|厂房|消防站|大队|中队))/,
    ]),
    address: firstGroup(text, [
      /(?:地址|地点|位于)(?:为|是|在|：|:)?\s*([^,，。；;？?\n]{2,40})/,
      /((?:三亚市)?(?:海棠|吉阳|天涯|崖州)区[^,，。；;？?\n]{0,30})/,
    ]),
    floor: firstGroup(text, [/((?:地下)?\d{1,3}\s*(?:层|楼|F))/i]),
    room: firstGroup(text, [/(?:房间|室)\s*([A-Za-z0-9-]{1,12})/]),
    radiusKm: parseRadiusKm(text),
    waterType,
    // "可用"是筛选诉求；"不可用"是要求把不可用一起看，不能反向排除。
    excludeUnavailable: /可用/.test(text) && !/不可用|全部|所有/.test(text),
    usesContextReference: CONTEXT_REFERENCE.test(text),
    limit: Math.min(Math.max(limit, 1), 50),
  };
}

/** 判断是否是"问水源"，而不是走 route-water 的整体路线约束 */
export function isWaterSourceQuestion(content: string) {
  const text = content || '';
  const mentionsWater = /水源|消火栓|消防栓|水池|泵房|取水|接合器|供水/.test(text);
  if (!mentionsWater) return false;
  const asks = /(有哪些|哪些|多少|几个|查|查询|检索|找|列|看看|距离|最近|附近|周边|就近|排序|可用)/.test(text);
  return asks;
}
