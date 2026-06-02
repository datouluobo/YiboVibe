# YiboVibe Mobile for Android

YiboVibe Mobile is the Android remote console for a running YiboVibe desktop environment.

YiboVibe Mobile 是面向运行中 YiboVibe 桌面环境的 Android 远程控制台。

## Current Role

The mobile app is not a standalone execution host.

移动端不是独立执行宿主。

It is designed to:

- sign in to a YiboVibe Server
- list and switch desktop sessions
- create a new remote session
- send text input and quick actions
- observe long-running terminal work away from the desk
- control interactive terminal prompts from a phone

它当前用于：

- 登录 YiboVibe Server
- 查看并切换桌面会话
- 新建远程 Session
- 发送文本输入和快捷动作
- 在离开电脑时观察长时间运行的终端任务
- 在手机上处理交互式终端提示

## Current Console Views

The main console currently supports:

- `text` mode for plain terminal flow
- `dialog` mode for message-style aggregation
- `screen` mode for interactive full-screen terminal rendering

当前主控制台支持：

- 纯终端流的 `text` 模式
- 消息聚合式的 `dialog` 模式
- 交互式全屏终端渲染的 `screen` 模式

`screen` mode currently includes:

- unified bottom input bar
- quick action sheet
- fit-width and fit-height shortcuts
- pinch zoom on touch devices
- mouse-wheel zoom for browser and simulator usage

`screen` 模式当前包含：

- 统一底部输入栏
- 快捷动作弹层
- 适宽和适高快捷切换
- 触屏双指缩放
- 浏览器和模拟器下的鼠标滚轮缩放

## Main UI Structure

```text
LoginPage
  -> server address / account / password / device name

ConsolePage
  -> top session bar
  -> session chip bar
  -> terminal or dialog view
  -> bottom input area
  -> toolbar entries for Sessions / FlowMind / Quick Actions / Files / Images / More
```

```text
LoginPage
  -> 服务端地址 / 账号 / 密码 / 设备名

ConsolePage
  -> 顶部会话栏
  -> Session 切换栏
  -> 终端或对话视图
  -> 底部输入区
  -> Sessions / FlowMind / 快捷动作 / 文件 / 图片 / 更多 工具入口
```

## Server Interfaces

The Android app connects to the YiboVibe Server v2 signal stack:

Android 客户端连接到 YiboVibe Server v2 signal 链路：

- REST
  - `/api/v1/user/login`
  - `/api/v1/sync/devices`
  - `/api/v1/sync/signal/sessions`
- WebSocket
  - `/api/v1/sync/ws?token=<access_token>`

## Build

### Android release APK

```bash
flutter build apk --release
```

Output / 输出：

- `build/app/outputs/flutter-apk/app-release.apk`

## Debug Deploy Verification

When iterating on the Android app, treat version verification as a required last step.

移动端调试迭代时，版本核对必须作为固定收尾步骤，不再依赖“看起来像新包”。

Required loop / 固定闭环：

1. bump both visible version and build number
   - update `lib/app_version.dart`
   - update `pubspec.yaml`
2. run validation
   - `flutter analyze`
   - `flutter test`
   - `flutter build apk --debug`
3. verify the built APK metadata
   - use `aapt dump badging build/app/outputs/apk/debug/app-debug.apk`
   - confirm `versionCode` matches the expected build number
4. reinstall to the emulator or device
   - `adb install -r build/app/outputs/apk/debug/app-debug.apk`
   - `adb shell am force-stop com.yibovibe.yibovibe_mobile`
   - `adb shell am start -n com.yibovibe.yibovibe_mobile/.MainActivity`
5. verify inside the app UI
   - the workbench top bar must show the expected `rN` version

Important / 重要：

- Do not rely on `adb shell dumpsys package ...` alone to decide whether the newest build is running.
- `dumpsys` may lag behind or report confusing cached fields during repeated debug installs.
- Prefer `build/app/outputs/apk/debug/app-debug.apk` as the install source for verification.
- `build/app/outputs/flutter-apk/app-debug.apk` may lag behind during some debug build flows, so do not treat it as the only source of truth.
- The built APK metadata plus the in-app visible version is the source of truth for the mobile debug loop.

## Notes

- The current public mobile release line is `0.9.7`.
- Android is the current maintained mobile target in this repository.
- 当前公开移动端版本线为 `0.9.7`。
- 当前仓库内维护的移动端目标平台是 Android。
