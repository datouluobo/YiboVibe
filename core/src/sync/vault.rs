use serde::{Deserialize, Serialize};

/// The central Manifest tracking the state of all Vault segments
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultManifest {
    pub version: u32,
    pub last_synced_at: u64,   // Global unix timestamp of last sync
    pub base_checksum: String, // SHA256 of the foundational config and state
    pub files: std::collections::HashMap<String, FileTrackingMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTrackingMeta {
    pub checksum: String, // SHA256 of the unencrypted content
    pub size_bytes: u64,  // Size of the unencrypted content
    pub updated_at: u64,  // Modification timestamp
    pub is_delta: bool,   // true if this file is a delta slice instead of a full snapshot
}

/// A container for an individual segment to be encrypted/decrypted
pub struct EncryptableEnvelope {
    pub identifier: String, // e.g., "config", "dictionaries/cmd", "ai_habits/delta_1729.log"
    pub payload: Vec<u8>,   // The raw bytes to be encrypted
}

impl Default for VaultManifest {
    fn default() -> Self {
        Self {
            version: 1,
            last_synced_at: 0,
            base_checksum: String::new(),
            files: std::collections::HashMap::new(),
        }
    }
}
