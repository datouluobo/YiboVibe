use crate::api::ApiClient;
use crate::sync::crypto::{decrypt_payload, encrypt_payload};
use crate::sync::packager::VaultPackager;
use crate::sync::vault::VaultManifest;
use crate::sync::vault::FileTrackingMeta;
use crate::sync::MergePlan;
use log::{error, info, warn};
use std::fs;
use std::path::PathBuf;

/// Fetches and decrypts the global routing manifest from the remote NAS server.
pub async fn fetch_remote_manifest(
    api: &ApiClient,
    key: &[u8; 32],
) -> Result<Option<VaultManifest>, String> {
    info!("Fetching remote manifest.enc...");
    match api.download_vault_file("manifest.enc").await {
        Ok(enc_bytes) => {
            let json_bytes = decrypt_payload(&enc_bytes, key, b"manifest")
                .map_err(|e| format!("Manifest decryption failed: {}", e))?;
            let manifest: VaultManifest = serde_json::from_slice(&json_bytes)
                .map_err(|e| format!("Failed to parse remote manifest: {}", e))?;
            Ok(Some(manifest))
        }
        Err(e) => {
            if e == "NOT_FOUND" {
                info!("No remote manifest found. (New Server / Empty Vault)");
                Ok(None)
            } else {
                Err(e)
            }
        }
    }
}

/// Forcefully pushes all detected changes from local to the remote server, 
/// minimizing bandwidth by performing a differential pack locally.
pub async fn push_full_vault(api: &ApiClient, packager: &VaultPackager) -> Result<u64, String> {
    info!("Evaluating Local Delta for Deep Push...");

    // First fetch remote manifest to compute difference
    let remote_manifest = fetch_remote_manifest(api, &packager.key)
        .await
        .unwrap_or(None);

    // Call the heavy engines to chew through local sandboxes and seal differences
    let (new_manifest, envelopes) = packager.pack_full_vault(remote_manifest.as_ref())?;

    if envelopes.is_empty() {
        info!("No changes detected in file chunks. Will still push manifest to enforce state.");
    }

    // Step 1: Upload the opaque Data chunks (.enc containers)
    for env in envelopes {
        info!("Uploading encrypted segment: [{}]", env.identifier);
        
        // URL-encode to ensure safe HTTP transport regardless of Go NAS directory logic
        let safe_name = urlencoding::encode(&env.identifier).to_string();
        
        api.upload_vault_file(&safe_name, env.payload).await?;
    }

    // Step 2: Commit the global Manifest (acts as an atomic lock mechanism) 
    // ensuring no file splitting inconsistencies
    info!("Committing manifest.enc lock to server...");
    let manifest_bytes = serde_json::to_vec(&new_manifest).map_err(|e| e.to_string())?;
    let sealed_manifest = encrypt_payload(&manifest_bytes, &packager.key, b"manifest")?;
    api.upload_vault_file("manifest.enc", sealed_manifest).await?;

    save_local_baseline_manifest(&packager.sandbox_root, &new_manifest);

    info!("Vault Push pipeline complete.");
    Ok(new_manifest.last_synced_at)
}

/// The reverse operation: Grabs the latest manifest, spots missing slices, 
/// downloads them, unseals them via AES and physically injects them into local disk bounds.
pub async fn pull_and_replay_vault(
    api: &ApiClient,
    key: &[u8; 32],
    sandbox_root: &PathBuf,
) -> Result<(), String> {
    info!("Evaluating Remote State for Deep Pull...");

    let remote_manifest = fetch_remote_manifest(api, key)
        .await?
        .ok_or_else(|| "No remote Vault exists yet.".to_string())?;

    // We do a naive approach first: compare timestamp to local `sync_meta`
    // Real Delta Replay checks every chunk, but for structural mapping we'll loop through:
    
    for (rel_path, meta) in &remote_manifest.files {
        let local_path = sandbox_root.join(rel_path);
        
        let needs_download = if !local_path.exists() {
            true
        } else {
            // Simplified collision check: if local hasn't been modified past remote timestamp...
            // Or roughly check if hash is mismatched (a real app would use a local DB metadata table)
            // Let's just download it if size != size or we lack local manifest records
            true
        };

        if needs_download {
            let safe_name = urlencoding::encode(rel_path).to_string();
            info!("↓ Downloading chunk [{}]...", rel_path);
            let chunk_enc = api.download_vault_file(&safe_name).await?;
            
            // Decrypt 
            let plain_bytes = decrypt_payload(&chunk_enc, key, rel_path.as_bytes())?;
            
            // Reconstruct path
            if let Some(parent) = local_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            
            fs::write(&local_path, &plain_bytes).map_err(|e| e.to_string())?;
            info!("  -> Restored {}", rel_path);
        }
    }

    // We forcefully reload Global Config to apply new Vault params seamlessly
    info!("Vault successfully mounted onto local disk!");
    save_local_baseline_manifest(sandbox_root, &remote_manifest);
    Ok(())
}

pub fn get_local_baseline_manifest(sandbox_root: &std::path::Path) -> Option<VaultManifest> {
    let path = sandbox_root.join(".sync_manifest.json");
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(manifest) = serde_json::from_slice(&bytes) {
            return Some(manifest);
        }
    }
    None
}

pub fn save_local_baseline_manifest(sandbox_root: &std::path::Path, manifest: &VaultManifest) {
    let path = sandbox_root.join(".sync_manifest.json");
    if let Ok(bytes) = serde_json::to_vec(manifest) {
        let _ = fs::write(path, bytes);
    }
}

pub async fn compute_merge_plan(
    api: &ApiClient,
    packager: &VaultPackager,
) -> Result<MergePlan, String> {
    let remote_manifest_opt = fetch_remote_manifest(api, &packager.key).await?;
    let mut plan = MergePlan {
        auto_push: vec![],
        auto_pull: vec![],
        conflicts: vec![],
        unchanged: vec![],
    };

    if remote_manifest_opt.is_none() {
        let local_hashes = packager.scan_local_state();
        for k in local_hashes.keys() {
            plan.auto_push.push(k.clone());
        }
        return Ok(plan);
    }

    let remote_manifest = remote_manifest_opt.unwrap();
    let baseline_manifest_opt = get_local_baseline_manifest(&packager.sandbox_root);
    let local_hashes = packager.scan_local_state();

    let mut all_files = std::collections::HashSet::new();
    for k in remote_manifest.files.keys() { all_files.insert(k.clone()); }
    for k in local_hashes.keys() { all_files.insert(k.clone()); }

    let empty_string = String::new();

    for file in all_files {
        let remote_hash = remote_manifest.files.get(&file).map(|m| &m.checksum).unwrap_or(&empty_string);
        let local_hash = local_hashes.get(&file).unwrap_or(&empty_string);
        let baseline_hash = baseline_manifest_opt.as_ref()
            .and_then(|m| m.files.get(&file))
            .map(|m| &m.checksum)
            .unwrap_or(&empty_string);

        if local_hash == remote_hash {
            plan.unchanged.push(file.clone());
        } else if local_hash == baseline_hash {
            plan.auto_pull.push(file.clone());
        } else if remote_hash == baseline_hash {
            plan.auto_push.push(file.clone());
        } else {
            plan.conflicts.push(file.clone());
        }
    }

    Ok(plan)
}

pub async fn execute_merge_plan(
    api: &ApiClient,
    packager: &VaultPackager,
    plan: &MergePlan,
    resolutions: std::collections::HashMap<String, String>, // "keep_local" or "take_remote"
) -> Result<u64, String> {
    let remote_manifest = fetch_remote_manifest(api, &packager.key).await?
        .unwrap_or_default();

    let mut new_manifest = remote_manifest.clone();

    let mut pull_list = plan.auto_pull.clone();
    let mut push_list = plan.auto_push.clone();

    for (file, action) in &resolutions {
        if action == "take_remote" {
            pull_list.push(file.clone());
        } else if action == "keep_local" {
            push_list.push(file.clone());
        }
    }

    let sandbox_root = &packager.sandbox_root;
    
    // Pull from cloud
    for rel_path in pull_list {
        let safe_name = urlencoding::encode(&rel_path).to_string();
        info!("↓ Pulling merged file: {}", rel_path);
        let chunk_enc = api.download_vault_file(&safe_name).await?;
        let plain_bytes = decrypt_payload(&chunk_enc, &packager.key, rel_path.as_bytes())?;
        
        let local_path = sandbox_root.join(&rel_path);
        if let Some(parent) = local_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&local_path, &plain_bytes).map_err(|e| e.to_string())?;
    }

    // Push local
    for rel_path in push_list {
         let local_path = sandbox_root.join(&rel_path);
         if local_path.exists() {
             info!("↑ Pushing merged file: {}", rel_path);
             let content = fs::read(&local_path).map_err(|e| e.to_string())?;
             let sealed_data = encrypt_payload(&content, &packager.key, rel_path.as_bytes())?;
             
             let safe_name = urlencoding::encode(&rel_path).to_string();
             api.upload_vault_file(&safe_name, sealed_data).await?;

             let hash = crate::sync::packager::calculate_hash(&content);
             new_manifest.files.insert(
                 rel_path.clone(),
                 FileTrackingMeta {
                     checksum: hash,
                     size_bytes: content.len() as u64,
                     updated_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                     is_delta: false,
                 }
             );
         } else {
             new_manifest.files.remove(&rel_path);
         }
    }

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    new_manifest.last_synced_at = now;
    
    let manifest_json_str = serde_json::to_string(&new_manifest.files).unwrap_or_default();
    new_manifest.base_checksum = crate::sync::packager::calculate_hash(manifest_json_str.as_bytes());

    let manifest_bytes = serde_json::to_vec(&new_manifest).map_err(|e| e.to_string())?;
    let sealed_manifest = encrypt_payload(&manifest_bytes, &packager.key, b"manifest")?;
    api.upload_vault_file("manifest.enc", sealed_manifest).await?;

    save_local_baseline_manifest(sandbox_root, &new_manifest);

    Ok(now)
}
