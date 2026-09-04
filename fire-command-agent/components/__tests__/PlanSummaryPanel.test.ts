import { describe, expect, it } from 'vitest';
import { calculatePlanCompleteness } from '../PlanSummaryPanel';
import type { UnifiedFireRescuePlan } from '@/lib/plan-contract';

// 最小合法预案 fixture，所有必填字段 + 全部维度 not_requested
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
  spatialTarget: { sceneId: null, floor: null, floorId: null, room: null, roomId: null, firePartition: null, status: 'not_requested', evidenceRefs: [] },
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

describe('PlanSummaryPanel', () => {
  describe('calculatePlanCompleteness', () => {
    it('旧版预案（无 routeWater / planTemplate）按 5 个基础维度计分', () => {
      const plan = minimalPlan();
      // 基础 5 维度：空间、等级、力量、策略、推演 全未就绪
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 5, ready: 0 });
    });

    it('旧版预案全部基础维度就绪得满分', () => {
      const plan = minimalPlan();
      plan.spatialTarget.status = 'ready';
      plan.responseLevel.status = 'ready';
      plan.forceComposition.status = 'ready';
      plan.strategies.suppression.status = 'ready';
      plan.strategies.rescue.status = 'ready';
      plan.strategies.evacuation.status = 'ready';
      plan.strategies.security.status = 'ready';
      plan.strategies.smokeControl.status = 'ready';
      plan.simulation.status = 'ready';
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 5, ready: 5 });
    });

    it('新版预案（含 routeWater）按 6 个维度计分', () => {
      const plan = minimalPlan();
      plan.routeWater = {
        status: 'not_requested',
        calculationVersion: null,
        accessibility: null,
        primaryRoute: null,
        backupRoute: null,
        waterSources: [],
        coverage: null,
        evidenceRefs: [],
      };
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 6, ready: 0 });
    });

    it('routeWater 块：status=ready + 有水源才算完成', () => {
      const plan = minimalPlan();
      plan.routeWater = {
        status: 'ready',
        calculationVersion: '1.0',
        accessibility: null,
        primaryRoute: null,
        backupRoute: null,
        waterSources: [
          { id: 'XFG-001', code: null, address: null, distanceKm: 0.5, usability: 'available', diameterMm: null, pressureMpa: null },
        ],
        coverage: null,
        evidenceRefs: [],
      };
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 6, ready: 1 });
    });

    it('routeWater 块：status=ready 但 waterSources 空数组不算完成', () => {
      const plan = minimalPlan();
      plan.routeWater = {
        status: 'ready',
        calculationVersion: '1.0',
        accessibility: null,
        primaryRoute: null,
        backupRoute: null,
        waterSources: [],
        coverage: null,
        evidenceRefs: [],
      };
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 6, ready: 0 });
    });

    it('planTemplate 块：tier 已推导即算完成，不看 status', () => {
      const plan = minimalPlan();
      plan.planTemplate = {
        status: 'pending_manual_review', // 模板块的 status 只能是 pending/unresolved，永不为 ready
        tier: 'battalion',
        tierLabel: '大队级预案模板',
        fileName: '大队灭火救援预案模板.pdf',
        expectedSectionCount: 8,
        buildingCategory: 'high_rise',
        knowledgeBaseId: '2086971423845441537',
        retrievalHints: [],
        sections: [],
        sectionRetrievalStatus: 'not_configured',
        sectionCountMatches: null,
        rationale: [],
        warnings: [],
        evidenceRefs: [],
      };
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 6, ready: 1 });
    });

    it('planTemplate 块：tier 为 null 不算完成', () => {
      const plan = minimalPlan();
      plan.planTemplate = {
        status: 'unresolved',
        tier: null,
        tierLabel: null,
        fileName: null,
        expectedSectionCount: null,
        buildingCategory: null,
        knowledgeBaseId: '2086971423845441537',
        retrievalHints: [],
        rationale: [],
        warnings: [],
        evidenceRefs: [],
      };
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 6, ready: 0 });
    });

    it('完整新版预案（routeWater + planTemplate）按 7 个维度计分', () => {
      const plan = minimalPlan();
      plan.spatialTarget.status = 'ready';
      plan.responseLevel.status = 'ready';
      plan.forceComposition.status = 'ready';
      plan.strategies.suppression.status = 'ready';
      plan.strategies.rescue.status = 'ready';
      plan.strategies.evacuation.status = 'ready';
      plan.strategies.security.status = 'ready';
      plan.strategies.smokeControl.status = 'ready';
      plan.simulation.status = 'ready';
      plan.routeWater = {
        status: 'ready',
        calculationVersion: '1.0',
        accessibility: null,
        primaryRoute: null,
        backupRoute: null,
        waterSources: [{ id: 'XFG-001', code: null, address: null, distanceKm: 0.5, usability: 'available', diameterMm: null, pressureMpa: null }],
        coverage: null,
        evidenceRefs: [],
      };
      plan.planTemplate = {
        status: 'pending_manual_review',
        tier: 'headquarters',
        tierLabel: '总队级预案模板',
        fileName: '总队灭火救援预案模板-高层建筑.pdf',
        expectedSectionCount: 10,
        buildingCategory: 'high_rise',
        knowledgeBaseId: '2086971423845441537',
        retrievalHints: [],
        sections: [],
        sectionRetrievalStatus: 'not_configured',
        sectionCountMatches: null,
        rationale: [],
        warnings: [],
        evidenceRefs: [],
      };
      const result = calculatePlanCompleteness(plan);
      expect(result).toEqual({ total: 7, ready: 7 });
    });
  });
});
