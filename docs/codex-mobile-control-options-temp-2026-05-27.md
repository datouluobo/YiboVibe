# Codex 接入与移动端控制方案临时讨论稿

更新时间：2026-05-27

状态：临时讨论稿，供方案取舍与后续拆任务使用。

## 1. 背景与目标

YiboVibe v2 的核心边界是：

- 桌面端作为真正的执行宿主。
- 服务端作为登录、信令、会话与状态中枢。
- 移动端作为远程控制台。

本次讨论的问题是：如何把 Codex 接入 YiboVibe，让手机可以控制 Windows 桌面上的 Codex 开发过程，同时尽量达到“Codex 手机版”的体验，而不是简单远程操作一个终端。

理想体验包括：

- 手机端看到的是聊天、任务、确认卡片、文件变更和状态，而不是裸终端。
- 可以离开电脑后继续推进当前开发任务。
- 尽量复用桌面端当前 Codex 工作上下文。
- 桌面端仍保留本地执行权，服务端不变成 AI 网关。

## 2. 方案 A：Codex CLI + PTY 远程会话

### 2.1 基本思路

桌面端通过现有 PTY 能力启动 `codex` CLI，把它作为一种新的 `agent_kind` 或 `shell_kind`：

```text
Mobile
  -> session:start / session:stdin
Server Signal Hub
  -> WebSocket relay
Desktop PTY Host
  -> codex CLI
```

移动端发送 prompt，桌面端写入 Codex CLI 的 stdin；Codex CLI 输出通过 stdout/stderr、screen snapshot、screen patch 同步回移动端。

### 2.2 优点

- 与当前架构最顺，能直接复用已有 PTY、session、WebSocket、移动端 console。
- 不需要破解或依赖 Codex Desktop App 的内部 UI。
- 桌面端本地执行，符合 v2 的 Headless Host First 原则。
- 可以快速做出 MVP。

### 2.3 问题

- 默认会新开一个 Codex CLI 会话，不等同于当前 Codex Windows 桌面应用里的会话。
- Codex CLI 与 Codex Win 的聊天上下文可能分裂。
- 如果移动端直接展示 PTY，就会变成“手机操作终端”，体验不够像 Codex 手机版。

### 2.4 改进方向

不要把 PTY 直接暴露为产品体验，而是让 YiboVibe 做一层 `Codex Session Broker`：

```text
Mobile Chat UI
  -> YiboVibe Session Broker
  -> Codex Adapter
  -> codex CLI
```

移动端展示原生聊天流、任务状态、确认卡片和产物卡片；PTY 只作为底层执行通道。

## 3. 方案 B：YiboVibe Session Memory + 自动上下文接续

### 3.1 基本思路

承认 Codex CLI 与 Codex Win 默认不能天然共享内部会话，但让 YiboVibe 自己成为外部连续上下文层。

YiboVibe 记录并维护：

- 当前任务目标。
- 历史用户 prompt。
- Codex 关键回复。
- 文件变更摘要。
- git diff / git status。
- 最近命令与测试结果。
- 错误堆栈。
- 人工确认/拒绝记录。
- 资源投喂记录。

当移动端新建或恢复 Codex CLI session 时，桌面端自动生成 `resume prompt`，把上述上下文压缩后注入给 Codex。

### 3.2 优点

- 可以弱化 CLI 进程重启、会话切换造成的割裂。
- 移动端体验可以更接近“持续任务”，而不是“持续终端进程”。
- 不强依赖 Codex Win 内部接口是否开放。
- 可以复用 YiboVibe v2 中已有的 Context Projection、Artifact Auto-Harvesting、Resource Bridge 方向。

### 3.3 问题

- 这不是 Codex 原生内部上下文共享，而是外部重建上下文。
- 上下文压缩质量会影响接续效果。
- 需要设计 session memory、artifact ledger 和 handoff prompt。

### 3.4 适合定位

这是推荐的主线增强能力。它让 Codex CLI 后端也能提供接近手机版的连续体验，同时为未来接入其他 Agent 做通用基础。

## 4. 方案 C：直接控制 Codex Windows 桌面应用

### 4.1 基本思路

YiboVibe 使用 Windows UI Automation / Win32 API / 输入模拟控制 Codex Win 窗口：

- 查找 Codex 窗口。
- 激活输入框。
- 向聊天框输入 prompt。
- 点击发送。
- 点击允许、拒绝、继续等按钮。
- 读取可访问性树中的聊天内容。
- 读不到时 fallback 到截图 OCR。

### 4.2 优点

- 操作的就是用户当前正在使用的 Codex Win 会话，上下文是真共享。
- 可以作为“手机接管电脑上已有 Codex 工作”的路径。
- 适合做 Shadow Mode、Emergency Control、临时接管。

### 4.3 问题

- 非常依赖 Codex Win 的 UI 结构和窗口行为。
- Codex UI 更新后容易失效。
- 聊天记录不一定完整暴露在 accessibility tree。
- OCR 对代码块、终端输出、diff 的可靠性有限。
- 焦点、输入法、DPI、多窗口、多显示器都会增加不稳定性。

### 4.4 适合定位

不建议作为主路线。更适合作为 `Shadow Bridge`：

- 观察当前 Codex Win 状态。
- 在必要时远程发送一段输入。
- 在紧急时点击确认/拒绝/停止。
- 作为真正结构化接入不可用时的兜底。

## 5. 方案 D：强制窗口布局 + Codex Win 投屏到手机

### 5.1 基本思路

桌面端强制控制 Codex Win 窗口：

- 固定窗口大小。
- 固定窗口位置。
- 固定缩放或字号。
- 通过 Windows Graphics Capture / 截图流捕获窗口画面。
- 通过 WebRTC、MJPEG 或自定义帧流推送到移动端。
- 移动端触摸和键盘事件映射回桌面。

### 5.2 优点

- 上下文 100% 共享，因为手机看到的就是桌面 Codex 窗口。
- 不需要解析 Codex 内部协议。
- 原型相对直接。

### 5.3 问题

- 产品体验接近远程桌面，不像原生手机版。
- 手机屏幕阅读桌面窗口会很挤。
- 输入、选择、滚动、代码块复制体验差。
- 网络带宽、延迟、电量消耗更高。
- 难以沉淀结构化 artifact、任务状态和确认动作。

### 5.4 适合定位

适合作为 `Live View / Remote Takeover`：

- 默认不用。
- 当结构化通道不足时，用户可以打开“查看桌面原貌”。
- 用于救急、观察、临时接管，而不是主交互界面。

## 6. 方案 E：Codex App Server / JSON-RPC 结构化接入

### 6.1 基本思路

如果 Codex 底层暴露本地 App Server、JSON-RPC、IPC、local pipe 或类似结构化接口，YiboVibe 可以作为另一个客户端接入。

理想链路：

```text
Mobile Chat UI
  -> YiboVibe Server Signal Hub
  -> Desktop Codex Adapter
  -> Codex App Server / JSON-RPC / IPC
  -> Codex runtime
```

### 6.2 优点

- 最接近真正“Codex 手机版”。
- 可以获得结构化消息、任务、状态、确认、工具调用和文件变更。
- 不需要依赖屏幕 OCR 或 UI 自动化。
- 可以在手机端做高质量原生界面。

### 6.3 问题

- 需要确认 Codex Windows 版本是否稳定暴露该接口。
- 需要确认鉴权、会话发现、消息协议和兼容性。
- 如果接口属于内部实现，后续版本可能变化。

### 6.4 适合定位

这是最值得验证的高价值路线。如果可用，应优先作为长期主通道。

## 7. 推荐组合

不建议只押一条路。推荐组合如下：

```text
主体验：
  Mobile Native Chat UI
  -> YiboVibe Session Broker
  -> Codex Adapter

Adapter 优先级：
  1. Codex App Server / JSON-RPC / IPC
  2. Codex CLI + PTY
  3. Codex Win UI Automation
  4. Codex Win Live View 投屏
```

产品层面：

- 默认展示移动端原生 Chat UI，不展示裸终端。
- PTY 只是底层 transport。
- Codex Win UI 自动化用于接管已有桌面会话。
- 投屏用于观察和救急。
- YiboVibe Session Memory 负责跨进程、跨后端的连续上下文。

## 8. MVP 建议

### 8.1 第一阶段：跑通 Codex CLI 后端

- 新增 `agent_kind = codex` 或 `shell_kind = codex`。
- 桌面端检测 `codex` 可执行文件路径与版本。
- 移动端新增“Codex Session”入口。
- 启动时绑定 project root。
- 继续使用现有 PTY output、screen mode、stdin injection。

### 8.2 第二阶段：隐藏终端感

- 移动端为 Codex session 使用聊天式 UI。
- 输出解析为 assistant message、tool/action、error、patch、file change。
- 增加 Codex 快捷动作：继续、停止、允许、拒绝、复制结果、总结当前状态。
- 保留“高级终端视图”作为 debug 模式。

### 8.3 第三阶段：加入 Session Memory

- 保存任务目标、prompt、关键回复和人工决策。
- 采集 git status、git diff、最近错误和测试结果。
- 生成 resume prompt。
- 支持手机端“接续当前任务”而不是“新开终端”。

### 8.4 第四阶段：验证 Codex Win 桥接

- 检测 Codex Win 进程与窗口。
- 尝试读取 accessibility tree。
- 尝试输入框定位与文本注入。
- 尝试截图 OCR。
- 作为 Shadow Bridge，不替代主体验。

### 8.5 第五阶段：Live View 兜底

- 捕获 Codex Win 窗口画面。
- 移动端显示只读 Live View。
- 后续再支持触摸、滚动、键盘映射。

## 9. 关键判断

### 9.1 能不能同时在线？

Codex Win 与 YiboVibe 启动的 Codex CLI 可以同时在线。它们是不同进程/前端。

### 9.2 上下文是否天然共享？

默认不天然共享。Codex CLI 新会话与 Codex Win 当前聊天上下文通常是分开的。

### 9.3 能不能解决上下文割裂？

可以部分解决：

- 最好：通过 Codex 官方结构化接口接入同一个 runtime/session。
- 次优：YiboVibe 建立 Session Memory 和 resume prompt。
- 兜底：UI 自动化或 Live View 直接操作 Codex Win 当前窗口。

### 9.4 哪条路线最稳？

短期最稳是 Codex CLI + PTY + 移动端原生 Chat UI。

长期最优是结构化接入 Codex App Server / IPC。

Codex Win UI 自动化和投屏适合作为观察、接管、救急能力。

## 10. 与 YiboVibe v2 边界的关系

保持以下原则：

- 服务端不做代理模型调用。
- 服务端不成为云端代码执行平台。
- 桌面端仍是真正执行宿主。
- 移动端只发起控制意图、查看状态和确认动作。
- FlowProbe 保持本机上游模型与代理资产中心定位。
- Codex 接入应落在 Agent Host、Session Broker、Remote Console 这条主线。

## 11. 临时结论

最合理的产品方向不是“手机远程操作一个 Codex 终端”，也不是“手机远程桌面看 Codex 窗口”，而是：

```text
YiboVibe 提供 Codex 手机版体验；
Codex CLI / Codex Win / Codex App Server 都只是可切换执行后端。
```

短期用 CLI + PTY 快速起步，中期用 Session Memory 抹平上下文割裂，长期验证并优先接入 Codex 的结构化本地接口。Codex Win UI 自动化与 Live View 作为 Shadow Mode 和救急兜底。
