---
description: 启动 Tauri 开发模式（含 Vite 热重载）
---

# 启动开发环境

// turbo-all

1. 终止残留进程
```powershell
taskkill /F /IM tauri-app.exe /T 2>$null
```

2. 启动 Tauri Dev（Vite HMR + Rust 后端）
```powershell
cd f:\Download\GitHub\YiboFlow\desktop && npx tauri dev
```

> 前端 TSX/CSS 修改自动热更新，Rust 改动自动增量编译重启。
