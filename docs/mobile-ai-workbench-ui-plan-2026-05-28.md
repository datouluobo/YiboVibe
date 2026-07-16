# Mobile AI Workbench UI Plan 2026-05-28

## 1. Goal

This document defines the mobile UI direction for YiboVibe as a multi-tool remote workbench.

The goal is not to turn the mobile app into:

- a terminal-only app with AI pages bolted on later
- a Codex-only app that sidelines terminal work
- a tool-specific app whose entire layout changes when switching tools

The goal is to build one stable mobile shell that can host multiple remote tools with the same navigation logic and a mostly consistent session experience.

## 2. Primary Structure

The core hierarchy is:

`Tool -> Project -> Session`

This order is intentional.

- `Tool` answers: what kind of remote work am I entering
- `Project` answers: which repository or working directory inside that tool
- `Session` answers: which concrete running conversation or shell instance

This hierarchy must remain stable as new tools are added.

## 3. Top-Level Rules

### 3.1 Tools do not mix data

Projects and sessions from different tools must not be merged into a single mixed list.

Examples:

- `Terminal / YiboVibe / wsl #2`
- `Codex / YiboVibe / 控制Codex方案`

They may reference the same repository path, but they are still different tool trees.

### 3.2 UI shell stays consistent

Different tools may render different session bodies, but they should not feel like separate apps.

Keep these stable across tools:

- navigation structure
- header placement
- list density
- status placement
- input area placement
- main actions location

### 3.3 Tool-specific protocol names stay hidden

The mobile UI should not expose raw provider terms such as:

- `thread`
- `conversationId`
- `turn`
- `PTY`

User-facing naming should stay unified:

- `工具`
- `项目`
- `会话`

## 4. Tool Layer

The first layer of the mobile workbench is the tool list.

This layer should contain product-level tools, not implementation details.

Examples of valid tool-layer entries:

- `终端`
- `Codex`
- `Cursor`
- `Claude Code`
- future automation or agent tools

Examples of invalid tool-layer entries:

- `pwsh`
- `cmd`
- `wsl`

These are terminal runtime types, not top-level tools.

## 5. Why cmd/wsl/pwsh should not be top-level tools

### 5.1 They are implementation variants of Terminal

`cmd`, `pwsh`, and `wsl` are different execution environments inside the Terminal tool.
They are not parallel to `Codex` or `Cursor` in the product sense.

### 5.2 They would fragment project navigation

The same repository may have:

- one `wsl` session
- one `pwsh` session
- one `cmd` session

If these become separate top-level tools, the user must jump between tools to inspect one project's terminal work.

### 5.3 They make the tool layer asymmetrical

This would create an inconsistent hierarchy:

- `Codex` is a tool
- `Cursor` is a tool
- `wsl` is only a shell backend

That mismatch will become harder to maintain as more tools are added.

### 5.4 Better alternative

Keep:

- `终端` as the tool

Then model shell type at the session level:

- `pwsh #1`
- `wsl #2`
- `cmd #1`

Optional filtering can still exist inside Terminal:

- `全部`
- `pwsh`
- `wsl`
- `cmd`

## 6. Navigation Model

The recommended mobile navigation is:

- bottom tab `工具`
- bottom tab `会话`
- bottom tab `我的`

The `工具` tab is the entry selector.

The `会话` tab is the working area for the currently selected tool tree.

The `我的` tab contains account, connection, sync, and debug settings.

Notes:

- `工具` is where the user changes tool context
- `会话` is not a global mixed session list
- `会话` should always reflect the active tool and its project/session drill-down

## 7. Tool Page

The tool page shows only tool-level entries.

Each tool card should show:

- tool name
- online or offline status
- active project count
- active session count
- last updated time
- one short status summary

Example:

- `终端`
  - 在线
  - 2 个项目
  - 3 个会话

- `Codex`
  - 在线
  - 1 个项目
  - 4 个会话

This page should not show mixed project lists from multiple tools.

## 8. Project Page

After selecting a tool, the next level is that tool's project list.

Examples:

- `Codex -> YiboVibe`
- `Terminal -> YiboVibe`

Each project card should show:

- project name
- path
- current branch if available
- session count
- latest session time
- current aggregate status

The list layout should be consistent across tools even if the data source differs.

## 9. Session List Page

After selecting a project, the next level is the session list for that tool and project.

Examples:

- `Codex -> YiboVibe -> 新建测试分支验证方案E MVP`
- `Terminal -> YiboVibe -> wsl #2`

Each session row should show:

- session title
- session status
- recent timestamp
- one-line summary
- optional subtype badge

For Terminal, subtype badges can be:

- `pwsh`
- `wsl`
- `cmd`

For Codex, subtype is usually unnecessary, but model or provider status can appear in metadata.

## 10. Unified Session Detail Shell

All tools should use one shared session detail shell.

The page is always divided into three sections:

1. header
2. body
3. composer

This shell should not change when the user switches tools.

## 11. Header Design

The header should always show:

- session title
- tool name
- project name
- session status
- branch or path summary
- right-side actions

Examples:

- `wsl #2 · 终端 · YiboVibe · 运行中`
- `控制Codex方案 · Codex · YiboVibe · 空闲`

Right-side actions should stay in the same location across tools:

- refresh
- more
- pin
- close or archive

Some tools may disable unsupported actions, but placement should remain stable.

## 12. Body Renderer

The shell is shared, but the body renderer is tool-specific.

### 12.1 Terminal body

Terminal body supports:

- terminal output stream
- text or screen rendering modes
- selection and copy
- zoom
- quick actions

### 12.2 Codex body

Codex body supports:

- user messages
- assistant messages
- reasoning summary blocks
- command execution blocks
- file change cards
- tool call blocks
- folded technical events

### 12.3 Future tools

Future tools may define their own body renderer while still fitting the same page shell:

- `TerminalSessionBody`
- `CodexSessionBody`
- `CursorSessionBody`
- `ClaudeCodeSessionBody`

## 13. Composer Design

The bottom composer should also use one stable shell.

The composer always has:

- main input area
- primary action button
- secondary parameter strip
- expandable more-actions entry

### 13.1 Terminal composer

Terminal-specific content:

- placeholder: `输入命令...`
- send or execute button
- shell quick actions
- control keys
- file or image helpers if supported

### 13.2 Codex composer

Codex-specific content:

- placeholder: `给 Codex 发送消息...`
- send button
- model
- approval
- sandbox
- reasoning effort
- stop or interrupt action

The shell layout should remain visually aligned between tools even though the parameter content differs.

## 14. Status Area

Session detail pages should include one lightweight status strip above the composer.

This strip should be consistent across tools and support:

- current state
- recent event
- warning or error summary
- whether retry is possible

Examples:

- Terminal: `已连接 · 最近收到输出`
- Terminal: `连接中断，等待重连`
- Codex: `Codex 正在回复...`
- Codex: `新对话尚未产生正文`
- Codex: `已切换备用通道`

Technical details should be folded behind a debug toggle rather than always shown.

## 15. Interaction Rules

These interactions should remain consistent across all session detail pages:

- pull to refresh
- jump to top
- jump to bottom
- long press to copy
- folded errors and warnings
- interrupt running work
- more actions from top right

Tool-specific capabilities may differ, but shared gestures and control placement should not.

## 16. Shared UI Components

To prevent future drift, the mobile UI should be built from shared shells and a small set of tool-specific renderers.

Suggested shared components:

- `WorkbenchToolCard`
- `WorkbenchProjectCard`
- `WorkbenchSessionRow`
- `SessionHeader`
- `SessionStatusStrip`
- `SessionComposer`

Suggested tool-specific components:

- `TerminalSessionBody`
- `CodexSessionBody`
- `TerminalComposerExtras`
- `CodexComposerExtras`

## 17. Data Model Mapping

The UI architecture should map each tool into the same high-level entities:

- `Tool`
- `Project`
- `Session`

### 17.1 Terminal mapping

- Tool: `终端`
- Project: grouped by `cwd` or repository path
- Session: concrete shell instance

Suggested terminal session fields:

- `sessionType`: `pwsh | wsl | cmd`
- `status`
- `cwd`
- `lastOutputAt`

### 17.2 Codex mapping

- Tool: `Codex`
- Project: grouped by `cwd` or repository path
- Session: concrete Codex thread or conversation

Suggested Codex session fields:

- `model`
- `approvalPolicy`
- `sandboxMode`
- `branch`
- `status`

## 18. Project Identity Rule

Project identity must be scoped inside a tool.

Do not merge same-path projects across tools in the mobile tree.

Correct:

- `Terminal / F:\...\YiboVibe`
- `Codex / F:\...\YiboVibe`

Incorrect:

- one shared `YiboVibe` node that mixes terminal and Codex sessions

This rule keeps data ownership clear and prevents future sync ambiguity.

## 19. Unified Status Vocabulary

Different tools should map their native states into one shared mobile vocabulary:

- `未连接`
- `空闲`
- `运行中`
- `等待中`
- `需确认`
- `失败`

Raw provider-specific states should remain in adapter code, not in the mobile UI layer.

## 20. Multi-Provider Extension Rule

When a new tool is added, it must plug into the existing hierarchy instead of redefining navigation.

That means every new tool must provide:

- tool metadata
- project list
- session list
- session detail renderer
- composer extras if needed
- state mapping into the shared vocabulary

It must not introduce:

- a new top-level navigation model
- a separate project hierarchy style
- different header or composer placement

## 21. Phased Rollout Recommendation

### Phase 1

Rebuild mobile IA into:

- `工具`
- `会话`
- `我的`

### Phase 2

Build static shells for:

- tool page
- project page
- session list page
- session detail shell

Use mock data only.

### Phase 3

Connect `Codex` to the shell first.

### Phase 4

Refit `Terminal` into the same shell without removing current terminal capabilities.

### Phase 5

Add future providers using the same mapping rules.

## 22. Final Decision

The mobile app should become a multi-tool remote workbench.

It should not be:

- a terminal app with an AI page hidden inside
- a Codex app with terminal leftovers
- a mixed feed of unrelated projects and sessions

The stable structure is:

`工具 -> 项目 -> 会话`

The stable detail page is:

`Header -> Body Renderer -> Composer`

The stable rule is:

different tools keep separate project and session trees while sharing one overall mobile UI language.
