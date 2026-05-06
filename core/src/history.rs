use log::info;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: i64,
    pub timestamp: i64,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub hash: String,
    pub size: i64,
    pub preview: Option<String>,
    pub pinned: bool,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_entries: i64,
    pub text_count: i64,
    pub image_count: i64,
    pub total_size_bytes: i64,
    pub total_size_mb: f64,
    pub cache_dir: String,
    pub max_size_mb: u64,
}

pub struct HistoryManager {
    conn: Mutex<Connection>,
}

impl HistoryManager {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create db parent dir: {}", e))?;
        }
        let conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open history db: {}", e))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        Self::init_tables(&conn)?;
        info!("HistoryManager initialized at {:?}", db_path);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn init_tables(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp   INTEGER NOT NULL,
                type        TEXT NOT NULL CHECK(type IN ('text', 'image')),
                hash        TEXT NOT NULL UNIQUE,
                size        INTEGER NOT NULL,
                preview     TEXT,
                pinned      INTEGER DEFAULT 0,
                source      TEXT DEFAULT 'local',
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_history_time ON history(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_history_type ON history(type, timestamp DESC);
            ",
        )
        .map_err(|e| format!("Failed to create tables: {}", e))?;

        let fts_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='history_fts'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);

        if !fts_exists {
            conn.execute_batch(
                "CREATE VIRTUAL TABLE history_fts USING fts5(
                    content,
                    content='history',
                    content_rowid='id'
                );

                CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
                    INSERT INTO history_fts(rowid, content) VALUES (new.id, COALESCE(new.preview, ''));
                END;

                CREATE TRIGGER IF NOT EXISTS history_ad AFTER DELETE ON history BEGIN
                    INSERT INTO history_fts(history_fts, rowid, content) VALUES('delete', old.id, COALESCE(old.preview, ''));
                END;

                CREATE TRIGGER IF NOT EXISTS history_au AFTER UPDATE ON history BEGIN
                    INSERT INTO history_fts(history_fts, rowid, content) VALUES('delete', old.id, COALESCE(old.preview, ''));
                    INSERT INTO history_fts(rowid, content) VALUES (new.id, COALESCE(new.preview, ''));
                END;
                "
            ).map_err(|e| format!("Failed to create FTS: {}", e))?;
        }

        Ok(())
    }

    pub fn insert(
        &self,
        timestamp: i64,
        entry_type: &str,
        hash: &str,
        size: i64,
        preview: Option<&str>,
        source: &str,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO history (timestamp, type, hash, size, preview, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![timestamp, entry_type, hash, size, preview, source],
        )
        .map_err(|e| format!("Insert failed: {}", e))?;

        Ok(conn.last_insert_rowid())
    }

    pub fn exists_by_hash(&self, hash: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM history WHERE hash = ?1",
                params![hash],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        exists.is_some()
    }

    pub fn touch_by_hash(&self, hash: &str, new_timestamp: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET timestamp = ?1 WHERE hash = ?2 AND timestamp < ?1",
            params![new_timestamp, hash],
        )
        .map_err(|e| format!("Touch failed: {}", e))?;
        Ok(())
    }

    pub fn update_source_by_hash(&self, hash: &str, source: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET source = ?1 WHERE hash = ?2",
            params![source, hash],
        )
        .map_err(|e| format!("Update source failed: {}", e))?;
        Ok(())
    }

    pub fn touch_by_id(&self, id: i64, new_timestamp: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET timestamp = ?1 WHERE id = ?2 AND timestamp < ?1",
            params![new_timestamp, id],
        )
        .map_err(|e| format!("Touch failed: {}", e))?;
        Ok(())
    }

    pub fn get_by_id(&self, id: i64) -> Result<Option<HistoryEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let result: Option<HistoryEntry> = match conn.query_row(
            "SELECT id, timestamp, type, hash, size, preview, pinned, source
                 FROM history WHERE id = ?1",
            params![id],
            |row| self::row_to_entry(row),
        ) {
            Ok(entry) => Some(entry),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(format!("Query failed: {}", e)),
        };
        Ok(result)
    }

    pub fn query(
        &self,
        type_filter: Option<&str>,
        time_from: Option<i64>,
        time_to: Option<i64>,
        source_filter: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<HistoryEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT id, timestamp, type, hash, size, preview, pinned, source FROM history WHERE 1=1",
        );
        if type_filter.is_some() {
            sql.push_str(" AND type = ?");
        }
        if time_from.is_some() {
            sql.push_str(" AND timestamp >= ?");
        }
        if time_to.is_some() {
            sql.push_str(" AND timestamp < ?");
        }
        if source_filter.is_some() {
            sql.push_str(" AND source = ?");
        }
        sql.push_str(" ORDER BY timestamp DESC LIMIT ? OFFSET ?");

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(t) = type_filter {
            param_values.push(Box::new(t.to_string()));
        }
        if let Some(t) = time_from {
            param_values.push(Box::new(t));
        }
        if let Some(t) = time_to {
            param_values.push(Box::new(t));
        }
        if let Some(s) = source_filter {
            param_values.push(Box::new(s.to_string()));
        }
        param_values.push(Box::new(limit));
        param_values.push(Box::new(offset));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let entries = stmt
            .query_map(param_refs.as_slice(), |row| self::row_to_entry(row))
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<HistoryEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let fts_query = query.replace('"', "\"\"");
        let sql = format!(
            "SELECT h.id, h.timestamp, h.type, h.hash, h.size, h.preview, h.pinned, h.source
             FROM history_fts f
             JOIN history h ON h.id = f.rowid
             WHERE history_fts MATCH '\"{}\"'
             ORDER BY h.timestamp DESC
             LIMIT {}",
            fts_query, limit
        );

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Search prepare failed: {}", e))?;
        let entries = stmt
            .query_map([], |row| self::row_to_entry(row))
            .map_err(|e| format!("Search failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    pub fn delete_by_ids(&self, ids: &[i64]) -> Result<u32, String> {
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            "DELETE FROM history WHERE id IN ({})",
            placeholders.join(",")
        );
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
            .iter()
            .map(|&id| Box::new(id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let count = conn
            .execute(&sql, param_refs.as_slice())
            .map_err(|e| format!("Delete failed: {}", e))?;
        Ok(count as u32)
    }

    pub fn clear_before(&self, before_timestamp: i64) -> Result<u32, String> {
        let conn = self.conn.lock().unwrap();
        let count = conn
            .execute(
                "DELETE FROM history WHERE timestamp < ?1 AND pinned = 0",
                params![before_timestamp],
            )
            .map_err(|e| format!("Clear failed: {}", e))?;
        Ok(count as u32)
    }

    pub fn clear_all(&self) -> Result<u32, String> {
        let conn = self.conn.lock().unwrap();
        let count = conn
            .execute("DELETE FROM history WHERE pinned = 0", [])
            .map_err(|e| format!("Clear all failed: {}", e))?;
        Ok(count as u32)
    }

    pub fn toggle_pin(&self, id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let pinned: bool = conn
            .query_row(
                "SELECT pinned FROM history WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .map(|v| v != 0)
            .map_err(|e| format!("Failed to get pin state: {}", e))?;

        let new_val = if pinned { 0 } else { 1 };
        conn.execute(
            "UPDATE history SET pinned = ?1 WHERE id = ?2",
            params![new_val, id],
        )
        .map_err(|e| format!("Failed to toggle pin: {}", e))?;

        Ok(!pinned)
    }

    pub fn get_stats(&self) -> Result<(i64, i64, i64), String> {
        let conn = self.conn.lock().unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
            .unwrap_or(0);
        let text_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM history WHERE type='text'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let image_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM history WHERE type='image'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok((total, text_count, image_count))
    }

    pub fn get_total_size(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COALESCE(SUM(size), 0) FROM history", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0)
    }

    pub fn get_lru_unpinned(&self, excess_bytes: u64) -> Vec<(i64, String, String)> {
        let conn = self.conn.lock().unwrap();
        let mut results = Vec::new();
        let mut accumulated: u64 = 0;

        let mut stmt = conn
            .prepare(
                "SELECT id, type, hash, size FROM history WHERE pinned = 0 ORDER BY timestamp ASC",
            )
            .unwrap();

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? as u64,
                ))
            })
            .unwrap();

        for row in rows.flatten() {
            if accumulated >= excess_bytes {
                break;
            }
            accumulated += row.3;
            results.push((row.0, row.1, row.2));
        }
        results
    }

    pub fn get_recent_entries(&self, limit: u32) -> Result<Vec<HistoryEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, timestamp, type, hash, size, preview, pinned, source
                   FROM history ORDER BY timestamp DESC LIMIT ?1",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let entries = stmt
            .query_map(params![limit], |row| self::row_to_entry(row))
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    pub fn db_path_exists(db_path: &std::path::Path) -> bool {
        db_path.exists()
    }
}

fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        entry_type: row.get(2)?,
        hash: row.get(3)?,
        size: row.get(4)?,
        preview: row.get(5)?,
        pinned: row.get::<_, i64>(6)? != 0,
        source: row.get(7)?,
    })
}
