# YiboFlow NAS / 服务端私有化部署指南

更新时间：2026-05-05

## 1. 环境准备

确保服务器或 NAS 已安装：

1. Docker
2. Docker Compose v2
3. 可用对外端口，默认 `11434`

建议先验证：

```bash
docker --version
docker compose version
```

## 2. 获取部署文件

推荐直接使用仓库里的 `server/` 目录：

```bash
git clone https://github.com/datouluobo/YiboFlow.git
cd YiboFlow/server
```

如果是上传部署包，也应保证最终目录里至少包含：

- `docker-compose.yml`
- `.env.example`
- `Caddyfile`
- `Dockerfile`

## 3. 配置运行环境

先复制模板：

```bash
cp .env.example .env
```

然后修改 `.env`，至少确认这些项：

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

按需修改：

- `GATE_PORT`
- `YIBOFLOW_API_IMAGE`

## 4. 启动服务

当前公开 Compose 默认走已发布镜像，直接执行：

```bash
docker compose up -d
```

启动后应有 4 个容器：

- `yiboflow_api`
- `yiboflow_ai_gate`
- `yiboflow_db`
- `yiboflow_redis`

查看状态：

```bash
docker compose ps
```

## 5. 当前网关与入口

默认对外入口端口：

- `11434`

当前网关必须放行：

- `/api/*`
- `/share/*`

这两条都应转发到：

- `yiboflow_api:8080`

如果 `Caddyfile` 没有 `/share/*`，`FlowSync` 外链会生成成功，但别人无法通过分享链接下载。

## 6. 首次部署后验证

先验证网关存活：

```bash
curl http://127.0.0.1:11434/
```

预期返回：

```text
YiboFlow Sync Gateway is Active
```

再验证 API：

```bash
curl http://127.0.0.1:11434/api/v1/ping
```

预期返回包含：

```json
{"message":"pong","version":"v1.5"}
```

## 7. 更新到新版本

### 7.1 使用已发布镜像更新

```bash
docker compose pull
docker compose up -d
```

### 7.2 使用本地源码构建更新

如果你不是等 Docker Hub 新镜像，而是要直接部署当前仓库里的最新 `server/` 代码：

```bash
docker build -t yiboflow-server:local-2026-05-05 .
YIBOFLOW_API_IMAGE=yiboflow-server:local-2026-05-05 docker compose up -d api
```

这条路径适合：

- 本地刚修完服务端问题
- 需要先在 NAS 验证
- 尚未推送正式镜像标签

## 8. 本次重构后的重点验证项

除登录与配置同步外，至少再检查：

1. `FlowSync` NAS 暂存对象可创建
2. 外链策略可启用
3. 外链可生成
4. 外链第一次下载成功
5. 如果设置了 `max_downloads=1`，第二次下载应失败

## 9. 已知兼容性注意项

如果你部署的是包含 `FlowSync` NAS 暂存的新版本服务端，需确认仓库代码里：

- [server/internal/model/staging.go](/F:/Download/GitHub/YiboFlow/server/internal/model/staging.go:30)

当前应为：

```go
ManifestJSON string `gorm:"type:text" json:"manifest_json"`
```

如果仍是 `longtext`，PostgreSQL 启动建表会失败，并报：

```text
ERROR: type "longtext" does not exist (SQLSTATE 42704)
```

## 10. 日志与排障

常用命令：

```bash
docker compose logs -f api
docker compose logs -f ai_gateway
docker compose logs -f db
docker compose logs -f redis
```

## 11. 安全停机与回滚

停止但保留数据：

```bash
docker compose stop
```

恢复上一版镜像：

1. 把 `.env` 中 `YIBOFLOW_API_IMAGE` 改回上一版
2. 执行：

```bash
docker compose up -d
```

不要默认执行：

```bash
docker compose down -v
```

这会删除：

- PostgreSQL 数据卷
- Redis 数据卷
- Vault 数据卷

## 12. 相关文档

- [docs/server-update-guide.md](/F:/Download/GitHub/YiboFlow/docs/server-update-guide.md)
- [docs/nas-server-fixed-workflow.md](/F:/Download/GitHub/YiboFlow/docs/nas-server-fixed-workflow.md)
- [docs/specs.md](/F:/Download/GitHub/YiboFlow/docs/specs.md)
