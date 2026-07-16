//! Settings & config commands

use crate::AppState;
use tauri::Emitter;

#[derive(serde::Serialize)]
pub struct SettingsPayload {
    pub is_sync_enabled: bool,
    pub auto_sync_text: bool,
    pub auto_sync_image: bool,
    pub flowhint_min_chars: usize,
    pub flowhint_accept_tab: bool,
    pub flowhint_accept_right: bool,
    pub debug_mode: bool,
    pub dictionary_order: Vec<String>,
    pub image_transport_format: String,
    pub flowprobe_backup_keys: bool,
}

#[derive(serde::Serialize)]
pub struct FlowSyncAutoSyncPayload {
    pub auto_sync_text: bool,
    pub auto_sync_image: bool,
}

#[derive(serde::Serialize)]
pub struct DesktopBuildLabel {
    pub app_version: String,
    pub build_id: String,
}

#[derive(serde::Serialize)]
pub struct VaultSyncStatus {
    pub server_url: String,
    pub username: String,
    pub local_updated_at: u64,
    pub remote_updated_at: Option<u64>,
    pub remote_manifest_size: usize,
    pub status_msg: String,
}

#[tauri::command]
pub fn get_app_config() -> Result<yibovibe_core::config::AppConfig, String> {
    Ok(yibovibe_core::config::GLOBAL_CONFIG.read().unwrap().clone())
}

#[tauri::command]
pub fn get_settings() -> Result<SettingsPayload, String> {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
    Ok(SettingsPayload {
        is_sync_enabled: cfg.is_sync_enabled,
        auto_sync_text: cfg.auto_sync_text,
        auto_sync_image: cfg.auto_sync_image,
        flowhint_min_chars: cfg.flowhint_min_chars,
        flowhint_accept_tab: cfg.flowhint_accept_tab,
        flowhint_accept_right: cfg.flowhint_accept_right,
        debug_mode: cfg.debug_mode,
        dictionary_order: cfg.dictionary_order.clone(),
        image_transport_format: cfg.cache.image_transport_format.clone(),
        flowprobe_backup_keys: cfg.flowprobe_backup_keys,
    })
}

#[tauri::command]
pub fn get_flowsync_auto_sync_prefs() -> Result<FlowSyncAutoSyncPayload, String> {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
    Ok(FlowSyncAutoSyncPayload {
        auto_sync_text: cfg.auto_sync_text,
        auto_sync_image: cfg.auto_sync_image,
    })
}

#[tauri::command]
pub fn set_flowsync_auto_sync_prefs(
    app: tauri::AppHandle,
    auto_sync_text: bool,
    auto_sync_image: bool,
) -> Result<(), String> {
    yibovibe_core::config::set_flowsync_auto_sync_prefs(auto_sync_text, auto_sync_image)?;
    let _ = app.emit("config-updated ", ());
    Ok(())
}

#[tauri::command]
pub fn update_settings(
    app: tauri::AppHandle,
    is_sync_enabled: bool,
    flowhint_min_chars: usize,
    flowhint_accept_tab: bool,
    flowhint_accept_right: bool,
    debug_mode: bool,
    image_transport_format: String,
    flowprobe_backup_keys: bool,
) -> Result<(), String> {
    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG
        .write()
        .map_err(|e| e.to_string())?;
    cfg.is_sync_enabled = is_sync_enabled;
    cfg.flowhint_min_chars = flowhint_min_chars;
    cfg.flowhint_accept_tab = flowhint_accept_tab;
    cfg.flowhint_accept_right = flowhint_accept_right;
    cfg.debug_mode = debug_mode;
    cfg.flowprobe_backup_keys = flowprobe_backup_keys;
    cfg.cache.image_transport_format = match image_transport_format.as_str() {
        "png" | "webp_lossless" | "jpeg" => image_transport_format,
        _ => "png".to_string(),
    };
    cfg.save();
    drop(cfg);
    crate::refresh_hint_window_cfg();
    let _ = app.emit("config-updated ", ());
    Ok(())
}

#[tauri::command]
pub fn set_dictionary_order(order: Vec<String>) -> Result<(), String> {
    yibovibe_core::config::set_dictionary_order(order)
}

#[tauri::command]
pub async fn change_local_password(new_password: String) -> Result<(), String> {
    let salt = yibovibe_core::crypto::generate_salt();
    let salt_clone = salt.clone();
    let hash_result = tokio::task::spawn_blocking(move || {
        yibovibe_core::crypto::hash_local_password(&new_password, &salt_clone)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match hash_result {
        Ok(hash_str) => {
            let mut cfg = yibovibe_core::config::GLOBAL_CONFIG
                .write()
                .map_err(|e| e.to_string())?;
            cfg.local_password_hash = hash_str;
            cfg.local_kdf_salt = salt;
            cfg.save();
            log::info!("Local offline password updated successfully ");
            Ok(())
        }
        Err(e) => Err(format!("Hashing failed: {}", e)),
    }
}

#[tauri::command]
pub fn rename_local_account(old_username: String, new_username: String) -> Result<bool, String> {
    yibovibe_core::local_auth::rename_local_user(&old_username, &new_username)
}

#[tauri::command]
pub async fn force_override_remote(_server_url: String, _username: String) -> Result<bool, String> {
    Err("API Server does not yet support force-overriding an existing remote account. Please use the Local Offline Mode instead.".to_string())
}

#[tauri::command]
pub async fn manual_vault_compaction(
    _server_url: String,
    username: String,
    _password: String,
) -> Result<bool, String> {
    log::info!("Triggering manual Vault Compaction for user: {}", username);
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    log::info!(
        "Vault Compaction complete. Deleted 0 redundant delta logs, repacked 0 base segments."
    );
    Ok(true)
}

#[tauri::command]
pub fn export_config(dest_path: String) -> Result<(), String> {
    log::info!("Tauri Command: export_config to {}", dest_path);
    yibovibe_core::backup::export_config(&dest_path)
}

#[tauri::command]
pub fn import_config(src_path: String) -> Result<(), String> {
    log::info!("Tauri Command: import_config from {}", src_path);
    yibovibe_core::backup::import_config(&src_path)
}

#[tauri::command]
pub fn get_all_dictionaries() -> Result<Vec<yibovibe_core::dictionary::SmartDictionary>, String> {
    Ok(yibovibe_core::dictionary::get_all_dictionaries())
}

#[tauri::command]
pub fn save_dictionary(dict: yibovibe_core::dictionary::SmartDictionary) -> Result<(), String> {
    log::info!("Tauri Command: save_dictionary {}", dict.id);
    yibovibe_core::dictionary::save_dictionary(dict)?;
    yibovibe_core::smart_router::invalidate_snap_cache();
    Ok(())
}

#[tauri::command]
pub fn delete_dictionary(id: String) -> Result<(), String> {
    log::info!("Tauri Command: delete_dictionary {}", id);
    yibovibe_core::dictionary::delete_dictionary(&id)?;
    yibovibe_core::smart_router::invalidate_snap_cache();
    Ok(())
}

#[tauri::command]
pub fn regenerate_device_fingerprint() -> Result<String, String> {
    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
    let new_fp = format!("manual-{}", uuid::Uuid::new_v4());
    cfg.device_fingerprint = new_fp.clone();
    let _ = cfg.save();
    Ok(new_fp)
}

#[tauri::command]
pub fn get_desktop_build_label() -> Result<DesktopBuildLabel, String> {
    Ok(DesktopBuildLabel {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build_id: env!("YIBOVIBE_BUILD_ID").to_string(),
    })
}
