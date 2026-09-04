import { describe, expect, it } from 'vitest';
import { inferAction } from '@/lib/agent/infer-action';
import { executeSkill } from '../server';

type EvidenceRecord = {
  receivedAt: string;
  [field: string]: unknown;
};

function advanceCollectionTimes(incident: EvidenceRecord) {
  const nextTimestamp = '2026-08-20T12:05:00.000Z';
  incident.receivedAt = nextTimestamp;
  for (const value of Object.values(incident)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const field = value as { collectedAt?: unknown; source?: { sourceId?: unknown; collectedAt?: unknown } };
    if (typeof field.collectedAt === 'string') field.collectedAt = nextTimestamp;
    if (typeof field.source?.sourceId === 'string') field.source.collectedAt = nextTimestamp;
  }
}

describe('response-level execution sealing', () => {
  it('returns the original sealed assessment when an unchanged incomplete package is submitted again', async () => {
    const firstRequest = inferAction('研判五矿国际广场8层电气火灾的Ⅰ-Ⅴ级响应，被困2人，过火面积35平方米');
    const retryRequest = structuredClone(firstRequest);
    const retryIncident = retryRequest?.input?.incident as EvidenceRecord;
    advanceCollectionTimes(retryIncident);

    const first = await executeSkill(firstRequest!);
    const retry = await executeSkill(retryRequest!);
    const firstData = first.data as { assessmentId: string; assessmentStatus: string };
    const retryData = retry.data as { assessmentId: string; assessmentStatus: string; retryBlocked?: boolean };

    expect(firstData.assessmentStatus).toBe('pending_manual_review');
    expect(retryData.assessmentId).toBe(firstData.assessmentId);
    expect(retryData.assessmentStatus).toBe('pending_manual_review');
    expect(retryData.retryBlocked).toBe(true);
  });
});
