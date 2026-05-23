# Mobile Console Screen Mode Design (2026-05-22)

> Archived engineering note:
> This document is kept for historical implementation context and is not the current public product or deployment guide.
>
> 历史工程记录：本文保留实现背景与演进过程，不作为当前对外产品或部署说明。

## 1. Background

YiboVibe current mobile terminal rendering works acceptably for ordinary command output such as:

- `pwd`
- `dir`
- `ls`
- log streams
- stderr output

These outputs are fundamentally text streams and can be rendered through the existing event/text pipeline.

The current approach breaks down for interactive TUIs such as:

- `hermes`
- `vim`
- `less`
- `fzf`
- model pickers
- menus with cursor movement
- progress panels with in-place redraw

The core problem is architectural:

- mobile currently receives terminal output as text fragments
- TUI programs do not behave like append-only text logs
- TUI programs rely on cursor movement, erase, redraw, alternate screen, and screen state

As a result, the mobile side accumulates historical redraw fragments instead of reflecting the current terminal screen.

## 2. Decision

Do not convert every terminal session to a full screen-buffer architecture.

Adopt a dual-mode terminal synchronization design:

- `text mode` for ordinary command output
- `screen mode` for interactive TUI sessions

This keeps the existing stable path for normal shell output while introducing a proper screen-state pipeline only where it is actually required.

## 3. Goals

### 3.1 Primary goals

- Preserve current mobile behavior for normal command output
- Correctly render interactive TUIs on mobile
- Keep mobile and desktop in sync during cursor movement and redraw
- Avoid text-fragment accumulation in interactive sessions
- Support virtual key interaction in screen mode

### 3.2 Non-goals for the first implementation

- Do not replace desktop `xterm` rendering
- Do not make the server parse ANSI or maintain terminal state
- Do not implement full touch-to-mouse support in phase one
- Do not redesign all terminal UI around screen mode

## 4. High-Level Architecture

Current path:

`PTY output -> text chunks -> WS relay -> mobile text rendering`

Target path:

`PTY output -> desktop terminal state engine -> screen snapshot/patch -> WS relay -> mobile screen renderer`

Dual-mode behavior:

- ordinary shell output stays on the current text pipeline
- interactive TUI output switches to the new screen-state pipeline

## 5. Render Modes

Each session should be in exactly one render mode at a time:

- `text`
- `screen`

### 5.1 Text mode

Use the existing event pipeline:

- `session:output`
- prompt extraction
- body cleaning
- dialog view / terminal text view

Suitable for:

- command results
- logs
- scripts
- ordinary shell work

### 5.2 Screen mode

Use a dedicated screen-state pipeline:

- `screen snapshot`
- `screen patch`
- cursor state
- active buffer state

Suitable for:

- TUI applications
- alternate-screen sessions
- repaint-heavy terminal programs

In screen mode, the main mobile view must no longer depend on text cleaning heuristics.

## 6. Mode State Machine

Each session should maintain explicit mode state rather than relying on ad hoc display heuristics.

Suggested desktop-side state:

```ts
type TerminalRenderMode = "text" | "screen";

type SessionTerminalModeState = {
  mode: TerminalRenderMode;
  interactive: boolean;
  reason: "none" | "alternate_screen" | "ansi_repaint" | "known_tui" | "manual";
  enteredAt?: number;
  lastControlSeqAt?: number;
  lastSnapshotSeq?: number;
};
```

### 6.1 Enter screen mode

Priority order:

1. Alternate screen is enabled
2. Known TUI program is detected
3. High-frequency cursor movement / erase / repaint control sequences are observed
4. Manual override is enabled

### 6.2 Exit screen mode

Exit when one of the following is true:

- alternate screen is disabled and terminal returns to ordinary prompt behavior
- the TUI process exits
- manual override is disabled

### 6.3 Debounce rules

To avoid mode flapping:

- once a session enters `screen` mode, keep it there for a minimum dwell time
- do not switch between `text` and `screen` on isolated control-sequence noise
- treat alternate-screen transitions as authoritative

## 7. Terminal State Source of Truth

Desktop must become the only terminal state source for interactive sessions.

The server remains a relay layer, not a terminal semantic layer.

Desktop-side terminal state engine responsibilities:

- parse PTY output
- maintain current screen state
- maintain cursor position and visibility
- maintain current style attributes
- track normal and alternate buffers
- track dirty rows
- emit screen snapshot/patch messages for remote clients

## 8. Data Model

Suggested shared conceptual model:

```ts
type CursorShape = "block" | "underline" | "bar";

type TerminalCellStyle = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  dim?: boolean;
};

type TerminalCell = {
  char: string;
  style: TerminalCellStyle;
};

type TerminalCursor = {
  row: number;
  col: number;
  visible: boolean;
  shape: CursorShape;
};

type TerminalScreenBuffer = {
  cols: number;
  rows: number;
  lines: TerminalCell[][];
};

type TerminalScreenState = {
  sessionId: string;
  seq: number;
  mode: "text" | "screen";
  reason: "none" | "alternate_screen" | "ansi_repaint" | "known_tui" | "manual";
  title?: string;
  cursor: TerminalCursor;
  normalBuffer: TerminalScreenBuffer;
  altBuffer: TerminalScreenBuffer;
  activeBuffer: "normal" | "alternate";
  dirtyRows: number[];
};
```

For mobile implementation, the runtime model can be simplified, but these concepts should remain intact.

## 9. Wire Protocol

Retain the current `session:output` messages for text mode.

Add a dedicated family of screen-state messages for screen mode.

### 9.1 `session:screen_mode`

Purpose:

- announce that a session has entered or exited `screen` mode

Example:

```json
{
  "type": "session:screen_mode",
  "payload": {
    "session_id": "wsl-3",
    "mode": "screen",
    "reason": "alternate_screen",
    "seq": 41,
    "ts": "2026-05-22T10:00:00Z"
  }
}
```

### 9.2 `session:screen_snapshot`

Purpose:

- deliver a full screen-state snapshot
- initialize a newly attached mobile client
- recover from patch loss or desync

Example:

```json
{
  "type": "session:screen_snapshot",
  "payload": {
    "session_id": "wsl-3",
    "seq": 42,
    "cols": 120,
    "rows": 32,
    "cursor": {
      "row": 14,
      "col": 2,
      "visible": true,
      "shape": "block"
    },
    "active_buffer": "alternate",
    "title": "Hermes Agent",
    "lines": [
      [
        { "char": "H", "style": { "fg": "#f0c419", "bold": true } }
      ]
    ]
  }
}
```

### 9.3 `session:screen_patch`

Purpose:

- update only changed rows and cursor state

First implementation should prefer dirty-row replacement over fine-grained cell diffs.

Example:

```json
{
  "type": "session:screen_patch",
  "payload": {
    "session_id": "wsl-3",
    "seq": 43,
    "cursor": {
      "row": 15,
      "col": 4,
      "visible": true,
      "shape": "block"
    },
    "active_buffer": "alternate",
    "dirty_rows": [
      {
        "row": 14,
        "cells": [
          { "char": ">", "style": { "fg": "#ffffff", "bold": true } },
          { "char": " ", "style": {} },
          { "char": "N", "style": { "fg": "#f0c419" } }
        ]
      }
    ]
  }
}
```

### 9.4 `session:screen_resize`

Purpose:

- notify remote clients of terminal geometry changes

Example:

```json
{
  "type": "session:screen_resize",
  "payload": {
    "session_id": "wsl-3",
    "seq": 44,
    "cols": 96,
    "rows": 28
  }
}
```

### 9.5 `session:screen_reset`

Purpose:

- inform clients that current screen state should be discarded
- force a new full snapshot if necessary

### 9.6 `session:screen_request_snapshot`

Purpose:

- allow mobile to request a fresh snapshot after sequence gaps or desync

Example:

```json
{
  "type": "session:screen_request_snapshot",
  "payload": {
    "session_id": "wsl-3",
    "last_seq": 43
  }
}
```

## 10. Why Dirty-Row Replacement First

First implementation should not start with:

- character-level diff patches
- insert/delete region patches
- scroll-region compaction

Instead, start with:

- full snapshot
- dirty-row replacement
- explicit cursor update

Benefits:

- simpler implementation
- easier debugging
- lower correctness risk
- easier mobile renderer

Bandwidth can be optimized later after correctness is proven.

## 11. Desktop-Side Responsibilities

Primary implementation areas:

- `desktop/src-tauri/src/terminal.rs`
- `desktop/src-tauri/src/lib.rs`
- new module recommended: `desktop/src-tauri/src/terminal_screen.rs`

### 11.1 `terminal.rs`

Keep current PTY lifecycle handling, but add:

- terminal screen-state engine integration
- render mode state tracking
- snapshot/patch generation

### 11.2 `lib.rs`

Extend WS broker logic to:

- forward `session:screen_*` messages
- route screen-state messages to remote clients
- support snapshot request flow

### 11.3 Desktop UI

Desktop UI may continue using `xterm`.

The desktop UI does not need to become the source of truth for remote rendering.

The PTY + desktop-side terminal state engine should remain the authoritative source.

## 12. Server Responsibilities

The server should remain a relay and routing layer only.

Responsibilities:

- forward `session:screen_*` messages
- preserve per-session ordering as much as possible
- route snapshot requests and responses

Non-responsibilities:

- do not parse ANSI
- do not maintain terminal buffers
- do not infer interactive state

This preserves current product boundaries: `server/` is not an AI or terminal semantics gateway.

## 13. Mobile-Side Responsibilities

Primary implementation areas:

- `mobile/android/lib/providers/session_provider.dart`
- `mobile/android/lib/widgets/terminal_view.dart`
- new files recommended:
  - `mobile/android/lib/models/terminal_screen_state.dart`
  - `mobile/android/lib/widgets/terminal_surface_view.dart`
  - `mobile/android/lib/painters/terminal_surface_painter.dart`

### 13.1 Provider/state layer

Add per-session screen state:

- `renderModeBySession`
- `screenStateBySession`
- `lastScreenSeqBySession`

In screen mode, the main source for rendering should be `TerminalScreenState`, not `EventMessage` text assembly.

### 13.2 Rendering layer

Add a dedicated `TerminalSurfaceView` for screen mode.

Recommendations:

- render with `CustomPainter`
- draw per-cell background first
- draw glyphs second
- draw cursor last
- repaint only dirty regions where practical

Do not rely on `SelectableText` for screen mode.

### 13.3 Input layer

Text mode:

- keep current input field behavior

Screen mode:

- treat input as terminal input events
- do not append interaction keys as fake user messages

## 14. Input Model

Suggested conceptual input event shape:

```ts
type TerminalInputEvent =
  | { kind: "text"; text: string }
  | { kind: "key"; key: "up" | "down" | "left" | "right" | "enter" | "tab" | "esc" | "backspace" }
  | { kind: "control"; combo: "ctrl+c" | "ctrl+d" }
  | { kind: "resize"; cols: number; rows: number }
  | { kind: "mouse"; row: number; col: number; button: "left" | "right"; action: "down" | "up" | "move" };
```

Recommended implementation order:

1. text input
2. special keys
3. control combos
4. resize
5. mouse/touch mapping

## 15. Screen Mode Rendering Rules

In screen mode:

- no prompt extraction
- no dialog-mode rendering
- no output cleaning heuristics as primary rendering logic
- no soft wrapping based on prose layout assumptions

Terminal layout must remain cell-based.

Mobile narrow-screen strategies should be limited to:

- fit-width scaling
- 100% scale
- compact scale

Do not introduce semantic line wrapping into screen mode.

## 16. Compatibility Strategy

The current text pipeline remains in place for non-interactive sessions.

Compatibility rule:

- `text mode` uses the current terminal/text formatter path
- `screen mode` uses the new screen buffer path

Sessions should switch by session mode, not by page-level heuristics.

This avoids destabilizing currently working output.

## 17. Recovery and Sequencing

Each screen-state message should carry a monotonic `seq`.

Mobile behavior:

- if `seq == lastSeq + 1`, apply patch
- if `seq <= lastSeq`, drop it
- if `seq > lastSeq + 1`, request a fresh snapshot

This is required to prevent drift after packet loss or reordering.

Desktop behavior:

- support full snapshot generation on demand
- support mode re-announcement when a client reconnects

## 18. Rollout Plan

### Phase 1: Desktop screen-state engine

- add desktop-side terminal screen model
- add mode detection state machine
- keep mobile unchanged

Exit criteria:

- desktop can produce internal snapshot/patch data for TUI sessions

### Phase 2: WS protocol

- add `session:screen_mode`
- add `session:screen_snapshot`
- add `session:screen_patch`
- add `session:screen_request_snapshot`

Exit criteria:

- desktop and server can exchange screen-state messages successfully

### Phase 3: Mobile read-only screen renderer

- add screen-state models
- add `TerminalSurfaceView`
- render remote screen without interaction

Exit criteria:

- `hermes` view on mobile visually tracks desktop screen updates

### Phase 4: Mobile interaction closure

- virtual key input
- text input for screen mode
- sequence-gap recovery

Exit criteria:

- `Up`, `Down`, `Enter`, `Esc`, `Tab` remain in sync between desktop and mobile

### Phase 5: Touch enhancement

- click mapping
- pointer-style interactions
- optional mouse event support

Exit criteria:

- list-driven TUIs can be operated directly by touch

## 19. Risks

### 19.1 ANSI/state engine complexity

Risk:

- hand-rolled terminal emulation can become brittle

Mitigation:

- prefer a mature parser/screen-state library where possible

### 19.2 Mobile renderer performance

Risk:

- high-frequency repaint may not perform well with text widgets

Mitigation:

- use `CustomPainter`
- minimize redraw scope

### 19.3 Sequence drift

Risk:

- missing or out-of-order patches desync mobile state

Mitigation:

- monotonic `seq`
- snapshot recovery flow

### 19.4 Mixed-mode confusion

Risk:

- text heuristics leaking into screen mode

Mitigation:

- strict session-level mode separation

## 20. Acceptance Criteria

### 20.1 Text mode must not regress

- `pwd`, `dir`, `ls` still render normally on mobile
- normal command output continues using current text path

### 20.2 Screen mode must solve current TUI failures

- `hermes` automatically enters `screen mode`
- repeated `Down` presses do not accumulate stale frames
- interactive controls do not disappear unexpectedly
- cursor/highlight position on mobile follows desktop behavior
- `Enter`, `Esc`, and `Tab` stay synchronized

### 20.3 Recovery behavior

- mobile can recover from patch gaps with a fresh snapshot
- reconnect restores the current screen state

## 21. Minimal First Success Definition

The first successful implementation does not need to solve every TUI.

It should be considered successful if it satisfies all of the following:

- ordinary shell output remains stable
- `hermes` renders correctly on mobile
- `Up/Down/Enter/Esc` remain synchronized
- mobile no longer stacks redraw fragments
- buttons and interaction chrome remain stable during screen-mode sessions

## 22. Summary

The correct long-term design is not to keep refining text cleanup for interactive sessions.

The correct design is:

- preserve current text rendering for ordinary shell output
- upgrade only interactive TUI sessions to a real remote screen-state pipeline

This dual-mode design gives the best balance of:

- correctness
- implementation scope control
- low regression risk
- future extensibility for touch interaction
