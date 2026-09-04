import { describe, expect, it } from 'vitest';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';
import { renderPlanDocument } from '../plan-document';
import JSZip from 'jszip';

describe('end to end template', () => {
  it('carries the template block into the plan and the document', async () => {
    const plan = await createCompletePlan(new InMemoryPlanRepository(), 'INC-VERIFY');
    expect(plan.planTemplate?.tier).toBe('battalion');
    expect(plan.planTemplate?.fileName).toBe('大队级预案模板.pdf');
    expect(plan.planTemplate?.sections).toEqual([]);
    expect(plan.planTemplate?.sectionRetrievalStatus).toBe('not_configured');
    expect(plan.missingItems).toEqual([]);
    const rendered = await renderPlanDocument(plan);
    const xml = await (await JSZip.loadAsync(rendered.buffer)).file('word/document.xml')!.async('string');
    expect(xml).toContain('编制层级与模板');
    expect(xml).toContain('大队级模板');
    expect(xml).toContain('知识库');
  });
});
