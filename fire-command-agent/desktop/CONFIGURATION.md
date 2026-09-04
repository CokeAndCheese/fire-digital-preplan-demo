# 桌面运行配置

桌面程序不会把源工程的 `.env.local` 或任何客户密钥打进安装包。构建阶段会清空已知凭据变量，运行阶段只从外部配置目录读取 `fire.env` 和 `scene.env`。

## 配置目录

默认目录为 Electron 的 `app.getPath('userData')/config`。可使用非秘密路径变量 `FIRE_COMMAND_CONFIG_DIR` 指定目录（建议使用绝对路径；相对路径按启动进程的当前目录解析）。首次启动时，程序只会在缺少文件时创建带注释和空值的安全模板，绝不会覆盖已有文件。

配置目录结构：

```text
<配置目录>/
├── fire.env
└── scene.env
```

请把客户自己的值填写到对应文件，并限制文件访问权限。至少需要：

- `fire.env`：`AGENT_APP_KEY`，以及实际启用的 `AGENT_GATEWAY`、`AGENT_COMPETITION_APP_ID` 和各 Skill Bridge 地址；
- `scene.env`：`X_APP_KEY`，以及需要覆盖的 `USTUDIO_GATEWAY`。这些值在 standalone 服务启动后读取，不在 Next 构建时编译进客户端包。程序仅为兼容旧配置继续识别 `NEXT_PUBLIC_X_APP_KEY` / `NEXT_PUBLIC_USTUDIO_BASE`，新配置不应再使用它们。

程序会把两个文件分别注入对应的本地服务进程。缺少配置时，两个本地服务和桌面 UI 仍会尝试启动；消防远端请求会报告 `AGENT_APP_KEY` 未配置，三维远端请求会报告未配置或上游不可用。桌面日志只记录缺失项名称和错误状态，不记录配置值。

## 构建与预检

在 `源码/fire-command-agent` 目录执行：

```bash
npm run desktop:preflight
npm run desktop:build
```

预检只解析三维工程路径，不运行 Next 构建，也不创建或清理构建产物。路径优先使用同级 `../workbuddy-3d-simulation`；旧的 `../_parallel/workbuddy-3d-simulation` 仅作为兼容回退。可通过 `FIRE_COMMAND_SCENE_DIR` 覆盖（相对路径按消防工程目录解析）：

```bash
FIRE_COMMAND_SCENE_DIR=/path/to/workbuddy-3d-simulation npm run desktop:preflight
```

完整桌面构建仍需要先安装两个工程的依赖，并需要可用的 Next/Electron 构建工具。构建产物中的 `desktop/runtime` 只包含生产服务文件，不包含环境文件；安装包通过 `extraResources` 携带该运行时目录。

`npm run desktop:pack` 和 `npm run desktop:dist` 的可再生产物只写入 `desktop/generated-release`；脚本每次只清理该专用目录和 `desktop/runtime`，不会删除工程通用 `release` 目录中的用户文件。桌面启动器还会校验 `/health` 返回的 2xx JSON 服务身份；端口被其他程序占用时会拒绝复用并给出明确错误，避免误连无关本地服务。
