#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const baselinePath = resolve(evidenceDir, '../../baseline/scenario-cases.json');
const baseUrl = (process.env.FIRE_COMMAND_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function redact(value, key = '') {
  if (/token|secret|authorization|app.?key|cookie/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
}

function planReadiness(payload) {
  const plan = payload?.data?.plan;
  if (!plan || typeof plan !== 'object') return { ready: false, reason: 'response_missing_plan' };
  const required = [
    ['spatialTarget', plan.spatialTarget?.status === 'ready'],
    ['responseLevel', plan.responseLevel?.status === 'ready' && typeof plan.responseLevel?.recommendation === 'string'],
    ['forceComposition', plan.forceComposition?.status === 'ready' && plan.forceComposition?.units?.length > 0],
    ['routeWater', plan.routeWater?.status === 'ready' && plan.routeWater?.primaryRoute],
    ['simulation', plan.simulation?.mappings?.length === 11 && plan.simulation?.status === 'ready'],
  ];
  const missing = required.filter(([, ok]) => !ok).map(([name]) => name);
  return missing.length ? { ready: false, reason: `plan_not_ready:${missing.join(',')}` } : { ready: true, reason: null };
}

function classify(httpStatus, payload, error) {
  if (error) return { status: 'failed', reason: `request_error:${error}` };
  if (!payload || httpStatus < 200 || httpStatus >= 300 || payload.ok !== true) {
    const pending = payload?.data?.status === 'pending_manual_review' || payload?.data?.executionBlocked === true;
    return { status: pending ? 'pending_manual_review' : 'failed', reason: payload?.error || payload?.message || `http_${httpStatus}` };
  }
  if (payload.mode === 'simulation' || payload.mode === 'offline_demo') {
    return { status: 'pending_manual_review', reason: `non_live_mode:${payload.mode}` };
  }
  const readiness = planReadiness(payload);
  return readiness.ready
    ? { status: 'ready', reason: null }
    : { status: 'pending_manual_review', reason: readiness.reason };
}

async function runCase(demoCase) {
  const input = {
    sceneId: demoCase.input.scene_id,
    building: demoCase.input.building,
    floor: demoCase.input.floor,
    room: demoCase.input.room,
    roomOutInstanceId: demoCase.input.room_out_instance_id,
    fireType: demoCase.input.fire_type,
    trappedCount: demoCase.input.trapped_count,
    burnArea: demoCase.input.burn_area_m2,
    routeCondition: demoCase.input.route_condition,
    waterSourceCondition: demoCase.input.water_source_condition,
  };
  const request = { skillId: 'competition-orchestrator', actionId: 'prepare_competition_run', input };
  let httpStatus = 0;
  let payload = null;
  let error = null;
  try {
    const response = await fetch(`${baseUrl}/api/skills/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-Retest': 'frozen-case-11' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20000),
    });
    httpStatus = response.status;
    payload = await response.json().catch(() => null);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const outcome = classify(httpStatus, payload, error);
  return {
    caseId: demoCase.case_id,
    checkedAt: new Date().toISOString(),
    request: redact(request),
    transport: { baseUrl, endpoint: '/api/skills/execute', httpStatus },
    status: outcome.status,
    reason: outcome.reason,
    receipt: redact(payload),
  };
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
if (!Array.isArray(baseline.demo_cases) || baseline.demo_cases.length !== 3) {
  throw new Error('baseline must contain exactly three demo_cases');
}

const cases = [];
for (const demoCase of baseline.demo_cases) cases.push(await runCase(demoCase));
const statuses = cases.map((item) => item.status);
const overall = statuses.includes('failed')
  ? 'failed'
  : statuses.includes('pending_manual_review')
    ? 'pending_manual_review'
    : 'ready';
const output = {
  receiptVersion: 'frozen-case-retest/v1',
  runId,
  checkedAt: new Date().toISOString(),
  policy: 'Only a live, non-simulation response with complete plan data can be ready. Mock, offline, draft, old, or screenshot evidence is never promoted.',
  baseUrl,
  overallStatus: overall,
  cases,
};
const outputPath = resolve(evidenceDir, `frozen-case-retest-${runId}.json`);
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, overallStatus: overall, cases: cases.map(({ caseId, status, reason }) => ({ caseId, status, reason })) }, null, 2));
process.exitCode = overall === 'ready' ? 0 : 2;
