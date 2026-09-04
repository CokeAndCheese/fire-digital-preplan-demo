import { describe, expect, it } from 'vitest';
import {
  assessResponseLevel,
  type EvidenceStatus,
  type IncidentEvidence,
  type IncidentEvidenceField,
  RESPONSE_RULE_VERSION,
} from '../response-level-rules';
import scenarioCases from '../../../../baseline/scenario-cases.json';

const COLLECTED_AT = '2026-08-20T12:00:00.000Z';
const SOURCE = { sourceId: 'dispatch-INC-TEST', sourceType: 'dispatch_system' as const, collectedAt: COLLECTED_AT };

function field(
  value: unknown,
  status: EvidenceStatus = 'reported',
  overrides: Partial<IncidentEvidenceField> = {},
): IncidentEvidenceField {
  const observed = status !== 'missing';
  return {
    value: observed ? value : null,
    status,
    source: observed ? SOURCE : { sourceId: null, sourceType: 'not_collected', collectedAt: null },
    confidence: observed ? 0.9 : 0,
    collectedAt: observed ? COLLECTED_AT : null,
    manuallyConfirmed: false,
    ...overrides,
  };
}

function completeIncident(overrides: Partial<IncidentEvidence> = {}): IncidentEvidence {
  return {
    incidentId: 'INC-EVIDENCE-001',
    receivedAt: COLLECTED_AT,
    building: field('五矿国际广场'),
    floor: field('14F'),
    room: field('808'),
    firePartition: field('FP-08-A'),
    venueType: field('高层公共建筑'),
    fireMaterialOrType: field('电气火灾'),
    burnAreaSqm: field(10),
    spreadTrend: field('已控制'),
    trappedCount: field(0),
    casualtyCount: field(0),
    missingPersonCount: field(0),
    specialHazards: field([], 'not_observed'),
    facilityStatus: field('正常'),
    weatherConstraints: field([], 'not_observed'),
    roadConstraints: field([], 'not_observed'),
    ...overrides,
  };
}

describe('assessResponseLevel', () => {
  it('returns stable, explainable results for three fixed evidence packages', () => {
    const cases = [
      { incident: completeIncident(), level: 'Ⅴ级响应建议' },
      { incident: completeIncident({ floor: field('15F') }), level: 'Ⅳ级响应建议' },
      { incident: completeIncident({ burnAreaSqm: field(30), trappedCount: field(4) }), level: 'Ⅱ级响应建议' },
    ];

    for (const testCase of cases) {
      const first = assessResponseLevel({ incident: testCase.incident });
      const second = assessResponseLevel({ incident: testCase.incident });

      expect(second).toEqual(first);
      expect(first.ruleVersion).toBe(RESPONSE_RULE_VERSION);
      expect(first.assessmentStatus).toBe('recommended');
      expect(first.recommendedLevel).toBe(testCase.level);
      expect(first.officialIssuedLevel).toBeNull();
      expect(first.officialIssuanceStatus).toBe('not_issued');
      expect(first.reviewRequired).toBe(true);
      expect(first.calculationItems.length).toBeGreaterThanOrEqual(0);
      expect(first.evidence).toHaveLength(15);
    }
  });

  it('changes the recommendation from verified floor, area, trapped-person, and hazard evidence', () => {
    const baseline = assessResponseLevel({ incident: completeIncident() });
    const higherFloor = assessResponseLevel({ incident: completeIncident({ floor: field('15F') }) });
    const largerArea = assessResponseLevel({ incident: completeIncident({ burnAreaSqm: field(30) }) });
    const moreTrapped = assessResponseLevel({ incident: completeIncident({ trappedCount: field(4) }) });
    const majorHazard = assessResponseLevel({ incident: completeIncident({
      specialHazards: field(['危化品']),
      spreadTrend: field('快速蔓延'),
    }) });

    expect(baseline).toMatchObject({ recommendedLevel: 'Ⅴ级响应建议', riskScore: 1 });
    expect(higherFloor).toMatchObject({ recommendedLevel: 'Ⅳ级响应建议', riskScore: 3 });
    expect(largerArea).toMatchObject({ recommendedLevel: 'Ⅳ级响应建议', riskScore: 3 });
    expect(moreTrapped.recommendedLevel).toBe('Ⅱ级响应建议');
    expect(majorHazard.recommendedLevel).toBe('Ⅱ级响应建议');
  });

  it('stops at manual review for missing or conflicting evidence and retains conflict details', () => {
    const missing = assessResponseLevel({ incident: completeIncident({ venueType: field(null, 'missing') }) });
    const conflict = assessResponseLevel({ incident: completeIncident({
      burnAreaSqm: field(35, 'conflict', { conflicts: [{ value: 20, sourceId: 'scene-model-01' }] }),
    }) });

    expect(missing).toMatchObject({
      assessmentStatus: 'pending_manual_review',
      recommendedLevel: null,
      riskScore: null,
      retryPolicy: 'sealed_pending_human_evidence',
    });
    expect(missing.missingEvidence).toContain('场所类型');
    expect(conflict).toMatchObject({
      assessmentStatus: 'pending_manual_review',
      recommendedLevel: null,
      retryPolicy: 'sealed_pending_human_evidence',
    });
    expect(conflict.conflictFields).toContain('过火面积');
    expect(conflict.evidence.find((item) => item.field === 'burnAreaSqm')?.conflicts)
      .toEqual([{ value: 20, sourceId: 'scene-model-01' }]);
  });

  it('keeps every frozen case target pending until the formal competition table exists', () => {
    expect(scenarioCases.scenario_policy.status).toBe('frozen_demo_cases_with_pending_business_targets');
    expect(scenarioCases.demo_cases).toHaveLength(3);
    for (const demoCase of scenarioCases.demo_cases) {
      expect(demoCase.expected_response_level).toMatchObject({
        target_band: null,
        status: 'pending_manual_review',
        formal_rule_evidence: null,
      });
      expect(demoCase.expected_response_level.provisional_target_band).toMatch(/^[I-V]+-[I-V]+$/);
      expect(demoCase.expected_response_level.reason).toContain('不得与规则建议或正式签发混用');
    }
  });

  it('preserves I-V threshold direction at the rule boundary', () => {
    const levelV = assessResponseLevel({ incident: completeIncident({ burnAreaSqm: field(0) }) });
    const levelIV = assessResponseLevel({ incident: completeIncident({ floor: field('15F'), burnAreaSqm: field(10) }) });
    const levelIII = assessResponseLevel({ incident: completeIncident({ burnAreaSqm: field(30), spreadTrend: field('蔓延') }) });
    const levelII = assessResponseLevel({ incident: completeIncident({ trappedCount: field(4) }) });
    const levelI = assessResponseLevel({ incident: completeIncident({ casualtyCount: field(1) }) });

    expect(levelV.recommendedLevelCode).toBe('V');
    expect(levelIV.recommendedLevelCode).toBe('IV');
    expect(levelIII.recommendedLevelCode).toBe('III');
    expect(levelII.recommendedLevelCode).toBe('II');
    expect(levelI.recommendedLevelCode).toBe('I');
    expect([levelV, levelIV, levelIII, levelII, levelI].every((item) => item.reviewRequired)).toBe(true);
  });
});
