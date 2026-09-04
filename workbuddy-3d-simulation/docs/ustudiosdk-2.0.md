# UStudio SDK 2.0 模板说明

模板通过 npm 使用 `ustudio-sdk@2.0.2` 作为唯一场景运行 SDK，不再使用 `vendor` 下的 SDK tgz。

## 初始化链路

```ts
const sdk = createUStudioSdk()
await sdk.init({
  config: { hostUrl, appKey },
  locale: { lang: 'zh-CN' },
  commandBridge: { panelList, panelSetVisible, showVideo },
})
await sdk.initScene(sceneId, {
  soonspace: { el: container },
  onProgress,
  onSemantic2dClick,
})
```

`initScene` 是唯一场景加载入口，内部负责场景详情和实例树、场景包解密、CPS worker、用户摆放模型、主视角、路径/多边形恢复以及 WebSocket。模板和业务组件不要直接调用 CPS 加载方法。

加载成功后模板会设置：

- `window.__scene`：SDK 实例
- `window.__sceneId`：当前真实场景 ID

## 插件面板方法

- `getSceneSetState()`
- `setScene(params)`
- `gisSetVisible(visible)`
- `virtualRouteSetVisible(routeIds, visible)`
- `polygonSetVisible(polygonIds, visible)`
- `panelList()`
- `panelSetVisible({ id?, panelId?, name?, visible })`
- `showVideo(params)`

这些方法同时可被页面代码、插件面板 UI、SDK 内部 WebSocket 脚本上下文调用。

## 本体实例摆放

新增、更新和删除实例直接复用当前 SDK：

```ts
const sdk = sceneSdk()
await sdk.placeTwins({
  type: 'model',
  twinsId,
  parentId,
  position: { x: 0, y: 0, z: 0 },
})
await sdk.updateTwinsPlacement(twinsInstanceId, patch)
await sdk.deleteTwins(twinsInstanceId)
```

`placeTwins` 的 `twinsId` 必传。`url` 和 `twinsIdentifier` 可省略，SDK 会使用 `twinsId` 调用本体详情接口并读取 `model_path`；业务代码不需要重复查询详情。

## 导航方法

页面、聊天生成代码和业务面板直接通过模板的 `sceneSdk()` 调用导航公开方法：

```ts
const sdk = sceneSdk()
const sceneId = window.__sceneId
if (!sceneId) throw new Error('当前场景未加载')

const external = await sdk.navigateFromExternal({
  scene_id: sceneId,
  source: { lon: 116.397428, lat: 39.90923 },
  target: { node_id: targetTwinsInstanceId },
})

const internal = await sdk.navigateWithinScene({
  scene_id: sceneId,
  source: { node_id: sourceTwinsInstanceId },
  target: { node_id: targetTwinsInstanceId },
  waypoint_node_ids: waypointTwinsInstanceIds,
})

if (internal.reachable) {
  sdk.deleteNavigationRoute(internal.path_id)
}

sdk.deleteNavigationRoute()
```

- `source.node_id`、`target.node_id` 和 `waypoint_node_ids` 均为对应实例的 `twins_instance_id`。
- `source` / `target` 也可以传场景坐标 `{ x, y, z }`。
- 本体调用的 `input_params` 可将 `source` / `target` 传为 JSON 对象字符串，将 `waypoint_node_ids` 传为 JSON 数组字符串；无效 JSON 会抛出参数错误。
- 场外导航起点使用 WGS84 `{ lon, lat }`，经度在前。
- 导航方法负责请求、绘制和路线登记，不需要额外调用 `invokeTwinsFunction` 或自行绘线。
- 成功后使用返回的 `path_id` 删除指定路线；`reachable: false` 是正常不可达结果。
