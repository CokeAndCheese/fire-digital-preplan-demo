import { describe, expect, it } from 'vitest';
import { extractMetrics } from '../PlanMetricsDashboard';
import type { UnifiedFireRescuePlan } from '@/lib/plan-contract';
import type { LiveExecutionRun } from '../ExecutionMonitor';

// 复用 PlanSummaryPanel.test.ts 的 fixture 生成器
const minimalPlan = (): UnifiedFireRescuePlan => ({
  schemaVersion: 'fire-rescue-plan/v1',
  planId: 'PLAN-TEST',
  version: 1,
  revision: 1,
  previousPlanId: null,
  versionDiff: [],
  inputFingerprint: 'test',
  event: { incidentId: 'INC-1', receivedAt: null, fireType: null, evidenceRefs: [] },
  building: { name: null, buildingId: null },
  spatialTarget: {
    sceneId: null,
    floor: null,
    floorId: null,
    room: null,
    roomId: null,
    firePartition: null,
    status: 'not_requested',
    evidenceRefs: [],
  },
  incident: { trappedCount: null, burnAreaSqm: null, spreadTrend: null, specialHazards: [], evidenceRefs: [] },
  responseLevel: { recommendation: null, ruleVersion: null, status: 'not_requested', evidenceRefs: [], missingEvidence: [] },
  forceComposition: { status: 'not_requested', units: [], evidenceRefs: [] },
  strategies: {
    suppression: { status: 'not_requested', content: null, evidenceRefs: [] },
    rescue: { status: 'not_requested', content: null, evidenceRefs: [] },
    evacuation: { status: 'not_requested', content: null, evidenceRefs: [] },
    security: { status: 'not_requested', content: null, evidenceRefs: [] },
    smokeControl: { status: 'not_requested', content: null, evidenceRefs: [] },
  },
  simulation: { status: 'not_requested', mappings: [], evidenceRefs: [] },
  simulationVerification: null,
  risks: [],
  missingItems: [],
  failedItems: [],
  review: { status: 'pending_manual_review', comments: [], reviewer: null, reviewedAt: null },
  issuance: { status: 'not_issued', issuer: null, issuedAt: null, blockReason: null },
  document: {
    status: 'not_requested',
    fileName: null,
    generatedAt: null,
    templateName: null,
    verification: { status: 'not_run', checkedFields: [], missingFields: [] },
    failureReason: null,
  },
  lifecycleStatus: 'draft',
  createdBy: 'test-agent',
  createdAt: new Date().toISOString(),
  updatedBy: 'test-agent',
  updatedAt: new Date().toISOString(),
  evidenceRefs: [],
  auditEvents: [],
  orchestration: [],
});

describe('PlanMetricsDashboard', () => {
  describe('extractMetrics', () => {
    it('无预案返回 null，面板据此显示等待态', () => {
      expect(extractMetrics(null, null)).toBeNull();
    });

    it('空预案返回零值指标', () => {
      const metrics = extractMetrics(minimalPlan(), null);
      expect(metrics).toMatchObject({
        totalCalls: 0,
        totalDurationMs: 0,
        successRate: 0,
        evidenceCount: 0,
        verifiedCount: 0,
        auditEventCount: 0,
        simulationSteps: 0,
        averageCallMs: 0,
      });
    });

    it('无 run 时阶段进度回落到 0/9，不崩溃', () => {
      const metrics = extractMetrics(minimalPlan(), null);
      expect(metrics?.phasesPassed).toBe(0);
      expect(metrics?.totalPhases).toBe(9);
    });

    it('从 run.phases 统计已完成阶段数', () => {
      const run = {
        phases: [
          { id: 'received', title: '火情输入', detail: '', status: 'done' },
          { id: 'intent', title: '智能研判', detail: '', status: 'done' },
          { id: 'skill', title: 'Skill 协同', detail: '', status: 'running' },
          { id: 'result', title: '结构化结果', detail: '', status: 'pending' },
        ],
      } as unknown as LiveExecutionRun;
      const metrics = extractMetrics(minimalPlan(), run);
      expect(metrics?.phasesPassed).toBe(2);
      expect(metrics?.totalPhases).toBe(4);
    });

    it('有调用链的预案正确计算总耗时、成功率和平均响应', () => {
      const plan = minimalPlan();
      plan.orchestration = [
        {
          sequence: 1,
          invocationId: 'inv-1',
          skillId: 'scene-control',
          actionId: 'locate_space',
          startedAt: '2025-01-01T00:00:00Z',
          finishedAt: '2025-01-01T00:00:01Z',
          durationMs: 1001,
          input: {},
          output: {},
          status: 'succeeded',
        },
        {
          sequence: 2,
          invocationId: 'inv-2',
          skillId: 'response-level',
          actionId: 'assess',
          startedAt: '2025-01-01T00:00:01Z',
          finishedAt: '2025-01-01T00:00:01Z',
          durationMs: 0,
          input: {},
          output: {},
          status: 'succeeded',
        },
        {
          sequence: 3,
          invocationId: 'inv-3',
          skillId: 'fire-resource',
          actionId: 'query',
          startedAt: '2025-01-01T00:00:01Z',
          finishedAt: '2025-01-01T00:00:02Z',
          durationMs: 1377,
          input: {},
          output: {},
          status: 'failed',
        },
      ];

      const metrics = extractMetrics(plan, null);
      expect(metrics?.totalCalls).toBe(3);
      expect(metrics?.totalDurationMs).toBe(2378);
      expect(metrics?.successRate).toBeCloseTo(66.67, 1);
      expect(metrics?.averageCallMs).toBe(793);
    });

    it('证据链：计算已核验比例', () => {
      const plan = minimalPlan();
      plan.evidenceRefs = [
        {
          referenceId: 'ev-1',
          kind: 'skill',
          sourceId: 's1',
          sourceName: 'scene-control',
          collectedAt: '2025-01-01T00:00:00Z',
          status: 'verified',
          fieldPaths: [],
        },
        {
          referenceId: 'ev-2',
          kind: 'platform',
          sourceId: 'p1',
          sourceName: 'fire-resource',
          collectedAt: '2025-01-01T00:00:01Z',
          status: 'verified',
          fieldPaths: [],
        },
        {
          referenceId: 'ev-3',
          kind: 'input',
          sourceId: 'i1',
          sourceName: 'manual',
          collectedAt: '2025-01-01T00:00:00Z',
          status: 'unavailable',
          fieldPaths: [],
        },
      ];

      const metrics = extractMetrics(plan, null);
      expect(metrics?.evidenceCount).toBe(3);
      expect(metrics?.verifiedCount).toBe(2);
    });

    it('审计事件和推演步骤计数', () => {
      const plan = minimalPlan();
      plan.auditEvents = [
        {
          eventId: 'ae-1',
          type: 'created',
          at: '2025-01-01T00:00:00Z',
          actor: 'orchestrator',
          detail: 'created',
          evidenceRefs: [],
        },
        {
          eventId: 'ae-2',
          type: 'orchestration_completed',
          at: '2025-01-01T00:00:10Z',
          actor: 'orchestrator',
          detail: 'done',
          evidenceRefs: [],
        },
      ];
      plan.simulation.mappings = Array.from({ length: 11 }, (_, i) => ({
        stepId: `step-${i + 1}`,
        sequence: i + 1,
        title: `步骤 ${i + 1}`,
        sdkAction: 'action',
        input: {},
        actionId: null,
        status: 'ready',
        evidenceRefs: [],
      }));

      const metrics = extractMetrics(plan, null);
      expect(metrics?.auditEventCount).toBe(2);
      expect(metrics?.simulationSteps).toBe(11);
    });

  });
});
