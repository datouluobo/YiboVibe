# FlowSync Phase 2 Data Layer Report

Date: 2026-05-01
Status: completed
Scope: Phase 2 `新数据层与迁移层`
Source plan: [flowsync-refactor-execution-plan-2026-05-01.md](./flowsync-refactor-execution-plan-2026-05-01.md)

## 1. What landed

Phase 2 introduced a real `entries.db` path under the active user directory:

- `{active_user_dir}/flowsync/entries.db`

The new store is initialized during the existing cache/history bootstrap path, so startup now prepares both:

- legacy `clipboard.db`
- new `entries.db`

Implemented in:

- [core/src/flow_store.rs](/F:/Download/GitHub/YiboFlow/core/src/flow_store.rs:1)
- [core/src/flow_migration.rs](/F:/Download/GitHub/YiboFlow/core/src/flow_migration.rs:1)
- [core/src/cache.rs](/F:/Download/GitHub/YiboFlow/core/src/cache.rs:175)

## 2. New schema

`entries.db` now initializes these tables:

- `schema_migrations`
- `flow_entries`
- `flow_objects`
- `flow_chunks`
- `flow_transfers`
- `legacy_history_map`
- `flow_entries_fts`

Also created on disk:

- `objects/text`
- `objects/image`
- `objects/file`
- `objects/bundle`
- `chunks`
- `manifests`
- `staging`
- `temp`

## 3. Legacy backfill behavior

Startup now scans legacy `clipboard.db/history` and backfills text/image metadata into the new model.

Current backfill properties:

- scans old `history` ordered by `timestamp ASC, id ASC`
- creates one `flow_object` plus one `flow_entry` per legacy row
- records `legacy_history_map` for idempotency
- keeps old `text/{hash}.txt` and `image/{hash}.png` in place
- stores old file path into `flow_objects.local_storage_path`
- marks missing local files as `metadata_only` instead of failing the whole migration

Current source mapping:

- `local` -> `clipboard_text` / `clipboard_image`, direction `local`
- `sync:{device}` -> `remote_sync`, direction `received`
- fallback unknown source -> `legacy_history`, direction `unknown`

## 4. What Phase 2 does not change

Phase 2 does not switch the active UI or Tauri query path.

Still unchanged:

- `FlowSync.tsx` reads legacy `history` commands
- clipboard text/image writes still go only through the old history path
- no file/bundle entry creation yet

That cutover remains for later phases.

## 5. Verification

Completed:

- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- unit test: empty FlowStore initialization
- unit test: legacy history backfill idempotency

Validation focus for this phase:

- empty store can create `entries.db`
- legacy text/image rows can backfill
- repeated backfill does not duplicate objects or entries
