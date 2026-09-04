import { describe, expect, it } from 'vitest';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';
import { renderPlanDocument } from '../plan-document';
import JSZip from 'jszip';

describe('probe: station append-mode render', () => {
  it('renders the station archive template when explicitly configured, with an appended system section', async () => {
    // 默认导出走占位符替换模板(demoTemplate)；知识库站级模板的追加模式仅在显式指定时保留。
    const original = process.env.FIRE_PLAN_TEMPLATE_PATH;
    process.env.FIRE_PLAN_TEMPLATE_PATH = ['lib', 'templates', 'station.docx'].join('/');
    try {
      const plan = await createCompletePlan(new InMemoryPlanRepository(), 'INC-STATION-PROBE');
      plan.planTemplate = {
        ...plan.planTemplate!,
        tier: 'station',
        tierLabel: '站级',
        fileName: '站级预案模版.pdf',
      };
      const rendered = await renderPlanDocument(plan);
      expect(rendered.templateSource).toBe('knowledge_base');
      expect(rendered.templateId).toBe('station-archive-template');
      const xml = await (await JSZip.loadAsync(rendered.buffer)).file('word/document.xml')!.async('string');
      expect(xml).not.toContain('三亚宝盛广场管理有限公司');
      expect(xml).toContain('测试大厦');
      expect(xml).toContain('系统生成');
      expect(xml).toContain(plan.planId);
    } finally {
      process.env.FIRE_PLAN_TEMPLATE_PATH = original;
    }
  });
});
