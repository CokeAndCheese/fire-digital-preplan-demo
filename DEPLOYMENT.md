# fire-digital-preplan-demo Lighthouse 部署

本目录是一个双 Next.js 服务的部署骨架：主服务 `fire-digital-preplan-demo` 监听容器内 `3100`，三维场景服务 `fire-digital-preplan-demo-scene` 监听容器内 `3000`。两个服务只加入外部 Docker 网络 `web`，不发布宿主端口；宿主端口仍由共享 Caddy 网关独占。

## 首次上线

在 Lighthouse 上准备应用目录、外部网络和持久目录：

```bash
sudo mkdir -p /srv/apps /srv/gateway
sudo docker network inspect web >/dev/null 2>&1 || sudo docker network create web
cd /srv/apps
git clone <REPOSITORY_URL> fire-digital-preplan-demo
cd fire-digital-preplan-demo
cp .env.example .env
chmod 600 .env
mkdir -p data/fire
chmod 750 data/fire
sudo chown 1001:1001 data/fire
```

编辑 `.env`，至少填写 `AGENT_APP_KEY`、`AGENT_COMPETITION_APP_ID`、`X_APP_KEY` 以及实际使用的 UStudio/业务令牌。真实凭据只放在服务器 `.env`，不放进 Git、bundle、镜像或 Actions 日志。当前 UStudio SDK 会把 `X_APP_KEY` 发送到授权浏览器，因此这里必须使用新签发、可按来源与权限收敛的浏览器专用 key；禁止复用隔离旧安装包里的 key，也不要放入高权限服务端 key。确认该边界后将 `BROWSER_X_APP_KEY_CONFIRMED=true`；确认旧安装包内全部凭据均已吊销或轮换后再设置 `OLD_EMBEDDED_CREDENTIALS_REVOKED=true`。当前演示 API 也没有终端用户登录；只有明确接受公开匿名演示，或先增加真实访问控制后，才可把 `PUBLIC_UNAUTHENTICATED_DEMO_CONFIRMED` 改为 `true`。若任一条件不成立，应暂停公网业务验收。

先检查并启动应用，确认健康后再启用网关：

```bash
node deploy/preflight-env.mjs .env
sudo docker compose config
sudo docker compose build
sudo docker compose up -d --no-build
sudo docker compose ps
```

将 [`deploy/Caddyfile.snippet`](deploy/Caddyfile.snippet) 添加到 `/srv/gateway/Caddyfile` 的根索引 handler 之前。scene 的两条规则必须位于主服务规则之前；`handle` 保留前缀，镜像构建时的两个 `basePath` 与此保持一致。随后在网关目录执行 Caddy 校验和重载：

```bash
sudo docker exec caddy-gateway caddy validate --config /etc/caddy/Caddyfile
cd /srv/gateway && sudo docker compose up -d
```

## 根索引卡片元数据

共享根索引是数据驱动的，卡片应单独追加到 `site/assets/site-data.js` 的 `projects` 数组，不要把卡片 HTML 写入 `index.html`。本项目元数据如下：

```text
slug: fire-digital-preplan-demo
title: 三亚消防数字预案
description: 消防指挥智能体与三维场景联动演示
href: /fire-digital-preplan-demo/
status: 手动部署（Actions 端到端验收前）
```

## GitHub Actions 自动发布

`.github/workflows/deploy.yml` 会在 `main` 推送时 checkout 全历史，制作只包含 `main` 全历史的 Git bundle，并通过专用 SSH 密钥入站传给服务器。服务器脚本只接受精确触发 SHA，要求当前 checkout 干净且旧提交是其祖先，然后依次执行 Compose 配置、构建、启动、容器健康、网络健康和网关内容标记检查。失败时回到旧提交并重建，绝不删除 `data/fire` volume。

在仓库 Settings → Secrets and variables → Actions 配置：

- Secret `LIGHTHOUSE_DEPLOY_KEY`：仅用于本项目的 Ed25519 私钥；对应公钥只安装到服务器部署用户。
- Secret `LIGHTHOUSE_KNOWN_HOSTS`：服务器的固定 `known_hosts` 行（通过受信渠道取得并审核）。
- Variable `LIGHTHOUSE_HOST`：服务器地址（当前为 `115.159.223.98`）。
- Variable `LIGHTHOUSE_USER`：部署用户（当前为 `ubuntu`）。
- Variable `DEPLOY_ENABLED`：服务器入口和上述 Secrets 配置完成后设为 `true`。在此之前，首次代码上传只保存源码，发布任务会安全跳过。

不要设置 `StrictHostKeyChecking=no`，不要复用个人 SSH 私钥。CI 公钥也不能作为普通交互式 SSH key 使用：先把仓库内的命令分发器安装成 root 管理的固定文件：

```bash
sudo install -o root -g root -m 0755 deploy/ci-ssh-dispatch.sh \
  /usr/local/sbin/fire-digital-preplan-demo-ci
```

再将专用公钥以 forced-command 形式加入 `ubuntu` 的 `authorized_keys`；`<CI_PUBLIC_KEY>` 仅表示新建专用 key 的公钥内容：

```text
restrict,command="/usr/local/sbin/fire-digital-preplan-demo-ci" <CI_PUBLIC_KEY>
```

该入口只接受本项目固定命名的 bundle 上传和 `deploy <bundle> <sha>`，拒绝交互式 shell、转发与其他命令。完成服务器入口与 Secrets 配置后，将 `DEPLOY_ENABLED=true`，再从 Actions 页面手动运行一次 `Deploy fire-digital-preplan-demo` 完成首验。首次上线仍应人工验证公开路径；至少完成一次 Actions 全链路验收后，才可把项目称为自动部署。

## 回滚和验证

自动流程失败会保留数据目录并回到旧提交。人工检查可执行：

```bash
cd /srv/apps/fire-digital-preplan-demo
git status --short
sudo docker compose ps
sudo docker exec fire-digital-preplan-demo node /usr/local/bin/healthcheck.mjs http://127.0.0.1:3100/fire-digital-preplan-demo/health fire-command-agent
sudo docker exec fire-digital-preplan-demo-scene node /usr/local/bin/healthcheck.mjs http://127.0.0.1:3000/fire-digital-preplan-demo/scene/health fire-scene-command-bridge
```

防火墙只需为共享 Caddy 开放 TCP `80`（配置 HTTPS 后再开放 `443`）；不要为两个应用开放 `3100` 或 `3000`。
