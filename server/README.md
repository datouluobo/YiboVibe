# YiboVibe Server Deployment Guide

本目录提供 YiboVibe 服务端部署所需的公开文件。

当前部署栈包含 4 个容器：

- `yibovibe_api`
- `yibovibe_ai_gate`
- `yibovibe_db`
- `yibovibe_redis`

当前产品边界下，服务端负责：

- 登录与认证
- 设备与会话
- 配置保存与同步
- `FlowSync` 暂存与分享下载
- WebSocket 信令

服务端不负责：

- 第三方 AI API 网关
- `FlowProbe` 代理调用

## 1. Files

- `docker-compose.yml`
- `Caddyfile`
- `Dockerfile`
- `.env.example`

## 2. Prerequisites

目标机器至少需要：

- Docker Engine
- Docker Compose
- 一个可用的网关端口，默认 `11434`

如果在 Windows 桌面环境执行命令，先手动启动 `Docker Desktop`，并确认它已经进入运行状态，再执行任何 `docker build`、`docker save`、`docker load` 或 `docker compose` 命令。

推荐先检查：

```bash
docker --version
docker compose version
```

Windows 本机建议再补一条：

```powershell
docker version
```

如果这里出现 `failed to connect to the docker API` 或 `dockerDesktopLinuxEngine` 相关报错，先启动 `Docker Desktop`，等 Engine running 后再继续。

## 3. First Install

进入部署目录：

```bash
cd YiboVibe/server
```

生成运行环境文件：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，至少确认这些值：

```env
POSTGRES_USER=yibo_admin
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=yibovibe
REDIS_PASSWORD=change_me_redis_password
GIN_MODE=release
GATE_PORT=11434
YIBOVIBE_API_IMAGE=datouluobo/yibovibe-server:latest
```

首次安装可以直接启动：

```bash
docker compose up -d
docker compose ps
```

## 4. Default Update Policy

日常更新默认不要依赖“推到 Docker Hub 再等 NAS 拉取新镜像”。

原因：

- Docker Hub 新标签在 NAS 上不一定立刻可见
- `latest` 容易造成版本误判
- 当前迭代更适合“源码直达 NAS”或“镜像 tar 直达 NAS”

默认推荐只用下面两条路径：

1. 本机传最新源码到 NAS，在 NAS 本地构建并更新
2. 本机先构建镜像并导出 tar，再传到 NAS 导入并更新
3. 当怀疑本地旧镜像或本地联调环境干扰结果时，先删除本地相关构建产物，再强制全新构建后传到 NAS 更新

Docker Hub 发布保留给对外发版，不作为日常修复默认路径。

## 4.1 Image Naming

当前统一用两类镜像名：

- 日期标签：用于日常调试、修复验证、临时替换
- 版本号标签：用于正式发布、对外分发、稳定版本归档

推荐示例：

- 日常调试：`yibovibe-server:local-2026-05-14`
- 日常调试重建：`yibovibe-server:local-2026-05-14-clean`
- 正式发布：`datouluobo/yibovibe-server:0.9.5`

约定：

- 本机与 NAS 日常更新优先使用日期标签
- Docker Hub 对外发布优先使用版本号标签
- `latest` 只作为附加发布标签，不作为日常调试或 NAS 修复更新依据

## 5. Recommended NAS Update Path A

适用场景：

- NAS 上已有仓库副本
- 或者你可以把最新 `server/` 目录同步到 NAS
- 希望直接在 NAS 构建

在 NAS 的 `server/` 目录执行：

```powershell
docker build -t yibovibe-server:local-2026-05-14 .

$env:YIBOVIBE_API_IMAGE='yibovibe-server:local-2026-05-14'
docker compose up -d api

docker compose logs api --tail=120
curl http://127.0.0.1:11434/api/v1/ping
```

如果要让后续重启也继续使用这个镜像，把 `.env` 中的：

```env
YIBOVIBE_API_IMAGE=yibovibe-server:local-2026-05-14
```

写入后再执行：

```powershell
docker compose up -d api
```

## 6. Recommended NAS Update Path B

适用场景：

- 不想在 NAS 上同步完整仓库
- 希望在本机完成镜像构建
- 只把镜像结果传到 NAS

### Step 1. 在本机构建镜像

```powershell
cd F:\Download\GitHub\YiboVibe\server
docker build -t yibovibe-server:local-2026-05-14 .
```

### Step 2. 在本机导出镜像 tar

```powershell
docker save -o F:\Download\yibovibe-server-local-2026-05-14.tar yibovibe-server:local-2026-05-14
```

### Step 3. 把 tar 传到 NAS

把下面文件传到 NAS：

- `yibovibe-server-local-2026-05-14.tar`

### Step 4. 在 NAS 导入并更新

NAS 上通常是 Linux shell，请使用：

```bash
docker load -i /actual/path/yibovibe-server-local-2026-05-14.tar

cd /actual/path/YiboVibe/server
YIBOVIBE_API_IMAGE='yibovibe-server:local-2026-05-14' docker compose up -d api

docker compose logs api --tail=120
curl http://127.0.0.1:11434/api/v1/ping
```

如需固化，修改 `.env`：

```env
YIBOVIBE_API_IMAGE=yibovibe-server:local-2026-05-14
```

## 7. Clean Rebuild Path

适用场景：

- 怀疑本地旧镜像缓存污染了结果
- 本地 Compose / 数据库状态干扰联调判断
- 希望跳过本地联调，直接生成一份全新镜像 tar 送到 NAS

### Step 1. 清理本地本轮服务端构建产物

```powershell
cd F:\Download\GitHub\YiboVibe\server

docker compose down -v
docker image rm yibovibe-server:local-2026-05-14 -f
docker image rm yibovibe-server:local-2026-05-14-wsfix -f
```

### Step 2. 强制全新构建

```powershell
docker build --no-cache --pull -t yibovibe-server:local-2026-05-14-clean .
```

### Step 3. 导出并传到 NAS

```powershell
docker save -o F:\Download\yibovibe-server-local-2026-05-14-clean.tar yibovibe-server:local-2026-05-14-clean
```

### Step 4. NAS 导入并更新

```bash
docker load -i /actual/path/yibovibe-server-local-2026-05-14-clean.tar

cd /actual/path/YiboVibe/server
YIBOVIBE_API_IMAGE='yibovibe-server:local-2026-05-14-clean' docker compose up -d api ai_gateway

docker compose logs api --tail=120
curl --noproxy '*' http://127.0.0.1:11434/api/v1/ping
```

如果这里返回：

```json
{"message":"pong","version":"server-2026-05-18-r1"}
```

说明 NAS 已运行新服务端镜像。

## 8. Optional Public Release Flow

只有在需要对外发布稳定版本时，才使用 Docker Hub。

示例：

```bash
docker build -t datouluobo/yibovibe-server:0.9.5 .
docker tag datouluobo/yibovibe-server:0.9.5 datouluobo/yibovibe-server:latest
docker push datouluobo/yibovibe-server:0.9.5
docker push datouluobo/yibovibe-server:latest
```

注意：

- 这是发布流程，不是日常修复默认更新流程
- NAS 运行态不建议长期盲跟 `latest`

## 9. Gateway Expectations

当前 `Caddyfile` 应保证：

- `/api/*` -> `yibovibe_api:8080`
- `/share/*` -> `yibovibe_api:8080`

其他路径只返回简单响应。

## 10. Validation After Update

更新后至少验证：

```powershell
docker compose ps
docker compose logs api --tail=200
curl http://127.0.0.1:11434/
curl http://127.0.0.1:11434/api/v1/ping
```

如果有公网入口，再补一条：

```powershell
curl https://your-domain:your-port/api/v1/ping
```

WebSocket 修复类更新还应补测：

- 移动端登录
- WebSocket 握手
- 会话列表拉取

## 11. Logs

```bash
docker compose logs
docker compose logs -f
docker compose logs -f api
docker compose logs -f ai_gateway
```

## 12. Stop and Restart

```bash
docker compose stop
docker compose restart
docker compose down
```

除非你明确要清空数据，否则不要执行：

```bash
docker compose down -v
```

因为它会删除：

- PostgreSQL 数据
- Redis 数据
- Vault 数据

## 13. Backup

更新前至少备份：

- `.env`
- `docker-compose.yml`
- `Caddyfile`
- `pgdata`
- `redisdata`
- `vaultdata`

如果部署在 NAS，优先做卷级快照或目录级快照。

## 14. Notes

- 统一从 `server/` 目录执行部署命令
- 不通过 NAS UI 复制临时容器来更新
- 不把旧的 `YiboFlow` 命名继续沿用到新部署说明中
- 遇到线上行为与本地代码不一致时，先用 `/api/v1/ping` 判断线上是否真的更新到目标版本
- 文档中的 `/actual/path/...` 必须替换成你 NAS 上的真实路径后再执行
