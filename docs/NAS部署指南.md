# YiboVibe NAS / 服务端私有化部署指南

This document explains how to deploy the YiboVibe server stack to a NAS or Linux Docker host.

本文档说明如何把 YiboVibe 服务端部署到 NAS 或 Linux Docker 主机。

更新时间：2026-05-24

## 1. Scope / 适用范围

Use this guide when you want to deploy the login, session sync, and WebSocket signaling stack for YiboVibe.

如果你需要部署 YiboVibe 的登录、会话同步和 WebSocket 信令链路，可以使用本指南。

The current public deployment target is the Compose stack under `server/`.

当前公开部署目标是 `server/` 目录下的 Compose 栈。

## 2. Stack / 部署内容

The current stack includes:

- `yibovibe_api`
- `yibovibe_ai_gate`
- `yibovibe_db`
- `yibovibe_redis`

当前部署栈包含：

- `yibovibe_api`
- `yibovibe_ai_gate`
- `yibovibe_db`
- `yibovibe_redis`

`yibovibe_ai_gate` is only the historical reverse-proxy container name. It does not act as a third-party AI gateway.

`yibovibe_ai_gate` 只是历史保留下来的反向代理入口容器名，不承担第三方 AI 网关职责。

## 3. Requirements / 环境准备

You need:

1. Docker Engine
2. Docker Compose v2
3. An available public port, `11434` by default

需要准备：

1. Docker Engine
2. Docker Compose v2
3. 一个可用对外端口，默认 `11434`

Recommended checks:

```bash
docker --version
docker compose version
```

推荐先检查：

```bash
docker --version
docker compose version
```

If you build on Windows first and then send the image to the NAS, also verify:

如果你打算先在 Windows 本机构建，再把镜像传到 NAS，还应额外确认：

```powershell
docker version
```

## 4. Get The Deployment Files / 获取部署文件

```bash
git clone https://github.com/datouluobo/YiboVibe.git
cd YiboVibe/server
```

If you copy files manually instead of cloning the repository, keep at least:

如果你不是直接克隆仓库，而是手动复制目录，至少要保留：

- `docker-compose.yml`
- `Dockerfile`
- `Caddyfile`
- `.env.example`

## 5. Configure The Environment / 配置运行环境

```bash
cp .env.example .env
```

Then confirm these values in `.env`:

然后确认 `.env` 至少包含这些值：

```env
POSTGRES_USER=yibo_admin
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=yibovibe
REDIS_PASSWORD=change_me_redis_password
GIN_MODE=release
GATE_PORT=11434
YIBOVIBE_API_IMAGE=datouluobo/yibovibe-server:0.9.7
```

You must change:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

必须修改：

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

## 6. First Start / 首次启动

```bash
docker compose up -d
docker compose ps
```

You should see all four containers running.

正常情况下应看到 4 个容器都已启动。

## 7. Validation / 更新后验证

```bash
curl http://127.0.0.1:11434/
curl http://127.0.0.1:11434/api/v1/ping
docker compose ps
docker compose logs api --tail=120
```

Expected ping output includes:

`/api/v1/ping` 预期返回包含：

```json
{"message":"pong","version":"0.9.7"}
```

## 8. Recommended Update Paths / 推荐更新路径

Preferred day-to-day update paths:

1. sync the latest `server/` source to the NAS and build locally on the NAS
2. build the image on your local machine, export a tar, upload it to the NAS, then load and restart

日常更新优先使用两条路径：

1. 把最新 `server/` 源码同步到 NAS，在 NAS 本地构建并更新
2. 在本机构建镜像并导出 tar，上传到 NAS 后导入并重启

Do not rely on “push to Docker Hub and wait for NAS to pull `latest`” as the default hotfix path.

不要把“推 Docker Hub 再等 NAS 拉取 `latest`”当作默认修复路径。

## 9. Local Build Then NAS Import / 本机构建后导入 NAS

### Step 1. Build locally / 本机构建镜像

```powershell
cd F:\Download\GitHub\YiboVibe\server
docker build -t yibovibe-server:local-2026-05-24 .
```

### Step 2. Export tar / 导出 tar

```powershell
docker save -o F:\Download\yibovibe-server-local-2026-05-24.tar yibovibe-server:local-2026-05-24
```

### Step 3. Load on NAS and restart / NAS 导入并更新

```bash
docker load -i /actual/path/yibovibe-server-local-2026-05-24.tar

cd /actual/path/YiboVibe/server
YIBOVIBE_API_IMAGE='yibovibe-server:local-2026-05-24' docker compose up -d api
```

If you want later restarts to keep using the same image, write that image name back into `.env`.

如果你希望后续重启继续固定使用同一个镜像，把相同镜像名写回 `.env` 中的 `YIBOVIBE_API_IMAGE`。

## 10. Public Release Tags / 公开发布版本

Use explicit version tags for public releases, for example:

正式对外发布时，建议使用明确版本标签，例如：

- `datouluobo/yibovibe-server:0.9.7`

Using `latest` is optional, but it should not be your primary verification target.

`latest` 可以作为附加标签，但不建议作为主要验证依据。

## 11. Related Docs / 相关文档

- Server deployment guide / 服务端部署总说明: [../server/README.md](../server/README.md)
- Server update guide / 服务端更新指南: [server-update-guide.md](server-update-guide.md)
- Product specification / 产品规格: [specs-v2.md](specs-v2.md)
