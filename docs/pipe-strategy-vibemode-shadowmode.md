# PTY Strategy: VibeMode vs ShadowMode

## 背景

交互式终端已经确认必须建立在真实 PTY 之上。

原因：

- CLI / TUI 需要真实终端能力才能正确处理补全、光标移动、全屏重绘、提示符和 ANSI 布局
- `hermes` 一类工具在非 PTY 场景下会直接退化，典型现象包括 `Input is not a terminal (fd=0)`、排版错乱、补全失效
- 单纯的 stdio pipe 或“整行发送”方案只能覆盖最基础的命令执行，不满足 YiboVibe 的交互式会话目标

Windows ConPTY 在底层会把 stdout/stderr 汇合到同一终端流中，这会影响后台自动化的纯净错误分离，但不影响交互式终端体验。

## 方案

在 SessionManager 层面维持 `SessionMode` 选择，但当前产品约束如下：

- 交互式会话固定使用真实 PTY
- 当前桌面端默认方案为 `VibeMode`
- 后续如果出现终端问题，优先在 PTY / VibeMode 方案内修复
- 未经文档更新和明确架构决策，不应在排障过程中临时切换为 pipe-only 伪终端方案

### VibeMode (PTY)

- 适用：交互式会话（CLI、TUI、vim 等）
- 行为：保留 ANSI 颜色、补全、方向键、提示符、全屏布局、TUI 交互
- 底层：真实 PTY
- Windows 实现：优先使用 ConPTY / Windows PTY 能力
- 设计：当前实现

### ShadowMode (Stdio Pipes)

- 适用：后台自动化（编译、重构、批量脚本）
- 行为：stdout/stderr 分离，纯净错误可触发告警
- 底层：stdio pipes / 非交互式进程托管
- 设计：待实现

## SessionMode 枚举

```rust
pub enum SessionMode {
    VibeMode,   // PTY - 当前实现
    ShadowMode, // Stdio pipes - 待实现
}
```

## 实施时机

配合 v2 WslAgentBridge / Multi-Agent Sessions 规范启动时实现。
ShadowMode 的 shell 启动路径不在当前 Phase 1/2 范围内。

## 约束

- 桌面端交互式终端是 PTY 产品能力，不是可随时替换的实现细节
- 排障时默认保持 PTY 路线，优先修复 resize、输入、销毁、同步等具体问题
- 如果未来确实需要引入另一套终端路线，必须先更新本文档和相关架构文档，再实施切换

## 补充机制

在 VibeMode 下，可配合 Stream Interceptor（正则嗅探 error/exception/traceback）
作为轻量级错误检测的补充手段。

---
创建时间: 2026-05-12
最近更新: 2026-05-18
关联文档: specs-v2.md, architecture-vibe-coding.md
