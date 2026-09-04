import 'server-only';
import type { UnifiedFireRescuePlan } from '@/lib/plan-contract';
import { getFireResourcePlatformUnits } from '@/lib/skills/fire-resource-platform';
import type { WaterQueryIntent } from './water-query';

/**
 * 需求书 §8.3.1：把对话里的定位对象解析成一次可核验的检索起点。
 *
 * 只用三条真实来源，按可信度排序；都拿不到就要求澄清。
 * 不设默认坐标兜底——用错的起点排序出来的"最近水源"是有害结论。
 */
export type WaterQueryOrigin = {
  longitude: number;
  latitude: number;
  /** 起点来自哪里，写入留痕与回复，供指挥员判断可信度 */
  basis: 'explicit_coordinates' | 'platform_unit' | 'current_plan';
  label: string;
};

export type WaterQueryResolution =
  | { ok: true; origin: WaterQueryOrigin }
  | { ok: false; clarification: string };

function explicitCoordinates(question: string): WaterQueryOrigin | null {
  // 经纬度成对出现才采用；单独一个数字不猜。
  const pair = question.match(/(\d{2,3}\.\d{3,})\s*[,，、\s]+\s*(\d{1,2}\.\d{3,})/);
  if (!pair) return null;
  const longitude = Number(pair[1]);
  const latitude = Number(pair[2]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude < 73 || longitude > 136 || latitude < 3 || latitude > 54) return null;
  return { longitude, latitude, basis: 'explicit_coordinates', label: `${longitude}, ${latitude}` };
}

async function platformUnitOrigin(name: string, fetcher?: typeof fetch): Promise<WaterQueryOrigin | null> {
  try {
    const source = await getFireResourcePlatformUnits(undefined, fetcher);
    const needle = name.replace(/\s+/g, '');
    const exact = source.units.find((unit) => unit.name?.replace(/\s+/g, '') === needle);
    const partial = exact ?? source.units.find((unit) => {
      const unitName = unit.name?.replace(/\s+/g, '') ?? '';
      return unitName.includes(needle) || (needle.length >= 4 && needle.includes(unitName));
    });
    if (!partial || partial.longitude === undefined || partial.latitude === undefined) return null;
    return {
      longitude: partial.longitude,
      latitude: partial.latitude,
      basis: 'platform_unit',
      label: `平台登记单位（${partial.name}）`,
    };
  } catch {
    // 平台不可用不能降级成默认坐标；交给上层报澄清。
    return null;
  }
}

/** 从预案编排回执里取当次检索用过的真实起火点坐标 */
export function planOrigin(plan: UnifiedFireRescuePlan | undefined): WaterQueryOrigin | null {
  if (!plan) return null;
  for (const record of [...plan.orchestration].reverse()) {
    const longitude = Number(record.input?.longitude);
    const latitude = Number(record.input?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    return {
      longitude,
      latitude,
      basis: 'current_plan',
      label: plan.building.name ? `当前预案起火点（${plan.building.name}）` : '当前预案起火点',
    };
  }
  return null;
}

export async function resolveWaterQueryOrigin(
  intent: WaterQueryIntent,
  context: { plan?: UnifiedFireRescuePlan; fetcher?: typeof fetch } = {},
): Promise<WaterQueryResolution> {
  const explicit = explicitCoordinates(intent.question);
  if (explicit) return { ok: true, origin: explicit };

  if (intent.unitName) {
    const unit = await platformUnitOrigin(intent.unitName, context.fetcher);
    if (unit) return { ok: true, origin: unit };
    const fallback = planOrigin(context.plan);
    // 点名了单位却没匹配到，就不能拿当前预案的坐标顶替——那答的是另一个位置。
    if (fallback && intent.usesContextReference) return { ok: true, origin: fallback };
    return {
      ok: false,
      clarification: `力量平台登记数据里没有匹配到"${intent.unitName}"的坐标。请提供该单位的经纬度或准确登记名称后重查。`,
    };
  }

  const fromPlan = planOrigin(context.plan);
  if (fromPlan) return { ok: true, origin: fromPlan };

  return {
    ok: false,
    clarification: intent.usesContextReference
      ? '当前会话还没有带坐标的预案或现场位置，"附近/这个单位"无法定位。请说明单位名称或给出经纬度。'
      : '水源检索需要一个起点。请说明单位名称、事发地址或直接给出经纬度。',
  };
}
