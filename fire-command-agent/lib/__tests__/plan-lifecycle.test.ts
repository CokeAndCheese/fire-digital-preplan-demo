import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPlan, issuePlan, PlanLifecycleError, recordSimulationVerification, reviewPlan } from '../plan-lifecycle';
import { InMemoryPlanRepository } from '../plan-orchestrator';
import { createCompletePlan } from './plan-test-fixture';

const temporaryDirectories: string[] = [];
const environmentBefore = {
  template: process.env.FIRE_PLAN_TEMPLATE_PATH,
  exports: process.env.FIRE_PLAN_EXPORT_DIR,
};

// 本文件验的是导出字段映射，不是版面。逐页视觉验收单次要 5~9s 且依赖本机装了
// LibreOffice，会把用例拖过默认超时；版面判定由 plan-document-visual.test.ts 覆盖。
process.env.FIRE_PLAN_VISUAL_CHECK = '0';

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fire-plan-lifecycle-'));
  temporaryDirectories.push(directory);
  return directory;
}

function restoreEnvironment(key: 'FIRE_PLAN_TEMPLATE_PATH' | 'FIRE_PLAN_EXPORT_DIR', value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function writeTemplate(templatePath: string) {
  const zip = new JSZip();
  const tokenLines = [
    'plan_id', 'version', 'building', 'fire_location', 'trapped_count', 'incident', 'response_level',
    'plan_template', 'force_composition', 'primary_route',
    'backup_route', 'water_sources', 'road_constraints', 'strategies',
    // 需求书 §12.1 要求的推演记录、等级依据、人员情况与审计摘要栏目
    'simulation_record', 'level_basis', 'casualty_summary', 'audit_summary',
    'evidence', 'reviewer', 'issuer', 'issued_at', 'operations_deployment',
  ].map((token) => `<w:p><w:r><w:t xml:space="preserve">${token}: {{${token}}}</w:t></w:r></w:p>`).join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${tokenLines}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  await writeFile(templatePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function prepareIssuablePlan() {
  const repository = new InMemoryPlanRepository();
  let plan = await createCompletePlan(repository, `INC-LIFECYCLE-${crypto.randomUUID()}`);
  plan = await recordSimulationVerification(plan.planId, {
    revision: plan.revision,
    verification: {
      runId: 'run-fixture', attempt: 1, status: 'completed', verifiedAt: '2026-08-21T02:00:00.000Z',
      completedStepIds: plan.simulation.mappings.map((step) => step.stepId), failedStepIds: [], detail: '11 步推演完成。',
    },
  }, repository);
  expect(plan.simulation.mappings.every((step) => step.status === 'ready' && !step.failureReason)).toBe(true);
  plan = await reviewPlan(plan.planId, { revision: plan.revision, reviewer: '复核员A', decision: 'approve', comment: '人工复核通过。' }, repository);
  return { repository, plan };
}

afterEach(async () => {
  restoreEnvironment('FIRE_PLAN_TEMPLATE_PATH', environmentBefore.template);
  restoreEnvironment('FIRE_PLAN_EXPORT_DIR', environmentBefore.exports);
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('plan lifecycle and Word export', () => {
  it('records approved and returned reviews with revisioned audit events', async () => {
    const repository = new InMemoryPlanRepository();
    const plan = await createCompletePlan(repository, 'INC-REVIEW');
    const returned = await reviewPlan(plan.planId, { revision: plan.revision, reviewer: '复核员A', decision: 'return', comment: '请补充现场信息核验。' }, repository);

    expect(returned.review).toMatchObject({ status: 'rejected', reviewer: '复核员A' });
    expect(returned.auditEvents.at(-1)).toMatchObject({ type: 'review_returned', actor: '复核员A' });
    await expect(reviewPlan(plan.planId, { revision: plan.revision, reviewer: '复核员B', decision: 'approve' }, repository)).rejects.toMatchObject({ status: 409 });
  });

  it('records a distinct review_timeout audit event when the 7s timeout auto-continues', async () => {
    const repository = new InMemoryPlanRepository();
    const plan = await createCompletePlan(repository, 'INC-TIMEOUT');
    const timed = await reviewPlan(plan.planId, { revision: plan.revision, reviewer: '系统', decision: 'approve', source: 'timeout' }, repository);

    // 超时与人工通过区分：状态仍为 approved（自动继续），但审计事件为 review_timeout。
    expect(timed.review).toMatchObject({ status: 'approved' });
    expect(timed.lifecycleStatus).toBe('approved');
    expect(timed.auditEvents.at(-1)).toMatchObject({ type: 'review_timeout' });
    expect(timed.auditEvents.at(-1)?.detail).toContain('超时');
    // 超时已推进 revision；此时人工通过需用新 revision，审计应为 review_recorded（与超时可区分）。
    const manual = await reviewPlan(plan.planId, { revision: timed.revision, reviewer: '复核员A', decision: 'approve' }, repository);
    expect(manual.auditEvents.at(-1)).toMatchObject({ type: 'review_recorded' });
  });

  it('keeps a data-gap simulation receipt (unavailable) as pending review, not failed', async () => {
    const repository = new InMemoryPlanRepository();
    let plan = await createCompletePlan(repository, 'INC-DATAGAP');
    plan = await reviewPlan(plan.planId, { revision: plan.revision, reviewer: '复核员A', decision: 'approve' }, repository);
    plan = await recordSimulationVerification(plan.planId, {
      revision: plan.revision,
      verification: {
        runId: 'run-datagap', attempt: 1, status: 'unavailable', verifiedAt: '2026-08-21T02:00:00.000Z',
        completedStepIds: plan.simulation.mappings.slice(0, 8).map((step) => step.stepId),
        failedStepIds: [], detail: '部分步骤缺少真实场景数据（路线/水源/力量），待补数据。',
      },
    }, repository);
    // 数据缺口不是失败：保持待复核，不判 failed，不进入推演完成。
    expect(plan.lifecycleStatus).toBe('pending_manual_review');
    expect(plan.simulation.status).toBe('pending_manual_review');
    expect(plan.failedItems).toHaveLength(0);
    // 已回执的 8 步 ready，未回执的 3 步待复核。
    expect(plan.simulation.mappings.slice(0, 8).every((step) => step.status === 'ready')).toBe(true);
    expect(plan.simulation.mappings.slice(8).every((step) => step.status === 'pending_manual_review')).toBe(true);
  });

  it('blocks signing when the 3D run contains a failure and leaves an auditable draft', async () => {
    const repository = new InMemoryPlanRepository();
    let plan = await createCompletePlan(repository, 'INC-FAILED-3D');
    plan = await recordSimulationVerification(plan.planId, {
      revision: plan.revision,
      verification: {
        runId: 'run-failed', attempt: 1, status: 'failed', verifiedAt: '2026-08-21T02:00:00.000Z',
        completedStepIds: plan.simulation.mappings.slice(0, 10).map((step) => step.stepId),
        failedStepIds: [plan.simulation.mappings[10]!.stepId], detail: '步骤 11 失败。',
      },
    }, repository);
    expect(plan.simulation.mappings.slice(0, 10).every((step) => step.status === 'ready')).toBe(true);
    expect(plan.simulation.mappings[10]).toMatchObject({ status: 'failed', failureReason: '步骤 11 失败。' });
    plan = await reviewPlan(plan.planId, { revision: plan.revision, reviewer: '复核员A', decision: 'approve' }, repository);
    const blocked = await issuePlan(plan.planId, { revision: plan.revision, issuer: '签发员A', permissionConfirmed: true }, repository);

    expect(blocked.issuance).toMatchObject({ status: 'blocked' });
    // 文案跟随实际步数：主库 11 步，早期 demo 库 8 步
    expect(blocked.issuance.blockReason).toContain('三维 11 步推演尚未完整通过');
    expect(blocked.auditEvents.at(-1)?.type).toBe('issuance_blocked');
  });

  it('keeps an in-progress 3D receipt pending manual review instead of marking it failed', async () => {
    const repository = new InMemoryPlanRepository();
    const plan = await createCompletePlan(repository, 'INC-IN-PROGRESS-3D');
    const updated = await recordSimulationVerification(plan.planId, {
      revision: plan.revision,
      verification: {
        runId: 'run-in-progress', attempt: 1, status: 'unavailable', verifiedAt: '2026-08-21T02:00:00.000Z',
        completedStepIds: [plan.simulation.mappings[0]!.stepId], failedStepIds: [], detail: '第 1 步已完成，推演继续执行。',
      },
    }, repository);

    expect(updated.simulation.status).toBe('pending_manual_review');
    expect(updated.simulationVerification?.status).toBe('unavailable');
    expect(updated.simulation.mappings[0]?.status).toBe('ready');
    expect(updated.simulation.mappings.slice(1).every((step) => step.status === 'pending_manual_review')).toBe(true);
  });

  it('rejects a completed 3D receipt that does not exactly identify all 8 plan steps', async () => {
    const repository = new InMemoryPlanRepository();
    const plan = await createCompletePlan(repository, 'INC-BAD-RECEIPT');
    await expect(recordSimulationVerification(plan.planId, {
      revision: plan.revision,
      verification: {
        runId: 'run-forged', attempt: 1, status: 'completed', verifiedAt: '2026-08-21T02:00:00.000Z',
        completedStepIds: Array.from({ length: 11 }, () => plan.simulation.mappings[0]!.stepId), failedStepIds: [], detail: '伪造重复回执。',
      },
    }, repository)).rejects.toBeInstanceOf(PlanLifecycleError);
  });

  it('exports an issued plan into a true docx whose fields match the plan contract', async () => {
    const directory = await temporaryDirectory();
    const templatePath = path.join(directory, 'customer-template.docx');
    const exportDirectory = path.join(directory, 'exports');
    await writeTemplate(templatePath);
    process.env.FIRE_PLAN_TEMPLATE_PATH = templatePath;
    process.env.FIRE_PLAN_EXPORT_DIR = exportDirectory;
    const { repository, plan: approved } = await prepareIssuablePlan();
    const issued = await issuePlan(approved.planId, { revision: approved.revision, issuer: '签发员A', permissionConfirmed: true }, repository);
    const exported = await exportPlan(issued.planId, issued.revision, '签发员A', repository);
    const exportedXml = await (await JSZip.loadAsync(exported.buffer)).file('word/document.xml')!.async('string');

    expect(exported.plan).toMatchObject({
      lifecycleStatus: 'issued',
      document: {
        status: 'ready', templateName: 'customer-template.docx',
        // 模板溯源：配了 FIRE_PLAN_TEMPLATE_PATH 才算知识库来源
        templateId: 'customer-template', templateSource: 'knowledge_base',
      },
    });
    // 18 项原有栏目 + 推演记录/等级依据/人员情况/审计摘要 + 作战区域部署
    expect(exported.checkedFields).toHaveLength(23);
    expect(exportedXml).toContain(issued.planId);
    expect(exportedXml).toContain('测试大厦');
    expect(exportedXml).toContain('8F');
    expect(exportedXml).toContain('2 人');
    expect(exportedXml).toContain('签发员A');
    // 作战区域部署随预案入库并导出（该测试模板用原始 token 名作标签）
    expect(exportedXml).toContain('operations_deployment');
    expect(exportedXml).toContain('车辆停放区');
    expect(exportedXml).toContain('着火层疏散路线');
    expect(exportedXml).not.toContain('{{plan_id}}');
    // 占位符必须全部被填充，不能有 {{...}} 残留
    expect(exportedXml).not.toContain('{{primary_route}}');
    expect(exportedXml).not.toContain('{{backup_route}}');
    expect(exportedXml).not.toContain('{{water_sources}}');
    expect(exportedXml).not.toContain('{{road_constraints}}');
    // 路线水源已随 11 步推演恢复，交付文档必须实际带出这些章节
    expect(exportedXml).toContain('TEST-001');
    // 主/备路线已演示填充（无真实路网时用作战区域部署的主/备路线）。
    expect(exportedXml).toContain('首层东侧消防通道（车辆停放区正对）');
    expect(exportedXml).toContain('首层西侧登高作业面（消防登高场地）');
    expect(exportedXml).toContain('口径压力未登记');
    expect(await readFile(path.join(exportDirectory, exported.fileName))).toEqual(exported.buffer);
  });

  it('uses the placeholder-replacement demo template when no customer template is configured', async () => {
    delete process.env.FIRE_PLAN_TEMPLATE_PATH;
    const { repository, plan: approved } = await prepareIssuablePlan();
    const issued = await issuePlan(approved.planId, { revision: approved.revision, issuer: '签发员A', permissionConfirmed: true }, repository);

    const exported = await exportPlan(issued.planId, issued.revision, '签发员A', repository);
    // 未配置客户模板时，默认使用占位符替换模板（demoTemplate，完整章节填充），而非知识库追加模式。
    expect(exported.templateName).toBe('local-demo-template.docx');
    expect(exported.templateSource).toBe('local_demo');
    const afterExport = await repository.get(issued.planId);
    expect(afterExport?.document).toMatchObject({ status: 'ready' });
    expect(afterExport?.auditEvents.at(-1)?.type).toBe('exported');
  });

  it('returns the export immediately with a pending visual check, then backfills it asynchronously', async () => {
    const { repository, plan: approved } = await prepareIssuablePlan();
    const issued = await issuePlan(approved.planId, { revision: approved.revision, issuer: '签发员A', permissionConfirmed: true }, repository);

    const exported = await exportPlan(issued.planId, issued.revision, '签发员A', repository);
    // 导出必须立即返回：verification.visual 先是 pending 占位，不等 LibreOffice。
    expect(exported.plan.document.verification.visual?.status).toBe('pending');
    expect(exported.plan.auditEvents.at(-1)).toMatchObject({ type: 'exported' });

    // FIRE_PLAN_VISUAL_CHECK=0（本文件顶部关闭）令后台检查立即以 not_run 收敛，
    // 轮询等它把结果异步回填到同一份 document 上。
    const generatedAt = exported.plan.document.generatedAt;
    let backfilled = await repository.get(issued.planId);
    for (let attempt = 0; attempt < 50 && backfilled?.document.verification.visual?.status === 'pending'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      backfilled = await repository.get(issued.planId);
    }

    expect(backfilled?.document.generatedAt).toBe(generatedAt);
    expect(backfilled?.document.verification.visual?.status).toBe('not_run');
    expect(backfilled?.auditEvents.at(-1)).toMatchObject({ type: 'visual_check_completed' });
    expect(backfilled?.revision).toBe(exported.plan.revision + 1);
  });
});
