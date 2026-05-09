# YiboFlow 服务端更新方法

更新时间：2026-05-05

## 1. 适用范围

本文档用于更新当前 `server/` 目录下的服务端部署，包括：

- Go 后端镜像
- Caddy 网关
- PostgreSQL
- Redis
- Docker Compose 部署

适用场景：

- 本机联调
- NAS 上的 Docker 部署
- 预发布 / 正式更新

## 2. 当前服务端边界

当前服务端负责：

- 用户注册、登录、认证
- Token 刷新
- 设备管理
- Vault / 配置读写
- WebSocket 通知
- `FlowSync` 的 NAS 暂存与外链下载

当前服务端不负责：

- 第三方 AI API 网关
- `FlowProbe` 代理调用

## 3. 更新前确认

更新前先确认以下事项：

1. 客户端与服务端版本边界一致。
2. 线上不再依赖旧的 AI 代理入口。
3. 现有 `.env` 中数据库与 Redis 密码可用。
4. 已知晓当前更新会影响 `FlowSync` 的 NAS 暂存 / 外链能力。

## 4. 关键文件

更新服务端时，优先关注这些文件：

- [server/docker-compose.yml](/F:/Download/GitHub/YiboFlow/server/docker-compose.yml)
- [server/Dockerfile](/F:/Download/GitHub/YiboFlow/server/Dockerfile)
- [server/Caddyfile](/F:/Download/GitHub/YiboFlow/server/Caddyfile)
- [server/.env.example](/F:/Download/GitHub/YiboFlow/server/.env.example)
- [server/cmd/yiboflow/main.go](/F:/Download/GitHub/YiboFlow/server/cmd/yiboflow/main.go)
- [server/internal/model/staging.go](/F:/Download/GitHub/YiboFlow/server/internal/model/staging.go)
- [server/internal/api/handler/staging_handler.go](/F:/Download/GitHub/YiboFlow/server/internal/api/handler/staging_handler.go)

## 5. 更新前备份

更新前至少备份以下内容：

1. 当前 `server/.env`
2. 当前 `server/Caddyfile`
3. 当前 `server/docker-compose.yml`
4. PostgreSQL 数据卷
5. Redis 数据卷
6. Vault 数据卷

如果运行在 NAS 上，优先做卷级快照或目录级快照。

## 6. 环境变量检查

当前公开部署最基本的环境变量来自 `.env`：

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `REDIS_PASSWORD`
- `GIN_MODE`
- `GATE_PORT`
- `YIBOFLOW_API_IMAGE`

检查原则：

- `POSTGRES_PASSWORD` 必须是有效值
- `REDIS_PASSWORD` 必须是有效值
- `GIN_MODE` 生产环境使用 `release`
- `GATE_PORT` 与外部端口映射一致，默认 `11434`
- `YIBOFLOW_API_IMAGE` 应明确指向目标版本，而不是长期盲跟未知镜像

## 7. 网关配置要求

当前 `Caddyfile` 的正确状态应为：

- 将 `/api/*` 反向代理到 `yiboflow_api:8080`
- 将 `/share/*` 反向代理到 `yiboflow_api:8080`
- 其它路径只做简单响应

当前网关不应再包含：

- `/v1/*` AI 代理
- Ollama 反向代理
- 第三方模型 API 转发入口

如果线上 `Caddyfile` 仍缺少 `/share/*` 转发，`FlowSync` 外链将无法被公网或局域网用户下载。

## 8. Docker 更新步骤

推荐在 `server/` 目录执行。

### 8.1 拉取最新代码

确保当前服务端代码已更新到目标版本。

### 8.2 检查配置文件

确认：

- `.env` 已存在且内容正确
- `Caddyfile` 为当前版本
- `docker-compose.yml` 与当前代码一致

### 8.3 选择更新路径

当前 Compose 的 `api` 服务默认走 `image:` 模式，不是 `build:` 模式。

如果使用已发布镜像：

```powershell
docker compose pull
docker compose up -d
```

如果使用本地最新源码构建镜像：

```powershell
docker build -t yiboflow-server:local-2026-05-05 .
```

然后临时指定镜像并更新 `api` 容器：

```powershell
$env:YIBOFLOW_API_IMAGE='yiboflow-server:local-2026-05-05'
docker compose up -d api
```

更新完成后，如不希望当前 shell 保留该变量，可执行：

```powershell
Remove-Item Env:YIBOFLOW_API_IMAGE
```

### 8.4 不要误用的命令

当前这套 Compose 下，不应把下面命令当成默认更新方法：

```powershell
docker compose build api
```

因为 `api` 服务当前没有 `build:` 段，默认更新路径是拉取镜像，或先手动 `docker build` 再通过 `YIBOFLOW_API_IMAGE` 切换。

## 9. 更新后验证

更新后至少验证以下内容：

1. `api` 容器正常启动
2. `db` 容器健康检查通过
3. `redis` 容器健康检查通过
4. `/api/*` 请求可达
5. `/share/*` 可达
6. 登录、认证、设备、Vault 相关接口可用
7. NAS 暂存与外链能力可用
8. 不存在旧的 `/v1/*` AI 代理行为

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

```powershell
curl http://127.0.0.1:11434/
```

```powershell
curl http://127.0.0.1:11434/api/v1/ping
```

## 10. 与客户端联调的检查点

服务端更新后，再联调客户端：

1. 登录正常
2. Token 刷新正常
3. 配置保存正常
4. 配置同步正常
5. `FlowSync` 的 NAS 暂存可创建
6. `FlowSync` 外链可生成
7. `FlowSync` 外链可下载
8. `FlowProbe` 的 API Key 没有被同步到服务端配置
9. `FlowProbe` 已拉取模型列表只保存在桌面端本地配置，不依赖服务端保存
10. `FlowProbe` 本机代理关闭后，不会通过服务端兜底转发第三方模型请求

## 11. PostgreSQL 兼容性注意项

当前 `FlowSync` NAS 暂存模型里，`manifest_json` 必须保持为 PostgreSQL 可接受的类型。

本轮已经修正为：

- [server/internal/model/staging.go](/F:/Download/GitHub/YiboFlow/server/internal/model/staging.go)
  - `ManifestJSON string 'gorm:"type:text"'`

如果线上代码仍是 `longtext`，服务启动建表会报：

```text
ERROR: type "longtext" does not exist (SQLSTATE 42704)
```

## 12. 回滚方法

如果更新后出现问题，按以下顺序回滚：

1. 停止新容器
2. 恢复上一个可用版本的镜像标签或本地镜像
3. 恢复上一个可用版本的 `Caddyfile`
4. 用原来的 `.env` 重新启动
5. 如果问题涉及数据结构，再从快照恢复卷

最小回滚目标是先恢复：

- 登录可用
- 配置同步可用
- WebSocket 可用
- `/share/*` 外链下载可用

## 13. 当前版本的明确限制

当前服务端更新文档有三个明确前提：

1. 不考虑兼容旧的 AI 网关行为。
2. 不考虑为 `FlowProbe` 提供任何服务端代理支持。
3. `FlowSync` 外链能力依赖网关正确放行 `/share/*`。
4. `FlowProbe` 的模型资产、调用日志与费用统计都以桌面本机为准，不以服务端为准。

如果未来重新引入新的网关职责，必须先更新 [docs/specs.md](/F:/Download/GitHub/YiboFlow/docs/specs.md)，再改此文档。
