use log::{error, info};
use std::sync::Arc;
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
    state: tauri::State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
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
                info!("Logged in from GUI! Received Token: {}...", &d.access_token[0..10]);

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
                    Ok(ws_client) => {
                        info!("WS client created! Handshake sent implicitly.");
                        let arc_mk = Arc::new(mk);
                        let cb_monitor = ClipboardMonitor::new(arc_mk, ws_client.tx.clone());
                        cb_monitor.start_polling();

                        let mut connected_flag = state.is_connected.lock().await;
                        *connected_flag = true;
                        return Ok(true);
                    }
                    Err(e) => return Err(format!("WebSocket Connection Failed: {}", e)),
                }
            } else {
                api_err = format!("Login failed via API: {}", res.msg);
                if is_mock_target { needs_mock = true; }
            }
        }
        Err(e) => {
            api_err = format!("Could not connect to NAS: {}", e);
            if is_mock_target { needs_mock = true; }
        }
    }

    if needs_mock {
        info!("MOCK LOGIN ACTIVATED! Bypassing failed backend for local demo. Reason: {}", api_err);

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
            Ok(ws_client) => {
                info!("WS mockup connection established!");
                let arc_mk = Arc::new(mock_mk);
                let cb_monitor = ClipboardMonitor::new(arc_mk, ws_client.tx.clone());
                cb_monitor.start_polling();

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
            remove_snippet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
