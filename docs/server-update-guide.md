# YiboFlow 服务端更新方法

更新时间：2026-04-28

## 1. 适用范围

本文档用于更新当前 `server/` 目录下的服务端部署，包括：

- Go 后端
- Caddy 网关
- PostgreSQL
- Redis
- Docker Compose 部署

适用场景：

- 本机联调
- NAS 上的 Docker 部署
- 预发布 / 正式更新

## 2. 当前更新目标

当前服务端更新的核心目标是：

- 保持服务端只负责登录、认证、配置保存与同步
- 移除任何第三方 AI API 网关职责
- 保证 `FlowProbe` 改为客户端本机直连测试后，部署边界与代码一致

## 3. 更新前确认

更新前先确认以下事项：

1. 客户端也会同步更新。
2. 线上不再依赖旧的 AI 代理入口。
3. 现有 `.env` 中数据库与 Redis 密码可用。
4. 已知晓当前更新不会迁移任何 AI 网关配置。

## 4. 关键文件

更新服务端时，优先关注这些文件：

- [server/docker-compose.yml](/F:/Download/GitHub/YiboFlow/server/docker-compose.yml)
- [server/Dockerfile](/F:/Download/GitHub/YiboFlow/server/Dockerfile)
- [server/Caddyfile](/F:/Download/GitHub/YiboFlow/server/Caddyfile)
- [server/.env.example](/F:/Download/GitHub/YiboFlow/server/.env.example)

业务代码入口：

- [server/cmd/yiboflow/main.go](/F:/Download/GitHub/YiboFlow/server/cmd/yiboflow/main.go)

## 5. 更新前备份

更新前至少备份以下内容：

1. 当前 `server/.env`
2. 当前 `server/Caddyfile`
3. PostgreSQL 数据卷
4. Redis 数据卷
5. Vault 数据卷

如果运行在 NAS 上，优先做卷级快照或目录级快照。

## 6. 环境变量检查

当前最基本的环境变量来自 `.env`：

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `REDIS_PASSWORD`
- `PORT`
- `GIN_MODE`

检查原则：

- `POSTGRES_PASSWORD` 必须是有效值
- `REDIS_PASSWORD` 必须是有效值
- `PORT` 与外部反向代理或 NAS 端口映射一致
- `GIN_MODE` 生产环境使用 `release`

## 7. 网关配置要求

当前 `Caddyfile` 的正确状态应为：

- 只将 `/api/*` 反向代理到 `yiboflow_api:8080`
- 不再代理 `/v1/*`
- 不再代理 Ollama
- 不再声明 AI 相关认证头透传逻辑

如果发现线上 `Caddyfile` 仍存在旧 AI 代理规则，先替换掉，再继续发布客户端。

## 8. Docker 更新步骤

推荐在 `server/` 目录执行。

### 8.1 拉取最新代码

确保当前服务端代码已更新到目标版本。

### 8.2 检查配置文件

确认：

- `.env` 已存在且内容正确
- `Caddyfile` 为当前版本
- `docker-compose.yml` 与 `Dockerfile` 与当前代码一致

### 8.3 重建镜像

推荐命令：

```powershell
docker compose build api
```

如果要连同其他服务一起重建：

```powershell
docker compose build
```

### 8.4 启动或更新服务

```powershell
docker compose up -d
```

如果只是刷新 API 容器，也可以：

```powershell
docker compose up -d api
```

## 9. 更新后验证

更新后至少验证以下内容：

1. `api` 容器正常启动
2. `db` 容器健康检查通过
3. `redis` 容器健康检查通过
4. `/api/*` 请求可达
5. 登录、认证、设备、Vault 相关接口可用
6. 不存在旧的 `/v1/*` AI 代理行为

建议验证命令：

```powershell
docker compose ps
```

```powershell
docker compose logs api --tail=200
```

```powershell
docker compose logs db --tail=100
```

```powershell
docker compose logs redis --tail=100
```

## 10. 与客户端联调的检查点

服务端更新后，再联调客户端：

1. 登录正常
2. Token 刷新正常
3. 配置保存正常
4. 配置同步正常
5. `FlowProbe` 测试目标列表可按设计保存
6. `FlowProbe` 的 API Key 没有被同步到服务端配置

## 11. 回滚方法

如果更新后出现问题，按以下顺序回滚：

1. 停止新容器
2. 恢复上一个可用版本的代码或镜像
3. 恢复上一个可用版本的 `Caddyfile`
4. 用原来的 `.env` 重新启动
5. 如果问题涉及数据结构，再从快照恢复卷

最小回滚目标是先恢复：

- 登录可用
- 配置同步可用
- WebSocket 可用

## 12. 当前版本的明确限制

当前服务端更新文档有两个明确前提：

1. 不考虑兼容旧的 AI 网关行为。
2. 不考虑为 `FlowProbe` 提供任何服务端代理支持。

如果未来重新引入服务端中转能力，必须先更新 `docs/specs.md`，再改此文档。
