# YiboFlow NAS 自动化准备清单

更新时间：2026-04-29

## 1. 目标

本文档用于整理后续在 NAS 上执行自动化部署、更新、检查与回滚前，需要提前准备的软件、工具、配置与权限。

目标是让后续工作可以稳定完成这些操作：

- 连接 NAS
- 检查服务端状态
- 更新 `docker-compose.yml`
- 更新 `.env`
- 拉取并重建服务容器
- 备份和回滚服务端部署文件

## 2. 推荐的最终状态

理想情况下，应达到以下状态：

1. 本机可以通过 SSH 免密连接 NAS。
2. NAS 上 Docker 与 Docker Compose 可直接使用。
3. 服务端部署目录固定且权限稳定。
4. NAS 上的部署文件与仓库中的公开版本保持一致。

满足这些条件后，后续自动化工作会明显更稳定。

## 3. NAS 侧必须准备的项目

### 3.1 开启 SSH 服务

在群晖 DSM 中启用：

- `控制面板 -> 终端机和 SNMP -> 启用 SSH 功能`

建议保留明确的 SSH 端口，默认可用 `22`。

### 3.2 固定一个可用的运维账号

建议准备一个专门用于部署维护的账号，而不是长期直接使用主管理员账号。

这个账号至少需要具备：

- 能 SSH 登录 NAS
- 能进入部署目录
- 能读取和修改：
  - `docker-compose.yml`
  - `.env`
  - `Caddyfile`
- 能执行 Docker / Docker Compose 命令

### 3.3 Docker 命令可用

至少应在 NAS 上通过以下检查：

```bash
docker --version
docker compose version
```

### 3.4 固定部署目录

建议统一使用固定路径，例如当前项目已使用：

```bash
/volume1/docker/yiboflow/server
```

后续不要频繁改动部署路径，否则会增加自动化脚本和排障成本。

## 4. 本机侧必须准备的项目

### 4.1 SSH 客户端

Windows 本机至少需要：

- `ssh`
- `scp`

你当前环境已经具备：

- `C:\Windows\System32\OpenSSH\ssh.exe`
- `C:\Windows\System32\OpenSSH\scp.exe`

### 4.2 SSH 密钥登录

这是最重要的一项准备工作。

推荐目标是：本机执行下面的命令时，不再要求输入密码：

```bash
ssh datouluobo@192.168.1.88
```

这样后续自动化更新、文件同步与状态检查才可以稳定复用。

### 4.3 可选工具

如果不走 SSH 密钥登录，次优方案是额外准备可非交互传递认证信息的工具，例如：

- `plink`

但长期来看，仍建议优先使用 SSH 密钥方式，而不是依赖每次输入密码。

## 5. 服务端部署文件要求

为了保证线上部署与仓库版本一致，NAS 上应尽量保持以下文件与仓库同步：

- [server/docker-compose.yml](/F:/Download/GitHub/YiboFlow/server/docker-compose.yml)
- [server/Caddyfile](/F:/Download/GitHub/YiboFlow/server/Caddyfile)
- [server/.env.example](/F:/Download/GitHub/YiboFlow/server/.env.example)

运行时实际密码和镜像标签仍放在 NAS 本地 `.env` 中，不应直接覆盖为仓库模板。

## 6. 权限与目录要求

运维账号应确认对部署目录具备稳定的读写权限。

至少能执行这些动作：

- 备份 `.env`
- 备份 `docker-compose.yml`
- 修改 `docker-compose.yml`
- 修改 `.env`
- 执行 `docker compose pull`
- 执行 `docker compose up -d`
- 执行 `docker compose ps`

## 7. 配置管理建议

### 7.1 `.env` 只存运行参数

建议 `.env` 里只保留运行相关参数，例如：

- 数据库用户名
- 数据库密码
- Redis 密码
- 对外端口
- API 镜像标签

### 7.2 结构配置放回仓库

这类结构性配置应尽量以仓库文件为准，而不是长期在 NAS 上手改漂移：

- `docker-compose.yml`
- `Caddyfile`

### 7.3 固定线上镜像标签

线上部署建议优先使用固定版本标签，而不是直接长期跟 `latest`。

例如：

```env
YIBOFLOW_API_IMAGE=datouluobo/yiboflow-server:2026-04-29
```

这样更利于回滚和定位问题。

## 8. 备份要求

每次更新前，至少应备份：

- `.env`
- `docker-compose.yml`
- `Caddyfile`

如需完整保障，还应记录当前运行镜像标签和容器状态。

建议保留以下信息：

- NAS IP
- SSH 端口
- 部署目录
- 当前 API 镜像 tag
- 当前 4 个容器状态
- 回滚所需的上一版配置文件名

## 9. 自动化前的检查命令

以下命令建议在每次更新前执行一次：

```bash
cd /volume1/docker/yiboflow/server
docker compose ps -a
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

预期核心容器为：

- `yiboflow_ai_gate`
- `yiboflow_api`
- `yiboflow_db`
- `yiboflow_redis`

## 10. 最小准备完成标准

如果只追求“后续能顺利自动化更新容器”，最低标准是：

1. NAS 已开启 SSH。
2. 本机可 SSH 登录 NAS。
3. 最好已配置 SSH 免密登录。
4. NAS 上 `docker` 与 `docker compose` 可用。
5. 部署目录固定为：

```bash
/volume1/docker/yiboflow/server
```

6. 运维账号对部署目录有读写权限。
7. NAS 上部署文件与仓库版本基本一致。

## 11. 下一步建议

准备完成后，建议优先做这两件事：

1. 完成群晖 SSH 免密登录配置。
2. 将 NAS 上的 `docker-compose.yml` 对齐到仓库当前版本。

配套步骤可参考：

- [docs/synology-ssh-key-setup.md](/F:/Download/GitHub/YiboFlow/docs/synology-ssh-key-setup.md)

