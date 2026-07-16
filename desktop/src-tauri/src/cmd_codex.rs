//! Codex Workbench commands — IPC bridge to Codex app-server

use crate::{
    broadcast_workbench_change, codex_app_server, git_branch_snapshot, git_command_output,
    prune_archived_thread_from_snapshot, remember_recently_archived_codex_thread,
    sync_codex_workbench_snapshot_to_server_handle, LAST_CODEX_WORKBENCH_SNAPSHOT,
};

#[tauri::command]
pub async fn codex_app_server_probe(
    request: crate::codex_app_server::CodexAppServerProbeRequest,
) -> Result<crate::codex_app_server::CodexAppServerProbeResponse, String> {
    codex_app_server::probe(request).await
}

#[tauri::command]
pub async fn codex_app_server_request(
    app: tauri::AppHandle,
    request: crate::codex_app_server::CodexAppServerRpcRequest,
) -> Result<serde_json::Value, String> {
    let method = request.method.clone();
    let thread_id = request
        .params
        .get("threadId")
        .or_else(|| request.params.get("conversationId"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string);
    let response = codex_app_server::persistent_request(app.clone(), request).await?;

    if method == "thread/archive" {
        let app_handle = app.clone();
        let archived_thread_id = thread_id.clone();
        if let Some(thread_id) = archived_thread_id.as_deref() {
            remember_recently_archived_codex_thread(thread_id);
            let mut cached = LAST_CODEX_WORKBENCH_SNAPSHOT.lock().unwrap();
            if let Some(snapshot) = cached.as_ref() {
                *cached = Some(prune_archived_thread_from_snapshot(snapshot, thread_id));
            }
        }
        tauri::async_runtime::spawn(async move {
            broadcast_workbench_change(
                &app_handle,
                "thread/archive",
                archived_thread_id.as_deref(),
            )
            .await;
            sync_codex_workbench_snapshot_to_server_handle(&app_handle).await;
        });
    }

    Ok(response)
}

#[tauri::command]
pub async fn switch_git_branch(
    app: tauri::AppHandle,
    cwd: String,
    branch: String,
) -> Result<serde_json::Value, String> {
    let trimmed_cwd = cwd.trim();
    let trimmed_branch = branch.trim();
    if trimmed_cwd.is_empty() || trimmed_branch.is_empty() {
        return Err("cwd and branch are required".to_string());
    }

    git_command_output(trimmed_cwd, &["checkout", trimmed_branch])?;
    let (current_branch, branches) = git_branch_snapshot(trimmed_cwd)
        .ok_or_else(|| "failed to read git branch state after checkout".to_string())?;

    {
        let mut cached = LAST_CODEX_WORKBENCH_SNAPSHOT.lock().unwrap();
        *cached = None;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        broadcast_workbench_change(&app_handle, "git/checkout", None).await;
        sync_codex_workbench_snapshot_to_server_handle(&app_handle).await;
    });

    Ok(serde_json::json!({
        "cwd": trimmed_cwd,
        "branch": current_branch,
        "branches": branches,
    }))
}

#[tauri::command]
pub async fn get_git_branch_state(cwd: String) -> Result<serde_json::Value, String> {
    let trimmed_cwd = cwd.trim();
    if trimmed_cwd.is_empty() {
        return Err("cwd is required".to_string());
    }
    let (current_branch, branches) = git_branch_snapshot(trimmed_cwd)
        .ok_or_else(|| "failed to read git branch state".to_string())?;
    Ok(serde_json::json!({
        "cwd": trimmed_cwd,
        "branch": current_branch,
        "branches": branches,
    }))
}

#[tauri::command]
pub async fn codex_app_server_reply_server_request(
    app: tauri::AppHandle,
    request_id: String,
    result: serde_json::Value,
) -> Result<(), String> {
    codex_app_server::respond_to_server_request(app, request_id, result).await
}

#[tauri::command]
pub async fn codex_app_server_respond_pending_approval(
    app: tauri::AppHandle,
    request_id: String,
    approved: bool,
) -> Result<(), String> {
    codex_app_server::respond_to_pending_approval(app, request_id, approved).await
}

#[tauri::command]
pub async fn codex_desktop_ipc_request(
    app: tauri::AppHandle,
    request: crate::codex_app_server::CodexDesktopIpcRequest,
) -> Result<serde_json::Value, String> {
    codex_app_server::desktop_ipc_request(app, request).await
}

#[tauri::command]
pub async fn codex_app_server_disconnect() -> Result<(), String> {
    codex_app_server::disconnect_persistent_session().await
}
