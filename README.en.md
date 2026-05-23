# YiboVibe

[简体中文](README.md) | English

YiboVibe is a desktop-first Vibe Coding toolkit for running, observing, and remotely controlling long-lived coding sessions across desktop, mobile, and NAS environments.

## Overview

YiboVibe currently ships as a three-part system:

- Desktop: the primary execution host for local shells, WSL sessions, agent consoles, resource access, and operator UI.
- Server: the auth, signal, session, and sync hub used by desktop and mobile clients.
- Mobile: an Android remote console for checking sessions, sending commands, handling prompts, and observing long-running work away from the desk.

The current product boundary is defined by [docs/specs-v2.md](docs/specs-v2.md).

## What You Can Do Today

- Console: run and switch between multiple local or WSL sessions on desktop, and continue viewing or taking over them from mobile
- Lingsi: make frequently used expressions, idea fragments, and repeated actions easier to reuse
- Access: manage upstream models and API endpoints from one desktop-side entry
- Relay: expose configured upstream capabilities through a unified desktop-local output path
- Fenghuo: sync text, images, files, and result artifacts across devices and send them back into the current workflow
- Jianpu: adjust key behavior and shortcut mappings around your own habits so common actions feel more natural
- Deploy the server stack to a NAS or Linux host with Docker Compose

## Releases

- GitHub Releases: [Releases](https://github.com/datouluobo/YiboVibe/releases)
- Desktop artifact: Windows x64 installer
- Mobile artifact: Android APK
- Server artifact: Docker image / Docker tar package

Current public version line:

- Server: `0.9.7`
- Desktop: `0.9.7`
- Mobile: `0.9.7`

## Documentation

- Public docs index: [docs/public-docs.md](docs/public-docs.md)
- Public feature summary: [docs/features_summary.md](docs/features_summary.md)
- Product spec: [docs/specs-v2.md](docs/specs-v2.md)
- Architecture: [docs/architecture-vibe-coding.md](docs/architecture-vibe-coding.md)
- Server deployment guide: [server/README.md](server/README.md)
- NAS deployment guide: [docs/NAS部署指南.md](docs/NAS部署指南.md)
- Android app guide: [mobile/android/README.md](mobile/android/README.md)

## Repository Layout

- `core/`: shared Rust capability layer
- `desktop/`: Tauri + React desktop app
- `server/`: Go server, Docker deployment files, and update guides
- `mobile/android/`: Flutter Android remote console
- `docs/`: product, architecture, deployment, and historical engineering documents
