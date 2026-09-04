import { describe, expect, it } from 'vitest';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';
import { generateReferenceDocument } from '../plan-document';
import JSZip from 'jszip';

type Scenario = {
  fireType: string; floor: string; room: string; trapped: number | null; burn: number | null;
  spread: string | null; hazards: string[]; level: 'I' | 'II' | 'III' | 'IV' | 'V'; buildingName: string;
};
const LEVEL_LABEL: Record<string, string> = { I: '一级火警（F1）', II: '二级火警（F2）', III: '三级火警（F3）', IV: '四级火警（F4）', V: '五级火警（F5）' };

const SCENARIOS: Scenario[] = [
  { fireType: '电气火灾', floor: '8F', room: '808', trapped: 2, burn: 35, spread: '正在蔓延', hazards: [], level: 'III', buildingName: '五矿国际广场' },
  { fireType: '燃气火灾', floor: '12F', room: '1201', trapped: 5, burn: 80, spread: '快速蔓延', hazards: ['燃气泄漏'], level: 'IV', buildingName: '五矿国际广场' },
  { fireType: '一般火灾', floor: '3F', room: '商铺2', trapped: 1, burn: 15, spread: null, hazards: [], level: 'II', buildingName: '五矿国际广场' },
  { fireType: '锂电池火灾', floor: '20F', room: '机房1', trapped: 0, burn: 50, spread: '火势失控', hazards: ['锂电池'], level: 'I', buildingName: '五矿国际广场' },
  { fireType: '油类火灾', floor: '5F', room: '餐厅', trapped: null, burn: null, spread: '待确认', hazards: [], level: 'II', buildingName: '五矿国际广场' },
  { fireType: '电气火灾', floor: '15F', room: '1508', trapped: 9, burn: 120, spread: '正在蔓延', hazards: ['高压电'], level: 'IV', buildingName: '未建档大厦' },
];

function floorText(f: string) { return f.replace(/F$/i, '层'); }

async function buildPlan(sc: Scenario) {
  const plan = await createCompletePlan(new InMemoryPlanRepository(), `INC-${sc.fireType}-${sc.floor}`);
  plan.event = { ...plan.event, fireType: sc.fireType };
  plan.building = { name: sc.buildingName, buildingId: 'building:' + sc.buildingName };
  plan.spatialTarget = { ...plan.spatialTarget, floor: sc.floor, room: sc.room, sceneId: '477747327523254272', roomId: 'Space_' + sc.room };
  plan.incident = { ...plan.incident, trappedCount: sc.trapped, burnAreaSqm: sc.burn, spreadTrend: sc.spread, specialHazards: sc.hazards };
  plan.responseLevel = {
    ...plan.responseLevel,
    recommendation: sc.level,
    riskScore: Math.max(3, previous(sc.level)),
    matchedRules: [{ ruleId: 'RL-TEST', name: `测试规则（${sc.fireType}）`, score: 5, explanation: `依据测试规则，${sc.fireType}判定为${LEVEL_LABEL[sc.level]}。`, fieldPaths: ['trappedCount'] }],
  };
  return plan;
}
function previous(level: 'I'|'II'|'III'|'IV'|'V') { return ({ I: 8, II: 12, III: 12, IV: 18, V: 25 }[level]); }

async function extractText(buffer: Buffer): Promise<string> {
  const xml = await (await JSZip.loadAsync(buffer as unknown as Buffer)).file('word/document.xml')!.async('string');
  return xml.replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' ]').replace(/<w:tc>/g, ' [ ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

describe('reference document: multiple random fire scenarios (repeat 3x)', () => {
  for (let round = 1; round <= 3; round += 1) {
    it(`round ${round}: every scenario yields a correct structured plan matching its own data`, async () => {
      for (const sc of SCENARIOS) {
        const plan = await buildPlan(sc);
        const buffer = await generateReferenceDocument(plan);
        // valid docx zip
        const zip = await JSZip.loadAsync(buffer as unknown as Buffer);
        expect(zip.file('word/document.xml')).toBeTruthy();
        const text = await extractText(buffer);
        const label = `${sc.buildingName || '待确认'}灭火救援预案`;
        expect(text).toContain(label);                                   // title
        for (const h of ['一、三维到场态势', '二、现场态势', '三、基本情况', '四、毗邻情况', '五、功能分区', '六、火灾等级判定', '七、处置要点', '八、力量编成', '九、待核实清单']) expect(text).toContain(h);
        expect(text).toContain(sc.fireType);                              // 火灾类型
        expect(text).toContain(`${floorText(sc.floor)}${sc.room}房间`);  // 起火部位
        expect(text).toContain(LEVEL_LABEL[sc.level]);                    // 等级判定
        if (sc.trapped !== null) expect(text).toContain(`${sc.trapped}人`); // 被困人数
        if (sc.burn !== null) expect(text).toContain(`约${sc.burn}㎡`);    // 过火面积
        if (sc.hazards.length) expect(text).toContain(sc.hazards[0]);     // 爆炸风险
        if (sc.buildingName === '五矿国际广场') { expect(text).toContain('三亚五矿国际广场'); expect(text).toContain('吉高琅'); expect(text).toContain('25度阳光小区'); }
        else { expect(text).toContain('待现场核实'); }
      }
    });
  }

  it('uses the knowledge-base template sections as the authoritative chapter skeleton when present', async () => {
    const plan = await buildPlan(SCENARIOS[0]);
    plan.planTemplate = {
      ...plan.planTemplate!,
      tier: 'brigade', tierLabel: '支队级', fileName: '支队级预案模版.pdf', knowledgeBaseId: '2086971423845441537',
      sections: [
        { ordinal: 1, title: '一、火情概况' },
        { ordinal: 2, title: '二、力量编成' },
        { ordinal: 3, title: '三、风险点与待核实' },
      ],
      sectionRetrievalStatus: 'retrieved',
    };
    const buffer = await generateReferenceDocument(plan);
    const text = await extractText(buffer);
    // 章节骨架来自知识库模板章节标题
    expect(text).toContain('一、火情概况');
    expect(text).toContain('二、力量编成');
    expect(text).toContain('三、风险点与待核实');
    // 匹配到的段落内容被填入
    expect(text).toContain('队站');           // 力量编成 → 表格
    expect(text).toContain('被困');           // 火情概况 → situation
    expect(text).toContain('待核实');         // 风险点/待核实 → pending
  });
});
