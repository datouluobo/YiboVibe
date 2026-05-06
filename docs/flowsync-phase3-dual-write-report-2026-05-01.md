# FlowSync Phase 3 Dual Write Report

Date: 2026-05-01
Status: completed
Scope: Phase 3 `文本/图片接入新条目模型`
Source plan: [flowsync-refactor-execution-plan-2026-05-01.md](./flowsync-refactor-execution-plan-2026-05-01.md)

## 1. What changed

Phase 3 now routes live text/image activity into both models:

- legacy `clipboard.db/history`
- new `flowsync/entries.db`

Implemented in:

- [core/src/cache.rs](/F:/Download/GitHub/YiboFlow/core/src/cache.rs:247)
- [core/src/flow_store.rs](/F:/Download/GitHub/YiboFlow/core/src/flow_store.rs:235)

Behavior:

- new text/image content still writes the old cache and old history
- the same event now also upserts `flow_objects + flow_entries`
- repeated copies of the same content update the same new-model entry instead of duplicating it

## 2. Auto-sync split

Phase 3 split “create local entry” from “auto-send to other devices”.

New config fields:

- `auto_sync_text`
- `auto_sync_image`

Current send rules:

- text sends only when `is_sync_enabled && auto_sync_text`
- image sends only when `is_sync_enabled && auto_sync_image`

Local entry creation remains active even when the auto-sync flag is off.

Implemented in:

- [core/src/config.rs](/F:/Download/GitHub/YiboFlow/core/src/config.rs:84)
- [core/src/clipboard.rs](/F:/Download/GitHub/YiboFlow/core/src/clipboard.rs:323)
- [desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/lib.rs:494)

Exposed Tauri commands:

- `get_flowsync_auto_sync_prefs`
- `set_flowsync_auto_sync_prefs`

## 3. Query path switch

`FlowSync` frontend command names were kept stable, but the Tauri command implementations now prefer the new store:

- `query_history`
- `search_history`
- `copy_history_to_clipboard`
- `delete_history`
- `clear_history`
- `toggle_history_pin`
- `get_history_content`
- `get_cache_stats`

Compatibility strategy:

- command names and returned `HistoryEntry` shape stay the same
- backend reads `flow_entries` and adapts them to legacy fields
- old `history` manager remains as a fallback path

This means the current `FlowSync.tsx` UI is now effectively reading from the new entry model without a large page rewrite.

## 4. What Phase 3 still does not do

Not done yet:

- dedicated `flowsync_*` query command renaming
- file/folder entry creation
- device-side transfer sessions
- NAS staging

Those belong to later phases.

## 5. Verification

Completed:

- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cargo test -p yiboflow-core`
- `cd desktop && npm run build`

Added test coverage:

- live dual-write upsert returns one compatible history entry
- repeated same-content write does not duplicate the new-model row
