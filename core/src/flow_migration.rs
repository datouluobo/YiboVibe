use crate::flow_store::{FlowEntryInsert, FlowObjectInsert, FlowStoreManager};
use log::info;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const BACKFILL_MIGRATION_VERSION: i64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowMigrationPlan {
    pub source_db_name: &'static str,
    pub target_db_name: &'static str,
    pub legacy_history_table: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FlowMigrationReport {
    pub legacy_db_found: bool,
    pub scanned: u32,
    pub inserted: u32,
    pub skipped_existing: u32,
    pub missing_local_content: u32,
}

#[derive(Debug, Clone)]
struct LegacyHistoryRow {
    id: i64,
    timestamp: i64,
    entry_type: String,
    hash: String,
    size: i64,
    preview: Option<String>,
    pinned: bool,
    source: String,
}

pub struct FlowMigrationManager;

impl FlowMigrationManager {
    pub fn plan() -> FlowMigrationPlan {
        FlowMigrationPlan {
            source_db_name: "clipboard.db",
            target_db_name: "entries.db",
            legacy_history_table: "history",
        }
    }

    pub fn backfill_legacy_history(
        store: &FlowStoreManager,
        legacy_db_path: &Path,
        legacy_cache_dir: &Path,
    ) -> Result<FlowMigrationReport, String> {
        let mut report = FlowMigrationReport::default();
        if !legacy_db_path.exists() {
            return Ok(report);
        }

        report.legacy_db_found = true;
        let conn = Connection::open(legacy_db_path)
            .map_err(|e| format!("Failed to open legacy clipboard db: {}", e))?;

        let history_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='history'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);
        if !history_exists {
            return Ok(report);
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, timestamp, type, hash, size, preview, pinned, source
                 FROM history
                 ORDER BY timestamp ASC, id ASC",
            )
            .map_err(|e| format!("Failed to prepare legacy history scan: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LegacyHistoryRow {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    entry_type: row.get(2)?,
                    hash: row.get(3)?,
                    size: row.get(4)?,
                    preview: row.get(5)?,
                    pinned: row.get::<_, i64>(6)? != 0,
                    source: row.get(7)?,
                })
            })
            .map_err(|e| format!("Failed to scan legacy history rows: {}", e))?;

        for row in rows {
            let row = row.map_err(|e| format!("Failed to decode legacy history row: {}", e))?;
            report.scanned += 1;

            if store.has_legacy_history_id(row.id)? {
                report.skipped_existing += 1;
                continue;
            }

            if store.bind_legacy_history_to_existing_entry(
                &row.entry_type,
                &row.hash,
                row.id,
                row.timestamp,
            )? {
                report.skipped_existing += 1;
                continue;
            }

            let local_storage_path =
                legacy_object_path(legacy_cache_dir, &row.entry_type, &row.hash);
            let has_local_content = local_storage_path.exists();
            if !has_local_content {
                report.missing_local_content += 1;
            }

            let object_id = Uuid::new_v4().to_string();
            let entry_id = Uuid::new_v4().to_string();
            let (entry_source, direction, source_device_name) = map_legacy_source(&row);
            let object = FlowObjectInsert {
                object_id: object_id.clone(),
                kind: row.entry_type.clone(),
                root_hash: row.hash.clone(),
                size_bytes: row.size,
                chunk_count: 1,
                checksum_algo: "blake3".to_string(),
                local_storage_path: has_local_content
                    .then(|| local_storage_path.display().to_string()),
                manifest_json: None,
                availability: if has_local_content {
                    "local_only".to_string()
                } else {
                    "metadata_only".to_string()
                },
                created_at: row.timestamp,
                updated_at: row.timestamp,
            };
            let entry = FlowEntryInsert {
                entry_id,
                kind: row.entry_type.clone(),
                title: None,
                preview: row.preview.clone(),
                size_bytes: row.size,
                pinned: row.pinned,
                entry_source,
                direction,
                source_device_name,
                source_device_id: None,
                object_id,
                has_local_content,
                transfer_status: "completed".to_string(),
                created_at: row.timestamp,
                updated_at: row.timestamp,
                legacy_history_id: Some(row.id),
            };

            if store.insert_legacy_backfill(&object, &entry, row.id)? {
                report.inserted += 1;
            } else {
                report.skipped_existing += 1;
            }
        }

        store.ensure_named_migration(
            BACKFILL_MIGRATION_VERSION,
            "backfill_legacy_history_text_image",
            current_unix_ms(),
        )?;

        info!(
            "FlowSync legacy backfill finished: found={}, scanned={}, inserted={}, skipped={}, missing_local_content={}",
            report.legacy_db_found,
            report.scanned,
            report.inserted,
            report.skipped_existing,
            report.missing_local_content
        );
        Ok(report)
    }
}

fn legacy_object_path(cache_dir: &Path, entry_type: &str, hash: &str) -> PathBuf {
    match entry_type {
        "text" => cache_dir.join("text").join(format!("{hash}.txt")),
        "image" => cache_dir.join("image").join(format!("{hash}.png")),
        _ => cache_dir.join("unknown").join(hash),
    }
}

fn map_legacy_source(row: &LegacyHistoryRow) -> (String, String, Option<String>) {
    if row.source == "local" {
        let entry_source = match row.entry_type.as_str() {
            "text" => "clipboard_text",
            "image" => "clipboard_image",
            _ => "legacy_history",
        };
        return (entry_source.to_string(), "local".to_string(), None);
    }

    if let Some(device_name) = row.source.strip_prefix("sync:") {
        let trimmed = device_name.trim();
        return (
            "remote_sync".to_string(),
            "received".to_string(),
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            },
        );
    }

    (
        "legacy_history".to_string(),
        "unknown".to_string(),
        Some(row.source.clone()),
    )
}

fn current_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::FlowMigrationManager;
    use crate::flow_store::FlowStoreManager;
    use rusqlite::{Connection, params};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn backfill_is_idempotent_for_legacy_history() {
        let root = unique_temp_dir("flow_migration");
        let cache_dir = root.join("cache");
        fs::create_dir_all(cache_dir.join("text")).expect("text dir");
        fs::create_dir_all(cache_dir.join("image")).expect("image dir");
        fs::write(
            cache_dir.join("text").join("text_hash.txt"),
            "hello migration",
        )
        .expect("text cache");
        fs::write(
            cache_dir.join("image").join("image_hash.png"),
            [1u8, 2, 3, 4],
        )
        .expect("image cache");

        let legacy_db_path = cache_dir.join("clipboard.db");
        let legacy_conn = Connection::open(&legacy_db_path).expect("legacy db");
        legacy_conn
            .execute_batch(
                "CREATE TABLE history (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp   INTEGER NOT NULL,
                    type        TEXT NOT NULL,
                    hash        TEXT NOT NULL UNIQUE,
                    size        INTEGER NOT NULL,
                    preview     TEXT,
                    pinned      INTEGER DEFAULT 0,
                    source      TEXT DEFAULT 'local',
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                );",
            )
            .expect("legacy schema");
        legacy_conn
            .execute(
                "INSERT INTO history (timestamp, type, hash, size, preview, pinned, source)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    1000_i64,
                    "text",
                    "text_hash",
                    15_i64,
                    "hello",
                    1_i64,
                    "local"
                ],
            )
            .expect("legacy text row");
        legacy_conn
            .execute(
                "INSERT INTO history (timestamp, type, hash, size, preview, pinned, source)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    2000_i64,
                    "image",
                    "image_hash",
                    4_i64,
                    "thumb",
                    0_i64,
                    "sync:Sim-PC-2"
                ],
            )
            .expect("legacy image row");

        let store = FlowStoreManager::new(root.join("flowsync")).expect("flow store");

        let first =
            FlowMigrationManager::backfill_legacy_history(&store, &legacy_db_path, &cache_dir)
                .expect("first backfill");
        assert!(first.legacy_db_found);
        assert_eq!(first.scanned, 2);
        assert_eq!(first.inserted, 2);
        assert_eq!(first.skipped_existing, 0);

        let second =
            FlowMigrationManager::backfill_legacy_history(&store, &legacy_db_path, &cache_dir)
                .expect("second backfill");
        assert!(second.legacy_db_found);
        assert_eq!(second.scanned, 2);
        assert_eq!(second.inserted, 0);
        assert_eq!(second.skipped_existing, 2);

        let counts = store.counts().expect("counts");
        assert_eq!(counts, (2, 2, 2));
    }

    #[test]
    fn backfill_reuses_existing_live_entry_instead_of_inserting_duplicate() {
        let root = unique_temp_dir("flow_migration_live");
        let cache_dir = root.join("cache");
        fs::create_dir_all(cache_dir.join("image")).expect("image dir");
        fs::write(cache_dir.join("image").join("live_image_hash.png"), [9u8, 8, 7, 6])
            .expect("image cache");

        let legacy_db_path = cache_dir.join("clipboard.db");
        let legacy_conn = Connection::open(&legacy_db_path).expect("legacy db");
        legacy_conn
            .execute_batch(
                "CREATE TABLE history (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp   INTEGER NOT NULL,
                    type        TEXT NOT NULL,
                    hash        TEXT NOT NULL UNIQUE,
                    size        INTEGER NOT NULL,
                    preview     TEXT,
                    pinned      INTEGER DEFAULT 0,
                    source      TEXT DEFAULT 'local',
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                );",
            )
            .expect("legacy schema");
        legacy_conn
            .execute(
                "INSERT INTO history (id, timestamp, type, hash, size, preview, pinned, source)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    501_i64,
                    5000_i64,
                    "image",
                    "live_image_hash",
                    4_i64,
                    "thumb",
                    0_i64,
                    "local"
                ],
            )
            .expect("legacy image row");

        let store = FlowStoreManager::new(root.join("flowsync")).expect("flow store");
        let live_entry_id = store
            .upsert_clipboard_entry(
                "image",
                "live_image_hash",
                4,
                Some("thumb"),
                "local",
                Some(&cache_dir.join("image").join("live_image_hash.png")),
                5000,
            )
            .expect("live flow entry");

        let report =
            FlowMigrationManager::backfill_legacy_history(&store, &legacy_db_path, &cache_dir)
                .expect("backfill");
        assert!(report.legacy_db_found);
        assert_eq!(report.scanned, 1);
        assert_eq!(report.inserted, 0);
        assert_eq!(report.skipped_existing, 1);

        let counts = store.counts().expect("counts");
        assert_eq!(counts, (1, 1, 1));

        let record = store
            .get_history_record_compat(live_entry_id)
            .expect("record lookup")
            .expect("record exists");
        assert_eq!(record.entry.hash, "live_image_hash");

        let conn = Connection::open(root.join("flowsync").join("entries.db")).expect("entries db");
        let legacy_id: Option<i64> = conn
            .query_row(
                "SELECT legacy_history_id FROM flow_entries WHERE id = ?1",
                params![live_entry_id],
                |row| row.get(0),
            )
            .expect("legacy id row");
        assert_eq!(legacy_id, Some(501));
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let unique = format!(
            "{}_{}_{}",
            prefix,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
    }
}
