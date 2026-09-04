# 固定案例演示脚本

status: `REQUIRES_PREFLIGHT`
statusAsOf: `2026-09-01`

> 本脚本是现场预演步骤，不是可直接验收或离线可用声明。全新 x64 脱敏候选包已经生成并通过离线解包扫描；当前仍需轮换/吊销旧安装包中嵌入的凭据、在 Windows 实机验证新候选包，并完成真实 WebGL/SDK E2E 和三个固定案例实时回执。

## 本地展示执行前

1. 只使用已脱敏的当前源码；按 `desktop/CONFIGURATION.md` 从外部注入凭据，先在同级 `workbuddy-3d-simulation` 启动三维服务（端口 3000）。
2. 在 `fire-command-agent` 目录保持 `AGENT_RUNTIME_MODE=remote`（默认值），执行 `npm run dev`（端口 3100）。浏览器打开 `http://localhost:3100`；确认顶部显示“八维通已连接”，并在 `/api/agent/apps` 看到已发布比赛 app。
3. 本地展示清单只用于核对界面和案例输入；业务处理必须由八维通主智能体、Skill、MCP 和知识库完成。
4. 只有开发诊断时才显式设置 `$env:AGENT_RUNTIME_MODE = 'offline_demo'`。该模式不是比赛业务结果，不能用于证明远端闭环。
5. 在浏览器控制台开启日志；禁止用旧截图或旧 JSON 回执代替当前运行。

固定部署地址不是本地展示的前置条件。`deployment-address.md` 只适用于另行进行的线上发布验收。

## 三固定案例

本地展示直接在浏览器操作界面完成。需要做外部真实验收时，才设置 `FIRE_COMMAND_BASE_URL` 并运行：

```powershell
$env:FIRE_COMMAND_BASE_URL = 'https://<固定部署地址>'
node .\runtime-evidence\retest-frozen-cases.mjs
```

脚本会为三个冻结案例分别记录 `ready`、`failed` 或 `pending_manual_review`。只有非 `simulation`、非草稿、且空间/等级/力量/路线水源/11 步三维字段均有当前可追溯回执时，才允许出现 `ready`。

## 复核顺序

空间取证 -> I-V 规则建议 -> 力量候选 -> 主/备用路线与水源 -> 预案草稿 -> 人工复核 -> 11 步三维 -> Word 归档。

任一步失败都保留原始失败原因。八维通或受控业务能力失败时，显示 `failed` 或 `pending_manual_review`；不得回退为本地成功或提升为远端实时成功。
