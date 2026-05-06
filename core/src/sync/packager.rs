use crate::sync::crypto::encrypt_payload;
use crate::sync::vault::{EncryptableEnvelope, FileTrackingMeta, VaultManifest};
use hex;
use log::info;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Calculates the SHA256 hex string of a byte slice
pub fn calculate_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// The core packager engine that surveys the local sandbox and produces a batch of encrypted
/// .enc envelopes alongside a newly updated VaultManifest
pub struct VaultPackager {
    pub key: [u8; 32],
    pub sandbox_root: PathBuf,
}

impl VaultPackager {
    pub fn new(key: [u8; 32], sandbox_root: impl AsRef<Path>) -> Self {
        Self {
            key,
            sandbox_root: sandbox_root.as_ref().to_path_buf(),
        }
    }

    pub fn scan_local_state(&self) -> HashMap<String, String> {
        let mut hashes = HashMap::new();
        let targets = vec![
            "config.json",
            "dictionaries",
            "rules.json",
            "user_habits.json",
        ];
        for target in targets {
            let full_path = self.sandbox_root.join(target);
            if !full_path.exists() {
                continue;
            }
            if full_path.is_file() {
                if let Ok(content) = fs::read(&full_path) {
                    hashes.insert(target.to_string(), calculate_hash(&content));
                }
            } else if full_path.is_dir()
                && let Ok(entries) = fs::read_dir(&full_path)
            {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file()
                        && let Some(file_name) = path.file_name().and_then(|n| n.to_str())
                    {
                        let relative_id = format!("{}/{}", target, file_name);
                        if let Ok(content) = fs::read(&path) {
                            hashes.insert(relative_id, calculate_hash(&content));
                        }
                    }
                }
            }
        }
        hashes
    }

    /// Recursively scans a selected subset of the local sandbox and produces encrypted chunks
    /// for any file that has changed compared to the `old_manifest`.
    /// If `old_manifest` is None, it treats all files as new and packs everything.
    pub fn pack_full_vault(
        &self,
        old_manifest: Option<&VaultManifest>,
    ) -> Result<(VaultManifest, Vec<EncryptableEnvelope>), String> {
        let mut new_manifest = old_manifest.cloned().unwrap_or_default();
        let mut out_envelopes = Vec::new();

        // Define which relative files/dirs we track inside the user's sandbox
        let targets = vec![
            "config.json",
            "dictionaries",
            "rules.json",
            "user_habits.json",
        ];

        for target in targets {
            let full_path = self.sandbox_root.join(target);
            if !full_path.exists() {
                continue;
            }

            if full_path.is_file() {
                self.process_file(&full_path, target, &mut new_manifest, &mut out_envelopes)?;
            } else if full_path.is_dir() {
                // simple 1-level directory walk for dictionaries
                if let Ok(entries) = fs::read_dir(&full_path) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file()
                            && let Some(file_name) = path.file_name().and_then(|n| n.to_str())
                        {
                            let relative_id = format!("{}/{}", target, file_name);
                            self.process_file(
                                &path,
                                &relative_id,
                                &mut new_manifest,
                                &mut out_envelopes,
                            )?;
                        }
                    }
                }
            }
        }

        // Bump global sync timestamp
        new_manifest.last_synced_at = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Optional: Hash the manifest's tracking metadata itself as a Base checksum
        let manifest_json = serde_json::to_string(&new_manifest.files).unwrap_or_default();
        new_manifest.base_checksum = calculate_hash(manifest_json.as_bytes());

        // The manifest itself must also be encrypted, handled by the caller/API layer
        Ok((new_manifest, out_envelopes))
    }

    /// Reads a file, calculates its hash, compares with old manifest to avoid redundant encryption.
    /// If changed, seals it and appends to `out_envelopes`.
    fn process_file(
        &self,
        filepath: &Path,
        relative_id: &str,
        manifest: &mut VaultManifest,
        out_envelopes: &mut Vec<EncryptableEnvelope>,
    ) -> Result<(), String> {
        let content =
            fs::read(filepath).map_err(|e| format!("Failed to read {}: {}", relative_id, e))?;
        let hash = calculate_hash(&content);

        // Check if file has changed
        if let Some(meta) = manifest.files.get(relative_id)
            && meta.checksum == hash
            && !meta.is_delta
        {
            // File unchanged, skip encryption step to save CPU/Bandwidth
            return Ok(());
        }

        info!(
            "Segment {} was modified. Encrypting for Vault...",
            relative_id
        );

        let sealed_data = encrypt_payload(&content, &self.key, relative_id.as_bytes())?;

        // Update tracking manifest
        manifest.files.insert(
            relative_id.to_string(),
            FileTrackingMeta {
                checksum: hash,
                size_bytes: content.len() as u64,
                updated_at: SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                is_delta: false,
            },
        );

        out_envelopes.push(EncryptableEnvelope {
            identifier: relative_id.to_string(),
            payload: sealed_data,
        });

        Ok(())
    }

    /// For Log-Structured Delta Sync: Generate just a tiny Delta cut without touching the main payload
    pub fn pack_delta_slice(
        &self,
        domain_identifier: &str, // e.g. "ai_habits"
        delta_json: &[u8],
        manifest: &mut VaultManifest,
    ) -> Result<EncryptableEnvelope, String> {
        let ts = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let relative_id = format!("{}/delta_{}.enc", domain_identifier, ts);

        let sealed_data = encrypt_payload(delta_json, &self.key, relative_id.as_bytes())?;

        manifest.files.insert(
            relative_id.clone(),
            FileTrackingMeta {
                checksum: calculate_hash(delta_json),
                size_bytes: delta_json.len() as u64,
                updated_at: ts,
                is_delta: true,
            },
        );

        Ok(EncryptableEnvelope {
            identifier: relative_id,
            payload: sealed_data,
        })
    }
}
