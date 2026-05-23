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

- 控制台：在桌面端同时运行和切换多个本机 / WSL 会话，也可以在移动端继续查看和接管这些会话
- 灵思：把常用表达、思路片段和高频操作整理得更顺手，减少重复输入和切换成本
- 接入：集中管理常用模型和 API 接口，把上游能力统一配置在桌面端
- 转发：把已经配置好的接口能力通过本机统一出口提供给其它工具使用，减少重复配置
- 烽火：在设备之间同步文本、图片、文件和结果产物，方便继续投递到当前工作流
- 键谱：按自己的习惯调整按键和快捷操作映射，让常用动作更顺手
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
