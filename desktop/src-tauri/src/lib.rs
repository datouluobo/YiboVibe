use log::{info, warn};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::{self, Duration};

mod agent_bridge;
mod codex_app_server;
mod probe;
mod terminal;
mod terminal_screen;

lazy_static::lazy_static! {
    static ref LAST_HINT_ANCHOR: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));
    static ref HINT_WINDOW_CFG: std::sync::Mutex<(i32, i32, i32, i32, i32)> = std::sync::Mutex::new((0, -1, -1, 0, 20));
}

fn refresh_hint_window_cfg() {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
    let mut hint_cfg = HINT_WINDOW_CFG.lock().unwrap();
    *hint_cfg = (
        cfg.hint_window.pos_type,
        cfg.hint_window.fixed_x,
        cfg.hint_window.fixed_y,
        cfg.hint_window.offset_x,
        cfg.hint_window.offset_y,
    );
}

use yibovibe_core::api::{ApiClient, LoginFailData, LoginRequest, RegisterRequest};
use yibovibe_core::clipboard::ClipboardMonitor;
use yibovibe_core::crypto::MasterKey;
use yibovibe_core::ws::WsClient;

const MAIN_WINDOW_DEFAULT_WIDTH: f64 = 1440.0;
const MAIN_WINDOW_DEFAULT_HEIGHT: f64 = 900.0;
const SESSION_CLOSE_TOMBSTONE_SECS: u64 = 8;

// We can store shared state here later, like the WsClient channel for sending new text.
pub struct AppState {
    pub session_manager: terminal::SharedSessionManager,
    pub closing_sessions: Mutex<HashMap<String, u64>>,
    pub is_connected: Mutex<bool>,
    pub ws_tx: Mutex<Option<tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>>>,
    pub runtime_server_url: Mutex<Option<String>>,
    pub runtime_username: Mutex<Option<String>>,
    pub runtime_device_name: Mutex<Option<String>>,
    pub runtime_remote_device_id: Mutex<Option<u32>>,
    pub persistent_device_fingerprint: Mutex<Option<String>>,
    pub runtime_device_fingerprint: Mutex<Option<String>>,
    pub runtime_access_token: Mutex<Option<String>>,
    pub runtime_role: Mutex<Option<String>>,
}

fn session_close_deadline() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + SESSION_CLOSE_TOMBSTONE_SECS
}

async fn mark_session_closing(state: &tauri::State<'_, AppState>, session_id: &str) {
    if session_id.is_empty() {
        return;
    }
    let mut closing = state.closing_sessions.lock().await;
    closing.insert(session_id.to_string(), session_close_deadline());
}

async fn is_session_closing(state: &tauri::State<'_, AppState>, session_id: &str) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut closing = state.closing_sessions.lock().await;
    closing.retain(|_, deadline| *deadline > now);
    closing.get(session_id).is_some()
}

#[derive(serde::Serialize)]
struct FlowSyncRuntimeState {
    receive_only_mode: bool,
}

#[derive(serde::Serialize)]
struct FlowSyncDiagnostics {
    build_id: String,
    build_git_commit: String,
    build_git_dirty: bool,
    build_unix_ts: String,
    build_profile: String,
    build_target_dir: String,
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
    activity_total_entries: Option<i64>,
    activity_sample_query_count: Option<usize>,
    activity_query_error: Option<String>,
}

#[derive(serde::Serialize)]
struct DesktopBuildLabel {
    app_version: String,
    build_id: String,
}

const FLOWSYNC_STAGE_CHUNK_BYTES: usize = 4 * 1024 * 1024;

async fn resolve_runtime_device_name(state: &tauri::State<'_, AppState>) -> String {
    if let Some(device_name) = state.runtime_device_name.lock().await.clone() {
        let trimmed = device_name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    if let Ok(instance_tag) = std::env::var("YIBOFLOW_INSTANCE_TAG") {
        let trimmed = instance_tag.trim();
        if !trimmed.is_empty() {
            return format!("YiboFlow-{trimmed}");
        }
    }

    "YiboFlow Desktop Native".to_string()
}

fn resolve_runtime_device_fingerprint(base_fingerprint: &str) -> String {
    let instance_tag = std::env::var("YIBOFLOW_INSTANCE_TAG")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    match instance_tag {
        Some(tag) => format!("{base_fingerprint}::{tag}"),
        None => base_fingerprint.to_string(),
    }
}

async fn require_runtime_server_auth(
    state: &tauri::State<'_, AppState>,
) -> Result<(String, String), String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    Ok((server_url, token))
}

fn sanitize_stage_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "flowsync-object ".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_path(root: &Path, preferred_name: &str) -> PathBuf {
    let candidate = root.join(preferred_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(preferred_name)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("flowsync-object ");
    let ext = Path::new(preferred_name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    for idx in 2..1000 {
        let name = if ext.is_empty() {
            format!("{stem} ({idx})")
        } else {
            format!("{stem} ({idx}).{ext}")
        };
        let next = root.join(name);
        if !next.exists() {
            return next;
        }
    }
    root.join(format!("{stem}-{}", uuid::Uuid::new_v4()))
}

fn stage_expire_at_ms(ttl_seconds: i32) -> i64 {
    current_unix_ms() + (ttl_seconds.max(0) as i64 * 1000)
}

fn normalize_main_window_size(window: &tauri::WebviewWindow) {
    let window = window.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        if window.is_maximized().unwrap_or(false) {
            return;
        }

        let Ok(size) = window.inner_size() else {
            return;
        };

        let current_width = size.width as f64;
        let current_height = size.height as f64;
        let needs_resize = current_width < MAIN_WINDOW_DEFAULT_WIDTH
            || current_height < MAIN_WINDOW_DEFAULT_HEIGHT;

        if !needs_resize {
            return;
        }

        info!(
            "Normalize main window size from {}x{} to {}x{}",
            size.width,
            size.height,
            MAIN_WINDOW_DEFAULT_WIDTH as u32,
            MAIN_WINDOW_DEFAULT_HEIGHT as u32
        );

        if let Err(err) = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            MAIN_WINDOW_DEFAULT_WIDTH,
            MAIN_WINDOW_DEFAULT_HEIGHT,
        ))) {
            warn!("Failed to normalize main window size: {}", err);
            return;
        }

        let _ = window.center();
    });
}

#[tauri::command]
async fn register_engine(
    server_url: String,
    username: String,
    password: String,
    password_hint: Option<String>,
) -> Result<bool, String> {
    info!(
        "Tauri Command Received: register_engine -> Server: {}, User: {}",
        server_url, username
    );

    if server_url == "local" {
        return yibovibe_core::local_auth::register_local_user(&username, &password);
    }

    // Generate a valid Argon2 salt string natively
    let kdf_salt = yibovibe_core::crypto::generate_salt();

    let client = ApiClient::new(server_url);
    let req = RegisterRequest {
        username,
        password,
        kdf_salt,
        password_hint: password_hint.unwrap_or_default(),
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

#[derive(serde::Serialize)]
struct ConnectResult {
    success: bool,
    role: String,
}

#[tauri::command]
async fn connect_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
    device_name: String,
) -> Result<ConnectResult, String> {
    let already_connected = *state.is_connected.lock().await;
    let mut ui_tx = None;

    if !already_connected {
        let (tx, mut ui_rx) = tokio::sync::mpsc::channel(100);
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Some(evt) = ui_rx.recv().await {
                let _ = app_clone.emit("clipboard-event", evt);
            }
        });
        ui_tx = Some(tx);
    } else {
        info!("Already connected. Re-authenticating to refresh runtime server token.");
    }

    info!(
        "Tauri Command Received: connect_engine -> Server: {}, User: {}, Device: {}",
        server_url, username, device_name
    );

    if server_url == "local" {
        yibovibe_core::local_auth::login_local_user(&username, &password)?;
        return Ok(ConnectResult {
            success: true,
            role: "user ".to_string(),
        });
    }

    let config_fingerprint = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
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
            if res.code == 403 {
                return Err("ACCOUNT_DISABLED".to_string());
            }
            if res.code == 401 {
                // Extract fail data (attempts + password_hint) and propagate to frontend
                let fail_data: LoginFailData = res
                    .data
                    .as_ref()
                    .and_then(|d| serde_json::from_value(d.clone()).ok())
                    .unwrap_or_default();
                if fail_data.password_hint.is_empty() {
                    return Err(format!("Auth Failed: {}", res.msg));
                } else {
                    return Err(format!(
                        "LOGIN_HINT:{}:{}",
                        fail_data.attempts, fail_data.password_hint
                    ));
                }
            }
            if res.code == 200 {
                let d = res.data.as_ref().unwrap();
                let access_token = d
                    .get("access_token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let kdf_salt = d
                    .get("kdf_salt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let login_device_id =
                    d.get("device_id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let login_role = d
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("user ")
                    .to_string();
                info!(
                    "Logged in from GUI! Received Token: {}...",
                    &access_token[0..10]
                );

                if already_connected {
                    let mut runtime_server_url = state.runtime_server_url.lock().await;
                    *runtime_server_url = Some(server_url.clone());
                    let mut runtime_username = state.runtime_username.lock().await;
                    *runtime_username = Some(username.clone());
                    let mut runtime_device_name = state.runtime_device_name.lock().await;
                    *runtime_device_name = Some(device_name.clone());
                    let mut runtime_remote_device_id = state.runtime_remote_device_id.lock().await;
                    *runtime_remote_device_id = Some(login_device_id);
                    let mut runtime_access_token = state.runtime_access_token.lock().await;
                    *runtime_access_token = Some(access_token.clone());
                    let mut runtime_role = state.runtime_role.lock().await;
                    *runtime_role = Some(login_role.clone());

                    return Ok(ConnectResult {
                        success: true,
                        role: login_role,
                    });
                }

                let pwd = password.clone();
                let salt_b64 = kdf_salt.clone();
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
                    let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
                    cfg.sync_meta.global_updated_at
                };

                // Derive Vault key
                let vk_pwd = password.clone();
                let vk_salt = kdf_salt.clone();
                let vault_key_res = tokio::task::spawn_blocking(move || {
                    yibovibe_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
                })
                .await
                .map_err(|e| format!("VaultKey derivation task failed: {}", e))?;

                let vault_key = match vault_key_res {
                    Ok(k) => k,
                    Err(e) => return Err(format!("VaultKey derivation failed: {}", e)),
                };

                // In offline mode we never reach here, this is only for remote login:
                let sandbox_root = yibovibe_core::backup::get_data_dir()
                    .join("users")
                    .join(&username);
                let packager =
                    yibovibe_core::sync::packager::VaultPackager::new(vault_key, sandbox_root);

                match yibovibe_core::sync::transport::compute_merge_plan(&client, &packager).await {
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
                            if let Ok(new_ts) = yibovibe_core::sync::transport::execute_merge_plan(
                                &client,
                                &packager,
                                &plan,
                                std::collections::HashMap::new(),
                            )
                            .await
                            {
                                let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
                                cfg.sync_meta.global_updated_at = new_ts;
                                let _ = cfg.save();
                                yibovibe_core::config::AppConfig::reload();
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
                yibovibe_core::local_auth::save_session(username.clone());

                // Auto cache the local password for unified offline use
                let auto_salt = kdf_salt.clone();
                let auto_pwd = password.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(hash) =
                        yibovibe_core::crypto::hash_local_password(&auto_pwd, &auto_salt)
                    {
                        if let Ok(mut cfg) = yibovibe_core::config::GLOBAL_CONFIG.write() {
                            cfg.local_password_hash = hash;
                            cfg.local_kdf_salt = auto_salt;
                            cfg.save();
                        }
                    }
                })
                .await;

                // Attempt WS connection
                match WsClient::connect(&server_url, &access_token).await {
                    Ok((ws_client, ws_rx)) => {
                        info!("WS client created! Handshake sent implicitly.");

                        if let Err(e) = yibovibe_core::cache::init_cache_and_history() {
                            log::warn!("Failed to re-initialize cache after login: {}", e);
                        }

                        let arc_mk = Arc::new(mk);
                        let cb_monitor = ClipboardMonitor::new(
                            server_url.clone(),
                            access_token.clone(),
                            arc_mk,
                            ws_client.tx.clone(),
                            ui_tx,
                            device_name.clone(),
                        );
                        cb_monitor.start_monitoring();
                        // Create broker to split WS stream: clipboard + remote session commands
                        let (clipboard_tx, clipboard_rx) = tokio::sync::mpsc::channel(100);
                        let sm_for_broker = state.session_manager.clone();
                        spawn_ws_broker(
                            ws_rx,
                            clipboard_tx,
                            ws_client.tx.clone(),
                            sm_for_broker,
                            app.clone(),
                        );
                        cb_monitor.start_receiving(clipboard_rx);

                        {
                            let mut connected_flag = state.is_connected.lock().await;
                            *connected_flag = true;
                        }
                        {
                            let mut ws_tx = state.ws_tx.lock().await;
                            *ws_tx = Some(ws_client.tx.clone());
                        }
                        {
                            let mut runtime_server_url = state.runtime_server_url.lock().await;
                            *runtime_server_url = Some(server_url.clone());
                        }
                        {
                            let mut runtime_username = state.runtime_username.lock().await;
                            *runtime_username = Some(username.clone());
                        }
                        {
                            let mut runtime_device_name = state.runtime_device_name.lock().await;
                            *runtime_device_name = Some(device_name.clone());
                        }
                        {
                            let mut runtime_remote_device_id =
                                state.runtime_remote_device_id.lock().await;
                            *runtime_remote_device_id = Some(login_device_id);
                        }
                        {
                            let mut runtime_access_token = state.runtime_access_token.lock().await;
                            *runtime_access_token = Some(access_token.clone());
                        }
                        {
                            let mut runtime_role = state.runtime_role.lock().await;
                            *runtime_role = Some(login_role.clone());
                        }
                        sync_all_sessions_to_server_handle(&app).await;
                        return Ok(ConnectResult {
                            success: true,
                            role: login_role,
                        });
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
            let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
            (cfg.local_password_hash.clone(), cfg.local_kdf_salt.clone())
        };

        if !cached_hash.is_empty() && !cached_salt.is_empty() {
            let salt_for_hash = cached_salt.clone();
            let hash_check = tokio::task::spawn_blocking(move || {
                yibovibe_core::crypto::hash_local_password(&pwd, &salt_for_hash)
            })
            .await
            .unwrap_or(Err(yibovibe_core::crypto::CryptoError::InvalidData));

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

            if let Err(e) = yibovibe_core::cache::init_cache_and_history() {
                log::warn!("Failed to re-initialize cache after offline login: {}", e);
            }

            let arc_mk = Arc::new(mk);

            let cb_monitor = ClipboardMonitor::new(
                "offline".to_string(),
                "none".to_string(),
                arc_mk,
                dummy_ws_tx,
                ui_tx,
                device_name.clone(),
            );
            cb_monitor.start_monitoring();
            // In offline mode we don't start WsClient RX receiving since there's no server

            let mut connected_flag = state.is_connected.lock().await;
            *connected_flag = true;

            info!("Running in Pure Offline Mode! Snippets engine active.");
            return Ok(ConnectResult {
                success: true,
                role: "user ".to_string(),
            });
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
    auto_sync_text: bool,
    auto_sync_image: bool,
    flowhint_min_chars: usize,
    flowhint_accept_tab: bool,
    flowhint_accept_right: bool,
    debug_mode: bool,
    dictionary_order: Vec<String>,
    image_transport_format: String,
    flowprobe_backup_keys: bool,
}

#[derive(serde::Serialize)]
struct FlowSyncAutoSyncPayload {
    auto_sync_text: bool,
    auto_sync_image: bool,
}

#[tauri::command]
fn get_probe_config() -> Result<probe::ProbeConfigPayload, String> {
    probe::get_probe_config()
}

#[tauri::command]
async fn save_probe_config(payload: probe::ProbeConfigPayload) -> Result<(), String> {
    probe::save_probe_config(payload).await
}

#[tauri::command]
async fn test_probe_credential(
    credential: probe::ProbeCredentialPayload,
) -> Result<probe::ProbeResult, String> {
    probe::test_credential(credential).await
}

#[tauri::command]
async fn test_probe_route(
    kind: yibovibe_core::config::ProbeRouteKind,
) -> Result<probe::ProbeResult, String> {
    probe::test_route(kind).await
}

#[tauri::command]
async fn list_probe_credential_models(
    credential: probe::ProbeCredentialPayload,
) -> Result<Vec<String>, String> {
    probe::list_credential_models(credential).await
}

#[tauri::command]
async fn list_probe_route_models(
    kind: yibovibe_core::config::ProbeRouteKind,
) -> Result<Vec<String>, String> {
    probe::list_route_models(kind).await
}

#[tauri::command]
async fn start_probe_proxy() -> Result<probe::ProbeProxyStatusPayload, String> {
    probe::start_proxy().await
}

#[tauri::command]
async fn stop_probe_proxy() -> Result<probe::ProbeProxyStatusPayload, String> {
    probe::stop_proxy().await
}

#[tauri::command]
async fn get_probe_dashboard() -> Result<probe::ProbeDashboardPayload, String> {
    probe::probe_dashboard().await
}

#[tauri::command]
async fn clear_probe_logs() -> Result<(), String> {
    probe::clear_proxy_logs().await
}

#[tauri::command]
fn set_dictionary_order(order: Vec<String>) -> Result<(), String> {
    yibovibe_core::config::set_dictionary_order(order)
}

#[tauri::command]
fn get_settings() -> Result<SettingsPayload, String> {
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
fn get_flowsync_auto_sync_prefs() -> Result<FlowSyncAutoSyncPayload, String> {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
    Ok(FlowSyncAutoSyncPayload {
        auto_sync_text: cfg.auto_sync_text,
        auto_sync_image: cfg.auto_sync_image,
    })
}

#[tauri::command]
fn set_flowsync_auto_sync_prefs(
    app: tauri::AppHandle,
    auto_sync_text: bool,
    auto_sync_image: bool,
) -> Result<(), String> {
    yibovibe_core::config::set_flowsync_auto_sync_prefs(auto_sync_text, auto_sync_image)?;
    let _ = app.emit("config-updated ", ());
    Ok(())
}

#[tauri::command]
async fn create_flowsync_entry_from_path(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<serde_json::Value, String> {
    yibovibe_core::cache::init_cache_and_history()?;
    let created_at = current_unix_ms();
    let (id, record) = {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized ")?;
        let id = flow_store.create_local_path_entry(
            std::path::Path::new(&path),
            "manual_pick",
            created_at,
        )?;
        let record = flow_store
            .get_history_record_compat(id)?
            .ok_or("FlowSync entry was created but could not be reloaded")?;
        (id, record)
    };

    let sync_enabled = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.is_sync_enabled
    };
    if sync_enabled {
        let device_label = resolve_runtime_device_name(&state).await;
        let ws_tx = state.ws_tx.lock().await.clone();
        if let Some(tx) = ws_tx {
            yibovibe_core::clipboard::ClipboardMonitor::send_flow_entry_offer(
                &record,
                &tx,
                &device_label,
            )
            .await;
        }
    }
    Ok(serde_json::json!({ "id": id }))
}

#[tauri::command]
fn get_flowsync_entry_transfer_state(
    entry_id: i64,
) -> Result<Option<yibovibe_core::flow_store::FlowEntryTransferState>, String> {
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    let flow_store = flow_store_lock
        .as_ref()
        .ok_or("FlowSync store not initialized ")?;
    flow_store.get_entry_transfer_state(entry_id)
}

#[tauri::command]
async fn list_flowsync_online_devices(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ClusterDevice>, String> {
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("FlowSync is not connected to a remote server")?;
    let access_token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("FlowSync access token is unavailable")?;
    let local_device_id = *state.runtime_remote_device_id.lock().await;

    let client = ApiClient::new(server_url);
    let devices = client
        .get_devices(&access_token)
        .await
        .map_err(|e| e.to_string())?;
    Ok(devices
        .into_iter()
        .map(|device| ClusterDevice {
            id: device.id.to_string(),
            name: device.name,
            is_online: device.is_online,
            is_local: Some(device.id) == local_device_id,
            device_type: device.r#type,
        })
        .collect())
}

#[tauri::command]
async fn download_flowsync_entry(
    state: tauri::State<'_, AppState>,
    entry_id: i64,
) -> Result<serde_json::Value, String> {
    let (record, transfer_state) = {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized ")?;
        let record = flow_store
            .get_history_record_compat(entry_id)?
            .ok_or(format!("FlowSync entry {} not found ", entry_id))?;
        let transfer_state = flow_store
            .get_entry_transfer_state(entry_id)?
            .ok_or(format!(
                "FlowSync transfer state for entry {} not found ",
                entry_id
            ))?;
        (record, transfer_state)
    };

    if !matches!(record.entry.entry_type.as_str(), "file " | "bundle") {
        return Err("Only file or folder entries support on-demand download".to_string());
    }
    if transfer_state.has_local_content {
        return Ok(serde_json::json!({ "transfer_id": null, "status": "completed" }));
    }

    if let Ok((server_url, access_token)) = require_runtime_server_auth(&state).await {
        let client = ApiClient::new(server_url);
        if let Some(stage) = client
            .lookup_flowsync_staged_object(
                &access_token,
                &record.entry.entry_type,
                &record.entry.hash,
            )
            .await?
        {
            let transfer_id = uuid::Uuid::new_v4().to_string();
            let device_label = resolve_runtime_device_name(&state).await;
            {
                let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
                    .read()
                    .unwrap();
                let flow_store = flow_store_lock
                    .as_ref()
                    .ok_or("FlowSync store not initialized ")?;
                flow_store.upsert_transfer_session(
                    entry_id,
                    &transfer_id,
                    "inbound",
                    "transferring",
                    Some("NAS 暂存"),
                    Some(&device_label),
                    record.entry.size,
                    0,
                    current_unix_ms(),
                )?;
            }

            let bytes = client
                .download_flowsync_staged_object(&access_token, &stage.id)
                .await?;
            let (final_path, manifest_json) = {
                let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
                    .read()
                    .unwrap();
                let flow_store = flow_store_lock
                    .as_ref()
                    .ok_or("FlowSync store not initialized ")?;
                let download_root = flow_store.root_dir().join("downloads");
                std::fs::create_dir_all(&download_root)
                    .map_err(|e| format!("Failed to create FlowSync downloads dir: {}", e))?;
                let title = if stage.title.trim().is_empty() {
                    record
                        .title
                        .clone()
                        .unwrap_or_else(|| "flowsync-object ".to_string())
                } else {
                    stage.title.clone()
                };
                if record.entry.entry_type == "bundle" {
                    let archive_path = unique_path(
                        &download_root,
                        &format!("{}.zip ", sanitize_stage_name(&title)),
                    );
                    std::fs::write(&archive_path, &bytes)
                        .map_err(|e| format!("Failed to write staged bundle archive: {}", e))?;
                    let extract_dir = unique_path(&download_root, &sanitize_stage_name(&title));
                    yibovibe_core::p2p::extract_bundle_archive(&archive_path, &extract_dir)?;
                    let manifest = yibovibe_core::flow_store::build_bundle_manifest(&extract_dir)?;
                    let manifest_json = serde_json::to_string_pretty(&manifest)
                        .map_err(|e| format!("Failed to encode staged bundle manifest: {}", e))?;
                    let verified_hash = blake3::hash(manifest_json.as_bytes()).to_hex().to_string();
                    if verified_hash != record.entry.hash {
                        return Err("Downloaded NAS bundle hash verification failed ".to_string());
                    }
                    let _ = std::fs::remove_file(&archive_path);
                    (extract_dir, Some(manifest_json))
                } else {
                    let file_name = sanitize_stage_name(&title);
                    let final_path = unique_path(&download_root, &file_name);
                    std::fs::write(&final_path, &bytes)
                        .map_err(|e| format!("Failed to write staged file: {}", e))?;
                    let verified_hash =
                        yibovibe_core::flow_store::compute_file_blake3(&final_path)?;
                    if verified_hash != record.entry.hash {
                        return Err("Downloaded NAS file hash verification failed ".to_string());
                    }
                    (final_path, None)
                }
            };

            {
                let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
                    .read()
                    .unwrap();
                let flow_store = flow_store_lock
                    .as_ref()
                    .ok_or("FlowSync store not initialized ")?;
                flow_store.finalize_downloaded_entry(
                    entry_id,
                    &final_path,
                    manifest_json.as_deref(),
                    &transfer_id,
                    current_unix_ms(),
                )?;
            }

            return Ok(serde_json::json!({
                "transfer_id": transfer_id,
                "status": "completed",
                "source": "nas_staged",
                "stage_object_id": stage.id,
            }));
        }
    }

    let source_device_id = transfer_state
        .source_device_id
        .as_deref()
        .ok_or("This FlowSync entry does not know which device owns the content ")?
        .parse::<u32>()
        .map_err(|_| "Invalid source device id for FlowSync entry ".to_string())?;
    if source_device_id == 0 {
        return Err("FlowSync entry source device id is invalid ".to_string());
    }

    let transfer_id = uuid::Uuid::new_v4().to_string();
    let device_label = resolve_runtime_device_name(&state).await;
    {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized ")?;
        flow_store.upsert_transfer_session(
            entry_id,
            &transfer_id,
            "inbound",
            "accepted",
            transfer_state.source_device_name.as_deref(),
            Some(&device_label),
            record.entry.size,
            0,
            current_unix_ms(),
        )?;
    }

    let tx = state
        .ws_tx
        .lock()
        .await
        .clone()
        .ok_or("FlowSync websocket is not connected ")?;
    tx.send(yibovibe_core::ws::WsMessage {
        sender_uid: 0,
        sender_device_id: 0,
        target_devices: vec![source_device_id],
        r#type: "flow_entry_accept".to_string(),
        payload: serde_json::json!({
            "transfer_id": transfer_id,
            "kind": record.entry.entry_type,
            "root_hash": record.entry.hash,
            "title": record.title,
            "requester_device_name ": device_label,
        }),
    })
    .await
    .map_err(|e| format!("Failed to request FlowSync download: {}", e))?;

    Ok(serde_json::json!({ "transfer_id": transfer_id, "status": "accepted" }))
}

#[tauri::command]
async fn push_flowsync_entry_to_device(
    state: tauri::State<'_, AppState>,
    entry_id: i64,
    target_device: u32,
    target_device_name: String,
) -> Result<serde_json::Value, String> {
    let record = {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized ")?;
        let record = flow_store
            .get_history_record_compat(entry_id)?
            .ok_or(format!("FlowSync entry {} not found ", entry_id))?;
        if !matches!(record.entry.entry_type.as_str(), "file " | "bundle") {
            return Err("Only file or folder entries support device push ".to_string());
        }
        if record.local_storage_path.is_none() {
            return Err("This FlowSync entry has no local content to push ".to_string());
        }
        record
    };

    let transfer_id = uuid::Uuid::new_v4().to_string();
    let device_label = resolve_runtime_device_name(&state).await;
    {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized ")?;
        flow_store.upsert_transfer_session(
            entry_id,
            &transfer_id,
            "outbound",
            "offered",
            Some(&device_label),
            Some(&target_device_name),
            record.entry.size,
            0,
            current_unix_ms(),
        )?;
    }

    let tx = state
        .ws_tx
        .lock()
        .await
        .clone()
        .ok_or("FlowSync websocket is not connected ")?;
    yibovibe_core::clipboard::ClipboardMonitor::send_flow_entry_offer_to(
        &record,
        &tx,
        &device_label,
        vec![target_device],
        true,
    )
    .await;

    Ok(serde_json::json!({ "transfer_id": transfer_id, "status": "offered" }))
}

#[tauri::command]
async fn upload_flowsync_entry_to_nas(
    state: tauri::State<'_, AppState>,
    entry_id: i64,
    ttl_seconds: Option<i32>,
) -> Result<serde_json::Value, String> {
    let (record, local_path) = {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized ")?;
        let record = flow_store
            .get_history_record_compat(entry_id)?
            .ok_or(format!("FlowSync entry {} not found ", entry_id))?;
        if !matches!(record.entry.entry_type.as_str(), "file " | "bundle") {
            return Err("Only file or folder entries support NAS staging ".to_string());
        }
        let local_path = record
            .local_storage_path
            .clone()
            .ok_or("This FlowSync entry has no local content to stage ")?;
        (record, PathBuf::from(local_path))
    };

    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);

    let (send_path, cleanup_path) = if record.entry.entry_type == "bundle" {
        let archive_path =
            std::env::temp_dir().join(format!("yiboflow-stage-{}.zip ", uuid::Uuid::new_v4()));
        yibovibe_core::p2p::package_bundle_archive(&local_path, &archive_path)?;
        (archive_path.clone(), Some(archive_path))
    } else {
        (local_path.clone(), None)
    };

    let size_bytes = std::fs::metadata(&send_path)
        .map_err(|e| {
            format!(
                "Failed to stat staging payload {}: {}",
                send_path.display(),
                e
            )
        })?
        .len() as i64;
    let chunk_count = ((size_bytes.max(1) as usize + FLOWSYNC_STAGE_CHUNK_BYTES - 1)
        / FLOWSYNC_STAGE_CHUNK_BYTES) as i32;
    let title = record.title.clone().unwrap_or_else(|| {
        local_path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("flowsync-object ")
            .to_string()
    });
    let manifest_json = record.manifest_json.clone().unwrap_or_default();
    let stage = client
        .create_flowsync_staged_object(
            &access_token,
            &yibovibe_core::api::FlowSyncCreateStageRequest {
                kind: record.entry.entry_type.clone(),
                root_hash: record.entry.hash.clone(),
                title,
                manifest_json,
                size_bytes,
                chunk_count,
                ttl_seconds: ttl_seconds.unwrap_or(0),
            },
        )
        .await?;

    let payload = std::fs::read(&send_path).map_err(|e| {
        format!(
            "Failed to read staging payload {}: {}",
            send_path.display(),
            e
        )
    })?;
    for (idx, chunk) in payload.chunks(FLOWSYNC_STAGE_CHUNK_BYTES).enumerate() {
        client
            .upload_flowsync_staged_chunk(&access_token, &stage.id, idx as i32, chunk.to_vec())
            .await?;
    }
    let completed = client
        .complete_flowsync_staged_object(&access_token, &stage.id)
        .await?;
    if let Some(path) = cleanup_path {
        let _ = std::fs::remove_file(path);
    }

    {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized ")?;
        flow_store.mark_entry_nas_staged(
            entry_id,
            &completed.id,
            stage_expire_at_ms(completed.ttl_seconds),
            current_unix_ms(),
        )?;
    }

    Ok(serde_json::json!({
        "stage_object_id": completed.id,
        "availability": "nas_staged",
        "ttl_seconds": completed.ttl_seconds,
    }))
}

#[tauri::command]
async fn list_my_flowsync_staged_objects(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<yibovibe_core::api::FlowSyncStagedObjectInfo>, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.list_flowsync_staged_objects(&access_token).await
}

#[tauri::command]
async fn delete_my_flowsync_staged_object(
    state: tauri::State<'_, AppState>,
    stage_object_id: String,
) -> Result<(), String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client
        .delete_flowsync_staged_object(&access_token, &stage_object_id)
        .await?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    let flow_store = flow_store_lock
        .as_ref()
        .ok_or("FlowSync store not initialized ")?;
    flow_store.clear_stage_object(&stage_object_id, current_unix_ms())?;
    Ok(())
}

#[tauri::command]
async fn list_my_flowsync_share_links(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<yibovibe_core::api::FlowSyncShareLinkInfo>, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.list_flowsync_share_links(&access_token).await
}

#[tauri::command]
async fn create_flowsync_share_link(
    state: tauri::State<'_, AppState>,
    stage_object_id: String,
    ttl_seconds: i32,
    max_downloads: i32,
) -> Result<yibovibe_core::api::FlowSyncShareLinkInfo, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client
        .create_flowsync_share_link(
            &access_token,
            &yibovibe_core::api::FlowSyncCreateShareLinkRequest {
                stage_object_id,
                ttl_seconds,
                max_downloads,
            },
        )
        .await
}

#[tauri::command]
async fn disable_my_flowsync_share_link(
    state: tauri::State<'_, AppState>,
    share_link_id: u32,
) -> Result<yibovibe_core::api::FlowSyncShareLinkInfo, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client
        .disable_flowsync_share_link(&access_token, share_link_id)
        .await
}

#[tauri::command]
async fn get_flowsync_staging_preferences(
    state: tauri::State<'_, AppState>,
) -> Result<yibovibe_core::api::FlowSyncStagingPreference, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.get_flowsync_staging_preferences(&access_token).await
}

#[tauri::command]
async fn set_flowsync_staging_preferences(
    state: tauri::State<'_, AppState>,
    default_ttl_seconds: i32,
) -> Result<yibovibe_core::api::FlowSyncStagingPreference, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client
        .update_flowsync_staging_preferences(&access_token, default_ttl_seconds)
        .await
}

#[tauri::command]
async fn admin_get_flowsync_staging_policy(
    state: tauri::State<'_, AppState>,
) -> Result<yibovibe_core::api::FlowSyncStagingPolicy, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.get_flowsync_staging_policy(&access_token).await
}

#[tauri::command]
async fn admin_update_flowsync_staging_policy(
    state: tauri::State<'_, AppState>,
    policy: yibovibe_core::api::FlowSyncStagingPolicy,
) -> Result<yibovibe_core::api::FlowSyncStagingPolicy, String> {
    let (server_url, access_token) = require_runtime_server_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client
        .update_flowsync_staging_policy(&access_token, &policy)
        .await
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
    refresh_hint_window_cfg();
    let _ = app.emit("config-updated ", ());
    Ok(())
}

#[tauri::command]
fn get_app_config() -> Result<yibovibe_core::config::AppConfig, String> {
    Ok(yibovibe_core::config::GLOBAL_CONFIG.read().unwrap().clone())
}

#[tauri::command]
async fn change_local_password(new_password: String) -> Result<(), String> {
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
            info!("Local offline password updated successfully ");
            Ok(())
        }
        Err(e) => Err(format!("Hashing failed: {}", e)),
    }
}

#[tauri::command]
fn rename_local_account(old_username: String, new_username: String) -> Result<bool, String> {
    yibovibe_core::local_auth::rename_local_user(&old_username, &new_username)
}

#[tauri::command]
async fn force_override_remote(_server_url: String, _username: String) -> Result<bool, String> {
    // Phase 3 Stub: Server-side API needs to support force-override parameter for register.
    Err("API Server does not yet support force-overriding an existing remote account. Please use the Local Offline Mode instead.".to_string())
}

#[tauri::command]
async fn manual_vault_compaction(
    _server_url: String,
    username: String,
    _password: String,
) -> Result<bool, String> {
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
async fn resolve_sync_conflict(
    state: tauri::State<'_, AppState>,
    action: String,
    server_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    info!("Resolving sync conflict with action: {}", action);

    // 1. We must login again to grab tokens and salt for key derivation
    let config_fingerprint = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);
    let runtime_device_name = resolve_runtime_device_name(&state).await;

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: runtime_device_name,
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client
        .login(login_payload)
        .await
        .map_err(|e| e.to_string())?;

    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!(
            "Login failed during sync resolve: {}",
            login_result.msg
        ));
    }
    let d = login_result.data.as_ref().unwrap();
    let resp_kdf_salt = d
        .get("kdf_salt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let vk_pwd = password.clone();
    let vk_salt = resp_kdf_salt.clone();
    let vault_key = tokio::task::spawn_blocking(move || {
        yibovibe_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Sandbox root is currently fixed, but in real architecture it will dynamically include the username
    let sandbox_root = yibovibe_core::backup::get_data_dir()
        .join("users")
        .join(&username);

    if action == "pull_remote" {
        // Vault Pull Phase
        yibovibe_core::sync::transport::pull_and_replay_vault(&client, &vault_key, &sandbox_root)
            .await?;

        // Let's force load new Config into RAM
        yibovibe_core::config::AppConfig::reload();
    } else if action == "push_local" {
        // Vault Push Phase
        let packager = yibovibe_core::sync::packager::VaultPackager::new(vault_key, sandbox_root);
        let new_ts = yibovibe_core::sync::transport::push_full_vault(&client, &packager).await?;

        {
            let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
            cfg.sync_meta.global_updated_at = new_ts;
            let _ = cfg.save();
        }
    }

    Ok(true)
}

#[tauri::command]
async fn resolve_file_conflicts(
    state: tauri::State<'_, AppState>,
    resolutions: std::collections::HashMap<String, String>,
    server_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    info!(
        "Resolving file-level sync conflicts for {} files ",
        resolutions.len()
    );

    let config_fingerprint = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);
    let runtime_device_name = resolve_runtime_device_name(&state).await;

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: runtime_device_name,
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client
        .login(login_payload)
        .await
        .map_err(|e| e.to_string())?;

    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!(
            "Login failed during sync resolve: {}",
            login_result.msg
        ));
    }
    let d = login_result.data.as_ref().unwrap();
    let resp_kdf_salt = d
        .get("kdf_salt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let vk_pwd = password.clone();
    let vk_salt = resp_kdf_salt;
    let vault_key = tokio::task::spawn_blocking(move || {
        yibovibe_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
    })
    .await
    .map_err(|e| e.to_string())??;

    let sandbox_root = yibovibe_core::backup::get_data_dir()
        .join("users")
        .join(&username);
    let packager = yibovibe_core::sync::packager::VaultPackager::new(vault_key, sandbox_root);

    let plan = yibovibe_core::sync::transport::compute_merge_plan(&client, &packager).await?;

    let new_ts =
        yibovibe_core::sync::transport::execute_merge_plan(&client, &packager, &plan, resolutions)
            .await?;

    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
    cfg.sync_meta.global_updated_at = new_ts;
    let _ = cfg.save();
    yibovibe_core::config::AppConfig::reload();

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
async fn get_vault_sync_status(
    state: tauri::State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
) -> Result<VaultSyncStatus, String> {
    let local_updated_at = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.sync_meta.global_updated_at
    };

    if server_url.is_empty() || server_url == "local" || username.is_empty() {
        return Ok(VaultSyncStatus {
            server_url: "Local Only ".to_string(),
            username: "Offline".to_string(),
            local_updated_at,
            remote_updated_at: None,
            remote_manifest_size: 0,
            status_msg: "未连接至远程 Vault 云端".to_string(),
        });
    }

    let config_fingerprint = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);
    let runtime_device_name = resolve_runtime_device_name(&state).await;

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: runtime_device_name,
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client
        .login(login_payload)
        .await
        .map_err(|e| format!("Network Connection Error: {}", e))?;
    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!("Auth Failed: {}", login_result.msg));
    }
    let d = login_result.data.as_ref().unwrap();
    let resp_kdf_salt = d
        .get("kdf_salt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let vk_pwd = password.clone();
    let vk_salt = resp_kdf_salt;
    let vault_key = tokio::task::spawn_blocking(move || {
        yibovibe_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
    })
    .await
    .map_err(|e| e.to_string())??;

    let remote_manifest =
        yibovibe_core::sync::transport::fetch_remote_manifest(&client, &vault_key)
            .await
            .map_err(|e| e.to_string())?;

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
async fn get_cluster_devices(
    state: tauri::State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
) -> Result<Vec<ClusterDevice>, String> {
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
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = resolve_runtime_device_fingerprint(&config_fingerprint);
    let runtime_device_name = resolve_runtime_device_name(&state).await;

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: runtime_device_name,
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let login_result = client
        .login(login_payload)
        .await
        .map_err(|e| format!("Network Connection Error: {}", e))?;
    if login_result.code != 200 || login_result.data.is_none() {
        return Err(format!("Auth Failed: {}", login_result.msg));
    }
    let d = login_result.data.as_ref().unwrap();
    let access_token = d
        .get("access_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let resp_device_id = d.get("device_id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

    // Query /api/v1/sync/devices
    let devices_res = client
        .get_devices(&access_token)
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for dev in devices_res {
        let is_local = dev.id == resp_device_id;

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
    default: yibovibe_core::rules::DefaultRules,
    app_overrides: Vec<yibovibe_core::rules::AppRule>,
}

#[tauri::command]
fn get_flow_rules() -> Result<FlowRulesPayload, String> {
    let cfg = yibovibe_core::rules::get_rules();
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
    yibovibe_core::rules::set_default_rules(yibovibe_core::rules::DefaultRules {
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
    yibovibe_core::rules::upsert_app_rule(yibovibe_core::rules::AppRule {
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
    yibovibe_core::rules::remove_app_rule(process)
}

#[tauri::command]
fn toggle_app_feature(process: String, feature: String) -> Result<(), String> {
    let f = parse_feature(&feature)?;
    yibovibe_core::rules::toggle_app_feature(process, f)
}

#[tauri::command]
fn toggle_default_feature(feature: String) -> Result<(), String> {
    let f = parse_feature(&feature)?;
    yibovibe_core::rules::toggle_default_feature(f)
}

fn parse_feature(s: &str) -> Result<yibovibe_core::rules::Feature, String> {
    match s.to_lowercase().as_str() {
        "flowsnap" => Ok(yibovibe_core::rules::Feature::FlowSnap),
        "flowhint" => Ok(yibovibe_core::rules::Feature::FlowHint),
        "flowsync" => Ok(yibovibe_core::rules::Feature::FlowSync),
        "flowkeys" => Ok(yibovibe_core::rules::Feature::FlowKeys),
        _ => Err(format!("Unknown feature: {}", s)),
    }
}

// ---------------------------------------------------------------------------
// Backup & Restore
// ---------------------------------------------------------------------------

#[tauri::command]
fn export_config(dest_path: String) -> Result<(), String> {
    info!("Tauri Command: export_config to {}", dest_path);
    yibovibe_core::backup::export_config(&dest_path)
}

#[tauri::command]
fn import_config(src_path: String) -> Result<(), String> {
    info!("Tauri Command: import_config from {}", src_path);
    yibovibe_core::backup::import_config(&src_path)
}

#[tauri::command]
fn get_all_dictionaries() -> Result<Vec<yibovibe_core::dictionary::SmartDictionary>, String> {
    Ok(yibovibe_core::dictionary::get_all_dictionaries())
}

#[tauri::command]
fn save_dictionary(dict: yibovibe_core::dictionary::SmartDictionary) -> Result<(), String> {
    info!("Tauri Command: save_dictionary {}", dict.id);
    yibovibe_core::dictionary::save_dictionary(dict)?;
    yibovibe_core::smart_router::invalidate_snap_cache();
    Ok(())
}

#[tauri::command]
fn delete_dictionary(id: String) -> Result<(), String> {
    info!("Tauri Command: delete_dictionary {}", id);
    yibovibe_core::dictionary::delete_dictionary(&id)?;
    yibovibe_core::smart_router::invalidate_snap_cache();
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
    Err("Could not find window under cursor ".into())
}

#[tauri::command]
async fn start_app_picker(
    app: tauri::AppHandle,
    _window: tauri::WebviewWindow,
) -> Result<(), String> {
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        use std::thread::sleep;
        use std::time::Duration;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

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
                    let _ = app_handle.emit("app-picked ", Some(exe));
                }
                break;
            }
            if is_esc {
                let _ = app_handle.emit("app-picked ", None::<String>);
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
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(text) = cb.get_text() {
                if !text.is_empty() {
                    return Ok(serde_json::json!({
                        "type": "text",
                        "content ": text,
                    }));
                }
            }
        }

        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(img) = cb.get_image() {
                let width = img.width as u32;
                let height = img.height as u32;
                if let Some(img_buffer) =
                    image::RgbaImage::from_raw(width, height, img.bytes.into_owned())
                {
                    let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
                    let mut buf = std::io::Cursor::new(Vec::new());
                    if dyn_img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                        let encoded = STANDARD.encode(buf.into_inner());
                        return Ok(serde_json::json!({
                            "type": "image ",
                            "content ": format!("data:image/png;base64,{}", encoded),
                            "width": width,
                            "height": height,
                        }));
                    }
                }
            }
        }

        Ok(serde_json::json!({ "type": "empty " }))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn write_to_clipboard(content: String) -> Result<(), String> {
    // Update text cache to prevent clipboard monitor from re-dispatching
    {
        if let Ok(mut last) = yibovibe_core::clipboard::LAST_TEXT.lock() {
            *last = content.clone();
        }
    }

    tokio::task::spawn_blocking(move || {
        for attempt in 0..10 {
            match arboard::Clipboard::new() {
                Ok(mut cb) => match cb.set_text(&content) {
                    Ok(()) => return Ok(()),
                    Err(e) if attempt < 9 => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        continue;
                    }
                    Err(e) => return Err(format!("Clipboard write failed: {}", e)),
                },
                Err(e) if attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(format!("Clipboard open failed: {}", e)),
            }
        }
        Err("Clipboard write failed after retries ".into())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn write_image_to_clipboard(image_base64: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        let data_uri = image_base64.trim();
        let b64_str = if data_uri.starts_with("data:image/") {
            data_uri.split(",").nth(1).unwrap_or("")
        } else {
            data_uri
        };

        let bytes = STANDARD
            .decode(b64_str)
            .map_err(|e| format!("Base64 decode failed: {}", e))?;
        let img =
            image::load_from_memory(&bytes).map_err(|e| format!("Image parse failed: {}", e))?;
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
                raw_bytes[raw_bytes.len() - sample_len..].hash(&mut hasher);
            } else {
                raw_bytes.hash(&mut hasher);
            }
            let hash = hasher.finish();
            if let Ok(mut last) = yibovibe_core::clipboard::LAST_IMAGE_HASH.lock() {
                *last = hash;
            }
        }

        for attempt in 0..10 {
            match arboard::Clipboard::new() {
                Ok(mut cb) => match cb.set_image(img_data.clone()) {
                    Ok(()) => return Ok(()),
                    Err(e) if attempt < 9 => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        continue;
                    }
                    Err(e) => return Err(format!("Clipboard write failed: {}", e)),
                },
                Err(e) if attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(format!("Clipboard open failed: {}", e)),
            }
        }
        Err("Clipboard write failed after retries ".into())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn get_flowsync_runtime_state() -> Result<FlowSyncRuntimeState, String> {
    Ok(FlowSyncRuntimeState {
        receive_only_mode: yibovibe_core::clipboard::is_receive_only_mode(),
    })
}

#[tauri::command]
fn set_flowsync_receive_only_mode(enabled: bool) -> Result<bool, String> {
    yibovibe_core::clipboard::set_receive_only_mode(enabled);
    Ok(enabled)
}

#[tauri::command]
fn get_desktop_build_label() -> Result<DesktopBuildLabel, String> {
    Ok(DesktopBuildLabel {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build_id: env!("YIBOVIBE_BUILD_ID").to_string(),
    })
}

#[tauri::command]
async fn get_flowsync_diagnostics(
    state: tauri::State<'_, AppState>,
) -> Result<FlowSyncDiagnostics, String> {
    let build_id = env!("YIBOVIBE_BUILD_ID").to_string();
    let build_git_commit = env!("YIBOVIBE_BUILD_GIT_COMMIT").to_string();
    let build_git_dirty = env!("YIBOVIBE_BUILD_GIT_DIRTY") == "1";
    let build_unix_ts = env!("YIBOVIBE_BUILD_UNIX_TS").to_string();
    let build_profile = env!("YIBOVIBE_BUILD_PROFILE").to_string();
    let build_target_dir = env!("YIBOVIBE_BUILD_TARGET_DIR").to_string();
    let exe_path = std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "<unknown>".to_string());
    let global_dir = yibovibe_core::local_auth::get_yibovibe_global_dir()
        .display()
        .to_string();
    let active_user_dir = yibovibe_core::local_auth::get_active_user_dir()
        .display()
        .to_string();
    let active_user = yibovibe_core::local_auth::ACTIVE_USER
        .read()
        .unwrap()
        .clone();
    let is_connected = *state.is_connected.lock().await;
    let receive_only_mode = yibovibe_core::clipboard::is_receive_only_mode();
    let server_url = state.runtime_server_url.lock().await.clone();
    let username = state.runtime_username.lock().await.clone();
    let device_name = state.runtime_device_name.lock().await.clone();
    let remote_device_id = *state.runtime_remote_device_id.lock().await;

    let config_fingerprint = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
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
    let (activity_total_entries, activity_sample_query_count, activity_query_error) = {
        let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
            .read()
            .unwrap();
        if let Some(flow_store) = flow_store_lock.as_ref() {
            let total_entries = flow_store.history_stats_compat().map(|(total, _, _)| total);
            let sample_count = flow_store
                .query_history_compat(None, None, None, None, 5, 0)
                .map(|entries| entries.len());
            match (total_entries, sample_count) {
                (Ok(total), Ok(sample)) => (Some(total), Some(sample), None),
                (Err(err), _) => (None, None, Some(err)),
                (_, Err(err)) => (None, None, Some(err)),
            }
        } else {
            (
                None,
                None,
                Some("FlowSync store not initialized ".to_string()),
            )
        }
    };

    Ok(FlowSyncDiagnostics {
        build_id,
        build_git_commit,
        build_git_dirty,
        build_unix_ts,
        build_profile,
        build_target_dir,
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
        activity_total_entries,
        activity_sample_query_count,
        activity_query_error,
    })
}

// ─── Clipboard History Tauri Commands ───

fn current_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn ensure_history_runtime_ready() -> Result<(), String> {
    let flow_store_ready = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap()
        .is_some();
    let history_ready = yibovibe_core::cache::HISTORY_MANAGER
        .read()
        .unwrap()
        .is_some();
    if flow_store_ready || history_ready {
        return Ok(());
    }
    yibovibe_core::cache::init_cache_and_history()
}

fn format_size_bytes(size_bytes: i64) -> String {
    let size = size_bytes.max(0) as f64;
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    if size >= GB {
        format!("{:.2} GB ", size / GB)
    } else if size >= MB {
        format!("{:.2} MB ", size / MB)
    } else if size >= KB {
        format!("{:.2} KB ", size / KB)
    } else {
        format!("{} B ", size as i64)
    }
}

fn build_flow_object_preview(
    record: &yibovibe_core::flow_store::FlowHistoryEntryRecord,
) -> Result<serde_json::Value, String> {
    match record.entry.entry_type.as_str() {
        "text" => {
            let local_storage_path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let content = std::fs::read_to_string(&local_storage_path)
                .map_err(|e| format!("Failed to read text content: {}", e))?;
            Ok(serde_json::json!({
                "type": "text",
                "content ": content,
            }))
        }
        "image " => {
            let local_storage_path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let data = std::fs::read(&local_storage_path)
                .map_err(|e| format!("Failed to read image content: {}", e))?;
            if data.len() < 16 {
                return Err("Invalid image cache data ".into());
            }
            let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as u32;
            let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as u32;
            let img_bytes = &data[16..];

            use base64::{engine::general_purpose::STANDARD, Engine as _};
            if let Some(img_buffer) = image::RgbaImage::from_raw(w, h, img_bytes.to_vec()) {
                let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
                let mut buf = std::io::Cursor::new(Vec::new());
                if dyn_img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                    let encoded = STANDARD.encode(buf.into_inner());
                    return Ok(serde_json::json!({
                        "type": "image ",
                        "content ": format!("data:image/png;base64,{}", encoded),
                        "width": w,
                        "height": h,
                    }));
                }
            }
            Err("Failed to decode image ".into())
        }
        "file " => {
            let path_display = record.local_storage_path.clone().unwrap_or_default();
            let title = record
                .title
                .clone()
                .or_else(|| {
                    std::path::Path::new(&path_display)
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| "未命名文件".to_string());
            let content = format!(
                "文件名：{}\n大小：{}\nRoot Hash：{}\n来源：{}\n本地路径：{}",
                title,
                format_size_bytes(record.entry.size),
                record.entry.hash,
                record.entry.source,
                if path_display.is_empty() {
                    "<missing>"
                } else {
                    &path_display
                },
            );
            Ok(serde_json::json!({
                "type": "file ",
                "content ": content,
            }))
        }
        "bundle" => {
            let path_display = record.local_storage_path.clone().unwrap_or_default();
            let title = record
                .title
                .clone()
                .unwrap_or_else(|| "未命名文件夹".to_string());
            let mut lines = vec![
                format!("文件夹：{}", title),
                format!("大小：{}", format_size_bytes(record.entry.size)),
                format!("Root Hash：{}", record.entry.hash),
                format!("来源：{}", record.entry.source),
                format!(
                    "本地路径：{}",
                    if path_display.is_empty() {
                        "<missing>"
                    } else {
                        &path_display
                    }
                ),
            ];

            if let Some(manifest_json) = record.manifest_json.as_deref() {
                if let Ok(manifest) = serde_json::from_str::<
                    yibovibe_core::flow_store::FlowBundleManifest,
                >(manifest_json)
                {
                    lines.push(format!(
                        "条目：{} 项（文件 {} / 目录 {}）",
                        manifest.item_count, manifest.file_count, manifest.dir_count,
                    ));
                    lines.push(String::new());
                    lines.push("目录树预览：".to_string());
                    for entry in manifest.entries.iter().take(20) {
                        let prefix = if entry.kind == "dir " {
                            "[目录]"
                        } else {
                            "[文件]"
                        };
                        lines.push(format!("{} {}", prefix, entry.relative_path));
                    }
                    if manifest.entries.len() > 20 {
                        lines.push(format!("... 其余 {} 项已省略", manifest.entries.len() - 20));
                    }
                }
            }

            Ok(serde_json::json!({
                "type": "bundle",
                "content ": lines.join("\n"),
            }))
        }
        other => Err(format!("Unsupported FlowSync preview type: {}", other)),
    }
}

#[tauri::command]
fn init_clipboard_history() -> Result<bool, String> {
    ensure_history_runtime_ready()?;
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
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let entries = flow_store.query_history_compat(
            type_filter.as_deref(),
            time_from,
            time_to,
            source_filter.as_deref(),
            limit.unwrap_or(200),
            offset.unwrap_or(0),
        )?;
        return Ok(entries
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect());
    }

    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    let entries = history.query(
        type_filter.as_deref(),
        time_from,
        time_to,
        source_filter.as_deref(),
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )?;
    Ok(entries
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .collect())
}

#[tauri::command]
fn search_history(query: String, limit: Option<u32>) -> Result<Vec<serde_json::Value>, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let entries = flow_store.search_history_compat(&query, limit.unwrap_or(50))?;
        return Ok(entries
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect());
    }

    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    let entries = history.search(&query, limit.unwrap_or(50))?;
    Ok(entries
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .collect())
}

#[tauri::command]
fn copy_history_to_clipboard(id: i64) -> Result<(), String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let record = flow_store
            .get_history_record_compat(id)?
            .ok_or(format!("Entry {} not found ", id))?;
        if record.entry.entry_type == "text" {
            let local_storage_path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let content = std::fs::read_to_string(&local_storage_path)
                .map_err(|e| format!("Failed to read text content: {}", e))?;
            *yibovibe_core::clipboard::LAST_TEXT.lock().unwrap() = content.clone();
            if let Ok(mut cb) = arboard::Clipboard::new() {
                cb.set_text(content.clone()).map_err(|e| e.to_string())?;
            }
        } else if record.entry.entry_type == "image " {
            let local_storage_path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let data = std::fs::read(&local_storage_path)
                .map_err(|e| format!("Failed to read image content: {}", e))?;
            if data.len() < 16 {
                return Err("Invalid image cache data ".into());
            }
            let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
            let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as usize;
            let img_bytes = data[16..].to_vec();
            {
                let mut last_hash = yibovibe_core::clipboard::LAST_IMAGE_HASH.lock().unwrap();
                let mut hasher = DefaultHasher::new();
                img_bytes.hash(&mut hasher);
                *last_hash = hasher.finish();
            }
            if let Ok(mut cb) = arboard::Clipboard::new() {
                cb.set_image(arboard::ImageData {
                    width: w,
                    height: h,
                    bytes: std::borrow::Cow::Owned(img_bytes),
                })
                .map_err(|e| e.to_string())?;
            }
        } else {
            return Err("文件或文件夹条目暂不支持回写到系统剪贴板".to_string());
        }
        let now = current_unix_ms();
        flow_store.touch_history_compat(id, now)?;
        return Ok(());
    }

    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;

    let entry = history
        .get_by_id(id)?
        .ok_or(format!("Entry {} not found ", id))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    if entry.entry_type == "text" {
        let content = cache.read_text(&entry.hash)?;
        {
            if let Ok(mut last) = yibovibe_core::clipboard::LAST_TEXT.lock() {
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
    } else if entry.entry_type == "image " {
        let data = cache.read_image(&entry.hash)?;
        if data.len() < 16 {
            return Err("Invalid image cache data ".into());
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
                raw[raw.len() - sample_len..].hash(&mut hasher);
            } else {
                raw.hash(&mut hasher);
            }
            if let Ok(mut last) = yibovibe_core::clipboard::LAST_IMAGE_HASH.lock() {
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
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let entries: Vec<(String, String, Option<String>)> = ids
            .iter()
            .filter_map(|&id| {
                flow_store
                    .get_history_record_compat(id)
                    .ok()
                    .flatten()
                    .map(|record| {
                        (
                            record.entry.entry_type,
                            record.entry.hash,
                            record.local_storage_path,
                        )
                    })
            })
            .collect();

        let count = flow_store.delete_history_compat(&ids)?;
        for (entry_type, hash, local_storage_path) in entries {
            if matches!(entry_type.as_str(), "file " | "bundle") {
                continue;
            }
            if let Some(path) = local_storage_path {
                let _ = std::fs::remove_file(&path);
            } else {
                let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
                if let Some(cache) = cache_lock.as_ref() {
                    let _ = cache.delete_file(&entry_type, &hash);
                }
            }
        }
        return Ok(count);
    }

    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;

    let entries: Vec<(String, String)> = ids
        .iter()
        .filter_map(|&id| {
            history
                .get_by_id(id)
                .ok()
                .flatten()
                .map(|e| (e.entry_type, e.hash))
        })
        .collect();

    let count = history.delete_by_ids(&ids)?;
    for (entry_type, hash) in entries {
        let _ = cache.delete_file(&entry_type, &hash);
    }
    Ok(count)
}

#[tauri::command]
fn clear_history(before_days: Option<u32>) -> Result<u32, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let before_ts = match before_days {
            Some(days) if days > 0 => {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                now - (days as i64) * 24 * 60 * 60 * 1000
            }
            _ => i64::MAX,
        };
        let entries = if before_days.unwrap_or(0) > 0 {
            flow_store.query_history_compat(None, None, Some(before_ts), None, 10000, 0)?
        } else {
            flow_store.query_history_compat(None, None, None, None, 10000, 0)?
        };
        let deletable: Vec<_> = entries
            .iter()
            .filter(|entry| !entry.pinned)
            .filter_map(|entry| {
                flow_store
                    .get_history_record_compat(entry.id)
                    .ok()
                    .flatten()
            })
            .collect();
        let ids: Vec<i64> = deletable.iter().map(|entry| entry.entry.id).collect();
        let count = flow_store.delete_history_compat(&ids)?;
        for entry in deletable {
            if matches!(entry.entry.entry_type.as_str(), "file " | "bundle") {
                continue;
            }
            if let Some(path) = entry.local_storage_path {
                let _ = std::fs::remove_file(path);
            }
        }
        return Ok(count);
    }

    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;

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
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        return flow_store.toggle_history_pin_compat(id);
    }

    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    history.toggle_pin(id)
}

#[tauri::command]
fn get_cache_stats() -> Result<serde_json::Value, String> {
    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    let (total, text_count, image_count) = if let Some(flow_store) = flow_store_lock.as_ref() {
        flow_store.history_stats_compat()?
    } else {
        let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
        let history = history_lock.as_ref().ok_or("History not initialized ")?;
        history.get_stats()?
    };
    let total_size = cache.compute_total_size();
    let (text_files, image_files) = cache.compute_file_count();

    Ok(serde_json::json!({
        "total_entries": total,
        "text_count": text_count,
        "image_count": image_count,
        "total_size_bytes ": total_size,
        "total_size_mb": (total_size as f64 / 1_048_576.0 * 100.0).round() / 100.0,
        "cache_dir ": cache.base_dir().to_string_lossy().to_string(),
        "max_size_mb": cache.max_size_mb(),
        "text_files ": text_files,
        "image_files ": image_files,
    }))
}

#[tauri::command]
fn set_cache_dir(path: String) -> Result<(), String> {
    let mut cache_lock = yibovibe_core::cache::CACHE_MANAGER.write().unwrap();
    let cache = cache_lock.as_mut().ok_or("Cache not initialized ")?;
    let new_dir = std::path::PathBuf::from(&path);
    cache.migrate_to(new_dir)?;
    if let Ok(mut cfg) = yibovibe_core::config::GLOBAL_CONFIG.write() {
        cfg.cache.cache_dir = path;
        cfg.save();
    }
    Ok(())
}

#[tauri::command]
fn set_cache_max_size(mb: u64) -> Result<(), String> {
    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
    cache.set_max_size_mb(mb);
    drop(cache_lock);
    yibovibe_core::cache::enforce_cache_limit_now();
    if let Ok(mut cfg) = yibovibe_core::config::GLOBAL_CONFIG.write() {
        cfg.cache.cache_max_size_mb = mb;
        cfg.save();
    }
    Ok(())
}

#[tauri::command]
fn get_history_content(id: i64) -> Result<serde_json::Value, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let record = flow_store
            .get_history_record_compat(id)?
            .ok_or(format!("Entry {} not found ", id))?;
        return build_flow_object_preview(&record);
    }

    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;

    let entry = history
        .get_by_id(id)?
        .ok_or(format!("Entry {} not found ", id))?;

    if entry.entry_type == "text" {
        let content = cache.read_text(&entry.hash)?;
        Ok(serde_json::json!({
            "type": "text",
            "content ": content,
        }))
    } else {
        let data = cache.read_image(&entry.hash)?;
        if data.len() < 16 {
            return Err("Invalid image cache data ".into());
        }
        let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as u32;
        let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as u32;
        let img_bytes = &data[16..];

        use base64::{engine::general_purpose::STANDARD, Engine as _};
        if let Some(img_buffer) = image::RgbaImage::from_raw(w, h, img_bytes.to_vec()) {
            let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
            let mut buf = std::io::Cursor::new(Vec::new());
            if dyn_img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                let encoded = STANDARD.encode(buf.into_inner());
                return Ok(serde_json::json!({
                    "type": "image ",
                    "content ": format!("data:image/png;base64,{}", encoded),
                    "width": w,
                    "height": h,
                }));
            }
        }
        Err("Failed to decode image ".into())
    }
}

#[tauri::command]
async fn pull_today_history(state: tauri::State<'_, AppState>) -> Result<u32, String> {
    let ws_tx_lock = state.ws_tx.lock().await;
    let tx = ws_tx_lock
        .as_ref()
        .ok_or("Not connected to any device. Please connect first.")?
        .clone();
    drop(ws_tx_lock);

    let request = yibovibe_core::ws::WsMessage {
        sender_uid: 0,
        sender_device_id: 0,
        target_devices: vec![],
        r#type: "history_request".to_string(),
        payload: serde_json::json!({
            "mode": "recent",
            "limit": 5,
        }),
    };

    tx.send(request)
        .await
        .map_err(|e| format!("Failed to send history_request: {}", e))?;

    Ok(0)
}

#[tauri::command]
fn update_key_mappings(
    mappings: Vec<yibovibe_core::hook_manager::KeyRemapEntry>,
) -> Result<(), String> {
    yibovibe_core::hook_manager::update_key_remap_table(mappings);
    Ok(())
}

#[tauri::command]
fn diagnose_flowhint() -> Result<String, String> {
    let dicts = yibovibe_core::dictionary::get_all_dictionaries();
    let mut report = String::new();
    report.push_str("--- LingSi (FlowHint) Diagnostic Report ---\n\n");
    report.push_str(&format!("Loaded Dictionaries: {}\n", dicts.len()));
    for d in &dicts {
        report.push_str(&format!(
            "  - {} (ID: {}, Entries: {})\n",
            d.name,
            d.id,
            d.entries.len()
        ));
    }

    let default_rules = yibovibe_core::rules::get_rules().default;
    report.push_str(&format!(
        "\nDefault FlowHint Enabled: {}\n",
        default_rules.flowhint
    ));

    #[cfg(target_os = "windows")]
    {
        if let Ok(hint) = yibovibe_core::hook_manager::CURRENT_HINT.lock() {
            report.push_str(&format!("Hook Status: Active={}\n", hint.is_active));
            report.push_str(&format!(
                "Current Buffer Matches: {}\n",
                hint.candidates.len()
            ));
        }
    }

    // 6. HINT_TX status
    let tx_set = yibovibe_core::hook_manager::HINT_TX
        .lock()
        .map(|tx| tx.is_some())
        .unwrap_or(false);
    report.push_str(&format!("[Channel] HINT_TX is_set={}\n", tx_set));

    // 7. Try actually sending a test event
    if tx_set {
        yibovibe_core::hook_manager::set_hint_tx_test_send();
        report.push_str(
            "[Channel] Sent test HintEvent::Show (Event loop will handle SW_SHOWNOACTIVATE)\n",
        );
    }

    report.push_str("\nEngine: Ready\n");
    Ok(report)
}

#[tauri::command]
fn accept_hint_candidate(index: usize) -> Result<(), String> {
    yibovibe_core::hook_manager::accept_hint_by_index(index);
    Ok(())
}

#[tauri::command]
fn dismiss_hint_window() -> Result<(), String> {
    yibovibe_core::hook_manager::dismiss_hint();
    Ok(())
}

#[tauri::command]
fn update_hint_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
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
    let _ = app.emit("config-updated ", ());
    Ok(())
}

#[tauri::command]
fn move_hint_window(x: i32, y: i32) -> Result<(), String> {
    if let Some(tx) = &*yibovibe_core::hook_manager::HINT_TX.lock().unwrap() {
        let _ = tx.send(yibovibe_core::hook_manager::HintEvent::MoveWindow { x, y });
    }
    Ok(())
}

#[tauri::command]
fn reset_hint_position(app: tauri::AppHandle) -> Result<(), String> {
    let pos_type;
    {
        let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
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
        let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
        let anchor = LAST_HINT_ANCHOR.lock().unwrap();
        target_x = anchor.0;
        target_y = anchor.1 + 20;
        cfg.hint_window.fixed_x = target_x;
        cfg.hint_window.fixed_y = target_y;
        cfg.save();
    }

    if target_x != 0 || target_y != 0 {
        if let Some(tx) = &*yibovibe_core::hook_manager::HINT_TX.lock().unwrap() {
            let _ = tx.send(yibovibe_core::hook_manager::HintEvent::MoveWindow {
                x: target_x,
                y: target_y,
            });
        }
    }

    let _ = app.emit("config-updated ", ());
    Ok(())
}

#[tauri::command]
fn set_hint_window_mode(app: tauri::AppHandle, pos_type: i32) -> Result<(), String> {
    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG
        .write()
        .map_err(|e| e.to_string())?;
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
    info!(
        "Hint window mode set to: {}",
        if pos_type == 0 { "Follow" } else { "Fixed" }
    );
    let _ = app.emit("config-updated ", ());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn regenerate_device_fingerprint() -> Result<String, String> {
    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG.write().unwrap();
    let new_fp = format!("manual-{}", uuid::Uuid::new_v4());
    cfg.device_fingerprint = new_fp.clone();
    let _ = cfg.save();
    Ok(new_fp)
}

// ---------------------------------------------------------------------------
// Admin Commands — user management, device management (admin role required)
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_user_role(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let role = state
        .runtime_role
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "user".to_string());
    Ok(role)
}

#[tauri::command]
async fn codex_app_server_probe(
    request: codex_app_server::CodexAppServerProbeRequest,
) -> Result<codex_app_server::CodexAppServerProbeResponse, String> {
    codex_app_server::probe(request).await
}

#[tauri::command]
async fn codex_app_server_request(
    app: tauri::AppHandle,
    request: codex_app_server::CodexAppServerRpcRequest,
) -> Result<serde_json::Value, String> {
    codex_app_server::persistent_request(app, request).await
}

#[tauri::command]
async fn codex_desktop_ipc_request(
    app: tauri::AppHandle,
    request: codex_app_server::CodexDesktopIpcRequest,
) -> Result<serde_json::Value, String> {
    codex_app_server::desktop_ipc_request(app, request).await
}

#[tauri::command]
async fn codex_app_server_disconnect() -> Result<(), String> {
    codex_app_server::disconnect_persistent_session().await
}

#[tauri::command]
async fn logout_engine(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    *state.is_connected.lock().await = false;
    *state.ws_tx.lock().await = None;
    *state.runtime_server_url.lock().await = None;
    *state.runtime_username.lock().await = None;
    *state.runtime_device_name.lock().await = None;
    *state.runtime_remote_device_id.lock().await = None;
    *state.runtime_access_token.lock().await = None;
    *state.runtime_role.lock().await = None;

    yibovibe_core::local_auth::clear_session();
    Ok(true)
}

#[tauri::command]
async fn admin_list_users(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<yibovibe_core::api::AdminUserInfo>, String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    let client = yibovibe_core::api::ApiClient::new(server_url);
    client.admin_list_users(&token).await
}

#[tauri::command]
async fn admin_update_user_status(
    state: tauri::State<'_, AppState>,
    uid: u32,
    new_status: String,
) -> Result<(), String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    let client = yibovibe_core::api::ApiClient::new(server_url);
    client
        .admin_update_user_status(&token, uid, &new_status)
        .await
}

#[tauri::command]
async fn admin_delete_user(state: tauri::State<'_, AppState>, uid: u32) -> Result<(), String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    let client = yibovibe_core::api::ApiClient::new(server_url);
    client.admin_delete_user(&token, uid).await
}

#[tauri::command]
async fn admin_reset_password(
    state: tauri::State<'_, AppState>,
    uid: u32,
    new_password: String,
    new_password_hint: String,
) -> Result<(), String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    let client = yibovibe_core::api::ApiClient::new(server_url);
    client
        .admin_reset_password(&token, uid, &new_password, &new_password_hint)
        .await
}

#[tauri::command]
async fn admin_list_devices(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<yibovibe_core::api::AdminDeviceInfo>, String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    let client = yibovibe_core::api::ApiClient::new(server_url);
    client.admin_list_devices(&token).await
}

#[tauri::command]
async fn admin_kick_device(
    state: tauri::State<'_, AppState>,
    device_id: u32,
) -> Result<(), String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    let client = yibovibe_core::api::ApiClient::new(server_url);
    client.admin_kick_device(&token, device_id).await
}

#[tauri::command]
async fn admin_delete_user_vault(
    state: tauri::State<'_, AppState>,
    uid: u32,
) -> Result<(), String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    let client = yibovibe_core::api::ApiClient::new(server_url);
    client.admin_delete_user_vault(&token, uid).await
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TerminalPrefs {
    pub default_shell: String,
}

#[derive(serde::Serialize)]
pub struct ConsoleAdminStatus {
    pub is_elevated: bool,
}

#[tauri::command]
async fn get_terminal_prefs() -> Result<TerminalPrefs, String> {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG
        .read()
        .map_err(|e| e.to_string())?;
    Ok(TerminalPrefs {
        default_shell: cfg.terminal_default_shell.clone(),
    })
}

#[tauri::command]
async fn set_terminal_prefs(
    state: tauri::State<'_, AppState>,
    prefs: TerminalPrefs,
) -> Result<(), String> {
    {
        let mut cfg = yibovibe_core::config::GLOBAL_CONFIG
            .write()
            .map_err(|e| e.to_string())?;
        cfg.terminal_default_shell = prefs.default_shell.clone();
        cfg.save();
    }
    yibovibe_core::config::AppConfig::reload();
    // Also update the session manager default
    let mut mgr = state.session_manager.lock().await;
    mgr.set_default_shell(&prefs.default_shell);
    Ok(())
}

#[tauri::command]
async fn start_terminal(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let mut mgr = state.session_manager.lock().await;
    let sid = mgr.create_session(None, None).await;
    mgr.start_session(&sid, &app, None).await?;
    Ok(sid)
}

/* ----- Remote session sync helpers (desktop <-> server Signal Hub) ----- */

fn build_session_sync_payload(
    session_id: &str,
    session_info: Option<terminal::SessionInfo>,
    extra: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "session_id": session_id,
    });
    if let Some(info) = session_info {
        let cwd_name = Path::new(&info.cwd)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("workspace");
        let short_id = session_id
            .rsplit_once('-')
            .map(|(_, suffix)| suffix)
            .unwrap_or(session_id);
        let label = format!("{} · {} · {}", info.shell_kind, cwd_name, short_id);
        let status_str = match info.status {
            terminal::SessionStatus::Running => "running",
            terminal::SessionStatus::Exited(_) => "stopped",
            terminal::SessionStatus::Error(_) => "crashed",
        };
        payload["label"] = serde_json::json!(label);
        payload["status"] = serde_json::json!(status_str);
        payload["state"] = serde_json::json!(status_str);
        payload["shell_kind"] = serde_json::json!(info.shell_kind);
        payload["cwd"] = serde_json::json!(info.cwd);
        payload["started_at"] = serde_json::json!(info.started_at);
        payload["last_output_at"] = serde_json::json!(info.last_output_at);
        payload["exit_code"] = serde_json::json!(info.exit_code);
    }
    if let Some(e) = extra {
        if let Some(obj) = e.as_object() {
            for (k, v) in obj {
                payload[k] = v.clone();
            }
        }
    }
    payload
}

/// Push session state to the server Signal Hub via the existing WS connection.
async fn sync_session_to_server(
    state: &tauri::State<'_, AppState>,
    msg_type: &str,
    session_id: &str,
    extra: Option<serde_json::Value>,
) {
    let ws_tx = state.ws_tx.lock().await.clone();
    let Some(tx) = ws_tx else { return };

    let session_info = {
        let mgr = state.session_manager.lock().await;
        mgr.get_session_info(session_id).await
    };

    let msg = yibovibe_core::ws::WsMessage {
        sender_uid: 0,
        sender_device_id: 0,
        target_devices: vec![],
        r#type: msg_type.to_string(),
        payload: build_session_sync_payload(session_id, session_info, extra),
    };
    match tx.try_send(msg) {
        Ok(()) => {}
        Err(tokio::sync::mpsc::error::TrySendError::Full(msg)) => {
            let tx_clone = tx.clone();
            tokio::spawn(async move {
                let _ = tx_clone.send(msg).await;
            });
        }
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_msg)) => {
            warn!(
                "[SignalSync] Failed to send {} for session {}: channel closed",
                msg_type, session_id
            );
            *state.is_connected.lock().await = false;
            *state.ws_tx.lock().await = None;
        }
    }
}

async fn sync_all_sessions_to_server_handle(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let ws_tx = state.ws_tx.lock().await.clone();
    let Some(tx) = ws_tx else { return };

    let sessions = {
        let mgr = state.session_manager.lock().await;
        mgr.list_sessions().await
    };

    for session in sessions {
        let session_id = session.session_id.clone();
        if is_session_closing(&state, &session_id).await {
            continue;
        }
        let msg = yibovibe_core::ws::WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: vec![],
            r#type: "session:update".to_string(),
            payload: build_session_sync_payload(&session_id, Some(session), None),
        };

        if let Err(e) = tx.send(msg).await {
            warn!("[SignalSync] Failed to keepalive sessions: {}", e);
            *state.is_connected.lock().await = false;
            *state.ws_tx.lock().await = None;
            break;
        }
    }
}

async fn reconnect_session_signal_channel(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.ws_tx.lock().await.is_some() {
        return Ok(());
    }

    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("missing runtime server url".to_string())?;
    let access_token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("missing runtime access token".to_string())?;

    let (ws_client, ws_rx) = WsClient::connect(&server_url, &access_token)
        .await
        .map_err(|e| format!("websocket reconnect failed: {e}"))?;

    let (clipboard_tx, _clipboard_rx) = tokio::sync::mpsc::channel(8);
    spawn_ws_broker(
        ws_rx,
        clipboard_tx,
        ws_client.tx.clone(),
        state.session_manager.clone(),
        app.clone(),
    );

    *state.is_connected.lock().await = true;
    *state.ws_tx.lock().await = Some(ws_client.tx.clone());

    info!("[SignalSync] Reconnected session signal channel.");
    sync_all_sessions_to_server_handle(app).await;
    Ok(())
}

fn spawn_session_sync_guard(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(30));
        loop {
            ticker.tick().await;

            let has_runtime_auth = {
                let state = app_handle.state::<AppState>();
                let server_ready = state.runtime_server_url.lock().await.is_some();
                let token_ready = state.runtime_access_token.lock().await.is_some();
                server_ready && token_ready
            };

            if !has_runtime_auth {
                continue;
            }

            let is_connected = {
                let state = app_handle.state::<AppState>();
                let connected = *state.is_connected.lock().await;
                connected
            };

            if is_connected {
                sync_all_sessions_to_server_handle(&app_handle).await;
            } else if let Err(e) = reconnect_session_signal_channel(&app_handle).await {
                warn!("[SignalSync] Reconnect skipped/failed: {}", e);
            }
        }
    });
}

/// Spawn a broker task that splits the WS receive stream:
/// 1. Forwards all messages to the clipboard monitor
/// 2. Handles remote session commands
fn spawn_ws_broker(
    ws_rx: tokio::sync::mpsc::Receiver<yibovibe_core::ws::WsMessage>,
    clipboard_tx: tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>,
    ws_tx: tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>,
    session_manager: terminal::SharedSessionManager,
    app_handle: tauri::AppHandle,
) {
    tokio::spawn(async move {
        let mut rx = ws_rx;
        let clipboard = clipboard_tx;
        let sync_tx = ws_tx;
        let sm = session_manager;
        let app = app_handle;

        while let Some(msg) = rx.recv().await {
            let _ = clipboard.send(msg.clone()).await;

            match msg.r#type.as_str() {
                "session:start" | "session:resume" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let shell_kind = msg.payload["shell_kind"].as_str();
                    if !session_id.is_empty() {
                        let mut mgr = sm.lock().await;
                        if !mgr.session_exists(session_id).await {
                            mgr.create_session_with_id(session_id.to_string(), shell_kind, None)
                                .await;
                            info!("[WS Broker] Remote create session {}", session_id);
                            let session_info = mgr.get_session_info(session_id).await;
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:register".to_string(),
                                    payload: build_session_sync_payload(
                                        session_id,
                                        session_info,
                                        None,
                                    ),
                                })
                                .await;
                        }
                        if let Err(e) = mgr
                            .start_session_with_ws(session_id, &app, sync_tx.clone(), None)
                            .await
                        {
                            warn!(
                                "[WS Broker] Remote start session {} failed: {}",
                                session_id, e
                            );
                        } else {
                            info!("[WS Broker] Remote started session {}", session_id);
                            let session_info = mgr.get_session_info(session_id).await;
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:update".to_string(),
                                    payload: build_session_sync_payload(
                                        session_id,
                                        session_info,
                                        None,
                                    ),
                                })
                                .await;
                        }
                    }
                }
                "session:list" => {
                    let sessions = {
                        let mgr = sm.lock().await;
                        mgr.list_sessions().await
                    };

                    let payload = serde_json::json!({
                        "type": "session_list",
                        "sessions": sessions,
                    });

                    let _ = sync_tx
                        .send(yibovibe_core::ws::WsMessage {
                            sender_uid: 0,
                            sender_device_id: 0,
                            target_devices: if msg.sender_device_id > 0 {
                                vec![msg.sender_device_id]
                            } else {
                                vec![]
                            },
                            r#type: "session_list".to_string(),
                            payload,
                        })
                        .await;
                }
                "session:stop" | "session:pause" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let confirmed = msg.payload["confirmed"].as_bool().unwrap_or(false);
                    if !session_id.is_empty() {
                        if msg.r#type == "session:stop" && !confirmed {
                            warn!(
                                "[WS Broker] Rejected remote stop for {} because confirmation was missing",
                                session_id
                            );
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:warning".to_string(),
                                    payload: serde_json::json!({
                                        "session_id": session_id,
                                        "message": "Remote stop rejected because confirmation was missing.",
                                    }),
                                })
                                .await;
                            continue;
                        }
                        let mut mgr = sm.lock().await;
                        if let Err(e) = mgr.kill_session(session_id).await {
                            warn!(
                                "[WS Broker] Remote kill session {} failed: {}",
                                session_id, e
                            );
                        } else {
                            info!("[WS Broker] Remote killed session {}", session_id);
                            let session_info = mgr.get_session_info(session_id).await;
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:update".to_string(),
                                    payload: build_session_sync_payload(
                                        session_id,
                                        session_info,
                                        Some(serde_json::json!({
                                            "status": "stopped",
                                            "state": "stopped"
                                        })),
                                    ),
                                })
                                .await;
                        }
                    }
                }
                "session:remove" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    if !session_id.is_empty() {
                        let state = app.state::<AppState>();
                        mark_session_closing(&state, session_id).await;
                        let mut mgr = sm.lock().await;
                        if let Err(e) = mgr.remove_session(session_id).await {
                            warn!(
                                "[WS Broker] Remote remove session {} failed: {}",
                                session_id, e
                            );
                        } else {
                            info!("[WS Broker] Remote removed session {}", session_id);
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:unregister".to_string(),
                                    payload: serde_json::json!({
                                        "session_id": session_id,
                                    }),
                                })
                                .await;
                        }
                    }
                }
                "session:stdin" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let text = msg.payload["text"].as_str().unwrap_or("");
                    if !session_id.is_empty() && !text.is_empty() {
                        let mut mgr = sm.lock().await;
                        let _ = mgr.prepare_remote_input(session_id).await;
                        if let Err(e) = mgr.write_session(session_id, text).await {
                            warn!("[WS Broker] Remote stdin to {} failed: {}", session_id, e);
                        }
                    }
                }
                "session:resize" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let cols = msg.payload["cols"].as_u64().unwrap_or(80) as u16;
                    let rows = msg.payload["rows"].as_u64().unwrap_or(24) as u16;
                    if !session_id.is_empty() {
                        let mut mgr = sm.lock().await;
                        let _ = mgr.resize_session(session_id, cols, rows).await;
                        let _ = sync_tx
                            .send(yibovibe_core::ws::WsMessage {
                                sender_uid: 0,
                                sender_device_id: 0,
                                target_devices: vec![],
                                r#type: "session:screen_resize".to_string(),
                                payload: serde_json::json!({
                                    "session_id": session_id,
                                    "cols": cols,
                                    "rows": rows,
                                }),
                            })
                            .await;
                    }
                }
                "session:screen_request_snapshot" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    if !session_id.is_empty() {
                        let mgr = sm.lock().await;
                        match mgr.request_screen_snapshot(session_id).await {
                            Ok(snapshot) => {
                                let _ = sync_tx
                                    .send(yibovibe_core::ws::WsMessage {
                                        sender_uid: 0,
                                        sender_device_id: 0,
                                        target_devices: if msg.sender_device_id > 0 {
                                            vec![msg.sender_device_id]
                                        } else {
                                            vec![]
                                        },
                                        r#type: "session:screen_snapshot".to_string(),
                                        payload: serde_json::to_value(snapshot)
                                            .unwrap_or_else(|_| serde_json::json!({})),
                                    })
                                    .await;
                            }
                            Err(err) => {
                                warn!(
                                    "[WS Broker] Screen snapshot request for {} failed: {}",
                                    session_id, err
                                );
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        let state = app.state::<AppState>();
        *state.is_connected.lock().await = false;
        *state.ws_tx.lock().await = None;
        info!("[WS Broker] WS receive stream ended, broker shutting down");
    });
}

#[tauri::command]
async fn write_terminal(
    state: tauri::State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let commands = {
        let mgr = state.session_manager.lock().await;
        mgr.record_session_input_for_sync(&session_id, &text)
            .await?
    };

    {
        let mut mgr = state.session_manager.lock().await;
        mgr.write_session(&session_id, &text).await?;
    }

    if !commands.is_empty() {
        if let Some(tx) = state.ws_tx.lock().await.clone() {
            for command in commands {
                let _ = tx
                    .send(yibovibe_core::ws::WsMessage {
                        sender_uid: 0,
                        sender_device_id: 0,
                        target_devices: vec![],
                        r#type: "user_input".to_string(),
                        payload: serde_json::json!({
                            "session_id": session_id.clone(),
                            "text": command,
                        }),
                    })
                    .await;
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn kill_terminal(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut mgr = state.session_manager.lock().await;
    mgr.kill_session(&session_id).await?;
    drop(mgr);
    sync_session_to_server(&state, "session:update", &session_id, None).await;
    Ok(())
}

#[tauri::command]
async fn create_session(
    state: tauri::State<'_, AppState>,
    shell_kind: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let mut mgr = state.session_manager.lock().await;
    let sid = mgr
        .create_session(shell_kind.as_deref(), cwd.as_deref())
        .await;
    let sid_clone = sid.clone();
    drop(mgr);
    sync_session_to_server(&state, "session:register", &sid_clone, None).await;
    Ok(sid)
}

#[tauri::command]
async fn start_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    let mut mgr = state.session_manager.lock().await;
    let initial_size = match (cols, rows) {
        (Some(cols), Some(rows)) if cols > 0 && rows > 0 => Some((cols, rows)),
        _ => None,
    };
    // If WS is connected, use the WS-aware variant so output is forwarded to server
    if let Some(ws_tx) = state.ws_tx.lock().await.clone() {
        mgr.start_session_with_ws(&session_id, &app, ws_tx, initial_size)
            .await?;
    } else {
        mgr.start_session(&session_id, &app, initial_size).await?;
    }
    drop(mgr);
    sync_session_to_server(&state, "session:update", &session_id, None).await;
    Ok(())
}

#[tauri::command]
async fn list_sessions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<terminal::SessionInfo>, String> {
    let mgr = state.session_manager.lock().await;
    Ok(mgr.list_sessions().await)
}

#[tauri::command]
async fn get_session_buffer(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let mgr = state.session_manager.lock().await;
    mgr.get_session_buffer(&session_id)
        .await
        .ok_or_else(|| format!("Session not found: {session_id}"))
}

#[tauri::command]
async fn remove_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    mark_session_closing(&state, &session_id).await;
    let mut mgr = state.session_manager.lock().await;
    mgr.remove_session(&session_id).await?;
    drop(mgr);
    sync_session_to_server(&state, "session:unregister", &session_id, None).await;
    Ok(())
}

#[tauri::command]
async fn resize_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut mgr = state.session_manager.lock().await;
    mgr.resize_session(&session_id, cols, rows).await
}

#[cfg(target_os = "windows")]
fn current_process_is_elevated() -> Result<bool, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = windows::Win32::Foundation::HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|e| format!("OpenProcessToken failed: {e}"))?;

        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0u32;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        let _ = CloseHandle(token);

        result.map_err(|e| format!("GetTokenInformation failed: {e}"))?;
        Ok(elevation.TokenIsElevated != 0)
    }
}

#[tauri::command]
async fn get_console_admin_status() -> Result<ConsoleAdminStatus, String> {
    #[cfg(target_os = "windows")]
    {
        return Ok(ConsoleAdminStatus {
            is_elevated: current_process_is_elevated()?,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(ConsoleAdminStatus { is_elevated: false })
    }
}

#[tauri::command]
async fn request_console_admin(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{HINSTANCE, HWND};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        if current_process_is_elevated()? {
            return Ok(());
        }

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_wide: Vec<u16> = exe
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let runas: Vec<u16> = OsStr::new("runas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let args: Vec<u16> = OsStr::new("--elevated-relaunch")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let result: HINSTANCE = unsafe {
            ShellExecuteW(
                Some(HWND(std::ptr::null_mut())),
                PCWSTR(runas.as_ptr()),
                PCWSTR(exe_wide.as_ptr()),
                PCWSTR(args.as_ptr()),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };

        if result.0 as isize <= 32 {
            return Err(format!(
                "ShellExecuteW failed with code {}",
                result.0 as isize
            ));
        }

        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(350));
            app.exit(0);
        });

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Admin elevation is only supported on Windows".to_string())
    }
}

pub fn run() {
    // Intialize Rust logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // 预热词库引擎与账户上下文
    yibovibe_core::local_auth::load_session();
    yibovibe_core::dictionary::init_and_load_dictionaries();
    yibovibe_core::dictionary::load_freq_cache();

    if let Err(e) = yibovibe_core::cache::init_cache_and_history() {
        log::error!("Failed to initialize clipboard history: {}", e);
    }

    #[cfg(target_os = "windows")]
    yibovibe_core::hook_manager::start_global_hook();

    let is_elevated_relaunch = std::env::args().any(|arg| arg == "--elevated-relaunch");
    let debug_mode_enabled = yibovibe_core::config::GLOBAL_CONFIG
        .read()
        .map(|cfg| cfg.debug_mode)
        .unwrap_or(false);
    let allow_multi_instance = std::env::var("YIBOFLOW_ALLOW_MULTI_INSTANCE")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
        || debug_mode_enabled
        || is_elevated_relaunch;
    let data_dir = std::env::var("YIBOFLOW_DATA_DIR").unwrap_or_else(|_| "<default>".to_string());
    info!(
        "[Startup] allow_multi_instance={}, debug_mode={}, data_dir={}",
        allow_multi_instance, debug_mode_enabled, data_dir
    );

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["hint"])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(AppState {
            session_manager: terminal::new_shared_manager(
                &yibovibe_core::config::GLOBAL_CONFIG
                    .read()
                    .map(|cfg| cfg.terminal_default_shell.clone())
                    .unwrap_or_else(|_| "cmd".to_string()),
            ),
            closing_sessions: Mutex::new(HashMap::new()),
            is_connected: Mutex::new(false),
            ws_tx: Mutex::new(None),
            runtime_server_url: Mutex::new(None),
            runtime_username: Mutex::new(None),
            runtime_device_name: Mutex::new(None),
            runtime_remote_device_id: Mutex::new(None),
            persistent_device_fingerprint: Mutex::new(None),
            runtime_device_fingerprint: Mutex::new(None),
            runtime_access_token: Mutex::new(None),
            runtime_role: Mutex::new(None),
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

    // ---- Headless Host initialization ----
    use std::path::PathBuf;
    let app_data_base = std::env::var("YIBOFLOW_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./host_state"));
    let (host_ctrl, host_event_rx) = agent_bridge::HostController::new(app_data_base);
    let host_ctrl = Arc::new(Mutex::new(host_ctrl));
    info!("[AgentHost] Controller created");

    let host_ctrl_for_setup = host_ctrl.clone();
    builder
        .manage(host_ctrl)
        .setup(move |app| {
            use tauri::menu::{Menu, MenuItem};
            // Start AgentHost in background via tokio
            let app_handle = app.handle().clone();
            agent_bridge::spawn_event_forwarder(app_handle, host_event_rx);
            spawn_session_sync_guard(app.handle().clone());
            let host = host_ctrl_for_setup.clone();
            tauri::async_runtime::spawn(async move {
                let ctrl = host.lock().await;
                if let Err(e) = ctrl.start().await {
                    log::error!("[AgentHost] Failed to start: {e}");
                } else {
                    info!("[AgentHost] Started successfully");
                }
            });
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            // Removed: use tauri::Manager; // Redundant with top-level import

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("YiboVibe")
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
            {
                use tauri_plugin_window_state::{StateFlags, WindowExt};
                let _ = main_window.restore_state(StateFlags::all());
            }
            normalize_main_window_size(&main_window);
            let _ = main_window.show();

            let window_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                    let _ = window_clone
                        .app_handle()
                        .save_window_state(StateFlags::all());
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
                use windows::Win32::UI::WindowsAndMessaging::{
                    GetWindowLongW, SetWindowLongW, GWL_EXSTYLE,
                };
                let raw_hwnd = hint_win.hwnd().unwrap();
                let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as *mut _);
                unsafe {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    // WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x00000080
                    // IMPORTANT: Explicitly REMOVE WS_EX_TRANSPARENT (0x20) to ensure clicks are caught!
                    let new_style = (ex_style | 0x08000000i32 | 0x00000080i32) & !0x00000020i32;
                    SetWindowLongW(hwnd, GWL_EXSTYLE, new_style);
                    use windows::Win32::UI::WindowsAndMessaging::{
                        SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                        SWP_NOZORDER,
                    };
                    let _ = SetWindowPos(
                        hwnd,
                        None,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED,
                    );
                }
                hwnd
            };

            // Bridge FlowHint events from Hook to Tauri Frontend
            let (hint_tx, hint_rx) = std::sync::mpsc::channel();
            yibovibe_core::hook_manager::set_hint_tx(hint_tx);
            refresh_hint_window_cfg(); // Initialize cached hint config
            let app_handle = app.handle().clone();
            #[cfg(target_os = "windows")]
            let hint_hwnd_raw = hint_hwnd.0 as isize;
            std::thread::spawn(move || {
                use yibovibe_core::hook_manager::HintEvent;
                while let Ok(event) = hint_rx.recv() {
                    let ev_clone = event.clone();
                    let app_handle_inner = app_handle.clone();
                    let _ = app_handle.run_on_main_thread(move || {
                        #[cfg(target_os = "windows")]
                        {
                            let hint_hwnd =
                                windows::Win32::Foundation::HWND(hint_hwnd_raw as *mut _);
                            use windows::Win32::UI::WindowsAndMessaging::{
                                SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE,
                                SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE,
                            };
                            match &ev_clone {
                                HintEvent::Show {
                                    candidates, x, y, ..
                                } => {
                                    let visible_count = candidates.len().min(8) as i32;

                                    let (cfg_pos_type, cfg_x, cfg_y, cfg_ox, cfg_oy) = {
                                        let hint_cfg = HINT_WINDOW_CFG.lock().unwrap();
                                        (hint_cfg.0, hint_cfg.1, hint_cfg.2, hint_cfg.3, hint_cfg.4)
                                    };

                                    let outer_width = 300;
                                    let outer_height = 68 + visible_count * 34;

                                    let mut pos_x = *x;
                                    let mut pos_y = *y;

                                    let is_diag = candidates
                                        .get(0)
                                        .map(|s| s.contains("[诊断]"))
                                        .unwrap_or(false);
                                    if is_diag {
                                        pos_x = 400;
                                        pos_y = 400;
                                    } else if cfg_pos_type == 0 {
                                        *LAST_HINT_ANCHOR.lock().unwrap() = (pos_x, pos_y);
                                        pos_x += cfg_ox;
                                        pos_y += cfg_oy;
                                        if cfg_oy == 0 {
                                            pos_y += 20;
                                        }
                                    } else {
                                        if cfg_x != -1 {
                                            pos_x = cfg_x;
                                        }
                                        if cfg_y != -1 {
                                            pos_y = cfg_y;
                                        }
                                    }

                                    // Safety clamp
                                    if let Ok(Some(monitor)) = app_handle_inner
                                        .monitor_from_point(pos_x as f64, pos_y as f64)
                                    {
                                        let screen_x = monitor.position().x;
                                        let screen_y = monitor.position().y;
                                        let screen_w = monitor.size().width as i32;
                                        let screen_h = monitor.size().height as i32;
                                        if pos_x + outer_width > screen_x + screen_w {
                                            pos_x = screen_x + screen_w - outer_width - 10;
                                        }
                                        if pos_x < screen_x {
                                            pos_x = screen_x + 10;
                                        }
                                        if pos_y + outer_height > screen_y + screen_h {
                                            pos_y = screen_y + screen_h - outer_height - 10;
                                        }
                                        if pos_y < screen_y {
                                            pos_y = screen_y + 20;
                                        }
                                    }

                                    unsafe {
                                        info!("Clamped Position: ({}, {})", pos_x, pos_y);
                                        let _ = SetWindowPos(
                                            hint_hwnd,
                                            Some(HWND_TOPMOST),
                                            pos_x,
                                            pos_y,
                                            outer_width,
                                            outer_height,
                                            SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                        );
                                        let _ = ShowWindow(hint_hwnd, SW_SHOWNOACTIVATE);
                                    }
                                }
                                HintEvent::Hide => unsafe {
                                    let _ = ShowWindow(hint_hwnd, SW_HIDE);
                                },
                                HintEvent::MoveWindow { x, y } => unsafe {
                                    let _ = SetWindowPos(
                                        hint_hwnd,
                                        None,
                                        *x,
                                        *y,
                                        0,
                                        0,
                                        SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
                                    );
                                },
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
            get_terminal_prefs,
            set_terminal_prefs,
            get_desktop_build_label,
            start_terminal,
            write_terminal,
            kill_terminal,
            create_session,
            start_session,
            list_sessions,
            get_session_buffer,
            remove_session,
            resize_session,
            get_console_admin_status,
            request_console_admin,
            connect_engine,
            register_engine,
            resolve_sync_conflict,
            get_probe_config,
            save_probe_config,
            test_probe_credential,
            test_probe_route,
            list_probe_credential_models,
            list_probe_route_models,
            start_probe_proxy,
            stop_probe_proxy,
            get_probe_dashboard,
            clear_probe_logs,
            get_app_config,
            get_settings,
            update_settings,
            get_flowsync_auto_sync_prefs,
            set_flowsync_auto_sync_prefs,
            set_dictionary_order,
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
            list_flowsync_online_devices,
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
            read_clipboard_content,
            write_to_clipboard,
            write_image_to_clipboard,
            set_flowsync_receive_only_mode,
            create_flowsync_entry_from_path,
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
            get_flowsync_entry_transfer_state,
            download_flowsync_entry,
            upload_flowsync_entry_to_nas,
            list_my_flowsync_staged_objects,
            delete_my_flowsync_staged_object,
            list_my_flowsync_share_links,
            create_flowsync_share_link,
            disable_my_flowsync_share_link,
            get_flowsync_staging_preferences,
            set_flowsync_staging_preferences,
            push_flowsync_entry_to_device,
            pull_today_history,
            crate::agent_bridge::get_host_state,
            crate::agent_bridge::restart_host,
            crate::agent_bridge::get_host_diagnostics,
            codex_app_server_probe,
            codex_app_server_request,
            codex_desktop_ipc_request,
            codex_app_server_disconnect,
            get_user_role,
            logout_engine,
            admin_list_users,
            admin_update_user_status,
            admin_delete_user,
            admin_reset_password,
            admin_list_devices,
            admin_kick_device,
            admin_delete_user_vault,
            admin_get_flowsync_staging_policy,
            admin_update_flowsync_staging_policy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
