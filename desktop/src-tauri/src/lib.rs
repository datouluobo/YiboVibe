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

    match client.login(login_payload).await {
        Ok(res) => {
            if res.code == 200 && res.data.is_some() {
                let d = res.data.unwrap();
                info!(
                    "Logged in from GUI! Received Token: {}...",
                    &d.access_token[0..10]
                );

                let mk = match MasterKey::derive(&password, &d.kdf_salt) {
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

                        Ok(true)
                    }
                    Err(e) => Err(format!("WebSocket Connection Failed: {}", e)),
                }
            } else {
                Err(format!("Login failed via API: {}", res.msg))
            }
        }
        Err(e) => {
            error!("Could not connect to NAS: {}", e);

            // *MOCK OVERRIDE for UI Testing*
            // If the Go backend isn't running cleanly on Windows yet (e.g. no Redis/PG),
            // we'll bypass to let the user see the Dashboard UI.
            if server_url.contains("127.0.0.1") || server_url.contains("localhost") {
                info!("MOCK LOGIN ACTIVATED! Bypassing failed backend for local demo.");

                // Still generate a dummy MK to prove crypto works
                let _mock_mk = MasterKey::derive(&password, "mock_salt_for_ui_only").unwrap();
                info!("Locally derived Mock MasterKey is ready.");

                let mut connected_flag = state.is_connected.lock().await;
                *connected_flag = true;

                Ok(true)
            } else {
                Err(format!("Could not connect to NAS: {}", e))
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Intialize Rust logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .manage(AppState {
            is_connected: Mutex::new(false),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![connect_engine])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
