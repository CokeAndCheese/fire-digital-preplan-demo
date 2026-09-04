# 三维推演子系统 — 接口与契约说明（WorkBuddy）

本文件说明 WorkBuddy 负责的三维推演子系统对外的输入契约、动作类型、事件协议、状态机流与接入示例。
该子系统**只负责把一份结构化 `SimulationPlan` 翻译为八维通 uStudio 场景的真实动作并逐步记录结果**，
不负责 I-V 级判定、AI 编排、力量调派算法、最短路径计算、预案持久化与 Word 导出（由 Codex 负责）。

所有类型均位于 `lib/fire-simulation/contracts.ts`，公共 API 从 `lib/fire-simulation/index.ts` 导出。

---

## 1. 输入契约 `SimulationPlan`（冻结字段，不可删除 / 改名 / 改语义）

```ts
export type SimulationPlan = {
  contractVersion: '1.0';      // 仅接受 '1.0'，否则拒绝加载
  eventId: string;             // 事件编号，缺失则拒绝加载
  sceneId: string;             // uStudio 场景 ID
  title: string;
  createdAt: string;           // ISO 时间
  steps: SimulationStep[];     // 正常 11 步，order 1..11 且唯一
  colors?: Partial<Record<SimulationColorRole, string>>; // 可选：覆盖默认颜色
};
```

```ts
export type SimulationStep = {
  id: string;
  order: number;
  code: SimulationStepCode;    // 见下表 11 种
  title: string;
  description: string;
  durationMs?: number;         // 自动播放时该步停留时长（可取消）
  actions: SimulationAction[];
};
```

### 11 步业务码

| order | code | 业务含义 | 典型表现 |
| ---: | --- | --- | --- |
| 1 | ALARM_RECEIVED | 接收火情 | 显示事件编号与输入摘要（不伪造三维动作） |
| 2 | LOCATE_FIRE_ROOM | 锁定起火房间 | 镜头飞向、起火房间高亮 |
| 3 | ISOLATE_STORY_ZONE | 隔离楼层 / 分区 | APPLY_LAYER 隔离楼层、显示分区多边形 |
| 4 | ANALYZE_SPREAD | 相邻空间与蔓延 | 高亮相邻空间、门、竖井、风险方向 |
| 5 | SELECT_STAGING_ENTRY | 停车点 / 入口 | 聚焦停车点、建筑入口 |
| 6 | SELECT_WATER_SOURCE | 灭火水源 | 高亮消火栓 / 水泵接合器 / 室内栓 |
| 7 | DRAW_PRIMARY_ROUTE | 主进攻路线 | 绘制真实主路线 |
| 8 | DRAW_BACKUP_ROUTE | 疏散 / 备用路线 | 不同颜色绘制疏散与备用路线 |
| 9 | SHOW_FORCE_DEPLOYMENT | 力量部署 | 显示消防站 / 车辆 / 人员对象（无模型返回降级） |
| 10 | PLAY_TIMELINE | 时间轴同步推演 | 按步骤同步镜头、对象、路线与文字 |
| 11 | REVIEW_SIGN_EXPORT | 复核签发导出 | 显示完成状态（签发 / Word 由 Codex 负责） |

---

## 2. 动作类型 `SimulationAction`（17 种）

| 类型 | 关键字段 | 映射到 uStudio SDK |
| --- | --- | --- |
| FOCUS_OBJECT | objectId | `fly(id)` |
| HIGHLIGHT_OBJECT | objectId, color? | `heighLight(id, color)`（注意 SDK 真实拼写为 `heighLight`） |
| CLEAR_HIGHLIGHT | objectId | `cancelHeighLight(id)` |
| SHOW_OBJECTS | objectIds: string[] | `show(id)` 逐个；部分失败降级 |
| HIDE_OBJECTS | objectIds: string[] | `hide(id)` 逐个 |
| SET_OPACITY | objectIds, opacity(0~1) | `setOpacity(id, opacity)` |
| RESET_OPACITY | objectIds | `unSetOpacity(id)` |
| APPLY_LAYER | buildings?, stories?, mode?, yExtend?, labels? | `setScene(params)` |
| SHOW_POLYGON | polygonId, visible | `polygonSetVisible(id, visible)` |
| SHOW_VIRTUAL_ROUTE | routeId, visible | `virtualRouteSetVisible(id, visible)` |
| DRAW_ROUTE | routeKey, points: Point3[], color?, width? | `drawRoute(flatPoints, routeKey, { route_color, route_name, userData:{width} })` |
| CLEAR_ROUTE | routeKey | `deleteRoute(routeKey)` |
| MOVE_OBJECT | objectId, points, durationMs? | `pathMove(id, flatPoints)` 并 `play()` |
| RESTORE_OBJECT | objectId | `pathRestore(id)` |
| DATA_GAP | reason | 说明性动作，状态记为 `degraded`（`SDK_ACTION_FAILED`）；用于"该步骤真实场景数据未就绪"的如实降级，绝不冒充已绘制/已展示 |
| WAIT | durationMs | 控制器内可取消等待（不调用 SDK） |
| NOTE | text | 说明动作，状态记为 `skipped`，不可替代真实场景动作 |

- `objectId` 必须是 uStudio 可执行的真实 `out_instance_id`。
- `routeKey` 是本推演内部唯一标识（非中文路线名）；绘制时直接作为 SDK `routeId`。
- 多对象动作（SHOW/HIDE/SET/RESET）逐个记录成败；单个对象失败不影响其他对象，整体记为 `degraded`，全部失败记为 `failed`。
- 非法路线坐标（点数 < 2 或含非有限数）**不调用 SDK**，返回 `INVALID_ROUTE`。

---

## 3. 动作执行结果 `SimulationActionResult`

```ts
export type SimulationActionStatus = 'pending' | 'running' | 'success' | 'skipped' | 'degraded' | 'failed';

export type SimulationActionResult = {
  stepId: string;
  actionIndex: number;
  actionType: SimulationAction['type'];
  status: SimulationActionStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  message?: string;
  errorCode?: string;        // SDK_NOT_READY / OBJECT_NOT_FOUND / INVALID_ROUTE / ACTION_UNSUPPORTED / SDK_ACTION_FAILED ...
  details?: SimulationActionObjectDetail[]; // 多对象动作逐个成败明细
};
```

**失败不伪装成功**：每个动作都有可观察结果；单动作失败默认 `degraded`/`failed` 后继续当前步骤的安全动作；
只有 `SDK_NOT_READY`、计划不合法等系统性错误才进入全局 `error`。

---

## 4. 控制器状态机 `SimulationControllerState`

`idle → running → paused → running → ... → completed`，以及 `resetting` / `error`。

| 方法 | 语义 |
| --- | --- |
| load(plan) | 同步校验并加载；非法计划抛出 `SimulationContractError`。不触发任何三维动作。 |
| start() | 全新或继续自动播放；重复点击不会并发；SDK 未就绪进入 `error`。 |
| pause() | 在当前原子动作完成后暂停（不中断一半）。 |
| resume() | 从未完成动作继续，不重复已成功动作。 |
| next() | 手动执行下一步（只执行下一步）。 |
| previous() | 回退当前步可逆动作，再定位到上一步。 |
| replay() | 先完整复位，再从头执行。 |
| reset() | 清理高亮、透明度、路线、对象移动与临时显隐；不留残留。 |
| dispose() | 停止计时器、清理监听与场景临时状态。 |

---

## 5. 浏览器事件协议（外部控制 / 订阅）

事件名常量见 `FIRE_SIMULATION_EVENTS`（`lib/fire-simulation/events.ts`）：

| 事件 | detail | 方向 |
| --- | --- | --- |
| `fire-simulation:load` | `{ plan: SimulationPlan }` | 外部 → 控制器 |
| `fire-simulation:start` / `pause` / `resume` / `next` / `previous` / `replay` / `reset` | 无业务数据 | 外部 → 控制器 |
| `fire-simulation:state` | 只读 `SimulationSnapshot` | 控制器 → 外部 |

- 控制事件不携带业务数据；`load` 携带完整计划；`state` 携带只读快照。
- 组件卸载必须移除全部监听器；不把控制器或可变对象挂到 `window`。

---

## 6. 接入示例

### 6.1 主工程派发计划 / 控制

```ts
import { dispatchFireSimulationLoad, dispatchFireSimulationControl } from '@/lib/fire-simulation';

// 由业务层生成的计划（Codex 负责把等级/力量/水源/路线/对象 ID 转为 SimulationPlan）
dispatchFireSimulationLoad(plan);

// 控制
dispatchFireSimulationControl('start');
dispatchFireSimulationControl('next');
dispatchFireSimulationControl('reset');
```

### 6.2 React 组件使用

```tsx
'use client';
import { FireSimulationPanel } from '@/components/fire-simulation';

export function Page() {
  return <FireSimulationPanel initialPlan={plan} sceneId="477747327523254272" />;
}
```

### 6.3 独立订阅状态

```ts
import { onFireSimulationEvent, FIRE_SIMULATION_EVENTS } from '@/lib/fire-simulation';

const off = onFireSimulationEvent(FIRE_SIMULATION_EVENTS.state, (snapshot) => {
  console.log(snapshot.state, snapshot.progress);
});
// 卸载时 off();
```

---

## 7. 公共 API 清单

- 类型：`SimulationPlan` `SimulationStep` `SimulationAction` `Point3` `SimulationActionStatus`
  `SimulationActionResult` `SimulationControllerState` `SimulationSnapshot` `FireSimulationAdapter`
  `FireSimulationController` `SimulationExecutionContext` `SimulationErrorCode` `SimulationColorRole`
  `DEFAULT_SIMULATION_COLORS` `SIMULATION_STEP_CODES` `SIMULATION_ACTION_TYPES`。
- 工厂 / 函数：`createFireSimulationController` `createUStudioAdapter` `validateSimulationPlan`
  `SimulationContractError` `bindFireSimulationEvents` `dispatchFireSimulation*` `onFireSimulationEvent`
  `FIRE_SIMULATION_EVENTS`。
