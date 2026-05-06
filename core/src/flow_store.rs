use log::info;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use uuid::Uuid;
use walkdir::WalkDir;

pub static FLOW_STORE_MANAGER: RwLock<Option<FlowStoreManager>> = RwLock::new(None);

const SCHEMA_VERSION_INIT: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowStoreStatus {
    pub backend: &'static str,
    pub schema_version: u32,
    pub entries_db_name: &'static str,
    pub root_dir: String,
    pub entries_db_path: String,
}

#[derive(Debug, Clone)]
pub struct FlowObjectInsert {
    pub object_id: String,
    pub kind: String,
    pub root_hash: String,
    pub size_bytes: i64,
    pub chunk_count: i64,
    pub checksum_algo: String,
    pub local_storage_path: Option<String>,
    pub manifest_json: Option<String>,
    pub availability: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct FlowEntryInsert {
    pub entry_id: String,
    pub kind: String,
    pub title: Option<String>,
    pub preview: Option<String>,
    pub size_bytes: i64,
    pub pinned: bool,
    pub entry_source: String,
    pub direction: String,
    pub source_device_name: Option<String>,
    pub source_device_id: Option<String>,
    pub object_id: String,
    pub has_local_content: bool,
    pub transfer_status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub legacy_history_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct FlowHistoryEntryRecord {
    pub entry: crate::history::HistoryEntry,
    pub title: Option<String>,
    pub local_storage_path: Option<String>,
    pub manifest_json: Option<String>,
    pub object_id: String,
    pub source_device_id: Option<String>,
    pub stage_object_id: Option<String>,
    pub stage_expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowTransferRecord {
    pub transfer_id: String,
    pub entry_id: i64,
    pub object_id: String,
    pub status: String,
    pub direction: String,
    pub source_device_name: Option<String>,
    pub target_device_name: Option<String>,
    pub bytes_total: i64,
    pub bytes_done: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowEntryTransferState {
    pub entry_id: i64,
    pub has_local_content: bool,
    pub transfer_status: String,
    pub availability: String,
    pub source_device_name: Option<String>,
    pub source_device_id: Option<String>,
    pub stage_object_id: Option<String>,
    pub stage_expires_at: Option<i64>,
    pub latest_transfer: Option<FlowTransferRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowBundleManifestEntry {
    pub relative_path: String,
    pub kind: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowBundleManifest {
    pub root_name: String,
    pub item_count: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub size_bytes: u64,
    pub entries: Vec<FlowBundleManifestEntry>,
}

pub struct FlowStoreManager {
    root_dir: PathBuf,
    entries_db_path: PathBuf,
    conn: Mutex<Connection>,
}

impl FlowStoreManager {
    pub fn new(root_dir: PathBuf) -> Result<Self, String> {
        Self::ensure_layout(&root_dir)?;

        let entries_db_path = root_dir.join("entries.db");
        let conn = Connection::open(&entries_db_path)
            .map_err(|e| format!("Failed to open entries db: {}", e))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| format!("Failed to set entries db pragmas: {}", e))?;

        let manager = Self {
            root_dir,
            entries_db_path,
            conn: Mutex::new(conn),
        };
        manager.init_schema()?;
        info!(
            "FlowStoreManager initialized at {:?}",
            manager.entries_db_path
        );
        Ok(manager)
    }

    pub fn root_dir(&self) -> PathBuf {
        self.root_dir.clone()
    }

    pub fn entries_db_path(&self) -> PathBuf {
        self.entries_db_path.clone()
    }

    pub fn status(&self) -> Result<FlowStoreStatus, String> {
        Ok(FlowStoreStatus {
            backend: "sqlite",
            schema_version: self.current_schema_version()? as u32,
            entries_db_name: "entries.db",
            root_dir: self.root_dir.display().to_string(),
            entries_db_path: self.entries_db_path.display().to_string(),
        })
    }

    pub fn current_schema_version(&self) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query schema version: {}", e))
    }

    pub fn ensure_named_migration(
        &self,
        version: i64,
        name: &str,
        applied_at: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
             VALUES (?1, ?2, ?3)",
            params![version, name, applied_at],
        )
        .map_err(|e| format!("Failed to record schema migration {version}: {}", e))?;
        Ok(())
    }

    pub fn has_legacy_history_id(&self, legacy_id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let found = conn
            .query_row(
                "SELECT object_id FROM legacy_history_map WHERE legacy_id = ?1",
                params![legacy_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query legacy_history_map: {}", e))?;
        Ok(found.is_some())
    }

    fn has_legacy_object_binding(
        conn: &Connection,
        object_id: &str,
    ) -> Result<Option<i64>, String> {
        conn.query_row(
            "SELECT legacy_id FROM legacy_history_map WHERE object_id = ?1",
            params![object_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to query legacy binding by object_id: {}", e))
    }

    pub fn insert_legacy_backfill(
        &self,
        object: &FlowObjectInsert,
        entry: &FlowEntryInsert,
        legacy_id: i64,
    ) -> Result<bool, String> {
        let mut conn = self.conn.lock().unwrap();

        let existing = conn
            .query_row(
                "SELECT object_id FROM legacy_history_map WHERE legacy_id = ?1",
                params![legacy_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query existing legacy mapping: {}", e))?;
        if existing.is_some() {
            return Ok(false);
        }
        if Self::has_legacy_object_binding(&conn, &object.object_id)?.is_some() {
            return Ok(false);
        }

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start flow backfill transaction: {}", e))?;

        tx.execute(
            "INSERT INTO flow_objects (
                object_id, kind, root_hash, size_bytes, chunk_count, checksum_algo,
                local_storage_path, manifest_json, availability, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                object.object_id,
                object.kind,
                object.root_hash,
                object.size_bytes,
                object.chunk_count,
                object.checksum_algo,
                object.local_storage_path,
                object.manifest_json,
                object.availability,
                object.created_at,
                object.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to insert flow object: {}", e))?;

        tx.execute(
            "INSERT INTO flow_entries (
                entry_id, kind, title, preview, size_bytes, pinned,
                entry_source, direction, source_device_name, source_device_id,
                object_id, has_local_content, transfer_status,
                created_at, updated_at, legacy_history_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                entry.entry_id,
                entry.kind,
                entry.title,
                entry.preview,
                entry.size_bytes,
                if entry.pinned { 1 } else { 0 },
                entry.entry_source,
                entry.direction,
                entry.source_device_name,
                entry.source_device_id,
                entry.object_id,
                if entry.has_local_content { 1 } else { 0 },
                entry.transfer_status,
                entry.created_at,
                entry.updated_at,
                entry.legacy_history_id,
            ],
        )
        .map_err(|e| format!("Failed to insert flow entry: {}", e))?;

        tx.execute(
            "INSERT INTO legacy_history_map (legacy_id, object_id, migrated_at)
             VALUES (?1, ?2, ?3)",
            params![legacy_id, object.object_id, entry.updated_at],
        )
        .map_err(|e| format!("Failed to insert legacy history map: {}", e))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit flow backfill transaction: {}", e))?;
        Ok(true)
    }

    pub fn bind_legacy_history_to_existing_entry(
        &self,
        kind: &str,
        root_hash: &str,
        legacy_id: i64,
        migrated_at: i64,
    ) -> Result<bool, String> {
        let mut conn = self.conn.lock().unwrap();

        let existing = conn
            .query_row(
                "SELECT object_id FROM legacy_history_map WHERE legacy_id = ?1",
                params![legacy_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query existing legacy binding: {}", e))?;
        if existing.is_some() {
            return Ok(false);
        }

        let target = conn
            .query_row(
                "SELECT e.id, e.object_id
                 FROM flow_entries e
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE e.kind = ?1 AND o.root_hash = ?2
                 ORDER BY e.id DESC
                 LIMIT 1",
                params![kind, root_hash],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to query existing flow entry for legacy binding: {}", e))?;

        let Some((entry_id, object_id)) = target else {
            return Ok(false);
        };
        if Self::has_legacy_object_binding(&conn, &object_id)?.is_some() {
            return Ok(true);
        }

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start legacy binding transaction: {}", e))?;
        tx.execute(
            "UPDATE flow_entries
             SET legacy_history_id = COALESCE(legacy_history_id, ?1)
             WHERE id = ?2",
            params![legacy_id, entry_id],
        )
        .map_err(|e| format!("Failed to update flow entry legacy id: {}", e))?;
        tx.execute(
            "INSERT INTO legacy_history_map (legacy_id, object_id, migrated_at)
             VALUES (?1, ?2, ?3)",
            params![legacy_id, object_id, migrated_at],
        )
        .map_err(|e| format!("Failed to insert legacy binding map: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit legacy binding transaction: {}", e))?;
        Ok(true)
    }

    pub fn counts(&self) -> Result<(i64, i64, i64), String> {
        let conn = self.conn.lock().unwrap();
        let entries = conn
            .query_row("SELECT COUNT(*) FROM flow_entries", [], |row| row.get(0))
            .map_err(|e| format!("Failed to count flow_entries: {}", e))?;
        let objects = conn
            .query_row("SELECT COUNT(*) FROM flow_objects", [], |row| row.get(0))
            .map_err(|e| format!("Failed to count flow_objects: {}", e))?;
        let legacy_map = conn
            .query_row("SELECT COUNT(*) FROM legacy_history_map", [], |row| {
                row.get(0)
            })
            .map_err(|e| format!("Failed to count legacy_history_map: {}", e))?;
        Ok((entries, objects, legacy_map))
    }

    pub fn upsert_clipboard_entry(
        &self,
        kind: &str,
        root_hash: &str,
        size_bytes: i64,
        preview: Option<&str>,
        source: &str,
        local_storage_path: Option<&Path>,
        created_at: i64,
    ) -> Result<i64, String> {
        let (entry_source, direction, source_device_name) = map_runtime_source(kind, source);
        let mut conn = self.conn.lock().unwrap();

        let existing = conn
            .query_row(
                "SELECT e.id, e.object_id, e.pinned
                 FROM flow_entries e
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE e.kind = ?1 AND o.root_hash = ?2
                 ORDER BY e.id DESC
                 LIMIT 1",
                params![kind, root_hash],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)? != 0,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query existing flow entry for upsert: {}", e))?;

        let local_storage_path_string = local_storage_path.map(|path| path.display().to_string());

        match existing {
            Some((entry_id, object_id, pinned)) => {
                let tx = conn
                    .transaction()
                    .map_err(|e| format!("Failed to start flow upsert transaction: {}", e))?;
                tx.execute(
                    "UPDATE flow_objects
                     SET size_bytes = ?1,
                         local_storage_path = COALESCE(?2, local_storage_path),
                         availability = ?3,
                         updated_at = ?4
                     WHERE object_id = ?5",
                    params![
                        size_bytes,
                        local_storage_path_string,
                        if local_storage_path.is_some() {
                            "local_only"
                        } else {
                            "metadata_only"
                        },
                        created_at,
                        object_id,
                    ],
                )
                .map_err(|e| format!("Failed to update flow object during upsert: {}", e))?;
                tx.execute(
                    "UPDATE flow_entries
                     SET preview = ?1,
                         size_bytes = ?2,
                         pinned = ?3,
                         entry_source = ?4,
                         direction = ?5,
                         source_device_name = ?6,
                         has_local_content = ?7,
                         transfer_status = 'completed',
                         updated_at = ?8,
                         created_at = CASE WHEN created_at < ?8 THEN ?8 ELSE created_at END
                     WHERE id = ?9",
                    params![
                        preview,
                        size_bytes,
                        if pinned { 1 } else { 0 },
                        entry_source,
                        direction,
                        source_device_name,
                        if local_storage_path.is_some() { 1 } else { 0 },
                        created_at,
                        entry_id,
                    ],
                )
                .map_err(|e| format!("Failed to update flow entry during upsert: {}", e))?;
                tx.commit()
                    .map_err(|e| format!("Failed to commit flow upsert transaction: {}", e))?;
                Ok(entry_id)
            }
            None => {
                let object_id = Uuid::new_v4().to_string();
                let entry_uid = Uuid::new_v4().to_string();
                let tx = conn
                    .transaction()
                    .map_err(|e| format!("Failed to start flow insert transaction: {}", e))?;
                tx.execute(
                    "INSERT INTO flow_objects (
                        object_id, kind, root_hash, size_bytes, chunk_count, checksum_algo,
                        local_storage_path, manifest_json, availability, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, 1, 'blake3', ?5, NULL, ?6, ?7, ?7)",
                    params![
                        object_id,
                        kind,
                        root_hash,
                        size_bytes,
                        local_storage_path_string,
                        if local_storage_path.is_some() {
                            "local_only"
                        } else {
                            "metadata_only"
                        },
                        created_at,
                    ],
                )
                .map_err(|e| format!("Failed to insert flow object during upsert: {}", e))?;
                tx.execute(
                    "INSERT INTO flow_entries (
                        entry_id, kind, title, preview, size_bytes, pinned,
                        entry_source, direction, source_device_name, source_device_id,
                        object_id, has_local_content, transfer_status,
                        created_at, updated_at, legacy_history_id
                    ) VALUES (?1, ?2, NULL, ?3, ?4, 0, ?5, ?6, ?7, NULL, ?8, ?9, 'completed', ?10, ?10, NULL)",
                    params![
                        entry_uid,
                        kind,
                        preview,
                        size_bytes,
                        entry_source,
                        direction,
                        source_device_name,
                        object_id,
                        if local_storage_path.is_some() { 1 } else { 0 },
                        created_at,
                    ],
                )
                .map_err(|e| format!("Failed to insert flow entry during upsert: {}", e))?;
                let row_id = tx.last_insert_rowid();
                tx.commit()
                    .map_err(|e| format!("Failed to commit flow insert transaction: {}", e))?;
                Ok(row_id)
            }
        }
    }

    pub fn create_local_path_entry(
        &self,
        path: &Path,
        entry_source: &str,
        created_at: i64,
    ) -> Result<i64, String> {
        let local_path = fs::canonicalize(path)
            .map_err(|e| format!("Failed to resolve path {}: {}", path.display(), e))?;
        let metadata = fs::metadata(&local_path).map_err(|e| {
            format!(
                "Failed to read metadata for {}: {}",
                local_path.display(),
                e
            )
        })?;

        if metadata.is_file() {
            let size_bytes = metadata.len() as i64;
            let title = file_display_name(&local_path);
            let root_hash = compute_file_blake3(&local_path)?;
            let preview = Some(format!(
                "{} · {}",
                title,
                format_size_bytes(size_bytes as u64)
            ));
            return self.upsert_local_entry(
                "file",
                &root_hash,
                size_bytes,
                Some(&title),
                preview.as_deref(),
                Some(&local_path),
                None,
                1,
                entry_source,
                created_at,
            );
        }

        if metadata.is_dir() {
            let manifest = build_bundle_manifest(&local_path)?;
            let manifest_json = serde_json::to_string_pretty(&manifest)
                .map_err(|e| format!("Failed to encode bundle manifest: {}", e))?;
            let root_hash = blake3::hash(manifest_json.as_bytes()).to_hex().to_string();
            let manifest_path = self
                .root_dir
                .join("manifests")
                .join(format!("{root_hash}.json"));
            fs::write(&manifest_path, manifest_json.as_bytes()).map_err(|e| {
                format!(
                    "Failed to write bundle manifest {}: {}",
                    manifest_path.display(),
                    e
                )
            })?;
            let preview = Some(format!(
                "{} 项 · {} 文件 · {}",
                manifest.item_count,
                manifest.file_count,
                format_size_bytes(manifest.size_bytes),
            ));
            return self.upsert_local_entry(
                "bundle",
                &root_hash,
                manifest.size_bytes as i64,
                Some(&manifest.root_name),
                preview.as_deref(),
                Some(&local_path),
                Some(&manifest_json),
                std::cmp::max(1_i64, manifest.file_count as i64),
                entry_source,
                created_at,
            );
        }

        Err(format!(
            "Unsupported path type for FlowSync entry: {}",
            local_path.display()
        ))
    }

    pub fn upsert_remote_entry_offer(
        &self,
        kind: &str,
        root_hash: &str,
        size_bytes: i64,
        title: Option<&str>,
        preview: Option<&str>,
        manifest_json: Option<&str>,
        source_device_name: &str,
        source_device_id: Option<&str>,
        created_at: i64,
    ) -> Result<i64, String> {
        let mut conn = self.conn.lock().unwrap();
        let existing = conn
            .query_row(
                "SELECT e.id, e.object_id, e.pinned
                 FROM flow_entries e
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE e.kind = ?1 AND o.root_hash = ?2
                 ORDER BY e.id DESC
                 LIMIT 1",
                params![kind, root_hash],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)? != 0,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query existing remote flow entry: {}", e))?;

        match existing {
            Some((entry_id, object_id, pinned)) => {
                let tx = conn.transaction().map_err(|e| {
                    format!("Failed to start remote flow upsert transaction: {}", e)
                })?;
                tx.execute(
                    "UPDATE flow_objects
                     SET size_bytes = ?1,
                         manifest_json = COALESCE(?2, manifest_json),
                         availability = CASE
                             WHEN local_storage_path IS NOT NULL THEN 'local_only'
                             ELSE 'remote_device'
                         END,
                         updated_at = ?3
                     WHERE object_id = ?4",
                    params![size_bytes, manifest_json, created_at, object_id],
                )
                .map_err(|e| format!("Failed to update remote flow object: {}", e))?;
                tx.execute(
                    "UPDATE flow_entries
                     SET title = COALESCE(?1, title),
                         preview = ?2,
                         size_bytes = ?3,
                         pinned = ?4,
                         entry_source = 'remote_sync',
                         direction = 'received',
                         source_device_name = ?5,
                         source_device_id = COALESCE(?6, source_device_id),
                         transfer_status = CASE
                             WHEN has_local_content = 1 THEN 'completed'
                             ELSE 'metadata_only'
                         END,
                         updated_at = ?7,
                         created_at = CASE WHEN created_at < ?7 THEN ?7 ELSE created_at END
                     WHERE id = ?8",
                    params![
                        title,
                        preview,
                        size_bytes,
                        if pinned { 1 } else { 0 },
                        source_device_name,
                        source_device_id,
                        created_at,
                        entry_id,
                    ],
                )
                .map_err(|e| format!("Failed to update remote flow entry: {}", e))?;
                tx.commit().map_err(|e| {
                    format!("Failed to commit remote flow upsert transaction: {}", e)
                })?;
                Ok(entry_id)
            }
            None => {
                let object_id = Uuid::new_v4().to_string();
                let entry_uid = Uuid::new_v4().to_string();
                let tx = conn.transaction().map_err(|e| {
                    format!("Failed to start remote flow insert transaction: {}", e)
                })?;
                tx.execute(
                    "INSERT INTO flow_objects (
                        object_id, kind, root_hash, size_bytes, chunk_count, checksum_algo,
                        local_storage_path, manifest_json, availability, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, 1, 'blake3', NULL, ?5, 'remote_device', ?6, ?6)",
                    params![
                        object_id,
                        kind,
                        root_hash,
                        size_bytes,
                        manifest_json,
                        created_at
                    ],
                )
                .map_err(|e| format!("Failed to insert remote flow object: {}", e))?;
                tx.execute(
                    "INSERT INTO flow_entries (
                        entry_id, kind, title, preview, size_bytes, pinned,
                        entry_source, direction, source_device_name, source_device_id,
                        object_id, has_local_content, transfer_status,
                        created_at, updated_at, legacy_history_id
                    ) VALUES (?1, ?2, ?3, ?4, ?5, 0, 'remote_sync', 'received', ?6, ?7, ?8, 0, 'metadata_only', ?9, ?9, NULL)",
                    params![
                        entry_uid,
                        kind,
                        title,
                        preview,
                        size_bytes,
                        source_device_name,
                        source_device_id,
                        object_id,
                        created_at,
                    ],
                )
                .map_err(|e| format!("Failed to insert remote flow entry: {}", e))?;
                let row_id = tx.last_insert_rowid();
                tx.commit().map_err(|e| {
                    format!("Failed to commit remote flow insert transaction: {}", e)
                })?;
                Ok(row_id)
            }
        }
    }

    pub fn query_history_compat(
        &self,
        type_filter: Option<&str>,
        time_from: Option<i64>,
        time_to: Option<i64>,
        source_filter: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<crate::history::HistoryEntry>, String> {
        let records = self.query_history_records(
            type_filter,
            time_from,
            time_to,
            source_filter,
            limit,
            offset,
        )?;
        Ok(records.into_iter().map(|record| record.entry).collect())
    }

    pub fn search_history_compat(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<crate::history::HistoryEntry>, String> {
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT
                    e.id,
                    e.created_at,
                    e.kind,
                    o.root_hash,
                    e.size_bytes,
                    e.title,
                    e.preview,
                    e.pinned,
                    e.entry_source,
                    e.direction,
                    e.source_device_name,
                    e.source_device_id,
                    o.local_storage_path,
                    o.manifest_json,
                    e.object_id,
                    o.stage_object_id,
                    o.stage_expires_at
                 FROM flow_entries_fts f
                 JOIN flow_entries e ON e.id = f.rowid
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE flow_entries_fts MATCH ?1
                 ORDER BY e.created_at DESC
                LIMIT ?2",
            )
            .map_err(|e| format!("Failed to prepare flow entry search: {}", e))?;

        let rows = stmt
            .query_map(params![fts_query, limit], |row| row_to_history_record(row))
            .map_err(|e| format!("Failed to search flow entries: {}", e))?;

        Ok(rows
            .filter_map(|row| row.ok().map(|record| record.entry))
            .collect())
    }

    pub fn get_history_record_compat(
        &self,
        id: i64,
    ) -> Result<Option<FlowHistoryEntryRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT
                    e.id,
                    e.created_at,
                    e.kind,
                    o.root_hash,
                    e.size_bytes,
                    e.title,
                    e.preview,
                    e.pinned,
                    e.entry_source,
                    e.direction,
                    e.source_device_name,
                    e.source_device_id,
                    o.local_storage_path,
                    o.manifest_json,
                    e.object_id,
                    o.stage_object_id,
                    o.stage_expires_at
                  FROM flow_entries e
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE e.id = ?1",
                params![id],
                |row| row_to_history_record(row),
            )
            .optional()
            .map_err(|e| format!("Failed to query flow entry by id: {}", e))?;
        Ok(row)
    }

    pub fn get_history_record_by_kind_hash(
        &self,
        kind: &str,
        root_hash: &str,
    ) -> Result<Option<FlowHistoryEntryRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT
                    e.id,
                    e.created_at,
                    e.kind,
                    o.root_hash,
                    e.size_bytes,
                    e.title,
                    e.preview,
                    e.pinned,
                    e.entry_source,
                    e.direction,
                    e.source_device_name,
                    e.source_device_id,
                    o.local_storage_path,
                    o.manifest_json,
                    e.object_id,
                    o.stage_object_id,
                    o.stage_expires_at
                 FROM flow_entries e
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE e.kind = ?1 AND o.root_hash = ?2
                 ORDER BY e.id DESC
                 LIMIT 1",
                params![kind, root_hash],
                |row| row_to_history_record(row),
            )
            .optional()
            .map_err(|e| format!("Failed to query flow entry by kind/hash: {}", e))?;
        Ok(row)
    }

    pub fn upsert_transfer_session(
        &self,
        entry_id: i64,
        transfer_id: &str,
        direction: &str,
        status: &str,
        source_device_name: Option<&str>,
        target_device_name: Option<&str>,
        bytes_total: i64,
        bytes_done: i64,
        updated_at: i64,
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().unwrap();
        let object_id = conn
            .query_row(
                "SELECT object_id FROM flow_entries WHERE id = ?1",
                params![entry_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to load object_id for transfer session: {}", e))?
            .ok_or_else(|| format!("Flow entry {} not found for transfer session", entry_id))?;

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start transfer session transaction: {}", e))?;
        let exists = tx
            .query_row(
                "SELECT COUNT(*) FROM flow_transfers WHERE transfer_id = ?1",
                params![transfer_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("Failed to query transfer session: {}", e))?
            > 0;

        if exists {
            tx.execute(
                "UPDATE flow_transfers
                 SET status = ?1,
                     source_device_name = COALESCE(?2, source_device_name),
                     target_device_name = COALESCE(?3, target_device_name),
                     bytes_total = CASE WHEN ?4 > 0 THEN ?4 ELSE bytes_total END,
                     bytes_done = ?5,
                     updated_at = ?6
                 WHERE transfer_id = ?7",
                params![
                    status,
                    source_device_name,
                    target_device_name,
                    bytes_total,
                    bytes_done,
                    updated_at,
                    transfer_id,
                ],
            )
            .map_err(|e| format!("Failed to update transfer session: {}", e))?;
        } else {
            tx.execute(
                "INSERT INTO flow_transfers (
                    transfer_id, entry_id, object_id, status, direction,
                    source_device_name, target_device_name, bytes_total, bytes_done,
                    created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![
                    transfer_id,
                    entry_id.to_string(),
                    object_id,
                    status,
                    direction,
                    source_device_name,
                    target_device_name,
                    bytes_total,
                    bytes_done,
                    updated_at,
                ],
            )
            .map_err(|e| format!("Failed to insert transfer session: {}", e))?;
        }

        tx.execute(
            "UPDATE flow_entries
             SET transfer_status = ?1,
                 updated_at = ?2
             WHERE id = ?3",
            params![status, updated_at, entry_id],
        )
        .map_err(|e| format!("Failed to update entry transfer status: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit transfer session transaction: {}", e))?;
        Ok(())
    }

    pub fn get_entry_transfer_state(
        &self,
        entry_id: i64,
    ) -> Result<Option<FlowEntryTransferState>, String> {
        let conn = self.conn.lock().unwrap();
        let entry = conn
            .query_row(
                "SELECT
                    e.id,
                    e.has_local_content,
                    e.transfer_status,
                    o.availability,
                    e.source_device_name,
                    e.source_device_id,
                    o.stage_object_id,
                    o.stage_expires_at
                 FROM flow_entries e
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE e.id = ?1",
                params![entry_id],
                |row| {
                    Ok(FlowEntryTransferState {
                        entry_id: row.get(0)?,
                        has_local_content: row.get::<_, i64>(1)? != 0,
                        transfer_status: row.get(2)?,
                        availability: row.get(3)?,
                        source_device_name: row.get(4)?,
                        source_device_id: row.get(5)?,
                        stage_object_id: row.get(6)?,
                        stage_expires_at: row.get(7)?,
                        latest_transfer: None,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query transfer state: {}", e))?;

        let Some(mut state) = entry else {
            return Ok(None);
        };

        let latest_transfer = conn
            .query_row(
                "SELECT
                    transfer_id,
                    entry_id,
                    object_id,
                    status,
                    direction,
                    source_device_name,
                    target_device_name,
                    bytes_total,
                    bytes_done,
                    created_at,
                    updated_at
                 FROM flow_transfers
                 WHERE entry_id = ?1
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1",
                params![entry_id.to_string()],
                |row| {
                    Ok(FlowTransferRecord {
                        transfer_id: row.get(0)?,
                        entry_id: row.get::<_, String>(1)?.parse().unwrap_or_default(),
                        object_id: row.get(2)?,
                        status: row.get(3)?,
                        direction: row.get(4)?,
                        source_device_name: row.get(5)?,
                        target_device_name: row.get(6)?,
                        bytes_total: row.get(7)?,
                        bytes_done: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query latest transfer session: {}", e))?;

        state.latest_transfer = latest_transfer;
        Ok(Some(state))
    }

    pub fn mark_transfer_completed(
        &self,
        transfer_id: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE flow_transfers
             SET status = 'completed',
                 bytes_done = bytes_total,
                 updated_at = ?1
             WHERE transfer_id = ?2",
            params![updated_at, transfer_id],
        )
        .map_err(|e| format!("Failed to mark transfer completed: {}", e))?;
        conn.execute(
            "UPDATE flow_entries
             SET transfer_status = 'completed',
                 updated_at = ?1
             WHERE id IN (
                 SELECT CAST(entry_id AS INTEGER) FROM flow_transfers WHERE transfer_id = ?2
             )",
            params![updated_at, transfer_id],
        )
        .map_err(|e| format!("Failed to mark entry completed: {}", e))?;
        Ok(())
    }

    pub fn mark_transfer_failed(&self, transfer_id: &str, updated_at: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE flow_transfers
             SET status = 'failed',
                 updated_at = ?1
             WHERE transfer_id = ?2",
            params![updated_at, transfer_id],
        )
        .map_err(|e| format!("Failed to mark transfer failed: {}", e))?;
        conn.execute(
            "UPDATE flow_entries
             SET transfer_status = 'failed',
                 updated_at = ?1
             WHERE id IN (
                 SELECT CAST(entry_id AS INTEGER) FROM flow_transfers WHERE transfer_id = ?2
             )",
            params![updated_at, transfer_id],
        )
        .map_err(|e| format!("Failed to mark entry failed: {}", e))?;
        Ok(())
    }

    pub fn finalize_downloaded_entry(
        &self,
        entry_id: i64,
        local_storage_path: &Path,
        manifest_json: Option<&str>,
        transfer_id: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        let local_storage_path_string = local_storage_path.display().to_string();
        let mut conn = self.conn.lock().unwrap();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start finalize download transaction: {}", e))?;
        tx.execute(
            "UPDATE flow_objects
             SET local_storage_path = ?1,
                 manifest_json = COALESCE(?2, manifest_json),
                 availability = 'local_only',
                 updated_at = ?3
             WHERE object_id = (
                 SELECT object_id FROM flow_entries WHERE id = ?4
             )",
            params![
                local_storage_path_string,
                manifest_json,
                updated_at,
                entry_id
            ],
        )
        .map_err(|e| format!("Failed to update downloaded object: {}", e))?;
        tx.execute(
            "UPDATE flow_entries
             SET has_local_content = 1,
                 transfer_status = 'completed',
                 updated_at = ?1
             WHERE id = ?2",
            params![updated_at, entry_id],
        )
        .map_err(|e| format!("Failed to update downloaded entry: {}", e))?;
        tx.execute(
            "UPDATE flow_transfers
             SET status = 'completed',
                 bytes_done = bytes_total,
                 updated_at = ?1
             WHERE transfer_id = ?2",
            params![updated_at, transfer_id],
        )
        .map_err(|e| format!("Failed to update downloaded transfer session: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit finalize download transaction: {}", e))?;
        Ok(())
    }

    pub fn mark_entry_nas_staged(
        &self,
        entry_id: i64,
        stage_object_id: &str,
        stage_expires_at: i64,
        updated_at: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE flow_objects
             SET availability = 'nas_staged',
                 stage_object_id = ?1,
                 stage_expires_at = ?2,
                 updated_at = ?3
             WHERE object_id = (
                 SELECT object_id FROM flow_entries WHERE id = ?4
             )",
            params![stage_object_id, stage_expires_at, updated_at, entry_id],
        )
        .map_err(|e| format!("Failed to mark entry as nas staged: {}", e))?;
        Ok(())
    }

    pub fn clear_stage_object(&self, stage_object_id: &str, updated_at: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE flow_objects
             SET availability = CASE
                    WHEN local_storage_path IS NOT NULL THEN 'local_only'
                    ELSE 'metadata_only'
                 END,
                 stage_object_id = NULL,
                 stage_expires_at = NULL,
                 updated_at = ?1
             WHERE stage_object_id = ?2",
            params![updated_at, stage_object_id],
        )
        .map_err(|e| format!("Failed to clear stage object metadata: {}", e))?;
        Ok(())
    }

    pub fn delete_history_compat(&self, ids: &[i64]) -> Result<u32, String> {
        if ids.is_empty() {
            return Ok(0);
        }

        let mut conn = self.conn.lock().unwrap();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start flow delete transaction: {}", e))?;

        for id in ids {
            let object_id = tx
                .query_row(
                    "SELECT object_id FROM flow_entries WHERE id = ?1",
                    params![id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| format!("Failed to load flow entry before delete: {}", e))?;

            tx.execute("DELETE FROM flow_entries WHERE id = ?1", params![id])
                .map_err(|e| format!("Failed to delete flow entry: {}", e))?;

            if let Some(object_id) = object_id {
                let has_remaining: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM flow_entries WHERE object_id = ?1",
                        params![object_id.clone()],
                        |row| row.get(0),
                    )
                    .map_err(|e| format!("Failed to check remaining flow entries: {}", e))?;
                if has_remaining == 0 {
                    tx.execute(
                        "DELETE FROM legacy_history_map WHERE object_id = ?1",
                        params![object_id.clone()],
                    )
                    .map_err(|e| format!("Failed to delete legacy history map: {}", e))?;
                    tx.execute(
                        "DELETE FROM flow_chunks WHERE object_id = ?1",
                        params![object_id.clone()],
                    )
                    .map_err(|e| format!("Failed to delete flow chunks: {}", e))?;
                    tx.execute(
                        "DELETE FROM flow_transfers WHERE object_id = ?1",
                        params![object_id.clone()],
                    )
                    .map_err(|e| format!("Failed to delete flow transfers: {}", e))?;
                    tx.execute(
                        "DELETE FROM flow_objects WHERE object_id = ?1",
                        params![object_id],
                    )
                    .map_err(|e| format!("Failed to delete flow object: {}", e))?;
                }
            }
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit flow delete transaction: {}", e))?;
        Ok(ids.len() as u32)
    }

    pub fn touch_history_compat(&self, id: i64, timestamp: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE flow_entries
             SET created_at = CASE WHEN created_at < ?1 THEN ?1 ELSE created_at END,
                 updated_at = ?1
             WHERE id = ?2",
            params![timestamp, id],
        )
        .map_err(|e| format!("Failed to touch flow entry: {}", e))?;
        Ok(())
    }

    pub fn toggle_history_pin_compat(&self, id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let pinned: bool = conn
            .query_row(
                "SELECT pinned FROM flow_entries WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value != 0)
            .map_err(|e| format!("Failed to get flow pin state: {}", e))?;
        let next = if pinned { 0 } else { 1 };
        conn.execute(
            "UPDATE flow_entries SET pinned = ?1 WHERE id = ?2",
            params![next, id],
        )
        .map_err(|e| format!("Failed to toggle flow pin state: {}", e))?;
        Ok(!pinned)
    }

    pub fn history_stats_compat(&self) -> Result<(i64, i64, i64), String> {
        let conn = self.conn.lock().unwrap();
        let total = conn
            .query_row("SELECT COUNT(*) FROM flow_entries", [], |row| row.get(0))
            .map_err(|e| format!("Failed to count flow_entries: {}", e))?;
        let text = conn
            .query_row(
                "SELECT COUNT(*) FROM flow_entries WHERE kind='text'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count text flow_entries: {}", e))?;
        let image = conn
            .query_row(
                "SELECT COUNT(*) FROM flow_entries WHERE kind='image'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count image flow_entries: {}", e))?;
        Ok((total, text, image))
    }

    fn query_history_records(
        &self,
        type_filter: Option<&str>,
        time_from: Option<i64>,
        time_to: Option<i64>,
        source_filter: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<FlowHistoryEntryRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT
                e.id,
                e.created_at,
                e.kind,
                o.root_hash,
                e.size_bytes,
                e.title,
                e.preview,
                e.pinned,
                    e.entry_source,
                    e.direction,
                    e.source_device_name,
                    e.source_device_id,
                    o.local_storage_path,
                    o.manifest_json,
                    e.object_id,
                    o.stage_object_id,
                    o.stage_expires_at
             FROM flow_entries e
             JOIN flow_objects o ON o.object_id = e.object_id
             WHERE 1=1",
        );
        if type_filter.is_some() {
            sql.push_str(" AND e.kind = ?");
        }
        if time_from.is_some() {
            sql.push_str(" AND e.created_at >= ?");
        }
        if time_to.is_some() {
            sql.push_str(" AND e.created_at < ?");
        }
        if source_filter.is_some() {
            sql.push_str(" AND ((e.direction = 'local' AND ? = 'local') OR (? != 'local' AND COALESCE(e.source_device_name, '') = ?))");
        }
        sql.push_str(" ORDER BY e.created_at DESC LIMIT ? OFFSET ?");

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare flow entry query: {}", e))?;
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(value) = type_filter {
            values.push(Box::new(value.to_string()));
        }
        if let Some(value) = time_from {
            values.push(Box::new(value));
        }
        if let Some(value) = time_to {
            values.push(Box::new(value));
        }
        if let Some(value) = source_filter {
            values.push(Box::new(value.to_string()));
            values.push(Box::new(value.to_string()));
            values.push(Box::new(value.to_string()));
        }
        values.push(Box::new(limit));
        values.push(Box::new(offset));
        let refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|value| value.as_ref()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), |row| row_to_history_record(row))
            .map_err(|e| format!("Failed to query flow entries: {}", e))?;
        Ok(rows.filter_map(|row| row.ok()).collect())
    }

    fn ensure_layout(root_dir: &Path) -> Result<(), String> {
        let dirs = [
            root_dir.to_path_buf(),
            root_dir.join("objects"),
            root_dir.join("objects").join("text"),
            root_dir.join("objects").join("image"),
            root_dir.join("objects").join("file"),
            root_dir.join("objects").join("bundle"),
            root_dir.join("chunks"),
            root_dir.join("manifests"),
            root_dir.join("staging"),
            root_dir.join("temp"),
        ];

        for dir in dirs {
            fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create FlowSync dir {:?}: {}", dir, e))?;
        }
        Ok(())
    }

    fn upsert_local_entry(
        &self,
        kind: &str,
        root_hash: &str,
        size_bytes: i64,
        title: Option<&str>,
        preview: Option<&str>,
        local_storage_path: Option<&Path>,
        manifest_json: Option<&str>,
        chunk_count: i64,
        entry_source: &str,
        created_at: i64,
    ) -> Result<i64, String> {
        let mut conn = self.conn.lock().unwrap();
        let existing = conn
            .query_row(
                "SELECT e.id, e.object_id, e.pinned
                 FROM flow_entries e
                 JOIN flow_objects o ON o.object_id = e.object_id
                 WHERE e.kind = ?1 AND o.root_hash = ?2
                 ORDER BY e.id DESC
                 LIMIT 1",
                params![kind, root_hash],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)? != 0,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query existing local flow entry: {}", e))?;

        let local_storage_path_string = local_storage_path.map(|path| path.display().to_string());

        match existing {
            Some((entry_id, object_id, pinned)) => {
                let tx = conn
                    .transaction()
                    .map_err(|e| format!("Failed to start local flow upsert transaction: {}", e))?;
                tx.execute(
                    "UPDATE flow_objects
                     SET size_bytes = ?1,
                         chunk_count = ?2,
                         local_storage_path = COALESCE(?3, local_storage_path),
                         manifest_json = COALESCE(?4, manifest_json),
                         availability = ?5,
                         updated_at = ?6
                     WHERE object_id = ?7",
                    params![
                        size_bytes,
                        chunk_count,
                        local_storage_path_string,
                        manifest_json,
                        if local_storage_path.is_some() {
                            "local_only"
                        } else {
                            "metadata_only"
                        },
                        created_at,
                        object_id,
                    ],
                )
                .map_err(|e| format!("Failed to update local flow object: {}", e))?;
                tx.execute(
                    "UPDATE flow_entries
                     SET title = COALESCE(?1, title),
                         preview = ?2,
                         size_bytes = ?3,
                         pinned = ?4,
                         entry_source = ?5,
                         direction = 'local',
                         source_device_name = NULL,
                         has_local_content = ?6,
                         transfer_status = 'completed',
                         updated_at = ?7,
                         created_at = CASE WHEN created_at < ?7 THEN ?7 ELSE created_at END
                     WHERE id = ?8",
                    params![
                        title,
                        preview,
                        size_bytes,
                        if pinned { 1 } else { 0 },
                        entry_source,
                        if local_storage_path.is_some() { 1 } else { 0 },
                        created_at,
                        entry_id,
                    ],
                )
                .map_err(|e| format!("Failed to update local flow entry: {}", e))?;
                tx.commit().map_err(|e| {
                    format!("Failed to commit local flow upsert transaction: {}", e)
                })?;
                Ok(entry_id)
            }
            None => {
                let object_id = Uuid::new_v4().to_string();
                let entry_uid = Uuid::new_v4().to_string();
                let tx = conn
                    .transaction()
                    .map_err(|e| format!("Failed to start local flow insert transaction: {}", e))?;
                tx.execute(
                    "INSERT INTO flow_objects (
                        object_id, kind, root_hash, size_bytes, chunk_count, checksum_algo,
                        local_storage_path, manifest_json, availability, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, 'blake3', ?6, ?7, ?8, ?9, ?9)",
                    params![
                        object_id,
                        kind,
                        root_hash,
                        size_bytes,
                        chunk_count,
                        local_storage_path_string,
                        manifest_json,
                        if local_storage_path.is_some() {
                            "local_only"
                        } else {
                            "metadata_only"
                        },
                        created_at,
                    ],
                )
                .map_err(|e| format!("Failed to insert local flow object: {}", e))?;
                tx.execute(
                    "INSERT INTO flow_entries (
                        entry_id, kind, title, preview, size_bytes, pinned,
                        entry_source, direction, source_device_name, source_device_id,
                        object_id, has_local_content, transfer_status,
                        created_at, updated_at, legacy_history_id
                    ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'local', NULL, NULL, ?7, ?8, 'completed', ?9, ?9, NULL)",
                    params![
                        entry_uid,
                        kind,
                        title,
                        preview,
                        size_bytes,
                        entry_source,
                        object_id,
                        if local_storage_path.is_some() { 1 } else { 0 },
                        created_at,
                    ],
                )
                .map_err(|e| format!("Failed to insert local flow entry: {}", e))?;
                let row_id = tx.last_insert_rowid();
                tx.commit().map_err(|e| {
                    format!("Failed to commit local flow insert transaction: {}", e)
                })?;
                Ok(row_id)
            }
        }
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version       INTEGER PRIMARY KEY,
                name          TEXT NOT NULL,
                applied_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS flow_objects (
                object_id           TEXT PRIMARY KEY,
                kind                TEXT NOT NULL CHECK(kind IN ('text', 'image', 'file', 'bundle')),
                root_hash           TEXT NOT NULL,
                size_bytes          INTEGER NOT NULL DEFAULT 0,
                chunk_count         INTEGER NOT NULL DEFAULT 1,
                checksum_algo       TEXT NOT NULL DEFAULT 'blake3',
                local_storage_path  TEXT,
                manifest_json       TEXT,
                availability        TEXT NOT NULL DEFAULT 'local_only',
                stage_object_id     TEXT,
                stage_expires_at    INTEGER,
                created_at          INTEGER NOT NULL,
                updated_at          INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS flow_entries (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id              TEXT NOT NULL UNIQUE,
                kind                  TEXT NOT NULL CHECK(kind IN ('text', 'image', 'file', 'bundle')),
                title                 TEXT,
                preview               TEXT,
                size_bytes            INTEGER NOT NULL DEFAULT 0,
                pinned                INTEGER NOT NULL DEFAULT 0,
                entry_source          TEXT NOT NULL,
                direction             TEXT NOT NULL,
                source_device_name    TEXT,
                source_device_id      TEXT,
                object_id             TEXT NOT NULL,
                has_local_content     INTEGER NOT NULL DEFAULT 0,
                transfer_status       TEXT NOT NULL DEFAULT 'completed',
                created_at            INTEGER NOT NULL,
                updated_at            INTEGER NOT NULL,
                legacy_history_id     INTEGER UNIQUE,
                FOREIGN KEY(object_id) REFERENCES flow_objects(object_id)
            );

            CREATE INDEX IF NOT EXISTS idx_flow_entries_created_at ON flow_entries(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_flow_entries_kind_created_at ON flow_entries(kind, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_flow_entries_object_id ON flow_entries(object_id);
            CREATE INDEX IF NOT EXISTS idx_flow_entries_source_device_name ON flow_entries(source_device_name);

            CREATE TABLE IF NOT EXISTS flow_chunks (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                object_id       TEXT NOT NULL,
                chunk_index     INTEGER NOT NULL,
                chunk_hash      TEXT NOT NULL,
                size_bytes      INTEGER NOT NULL DEFAULT 0,
                local_path      TEXT,
                created_at      INTEGER NOT NULL,
                UNIQUE(object_id, chunk_index),
                FOREIGN KEY(object_id) REFERENCES flow_objects(object_id)
            );

            CREATE TABLE IF NOT EXISTS flow_transfers (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                transfer_id         TEXT NOT NULL UNIQUE,
                entry_id            TEXT NOT NULL,
                object_id           TEXT NOT NULL,
                status              TEXT NOT NULL,
                direction           TEXT NOT NULL,
                source_device_name  TEXT,
                target_device_name  TEXT,
                bytes_total         INTEGER NOT NULL DEFAULT 0,
                bytes_done          INTEGER NOT NULL DEFAULT 0,
                created_at          INTEGER NOT NULL,
                updated_at          INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_flow_transfers_status ON flow_transfers(status, updated_at DESC);

            CREATE TABLE IF NOT EXISTS legacy_history_map (
                legacy_id      INTEGER PRIMARY KEY,
                object_id      TEXT NOT NULL UNIQUE,
                migrated_at    INTEGER NOT NULL,
                FOREIGN KEY(object_id) REFERENCES flow_objects(object_id)
            );
            "
        )
        .map_err(|e| format!("Failed to initialize FlowSync schema: {}", e))?;

        ensure_column(&conn, "flow_objects", "stage_object_id", "TEXT")?;
        ensure_column(&conn, "flow_objects", "stage_expires_at", "INTEGER")?;

        let fts_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='flow_entries_fts'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);

        if !fts_exists {
            conn.execute_batch(
                "CREATE VIRTUAL TABLE flow_entries_fts USING fts5(
                    title,
                    preview,
                    source_device_name,
                    content='flow_entries',
                    content_rowid='id'
                );

                CREATE TRIGGER IF NOT EXISTS flow_entries_ai AFTER INSERT ON flow_entries BEGIN
                    INSERT INTO flow_entries_fts(rowid, title, preview, source_device_name)
                    VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.preview, ''), COALESCE(new.source_device_name, ''));
                END;

                CREATE TRIGGER IF NOT EXISTS flow_entries_ad AFTER DELETE ON flow_entries BEGIN
                    INSERT INTO flow_entries_fts(flow_entries_fts, rowid, title, preview, source_device_name)
                    VALUES('delete', old.id, COALESCE(old.title, ''), COALESCE(old.preview, ''), COALESCE(old.source_device_name, ''));
                END;

                CREATE TRIGGER IF NOT EXISTS flow_entries_au AFTER UPDATE ON flow_entries BEGIN
                    INSERT INTO flow_entries_fts(flow_entries_fts, rowid, title, preview, source_device_name)
                    VALUES('delete', old.id, COALESCE(old.title, ''), COALESCE(old.preview, ''), COALESCE(old.source_device_name, ''));
                    INSERT INTO flow_entries_fts(rowid, title, preview, source_device_name)
                    VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.preview, ''), COALESCE(new.source_device_name, ''));
                END;"
            )
            .map_err(|e| format!("Failed to initialize FlowSync FTS: {}", e))?;
        }

        let applied_at = current_unix_ms();
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
             VALUES (?1, ?2, ?3)",
            params![SCHEMA_VERSION_INIT, "init_flow_entries_schema", applied_at],
        )
        .map_err(|e| format!("Failed to record initial FlowSync schema migration: {}", e))?;

        Ok(())
    }
}

fn current_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn map_runtime_source(kind: &str, source: &str) -> (String, String, Option<String>) {
    if source == "local" {
        let entry_source = match kind {
            "text" => "clipboard_text",
            "image" => "clipboard_image",
            _ => "remote_sync",
        };
        return (entry_source.to_string(), "local".to_string(), None);
    }

    if source.starts_with("sync:") || source.starts_with("pull:") {
        return (
            "remote_sync".to_string(),
            "received".to_string(),
            Some(source.to_string()),
        );
    }

    (
        "remote_sync".to_string(),
        "received".to_string(),
        Some(source.to_string()),
    )
}

fn compat_source(
    entry_source: &str,
    direction: &str,
    source_device_name: Option<String>,
) -> String {
    if direction == "local" {
        return "local".to_string();
    }

    if let Some(source_device_name) = source_device_name {
        if source_device_name.starts_with("sync:") || source_device_name.starts_with("pull:") {
            return source_device_name;
        }
        if entry_source == "remote_sync" {
            return format!("sync:{source_device_name}");
        }
        return source_device_name;
    }

    "local".to_string()
}

fn row_to_history_record(row: &rusqlite::Row) -> rusqlite::Result<FlowHistoryEntryRecord> {
    let entry_source: String = row.get(8)?;
    let direction: String = row.get(9)?;
    let source_device_name: Option<String> = row.get(10)?;
    let source = compat_source(&entry_source, &direction, source_device_name);
    Ok(FlowHistoryEntryRecord {
        entry: crate::history::HistoryEntry {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            entry_type: row.get(2)?,
            hash: row.get(3)?,
            size: row.get(4)?,
            preview: row.get(6)?,
            pinned: row.get::<_, i64>(7)? != 0,
            source,
        },
        title: row.get(5)?,
        source_device_id: row.get(11)?,
        local_storage_path: row.get(12)?,
        manifest_json: row.get(13)?,
        object_id: row.get(14)?,
        stage_object_id: row.get(15)?,
        stage_expires_at: row.get(16)?,
    })
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("Failed to inspect schema for {table}: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to read schema for {table}: {}", e))?;
    for row in rows {
        if row.map_err(|e| format!("Failed to decode schema row for {table}: {}", e))? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )
    .map_err(|e| format!("Failed to add schema column {table}.{column}: {}", e))?;
    Ok(())
}

fn file_display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.display().to_string())
}

pub fn compute_file_blake3(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Failed to open file {}: {}", path.display(), e))?;
    let mut reader = BufReader::new(file);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read file {}: {}", path.display(), e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

pub fn build_bundle_manifest(root: &Path) -> Result<FlowBundleManifest, String> {
    let root_name = file_display_name(root);
    let mut entries = Vec::new();
    let mut file_count = 0_u64;
    let mut dir_count = 0_u64;
    let mut size_bytes = 0_u64;

    for entry in WalkDir::new(root).min_depth(1).sort_by_file_name() {
        let entry =
            entry.map_err(|e| format!("Failed to walk bundle {}: {}", root.display(), e))?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(root)
            .map_err(|e| {
                format!(
                    "Failed to derive relative path for {}: {}",
                    path.display(),
                    e
                )
            })?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata for {}: {}", path.display(), e))?;

        if metadata.is_dir() {
            dir_count += 1;
            entries.push(FlowBundleManifestEntry {
                relative_path,
                kind: "dir".to_string(),
                size_bytes: 0,
            });
            continue;
        }

        if metadata.is_file() {
            let file_size = metadata.len();
            file_count += 1;
            size_bytes += file_size;
            entries.push(FlowBundleManifestEntry {
                relative_path,
                kind: "file".to_string(),
                size_bytes: file_size,
            });
        }
    }

    Ok(FlowBundleManifest {
        root_name,
        item_count: file_count + dir_count,
        file_count,
        dir_count,
        size_bytes,
        entries,
    })
}

fn format_size_bytes(size_bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let size = size_bytes as f64;
    if size >= GB {
        format!("{:.2} GB", size / GB)
    } else if size >= MB {
        format!("{:.2} MB", size / MB)
    } else if size >= KB {
        format!("{:.2} KB", size / KB)
    } else {
        format!("{} B", size_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::{FlowEntryInsert, FlowObjectInsert, FlowStoreManager};
    use rusqlite::params;
    use std::path::PathBuf;

    #[test]
    fn initializes_entries_db_and_directory_layout() {
        let root = unique_temp_dir("flow_store_init");
        let store = FlowStoreManager::new(root.clone()).expect("flow store should initialize");

        let status = store.status().expect("status should load");
        assert_eq!(status.entries_db_name, "entries.db");
        assert!(PathBuf::from(&status.entries_db_path).exists());
        assert!(root.join("objects").join("text").exists());
        assert!(root.join("objects").join("image").exists());
        assert!(root.join("chunks").exists());
        assert!(root.join("manifests").exists());
        assert!(root.join("staging").exists());
        assert!(root.join("temp").exists());
        assert!(status.schema_version >= 1);
    }

    #[test]
    fn upsert_clipboard_entry_is_compatible_with_history_queries() {
        let root = unique_temp_dir("flow_store_live");
        let store = FlowStoreManager::new(root.clone()).expect("flow store should initialize");
        let text_path = root.join("objects").join("text").join("demo.txt");
        std::fs::write(&text_path, "hello").expect("write local text");

        let first_id = store
            .upsert_clipboard_entry(
                "text",
                "text_hash",
                5,
                Some("hello"),
                "local",
                Some(&text_path),
                1000,
            )
            .expect("first upsert");
        let second_id = store
            .upsert_clipboard_entry(
                "text",
                "text_hash",
                5,
                Some("hello"),
                "local",
                Some(&text_path),
                2000,
            )
            .expect("second upsert");

        assert_eq!(first_id, second_id);

        let entries = store
            .query_history_compat(Some("text"), None, None, None, 20, 0)
            .expect("query history compat");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hash, "text_hash");
        assert_eq!(entries[0].entry_type, "text");
        assert_eq!(entries[0].source, "local");
        assert_eq!(entries[0].timestamp, 2000);

        let record = store
            .get_history_record_compat(first_id)
            .expect("get record")
            .expect("record exists");
        assert_eq!(
            record.local_storage_path.as_deref(),
            Some(text_path.to_string_lossy().as_ref())
        );
    }

    #[test]
    fn binding_duplicate_legacy_rows_to_same_object_is_skipped() {
        let root = unique_temp_dir("flow_store_legacy_bind");
        let store = FlowStoreManager::new(root).expect("flow store should initialize");

        let object = FlowObjectInsert {
            object_id: "object-1".to_string(),
            kind: "text".to_string(),
            root_hash: "hash-1".to_string(),
            size_bytes: 5,
            chunk_count: 1,
            checksum_algo: "blake3".to_string(),
            local_storage_path: None,
            manifest_json: None,
            availability: "metadata_only".to_string(),
            created_at: 1000,
            updated_at: 1000,
        };
        let entry = FlowEntryInsert {
            entry_id: "entry-1".to_string(),
            kind: "text".to_string(),
            title: None,
            preview: Some("hello".to_string()),
            size_bytes: 5,
            pinned: false,
            entry_source: "clipboard_text".to_string(),
            direction: "local".to_string(),
            source_device_name: None,
            source_device_id: None,
            object_id: object.object_id.clone(),
            has_local_content: false,
            transfer_status: "completed".to_string(),
            created_at: 1000,
            updated_at: 1000,
            legacy_history_id: Some(10),
        };

        assert!(
            store
                .insert_legacy_backfill(&object, &entry, 10)
                .expect("insert legacy backfill")
        );
        assert!(
            store
                .bind_legacy_history_to_existing_entry("text", "hash-1", 11, 2000)
                .expect("bind duplicate legacy row")
        );

        let conn = store.conn.lock().unwrap();
        let map_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM legacy_history_map", [], |row| row.get(0))
            .expect("count legacy bindings");
        let legacy_for_object: i64 = conn
            .query_row(
                "SELECT legacy_id FROM legacy_history_map WHERE object_id = ?1",
                params!["object-1"],
                |row| row.get(0),
            )
            .expect("lookup object binding");
        let entry_legacy_id: Option<i64> = conn
            .query_row(
                "SELECT legacy_history_id FROM flow_entries WHERE entry_id = ?1",
                params!["entry-1"],
                |row| row.get(0),
            )
            .expect("lookup flow entry legacy id");

        assert_eq!(map_count, 1);
        assert_eq!(legacy_for_object, 10);
        assert_eq!(entry_legacy_id, Some(10));
    }

    #[test]
    fn create_local_path_entry_supports_file_and_bundle() {
        let root = unique_temp_dir("flow_store_paths");
        std::fs::create_dir_all(&root).expect("create root");
        let store =
            FlowStoreManager::new(root.join("flowsync")).expect("flow store should initialize");

        let file_path = root.join("demo.txt");
        std::fs::write(&file_path, "phase4").expect("write file");
        let folder_path = root.join("bundle");
        std::fs::create_dir_all(folder_path.join("nested")).expect("create bundle dirs");
        std::fs::write(folder_path.join("nested").join("a.txt"), "abc").expect("write nested file");

        let file_id = store
            .create_local_path_entry(&file_path, "manual_pick", 1000)
            .expect("create file entry");
        let bundle_id = store
            .create_local_path_entry(&folder_path, "manual_pick", 2000)
            .expect("create bundle entry");

        let file_record = store
            .get_history_record_compat(file_id)
            .expect("get file record")
            .expect("file exists");
        assert_eq!(file_record.entry.entry_type, "file");
        assert_eq!(file_record.title.as_deref(), Some("demo.txt"));

        let bundle_record = store
            .get_history_record_compat(bundle_id)
            .expect("get bundle record")
            .expect("bundle exists");
        assert_eq!(bundle_record.entry.entry_type, "bundle");
        assert!(bundle_record.manifest_json.is_some());
        assert!(store.root_dir().join("manifests").exists());
    }

    #[test]
    fn transfer_session_updates_and_download_finalize_are_queryable() {
        let root = unique_temp_dir("flow_store_transfer");
        std::fs::create_dir_all(&root).expect("create root");
        let store =
            FlowStoreManager::new(root.join("flowsync")).expect("flow store should initialize");

        let source_dir = root.join("remote-entry");
        std::fs::create_dir_all(&source_dir).expect("create source dir");
        let source_file = source_dir.join("demo.bin");
        std::fs::write(&source_file, b"phase5").expect("write source file");

        let entry_id = store
            .create_local_path_entry(&source_file, "manual_pick", 1000)
            .expect("create local file entry");

        {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "UPDATE flow_entries
                 SET has_local_content = 0,
                     transfer_status = 'metadata_only',
                     source_device_name = 'Sim-PC-2',
                     source_device_id = '688'
                 WHERE id = ?1",
                params![entry_id],
            )
            .expect("mark entry as metadata-only");
            conn.execute(
                "UPDATE flow_objects
                 SET local_storage_path = NULL,
                     availability = 'remote_device'
                 WHERE object_id = (SELECT object_id FROM flow_entries WHERE id = ?1)",
                params![entry_id],
            )
            .expect("mark object as remote");
        }

        store
            .upsert_transfer_session(
                entry_id,
                "transfer-1",
                "inbound",
                "accepted",
                Some("Sim-PC-2"),
                Some("Sim-PC-1"),
                6,
                0,
                2000,
            )
            .expect("create transfer session");
        store
            .upsert_transfer_session(
                entry_id,
                "transfer-1",
                "inbound",
                "transferring",
                Some("Sim-PC-2"),
                Some("Sim-PC-1"),
                6,
                3,
                3000,
            )
            .expect("update transfer session");

        let state = store
            .get_entry_transfer_state(entry_id)
            .expect("query transfer state")
            .expect("transfer state should exist");
        assert!(!state.has_local_content);
        assert_eq!(state.transfer_status, "transferring");
        assert_eq!(state.source_device_id.as_deref(), Some("688"));
        assert_eq!(
            state
                .latest_transfer
                .as_ref()
                .map(|transfer| transfer.bytes_done),
            Some(3)
        );

        let downloaded_path = root.join("downloads").join("demo.bin");
        std::fs::create_dir_all(downloaded_path.parent().unwrap()).expect("create downloads dir");
        std::fs::write(&downloaded_path, b"phase5").expect("write downloaded file");
        store
            .finalize_downloaded_entry(entry_id, &downloaded_path, None, "transfer-1", 4000)
            .expect("finalize downloaded entry");

        let finalized = store
            .get_entry_transfer_state(entry_id)
            .expect("query finalized transfer state")
            .expect("finalized state should exist");
        assert!(finalized.has_local_content);
        assert_eq!(finalized.transfer_status, "completed");
        assert_eq!(
            finalized
                .latest_transfer
                .as_ref()
                .map(|transfer| transfer.status.as_str()),
            Some("completed")
        );

        let record = store
            .get_history_record_compat(entry_id)
            .expect("reload finalized record")
            .expect("record should exist");
        assert_eq!(
            record.local_storage_path.as_deref(),
            Some(downloaded_path.to_string_lossy().as_ref())
        );
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
