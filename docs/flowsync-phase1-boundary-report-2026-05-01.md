# FlowSync Phase 1 Boundary Report

Date: 2026-05-01
Status: completed
Scope: Phase 1 `基础收口`
Source plan: [flowsync-refactor-execution-plan-2026-05-01.md](./flowsync-refactor-execution-plan-2026-05-01.md)

## 1. Core placeholder modules

Phase 1 added compile-time placeholders under `core/src/`:

- `flow_store.rs`
- `flow_migration.rs`
- `content_stream.rs`

They are registered in `core/src/lib.rs` only. No existing clipboard, history, cache, sync, or p2p behavior was changed in this phase.

## 2. Tauri command routing inventory

The current desktop bridge still exposes the old clipboard/history and FlowDrop-era surfaces. Phase 1 classifies them as follows.

### 2.1 Keep for next phases

- `get_flowsync_runtime_state`
- `set_flowsync_receive_only_mode`
- `get_flowsync_diagnostics`
- `read_clipboard_content`
- `write_to_clipboard`
- `write_image_to_clipboard`

Reason: these remain part of the active `FlowSync` page and current text/image sync workflow.

### 2.2 Migrate behind the new content-stream model

- `init_clipboard_history`
- `query_history`
- `search_history`
- `copy_history_to_clipboard`
- `delete_history`
- `clear_history`
- `toggle_history_pin`
- `get_history_content`
- `pull_today_history`

Reason: `FlowSync.tsx` still uses the legacy `history` store directly. These commands should eventually be replaced by `flow_entries`-based queries and actions after Phase 2 and Phase 3 land.

### 2.3 Delete after FlowDrop retirement

- `send_file_p2p`

Reason: this is the only explicit Tauri command still bound to the standalone `FlowDrop` file-transfer page. The plan already targets `send_file_p2p` and old `p2p_file_offer` handling for removal in the final cutover phase.

## 3. Frontend entrypoint inventory

`FlowSync` is the only long-term content-flow entry.

Current retained legacy references:

- `desktop/src/App.tsx`
  - lazy import for `FlowDrop`
  - route `/app/flowdrop`
- `desktop/src/components/Layout.tsx`
  - sidebar item `flowdrop`
- `desktop/src/pages/FlowDrop.tsx`
  - standalone file-transfer page
- `desktop/src/pages/FlowDeck.tsx`
  - `FlowDrop` feature card still present

Phase 1 action:

- keep the route and page for compatibility
- add explicit legacy markers in `App.tsx`, `Layout.tsx`, and `FlowDrop.tsx`
- defer actual removal until Phase 8

## 4. Deletion scope clarified for later phases

Do not delete in Phase 1:

- `desktop/src/pages/FlowDrop.tsx`
- `desktop/src/App.tsx` FlowDrop route
- `desktop/src/components/Layout.tsx` FlowDrop navigation item
- `desktop/src/pages/FlowDeck.tsx` FlowDrop card
- `desktop/src-tauri/src/lib.rs` command export for `send_file_p2p`
- `core/src/p2p.rs`

Expected later deletion path:

1. move file and bundle entry creation into `FlowSync`
2. replace old transfer/session path with content-stream transfer flow
3. remove `FlowDrop` route, nav, card, and `send_file_p2p`
4. remove old core p2p-specific FlowDrop path

## 5. Phase 1 completion check

- New core placeholder modules exist and are registered
- Command routing inventory is documented
- Frontend long-term entry and legacy retention scope are documented
- No user-facing FlowSync or FlowDrop behavior was intentionally changed
