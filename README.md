# YiboVibe

简体中文 | [English](README.en.md)

YiboVibe 是一套桌面优先的 Vibe Coding 工具链，用来在桌面端、移动端和 NAS 环境之间持续运行、观察并远程控制长期存在的编码会话。

## 产品简介

YiboVibe 当前由三部分组成：

- 桌面端：真正的执行宿主，负责本机 Shell、WSL 会话、Agent 控制台、资源访问和主操作界面。
- 服务端：负责登录鉴权、WebSocket 信令、会话同步和跨端路由。
- 移动端：Android 远程控制台，用于离开电脑后查看会话、发令、处理交互提示和观察后台任务。

当前产品边界以 [docs/specs-v2.md](docs/specs-v2.md) 为准。

## 当前可以做什么

- 在桌面端运行和管理多 Session 终端会话
- 在 Android 上远程查看并控制这些会话
- 在移动端切换 `text`、`dialog`、`screen` 三种控制台视图
- 用快捷动作处理 Enter、Ctrl+C、方向键、Tab、Esc、粘贴、全选等交互场景
- 使用 `FlowSync` 做跨设备资源与结果同步
- 使用 `FlowProbe` 在桌面端管理和检查上游模型/API 资产
- 用 Docker Compose 把服务端部署到 NAS 或 Linux 主机

## 下载与发布

- GitHub Releases: [Releases](https://github.com/datouluobo/YiboVibe/releases)
- 桌面端发布形态：Windows x64 安装包
- 移动端发布形态：Android APK
- 服务端发布形态：Docker 镜像 / Docker tar 包

当前公开版本线：

- 服务端：`0.9.7`
- 桌面端：`0.9.7`
- 移动端：`0.9.7`

## 文档入口

- 公开文档总入口：[docs/public-docs.md](docs/public-docs.md)
- 公开功能摘要：[docs/features_summary.md](docs/features_summary.md)
- 产品规格：[docs/specs-v2.md](docs/specs-v2.md)
- 架构说明：[docs/architecture-vibe-coding.md](docs/architecture-vibe-coding.md)
- 服务端部署说明：[server/README.md](server/README.md)
- NAS 部署说明：[docs/NAS部署指南.md](docs/NAS部署指南.md)
- Android 客户端说明：[mobile/android/README.md](mobile/android/README.md)

## 仓库结构

- `core/`：共享 Rust 能力层
- `desktop/`：Tauri + React 桌面端
- `server/`：Go 服务端、Docker 部署文件和更新说明
- `mobile/android/`：Flutter Android 远程控制台
- `docs/`：产品、架构、部署和历史工程文档

## English Version

For an English-first overview, see [README.en.md](README.en.md).
