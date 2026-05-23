# YiboVibe Server Deployment Guide

This directory contains the public deployment files for the YiboVibe server stack.

本目录提供 YiboVibe 服务端部署所需的公开文件。

## Scope

The server is responsible for:

- login and authentication
- device and session sync
- WebSocket signal routing
- `FlowSync` staging and share delivery
- desktop and mobile coordination

服务端负责：

- 登录与鉴权
- 设备与会话同步
- WebSocket 信令路由
- `FlowSync` 暂存与分享链路
- 桌面端与移动端协同

The server is not:

- a third-party AI gateway
- a cloud code execution platform
- the main execution host for agents or shells

服务端不负责：

- 第三方 AI 网关
- 云端代码执行平台
- 作为 Agent 或 Shell 的主执行宿主

## Stack

The current Docker Compose stack contains:

- `yibovibe_api`
- `yibovibe_ai_gate`
- `yibovibe_db`
- `yibovibe_redis`

当前 Docker Compose 栈包含：

- `yibovibe_api`
- `yibovibe_ai_gate`
- `yibovibe_db`
- `yibovibe_redis`

`yibovibe_ai_gate` is kept as the historical container name for the reverse proxy entrypoint. It does not proxy third-party model APIs.

`yibovibe_ai_gate` 只是历史保留下来的反向代理入口容器名，不承担第三方模型 API 代理职责。

## First Install

```bash
cd YiboVibe/server
cp .env.example .env
docker compose up -d
docker compose ps
```

At minimum, confirm these values in `.env`:

至少确认 `.env` 中这些值：

```env
POSTGRES_USER=yibo_admin
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=yibovibe
REDIS_PASSWORD=change_me_redis_password
GIN_MODE=release
GATE_PORT=11434
YIBOVIBE_API_IMAGE=datouluobo/yibovibe-server:0.9.7
```

## Validation

After deployment, validate:

部署完成后至少验证：

```bash
curl http://127.0.0.1:11434/
curl http://127.0.0.1:11434/api/v1/ping
docker compose logs api --tail=120
```

Expected ping output includes:

`/api/v1/ping` 预期返回包含：

```json
{"message":"pong","version":"0.9.7"}
```

## Update Strategy

For day-to-day updates, prefer one of these paths:

1. sync the latest `server/` source to the NAS and build on the NAS
2. build a Docker image locally, export it as tar, upload it to the NAS, then load and restart

日常更新推荐两条路径：

1. 把最新 `server/` 源码同步到 NAS，在 NAS 本地构建并更新
2. 在本机构建 Docker 镜像并导出 tar，上传到 NAS 后导入重启

Do not treat `latest` as the default debugging or hotfix verification path.

不要把 `latest` 当作默认的调试或热修复验证路径。

## Release Tags

Recommended naming:

- local verification: `yibovibe-server:local-YYYY-MM-DD`
- public release: `datouluobo/yibovibe-server:0.9.7`

推荐命名：

- 本地验证：`yibovibe-server:local-YYYY-MM-DD`
- 正式发布：`datouluobo/yibovibe-server:0.9.7`

## Related Docs

- Full NAS deployment guide / NAS 部署总说明: [../docs/NAS部署指南.md](../docs/NAS部署指南.md)
- Detailed update guide / 服务端更新说明: [../docs/server-update-guide.md](../docs/server-update-guide.md)
- Product scope / 产品边界: [../docs/specs-v2.md](../docs/specs-v2.md)
