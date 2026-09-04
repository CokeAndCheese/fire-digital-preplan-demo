import 'server-only';
import type { PlanSimulationVerification } from './plan-contract';

export const noStoreHeaders = { 'Cache-Control': 'no-store' };

export function authorizePlanApi(request: Request): Response | null {
  const expected = process.env.FIRE_PLAN_API_TOKEN?.trim();
  if (expected) {
    if (request.headers.get('authorization') !== `Bearer ${expected}`) {
      return Response.json({ message: '预案 API 鉴权失败。' }, { status: 401, headers: noStoreHeaders });
    }
    return null;
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') {
    // 同源判定统一走 host 比较；本机 127.0.0.1 / localhost 视为同源，
    // 否则浏览器 fetch 的同一个 SPA（Origin 与 request.url 可能因 host 别名不同）会被误判为跨域。
    const normalizeHost = (value: string) => value.replace(/:\d+$/, '').replace(/^127\.0\.0\.1$/, 'localhost').toLowerCase();
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const sameHost = normalizeHost(originUrl.host) === normalizeHost(requestUrl.host);
    if (!sameHost) {
      return Response.json({ message: '未配置共享令牌时仅允许同源预案 API 调用。' }, { status: 403, headers: noStoreHeaders });
    }
  }
  return null;
}

export function revision(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function simulationVerification(value: unknown): PlanSimulationVerification | null {
  const input = record(value);
  const attempt = input?.attempt;
  if (!input || typeof input.runId !== 'string' || typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1
    || !['completed', 'failed', 'reset', 'unavailable'].includes(String(input.status))
    || typeof input.verifiedAt !== 'string' || !Array.isArray(input.completedStepIds)
    || !Array.isArray(input.failedStepIds) || typeof input.detail !== 'string') return null;
  const list = (items: unknown[]) => items.every((item) => typeof item === 'string') ? items as string[] : null;
  const completedStepIds = list(input.completedStepIds);
  const failedStepIds = list(input.failedStepIds);
  if (!completedStepIds || !failedStepIds) return null;
  return {
    runId: input.runId, attempt,
    status: input.status as PlanSimulationVerification['status'], verifiedAt: input.verifiedAt,
    completedStepIds, failedStepIds, detail: input.detail,
  };
}
