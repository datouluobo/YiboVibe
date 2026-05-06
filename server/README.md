# YiboFlow 服务端部署说明

本目录包含 YiboFlow 服务端的公开部署文件。

当前公开部署栈会安装并运行这 4 个容器：

- `yiboflow_ai_gate`
- `yiboflow_api`
- `yiboflow_db`
- `yiboflow_redis`

`ollama` 不属于 YiboFlow 服务端部署栈。

## 1. 当前服务端职责

当前服务端只负责：

- 登录
- 认证
- 配置保存
- 配置同步
- `FlowSync` NAS 暂存
- `FlowSync` 外链下载

`FlowProbe` 是本机直连 AI API 测试工具，不经过本服务端。

## 2. 本目录包含的文件

- `docker-compose.yml`
  - 一键部署入口
- `.env.example`
  - 公开环境变量模板
- `Caddyfile`
  - `/api/*` 网关转发配置
- `Dockerfile`
  - 用于发布 `datouluobo/yiboflow-server` 镜像

## 3. 部署前准备

目标机器需要具备：

- Docker Engine
- Docker Compose
- 一个可用的网关端口，默认 `11434`

建议先检查：

```bash
docker --version
docker compose version
```

## 4. 首次安装步骤

### 第 1 步：进入部署目录

如果你已经克隆了仓库：

```bash
cd YiboFlow/server
```

如果你只是把本目录复制到服务器上，则进入对应目录即可。

### 第 2 步：生成运行环境文件

复制模板：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

### 第 3 步：修改 `.env`

打开 `.env`，至少检查并修改以下内容：

```env
POSTGRES_USER=yibo_admin
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=yiboflow
REDIS_PASSWORD=change_me_redis_password
GIN_MODE=release
GATE_PORT=11434
YIBOFLOW_API_IMAGE=datouluobo/yiboflow-server:latest
```

必须修改：

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

建议保持：

- `GIN_MODE=release`
- `YIBOFLOW_API_IMAGE=datouluobo/yiboflow-server:latest`

只有在 `11434` 已被占用时，才修改：

- `GATE_PORT`

### 第 4 步：启动服务栈

```bash
docker compose up -d
```

这会自动拉取并启动：

- `datouluobo/yiboflow-server:latest`
- `caddy:latest`
- `postgres:15-alpine`
- `redis:7-alpine`

### 第 5 步：确认运行状态

```bash
docker compose ps
```

预期服务名：

- `api`
- `ai_gateway`
- `db`
- `redis`

预期容器名：

- `yiboflow_api`
- `yiboflow_ai_gate`
- `yiboflow_db`
- `yiboflow_redis`

也可以查看完整容器状态：

```bash
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

## 5. 访问入口与网络说明

默认对外入口端口是：

- `11434`

网关只转发：

- `/api/*` -> `yiboflow_api:8080`
- `/share/*` -> `yiboflow_api:8080`

其它路径会返回：

- `YiboFlow Sync Gateway is Active`

可以这样测试：

```bash
curl http://127.0.0.1:11434/
curl -X POST http://127.0.0.1:11434/api/v1/user/login -H "Content-Type: application/json" -d "{}"
```

预期结果：

- `/` 返回 `200`
- 空登录请求通常返回 `400`

这里的 `400` 对联通性测试是正常的，因为它说明请求已经成功到达 API 服务，只是请求体不合法。

## 6. 升级到新镜像

如果要升级到当前推荐的最新发布：

```bash
docker compose pull
docker compose up -d
```

如果要固定到某个版本标签，先修改 `.env`：

```env
YIBOFLOW_API_IMAGE=datouluobo/yiboflow-server:2026-04-29
```

然后执行：

```bash
docker compose pull
docker compose up -d
```

## 7. 查看日志

查看全部服务日志：

```bash
docker compose logs
```

实时跟踪：

```bash
docker compose logs -f
```

只看 API：

```bash
docker compose logs -f api
```

## 8. 停止、重启、删除

停止服务栈：

```bash
docker compose stop
```

重启服务栈：

```bash
docker compose restart
```

删除容器但保留数据卷：

```bash
docker compose down
```

删除容器和数据卷：

```bash
docker compose down -v
```

除非你明确要清空数据，否则不要执行 `docker compose down -v`。

它会删除：

- PostgreSQL 数据
- Redis 数据
- 同步相关的 vault 数据

## 9. 备份建议

持久化数据在以下命名卷中：

- `pgdata`
- `redisdata`
- `vaultdata`

最低限度应备份：

- `.env`
- 上述 Docker 数据卷

如果部署在 NAS 上，建议同时备份：

- `docker-compose.yml`
- `Caddyfile`

## 10. 安全说明

对外共享部署方案时，必须注意：

- 不要提交真实 `.env`
- 不要公开真实密码
- 不要把个人环境变量打进镜像

当前仓库已按这个目标整理：

- `.env` 仅用于本地
- `.env.example` 可安全公开
- `.dockerignore` 会排除本地密钥、调试产物和无关文件

## 11. 手动发布镜像

当前 Docker Hub 仓库：

- `datouluobo/yiboflow-server`

当前已发布标签：

- `latest`
- `2026-04-29`

### 本地构建

```bash
cd server
docker build -t server-api:latest .
```

### 打标签

把版本标签替换成你的新发布日期或版本号：

```bash
docker tag server-api:latest datouluobo/yiboflow-server:latest
docker tag server-api:latest datouluobo/yiboflow-server:2026-04-29
```

### 推送

```bash
docker push datouluobo/yiboflow-server:latest
docker push datouluobo/yiboflow-server:2026-04-29
```

推荐的发版规则：

- 每次都推一个固定版本标签
- 同时把 `latest` 指向当前最新稳定版

`latest` 是可移动标签，不会保留历史。
真正的历史版本要靠固定标签保留，例如：

- `2026-04-29`
- `v0.1.0`
- `v0.1.1`

## 12. 常见问题

### `docker compose ps` 显示服务缺失

执行：

```bash
docker compose up -d
```

### 网关端口已被占用

修改 `.env`：

```env
GATE_PORT=11435
```

然后重新启动：

```bash
docker compose up -d
```

### 前端提示同步失败

先检查：

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f ai_gateway
```

再测试本地网关：

```bash
curl http://127.0.0.1:11434/
curl -X POST http://127.0.0.1:11434/api/v1/user/login -H "Content-Type: application/json" -d "{}"
```

如果 `/` 返回 `200`，而登录返回 `400`，说明 gateway -> API 链路是通的。

### 群晖 Container Manager 显示旧容器残影

先相信：

- `docker ps -a`
- `docker compose ps -a`

如果 Docker CLI 状态正常，而群晖界面仍有旧条目：

1. 先刷新 Container Manager
2. 如有需要，重启 NAS 上的 Docker
3. 只有在界面仍不刷新时，才考虑重启 NAS

## 13. 给其他用户的推荐安装流程

对外部署时，推荐其他用户严格按以下步骤执行：

```bash
git clone <repo-url>
cd YiboFlow/server
cp .env.example .env
# 修改 .env
docker compose up -d
docker compose ps
```

这样安装出来的就是当前同一套 4 容器部署栈。

---

# YiboFlow Server Deployment Guide

This directory contains the public deployment files for the YiboFlow server stack.

The published stack installs and runs these 4 containers:

- `yiboflow_ai_gate`
- `yiboflow_api`
- `yiboflow_db`
- `yiboflow_redis`

`ollama` is not part of the YiboFlow server stack.

## 1. What This Stack Does

The server side is now limited to:

- login
- authentication
- configuration save
- configuration sync

The `FlowProbe` AI API test tool does not run through this server.

## 2. Files in This Directory

- `docker-compose.yml`
  - one-click deployment entrypoint
- `.env.example`
  - public environment template
- `Caddyfile`
  - gateway config for `/api/*`
- `Dockerfile`
  - build file for publishing `datouluobo/yiboflow-server`

## 3. Prerequisites

Before deployment, make sure the target machine has:

- Docker Engine
- Docker Compose
- an available TCP port for the gateway, default `11434`

Recommended minimum checks:

```bash
docker --version
docker compose version
```

## 4. First-Time Installation

### Step 1. Get the deployment files

If you already cloned the repo:

```bash
cd YiboFlow/server
```

If you only copied this directory to a server, enter that directory instead.

### Step 2. Create your runtime environment file

Copy the template:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### Step 3. Edit `.env`

Open `.env` and change at least these values:

```env
POSTGRES_USER=yibo_admin
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=yiboflow
REDIS_PASSWORD=change_me_redis_password
GIN_MODE=release
GATE_PORT=11434
YIBOFLOW_API_IMAGE=datouluobo/yiboflow-server:latest
```

Required changes:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

Recommended checks:

- keep `GIN_MODE=release` for deployment
- keep `YIBOFLOW_API_IMAGE=datouluobo/yiboflow-server:latest` unless you want a fixed version
- change `GATE_PORT` only if `11434` is already in use

### Step 4. Start the stack

```bash
docker compose up -d
```

This will pull and start:

- `datouluobo/yiboflow-server:latest`
- `caddy:latest`
- `postgres:15-alpine`
- `redis:7-alpine`

### Step 5. Confirm the stack is healthy

```bash
docker compose ps
```

Expected services:

- `api`
- `ai_gateway`
- `db`
- `redis`

Expected container names:

- `yiboflow_api`
- `yiboflow_ai_gate`
- `yiboflow_db`
- `yiboflow_redis`

You can also inspect full container status:

```bash
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

## 5. Network Entry and Access

The exposed entry port is:

- `11434` by default

The gateway only forwards:

- `/api/*` -> `yiboflow_api:8080`

All other paths return:

- `YiboFlow Sync Gateway is Active`

Example checks:

```bash
curl http://127.0.0.1:11434/
curl -X POST http://127.0.0.1:11434/api/v1/user/login -H "Content-Type: application/json" -d "{}"
```

Expected behavior:

- `/` returns `200`
- empty login request usually returns `400`

That `400` is acceptable for connectivity testing because it proves the request reached the API service.

## 6. Upgrade to a New Published Image

If you want the newest recommended release:

```bash
docker compose pull
docker compose up -d
```

If you want a fixed tag instead of `latest`, edit `.env`:

```env
YIBOFLOW_API_IMAGE=datouluobo/yiboflow-server:2026-04-29
```

Then apply it:

```bash
docker compose pull
docker compose up -d
```

If you want to deploy the latest local source before publishing a new Docker Hub tag:

```bash
docker build -t yiboflow-server:local-2026-05-05 .
YIBOFLOW_API_IMAGE=yiboflow-server:local-2026-05-05 docker compose up -d api
```

## 7. View Logs

Show all service logs:

```bash
docker compose logs
```

Follow logs in real time:

```bash
docker compose logs -f
```

Follow only the API service:

```bash
docker compose logs -f api
```

## 8. Stop, Restart, and Remove

Stop the stack:

```bash
docker compose stop
```

Restart the stack:

```bash
docker compose restart
```

Remove containers but keep data volumes:

```bash
docker compose down
```

Remove containers and volumes:

```bash
docker compose down -v
```

Do not run `docker compose down -v` unless you intentionally want to remove:

- PostgreSQL data
- Redis data
- synced vault data

## 9. Backup and Restore

Persistent data is stored in these named volumes:

- `pgdata`
- `redisdata`
- `vaultdata`

At minimum, back up:

- your `.env`
- the Docker volumes above

If you deploy on NAS, also keep a copy of:

- `docker-compose.yml`
- `Caddyfile`

## 10. Security Notes

Before sharing this deployment setup with others:

- never commit your real `.env`
- never publish real passwords
- never bake personal `.env` values into images

This repo is already prepared so that:

- `.env` stays local
- `.env.example` is safe to publish
- `.dockerignore` excludes local secrets and debug artifacts from image builds

## 11. Manual Image Publishing

The published Docker Hub repository is:

- `datouluobo/yiboflow-server`

Current public tags:

- `latest`
- `2026-04-29`

### Build locally

```bash
cd server
docker build -t server-api:latest .
```

### Tag for Docker Hub

Replace the version tag with your new release tag.

```bash
docker tag server-api:latest datouluobo/yiboflow-server:latest
docker tag server-api:latest datouluobo/yiboflow-server:2026-04-29
```

### Push

```bash
docker push datouluobo/yiboflow-server:latest
docker push datouluobo/yiboflow-server:2026-04-29
```

Recommended tagging rule:

- always push one fixed version tag
- also update `latest` to the newest stable release

`latest` is a moving tag. It does not preserve history by itself.
History is preserved by fixed tags such as:

- `2026-04-29`
- `v0.1.0`
- `v0.1.1`

## 12. Common Problems

### `docker compose ps` shows services missing

Run:

```bash
docker compose up -d
```

### The gateway port is already in use

Change this in `.env`:

```env
GATE_PORT=11435
```

Then restart:

```bash
docker compose up -d
```

### The UI says sync failed

Check:

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f ai_gateway
```

Then test the local gateway:

```bash
curl http://127.0.0.1:11434/
curl -X POST http://127.0.0.1:11434/api/v1/user/login -H "Content-Type: application/json" -d "{}"
```

If `/` returns `200` and login returns `400`, the gateway-to-API chain is alive.

### The share link opens but download fails

Check whether `Caddyfile` contains:

```caddy
handle /share/* {
    reverse_proxy yiboflow_api:8080
}
```

Without this route, `FlowSync` share URLs can be created but external downloads will not reach the Go API.

### Synology Container Manager shows stale container entries

First trust `docker ps -a` and `docker compose ps -a`.

If Docker CLI status is correct but Synology still shows stale entries:

1. refresh Container Manager
2. restart Docker on NAS if needed
3. only reboot NAS if the UI still does not refresh

## 13. Recommended Deployment Flow for Other Users

For a clean first install, other users should do exactly this:

```bash
git clone <repo-url>
cd YiboFlow/server
cp .env.example .env
# edit .env
docker compose up -d
docker compose ps
```

That will install the same 4-container stack used by the current server deployment.
