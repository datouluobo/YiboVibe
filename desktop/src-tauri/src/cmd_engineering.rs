//! Engineering commands — engine registration, connection, and auth

use crate::AppState;
use yibovibe_core::api::{ApiClient, LoginRequest, RegisterRequest};
use yibovibe_core::ws::WsClient;

#[derive(serde::Serialize)]
pub struct ConnectResult {
    pub success: bool,
    pub role: String,
}

#[tauri::command]
pub async fn register_engine(
    server_url: String,
    username: String,
    password: String,
    password_hint: Option<String>,
) -> Result<bool, String> {
    log::info!(
        "Tauri Command Received: register_engine -> Server: {}, User: {}",
        server_url,
        username
    );

    if server_url == "local" {
        return yibovibe_core::local_auth::register_local_user(&username, &password);
    }

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

#[tauri::command]
pub async fn connect_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
    device_name: String,
) -> Result<ConnectResult, String> {
    log::info!(
        "Tauri Command: connect_engine -> Server: {}, User: {}",
        server_url,
        username
    );

    let config_fingerprint = {
        let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
        cfg.device_fingerprint.clone()
    };
    let runtime_fingerprint = crate::resolve_runtime_device_fingerprint(&config_fingerprint);
    let device_label = if device_name.trim().is_empty() {
        crate::resolve_runtime_device_name(&state).await
    } else {
        device_name.trim().to_string()
    };

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: device_label.clone(),
        device_type: "windows".to_string(),
        device_fingerprint: runtime_fingerprint,
    };

    let api_err;
    match client.login(login_payload).await {
        Ok(res) if res.code == 200 && res.data.is_some() => {
            let d = res.data.unwrap();
            let access_token = d
                .get("access_token")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let resp_kdf_salt = d
                .get("kdf_salt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let resp_device_id = d.get("device_id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

            let resp_user_role = d
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string();

            let vk_pwd = password.clone();
            let vk_salt = resp_kdf_salt;
            let vault_key = tokio::task::spawn_blocking(move || {
                yibovibe_core::sync::crypto::derive_vault_key(&vk_pwd, &vk_salt)
            })
            .await
            .map_err(|e| e.to_string())??;

            let ws = WsClient::connect(&server_url, &access_token)
                .await
                .map_err(|e| format!("WebSocket connect failed: {e}"))?;
            let (clipboard_tx, clipboard_rx) = tokio::sync::mpsc::channel(8);

            crate::spawn_ws_broker(
                ws.1,
                clipboard_tx,
                ws.0.tx.clone(),
                state.session_manager.clone(),
                app.clone(),
            );

            *state.is_connected.lock().await = true;
            *state.ws_tx.lock().await = Some(ws.0.tx.clone());
            *state.runtime_server_url.lock().await = Some(server_url);
            *state.runtime_username.lock().await = Some(username);
            *state.runtime_device_name.lock().await = Some(device_label);
            *state.runtime_remote_device_id.lock().await = Some(resp_device_id);
            *state.runtime_access_token.lock().await = Some(access_token);
            *state.runtime_role.lock().await = Some(resp_user_role.clone());

            // Start clipboard sync
            // clipboard_monitor::start — will be refactored in a later step

            // Sync sessions to server
            crate::sync_all_sessions_to_server_handle(&app).await;

            log::info!("Connection succeeded, role: {}", resp_user_role);
            return Ok(ConnectResult {
                success: true,
                role: resp_user_role,
            });
        }
        Ok(res) => {
            if res.code == 403 {
                return Err("账户登录失败: 密码错误".to_string());
            }
            api_err = format!("Login failed: code={} msg={}", res.code, res.msg);
        }
        Err(e) => {
            api_err = format!("Network Error: {}", e);
        }
    }

    // Fallback to offline login
    if server_url == "local" {
        *state.is_connected.lock().await = true;
        *state.runtime_server_url.lock().await = Some(server_url);
        *state.runtime_username.lock().await = Some(username);
        return Ok(ConnectResult {
            success: true,
            role: "user".to_string(),
        });
    }

    Err(api_err)
}

#[tauri::command]
pub async fn logout_engine(state: tauri::State<'_, AppState>) -> Result<bool, String> {
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
pub async fn get_user_role(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let role = state
        .runtime_role
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "user".to_string());
    Ok(role)
}
