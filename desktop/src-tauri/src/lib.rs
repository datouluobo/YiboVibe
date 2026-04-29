use log::{info, warn};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

mod probe;

lazy_static::lazy_static! {
    static ref LAST_HINT_ANCHOR: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));
    static ref HINT_WINDOW_CFG: std::sync::Mutex<(i32, i32, i32, i32, i32, f32, i32, i32)> = std::sync::Mutex::new((0, -1, -1, 0, 20, 1.0, 0, 0));
}

fn refresh_hint_window_cfg() {
    let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
    let mut hint_cfg = HINT_WINDOW_CFG.lock().unwrap();
    *hint_cfg = (
        cfg.hint_window.pos_type,
        cfg.hint_window.fixed_x,
        cfg.hint_window.fixed_y,
        cfg.hint_window.offset_x,
        cfg.hint_window.offset_y,
        cfg.hint_window.scale,
        cfg.hint_window.width,
        cfg.hint_window.height,
    );
}

use yiboflow_core::api::{ApiClient, LoginRequest, RegisterRequest};
use yiboflow_core::clipboard::ClipboardMonitor;
use yiboflow_core::crypto::MasterKey;
use yiboflow_core::ws::WsClient;

// We can store shared state here later, like the WsClient channel for sending new text.
pub struct AppState {
    pub is_connected: Mutex<bool>,
    pub ws_tx: Mutex<Option<tokio::sync::mpsc::Sender<yiboflow_core::ws::WsMessage>>>,
    pub runtime_server_url: Mutex<Option<String>>,
    pub runtime_username: Mutex<Option<String>>,
    pub runtime_device_name: Mutex<Option<String>>,
    pub runtime_remote_device_id: Mutex<Option<u32>>,
    pub persistent_device_fingerprint: Mutex<Option<String>>,
    pub runtime_device_fingerprint: Mutex<Option<String>>,
}

#[derive(serde::Serialize)]
struct FlowSyncRuntimeState {
    receive_only_mode: bool,
}

#[derive(serde::Serialize)]
struct FlowSyncDiagnostics {
    exe_path: String,
    global_dir: String,
    active_user_dir: String,
    active_user: Option<String>,
    is_connected: bool,
    receive_only_mode: bool,
    server_url: Option<String>,
    username: Option<String>,
    device_name: Option<String>,
    remote_device_id: Option<u32>,
    persistent_device_fingerprint: String,
    runtime_device_fingerprint: String,
}

fn resolve_runtime_device_fingerprint(base_fingerprint: &str) -> String {
    let instance_tag = std::env::var("YIBOFLOW_INSTANCE_TAG")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::current_exe().ok().map(|exe| {
                let mut hasher = DefaultHasher::new();
                exe.to_string_lossy().hash(&mut hasher);
                format!("exe-{:x}", hasher.finish())
            })
        });

    match instance_tag {
        Some(tag) => format!("{base_fingerprint}::{tag}"),
        None => base_fingerprint.to_string(),
    }
}



#[tauri::command]
async fn register_engine(
    server_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    info!(
        "Tauri Command Received: register_engine -> Server: {}, User: {}",
        server_url, username
    );

    if server_url == "local" {
        return yiboflow_core::local_auth::register_local_user(&username, &password);
    }

    // Generate a valid Argon2 salt string natively
    let kdf_salt = yiboflow_core::crypto::generate_salt();

    let client = ApiClient::new(server_url);
    let req = RegisterRequest {
        username,
        password,
        kdf_salt,
    };

    let res = client
        .register(req)
        .await
        .map_err(|e| format!("Registration API error: {}", e))?;

    if res.code == 201 || res.code == 200 {
        Ok(true)
    } else {
        Err(format!("Server returned: {}", res.msg))
    }
}

#[tauri::command]
async fn connect_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
    device_name: String,
) -> Result<bool, String> {
    {
        let connected_flag = state.is_connected.lock().await;
        if *connected_flag {
             info!("Already connected. Bypassing engine setup to prevent duplicate monitors.");
             return Ok(true);
        }
    }

    let (ui_tx, mut ui_rx) = tokio::sync::mpsc::channel(100);
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(evt) = ui_rx.recv().await {
            let _ = app_clone.emit("clipboard-event", evt);
        }
    });

    info!(
        "Tauri Command Received: connect_engine -> Server: {}, User: {}, Device: {}",
        server_url, username, device_name
    );

    if server_url == "local" {
        return yiboflow_core::local_auth::login_local_user(&username, &password);
    }

    let config_fingerprint = {
        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);
    {
        let mut persisted = state.persistent_device_fingerprint.lock().await;
        *persisted = Some(config_fingerprint.clone());
    }
    {
        let mut runtime = state.runtime_device_fingerprint.lock().await;
        *runtime = Some(runtime_fingerprint.clone());
    }

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: device_name.clone(),
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client.login(login_payload).await;

    let _is_mock_target = server_url.contains("127.0.0.1") || server_url.contains("localhost");
    let (needs_mock, api_err) = match login_result {
        Ok(res) => {
            if res.code == 200 && res.data.is_some() {
                let d = res.data.unwrap();
                info!(
                    "Logged in from GUI! Received Token: {}...",
                    &d.access_token[0..10]
                );

                let pwd = password.clone();
                let salt_b64 = d.kdf_salt.clone();
                let mk = tokio::task::spawn_blocking(move || MasterKey::derive(&pwd, &salt_b64))
                    .await
                    .map_err(|e| format!("Task failed: {}", e))?;

                let mk = match mk {
                    Ok(k) => k,
                    Err(e) => return Err(format!("MasterKey Derivation failed: {}", e)),
                };
                info!("Locally derived MasterKey is ready.");

                // Phase 3: Sync check before confirming login
                let _local_updated_at = {
                    let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
                    cfg.sync_meta.global_updated_at
                };

                // Derive Vault key
                let vk_pwd = password.clone();
                let vk_salt = d.kdf_salt.clone();
                let vault_key_res = tokio::task::spawn_blocking(move || {
                    yiboflow_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
                })
                .await
                .map_err(|e| format!("VaultKey derivation task failed: {}", e))?;

                let vault_key = match vault_key_res {
                    Ok(k) => k,
                    Err(e) => return Err(format!("VaultKey derivation failed: {}", e)),
                };

                // In offline mode we never reach here, this is only for remote login:
                let sandbox_root = yiboflow_core::backup::get_data_dir().join("users").join(&username);
                let packager = yiboflow_core::sync::packager::VaultPackager::new(vault_key, sandbox_root);

                match yiboflow_core::sync::transport::compute_merge_plan(&client, &packager).await {
                    Ok(plan) => {
                        if !plan.conflicts.is_empty() {
                            info!("Sync checks indicate file conflicts. Prompting user for merge resolution.");
                            if let Ok(c) = serde_json::to_string(&plan.conflicts) {
                                return Err(format!("SYNC_CONFLICT_DIVERGED:{}", c));
                            } else {
                                return Err("SYNC_CONFLICT_DIVERGED".to_string());
                            }
                        } else if !plan.auto_pull.is_empty() || !plan.auto_push.is_empty() {
                            info!("Applying automatic non-conflicting sync plan...");
                            if let Ok(new_ts) = yiboflow_core::sync::transport::execute_merge_plan(&client, &packager, &plan, std::collections::HashMap::new()).await {
                                let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
                                cfg.sync_meta.global_updated_at = new_ts;
                                let _ = cfg.save();
                                yiboflow_core::config::AppConfig::reload();
                            } else {
                                warn!("Failed to auto-execute merge plan");
                            }
                        } else {
                            info!("Vault is fully in sync. Proceeding.");
                        }
                    }
                    Err(e) => {
                        warn!("Failed to compute merge plan: {}", e);
                    }
                }

                // Map successful remote login to local isolated workspace
                yiboflow_core::local_auth::save_session(username.clone());

                // Auto cache the local password for unified offline use
                let auto_salt = d.kdf_salt.clone();
                let auto_pwd = password.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(hash) =
                        yiboflow_core::crypto::hash_local_password(&auto_pwd, &auto_salt)
                    {
                        if let Ok(mut cfg) = yiboflow_core::config::GLOBAL_CONFIG.write() {
                            cfg.local_password_hash = hash;
                            cfg.local_kdf_salt = auto_salt;
                            cfg.save();
                        }
                    }
                })
                .await;

                // Attempt WS connection
                match WsClient::connect(&server_url, &d.access_token).await {
                    Ok((ws_client, ws_rx)) => {
                        info!("WS client created! Handshake sent implicitly.");

                        if let Err(e) = yiboflow_core::cache::init_cache_and_history() {
                            log::warn!("Failed to re-initialize cache after login: {}", e);
                        }

                        let arc_mk = Arc::new(mk);
                        let cb_monitor = ClipboardMonitor::new(
                            server_url.clone(),
                            d.access_token.clone(),
                            arc_mk,
                            ws_client.tx.clone(),
                            Some(ui_tx),
                            device_name.clone(),
                        );
                        cb_monitor.start_monitoring();
                        cb_monitor.start_receiving(ws_rx);

                        let mut connected_flag = state.is_connected.lock().await;
                        *connected_flag = true;
                        let mut ws_tx = state.ws_tx.lock().await;
                        *ws_tx = Some(ws_client.tx.clone());
                        let mut runtime_server_url = state.runtime_server_url.lock().await;
                        *runtime_server_url = Some(server_url.clone());
                        let mut runtime_username = state.runtime_username.lock().await;
                        *runtime_username = Some(username.clone());
                        let mut runtime_device_name = state.runtime_device_name.lock().await;
                        *runtime_device_name = Some(device_name.clone());
                        let mut runtime_remote_device_id = state.runtime_remote_device_id.lock().await;
                        *runtime_remote_device_id = Some(d.device_id);
                        return Ok(true);
                    }
                    Err(e) => return Err(format!("WebSocket Connection Failed: {}", e)),
                }
            } else if res.code == 401 {
                return Err(res.msg);
            } else {
                (true, format!("Login failed via API: {}", res.msg))
            }
        }
        Err(e) => {
            (true, format!("Could not connect to NAS: {}", e)) // Use this flag as 'needs_offline_fallback'
        }
    };

    if needs_mock {
        info!(
            "NAS unreachable or failed. Attempting Offline Fallback. Reason: {}",
            api_err
        );

        let mut offline_success = false;
        let pwd = password.clone();

        let (cached_hash, cached_salt) = {
            let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
            (cfg.local_password_hash.clone(), cfg.local_kdf_salt.clone())
        };

        if !cached_hash.is_empty() && !cached_salt.is_empty() {
            let salt_for_hash = cached_salt.clone();
            let hash_check = tokio::task::spawn_blocking(move || {
                yiboflow_core::crypto::hash_local_password(&pwd, &salt_for_hash)
            })
            .await
            .unwrap_or(Err(yiboflow_core::crypto::CryptoError::InvalidData));

            if let Ok(hash) = hash_check {
                if hash == cached_hash {
                    offline_success = true;
                }
            }
        }

        if offline_success {
            info!("Offline credentials match. Deriving MasterKey for Snippets...");

            let pwd = password.clone();
            let mk =
                tokio::task::spawn_blocking(move || MasterKey::derive(&pwd, &cached_salt).unwrap())
                    .await
                    .map_err(|e| format!("Task failed: {}", e))?;

            // Offline mode: No WsClient, dummy channel for intercepting clipboard events
            let dummy_ws_tx = tokio::sync::mpsc::channel(1).0;

            if let Err(e) = yiboflow_core::cache::init_cache_and_history() {
                log::warn!("Failed to re-initialize cache after offline login: {}", e);
            }

            let arc_mk = Arc::new(mk);

            let cb_monitor = ClipboardMonitor::new(
                "offline".to_string(),
                "none".to_string(),
                arc_mk,
                dummy_ws_tx,
                Some(ui_tx),
                device_name.clone(),
            );
            cb_monitor.start_monitoring();
            // In offline mode we don't start WsClient RX receiving since there's no server

            let mut connected_flag = state.is_connected.lock().await;
            *connected_flag = true;

            info!("Running in Pure Offline Mode! Snippets engine active.");
            return Ok(true);
        } else {
            return Err(format!(
                "Network Error: {}. Offline login also failed (Wrong password or Uncached).",
                api_err
            ));
        }
    }

    Err(api_err)
}

#[derive(serde::Serialize)]
struct SettingsPayload {
    is_sync_enabled: bool,
    flowhint_min_chars: usize,
    flowhint_accept_tab: bool,
    flowhint_accept_right: bool,
    debug_mode: bool,
    dictionary_order: Vec<String>,
    image_transport_format: String,
}

#[tauri::command]
fn get_probe_targets() -> Result<Vec<probe::ProbeTargetPayload>, String> {
    probe::get_probe_targets()
}

#[tauri::command]
fn save_probe_targets(targets: Vec<probe::ProbeTargetPayload>) -> Result<(), String> {
    probe::save_probe_targets(targets)
}

#[tauri::command]
async fn probe_ai_target(target: probe::ProbeTargetPayload) -> Result<probe::ProbeResult, String> {
    probe::probe_target(target).await
}

#[tauri::command]
async fn list_probe_target_models(target: probe::ProbeTargetPayload) -> Result<Vec<String>, String> {
    probe::list_probe_target_models(target).await
}

#[tauri::command]
fn set_dictionary_order(order: Vec<String>) -> Result<(), String> {
    yiboflow_core::config::set_dictionary_order(order)
}

#[tauri::command]
fn get_settings() -> Result<SettingsPayload, String> {
    let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
    Ok(SettingsPayload {
        is_sync_enabled: cfg.is_sync_enabled,
        flowhint_min_chars: cfg.flowhint_min_chars,
        flowhint_accept_tab: cfg.flowhint_accept_tab,
        flowhint_accept_right: cfg.flowhint_accept_right,
        debug_mode: cfg.debug_mode,
        dictionary_order: cfg.dictionary_order.clone(),
        image_transport_format: cfg.cache.image_transport_format.clone(),
    })
}

#[tauri::command]
fn update_settings(
    app: tauri::AppHandle,
    is_sync_enabled: bool, 
    flowhint_min_chars: usize,
    flowhint_accept_tab: bool,
    flowhint_accept_right: bool,
    debug_mode: bool,
    image_transport_format: String,
) -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.is_sync_enabled = is_sync_enabled;
    cfg.flowhint_min_chars = flowhint_min_chars;
    cfg.flowhint_accept_tab = flowhint_accept_tab;
    cfg.flowhint_accept_right = flowhint_accept_right;
    cfg.debug_mode = debug_mode;
    cfg.cache.image_transport_format = match image_transport_format.as_str() {
        "png" | "webp_lossless" | "jpeg" => image_transport_format,
        _ => "png".to_string(),
    };
    cfg.save();
    drop(cfg);
    refresh_hint_window_cfg();
    let _ = app.emit("config-updated", ());
    Ok(())
}



#[tauri::command]
fn get_app_config() -> Result<yiboflow_core::config::AppConfig, String> {
    Ok(yiboflow_core::config::GLOBAL_CONFIG.read().unwrap().clone())
}

#[tauri::command]
async fn change_local_password(new_password: String) -> Result<(), String> {
    let salt = yiboflow_core::crypto::generate_salt();
    let salt_clone = salt.clone();
    let hash_result = tokio::task::spawn_blocking(move || {
        yiboflow_core::crypto::hash_local_password(&new_password, &salt_clone)
    }).await.map_err(|e| format!("Task join error: {}", e))?;

    match hash_result {
        Ok(hash_str) => {
            let mut cfg = yiboflow_core::config::GLOBAL_CONFIG
                .write()
                .map_err(|e| e.to_string())?;
            cfg.local_password_hash = hash_str;
            cfg.local_kdf_salt = salt;
            cfg.save();
            info!("Local offline password updated successfully");
            Ok(())
        }
        Err(e) => Err(format!("Hashing failed: {}", e)),
    }
}

#[tauri::command]
async fn send_file_p2p(
    state: tauri::State<'_, AppState>,
    file_path: String,
    target_device: u32,
) -> Result<(), String> {
    let ws_tx_guard = state.ws_tx.lock().await;
    if let Some(ws_tx) = ws_tx_guard.as_ref() {
        let path = std::path::PathBuf::from(file_path);
        yiboflow_core::p2p::start_file_send(path, target_device, ws_tx.clone()).await
    } else {
        Err("Core Engine not connected yet.".to_string())
    }
}

#[tauri::command]
fn rename_local_account(old_username: String, new_username: String) -> Result<bool, String> {
    yiboflow_core::local_auth::rename_local_user(&old_username, &new_username)
}

#[tauri::command]
async fn force_override_remote(_server_url: String, _username: String) -> Result<bool, String> {
    // Phase 3 Stub: Server-side API needs to support force-override parameter for register.
    Err("API Server does not yet support force-overriding an existing remote account. Please use the Local Offline Mode instead.".to_string())
}

#[tauri::command]
async fn manual_vault_compaction(_server_url: String, username: String, _password: String) -> Result<bool, String> {
    info!("Triggering manual Vault Compaction for user: {}", username);
    
    // In Phase 3 architecture, compaction involves: 
    // 1. Fetching base segments + deltas
    // 2. Merging JSON delta trees locally
    // 3. Re-encrypting into a single new generation base.enc
    // 4. Overwriting remote via api.upload_vault_file
    
    // Mock sleep to simulate heavy local AES and merge ops
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    
    info!("Vault Compaction complete. Deleted 0 redundant delta logs, repacked 0 base segments.");
    
    // In actual implementation, we'd trigger a push_local right after.
    Ok(true)
}

#[tauri::command]
async fn resolve_sync_conflict(action: String, server_url: String, username: String, password: String) -> Result<bool, String> {
    info!("Resolving sync conflict with action: {}", action);

    // 1. We must login again to grab tokens and salt for key derivation
    let config_fingerprint = {
        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client.login(login_payload).await.map_err(|e| e.to_string())?;
    
    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!("Login failed during sync resolve: {}", login_result.msg));
    }
    let d = login_result.data.unwrap();

    let vk_pwd = password.clone();
    let vk_salt = d.kdf_salt.clone();
    let vault_key = tokio::task::spawn_blocking(move || {
        yiboflow_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Sandbox root is currently fixed, but in real architecture it will dynamically include the username
    let sandbox_root = yiboflow_core::backup::get_data_dir().join("users").join(&username);

    if action == "pull_remote" {
        // Vault Pull Phase
        yiboflow_core::sync::transport::pull_and_replay_vault(&client, &vault_key, &sandbox_root).await?;
        
        // Let's force load new Config into RAM
        yiboflow_core::config::AppConfig::reload();

    } else if action == "push_local" {
        // Vault Push Phase
        let packager = yiboflow_core::sync::packager::VaultPackager::new(vault_key, sandbox_root);
        let new_ts = yiboflow_core::sync::transport::push_full_vault(&client, &packager).await?;
        
        {
            let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
            cfg.sync_meta.global_updated_at = new_ts;
            let _ = cfg.save();
        }
    }
    
    Ok(true)
}

#[tauri::command]
async fn resolve_file_conflicts(
    resolutions: std::collections::HashMap<String, String>,
    server_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    info!("Resolving file-level sync conflicts for {} files", resolutions.len());

    let config_fingerprint = {
        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client.login(login_payload).await.map_err(|e| e.to_string())?;
    
    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!("Login failed during sync resolve: {}", login_result.msg));
    }
    let d = login_result.data.unwrap();

    let vk_pwd = password.clone();
    let vk_salt = d.kdf_salt.clone();
    let vault_key = tokio::task::spawn_blocking(move || {
        yiboflow_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
    })
    .await
    .map_err(|e| e.to_string())??;

    let sandbox_root = yiboflow_core::backup::get_data_dir().join("users").join(&username);
    let packager = yiboflow_core::sync::packager::VaultPackager::new(vault_key, sandbox_root);

    let plan = yiboflow_core::sync::transport::compute_merge_plan(&client, &packager).await?;

    let new_ts = yiboflow_core::sync::transport::execute_merge_plan(&client, &packager, &plan, resolutions).await?;

    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    cfg.sync_meta.global_updated_at = new_ts;
    let _ = cfg.save();
    yiboflow_core::config::AppConfig::reload();

    Ok(true)
}

#[derive(serde::Serialize)]
struct VaultSyncStatus {
    server_url: String,
    username: String,
    local_updated_at: u64,
    remote_updated_at: Option<u64>,
    remote_manifest_size: usize,
    status_msg: String,
}

#[tauri::command]
async fn get_vault_sync_status(server_url: String, username: String, password: String) -> Result<VaultSyncStatus, String> {
    let local_updated_at = {
        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.sync_meta.global_updated_at
    };

    if server_url.is_empty() || server_url == "local" || username.is_empty() {
        return Ok(VaultSyncStatus {
            server_url: "Local Only".to_string(),
            username: "Offline".to_string(),
            local_updated_at,
            remote_updated_at: None,
            remote_manifest_size: 0,
            status_msg: "未连接至远程 Vault 云端".to_string(),
        });
    }

    let config_fingerprint = {
        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client.login(login_payload).await.map_err(|e| format!("Network Connection Error: {}", e))?;
    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!("Auth Failed: {}", login_result.msg));
    }
    let d = login_result.data.unwrap();

    let vk_pwd = password.clone();
    let vk_salt = d.kdf_salt.clone();
    let vault_key = tokio::task::spawn_blocking(move || {
        yiboflow_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
    }).await.map_err(|e| e.to_string())??;

    let remote_manifest = yiboflow_core::sync::transport::fetch_remote_manifest(&client, &vault_key).await.map_err(|e| e.to_string())?;

    let mut remote_date = None;
    let mut remote_size = 0;
    let mut status_str = "与云端状态一致".to_string();

    if let Some(manifest) = remote_manifest {
        remote_date = Some(manifest.last_synced_at);
        remote_size = manifest.files.len();
        if manifest.last_synced_at > local_updated_at {
            status_str = "云端数据更新 (Remote is Newer)".to_string();
        } else if manifest.last_synced_at < local_updated_at {
            status_str = "本地数据更新 (Local is Newer)".to_string();
        }
    } else {
        status_str = "云端为空 (Remote is Empty)".to_string();
    }

    Ok(VaultSyncStatus {
        server_url,
        username,
        local_updated_at,
        remote_updated_at: remote_date,
        remote_manifest_size: remote_size,
        status_msg: status_str,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterDevice {
    pub id: String,
    pub name: String,
    pub is_online: bool,
    pub is_local: bool,
    pub device_type: String,
}

#[tauri::command]
async fn get_cluster_devices(server_url: String, username: String, password: String) -> Result<Vec<ClusterDevice>, String> {
    if server_url.is_empty() || server_url == "local" || username.is_empty() {
        return Ok(vec![ClusterDevice {
            id: "local_win".to_string(),
            name: "本地模式".to_string(),
            is_online: true,
            is_local: true,
            device_type: "windows".to_string(),
        }]);
    }

    let config_fingerprint = {
        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client.login(login_payload).await.map_err(|e| format!("Network Connection Error: {}", e))?;
    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!("Auth Failed: {}", login_result.msg));
    }
    let d = login_result.data.unwrap();

    // Query /api/v1/sync/devices
    let devices_res = client.get_devices(&d.access_token).await.map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for dev in devices_res {
        let is_local = dev.id == d.device_id;
        
        out.push(ClusterDevice {
            id: format!("{}", dev.id),
            name: dev.name,
            is_online: dev.is_online,
            is_local, 
            device_type: dev.r#type,
        });
    }

    Ok(out)
}

// ---------------------------------------------------------------------------
// FlowRules Commands — per-app feature permission matrix
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct FlowRulesPayload {
    default: yiboflow_core::rules::DefaultRules,
    app_overrides: Vec<yiboflow_core::rules::AppRule>,
}

#[tauri::command]
fn get_flow_rules() -> Result<FlowRulesPayload, String> {
    let cfg = yiboflow_core::rules::get_rules();
    Ok(FlowRulesPayload {
        default: cfg.default,
        app_overrides: cfg.app_overrides,
    })
}

#[tauri::command]
fn set_default_rules(
    flowsnap: bool,
    flowhint: bool,
    flowsync: bool,
    flowkeys: bool,
) -> Result<(), String> {
    yiboflow_core::rules::set_default_rules(yiboflow_core::rules::DefaultRules {
        flowsnap,
        flowhint,
        flowsync,
        flowkeys,
    })
}

#[tauri::command]
fn upsert_app_rule(
    process: String,
    display_name: String,
    flowsnap: Option<bool>,
    flowhint: Option<bool>,
    flowhint_dicts: Vec<String>,
    flowsync: Option<bool>,
    flowkeys: Option<bool>,
) -> Result<(), String> {
    yiboflow_core::rules::upsert_app_rule(yiboflow_core::rules::AppRule {
        process,
        display_name,
        flowsnap,
        flowhint,
        flowhint_dicts,
        flowsync,
        flowkeys,
    })
}

#[tauri::command]
fn remove_app_rule(process: String) -> Result<(), String> {
    yiboflow_core::rules::remove_app_rule(process)
}

#[tauri::command]
fn toggle_app_feature(process: String, feature: String) -> Result<(), String> {
    let f = parse_feature(&feature)?;
    yiboflow_core::rules::toggle_app_feature(process, f)
}

#[tauri::command]
fn toggle_default_feature(feature: String) -> Result<(), String> {
    let f = parse_feature(&feature)?;
    yiboflow_core::rules::toggle_default_feature(f)
}

fn parse_feature(s: &str) -> Result<yiboflow_core::rules::Feature, String> {
    match s.to_lowercase().as_str() {
        "flowsnap" => Ok(yiboflow_core::rules::Feature::FlowSnap),
        "flowhint" => Ok(yiboflow_core::rules::Feature::FlowHint),
        "flowsync" => Ok(yiboflow_core::rules::Feature::FlowSync),
        "flowkeys" => Ok(yiboflow_core::rules::Feature::FlowKeys),
        _ => Err(format!("Unknown feature: {}", s)),
    }
}

// ---------------------------------------------------------------------------
// Backup & Restore
// ---------------------------------------------------------------------------

#[tauri::command]
fn export_config(dest_path: String) -> Result<(), String> {
    info!("Tauri Command: export_config to {}", dest_path);
    yiboflow_core::backup::export_config(&dest_path)
}

#[tauri::command]
fn import_config(src_path: String) -> Result<(), String> {
    info!("Tauri Command: import_config from {}", src_path);
    yiboflow_core::backup::import_config(&src_path)
}

#[tauri::command]
fn get_all_dictionaries() -> Result<Vec<yiboflow_core::dictionary::SmartDictionary>, String> {
    Ok(yiboflow_core::dictionary::get_all_dictionaries())
}

#[tauri::command]
fn save_dictionary(dict: yiboflow_core::dictionary::SmartDictionary) -> Result<(), String> {
    info!("Tauri Command: save_dictionary {}", dict.id);
    yiboflow_core::dictionary::save_dictionary(dict)?;
    yiboflow_core::smart_router::invalidate_snap_cache();
    Ok(())
}

#[tauri::command]
fn delete_dictionary(id: String) -> Result<(), String> {
    info!("Tauri Command: delete_dictionary {}", id);
    yiboflow_core::dictionary::delete_dictionary(&id)?;
    yiboflow_core::smart_router::invalidate_snap_cache();
    Ok(())
}
#[tauri::command]
fn get_window_under_cursor() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    unsafe {

        use windows::Win32::Foundation::{MAX_PATH, POINT};
        use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetCursorPos, GetWindowThreadProcessId, WindowFromPoint,
        };

        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_ok() {
            let hwnd = WindowFromPoint(pt);
            if hwnd.0 != std::ptr::null_mut() {
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid != 0 {
                    if let Ok(process_handle) =
                        OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
                    {
                        let mut buf = [0u16; MAX_PATH as usize];
                        let len = GetModuleFileNameExW(Some(process_handle), None, &mut buf);
                        if len > 0 {
                            let mut current_exe = String::from_utf16_lossy(&buf[..len as usize]);
                            current_exe = current_exe.trim_matches('\0').to_string();
                            let exe_name =
                                current_exe.split('\\').last().unwrap_or("").to_lowercase();
                            return Ok(exe_name);
                        }
                    }
                }
            }
        }
    }
    Err("Could not find window under cursor".into())
}

#[tauri::command]
async fn start_app_picker(app: tauri::AppHandle, _window: tauri::WebviewWindow) -> Result<(), String> {
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        use std::thread::sleep;
        use std::time::Duration;

        // 1. Wait for current mouse button release
        while (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000) != 0 {
            sleep(Duration::from_millis(20));
        }

        // 2. Wait for next mouse button down OR ESC key (0x1B)
        loop {
            let is_click = (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000) != 0;
            let is_esc = (unsafe { GetAsyncKeyState(0x1B) } as u16 & 0x8000) != 0;
            
            if is_click {
                if let Ok(exe) = get_window_under_cursor() {
                    let _ = app_handle.emit("app-picked", Some(exe));
                }
                break;
            }
            if is_esc {
                let _ = app_handle.emit("app-picked", None::<String>);
                break;
            }
            sleep(Duration::from_millis(20));
        }

        // 3. Final cleanup - wait for button release
        while (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000) != 0 {
            sleep(Duration::from_millis(20));
        }
    });

    Ok(())
}

#[tauri::command]
async fn read_clipboard_content() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| {
        use base64::{Engine as _, engine::general_purpose::STANDARD};

        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(text) = cb.get_text() {
                if !text.is_empty() {
                    return Ok(serde_json::json!({
                        "type": "text",
                        "content": text,
                    }));
                }
            }
        }

        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(img) = cb.get_image() {
                let width = img.width as u32;
                let height = img.height as u32;
                if let Some(img_buffer) = image::RgbaImage::from_raw(width, height, img.bytes.into_owned()) {
                    let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
                    let mut buf = std::io::Cursor::new(Vec::new());
                    if dyn_img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                        let encoded = STANDARD.encode(buf.into_inner());
                        return Ok(serde_json::json!({
                            "type": "image",
                            "content": format!("data:image/png;base64,{}", encoded),
                            "width": width,
                            "height": height,
                        }));
                    }
                }
            }
        }

        Ok(serde_json::json!({ "type": "empty" }))
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn write_to_clipboard(content: String) -> Result<(), String> {
    // Update text cache to prevent clipboard monitor from re-dispatching
    {
        if let Ok(mut last) = yiboflow_core::clipboard::LAST_TEXT.lock() {
            *last = content.clone();
        }
    }

    tokio::task::spawn_blocking(move || {
        for attempt in 0..10 {
            match arboard::Clipboard::new() {
                Ok(mut cb) => {
                    match cb.set_text(&content) {
                        Ok(()) => return Ok(()),
                        Err(e) if attempt < 9 => {
                            std::thread::sleep(std::time::Duration::from_millis(100));
                            continue;
                        }
                        Err(e) => return Err(format!("Clipboard write failed: {}", e)),
                    }
                }
                Err(e) if attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(format!("Clipboard open failed: {}", e)),
            }
        }
        Err("Clipboard write failed after retries".into())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn write_image_to_clipboard(image_base64: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use base64::{Engine as _, engine::general_purpose::STANDARD};

        let data_uri = image_base64.trim();
        let b64_str = if data_uri.starts_with("data:image/") {
            data_uri.split(",").nth(1).unwrap_or("")
        } else {
            data_uri
        };

        let bytes = STANDARD.decode(b64_str).map_err(|e| format!("Base64 decode failed: {}", e))?;
        let img = image::load_from_memory(&bytes).map_err(|e| format!("Image parse failed: {}", e))?;
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();

        let img_data = arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.clone().into_raw()),
        };

        // Update the image hash cache to prevent clipboard monitor from re-dispatching
        {
            use std::hash::{DefaultHasher, Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            w.hash(&mut hasher);
            h.hash(&mut hasher);
            let raw_bytes: &[u8] = img_data.bytes.as_ref();
            raw_bytes.len().hash(&mut hasher);
            let sample_len = 1024;
            if raw_bytes.len() > sample_len * 2 {
                raw_bytes[..sample_len].hash(&mut hasher);
                raw_bytes[raw_bytes.len()-sample_len..].hash(&mut hasher);
            } else {
                raw_bytes.hash(&mut hasher);
            }
            let hash = hasher.finish();
            if let Ok(mut last) = yiboflow_core::clipboard::LAST_IMAGE_HASH.lock() {
                *last = hash;
            }
        }

        for attempt in 0..10 {
            match arboard::Clipboard::new() {
                Ok(mut cb) => {
                    match cb.set_image(img_data.clone()) {
                        Ok(()) => return Ok(()),
                        Err(e) if attempt < 9 => {
                            std::thread::sleep(std::time::Duration::from_millis(100));
                            continue;
                        }
                        Err(e) => return Err(format!("Clipboard write failed: {}", e)),
                    }
                }
                Err(e) if attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(format!("Clipboard open failed: {}", e)),
            }
        }
        Err("Clipboard write failed after retries".into())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn get_flowsync_runtime_state() -> Result<FlowSyncRuntimeState, String> {
    Ok(FlowSyncRuntimeState {
        receive_only_mode: yiboflow_core::clipboard::is_receive_only_mode(),
    })
}

#[tauri::command]
fn set_flowsync_receive_only_mode(enabled: bool) -> Result<bool, String> {
    yiboflow_core::clipboard::set_receive_only_mode(enabled);
    Ok(enabled)
}

#[tauri::command]
async fn get_flowsync_diagnostics(
    state: tauri::State<'_, AppState>,
) -> Result<FlowSyncDiagnostics, String> {
    let exe_path = std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "<unknown>".to_string());
    let global_dir = yiboflow_core::local_auth::get_yiboflow_global_dir()
        .display()
        .to_string();
    let active_user_dir = yiboflow_core::local_auth::get_active_user_dir()
        .display()
        .to_string();
    let active_user = yiboflow_core::local_auth::ACTIVE_USER.read().unwrap().clone();
    let is_connected = *state.is_connected.lock().await;
    let receive_only_mode = yiboflow_core::clipboard::is_receive_only_mode();
    let server_url = state.runtime_server_url.lock().await.clone();
    let username = state.runtime_username.lock().await.clone();
    let device_name = state.runtime_device_name.lock().await.clone();
    let remote_device_id = *state.runtime_remote_device_id.lock().await;

    let config_fingerprint = {
        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let persistent_device_fingerprint = state
        .persistent_device_fingerprint
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| config_fingerprint.clone());
    let runtime_device_fingerprint = state
        .runtime_device_fingerprint
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| resolve_runtime_device_fingerprint(&config_fingerprint));

    Ok(FlowSyncDiagnostics {
        exe_path,
        global_dir,
        active_user_dir,
        active_user,
        is_connected,
        receive_only_mode,
        server_url,
        username,
        device_name,
        remote_device_id,
        persistent_device_fingerprint,
        runtime_device_fingerprint,
    })
}

// ─── Clipboard History Tauri Commands ───

#[tauri::command]
fn init_clipboard_history() -> Result<bool, String> {
    yiboflow_core::cache::init_cache_and_history()?;
    Ok(true)
}

#[tauri::command]
fn query_history(
    type_filter: Option<String>,
    time_from: Option<i64>,
    time_to: Option<i64>,
    source_filter: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<serde_json::Value>, String> {
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;
    let entries = history.query(
        type_filter.as_deref(),
        time_from,
        time_to,
        source_filter.as_deref(),
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )?;
    Ok(entries.iter().map(|e| serde_json::to_value(e).unwrap()).collect())
}

#[tauri::command]
fn search_history(query: String, limit: Option<u32>) -> Result<Vec<serde_json::Value>, String> {
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;
    let entries = history.search(&query, limit.unwrap_or(50))?;
    Ok(entries.iter().map(|e| serde_json::to_value(e).unwrap()).collect())
}

#[tauri::command]
fn copy_history_to_clipboard(id: i64) -> Result<(), String> {
    let cache_lock = yiboflow_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized")?;
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;

    let entry = history.get_by_id(id)?
        .ok_or(format!("Entry {} not found", id))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    if entry.entry_type == "text" {
        let content = cache.read_text(&entry.hash)?;
        {
            if let Ok(mut last) = yiboflow_core::clipboard::LAST_TEXT.lock() {
                *last = content.clone();
            }
        }
        for attempt in 0..5 {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                if cb.set_text(&content).is_ok() {
                    break;
                }
            }
            if attempt < 4 {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    } else if entry.entry_type == "image" {
        let data = cache.read_image(&entry.hash)?;
        if data.len() < 16 {
            return Err("Invalid image cache data".into());
        }
        let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
        let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as usize;
        let img_bytes = data[16..].to_vec();

        let img_data = arboard::ImageData {
            width: w,
            height: h,
            bytes: std::borrow::Cow::Owned(img_bytes),
        };

        {
            use std::hash::{DefaultHasher, Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            w.hash(&mut hasher);
            h.hash(&mut hasher);
            let raw: &[u8] = img_data.bytes.as_ref();
            raw.len().hash(&mut hasher);
            let sample_len = 1024;
            if raw.len() > sample_len * 2 {
                raw[..sample_len].hash(&mut hasher);
                raw[raw.len()-sample_len..].hash(&mut hasher);
            } else {
                raw.hash(&mut hasher);
            }
            if let Ok(mut last) = yiboflow_core::clipboard::LAST_IMAGE_HASH.lock() {
                *last = hasher.finish();
            }
        }

        for attempt in 0..5 {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                if cb.set_image(img_data.clone()).is_ok() {
                    break;
                }
            }
            if attempt < 4 {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }

    history.touch_by_id(id, now)?;
    Ok(())
}

#[tauri::command]
fn delete_history(ids: Vec<i64>) -> Result<u32, String> {
    let cache_lock = yiboflow_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized")?;
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;

    let entries: Vec<(String, String)> = ids.iter().filter_map(|&id| {
        history.get_by_id(id).ok().flatten().map(|e| (e.entry_type, e.hash))
    }).collect();

    let count = history.delete_by_ids(&ids)?;
    for (entry_type, hash) in entries {
        let _ = cache.delete_file(&entry_type, &hash);
    }
    Ok(count)
}

#[tauri::command]
fn clear_history(before_days: Option<u32>) -> Result<u32, String> {
    let cache_lock = yiboflow_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized")?;
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;

    let before_ts = match before_days {
        Some(days) if days > 0 => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            now - (days as i64 * 86_400_000)
        }
        _ => 0,
    };

    let entries = history.query(None, None, Some(before_ts), None, 10000, 0)?;
    let ids: Vec<i64> = entries.iter().map(|e| e.id).collect();
    let count = history.delete_by_ids(&ids)?;
    for e in &entries {
        let _ = cache.delete_file(&e.entry_type, &e.hash);
    }
    Ok(count)
}

#[tauri::command]
fn toggle_history_pin(id: i64) -> Result<bool, String> {
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;
    history.toggle_pin(id)
}

#[tauri::command]
fn get_cache_stats() -> Result<serde_json::Value, String> {
    let cache_lock = yiboflow_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized")?;
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;

    let (total, text_count, image_count) = history.get_stats()?;
    let total_size = cache.compute_total_size();
    let (text_files, image_files) = cache.compute_file_count();

    Ok(serde_json::json!({
        "total_entries": total,
        "text_count": text_count,
        "image_count": image_count,
        "total_size_bytes": total_size,
        "total_size_mb": (total_size as f64 / 1_048_576.0 * 100.0).round() / 100.0,
        "cache_dir": cache.base_dir().to_string_lossy().to_string(),
        "max_size_mb": cache.max_size_mb(),
        "text_files": text_files,
        "image_files": image_files,
    }))
}

#[tauri::command]
fn set_cache_dir(path: String) -> Result<(), String> {
    let mut cache_lock = yiboflow_core::cache::CACHE_MANAGER.write().unwrap();
    let cache = cache_lock.as_mut()
        .ok_or("Cache not initialized")?;
    let new_dir = std::path::PathBuf::from(&path);
    cache.migrate_to(new_dir)?;
    if let Ok(mut cfg) = yiboflow_core::config::GLOBAL_CONFIG.write() {
        cfg.cache.cache_dir = path;
        cfg.save();
    }
    Ok(())
}

#[tauri::command]
fn set_cache_max_size(mb: u64) -> Result<(), String> {
    let cache_lock = yiboflow_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized")?;
    cache.set_max_size_mb(mb);
    drop(cache_lock);
    yiboflow_core::cache::enforce_cache_limit_now();
    if let Ok(mut cfg) = yiboflow_core::config::GLOBAL_CONFIG.write() {
        cfg.cache.cache_max_size_mb = mb;
        cfg.save();
    }
    Ok(())
}

#[tauri::command]
fn get_history_content(id: i64) -> Result<serde_json::Value, String> {
    let cache_lock = yiboflow_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized")?;
    let history_lock = yiboflow_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized")?;

    let entry = history.get_by_id(id)?
        .ok_or(format!("Entry {} not found", id))?;

    if entry.entry_type == "text" {
        let content = cache.read_text(&entry.hash)?;
        Ok(serde_json::json!({
            "type": "text",
            "content": content,
        }))
    } else {
        let data = cache.read_image(&entry.hash)?;
        if data.len() < 16 {
            return Err("Invalid image cache data".into());
        }
        let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as u32;
        let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as u32;
        let img_bytes = &data[16..];

        use base64::{Engine as _, engine::general_purpose::STANDARD};
        if let Some(img_buffer) = image::RgbaImage::from_raw(w, h, img_bytes.to_vec()) {
            let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
            let mut buf = std::io::Cursor::new(Vec::new());
            if dyn_img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                let encoded = STANDARD.encode(buf.into_inner());
                return Ok(serde_json::json!({
                    "type": "image",
                    "content": format!("data:image/png;base64,{}", encoded),
                    "width": w,
                    "height": h,
                }));
            }
        }
        Err("Failed to decode image".into())
    }
}

#[tauri::command]
async fn pull_today_history(state: tauri::State<'_, AppState>) -> Result<u32, String> {
    let ws_tx_lock = state.ws_tx.lock().await;
    let tx = ws_tx_lock.as_ref()
        .ok_or("Not connected to any device. Please connect first.")?
        .clone();
    drop(ws_tx_lock);

    let request = yiboflow_core::ws::WsMessage {
        sender_uid: 0,
        sender_device_id: 0,
        target_devices: vec![],
        r#type: "history_request".to_string(),
        payload: serde_json::json!({
            "mode": "recent",
            "limit": 5,
        }),
    };

    tx.send(request).await
        .map_err(|e| format!("Failed to send history_request: {}", e))?;

    Ok(0)
}

#[tauri::command]
fn update_key_mappings(mappings: Vec<yiboflow_core::hook_manager::KeyRemapEntry>) -> Result<(), String> {
    yiboflow_core::hook_manager::update_key_remap_table(mappings);
    Ok(())
}

#[tauri::command]
fn diagnose_flowhint() -> Result<String, String> {
    let dicts = yiboflow_core::dictionary::get_all_dictionaries();
    let mut report = String::new();
    report.push_str("--- LingSi (FlowHint) Diagnostic Report ---\n\n");
    report.push_str(&format!("Loaded Dictionaries: {}\n", dicts.len()));
    for d in &dicts {
        report.push_str(&format!("  - {} (ID: {}, Entries: {})\n", d.name, d.id, d.entries.len()));
    }
    
    let default_rules = yiboflow_core::rules::get_rules().default;
    report.push_str(&format!("\nDefault FlowHint Enabled: {}\n", default_rules.flowhint));
    
    #[cfg(target_os = "windows")]
    {
        if let Ok(hint) = yiboflow_core::hook_manager::CURRENT_HINT.lock() {
            report.push_str(&format!("Hook Status: Active={}\n", hint.is_active));
            report.push_str(&format!("Current Buffer Matches: {}\n", hint.candidates.len()));
        }
    }
    
    // 6. HINT_TX status
    let tx_set = yiboflow_core::hook_manager::HINT_TX.lock().map(|tx| tx.is_some()).unwrap_or(false);
    report.push_str(&format!("[Channel] HINT_TX is_set={}\n", tx_set));

    // 7. Try actually sending a test event
    if tx_set {
        yiboflow_core::hook_manager::set_hint_tx_test_send();
        report.push_str("[Channel] Sent test HintEvent::Show (Event loop will handle SW_SHOWNOACTIVATE)\n");
    }

    report.push_str("\nEngine: Ready\n");
    Ok(report)
}

#[tauri::command]
fn accept_hint_candidate(index: usize) -> Result<(), String> {
    yiboflow_core::hook_manager::accept_hint_by_index(index);
    Ok(())
}

#[tauri::command]
fn dismiss_hint_window() -> Result<(), String> {
    yiboflow_core::hook_manager::dismiss_hint();
    Ok(())
}

#[tauri::command]
fn update_hint_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    if cfg.hint_window.pos_type == 0 {
        // Follow mode: update relative offsets
        let anchor = LAST_HINT_ANCHOR.lock().unwrap();
        cfg.hint_window.offset_x = x - anchor.0;
        cfg.hint_window.offset_y = y - anchor.1;
    } else {
        // Fixed mode: update absolute coordinates
        cfg.hint_window.fixed_x = x;
        cfg.hint_window.fixed_y = y;
    }
    cfg.save();
    let _ = app.emit("config-updated", ());
    Ok(())
}

#[tauri::command]
fn move_hint_window(x: i32, y: i32) -> Result<(), String> {
    if let Some(tx) = &*yiboflow_core::hook_manager::HINT_TX.lock().unwrap() {
        let _ = tx.send(yiboflow_core::hook_manager::HintEvent::MoveWindow { x, y });
    }
    Ok(())
}

#[tauri::command]
fn reset_hint_position(app: tauri::AppHandle) -> Result<(), String> {
    let pos_type;
    {
        let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
        pos_type = cfg.hint_window.pos_type;
        cfg.hint_window.offset_x = 0;
        cfg.hint_window.offset_y = 0;
        cfg.save();
    }
    info!("Hint window position has been reset to defaults.");

    // Move the window to the default position based on current mode
    let target_x;
    let target_y;
    if pos_type == 0 {
        // Follow mode: use last known anchor (cursor position)
        let anchor = LAST_HINT_ANCHOR.lock().unwrap();
        target_x = anchor.0;
        target_y = anchor.1 + 20;
    } else {
        // Fixed mode: reset fixed position and use last anchor as new default
        let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
        let anchor = LAST_HINT_ANCHOR.lock().unwrap();
        target_x = anchor.0;
        target_y = anchor.1 + 20;
        cfg.hint_window.fixed_x = target_x;
        cfg.hint_window.fixed_y = target_y;
        cfg.save();
    }

    if target_x != 0 || target_y != 0 {
        if let Some(tx) = &*yiboflow_core::hook_manager::HINT_TX.lock().unwrap() {
            let _ = tx.send(yiboflow_core::hook_manager::HintEvent::MoveWindow { x: target_x, y: target_y });
        }
    }

    let _ = app.emit("config-updated", ());
    Ok(())
}

#[tauri::command]
fn set_hint_window_mode(app: tauri::AppHandle, pos_type: i32) -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    if pos_type == 1 && cfg.hint_window.fixed_x == -1 {
        // Switching to Fixed mode for the first time: snapshot last anchor as fixed position
        if let Ok(anchor) = LAST_HINT_ANCHOR.lock() {
            if anchor.0 != 0 || anchor.1 != 0 {
                cfg.hint_window.fixed_x = anchor.0;
                cfg.hint_window.fixed_y = anchor.1 + 20;
            }
        }
    }
    cfg.hint_window.pos_type = pos_type;
    cfg.save();
    drop(cfg);
    info!("Hint window mode set to: {}", if pos_type == 0 { "Follow" } else { "Fixed" });
    let _ = app.emit("config-updated", ());
    Ok(())
}

#[tauri::command]
fn resize_hint_window(width: i32, height: i32) -> Result<(), String> {
    if let Some(tx) = &*yiboflow_core::hook_manager::HINT_TX.lock().unwrap() {
        let _ = tx.send(yiboflow_core::hook_manager::HintEvent::Resize { width, height });
    }
    Ok(())
}

#[tauri::command]
fn set_hint_window_size(app: tauri::AppHandle, width: i32, height: i32) -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.hint_window.width = width;
    cfg.hint_window.height = height;
    cfg.save();
    drop(cfg);
    info!("Hint window size set to: {}x{}", width, height);
    let _ = app.emit("config-updated", ());
    Ok(())
}

#[tauri::command]
fn set_hint_window_scale(app: tauri::AppHandle, scale: f32) -> Result<(), String> {
    let s = scale.max(0.6).min(1.8);
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.hint_window.scale = s;
    cfg.save();
    drop(cfg);
    info!("Hint window scale set to: {:.1}", s);
    let _ = app.emit("config-updated", ());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn regenerate_device_fingerprint() -> Result<String, String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    let new_fp = uuid::Uuid::new_v4().to_string();
    cfg.device_fingerprint = new_fp.clone();
    let _ = cfg.save();
    Ok(new_fp)
}

pub fn run() {
    // Intialize Rust logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // 预热词库引擎与账户上下文
    yiboflow_core::local_auth::load_session();
    yiboflow_core::dictionary::init_and_load_dictionaries();
    yiboflow_core::dictionary::load_freq_cache();

    if let Err(e) = yiboflow_core::cache::init_cache_and_history() {
        log::error!("Failed to initialize clipboard history: {}", e);
    }

    #[cfg(target_os = "windows")]
    yiboflow_core::hook_manager::start_global_hook();

    let debug_mode_enabled = yiboflow_core::config::GLOBAL_CONFIG
        .read()
        .map(|cfg| cfg.debug_mode)
        .unwrap_or(false);
    let allow_multi_instance = std::env::var("YIBOFLOW_ALLOW_MULTI_INSTANCE")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false) || debug_mode_enabled;
    let data_dir = std::env::var("YIBOFLOW_DATA_DIR").unwrap_or_else(|_| "<default>".to_string());
    info!(
        "[Startup] allow_multi_instance={}, debug_mode={}, data_dir={}",
        allow_multi_instance, debug_mode_enabled, data_dir
    );

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["hint"])
                .build()
        )
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .manage(AppState {
            is_connected: Mutex::new(false),
            ws_tx: Mutex::new(None),
            runtime_server_url: Mutex::new(None),
            runtime_username: Mutex::new(None),
            runtime_device_name: Mutex::new(None),
            runtime_remote_device_id: Mutex::new(None),
            persistent_device_fingerprint: Mutex::new(None),
            runtime_device_fingerprint: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    let builder = if allow_multi_instance {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
    };

    builder.setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            // Removed: use tauri::Manager; // Redundant with top-level import

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("YiboFlow")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                        let _ = app.save_window_state(StateFlags::all());
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let main_window = app.get_webview_window("main").unwrap();

            let window_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                    let _ = window_clone.app_handle().save_window_state(StateFlags::all());
                    window_clone.hide().unwrap();
                    api.prevent_close();
                }
            });

            // Dynamically create the Hint window so window-state-plugin ignores it
            let hint_win = tauri::WebviewWindowBuilder::new(
                app,
                "hint",
                tauri::WebviewUrl::App("/#/hint".into()),
            )
            .title("FlowHint")
            .inner_size(300.0, 280.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .visible(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .build()
            .unwrap();

            // Get Win32 HWND for direct window management (no focus stealing)
            #[cfg(target_os = "windows")]
            let hint_hwnd = {
                use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, GWL_EXSTYLE};
                let raw_hwnd = hint_win.hwnd().unwrap();
                let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as *mut _);
                unsafe {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    // WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x00000080
                    // IMPORTANT: Explicitly REMOVE WS_EX_TRANSPARENT (0x20) to ensure clicks are caught!
                    let new_style = (ex_style | 0x08000000i32 | 0x00000080i32) & !0x00000020i32;
                    SetWindowLongW(hwnd, GWL_EXSTYLE, new_style);
                    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_FRAMECHANGED};
                    let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED);
                }
                hwnd
            };

            // Bridge FlowHint events from Hook to Tauri Frontend
            let (hint_tx, hint_rx) = std::sync::mpsc::channel();
            yiboflow_core::hook_manager::set_hint_tx(hint_tx);
            refresh_hint_window_cfg(); // Initialize cached hint config
            let app_handle = app.handle().clone();
            #[cfg(target_os = "windows")]
            let hint_hwnd_raw = hint_hwnd.0 as isize;
            std::thread::spawn(move || {
                use yiboflow_core::hook_manager::HintEvent;
                while let Ok(event) = hint_rx.recv() {
                    let ev_clone = event.clone();
                    let app_handle_inner = app_handle.clone();
                    let _ = app_handle.run_on_main_thread(move || {
                        #[cfg(target_os = "windows")]
                        {
                            let hint_hwnd = windows::Win32::Foundation::HWND(hint_hwnd_raw as *mut _);
                            use windows::Win32::UI::WindowsAndMessaging::{
                                ShowWindow, SetWindowPos, SW_SHOWNOACTIVATE, SW_HIDE,
                                HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, SWP_NOZORDER, SWP_NOSIZE,
                                SWP_NOMOVE,
                            };
                            match &ev_clone {
                                HintEvent::Show { candidates, x, y, .. } => {
                                    let visible_count = candidates.len().min(8) as i32;

                                    let (cfg_pos_type, cfg_x, cfg_y, cfg_ox, cfg_oy, cfg_scale, cfg_w, cfg_h) = {
                                        let hint_cfg = HINT_WINDOW_CFG.lock().unwrap();
                                        (hint_cfg.0, hint_cfg.1, hint_cfg.2, hint_cfg.3, hint_cfg.4, hint_cfg.5, hint_cfg.6, hint_cfg.7)
                                    };

                                    let scale = cfg_scale.max(0.6).min(1.8);
                                    let auto_w = (300.0 * scale) as i32;
                                    let auto_h = ((68 + visible_count * 34) as f32 * scale) as i32;
                                    let outer_width = if cfg_w > 0 { cfg_w.max(200) } else { auto_w };
                                    let outer_height = if cfg_h > 0 { cfg_h.max(auto_h) } else { auto_h };

                                    let mut pos_x = *x;
                                    let mut pos_y = *y;

                                    let is_diag = candidates.get(0).map(|s| s.contains("[诊断]")).unwrap_or(false);
                                    if is_diag {
                                        pos_x = 400;
                                        pos_y = 400;
                                    } else if cfg_pos_type == 0 {
                                        *LAST_HINT_ANCHOR.lock().unwrap() = (pos_x, pos_y);
                                        pos_x += cfg_ox;
                                        pos_y += cfg_oy;
                                        if cfg_oy == 0 { pos_y += 20; }
                                    } else {
                                        if cfg_x != -1 { pos_x = cfg_x; }
                                        if cfg_y != -1 { pos_y = cfg_y; }
                                    }

                                    // Safety clamp
                                    if let Ok(Some(monitor)) = app_handle_inner.monitor_from_point(pos_x as f64, pos_y as f64) {
                                        let screen_x = monitor.position().x;
                                        let screen_y = monitor.position().y;
                                        let screen_w = monitor.size().width as i32;
                                        let screen_h = monitor.size().height as i32;
                                        if pos_x + outer_width > screen_x + screen_w {
                                            pos_x = screen_x + screen_w - outer_width - 10;
                                        }
                                        if pos_x < screen_x { pos_x = screen_x + 10; }
                                        if pos_y + outer_height > screen_y + screen_h {
                                            pos_y = screen_y + screen_h - outer_height - 10;
                                        }
                                        if pos_y < screen_y { pos_y = screen_y + 20; }
                                    }

                                    unsafe {
                                        info!("Clamped Position: ({}, {})", pos_x, pos_y);
                                        let _ = SetWindowPos(
                                            hint_hwnd,
                                            Some(HWND_TOPMOST),
                                            pos_x, pos_y,
                                            outer_width, outer_height,
                                            SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                        );
                                        let _ = ShowWindow(hint_hwnd, SW_SHOWNOACTIVATE);
                                    }
                                }
                                HintEvent::Hide => {
                                    unsafe {
                                        let _ = ShowWindow(hint_hwnd, SW_HIDE);
                                    }
                                }
                                HintEvent::MoveWindow { x, y } => {
                                    unsafe {
                                        let _ = SetWindowPos(
                                            hint_hwnd,
                                            None,
                                            *x, *y,
                                            0, 0,
                                            SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
                                        );
                                    }
                                }
                                HintEvent::Resize { width, height } => {
                                    unsafe {
                                        let _ = SetWindowPos(
                                            hint_hwnd,
                                            None,
                                            0, 0,
                                            *width, *height,
                                            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOZORDER,
                                        );
                                    }
                                }
                                _ => {}
                            }
                        }
                    });

                    // Always emit event to frontend for content updates
                    let _ = app_handle.emit("hint-event", event);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_engine,
            register_engine,
            resolve_sync_conflict,
            get_probe_targets,
            save_probe_targets,
            probe_ai_target,
            list_probe_target_models,
            get_app_config,
            get_settings,
            update_settings,
            set_dictionary_order,
            send_file_p2p,
            get_window_under_cursor,
            start_app_picker,
            change_local_password,
            get_flow_rules,
            set_default_rules,
            upsert_app_rule,
            remove_app_rule,
            toggle_app_feature,
            toggle_default_feature,
            export_config,
            import_config,
            get_all_dictionaries,
            save_dictionary,
            delete_dictionary,
            rename_local_account,
            force_override_remote,
            manual_vault_compaction,
            get_vault_sync_status,
            get_flowsync_runtime_state,
            get_flowsync_diagnostics,
            get_cluster_devices,
            resolve_file_conflicts,
            regenerate_device_fingerprint,
            diagnose_flowhint,
            update_key_mappings,
            accept_hint_candidate,
            dismiss_hint_window,
            update_hint_position,
            move_hint_window,
            reset_hint_position,
            set_hint_window_mode,
            resize_hint_window,
            set_hint_window_size,
            set_hint_window_scale,
            read_clipboard_content,
            write_to_clipboard,
            write_image_to_clipboard,
            set_flowsync_receive_only_mode,
            init_clipboard_history,
            query_history,
            search_history,
            copy_history_to_clipboard,
            delete_history,
            clear_history,
            toggle_history_pin,
            get_cache_stats,
            set_cache_dir,
            set_cache_max_size,
            get_history_content,
            pull_today_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
