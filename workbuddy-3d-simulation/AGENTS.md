# Runtime Language (mandatory)

Read `NEXT_PUBLIC_LOCALE` before creating or changing user-facing UI. When it is `en`, all visible UI copy must be English; when it is `zh`, use Simplified Chinese. This includes `mockup.html`, headings, labels, buttons, sample-data labels, empty states, errors, and status text. Do not infer UI language from the user request, scene data, source-file names, or this guide unless the user explicitly asks the deliverable to use another language.

# 工作区说明

这是一个基于 Next.js App Router 的 UStudio / SoonSpace 数字孪生场景模板。模板通过 npm 依赖 `ustudio-sdk@2.0.2`，不要添加或引用模板 `vendor` 下的 SDK tgz。页面入口由 `components/SoonspaceSceneViewer.tsx` 和 `lib/soonspace-runtime.ts` 负责 SDK 生命周期、场景加载、WebSocket、插件面板和视频弹窗。

## 生命周期与初始化

- 有模板项目的场景初始化已经走 SDK 生命周期：`createUStudioSdk()` -> `sdk.init(...)` -> `sdk.initScene(...)`。业务组件不要再次创建 SDK 或挂第二个 Viewer。
- 卸载或切换场景时必须调用 SDK 生命周期：`removeScene(sceneId)` 或 `destroy()`，不要只清 DOM。
- `sdk.initScene(sceneId, options)` 是唯一场景加载入口。场景详情、实例树、场景包下载与解密、CPS worker 加载、用户摆放模型、主视角、路径/多边形恢复和 WebSocket 都由 SDK 管理；模板和业务代码不要重复请求或自行加载。
- 不要直接创建或注册 CPS Manager，也不要调用 `loadSceneAndSemantic` / `loadSceneAndSemanticInWorker`。
- 初始化配置优先读取 Jarvis 设置注入的值，其次由动态服务端页面在运行时读取项目环境变量并以 props 传给 SDK，最后才使用模板默认值：
  - `X_APP_KEY`：对应界面设置里的 X-App-Key，只允许在服务启动后从外部运行环境读取。
  - `USTUDIO_GATEWAY`：后端域名，使用前去掉末尾 `/`。
  - `NEXT_PUBLIC_X_APP_KEY` / `NEXT_PUBLIC_USTUDIO_BASE` / `NEXT_PUBLIC_WS_URL` 仅作旧配置兼容；新构建不得使用 `NEXT_PUBLIC_*` 传递凭据，因为 Next 会在构建时将其固化进浏览器资产。
  - `NEXT_PUBLIC_LOCALE`：`zh` -> `zh-CN`，`en` -> `en-US`。
- 不要在业务代码里硬编码域名、appKey 或语言；不要把用户临时测试的域名和 appKey 写死进模板。
- `sdk.init` 必须注册模板已有业务桥：`commandBridge: { panelList, panelSetVisible, showVideo }`，这样 WebSocket 脚本和面板控制都能走同一套能力。

## 核心约定

- 不再使用旧 `soonspacejs-ustudio-plugin`、`lib/syscall.ts`、protobuf WebSocket、`window.__scenePlugins`、旧 u-space/FloorTool/GisTool 链路。所有 UStudio 场景动作、插件面板、本体功能和业务桥都走新版 SDK。
- Viewer 加载成功后：`window.__scene` 是 SDK 实例，`window.__sceneId` 是真实加载的 `scene_id`。组件里优先 `import { sceneSdk } from '@/lib/scene-sdk'` 再调用 SDK。
- 业务数据访问走 `@/lib/ustudio` 的服务端封装和 `/api/ustudio/*`；浏览器端不要手写带 appKey 的 fetch。
- 页面初始化时不要主动调用 `setScene`，也不要主动调用 `gisSetVisible`。SDK 默认加载场景和 GIS；只有用户显式点了图层/插件面板控件时才触发。

## 数据获取与 SDK 能力边界

- 允许调用接口获取业务数据、列表、详情和配置，用于渲染面板 UI、生成下拉选项、统计卡片，以及组装 SDK 方法入参。
- 接口返回的数据只作为 UI 和 SDK 入参来源；如果功能属于 SDK 已有能力，最终影响场景的动作必须调用 SDK 公共方法完成。
- 不要为了实现 SDK 已有能力而直接操作 soonspace/three 对象、自写渲染逻辑、自绘 SDK 图层，或维护一套和 SDK scene state 脱节的场景控制状态。
- 生成插件面板或业务面板时，可以通过接口拿楼栋/楼层、路径/多边形、设备/摄像头等清单；但楼栋楼层隐藏、2D/3D、炸开、标注、GIS、可达性、连通性、路径/多边形显隐、视频播放等动作必须落到 SDK 方法。
- 做数据面板时，设计期了解本体类型/属性用本体定义；运行时取真实设备本体走 `getSceneInstanceTree`，拿到树后按需拍平/过滤。
- `listTwinsInstances` 只表示用户手画的标注层实例，例如 Line 路线、Polygon 多边形、标记点；不要把它当成模型自带设备本体来源。
- 新增 npm 依赖必须写进 `package.json`；能用模板已装依赖时不要重复引入。
- 只有改 Viewer 生命周期或渲染管线时才读 `components/SoonspaceSceneViewer.tsx`；纯 UI 面板和数据展示不要读 Viewer、`MultiAgentWidget` 或插件框架源码。
- 不要重新创建第二个 Viewer；优先复用当前 `SoonspaceSceneViewer` 和 `sceneSdk()`。

## 本体功能调用

用户、聊天组件、业务面板或 WebSocket 脚本要求“调用本体功能”时，使用 `sdk.invokeTwinsFunction(...)`，这会直接触发平台 `/api/twins/twins-function/v1/invoke`。

```ts
const sdk = sceneSdk()

await sdk.invokeTwinsFunction({
  twins_instance_id: targetTwinsInstanceId,
  function_identifier: 'heighLight',
  input_params: [{ key: 'color', value: '#ffcc00' }],
})
```

- `twins_instance_id` 必须传目标本体实例；站点级场景控制传 site 对应的 `twins_instance_id`。
- `twins_id` 只在业务需要时选传；后端未升级前，接口因缺 `twins_id` 报错属于接口约束。
- `input_params` 使用 `{ key, value }[]`，只传当前功能需要的参数。
- SDK 调接口失败时会抛出接口错误信息；不要吞掉错误后假装成功。
- 纯前端即时联动也可以用 SDK 同名便捷方法，例如列表点击后 `sceneSdk().fly(id)` / `sceneSdk().heighLight(id, color)`。

## 本体方法速查

| 功能 | 推荐调用 |
| --- | --- |
| 飞向 | `invokeTwinsFunction({ twins_instance_id, function_identifier: 'fly' })` 或 `sdk.fly(id)` |
| 高亮 / 取消高亮 | `heighLight` / `cancelHeighLight`；颜色用 `color` |
| 透明 / 恢复透明 | `setOpacity` / `unSetOpacity`；invoke 入参 key 按后端约定叫 `color`，value 传透明度数值，如 `0.35`，不是设置颜色 |
| 显示 / 隐藏 | `show` / `hide` |
| 截图 | `screenShot` |
| 读属性 / 写属性 | `getProperties` / `setProperty`，属性标识不要猜，先从数据或本体定义里确认 |
| 沿路径移动 / 复位 | `pathMove` / `pathRestore` |
| 绘制 / 删除路线 | `drawRoute` / `deleteRoute` |
| 场景设置 | `setScene({ buildings, stories, mode, yExtend, labels, reachable, connectivity, nodeId, spaceId })` |
| 获取场景设置 | `getSceneSetState()` |
| GIS 显隐 | `gisSetVisible(visible)` |
| 路径显隐 | `virtualRouteSetVisible(routeIds, visible)`；必须传 `routeIds` + `visible` |
| 多边形显隐 | `polygonSetVisible(polygonIds, visible)`；必须传 `polygonIds` + `visible` |
| 视频弹窗 | `showVideo(url)` 或 invoke `function_identifier: 'showVideo'` |

## 导航路线

导航路线是 SDK 公开能力，页面、聊天生成代码和业务面板必须直接复用当前 `sceneSdk()`：

```ts
const sdk = sceneSdk()
const sceneId = window.__sceneId
if (!sceneId) throw new Error('当前场景未加载')

const result = await sdk.navigateWithinScene({
  scene_id: sceneId,
  source: { node_id: sourceTwinsInstanceId },
  target: { node_id: targetTwinsInstanceId },
  waypoint_node_ids: waypointTwinsInstanceIds,
})

if (result.reachable) {
  sdk.deleteNavigationRoute(result.path_id)
}
```

- 场外到场内使用 `navigateFromExternal({ scene_id, source: { lon, lat }, target })`。
- 场景内导航使用 `navigateWithinScene({ scene_id, source, target, waypoint_node_ids? })`。
- 删除指定导航路线使用 `deleteNavigationRoute(pathId)`；无参调用只清除 SDK 导航功能生成的全部路线。
- `source.node_id`、`target.node_id` 和 `waypoint_node_ids` 都是对应对象的 `twins_instance_id`，不要传 `twins_id` 或 `out_instance_id`。
- `source` / `target` 也可以使用场景坐标 `{ x, y, z }`；同一个位置不能同时传 `node_id` 和坐标。
- SDK 兼容本体调用把 `source` / `target` 传成 JSON 对象字符串，把 `waypoint_node_ids` 传成 JSON 数组字符串；页面生成代码仍优先传原生对象和数组。
- 导航接口、GIS 驾车段、场内拓扑路线绘制和路线登记都由 SDK 完成。不要对这三个方法使用 `invokeTwinsFunction`，不要直接请求导航接口，不要通过 MCP 算完后自行画线。
- 成功时保存返回的 `path_id`；`reachable: false` 是正常不可达结果，展示 `message` 即可。接口异常由 SDK 抛出，不要伪造成功。

## 插件面板与图层状态

- 插件面板初始化读取 `sdk.getSceneSetState()`，随后用 `sdk.subscribeSceneState(listener)` 订阅状态变化。不要维护一份和 SDK 脱节的独立图层状态。
- Jarvis 里可能有多个 SDK 调用入口：项目内组件、聊天组件、插件面板。无法控制外部入口时，统一以 SDK 的 scene state 为准，插件面板通过 `subscribeSceneState` 同步展示。
- 楼栋和楼层默认都未选中；未选中表示展示全部。不要为了“展示全部”把全部楼栋/楼层勾上。
- 可达性和连通性筛选只使用 `nodeId` / `spaceId`：`setScene({ reachable: true, nodeId })`、`setScene({ connectivity: true, spaceId })`。不要生成 `reachableNodeId` 或 `connectivitySpaceId`。
- 可达性 / 连通性开启时默认进入 2D；如果入参显式传 `mode: '3D'`，按 3D 展示，不要关闭可达性或连通性。
- 路径 / 多边形显隐必须传具体 id 和 `visible`；缺 id 时让 SDK 抛出参数缺失，不要回包成功。

## 业务面板与视频

做弹窗 / 侧栏面板时，用 `PanelShell` 包住内容，并同步维护 `lib/generated-panels.ts`。

```tsx
<div id="panel-device-overview">
  <PanelShell name="device-overview" title="设备总览" description="展示场景内设备数量、在线状态、告警状态和楼层分布。">
    {/* 面板内容 */}
  </PanelShell>
</div>
```

每个业务面板必须登记 `id/name/aliases/domId/description`。根 DOM id 必须等于 `domId`，`PanelShell name` 必须等于 `id`。

`PanelShell` 的关闭按钮和 `panelSetVisible({ visible: false })` 都表示最小化：保留可拖动的标题胶囊和已挂载的业务内容，不要自行添加 `display: none` 或卸载面板。`visible: true` 恢复展开，`panelList().visible` 表示当前是否展开。

```ts
const panels = await sceneSdk().panelList()
await sceneSdk().panelSetVisible({ id: 'device-overview', visible: true })
await sceneSdk().panelSetVisible({ name: '设备总览', visible: false })
```

视频播放统一走 SDK `showVideo`，使用方只传 URL：

```ts
await sceneSdk().showVideo('https://example.com/live.flv')
```

- 模板内置视频弹窗和播放器，支持 FLV、HLS 和浏览器原生视频格式。
- FLV 播放走 `mpegts.js`，不要再引入 `flv.js`。
- 不要 `window.open(videoUrl)`，不要重复实现播放器。
- URL 为空时抛“视频地址不能为空”；WebSocket 回包仍由 SDK 统一包装为现有 `SUCCESS/ERROR` 格式，成功结果返回传入的 URL 和打开状态。

## 本体实例摆放

- 新增本体实例用 `placeTwins`；移动、改尺寸、改属性用 `updateTwinsPlacement`；删除用 `deleteTwins`。
- `placeTwins` 的 `twinsId` 必传；`url` 和 `twinsIdentifier` 可省略，SDK 会根据 `twinsId` 查询本体详情并读取 `model_path`。不要为了补 URL 自行重复请求本体详情。
- `model` 用 `scale`，默认 `positionYMode: 'bottom'`，用于模型贴地。
- `dot` 用 `size`，默认 `positionYMode: 'center'`；不要给 dot 写 `scale`。
- 同一个本体再次 `placeTwins` 会新增实例；不要用它更新已有实例。
- 缺少 `twinsId`、`parentId`、坐标等必要参数时先问用户，不要猜。

## 多智能体浮窗

页面右下角的多智能体浮窗（`components/MultiAgentWidget.tsx`）开箱即用，基于 `@dt-uagent/multi-agent-sdk` 动态加载。通过 `X_APP_KEY` 与 `/uagent-service` 代理与智能体平台通信，`sceneId` 由 `useSceneId()` 自动跟随当前场景。

## lib/ustudio 数据速查

数据访问一律在服务端 route 中 `import { ... } from '@/lib/ustudio'`，不要在客户端暴露 appKey。

- `getSceneInstanceTree({ sceneId? })`：楼栋 / 楼层 / 空间 / 设备层级树。节点直接用 `node.id / node.name / node.type / node.children`。
- `listTwinsInstances({ sceneId? })`：用户手画的标注层实例，如 Line 路线 / Polygon 多边形 / 标记点，不是设备本体。
- `getTwinsInstanceDetail({ twinsInstanceId })`：单实例详情 / 属性值。
- `findShortestPath({ sceneId, source, target })` / `getReachableGraph({ sceneId, storyNodeIds })`：路径 / 可达图。
- `queryCypher({ sceneId, cypher })`：运行时按已知模式查值。
- `getSceneBootstrap({ sceneId?, sceneName? })`：场景启动信息。
- `postUStudio(endpoint, body)`：底层逃生口，仅端点未封装时用。

场景 ID：前端用 `useSceneId()`；服务端不传 `sceneId` 时会自动用当前场景兜底。
