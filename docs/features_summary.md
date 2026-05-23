# YiboVibe Public Feature Summary

Updated: 2026-05-24

更新时间：2026-05-24

## 1. Product Positioning

YiboVibe is a Vibe Coding infrastructure stack for independent developers and AI-assisted programmers.

It is not just a chat window, and it is not a cloud code execution platform. The current product backbone is:

- Desktop as the execution host
- Server as the signal and sync hub
- Mobile as the remote console

The goal is to keep the same coding context, terminal state, and session control available even when the user is away from the main computer.

## 1. 产品定位

YiboVibe 是一套面向独立开发者与 AI 辅助程序员的 `Vibe Coding` 基础设施。

它不是单独的聊天窗口，也不是云端代码执行平台。当前产品主线是：

- 桌面端作为执行宿主
- 服务端作为信令与同步中枢
- 移动端作为远程控制台

目标是在离开电脑时，仍能持续持有同一个编码上下文、终端状态和会话控制权。

## 2. Responsibilities By Surface

### 2.1 Desktop

The desktop app is the main execution surface. It is responsible for:

- starting and hosting local and WSL sessions
- managing multiple session consoles
- receiving remote input
- capturing output, status, and context
- accessing local files and resources
- hosting desktop-first capabilities such as `FlowProbe` and `FlowSync`

### 2.2 Server

The server is responsible for:

- login and authentication
- device and session sync
- WebSocket signal routing
- `FlowSync` staging and share delivery

The server does not act as a third-party AI API gateway and is not the main execution host.

### 2.3 Mobile

The mobile app currently works as an Android remote console. It is responsible for:

- viewing and switching sessions
- sending text and quick actions
- handling interactive terminal prompts
- observing long-running agent and shell work
- taking over a running desktop session from a phone

## 2. 三端职责

### 2.1 桌面端

桌面端是系统的主执行端，负责：

- 启动和托管本机 / WSL 会话
- 管理多 Session 控制台
- 接收远程输入
- 采集输出、状态和上下文
- 调用本地文件和资源能力
- 承载 `FlowProbe`、`FlowSync` 等桌面主能力

### 2.2 服务端

服务端负责：

- 登录与鉴权
- 设备与会话同步
- WebSocket 信令路由
- `FlowSync` 暂存与分享链路

服务端不负责第三方 AI API 代理，也不是主业务执行宿主。

### 2.3 移动端

移动端当前是 Android 远程控制台，负责：

- 查看和切换 Session
- 发送文本与快捷动作
- 处理交互式终端提示
- 观察后台 Agent / Shell 运行状态
- 在手机上远程接管正在运行的桌面会话

## 3. Current Core Capabilities

### 3.1 Vibe Console

This is the current product backbone entry point.

It currently supports:

- multiple parallel sessions
- desktop-side console operation
- mobile remote control
- text view
- dialog aggregation view
- `screen` mode terminal view

### 3.2 Lingsi

`Lingsi` is the desktop-side productivity layer for making repeated expression and repeated actions easier to reuse.

It is intended to help users organize frequently used content fragments, common expressions, and high-frequency workflow pieces into a smoother working rhythm.

### 3.3 Access

`Access` is the desktop-side entry for managing upstream models and API endpoints.

It is used to centralize provider configuration so the user does not have to repeat the same setup across multiple tools.

### 3.4 Relay

`Relay` exposes already configured upstream capabilities through a single desktop-local output path.

It is used to reduce repeated configuration and make local tool integration more stable.

### 3.5 Fenghuo

`Fenghuo` is the cross-device synchronization and delivery layer for text, images, files, and result artifacts.

It helps move working material and outputs between devices and back into the current workflow.

### 3.6 Jianpu

`Jianpu` is the keyboard mapping and shortcut adjustment layer.

It lets the user reshape key behavior and common actions around personal habits so repeated operations become faster and more natural.

### 3.7 Mobile Remote Console

The Android client currently supports:

- signing in to a YiboVibe Server
- loading and switching session lists
- auto-switching after creating a new session
- a unified bottom input area
- a quick action sheet
- local scale controls in `screen` mode, including fit-width, fit-height, touch zoom, and mouse-wheel zoom

### 3.8 FlowSync

`FlowSync` currently acts as the cross-device asset and result synchronization substrate, including:

- resource delivery
- staging objects
- share download links
- multi-device sync capability

### 3.9 FlowProbe

`FlowProbe` is currently a desktop-local upstream API asset tool used to:

- manage provider configurations
- run protocol checks and diagnostics
- expose desktop-local compatibility endpoints

It is not a server-side AI gateway and not a public multi-tenant proxy layer.

## 3. 当前核心能力

### 3.1 Vibe Console

这是当前产品主线入口。

支持：

- 多 Session 并行
- 桌面端控制台
- 移动端远程控制
- 文本视图
- 对话聚合视图
- `screen` 模式终端视图

### 3.2 灵思

`灵思` 是桌面端面向日常使用的内容与操作辅助层。

它更强调把常用表达、思路片段和高频操作整理得更顺手，减少重复输入和来回切换。

### 3.3 接入

`接入` 用来集中管理桌面端要使用的模型和 API 接口。

用户可以把常用上游能力统一配置在这里，避免在不同工具里重复维护。

### 3.4 转发

`转发` 把已经配置好的接口能力通过本机统一出口提供给其它工具使用。

它的重点是减少重复配置，让本地调用路径更稳定、更统一。

### 3.5 烽火

`烽火` 是跨设备的资源与结果流转层。

它负责把文本、图片、文件和结果产物在设备之间同步，并继续送回当前工作流。

### 3.6 键谱

`键谱` 是键盘映射与快捷操作调整层。

用户可以按自己的习惯调整按键行为和快捷操作映射，让常用动作更顺手，减少重复操作。

### 3.7 Mobile Remote Console

Android 端当前已支持：

- 登录到 YiboVibe Server
- 会话列表拉取与切换
- 新建 Session 后自动切换
- 底部统一输入栏
- 快捷动作弹层
- `screen` 模式本地缩放、适宽、适高、手势缩放、鼠标滚轮缩放

### 3.8 FlowSync

`FlowSync` 当前承担跨端资产与结果同步底座，包括：

- 资源投递
- 暂存对象
- 分享下载链路
- 多端同步能力

### 3.9 FlowProbe

`FlowProbe` 当前是桌面端本机直连的上游 API 资产工具，负责：

- 管理 API 提供方配置
- 做协议测试和诊断
- 暴露桌面端本机兼容入口

它不是服务端 AI 网关，也不是公共多租户代理层。

## 4. Current Module Boundary

The current product scope keeps these modules active:

- `FlowDeck`
- `FlowSnap`
- `FlowHint`
- `FlowSync`
- `FlowDrop`
- `FlowRules`
- `FlowKeys`
- `FlowProbe`
- `Settings`

Within the current product line:

- `FlowDeck` acts more like the overview and control-center entry
- `FlowSync` acts more like the asset and result sync substrate
- `FlowProbe` is deliberately scoped to desktop-local API asset management

## 4. 当前模块边界

当前产品范围保留以下模块：

- `FlowDeck`
- `FlowSnap`
- `FlowHint`
- `FlowSync`
- `FlowDrop`
- `FlowRules`
- `FlowKeys`
- `FlowProbe`
- `Settings`

其中：

- `FlowDeck` 更接近总览和总控台入口
- `FlowSync` 更接近资源与结果同步底座
- `FlowProbe` 只收敛在桌面端本机 API 资产管理

## 5. Current Release Shapes

The current public release artifacts include:

- server Docker images and Docker tar packages
- desktop Windows x64 installers
- mobile Android APK packages

Current public version line:

- Server: `0.9.7`
- Desktop: `0.9.7`
- Mobile: `0.9.7`

## 5. 当前发布形态

当前公开发布物包括：

- 服务端 Docker 镜像 / Docker tar 包
- 桌面端 Windows x64 安装包
- 移动端 Android APK

当前版本线：

- 服务端：`0.9.7`
- 桌面端：`0.9.7`
- 移动端：`0.9.7`

## 6. Related Documents

- Product specification: [specs-v2.md](specs-v2.md)
- Architecture overview: [architecture-vibe-coding.md](architecture-vibe-coding.md)
- Server deployment: [../server/README.md](../server/README.md)
- NAS deployment: [NAS部署指南.md](NAS部署指南.md)
- Android app guide: [../mobile/android/README.md](../mobile/android/README.md)

## 6. 相关文档

- 产品规格：[specs-v2.md](specs-v2.md)
- 架构说明：[architecture-vibe-coding.md](architecture-vibe-coding.md)
- 服务端部署：[../server/README.md](../server/README.md)
- NAS 部署：[NAS部署指南.md](NAS部署指南.md)
- Android 说明：[../mobile/android/README.md](../mobile/android/README.md)
