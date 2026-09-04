# 八维通远端运行时回执

## 运行定位

- 本地入口：`http://localhost:3100`
- 业务端：八维通 uStudio 已发布比赛智能体
- 本地程序职责：界面、服务端代理、流式过程展示、人工复核和审计
- 禁止行为：在 remote 模式用本地编排器、固定文案、截图或旧回执补成业务成功

## 已验证事实

- `GET /api/agent/apps` 在 `AGENT_RUNTIME_MODE=remote` 下返回冻结的八维通比赛 app，运行状态 `ready`。
- 发布 app、版本哈希、Skill/MCP/知识库绑定和三个已发布子智能体均通过清单核验。
- 知识库详情接口对服务端凭证存在权限限制；已发布配置与认证控制台证据仍保留，状态显示为“已连接；知识库详情读取权限受限”。
- `POST /api/agent/chat` 返回真实 SSE；远端事件中观察到 `MultiAgent`、知识库问答 Skill、`getSkillDetail` 等远端调用。
- 远端火情测试只要求生成草稿，不签发、不启动三维推演；返回内容保持八维通过程和人工复核边界。
- remote 模式下 `/api/skills/execute` 明确拒绝本地 Skill 直执行；正式业务统一通过 `/api/agent/chat` 进入八维通主智能体。该入口只保留给显式 `offline_demo` 诊断。

## 证据文件

- `ustudio-competition-binding-manifest.json`
- `ustudio-runtime-audit-2026-08-21.json`
- `ustudio-case-receipt-CASE-20260821-USTUDIO-02.json`
- `remote-runtime-check.json`

凭证、Token、Authorization 和完整请求头不写入回执。
