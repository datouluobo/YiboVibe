pub mod vault;
pub mod crypto;
pub mod packager;
pub mod transport;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncMeta {
    pub device_uuid: String,
    pub global_updated_at: u64,
}

impl Default for SyncMeta {
    fn default() -> Self {
        Self {
            device_uuid: uuid::Uuid::new_v4().to_string(),
            global_updated_at: 0,
        }
    }
}

pub enum SyncConflictState {
    RemoteIsNewer,
    LocalIsNewer,
    InSync,
    Conflict, // Diverged
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MergePlan {
    pub auto_push: Vec<String>,
    pub auto_pull: Vec<String>,
    pub conflicts: Vec<String>,
    pub unchanged: Vec<String>,
}

pub async fn check_remote_conflicts(
    api: &crate::api::ApiClient,
    key: &[u8; 32],
    local_updated_at: u64,
) -> Result<SyncConflictState, String> {
    // Phase 3: Actual remote API fetch
    let remote_manifest = crate::sync::transport::fetch_remote_manifest(api, key).await?;

    if let Some(manifest) = remote_manifest {
        let remote_updated_at = manifest.last_synced_at;

        if local_updated_at == 0 && remote_updated_at > 0 {
            return Ok(SyncConflictState::RemoteIsNewer); // We are an empty new client
        }

        if remote_updated_at > local_updated_at {
            // Further inspection could detect diverged branches based on Delta chunks, 
            // but simplified here for generic timestamp diffing.
            return Ok(SyncConflictState::RemoteIsNewer);
        } else if remote_updated_at < local_updated_at {
            return Ok(SyncConflictState::LocalIsNewer);
        }

        Ok(SyncConflictState::InSync)
    } else {
        // Vault hasn't been created on the server yet.
        if local_updated_at > 0 {
            Ok(SyncConflictState::LocalIsNewer)
        } else {
            Ok(SyncConflictState::InSync)
        }
    }
}
