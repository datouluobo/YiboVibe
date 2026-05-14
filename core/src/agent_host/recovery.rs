use std::path::Path;
use serde::{Deserialize, Serialize};

use super::session::SessionSnapshot;

/// Persisted host state snapshot for crash recovery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostSnapshot {
    pub version: u32,
    pub sessions: Vec<SessionSnapshot>,
    pub saved_at: u64,
}

const SNAPSHOT_VERSION: u32 = 1;
const RECOVERY_FILE: &str = "host_recovery.json";

/// Try to recover host state from a previous run
pub async fn try_recover(recovery_dir: &Path) -> Option<Vec<SessionSnapshot>> {
    let path = recovery_dir.join(RECOVERY_FILE);
    if !path.exists() {
        return None;
    }

    match tokio::fs::read_to_string(&path).await {
        Ok(content) => {
            match serde_json::from_str::<HostSnapshot>(&content) {
                Ok(snapshot) => {
                    if snapshot.version == SNAPSHOT_VERSION {
                        Some(snapshot.sessions)
                    } else {
                        // Version mismatch, discard
                        let _ = std::fs::remove_file(&path);
                        None
                    }
                }
                Err(_) => {
                    // Corrupted, discard
                    let _ = std::fs::remove_file(&path);
                    None
                }
            }
        }
        Err(_) => None,
    }
}

/// Save session snapshots for crash recovery
pub async fn save_snapshots(recovery_dir: &Path, sessions: &[SessionSnapshot]) {
    if !recovery_dir.exists() {
        let _ = std::fs::create_dir_all(recovery_dir);
    }

    let snapshot = HostSnapshot {
        version: SNAPSHOT_VERSION,
        sessions: sessions.to_vec(),
        saved_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };

    let path = recovery_dir.join(RECOVERY_FILE);
    if let Ok(content) = serde_json::to_string_pretty(&snapshot) {
        let _ = tokio::fs::write(&path, content).await;
    }
}

/// Clear recovery state (called after successful recovery)
pub async fn clear_recovery(recovery_dir: &Path) {
    let path = recovery_dir.join(RECOVERY_FILE);
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
}
