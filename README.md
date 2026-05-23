# YiboVibe

YiboVibe is a desktop-first Vibe Coding toolkit for running, observing, and remotely controlling long-lived coding sessions across desktop, mobile, and NAS environments.

YiboVibe 是一套桌面优先的 Vibe Coding 工具链，用来在桌面端、移动端和 NAS 环境之间持续运行、观察并远程控制长期存在的编码会话。

## Overview

YiboVibe currently ships as a three-part system:

- Desktop: the primary execution host for local shells, WSL sessions, agent consoles, resource access, and operator UI.
- Server: the auth, signal, session, and sync hub used by desktop and mobile clients.
- Mobile: an Android remote console for checking sessions, sending commands, handling prompts, and observing long-running work away from the desk.

YiboVibe 当前由三部分组成：

- 桌面端：真正的执行宿主，负责本机 Shell、WSL 会话、Agent 控制台、资源访问和主操作界面。
- 服务端：负责登录鉴权、WebSocket 信令、会话同步和跨端路由。
- 移动端：Android 远程控制台，用于离开电脑后查看会话、发令、处理交互提示和观察后台任务。

## Current Product Scope

The current product boundary is defined by [docs/specs-v2.md](docs/specs-v2.md).

Active modules:

- `FlowDeck`
- `FlowSnap`
- `FlowHint`
- `FlowSync`
- `FlowDrop`
- `FlowRules`
- `FlowKeys`
- `FlowProbe`
- `Settings`

Key constraints:

- The desktop app is the execution host. The server is not an AI gateway.
- `FlowProbe` is a desktop-side upstream API testing and relay tool, not the main product backbone.
- The mobile app is a remote console, not a standalone execution environment.

## What You Can Do Today

- Run and manage multiple terminal sessions from the desktop app.
- View and control those sessions remotely from Android.
- Switch between text, dialog, and screen-oriented console views on mobile.
- Use quick actions for interactive prompts such as Enter, Ctrl+C, arrows, Tab, Esc, paste, and select all.
- Use `FlowSync` for asset and result delivery across devices.
- Use `FlowProbe` to manage and inspect upstream model/API assets from the desktop machine.
- Deploy the server stack to a NAS or Linux host with Docker Compose.

## Install And Release

- GitHub Releases: [Releases](https://github.com/datouluobo/YiboVibe/releases)
- Desktop build target: Windows x64
- Mobile build target: Android APK
- Server release target: Docker image / Docker tar package

Current public release line:

- Server: `0.9.7`
- Desktop: `0.9.7`
- Mobile: `0.9.7`

## Documentation

- Public feature summary: [docs/features_summary.md](docs/features_summary.md)
- Public docs index: [docs/public-docs.md](docs/public-docs.md)
- Product spec: [docs/specs-v2.md](docs/specs-v2.md)
- Architecture: [docs/architecture-vibe-coding.md](docs/architecture-vibe-coding.md)
- Console UI guidelines: [docs/ui-console-guidelines.md](docs/ui-console-guidelines.md)
- Server deployment guide: [server/README.md](server/README.md)
- NAS deployment guide: [docs/NAS部署指南.md](docs/NAS部署指南.md)
- Server update guide: [docs/server-update-guide.md](docs/server-update-guide.md)
- Documentation index: [docs/documentation-index.md](docs/documentation-index.md)
- Engineering archive index: [docs/archive-index.md](docs/archive-index.md)

## Repository Layout

- `core/`: shared Rust capability layer
- `desktop/`: Tauri + React desktop app
- `server/`: Go server, Docker deployment files, and update guides
- `mobile/android/`: Flutter Android remote console
- `docs/`: product, architecture, UI, deployment, and historical design documents

## Notes

- Public-facing docs have been aligned to the `YiboVibe` brand and the `0.9.7` release line.
- Some historical design reports in `docs/` still describe older migration context. They are retained as engineering records, not as the current public product definition.
