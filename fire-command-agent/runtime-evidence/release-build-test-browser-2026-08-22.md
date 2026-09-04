# 发布验收证据汇总

> ⚠️ 历史证据（2026-08-22）：本文中的工程路径、测试数、截图路径和 sceneId `463601914351104000` 按当日记录保留，不是当前通过证明。当前正式 sceneId 为 `477747327523254272`；当前验证与阻断项以交付包 `运行说明/current-delivery-status-2026-09-01.md` 为准。

## 命令结果

| 工程 | typecheck | test | build |
| --- | --- | --- | --- |
| `fire-command-agent` | PASS | PASS，13 files / 70 tests | PASS |
| `_client_review/code-mswy4igr` | PASS | PASS，13 files / 88 tests | PASS |
| `_parallel/workbuddy-3d-simulation` | FAIL，Vitest `Assertion.not` 类型缺失 | FAIL，缺少 `@esbuild/win32-x64` | FAIL，缺少 SoonSpace plugin 依赖 |

## 浏览器证据

- 主工程桌面：`_client_review/code-mswy4igr/output/playwright/primary-desktop.png`，1280x720，生产服务器 HTTP 200，真实场景 bootstrap 返回 `463601914351104000`。
- 主工程移动端：`_client_review/code-mswy4igr/output/playwright/primary-mobile.png`，360x732，生产服务器加载，控制台无 Error；场景仍显示加载过程。
- 消防指挥工作台桌面：`fire-command-agent/output/playwright/fire-command-desktop.png`，1280x720，HTTP 200，明确显示“平台不可用”。
- 消防指挥工作台移动端：`fire-command-agent/output/playwright/fire-command-mobile.png`，390x844，明确显示“平台不可用”。

## 浏览器限制

主工程真实场景初始化过程中出现 `THREE.Color: Invalid hex color` 警告，且对象重复注册警告。截图证明页面可渲染，不证明三维动作已完成。

## 真实平台回执

`runtime-evidence/ustudio-case-receipt-CASE-20260821-USTUDIO-02.json` 证明一次已发布八维通应用的真实调用，但该回执是 8F/808 草稿，空间取证失败，未启动三维、签发或 Word 导出，不能替代三个固定案例验收。
