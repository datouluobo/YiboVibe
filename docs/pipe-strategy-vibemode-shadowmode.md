# Pipe Strategy: VibeMode vs ShadowMode

## 背景

Windows ConPTY 将 stdout/stderr 合并到同一管道输出，无法在操作系统层面分离。
但这不影响交互式终端体验，只在后台自动化场景中成为瓶颈。

## 方案

在 SessionManager 层面引入 `PipeMode` 选择：

### VibeMode (ConPTY)
- 适用：交互式会话（CLI、TUI、vim 等）
- 行为：stdout/stderr 混合传输，保留 ANSI 颜色和终端能力
- 底层：CreatePseudoConsole + PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
- 设计：当前实现

### ShadowMode (Stdio Pipes)
- 适用：后台自动化（编译、重构、批量脚本）
- 行为：stdout/stderr 分离，纯净错误可触发告警
- 底层：CreateProcessW + STARTF_USESTDHANDLES + 独立管道
- 设计：待实现

## PipeMode 枚举（已定义）

\`\`\`rust
pub enum SessionMode {
    VibeMode,   // ConPTY - 当前实现
    ShadowMode, // Stdio  - 待实现
}
\`\`\`

## 实施时机

配合 v2 WslAgentBridge / Multi-Agent Sessions 规范启动时实现。
ShadowMode 的 shell 启动路径不在当前 Phase 1/2 范围内。

## 补充机制

在 VibeMode 下，可配合 Stream Interceptor（正则嗅探 error/exception/traceback）
作为轻量级错误检测的补充手段。

---
创建时间: 2026-05-12
关联文档: specs-v2.md, architecture-vibe-coding.md
