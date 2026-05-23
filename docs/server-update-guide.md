# YiboVibe 服务端更新指南

更新时间：2026-05-23

## 1. 适用范围

本文档用于更新当前仓库 `server/` 目录下的服务端部署，覆盖：

- Go API 服务
- Caddy 网关
- PostgreSQL
- Redis
- Docker Compose 栈

适用场景：

- 本机联调
- NAS 上的 Docker/Compose 部署
- 修复后快速替换线上容器

如果在 Windows 桌面环境执行本机构建、导出镜像或 Compose 更新命令，先手动启动 `Docker Desktop`，并确认它已经进入运行状态。

## 2. 当前更新策略

当前日常更新默认不要走下面这条路径：

- 本机构建
- 推送 Docker Hub
- 等待 NAS `docker pull`

原因：

- Hub 新标签在 NAS 上可能延迟可见
- `latest` 容易掩盖版本差异
- 紧急修复时回路太长

当前默认主路径只保留两条：

1. 本机把最新源码同步到 NAS，然后在 NAS 本地构建并更新
2. 本机先构建镜像并导出 tar，再把 tar 传到 NAS 导入并更新
3. 当怀疑本地旧镜像或本地联调状态影响判断时，先在本机删除本轮构建产物，再强制全新构建后传到 NAS 更新

Docker Hub 发布只保留给正式对外发版，不作为默认修复流程。

## 2.1 镜像命名约定

当前统一保留两类命名：

- 日期标签：用于日常调试、修复验证、临时镜像
- 版本号标签：用于正式发布、对外分发、稳定归档

示例：

- 日常调试：`yibovibe-server:local-2026-05-14`
- 日常调试重建：`yibovibe-server:local-2026-05-14-clean`
- 正式发布：`datouluobo/yibovibe-server:0.9.7`

规则：

- 本机与 NAS 日常更新优先使用日期标签
- Docker Hub 发布优先使用版本号标签
- `latest` 只作为附加发布标签，不作为日常修复默认依据

## 3. 更新前确认

更新前先确认：

1. 客户端与服务端边界一致。
2. `.env` 中数据库和 Redis 密码仍然有效。
3. 当前更新会影响登录、WebSocket、配置同步或 `FlowSync` 能力时，已安排验证时间。
4. 已准备好 NAS 上的回滚点或卷快照。
5. 如果在 Windows 本机执行 `docker build`、`docker save` 或 `docker compose`，`Docker Desktop` 已启动且 Engine running。

## 4. 关键文件

优先关注：

- [server/docker-compose.yml](/F:/Download/GitHub/YiboVibe/server/docker-compose.yml)
- [server/Dockerfile](/F:/Download/GitHub/YiboVibe/server/Dockerfile)
- [server/Caddyfile](/F:/Download/GitHub/YiboVibe/server/Caddyfile)
- [server/.env.example](/F:/Download/GitHub/YiboVibe/server/.env.example)
- [server/cmd/yibovibe/main.go](/F:/Download/GitHub/YiboVibe/server/cmd/yibovibe/main.go)
- [server/internal/api/middleware/auth_middleware.go](/F:/Download/GitHub/YiboVibe/server/internal/api/middleware/auth_middleware.go)

补充约定：

- 每次服务端更新时，同步更新 [server/cmd/yibovibe/main.go](/F:/Download/GitHub/YiboVibe/server/cmd/yibovibe/main.go) 里的 `serverVersion`
- `/api/v1/ping` 返回的 `version` 以 `serverVersion` 为准，用于判断 NAS 是否真的切到目标服务端版本

## 5. 更新前备份

至少备份：

1. `server/.env`
2. `server/Caddyfile`
3. `server/docker-compose.yml`
4. `pgdata`
5. `redisdata`
6. `vaultdata`

如果运行在 NAS 上，优先做卷级快照或目录级快照。

## 6. 环境变量检查

当前部署最关键的环境变量有：

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `REDIS_PASSWORD`
- `GIN_MODE`
- `GATE_PORT`
- `YIBOVIBE_API_IMAGE`

检查原则：

- `POSTGRES_PASSWORD` 必须有效
- `REDIS_PASSWORD` 必须有效
- 生产环境使用 `GIN_MODE=release`
- `GATE_PORT` 与实际暴露端口一致
- `YIBOVIBE_API_IMAGE` 必须指向本次准备上线的明确镜像名

## 7. 网关配置要求

当前 `Caddyfile` 应满足：

- `/api/*` 反向代理到 `yibovibe_api:8080`
- `/share/*` 反向代理到 `yibovibe_api:8080`
- 其它路径只做简单响应

当前网关不应承担：

- 第三方模型 API 转发
- Ollama 网关
- AI 代理职责

## 8. 推荐更新路径 A

### 场景

- NAS 上已有最新源码
- 或你可以把最新 `server/` 目录同步到 NAS
- 希望在 NAS 本地构建

### 步骤

在 NAS 的 `server/` 目录执行：

```powershell
docker build -t yibovibe-server:local-2026-05-14 .

$env:YIBOVIBE_API_IMAGE='yibovibe-server:local-2026-05-14'
docker compose up -d api
```

如果希望后续重启仍固定使用该镜像，把 `.env` 改成：

```env
YIBOVIBE_API_IMAGE=yibovibe-server:local-2026-05-14
```

然后再次执行：

```powershell
docker compose up -d api
```

### 优点

- 更新闭环最短
- 不依赖 Docker Hub 可见性
- 最适合修复类更新

## 9. 推荐更新路径 B

### 场景

- 不想在 NAS 上同步完整源码
- 本机构建更方便
- 只想把镜像结果传到 NAS

### 步骤 1. 本机构建镜像

先确认 `Docker Desktop` 已经启动。

推荐先执行：

```powershell
docker version
```

如果这里出现 `failed to connect to the docker API`、`dockerDesktopLinuxEngine` 或类似报错，先打开 `Docker Desktop`，等它进入运行状态后再继续。

```powershell
cd F:\Download\GitHub\YiboVibe\server
docker build -t yibovibe-server:local-2026-05-14 .
```

### 步骤 2. 本机导出镜像 tar

```powershell
docker save -o F:\Download\yibovibe-server-local-2026-05-14.tar yibovibe-server:local-2026-05-14
```

### 步骤 3. 把 tar 传到 NAS

需要传输的文件：

- `yibovibe-server-local-2026-05-14.tar`

### 步骤 4. NAS 导入并更新

NAS shell 通常不是 PowerShell，请使用 Linux shell 写法：

```bash
docker load -i /actual/path/yibovibe-server-local-2026-05-14.tar

cd /actual/path/YiboVibe/server
YIBOVIBE_API_IMAGE='yibovibe-server:local-2026-05-14' docker compose up -d api
```

如需固化，同样修改 `.env`：

```env
YIBOVIBE_API_IMAGE=yibovibe-server:local-2026-05-14
```

## 10. 推荐更新路径 C

### 场景

- 怀疑本地已有旧镜像导致误判
- 本地 Compose / 数据库状态影响联调结果
- 希望直接生成一份“全新重建”的镜像 tar 提交给 NAS

### 步骤 1. 清理本地本轮构建产物

```powershell
cd F:\Download\GitHub\YiboVibe\server

docker compose down -v
docker image rm yibovibe-server:local-2026-05-14 -f
docker image rm yibovibe-server:local-2026-05-14-wsfix -f
```

### 步骤 2. 强制全新构建

```powershell
docker build --no-cache --pull -t yibovibe-server:local-2026-05-14-clean .
```

### 步骤 3. 导出 tar

```powershell
docker save -o F:\Download\yibovibe-server-local-2026-05-14-clean.tar yibovibe-server:local-2026-05-14-clean
```

### 步骤 4. NAS 导入并更新

```bash
docker load -i /actual/path/yibovibe-server-local-2026-05-14-clean.tar

cd /actual/path/YiboVibe/server
YIBOVIBE_API_IMAGE='yibovibe-server:local-2026-05-14-clean' docker compose up -d api ai_gateway

docker compose logs api --tail=120
curl --noproxy '*' http://127.0.0.1:11434/api/v1/ping
```

如果返回：

```json
{"message":"pong","version":"0.9.7"}
```

则说明新镜像已在 NAS 生效。

## 11. 不推荐作为默认更新路径的方案

下面方案不要再当作修复类更新默认路径：

```powershell
docker pull datouluobo/yibovibe-server:latest
docker compose up -d api
```

以及：

```powershell
docker push datouluobo/yibovibe-server:latest
```

再等待 NAS 上 `pull`。

原因：

- 传播延迟不可控
- `latest` 不利于核对实际版本
- 紧急修复时排障成本更高

## 12. 更新后验证

至少执行：

```powershell
docker compose ps
docker compose logs api --tail=200
docker compose logs ai_gateway --tail=100
curl http://127.0.0.1:11434/
curl http://127.0.0.1:11434/api/v1/ping
```

如果有公网入口，再执行：

```powershell
curl https://your-domain:your-port/api/v1/ping
```

如果是 WebSocket 相关修复，再补测：

1. 移动端登录
2. WebSocket 握手
3. 会话列表拉取
4. 指令下发

## 13. 与客户端联调检查点

服务端更新后至少确认：

1. 登录正常
2. Token 鉴权正常
3. WebSocket 握手正常
4. 配置同步正常
5. `FlowSync` 暂存正常
6. `FlowSync` 外链可下载
7. `FlowProbe` 不会误走服务端代理

## 14. 回滚方法

如果更新后出现问题：

1. 停掉新 `api` 容器
2. 切回上一个可用镜像名
3. 恢复上一个可用 `.env`
4. 必要时恢复 `Caddyfile`
5. 如果涉及结构或数据问题，再从快照恢复卷

最小回滚目标是先恢复：

- 登录
- 鉴权
- WebSocket
- `FlowSync` 下载

## 15. 注意事项

- 统一从 `server/` 目录执行命令
- 不通过 NAS 界面临时复制容器来更新
- 不使用 `docker compose down -v` 作为常规更新命令
- 遇到“本地已修但线上行为不变”时，先检查 `/api/v1/ping` 是否已反映新版本响应
- 文档中的 `/actual/path/...` 只是占位符，执行前必须替换成 NAS 上的真实路径
