# YiboFlow NAS 手动更新最短步骤

更新时间：2026-05-05

适用目标：

- 你已经准备手动更新 NAS 上的 YiboFlow 服务端
- 本次重点是上线 `FlowSync` NAS 暂存 / 外链能力
- 当前本地已验证镜像标签为 `yiboflow-server:local-2026-05-05`

## 1. 进入 NAS 部署目录

```bash
cd /volume1/docker/yiboflow/server
```

## 2. 同步最新 `server/` 代码

确保 NAS 上这几个文件已经是当前版本：

- `docker-compose.yml`
- `Caddyfile`
- `.env.example`
- `Dockerfile`
- `cmd/`
- `internal/`

本次特别要确认：

- `Caddyfile` 已包含 `/share/*` -> `yiboflow_api:8080`
- `internal/model/staging.go` 里 `ManifestJSON` 是 `gorm:"type:text"`

## 3. 构建本地镜像

```bash
docker build -t yiboflow-server:local-2026-05-05 .
```

## 4. 用本地镜像更新 API 容器

```bash
YIBOFLOW_API_IMAGE=yiboflow-server:local-2026-05-05 docker compose up -d api
```

只更新 `api`，不要动 `db`、`redis` 和数据卷。

## 5. 检查容器状态

```bash
docker compose ps
```

预期至少看到：

- `yiboflow_api`
- `yiboflow_ai_gate`
- `yiboflow_db`
- `yiboflow_redis`

## 6. 检查 API 日志

```bash
docker compose logs api --tail=200
```

重点看有没有这类错误：

- `ERROR: type "longtext" does not exist`
- 数据库连接失败
- Redis 连接失败

## 7. 验证基础连通性

```bash
curl http://127.0.0.1:11434/
curl http://127.0.0.1:11434/api/v1/ping
```

预期：

- `/` 返回 `YiboFlow Sync Gateway is Active`
- `/api/v1/ping` 返回包含 `{"message":"pong","version":"v1.5"}`

## 8. 本次必查项

更新后至少确认：

1. 登录正常
2. `FlowSync` 可以创建 NAS 暂存对象
3. 可以创建外链
4. 外链第一次下载成功
5. 若设置 `max_downloads=1`，第二次下载失败

## 9. 快速回滚

如果这版有问题：

1. 改回上一版 `YIBOFLOW_API_IMAGE`
2. 执行：

```bash
docker compose up -d api
```

不要默认执行：

```bash
docker compose down -v
```

这会删掉数据库、Redis 和 Vault 数据。

## 10. 关联文档

- [docs/server-update-guide.md](/F:/Download/GitHub/YiboFlow/docs/server-update-guide.md)
- [docs/NAS部署指南.md](/F:/Download/GitHub/YiboFlow/docs/NAS部署指南.md)
- [docs/nas-server-fixed-workflow.md](/F:/Download/GitHub/YiboFlow/docs/nas-server-fixed-workflow.md)
