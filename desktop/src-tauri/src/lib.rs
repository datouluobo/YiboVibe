use log::{error, info};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use yiboflow_core::api::{ApiClient, LoginRequest};
use yiboflow_core::clipboard::ClipboardMonitor;
use yiboflow_core::crypto::MasterKey;
use yiboflow_core::ws::WsClient;

// We can store shared state here later, like the WsClient channel for sending new text.
pub struct AppState {
    pub is_connected: Mutex<bool>,
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
        "Tauri Command Received: connect_engine -> Server: {}",
        server_url
    );

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: "gui-native-1234".to_string(),
    };

    let login_result = client.login(login_payload).await;

    let is_mock_target = server_url.contains("127.0.0.1") || server_url.contains("localhost");
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

                // Attempt WS connection
                match WsClient::connect(&server_url, &d.access_token).await {
                    Ok((ws_client, ws_rx)) => {
                        info!("WS client created! Handshake sent implicitly.");
                        let arc_mk = Arc::new(mk);
                        let cb_monitor =
                            ClipboardMonitor::new(server_url.clone(), d.access_token.clone(), arc_mk, ws_client.tx.clone(), Some(ui_tx));
                        cb_monitor.start_polling();
                        cb_monitor.start_receiving(ws_rx);

                        let mut connected_flag = state.is_connected.lock().await;
                        *connected_flag = true;
                        return Ok(true);
                    }
                    Err(e) => return Err(format!("WebSocket Connection Failed: {}", e)),
                }
            } else {
                api_err = format!("Login failed via API: {}", res.msg);
                if is_mock_target {
                    needs_mock = true;
                }
            }
        }
        Err(e) => {
            api_err = format!("Could not connect to NAS: {}", e);
            if is_mock_target {
                needs_mock = true;
            }
        }
    }

    if needs_mock {
        info!(
            "MOCK LOGIN ACTIVATED! Bypassing failed backend for local demo. Reason: {}",
            api_err
        );

        let pwd = password.clone();
        let mock_mk = tokio::task::spawn_blocking(move || {
            let mock_salt = yiboflow_core::crypto::generate_salt();
            MasterKey::derive(&pwd, &mock_salt).unwrap()
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))?;

        info!("Locally derived Mock MasterKey is ready.");

        // Connect to Mock Go Server
        match WsClient::connect(&server_url, "mock_token_for_testing").await {
            Ok((ws_client, ws_rx)) => {
                info!("WS mockup connection established!");
                let arc_mk = Arc::new(mock_mk);
                let cb_monitor = ClipboardMonitor::new(server_url.clone(), "mock_token_for_testing".to_string(), arc_mk, ws_client.tx.clone(), Some(ui_tx));
                cb_monitor.start_polling();
                cb_monitor.start_receiving(ws_rx);

                let mut connected_flag = state.is_connected.lock().await;
                *connected_flag = true;
                return Ok(true);
            }
            Err(e) => return Err(format!("Mock WebSocket Connection Failed: {}", e)),
        }
    }

    Err(api_err)
}

#[tauri::command]
fn get_snippets() -> Result<std::collections::HashMap<String, String>, String> {
    Ok(yiboflow_core::config::get_snippets())
}

#[tauri::command]
fn add_snippet(trigger: String, replacement: String) -> Result<(), String> {
    yiboflow_core::config::add_snippet(trigger, replacement)
}

#[tauri::command]
fn remove_snippet(trigger: String) -> Result<(), String> {
    yiboflow_core::config::remove_snippet(trigger)
}

#[derive(serde::Serialize)]
struct SettingsPayload {
    is_snippets_enabled: bool,
    is_sync_enabled: bool,
}

#[tauri::command]
fn get_settings() -> Result<SettingsPayload, String> {
    let (is_snippets_enabled, is_sync_enabled) = yiboflow_core::config::get_settings();
    Ok(SettingsPayload { is_snippets_enabled, is_sync_enabled })
}

#[tauri::command]
fn update_settings(is_snippets_enabled: bool, is_sync_enabled: bool) -> Result<(), String> {
    yiboflow_core::config::update_settings(is_snippets_enabled, is_sync_enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Intialize Rust logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    #[cfg(target_os = "windows")]
    yiboflow_core::hook_manager::start_global_hook();

    tauri::Builder::default()
        .manage(AppState {
            is_connected: Mutex::new(false),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            connect_engine,
            get_snippets,
            add_snippet,
            remove_snippet,
            get_settings,
            update_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
