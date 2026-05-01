# YiboFlow NAS 服务端固定操作流程

更新时间：2026-04-30

## 1. 目标

本文档固定当前 YiboFlow 服务端在 NAS 上的更新与验证流程。

核心约定：

- 本机侧命令只在 `PowerShell` 执行
- NAS 侧命令只在 `bash` 执行（例如 FinalShell）
- 不再在本机 PowerShell 中先 SSH 登录 NAS 再混合执行命令

这样做的目标是：

- 减少本机与 NAS 环境混淆
- 减少 `127.0.0.1`、路径、权限与 shell 语法误判
- 固定服务端源码同步、镜像重建和接口验证方法

## 2. 当前适用场景

本文档适用于当前这套部署方式：

- 服务端部署目录：`/volume1/docker/yiboflow/server`
- 服务端以 Docker Compose 运行
- `api` 容器可以在 NAS 本地重建
- 本机仓库目录：`F:\Download\GitHub\YiboFlow`

## 3. 两侧职责

### 3.1 本机 PowerShell 负责

- 打包本地最新 `server/` 源码
- 通过 `scp` 上传压缩包到 NAS

### 3.2 NAS bash 负责

- 解压同步后的服务端源码
- 执行 `docker build`
- 执行 `docker compose up -d api`
- 在容器内验证接口

## 4. 禁止混用的规则

以下习惯后续应避免：

1. 在本机 PowerShell 里先 SSH 登录 NAS，再把它当成本机 shell 使用。
2. 在 NAS shell 里执行本机路径命令，例如 `F:\...`。
3. 在容器内执行 `docker compose ...`。
4. 在 NAS 主机上直接用 `http://127.0.0.1:8080` 验证 `api`，但又忘记 `api` 没有映射到主机端口。

## 5. 本机 PowerShell 固定流程

### 5.1 进入仓库目录

```powershell
Set-Location F:\Download\GitHub\YiboFlow
```

### 5.2 打包当前服务端源码

```powershell
tar -czf server-sync-2026-04-30.tgz `
  server\cmd `
  server\internal `
  server\migrations `
  server\.dockerignore `
  server\.env.example `
  server\Caddyfile `
  server\docker-compose.yml `
  server\Dockerfile `
  server\go.mod `
  server\go.sum `
  server\README.md
```

### 5.3 上传到 NAS

将 `datouluobo@Lis-NAS4600` 替换为当前可用的 NAS SSH 登录目标：

```powershell
scp .\server-sync-2026-04-30.tgz datouluobo@Lis-NAS4600:/volume1/docker/yiboflow/
```

## 6. NAS bash 固定流程

### 6.1 解压同步包

```bash
cd /volume1/docker/yiboflow
tar -xzf server-sync-2026-04-30.tgz -C .
```

### 6.2 进入服务端目录

```bash
cd /volume1/docker/yiboflow/server
```

### 6.3 修正 `.dockerignore`

当前 NAS 上 `server/` 目录下可能存在不应进入 build context 的大目录或本地二进制，例如：

- `ollama_data`
- `yiboflow_server`
- `yiboflow_server_linux`
- `server.exe`
- `yiboflow.exe`
- `yiboflow_server.exe`

构建前应先确认 `.dockerignore` 至少包含这些排除项：

```bash
cat > .dockerignore <<'EOF'
.git
.gitignore
.env
.env.*
*.log
*.txt
*.tmp
*.zip
*.tar
*.gz

ollama_data

yiboflow_server
yiboflow_server_linux
server.exe
yiboflow.exe
yiboflow_server.exe

pgdata
redisdata
vault_data
tmp
dist
bin
target
node_modules
EOF
```

如果后续再次同步源码后发现 `Sending build context to Docker daemon` 体积异常增大，优先重新检查这一节，而不是先怀疑 Docker 本身。

### 6.4 本地重建 API 镜像

```bash
docker build -t yiboflow-server:local-2026-04-30 .
```

### 6.5 使用本地镜像重建 API 容器

```bash
YIBOFLOW_API_IMAGE=yiboflow-server:local-2026-04-30 docker compose up -d api
```

这一步只会重建 `api` 容器，不应删除 `db`、`redis` 或相关卷。

## 7. 容器与数据的边界

当前 `api` 容器可重建，但不要误删卷。

重点区分：

- 可以重建 `api` 容器
- 不要执行 `docker compose down -v`
- 不要为了重建 `api` 去删除 PostgreSQL、Redis 或 Vault 卷

当前 Compose 里的关键持久化卷包括：

- `pgdata`
- `redisdata`
- `vaultdata`

## 8. 固定验证流程

### 8.1 先验证当前镜像版本对应的新代码是否已生效

```bash
docker exec -i yiboflow_api sh -lc 'wget -qO- http://127.0.0.1:8080/api/v1/ping'
```

当前正确结果应包含：

```json
{"message":"pong","version":"v1.5"}
```

如果这里仍返回旧版本，例如 `v1.3`，说明 NAS 上参与构建的源码仍然不是本机当前版本。

### 8.2 验证登录返回是否包含 `role`

```bash
docker exec -i yiboflow_api sh -lc 'wget -qO- --header="Content-Type: application/json" --post-data='\''{"username":"admin","password":"你的密码","device_name":"nas-check","device_type":"linux","device_fingerprint":"nas-check-001"}'\'' http://127.0.0.1:8080/api/v1/user/login'
```

当前正确结果中应包含：

- `"role":"admin"` 或 `"role":"user"`
- `"access_token":"..."`

### 8.3 验证 `/api/v1/user/me`

将上一步拿到的 `access_token` 替换到下面命令里：

```bash
docker exec -i yiboflow_api sh -lc 'wget -qO- --header="Authorization: Bearer 这里替换成access_token" http://127.0.0.1:8080/api/v1/user/me'
```

当前正确结果应包含：

- `uid`
- `username`
- `role`
- `status`

## 9. 这次已确认过的坑

### 9.1 NAS 本地 `docker build` 不等于最新源码

如果 NAS 上的 `server/` 目录本身是旧代码，那么即使成功执行了：

```bash
docker build -t yiboflow-server:local-2026-04-30 .
```

得到的仍然只是“基于 NAS 本地旧源码构建的本地镜像”。

因此：

- 本地镜像成功构建
- 不等于已经拿到了本机最新代码

### 9.2 `ollama_data` 会污染 build context

如果 `ollama_data` 放在 `/volume1/docker/yiboflow/server` 下，且 `.dockerignore` 没排除它，`docker build .` 会把它一起打包发送给 Docker daemon。

表现通常是：

- `Sending build context to Docker daemon 6GB+`
- 构建明显变慢
- 还可能掩盖真正的问题

当前阶段先通过 `.dockerignore` 排除它；是否迁移 `ollama_data` 目录，后续再单独处理。

### 9.3 容器内验证要用正确路由

当前登录路由是：

- `POST /api/v1/user/login`

不是：

- `POST /api/v1/auth/login`

当前用户信息路由是：

- `GET /api/v1/user/me`

### 9.4 容器内不能直接跑 Docker 命令

进入 `yiboflow_api` 容器后，只能执行容器内已有命令。

例如：

- `wget`
- `sh`

不能在容器内执行：

```bash
docker compose ps
```

这类命令必须回到 NAS 主机 shell 执行。

## 10. 后续默认执行约定

后续如果需要给服务端相关命令，统一使用以下标识：

- `PowerShell`：本机电脑执行
- `bash`：NAS 侧 FinalShell 执行

除非特别说明，不再混用两侧环境。
