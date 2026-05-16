# YiboVibe Mobile — Android App

YiboVibe 移动端 Android App，作为 `Remote Console` 远程控制桌面端 Vibe Coding 环境。

## 架构

```
登录层 → LoginPage (服务端地址 / 账号 / 设备名)
主链路 → ConsolePage (单页远程控制台)
  ├── TopStatusBar     → 连接状态 / 设备 / Session / 告警
  ├── SessionChipBar   → Session 快切 + 长按操作
  ├── TerminalView     → 终端模式 (等宽日志流)
  ├── DialogView       → 对话模式 (气泡式聚合)
  ├── BottomInputArea  → 两行输入区 (输入框 + 发送)
  └── ToolBar          → 工具行 (Sessions|文件|FlowMind|图片|模式|动作|设置|更多)
辅助层 → Session Drawer / FlowMind 面板 / 快捷动作 / 更多
```

## 服务端

连接 YiboVibe Server（v2-signal 版本）:
- REST: `/api/v1/user/login`, `/api/v1/sync/devices`, `/api/v1/sync/signal/sessions`
- WS: `/api/v1/sync/ws?token=<access_token>`

## 开发

```bash
# 构建 APK (Android)
flutter build apk --debug

# 构建 Web (调试用)
flutter build web
bash scripts/post-build.sh    # 复制本地 CanvasKit (规避代理)

# 运行 Web Server
python3 -m http.server 8899 --directory build/web
```

## Build

| 产物 | 路径 |
|------|------|
| APK | `build/app/outputs/flutter-apk/app-debug.apk` |
| Web | `build/web/` |
