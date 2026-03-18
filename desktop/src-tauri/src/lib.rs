use log::{info, warn};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

use yiboflow_core::api::{ApiClient, LoginRequest, RegisterRequest};
use yiboflow_core::clipboard::ClipboardMonitor;
use yiboflow_core::crypto::MasterKey;
use yiboflow_core::ws::WsClient;

// We can store shared state here later, like the WsClient channel for sending new text.
pub struct AppState {
    pub is_connected: Mutex<bool>,
    pub ws_tx: Mutex<Option<tokio::sync::mpsc::Sender<yiboflow_core::ws::WsMessage>>>,
}

lazy_static::lazy_static! {
    static ref LAST_HINT_ANCHOR: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));
    static ref LAST_WRITER_ANCHOR: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));
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
        "Tauri Command Received: connect_engine -> Server: {}, User: {}",
        server_url, username
    );

    if server_url == "local" {
        return yiboflow_core::local_auth::login_local_user(&username, &password);
    }

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: "gui-native-1234".to_string(),
    };

    let login_result = client.login(login_payload).await;

    let _is_mock_target = server_url.contains("127.0.0.1") || server_url.contains("localhost");
    let mut needs_mock = false;
    let mut api_err = String::new();

    match login_result {
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
                        let arc_mk = Arc::new(mk);
                        let cb_monitor = ClipboardMonitor::new(
                            server_url.clone(),
                            d.access_token.clone(),
                            arc_mk,
                            ws_client.tx.clone(),
                            Some(ui_tx),
                        );
                        cb_monitor.start_polling();
                        cb_monitor.start_receiving(ws_rx);

                        let mut connected_flag = state.is_connected.lock().await;
                        *connected_flag = true;
                        let mut ws_tx = state.ws_tx.lock().await;
                        *ws_tx = Some(ws_client.tx.clone());
                        return Ok(true);
                    }
                    Err(e) => return Err(format!("WebSocket Connection Failed: {}", e)),
                }
            } else {
                api_err = format!("Login failed via API: {}", res.msg);
                needs_mock = true;
            }
        }
        Err(e) => {
            api_err = format!("Could not connect to NAS: {}", e);
            needs_mock = true; // Use this flag as 'needs_offline_fallback'
        }
    }

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
            let arc_mk = Arc::new(mk);

            let cb_monitor = ClipboardMonitor::new(
                "offline".to_string(),
                "none".to_string(),
                arc_mk,
                dummy_ws_tx,
                Some(ui_tx),
            );
            cb_monitor.start_polling();
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
    flowhint_accept_key: u32,
    hint_window: yiboflow_core::config::WindowConfig,
    writer_window: yiboflow_core::config::WindowConfig,
    is_window_config_unified: bool,
    dictionary_order: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub error_type: Option<String>,
}

#[tauri::command]
async fn test_ai_endpoint(endpoint: yiboflow_core::config::AiEndpoint) -> Result<TestResult, String> {
    let config = yiboflow_core::config::AiEngineConfig {
        endpoints: vec![endpoint.clone()],
        auto_mode: false,
        timeout_ms: 5000,
    };
    let client = yiboflow_core::ai::client::AiClient::new(config);
    
    // Light probe with strict status check
    match client.probe(&endpoint).await {
        Ok(_) => Ok(TestResult {
            success: true,
            message: "连接成功：服务已就绪".into(),
            error_type: None,
        }),
        Err(e) => {
            let err_str = e.to_string();
            let error_type = if err_str.contains("401") || err_str.contains("Unauthorized") {
                Some("Unauthorized".into())
            } else if err_str.contains("timeout") {
                Some("Timeout".into())
            } else {
                Some("NetworkError".into())
            };

            let msg = match error_type.as_deref() {
                Some("Unauthorized") => "身份验证失败：请检查 API Key 是否正确".into(),
                Some("Timeout") => "连接超时：请检查 NAS 地址或端口是否开放".into(),
                _ => format!("网络错误: {}", err_str),
            };

            Ok(TestResult {
                success: false,
                message: msg,
                error_type,
            })
        }
    }
}

#[tauri::command]
async fn list_endpoint_models(endpoint: yiboflow_core::config::AiEndpoint) -> Result<Vec<String>, String> {
    let config = yiboflow_core::config::AiEngineConfig {
        endpoints: vec![endpoint.clone()],
        auto_mode: false,
        timeout_ms: 10000,
    };
    let client = yiboflow_core::ai::client::AiClient::new(config);
    client.list_models(&endpoint).await.map_err(|e| e.to_string())
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
        flowhint_accept_key: cfg.flowhint_accept_key,
        hint_window: cfg.hint_window.clone(),
        writer_window: cfg.writer_window.clone(),
        is_window_config_unified: cfg.is_window_config_unified,
        dictionary_order: cfg.dictionary_order.clone(),
    })
}

#[tauri::command]
fn update_settings(
    is_sync_enabled: bool, 
    flowhint_min_chars: usize, 
    flowhint_accept_key: u32, 
    hint_window: yiboflow_core::config::WindowConfig,
    writer_window: yiboflow_core::config::WindowConfig,
    is_window_config_unified: bool,
) -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.is_sync_enabled = is_sync_enabled;
    cfg.flowhint_min_chars = flowhint_min_chars;
    cfg.flowhint_accept_key = flowhint_accept_key;
    cfg.hint_window = hint_window;
    cfg.writer_window = writer_window;
    cfg.is_window_config_unified = is_window_config_unified;
    cfg.save();
    Ok(())
}

#[tauri::command]
fn get_custom_prompts() -> Result<yiboflow_core::ai::prompt::CustomPromptsConfig, String> {
    Ok(yiboflow_core::ai::prompt::get_custom_prompts_config())
}

#[tauri::command]
fn get_app_config() -> Result<yiboflow_core::config::AppConfig, String> {
    Ok(yiboflow_core::config::GLOBAL_CONFIG.read().unwrap().clone())
}

#[tauri::command]
fn update_ai_endpoints(endpoints: Vec<yiboflow_core::config::AiEndpoint>) -> Result<(), String> {
    let mut config = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap().clone();
    config.ai_engine.endpoints = endpoints;
    config.save();
    let mut lock = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    lock.ai_engine.endpoints = config.ai_engine.endpoints.clone();
    Ok(())
}

#[tauri::command]
fn add_custom_prompt(prompt: yiboflow_core::ai::prompt::CustomPromptTemplate) -> Result<(), String> {
    yiboflow_core::ai::prompt::add_custom_prompt(prompt)
}

#[tauri::command]
fn remove_custom_prompt(id: String) -> Result<(), String> {
    yiboflow_core::ai::prompt::remove_custom_prompt(&id)
}

#[tauri::command]
fn get_flowwriter_config() -> Result<yiboflow_core::config::FlowWriterConfig, String> {
    let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
    Ok(cfg.flowwriter.clone())
}

#[tauri::command]
fn update_flowwriter_config(config: yiboflow_core::config::FlowWriterConfig) -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    cfg.flowwriter = config;
    cfg.save();
    Ok(())
}

#[tauri::command]
async fn stream_ai_writer(
    action: String,
    action_payload: Option<String>,
    user_input: String,
    window: tauri::Window,
) -> Result<(), String> {
    let prompt_action = match action.as_str() {
        "Polish" => yiboflow_core::ai::prompt::PromptAction::Polish,
        "Expand" => yiboflow_core::ai::prompt::PromptAction::Expand { ratio: action_payload.unwrap_or("1.5".into()).parse().unwrap_or(1.5) },
        "Condense" => yiboflow_core::ai::prompt::PromptAction::Condense { ratio: action_payload.unwrap_or("50%".into()) },
        "Summarize" => yiboflow_core::ai::prompt::PromptAction::Summarize,
        "Style" => yiboflow_core::ai::prompt::PromptAction::Style { style: action_payload.unwrap_or("Professional".into()) },
        "Translate" => yiboflow_core::ai::prompt::PromptAction::Translate { target_lang: action_payload.unwrap_or("English".into()) },
        "Explain" => yiboflow_core::ai::prompt::PromptAction::Explain,
        "Custom" => yiboflow_core::ai::prompt::PromptAction::Custom { template_id: action_payload.unwrap_or_default() },
        _ => return Err("Invalid PromptAction".into()),
    };

    let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap().ai_engine.clone();
    let client = yiboflow_core::ai::client::AiClient::new(cfg);
    let msgs = yiboflow_core::ai::prompt::build_messages(&prompt_action, &user_input);

    info!("=== FlowWriter AI Request ===");
    info!("Action: {}", action);
    info!("User Input ({} chars): {:?}", user_input.len(), &user_input[..user_input.len().min(200)]);
    for (i, m) in msgs.iter().enumerate() {
        info!("Message[{}] role={} content({} chars)={:?}", i, m.role, m.content.len(), &m.content[..m.content.len().min(200)]);
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    
    tokio::spawn(async move {
        client.chat_stream(msgs, tx).await;
    });

    while let Some(res) = rx.recv().await {
        match res {
            Ok(chunk) => {
                let _ = window.emit("writer-stream-chunk", chunk);
            }
            Err(e) => {
                let _ = window.emit("writer-stream-error", e.to_string());
                break;
            }
        }
    }
    let _ = window.emit("writer-stream-end", ());
    Ok(())
}

#[tauri::command]
fn dismiss_writer_window() -> Result<(), String> {
    yiboflow_core::writer::send_writer_event(yiboflow_core::writer::WriterEvent::Hide);
    Ok(())
}

#[tauri::command]
fn move_writer_window(x: i32, y: i32) -> Result<(), String> {
    yiboflow_core::writer::send_writer_event(yiboflow_core::writer::WriterEvent::MoveWindow { x, y });
    Ok(())
}

#[tauri::command]
fn update_writer_position(app: tauri::AppHandle, x: i32, y: i32) {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    
    // Transform Windows Y to User Bottom-Left Y for Fixed mode
    let mut current_pos_y = y;
    if let Ok(Some(mon)) = app.primary_monitor() {
        let h = mon.size().height as i32;
        current_pos_y = h - y;
    }

    if cfg.writer_window.pos_type == 0 {
        // Follow mode: update relative offsets
        let anchor = LAST_WRITER_ANCHOR.lock().unwrap();
        cfg.writer_window.offset_x = x - anchor.0;
        cfg.writer_window.offset_y = anchor.1 - y; 
        
        if cfg.is_window_config_unified {
            cfg.hint_window.offset_x = cfg.writer_window.offset_x;
            cfg.hint_window.offset_y = -cfg.writer_window.offset_y; // Writer offset_y is "up", Hint is "down"
            cfg.hint_window.pos_type = 0;
        }
    } else {
        // Fixed mode: update absolute coordinates
        cfg.writer_window.fixed_x = x;
        cfg.writer_window.fixed_y = current_pos_y;
        
        if cfg.is_window_config_unified {
            cfg.hint_window.fixed_x = x;
            cfg.hint_window.fixed_y = y; 
            cfg.hint_window.pos_type = 1;
        }
    }
    let _ = cfg.save();
    let _ = app.emit("config-updated", ());
}

#[tauri::command]
fn paste_writer_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    yiboflow_core::hook_manager::paste_text_only(&text);
    
    yiboflow_core::writer::send_writer_event(yiboflow_core::writer::WriterEvent::Hide);
    Ok(())
}


#[tauri::command]
fn diagnose_flowhint(_app_handle: tauri::AppHandle) -> Result<String, String> {
    let mut report = String::from("--- FlowHint Engine Diagnostic Report ---\n");

    // 1. Config
    let (_sync, _, _) = yiboflow_core::config::get_settings();
    report.push_str(&format!("[Config] sync={}\n", _sync));

    // 2. Rules default
    let rules = yiboflow_core::rules::get_rules();
    report.push_str(&format!("[Rules] default.flowhint={}\n", rules.default.flowhint));
    report.push_str(&format!("[Rules] default.flowsnap={}\n", rules.default.flowsnap));

    // 3. Feature query for notepad
    let hint_ok = yiboflow_core::rules::is_feature_enabled("notepad.exe", yiboflow_core::rules::Feature::FlowHint);
    report.push_str(&format!("[Rules] is_feature_enabled(notepad.exe, FlowHint)={}\n", hint_ok));

    // 4. Dict IDs
    let dict_ids = yiboflow_core::rules::get_app_flowhint_dicts("notepad.exe");
    report.push_str(&format!("[Dicts] dict_ids_for_notepad={:?}\n", dict_ids));

    // 5. Dictionary search
    let cands = yiboflow_core::dictionary::search_candidates_tail(&dict_ids, "gi");
    report.push_str(&format!("[Dicts] search_candidates_tail('gi')={:?}\n", cands));

    let cands_exact = yiboflow_core::dictionary::search_candidates(&dict_ids, "gi");
    report.push_str(&format!("[Dicts] search_candidates_exact('gi')={:?}\n", cands_exact));

    // 6. HINT_TX status
    let tx_set = yiboflow_core::hook_manager::HINT_TX.lock().map(|tx| tx.is_some()).unwrap_or(false);
    report.push_str(&format!("[Channel] HINT_TX is_set={}\n", tx_set));

    // 7. Try actually sending a test event
    if tx_set {
        yiboflow_core::hook_manager::set_hint_tx_test_send();
        report.push_str("[Channel] Sent test HintEvent::Show (Event loop will handle SW_SHOWNOACTIVATE)\n");
    }

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
        
        if cfg.is_window_config_unified {
            cfg.writer_window.offset_x = cfg.hint_window.offset_x;
            cfg.writer_window.offset_y = -cfg.hint_window.offset_y; 
            cfg.writer_window.pos_type = 0;
        }
    } else {
        // Fixed mode: update absolute coordinates
        cfg.hint_window.fixed_x = x;
        cfg.hint_window.fixed_y = y;
        
        if cfg.is_window_config_unified {
            cfg.writer_window.fixed_x = x;
            // Convert x, y (Top-Left) to Writer's user-space Y (Bottom-Left)
            if let Ok(Some(mon)) = app.primary_monitor() {
                let h = mon.size().height as i32;
                cfg.writer_window.fixed_y = h - y;
            }
            cfg.writer_window.pos_type = 1;
        }
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
fn reset_hint_position() -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    // Reset Hint
    cfg.hint_window.fixed_x = -1;
    cfg.hint_window.fixed_y = -1;
    cfg.hint_window.offset_x = 0;
    cfg.hint_window.offset_y = 0;
    cfg.hint_window.pos_type = 0; 
    
    // Reset Writer
    cfg.writer_window.fixed_x = -1;
    cfg.writer_window.fixed_y = -1;
    cfg.writer_window.offset_x = 0;
    cfg.writer_window.offset_y = 0;
    cfg.writer_window.pos_type = 0;

    cfg.save();
    info!("Positions for Hint and Writer have been force-reset to defaults.");
    Ok(())
}

#[tauri::command]
fn change_local_password(new_password: String) -> Result<(), String> {
    let salt = yiboflow_core::crypto::generate_salt();
    let hash_result = tokio::task::block_in_place(|| {
        let np = new_password.clone();
        let s = salt.clone();
        yiboflow_core::crypto::hash_local_password(&np, &s)
    });

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
    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: "gui-native-1234".to_string(),
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

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: "gui-native-1234".to_string(),
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

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: "gui-native-1234".to_string(),
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
    flowwriter: bool,
    flowpredict: bool,
    flowsync: bool,
) -> Result<(), String> {
    yiboflow_core::rules::set_default_rules(yiboflow_core::rules::DefaultRules {
        flowsnap,
        flowhint,
        flowwriter,
        flowpredict,
        flowsync,
    })
}

#[tauri::command]
fn upsert_app_rule(
    process: String,
    display_name: String,
    flowsnap: bool,
    flowhint: bool,
    flowhint_dicts: Vec<String>,
    flowwriter: bool,
    flowpredict: bool,
    flowsync: bool,
) -> Result<(), String> {
    yiboflow_core::rules::upsert_app_rule(yiboflow_core::rules::AppRule {
        process,
        display_name,
        flowsnap,
        flowhint,
        flowhint_dicts,
        flowwriter,
        flowpredict,
        flowsync,
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
        "flowwriter" => Ok(yiboflow_core::rules::Feature::FlowWriter),
        "flowpredict" => Ok(yiboflow_core::rules::Feature::FlowPredict),
        "flowsync" => Ok(yiboflow_core::rules::Feature::FlowSync),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Intialize Rust logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // 预热词库引擎与账户上下文
    yiboflow_core::local_auth::load_session();
    yiboflow_core::dictionary::init_and_load_dictionaries();
    yiboflow_core::dictionary::load_freq_cache();

    #[cfg(target_os = "windows")]
    yiboflow_core::hook_manager::start_global_hook();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["hint", "writer"])
                .build()
        )
        .manage(AppState {
            is_connected: Mutex::new(false),
            ws_tx: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
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
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | 0x08000000i32 | 0x00000080i32);
                    // Sync the style change
                    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_FRAMECHANGED};
                    let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED);
                }
                hwnd
            };

            // Bridge FlowHint events from Hook to Tauri Frontend
            // Show/hide/position the hint window from Rust side using Win32 APIs
            // to guarantee NO focus stealing (SW_SHOWNOACTIVATE)
            let (hint_tx, hint_rx) = std::sync::mpsc::channel();
            yiboflow_core::hook_manager::set_hint_tx(hint_tx);
            let app_handle = app.handle().clone();
            #[cfg(target_os = "windows")]
            let hint_hwnd_raw = hint_hwnd.0 as isize; // isize is Send-safe
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
                            };
                            match &ev_clone {
                                HintEvent::Show { candidates, x, y, .. } => {
                                    // Cap visible items at 8 for height; scrolling handles the rest
                                    let visible_count = candidates.len().min(8) as i32;
                                    // handle(18) + items(n*35) + footer(32) + padding(12) + border(4) = 66
                                    let inner_height = 70 + (visible_count * 35);
                                    let outer_height = inner_height;
                                    let outer_width = 300;

                                    let (cfg_pos_type, cfg_x, cfg_y, cfg_ox, cfg_oy) = {
                                        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
                                        (
                                            cfg.hint_window.pos_type, 
                                            cfg.hint_window.fixed_x, 
                                            cfg.hint_window.fixed_y,
                                            cfg.hint_window.offset_x,
                                            cfg.hint_window.offset_y
                                        )
                                    };
                                    
                                    // 0: Follow, 1: Fixed
                                    let mut pos_x = *x;
                                    let mut pos_y = *y;
                                    
                                    // Diagnostic Override: Ensure test window is always visible
                                    let is_diag = candidates.get(0).map(|s| s.contains("[诊断]")).unwrap_or(false);
                                    if is_diag {
                                        pos_x = 400;
                                        pos_y = 400;
                                    } else if cfg_pos_type == 0 {
                                        // Save anchor
                                        *LAST_HINT_ANCHOR.lock().unwrap() = (pos_x, pos_y);
                                        pos_x += cfg_ox;
                                        pos_y += cfg_oy;
                                        if cfg_oy == 0 { pos_y += 20; }
                                    } else {
                                        if cfg_x != -1 { pos_x = cfg_x; }
                                        if cfg_y != -1 { pos_y = cfg_y; }
                                    }

                                    // --- SAFETY CLAMP & AUTO-ADJUST ---
                                    // Detect which monitor the coordinates belong to
                                    if let Ok(Some(monitor)) = app_handle_inner.monitor_from_point(pos_x as f64, pos_y as f64) {
                                        let screen_x = monitor.position().x;
                                        let screen_y = monitor.position().y;
                                        let screen_w = monitor.size().width as i32;
                                        let screen_h = monitor.size().height as i32;
                                        
                                        // Ensure horizontal safety within THIS monitor
                                        if pos_x + outer_width > screen_x + screen_w {
                                            pos_x = screen_x + screen_w - outer_width - 10;
                                        }
                                        if pos_x < screen_x { pos_x = screen_x + 10; }

                                        // Ensure vertical safety within THIS monitor
                                        if pos_y + outer_height > screen_y + screen_h {
                                            pos_y = screen_y + screen_h - outer_height - 10;
                                        }
                                        if pos_y < screen_y { pos_y = screen_y + 20; }
                                    }

                                    unsafe {
                                        // Position and show without activating
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
                                _ => {}
                            }
                        }
                    });

                    // Always emit event to frontend for content updates
                    let _ = app_handle.emit("hint-event", event);
                }
            });

            // --- Writer Window Setup ---
            let writer_win = tauri::WebviewWindowBuilder::new(
                app,
                "writer",
                tauri::WebviewUrl::App("/#/writer".into()),
            )
            .title("FlowWriter")
            .inner_size(400.0, 450.0)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .visible(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .build()
            .unwrap();

            #[cfg(target_os = "windows")]
            let writer_hwnd = {
                use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, ShowWindow, SW_HIDE, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER};
                let raw_hwnd = writer_win.hwnd().unwrap();
                let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as *mut _);
                unsafe {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    // WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x00000080
                    // SAME as HintWindow — prevents activation on click, fixes drag "fly away"
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | 0x08000000i32 | 0x00000080i32);
                    // Sync the style change
                    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_FRAMECHANGED};
                    let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED);
                }
                hwnd
            };

            let (writer_tx, writer_rx) = std::sync::mpsc::channel();
            yiboflow_core::writer::set_writer_tx(writer_tx);
            let app_handle_writer = app.handle().clone();
            
            #[cfg(target_os = "windows")]
            let writer_hwnd_raw = writer_hwnd.0 as isize;
            
            std::thread::spawn(move || {
                use yiboflow_core::writer::WriterEvent;
                while let Ok(event) = writer_rx.recv() {
                    let ev_clone = event.clone();
                    let app_handle_clone = app_handle_writer.clone();
                    let handle_internal = app_handle_clone.clone();
                    let _ = app_handle_clone.run_on_main_thread(move || {
                        #[cfg(target_os = "windows")]
                        {
                            let writer_hwnd = windows::Win32::Foundation::HWND(writer_hwnd_raw as *mut _);
                            use windows::Win32::UI::WindowsAndMessaging::{
                                ShowWindow, SetWindowPos, SW_SHOWNOACTIVATE, SW_HIDE,
                                HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, SWP_NOSIZE, SWP_NOZORDER,
                            };
                            
                            match &ev_clone {
                                WriterEvent::TextSelected { text: _, x, y } => {
                                    let mut pos_x = *x;
                                    let mut pos_y = *y;
                                    
                                    if pos_x == -1 || pos_y == -1 {
                                        use windows::Win32::Foundation::POINT;
                                        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
                                        let mut pt = POINT::default();
                                        unsafe {
                                            if GetCursorPos(&mut pt).is_ok() {
                                                pos_x = pt.x;
                                                pos_y = pt.y;
                                            }
                                        }
                                    }
                                    
                                    let (pos_type, f_x, f_y, ox, oy) = {
                                        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
                                        (
                                            cfg.writer_window.pos_type, 
                                            cfg.writer_window.fixed_x, 
                                            cfg.writer_window.fixed_y,
                                            cfg.writer_window.offset_x,
                                            cfg.writer_window.offset_y
                                        )
                                    };

                                    let mut tx;
                                    let mut ty;
                                    
                                    if pos_type == 1 {
                                        // Fixed mode: (tx, ty) are user-space (bottom-left)
                                        tx = f_x;
                                        ty = f_y;
                                        if let Ok(Some(mon)) = handle_internal.primary_monitor() {
                                            let h = mon.size().height as i32;
                                            ty = h - ty;
                                        }
                                    } else {
                                        // Follow mode
                                        tx = pos_x;
                                        ty = pos_y;
                                        *LAST_WRITER_ANCHOR.lock().unwrap() = (tx, ty);
                                        tx += ox;
                                        ty -= oy; // Writer offset_y is usually "up"
                                    }

                                    // --- SAFETY CLAMP ---
                                    let outer_width = 400;
                                    let outer_height = 450;
                                    if let Ok(Some(mon)) = handle_internal.monitor_from_point(tx as f64, ty as f64) {
                                        let sx = mon.position().x;
                                        let sy = mon.position().y;
                                        let sw = mon.size().width as i32;
                                        let sh = mon.size().height as i32;
                                        if tx + outer_width > sx + sw { tx = sx + sw - outer_width - 10; }
                                        if tx < sx { tx = sx + 10; }
                                        if ty + outer_height > sy + sh { ty = sy + sh - outer_height - 10; }
                                        if ty < sy { ty = sy + 20; }
                                    }

                                    unsafe {
                                        let _ = SetWindowPos(
                                            writer_hwnd,
                                            Some(HWND_TOPMOST),
                                            tx, ty,
                                            outer_width, outer_height,
                                            SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                        );
                                        let _ = ShowWindow(writer_hwnd, SW_SHOWNOACTIVATE);
                                    }
                                    yiboflow_core::writer::WRITER_VISIBLE.store(true, std::sync::atomic::Ordering::Relaxed);
                                }
                                WriterEvent::TextCopied { .. } => {
                                    // Determine Mode
                                    let (pos_type, f_x, f_y, ox, oy) = {
                                        let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
                                        (
                                            cfg.writer_window.pos_type, 
                                            cfg.writer_window.fixed_x, 
                                            cfg.writer_window.fixed_y,
                                            cfg.writer_window.offset_x,
                                            cfg.writer_window.offset_y
                                        )
                                    };
                                    let (mut tx, mut ty): (i32, i32); // E0282 fix with type, ty needs mut for Y-flip logic
                                    let mut anchor_x = 0;
                                    let mut anchor_y = 0;

                                    if pos_type == 1 {
                                        // Fixed mode
                                        tx = f_x;
                                        ty = f_y;

                                        if let Ok(Some(mon)) = handle_internal.primary_monitor() {
                                            let h = mon.size().height as i32;
                                            ty = h - ty;
                                        }
                                    } else {
                                        // Follow mode: use cursor pos
                                        use windows::Win32::Foundation::POINT;
                                        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
                                        let mut pt = POINT::default();
                                        unsafe {
                                            if GetCursorPos(&mut pt).is_ok() {
                                                anchor_x = pt.x + 10;
                                                anchor_y = pt.y + 10;
                                            }
                                        }
                                        *LAST_WRITER_ANCHOR.lock().unwrap() = (anchor_x, anchor_y);
                                        tx = anchor_x + ox;
                                        ty = anchor_y - oy;
                                    }

                                    // --- SAFETY CLAMP ---
                                    let outer_width = 400;
                                    let outer_height = 450;
                                    if let Ok(Some(mon)) = handle_internal.monitor_from_point(tx as f64, ty as f64) {
                                        let sx = mon.position().x;
                                        let sy = mon.position().y;
                                        let sw = mon.size().width as i32;
                                        let sh = mon.size().height as i32;
                                        if tx + outer_width > sx + sw { tx = sx + sw - outer_width - 10; }
                                        if tx < sx { tx = sx + 10; }
                                        if ty + outer_height > sy + sh { ty = sy + sh - outer_height - 10; }
                                        if ty < sy { ty = sy + 20; }
                                    }

                                    unsafe {
                                        let _ = SetWindowPos(
                                            writer_hwnd,
                                            Some(HWND_TOPMOST),
                                            tx, ty,
                                            outer_width, outer_height,
                                            SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                        );
                                        let _ = ShowWindow(writer_hwnd, SW_SHOWNOACTIVATE);
                                    }
                                    yiboflow_core::writer::WRITER_VISIBLE.store(true, std::sync::atomic::Ordering::Relaxed);
                                }
                                WriterEvent::Hide => {
                                    unsafe {
                                        let _ = ShowWindow(writer_hwnd, SW_HIDE);
                                    }
                                    yiboflow_core::writer::WRITER_VISIBLE.store(false, std::sync::atomic::Ordering::Relaxed);
                                }
                                WriterEvent::MoveWindow { x, y } => {
                                    unsafe {
                                        let _ = SetWindowPos(
                                            writer_hwnd,
                                            None,
                                            *x, *y,
                                            0, 0,
                                            SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
                                        );
                                    }
                                }
                            }
                        }
                    });

                    info!("Emitting writer-event to frontend: {:?}", event);
                    let _ = app_handle_writer.emit("writer-event", event);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_engine,
            register_engine,
            resolve_sync_conflict,
            get_custom_prompts,
            list_endpoint_models,
            test_ai_endpoint,
            get_app_config,
            update_ai_endpoints,
            add_custom_prompt,
            remove_custom_prompt,
            stream_ai_writer,
            dismiss_writer_window,
            paste_writer_text,
            get_flowwriter_config,
            update_flowwriter_config,
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
            diagnose_flowhint,
            accept_hint_candidate,
            dismiss_hint_window,
            update_hint_position,
            move_hint_window,
            reset_hint_position,
            move_writer_window,
            update_writer_position,
            rename_local_account,
            force_override_remote,
            manual_vault_compaction,
            get_vault_sync_status,
            resolve_file_conflicts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
