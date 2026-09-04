# 知识库集成接口

预案模板选取（Task 3）已完成映射逻辑并正确集成到预案编排器和文档导出。
本文档描述最后一块缺失部分：从知识库实际检索 PDF 内容。

## 已完成部分

- 响应等级（Ⅰ-Ⅴ）→ 编制机构层级（站/大队/支队/总队）映射逻辑
- 总队级模板的建筑类型二次匹配（高层/地下/商业综合体）
- 预案 contract 新增 `planTemplate` 字段并通过验证
- 预案编排器在生成预案时计算 `planTemplateData`
- Word 导出包含 `{{plan_template}}` 占位符并渲染层级摘要
- 全部 127 测试通过，154 份存储预案契约合规

## 缺失部分：PDF 检索与章节校验

### 数据源

- **知识库应用 ID**：`2086971423845441537`（消防预案库）
- **文件总数**：36 个文件
- **模板 PDF 文件名**：
  - `站级预案模版.pdf`（6 章）
  - `大队级预案模板.pdf`（8 章）
  - `支队级预案模版.pdf`（10 章）
  - `总队级高层建筑火灾跨区域灭火救援预案模版.pdf`（10 章）
  - `总队级地下建筑火灾跨区域灭火救援预案模版.pdf`（10 章）
  - `总队级大型城市商业综合体火灾跨区域灭火救援预案模版.pdf`（10 章）

### 检索线索（`retrievalHints`）

由 `selectPlanTemplate()` 返回：

```typescript
retrievalHints: [
  template.fileName,          // "支队级预案模版.pdf"
  `${template.tierLabel}预案`,  // "支队级预案"
  `${template.tierLabel}预案模板章节`,
]
```

### 预期章节结构

每个层级的章节数记录在 `expectedSectionCount`：

- 站级：6 章（单位概况/处置力量/社会联动/特别警示/安全事项/图纸附件）
- 大队级：8 章
- 支队级：10 章（增加组织架构/专家库/通信方式/战勤保障）
- 总队级：≥10 章（跨区域调派，章节不少于支队级）

### 实施建议

1. **使用 MCP file_search 工具**  
   知识库检索需要通过 claude.ai 登录授权。若本项目运行环境不支持交互式认证，
   应改为调用平台提供的知识库 HTTP API（假设存在）。

2. **章节提取**  
   从 PDF 提取章节标题与正文。校验章节数是否匹配 `expectedSectionCount`。
   若不匹配，在预案中记入 `warnings`。

3. **内容填充**  
   将提取的章节内容填入预案的 `strategies` 字段或新增 `sections` 字段。
   保持原章节顺序，每个章节记录标题、内容、页码。

4. **证据引用**  
   为检索到的模板生成 `PlanEvidenceReference`，追加到 `evidenceRefs`，
   并在 `planTemplate.evidenceRefs` 中记录引用 ID。

5. **失败处理**  
   若检索失败（网络错误、文件不存在、解析失败），预案的 `planTemplate.status`
   应保持为 `unresolved`，并在 `warnings` 中写明失败原因。

## 集成位置

最自然的位置是在 `lib/plan-orchestrator.ts` 的 `planTemplateBlock()` 函数中，
在调用 `selectPlanTemplate()` 后立即检索 PDF：

```typescript
function planTemplateBlock(input, responseLevel, evidenceRefs) {
  const selection = selectPlanTemplate({...});
  
  if (selection.template) {
    const pdfContent = await retrieveTemplateFromKB(
      selection.knowledgeBaseId,
      selection.retrievalHints,
    );
    if (pdfContent) {
      validateSectionCount(pdfContent.sections, selection.template.expectedSectionCount);
      // 填充到预案，生成证据引用
    }
  }
  
  return { status, tier, ..., evidenceRefs };
}
```

然而 `orchestratePlan()` 是异步函数，`planTemplateBlock()` 目前是同步的。
若要异步，需修改调用栈。备选方案是将检索作为独立 Skill 调用，与其他 Skill 并列。

## 当前状态总结

模板选取已正式入编排流程，每份新预案会记录其参照的模板层级与文件名，
并在 Word 导出时呈现给复核员。但模板 PDF 的实际内容尚未检索，
章节结构校验和内容填充尚未实现。

若知识库 API 已就绪，可依照上述建议完成 Task 3。
