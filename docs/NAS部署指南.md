# YiboFlow NAS / 服务端私有化部署指南

YiboFlow 的服务端模块（Backend Engine）被设计为一套纯净、超轻量且具有军工级安全隔离的 Docker 架构。
你可以花不到 3 分钟的时间，将它一键部署在你的群晖（Synology）、绿联、极空间、树莓派或任何支持 Docker 的 Linux 云主机上。

---

## 🧩 1. 环境准备
确保你的服务器或 NAS 上已经正确安装了以下组件：
1. **Docker** (负责隔离运行容器)
2. **Docker Compose** (至少为 v2 版本，负责编排与多容器网络组织)
3. 开放对应的内部测试或公网端口（默认 `8080`），并在防火墙/路由器处放行。

---

## 📦 2. 获取部署文件
你不需要下载和编译 YiboFlow 海量的源码。服务端运行只需要 `server` 目录下的核心文件。
你可以通过以下两种方式之一获取：

**方式一：通过 Git 克隆 (推荐服务器使用)**
```bash
git clone https://github.com/datouluobo/YiboFlow.git
cd YiboFlow/server
```

**方式二：直接下载部署包包**
从 GitHub Releases 页面下载最新的 `yiboflow-server-docker.zip`，解压后通过 NAS 面板或 SFTP (如 FinalShell) 将文件夹上传至你的 NAS 目录（如 `/volume1/docker/yiboflow`），并使用终端 `cd` 进入该目录。

---

## 🔐 3. 配置安全密钥 (极度重要)
为了防范勒索病毒和网络扫描，YiboFlow 绝不会把数据库 (Postgres) 和 缓存 (Redis) 的端口暴露到公网。同时，你需要为它们设置你自己的极强密码。

1. 在 `server` 目录下，找到 `.env.example` 文件。
2. 将其复制或重命名为 **`.env`** (注意前面有一个点，它是隐藏环境文件)。
3. 使用文本编辑器（或 `nano .env` / `vim .env`）打开它，配置如下关键信息：

```ini
# ================= 1. PostgreSQL 核心数据库设置 ================= 
POSTGRES_USER=yibo_admin
# 【务必修改】修改为一个极长极安全的大小写+符号组合密码
POSTGRES_PASSWORD=your_super_strong_db_password
POSTGRES_DB=yiboflow

# ================= 2. Redis 内存缓存层设置 ================= 
# 【务必修改】Redis没有密码在公网裸奔等于立刻中招，请设置强密码
REDIS_PASSWORD=your_super_strong_redis_password

# ================= 3. YiboFlow 守护进程设置 ================= 
# 对外暴露通信的端口，默认为 8080
PORT=8080
GIN_MODE=release
```

---

## 🚀 4. 一键构建与启动
在确保终端位于存有 `docker-compose.yml` 和 `.env` 的目录下，输入以下组装启动指令：

```bash
# --build 参数会让 Docker 在本地自动拉取超轻量的 Alpine 基础环境
# 并在几秒钟内纯净安全地编译出专属你的后端二进制黑盒引擎
docker-compose up -d --build
```

**启动成功后的验证机制：**
你可以输入 `docker-compose ps` 来查看服务状态，当看到如下绿色的 `Healthy` 与 `Up` 标志，说明安全防线与系统已全面就绪：
```text
NAME             IMAGE                 STATUS
yiboflow_db      postgres:15-alpine    Up (healthy) 
yiboflow_redis   redis:7-alpine        Up (healthy)
yiboflow_api     yiboflow_api          Up 
```

---

## 🔌 5. 客户端连接与后续维护

### 桌面端 / 移动端连接设置
现在，你可以打开您自己的 `YiboFlow Desktop` 或移动端 App。
在 **"Server URL"** 一栏中，填入您的 NAS/服务器地址：
* **局域网使用**：`http://192.168.x.x:8080` (取决于您 NAS 在家里的 IP)
* **公网域名穿透**：`https://yibo.yourdomain.com` (需要您自行通过 Nginx/反向代理配置证书，并将请求转发至 8080 端口)

### 如何安全停机与备份？
如果您需要重启 NAS、对服务器进行常规维护，或者想要升级 YiboFlow 版本：

**停止系统 (但保留所有数据)**：
```bash
docker-compose stop
```

**更新为最新版本** (假定你使用 git)：
```bash
git pull origin main
docker-compose up -d --build
```

**彻底删库移除系统 (警告：抹除所有剪切板和帐号关联)**：
```bash
# 慎用：将彻底摧毁 yiboflow_net 隔离网络与相关的 pgdata / redisdata 数据卷
docker-compose down -v
```
