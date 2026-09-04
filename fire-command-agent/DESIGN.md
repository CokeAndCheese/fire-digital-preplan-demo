# DESIGN.md — 三亚消防指挥智能体

> AI 可读的设计系统规范（基于 awesome-design-md 9 章节标准）。
> 本文件定义「战术指挥中枢 / Tactical Command Center」暗色设计语言，供 Cursor、Claude Code、WorkBuddy 等 AI 编程代理直接消费。
> 所有样式实现位于 `app/globals.css`，组件逻辑不改、仅样式层生效。

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

- **设计哲学**：把「消防指挥总控台」做成一台沉稳、可信、带科技辉光的指挥大屏。信息密度高但不拥挤，关键状态（火情 / 在线 / 审批）一眼可辨。
- **视觉基调**：暗色大屏、毛玻璃质感、低饱和冷调底 + 双主色辉光。
- **核心视觉特征关键词**：`tactical`（战术感）、`glassmorphism`（毛玻璃）、`glow`（辉光层级）、`dense-but-calm`（高密度·平静）、`mission-critical`（关键任务级可信度）。
- **光影与质感倾向**：
  - 背景为分层径向光晕（右上青色科技光 + 左下红色警戒光）+ 极弱 46px 网格底纹。
  - 顶栏 / 侧栏 / 面板采用半透明 + `backdrop-filter: blur()` 毛玻璃，使光晕透出。
  - 强调交互使用彩色辉光阴影（青 / 红 / 琥珀 / 蓝），而非纯黑投影。

---

## 2. Color Palette & Roles（调色板与角色）

> 所有颜色同时给出 HEX 与 CSS 变量名，组件 CSS 一律引用变量。

| 角色 | 变量名 | HEX / rgba | 使用场景 |
|------|--------|------------|----------|
| Background base | `--bg` | `#070a0d` | 应用最底层背景（指挥大屏底色） |
| Background layer | `--bg-2` | `#0a0f13` | 次级背景 |
| Surface 1 | `--surface` | `#0e1418` | 卡片、气泡、聊天气泡底色 |
| Surface 2 | `--surface-2` | `#131c22` | 悬浮态、次级表面 |
| Surface 3 | `--surface-3` | `#18232b` | 激活态、强表面 |
| Line | `--line` | `#233039` | 默认分隔线 / 边框 |
| Line soft | `--line-soft` | `#1b262d` | 极弱分隔 |
| Line strong | `--line-strong` | `#33424b` | 输入、聚焦边框 |
| Text | `--text` | `#eef3f4` | 正文 |
| Text strong | `--text-strong` | `#ffffff` | 标题、强调文字 |
| Muted | `--muted` | `#94a2a9` | 次要文字 |
| Faint | `--faint` | `#5f6e75` | 标签、辅助说明 |
| **Brand · Alert Red** | `--red` | `#ff5b60` | 品牌色 / 火情 / 关键告警 |
| Red bright | `--red-bright` | `#ff8084` | 红色高亮态 |
| Red soft | `--red-soft` | `#2a1518` | 红色弱底（告警区） |
| Red glow | `--red-glow` | `rgba(255,91,96,0.40)` | 红色辉光阴影 |
| **Accent · Tactical Teal** | `--teal` | `#2fd4bf` | 主交互 / 战术青 |
| Teal bright | `--teal-bright` | `#5fe6d4` | 青色高亮态 |
| Teal soft | `--teal-soft` | `#0f2e2b` | 青色弱底 |
| Teal glow | `--teal-glow` | `rgba(47,212,191,0.42)` | 青色辉光阴影 |
| Amber | `--amber` | `#f0b34a` | 等待 / 待审批 |
| Amber soft | `--amber-soft` | `#2b2313` | 琥珀弱底 |
| Amber glow | `--amber-glow` | `rgba(240,179,74,0.38)` | 琥珀辉光 |
| Blue | `--blue` | `#5aa9e6` | 运行中 / 进行态 |
| Blue soft | `--blue-soft` | `#12293c` | 蓝色弱底 |
| Blue glow | `--blue-glow` | `rgba(90,169,230,0.40)` | 蓝色辉光 |

**语义色速查**：`online/done → teal`；`running → blue`；`waiting/standby → amber`；`error/offline → red`。

---

## 3. Typography Rules（排版规则）

- **Font Family**：`"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, -apple-system, sans-serif`
  - 拉丁字符 / 数字优先 Inter（等宽数字用 `font-variant-numeric: tabular-nums`），中文回退 PingFang / 微软雅黑。
  - 代码 / 参数：`Consolas, monospace`。
- **设计哲学**：标题用偏重字重 + 微字距营造权威感；标签（CORE SKILLS / EXECUTION TRACE 等）全大写、`letter-spacing: 1px`；数据数字启用等宽以保证对齐。

| 层级 | 字号 | 字重 | 行高 | 字距 | 用途 |
|------|------|------|------|------|------|
| Display Hero | 28px | 700 | 1.1 | 0.2px | 欢迎页大标题（渐变描边） |
| H2 Section | 20–21px | 700 | 1.2 | 0.2px | 工作区标题 |
| H1 Product | 16px | 700 | 1.3 | 0.2px | 顶栏产品名 |
| H3 | 13px | 650 | 1.4 | 0 | 面板标题 |
| Body | 12px | 400 | 1.65 | 0 | 正文 / 气泡 |
| Small | 10–11px | 600 | 1.5 | 0.2px | 列表项 / 元数据 |
| Nano / Label | 8–9px | 700 | 1 | 1px | 全大写标签 |
| Mono | 9px | 400 | 1.5 | 0 | 工具名 / 参数 |

---

## 4. Component Stylings（组件样式）

### Buttons
- **Primary / 发送**：`background: linear-gradient(135deg, var(--teal), #1f9e8f)`；`box-shadow: 0 6px 16px rgba(47,212,191,0.32)`；hover 提亮 + `translateY(-1px)`。
- **Workspace Primary**：青色渐变 + `var(--shadow-glow-teal)`。
- **Workspace Secondary**：`--surface-2` 底 + `--line` 边框，hover 提亮。
- **Ghost**：透明底 + `--line-strong` 边框。
- **Approve**：`--teal-soft` 底 + 青色边框，hover 辉光。
- 圆角：`--radius`（9px）或 `--radius-sm`（6px）；最小触控高度 ≥ 31px。

### Cards / Panels
- 圆角 `--radius-lg`（14px）；`border: 1px solid var(--line)`；`background: rgba(17,23,26,0.7)` + `backdrop-filter: blur(10px)`；`box-shadow: var(--shadow-2)`。
- hover 抬升：`translateY(-2px)` + `var(--shadow-3)`。
- Header 用 `rgba(255,255,255,0.015)` 顶高光分隔。

### Inputs / Composer
- 输入框透明底、无边框，placeholder `#65737a`。
- `.composer`：`border-radius: 14px`，聚焦时 `border-color: rgba(47,212,191,0.7)` + `box-shadow: 0 0 0 3px rgba(47,212,191,0.12)`。

### Navigation（Rail）
- 宽 76px，毛玻璃；激活态：`linear-gradient(90deg, rgba(255,91,96,0.18), transparent)` + `inset 3px 0 var(--red)` + 红色辉光。

### Badges / Tags / Status
- 圆角 `--radius-sm`；语义色边框 + 弱底；`done/online → teal`，`running → blue`，`waiting → amber`，`error → red`。
- 状态点（`status-dot--online`）带辉光 + `glow-soft` 脉冲动画。

### Modals / Dialogs
- 移动端抽屉：`transform: translateX()` + `box-shadow` + `backdrop-filter`，`transition: transform 0.18s ease`。
- 遮罩 `.mobile-backdrop`：`rgba(0,0,0,0.48)` + `blur(2px)`。

---

## 5. Layout Principles（布局原则）

- **Spacing System**：以 4px 为基准（4 / 8 / 12 / 16 / 22 / 30）。面板内边距 12–14px，区块间距 16–18px。
- **Grid System**：主区 `grid-template-columns: 280px minmax(440px,1fr) 300px`（技能面板 / 对话 / 执行记录）。
- **Container**：`max-width` 不强制，对话与欢迎区用 `min(760px, 100%)` 居中。
- **留白哲学**：指挥台信息密集，但用细线（1px）与半透明分层制造呼吸感，避免纯黑块堆叠。

---

## 6. Depth & Elevation（深度与层级）

**Shadow System**
```
--shadow-1: 0 1px 2px rgba(0,0,0,0.45);
--shadow-2: 0 6px 18px rgba(0,0,0,0.5);
--shadow-3: 0 18px 48px rgba(0,0,0,0.58);
--shadow-glow-teal: 0 0 0 1px rgba(47,212,191,0.16), 0 10px 30px rgba(47,212,191,0.10);
--shadow-glow-red:  0 0 0 1px rgba(255,91,96,0.18), 0 10px 30px rgba(255,91,96,0.12);
```

**Surface Layers**（从底到顶）：`--bg`（大屏底）→ `rgba` 毛玻璃面板 → `--surface` 卡片 → 辉光聚焦层 → 移动端抽屉 / 遮罩（z-index 35–45）。

**Z-index Scale**：rail `20`；mobile-nav `45`；activity/skills 抽屉 `40`；backdrop `35`；composer `3`。

**Backdrop Effects**：`backdrop-filter: blur(8–16px)`，配合半透明 `rgba` 表面让背景光晕透出。

---

## 7. Do's and Don'ts（设计规范与禁忌）

**Do's**
1. 用 CSS 变量（`--teal` / `--red` / `--surface` 等），禁止写死散落色值。
2. 状态传达遵循语义色速查（teal/blue/amber/red）。
3. 交互元素加 `transition`（`--ease` 缓动），hover 用 `-1px` 轻微抬升 + 辉光。
4. 面板 / 卡片用毛玻璃 + 分层阴影建立纵深。
5. 数字与时间戳启用 `tabular-nums` 对齐。
6. 标签（label）全大写 + `letter-spacing: 1px`。

**Don'ts**
1. 不要使用纯白大面积背景或高饱和刺眼色（破坏指挥大屏沉稳感）。
2. 不要去掉 `backdrop-filter` 毛玻璃（会丢失氛围层次）。
3. 不要把圆角拉到 >16px 或回到 0（破坏统一语言）。
4. 不要用纯黑 `#000` 投影替代辉光阴影。
5. 不要在非告警区滥用红色（红色仅用于品牌 / 火情 / 错误）。
6. 不要破坏 `app/globals.css` 中的类名（组件依赖它们）。

---

## 8. Responsive Behavior（响应式行为）

| Breakpoint | 行为 |
|------------|------|
| `> 1180px` | 三栏完整布局（280 / 1fr / 300） |
| `≤ 1180px` | 收窄栏宽、隐藏摘要与 active-agent、registry/skill 网格降列 |
| `≤ 960px` | 执行记录面板变右侧抽屉；遮罩模糊 |
| `≤ 720px` | 隐藏左侧 rail，启用 mobile-nav 抽屉；主区单栏；技能面板变左侧抽屉 |
| `≤ 420px` | 流程条紧凑、参数网格单列、部分标签隐藏 |

- **Touch Targets**：按钮 / 列表项最小高度 ≥ 31–36px。
- **折叠策略**：左 rail → 顶部汉堡菜单；技能 / 记录面板 → 滑出抽屉 + 遮罩。
- **Font Scaling**：标题随断点从 28px → 21px → 18px 收敛；正文保持 12px。

---

## 9. Agent Prompt Guide（AI 代理提示指南）

### Quick Reference
- 改样式只动 `app/globals.css`，**不要改组件 `className`**。
- 所有颜色用 `:root` 变量；新颜色先加变量再加规则。
- 风格锚点：暗色 + 毛玻璃 + 青(主)/红(品牌)双辉光。
- 动效缓动统一 `--ease: cubic-bezier(0.22,1,0.36,1)`。

### Component Prompts（可直接复制）
1. `给 .skill-row 增加 hover 时左侧 3px teal 指示条与轻微右移，使用 --ease 缓动`
2. `把 .workspace-metrics 数字改为青色渐变描边文字，保持 tabular-nums`
3. `为 .execution-monitor 增加顶部 1px teal→transparent 渐变分隔线`
4. `让 .closure-stage--running 的图标持续 2s 脉冲辉光`
5. `新增一个 .panel-card 基类：radius-lg + surface 毛玻璃 + shadow-2，供新卡片复用`
6. `把所有 .status-dot 改为带辉光 + glow-soft 脉冲`

### Iteration Guide（迭代建议）
1. 先定变量，再写规则；一次只调一个维度的视觉（色 / 距 / 阴影）。
2. 改动后用 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/` 确认 dev 服务未崩（HTTP 200）。
3. 每次大改后用括号平衡检查避免 CSS 语法错误。
4. 保持移动端三档断点（960 / 720 / 420）的抽屉与折叠逻辑不被破坏。
5. 辉光阴影统一用 `--shadow-glow-*`，不要散写 `box-shadow` 颜色。
6. 新增组件请复用既有 token（间距 / 圆角 / 阴影），不要引入新数值体系。
7. 验证可读性：对话气泡底色与文字对比度需 ≥ 4.5:1。
8. 动效时长控制在 0.15–0.28s，过慢会显得拖沓（指挥场景）。
9. 优先用 `prefers-reduced-motion` 关闭非必要动画。
