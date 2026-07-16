//! FlowProbe — network diagnostics and proxy commands

use crate::probe;

#[tauri::command]
pub fn get_probe_config() -> Result<probe::ProbeConfigPayload, String> {
    probe::get_probe_config()
}

#[tauri::command]
pub async fn save_probe_config(payload: probe::ProbeConfigPayload) -> Result<(), String> {
    probe::save_probe_config(payload).await
}

#[tauri::command]
pub async fn test_probe_credential(
    credential: probe::ProbeCredentialPayload,
) -> Result<probe::ProbeResult, String> {
    probe::test_credential(credential).await
}

#[tauri::command]
pub async fn test_probe_route(
    kind: yibovibe_core::config::ProbeRouteKind,
) -> Result<probe::ProbeResult, String> {
    probe::test_route(kind).await
}

#[tauri::command]
pub async fn list_probe_credential_models(
    credential: probe::ProbeCredentialPayload,
) -> Result<Vec<String>, String> {
    probe::list_credential_models(credential).await
}

#[tauri::command]
pub async fn list_probe_route_models(
    kind: yibovibe_core::config::ProbeRouteKind,
) -> Result<Vec<String>, String> {
    probe::list_route_models(kind).await
}

#[tauri::command]
pub async fn start_probe_proxy() -> Result<probe::ProbeProxyStatusPayload, String> {
    probe::start_proxy().await
}

#[tauri::command]
pub async fn stop_probe_proxy() -> Result<probe::ProbeProxyStatusPayload, String> {
    probe::stop_proxy().await
}

#[tauri::command]
pub async fn get_probe_dashboard() -> Result<probe::ProbeDashboardPayload, String> {
    probe::probe_dashboard().await
}

#[tauri::command]
pub async fn clear_probe_logs() -> Result<(), String> {
    probe::clear_proxy_logs().await
}
