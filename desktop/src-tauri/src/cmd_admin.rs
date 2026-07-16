//! Admin commands — user/device management

use crate::AppState;
use yibovibe_core::api::ApiClient;

#[tauri::command]
pub async fn admin_list_users(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<yibovibe_core::api::AdminUserInfo>, String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.admin_list_users(&token).await
}

#[tauri::command]
pub async fn admin_update_user_status(
    state: tauri::State<'_, AppState>,
    uid: u32,
    new_status: String,
) -> Result<(), String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client
        .admin_update_user_status(&token, uid, &new_status)
        .await
}

#[tauri::command]
pub async fn admin_delete_user(state: tauri::State<'_, AppState>, uid: u32) -> Result<(), String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.admin_delete_user(&token, uid).await
}

#[tauri::command]
pub async fn admin_reset_password(
    state: tauri::State<'_, AppState>,
    uid: u32,
    new_password: String,
    new_password_hint: String,
) -> Result<(), String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client
        .admin_reset_password(&token, uid, &new_password, &new_password_hint)
        .await
}

#[tauri::command]
pub async fn admin_list_devices(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<yibovibe_core::api::AdminDeviceInfo>, String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.admin_list_devices(&token).await
}

#[tauri::command]
pub async fn admin_kick_device(
    state: tauri::State<'_, AppState>,
    device_id: u32,
) -> Result<(), String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.admin_kick_device(&token, device_id).await
}

#[tauri::command]
pub async fn admin_delete_user_vault(
    state: tauri::State<'_, AppState>,
    uid: u32,
) -> Result<(), String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.admin_delete_user_vault(&token, uid).await
}

#[tauri::command]
pub async fn admin_get_flowsync_staging_policy(
    state: tauri::State<'_, AppState>,
) -> Result<yibovibe_core::api::FlowSyncStagingPolicy, String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.get_flowsync_staging_policy(&token).await
}

#[tauri::command]
pub async fn admin_update_flowsync_staging_policy(
    state: tauri::State<'_, AppState>,
    policy: yibovibe_core::api::FlowSyncStagingPolicy,
) -> Result<yibovibe_core::api::FlowSyncStagingPolicy, String> {
    let (server_url, token) = require_auth(&state).await?;
    let client = ApiClient::new(server_url);
    client.update_flowsync_staging_policy(&token, &policy).await
}

// Shared helper: extract auth from AppState
async fn require_auth(state: &tauri::State<'_, AppState>) -> Result<(String, String), String> {
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
