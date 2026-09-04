# WorkBuddy 三维推演子系统 — 测试报告

> ⚠️ 历史测试报告：本文保留当时的 10 文件 / 98 项测试和旧 sceneId `463601914351104000`，仅供追溯，不代表 2026-09-01 当前验证。当前正式 sceneId 为 `477747327523254272`；当前源码验证为 15 文件 / 132 项、typecheck/build 通过、完整 `npm audit` 0 漏洞。

> 本报告记录三维推演子系统的测试命令、结果、已验证的 SDK 动作与未验证项。
> 回归门槛（交回前必须全部通过）：`npm run typecheck` → `npm test` → `npm run build`。

## 1. 测试命令

```powershell
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # next build
```

测试环境：`vitest` + `environment: node`；测试文件匹配 `lib/**/__tests__/**/*.test.ts`。

## 2. 依赖恢复与基线结果

- 已执行 `npm ci --include=optional`，恢复缺失的插件依赖和 `@esbuild/win32-x64`。
- 类型检查：通过。
- 既有与新增单元测试：10 个文件，共 **98** 项，全部通过。
- 生产构建：通过。

> 本子系统未用截图、mock 或旧回执替代真实结果；mock 仅用于 SDK 映射单元测试。

## 3. 新增测试

| 文件 | 覆盖内容 |
| --- | --- |
| `lib/fire-simulation/__tests__/controller.test.ts` | 状态机：加载校验、start 顺序执行、重复 start 不并发、pause/resume 不重复、next/previous、replay 复位重跑、reset/dispose 清理、单动作失败继续、SDK 未就绪进 error、非法路线坐标、多对象部分成功/失败 |
| `lib/fire-simulation/__tests__/ustudio-adapter.test.ts` | 动作→SDK 映射：fly/heighLight/show/setOpacity/setScene/polygonSetVisible/drawRoute/deleteRoute/pathMove；部分失败降级；非法 opacity 不调用；非法坐标不调用 drawRoute；SDK 未就绪；reset/rollback 清理 |
| `lib/fire-simulation/__tests__/fixtures.ts` | 合法 11 步计划与 4 种非法计划夹具 |

新增用例数量：**controller 16 项 + adapter 14 项 = 30 项**（fixtures.ts 为夹具，不计入用例）。

## 4. 已验证的 uStudio 动作（动作→SDK 映射，经 mock SDK 断言）

通过注入 mock SDK 对象，断言以下映射被正确调用、参数正确：

- `FOCUS_OBJECT` → `fly(objectId)`
- `HIGHLIGHT_OBJECT` → `heighLight(objectId, color)`（缺省使用 `highlightDefault`）
- `SHOW_OBJECTS` / `HIDE_OBJECTS` → `show` / `hide` 逐对象，部分失败记为 `degraded`
- `SET_OPACITY` → `setOpacity(id, opacity)`（非法 opacity 直接失败，不调用 SDK）
- `APPLY_LAYER` → `setScene({ buildings, stories, mode, yExtend, labels })`
- `SHOW_POLYGON` → `polygonSetVisible(polygonId, visible)`
- `SHOW_VIRTUAL_ROUTE` → `virtualRouteSetVisible(routeId, visible)`
- `DRAW_ROUTE` → `drawRoute(flatPoints, routeKey, { route_color, route_name, userData:{width} })`（坐标扁平化、非法坐标不调用）
- `CLEAR_ROUTE` → `deleteRoute(routeKey)`
- `MOVE_OBJECT` → `pathMove(objectId, flatPoints)` 并 `play()`
- 复位 / 回退：`reset()` 清理 `cancelHeighLight` / `deleteRoute` / `hide` / `show` 等本推演资源；`rollback(HIGHLIGHT_OBJECT)` 调用 `cancelHeighLight`

## 5. 未验证项（真实场景 E2E）

以下项**未在本无头测试环境运行**，需在浏览器 + 有效 `appKey` + 真实 `out_instance_id` 下由 Codex 做 E2E：

- 真实相机 `fly` 飞向起火房间（仅验证了映射调用，未验证真实镜头运动）。
- 高亮 / 透明度 / 显隐的真实渲染效果。
- 在场景 `463601914351104000` 中按真实 `out_instance_id` 隔离楼层、显示分区、绘制并清理路线。
- 切换场景或卸载页面时推演安全停止（已在控制器层用 dispose / 取消等待覆盖逻辑，未做真实浏览器卸载 E2E）。

原因：测试环境为 `node`，无 WebGL / 无 `window.__scene` / 无客户真实对象 ID；样例 JSON 中的 `objectId`/路线点为占位标识，需在固定部署环境中替换为真实值并由浏览器记录 SDK 回执。

## 6. 第 11 项真实浏览器复核

- 已保存桌面和移动端截图：`_client_review/code-mswy4igr/output/playwright/request11-desktop.png`、`request11-mobile.png`。
- 截图只证明页面可以加载和渲染，不证明真实三维动作完成。
- 真实场景加载控制台仍出现外部非法颜色：`#f953f`、`#37149`、`#d0dc8`、`#1f42f`。
- 主工程已增加 `lib/scene-color.ts` 边界校验；非法颜色会记录 `INVALID_EXTERNAL_SCENE_COLOR` 并拒绝后续动作，不会静默修正为成功。
- 真实场景仍出现对象重复注册警告；该问题尚未完成根因修复，必须作为发布阻断保留。

## 7. 发布结论

三维子系统的本地依赖、类型检查、单元测试和生产构建阻断已解除；真实 SDK / WebGL 场景 E2E 仍未完成。因此本报告支持“代码可重复构建”，不支持“真实三维发布通过”。

## 8. 回归结果（实际输出）

```
$ npm run typecheck
> tsc --noEmit
（无错误输出，退出码 0）

$ npm test
Test Files  10 passed (10)
Tests       98 passed (98)   全部通过

$ npm run build
> next build
▲ Next.js 16.2.10 (Turbopack)
✓ Compiled successfully in 9.1s
✓ Running TypeScript（Finished in 3.3s）
✓ Generating static pages (5/5)
Route (app): / , /_not-found , /api/ustudio/* , /simulation-lab , /uagent-service/api/agent/v1/apps/agent-chat
```

- **typecheck**：通过（0 错误）。
- **test**：10 个测试文件全部通过，合计 **98** 项用例；新增 controller/adapter 用例均通过，未以截图或旧回执替代真实结果。
- **build**：通过，生产构建成功，`/simulation-lab` 页面成功生成。

> 命令运行于独立工作目录 `...\ni\_parallel\workbuddy-3d-simulation`，未触碰 `_client_review/code-mswy4igr` 中 Codex 负责的既有业务文件。

详见交付目录 `workbuddy-delivery/test-output.txt`。
