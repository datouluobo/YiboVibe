//! Terminal session management commands

use crate::terminal;
use crate::AppState;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TerminalPrefs {
    pub default_shell: String,
}

#[derive(serde::Serialize)]
pub struct ConsoleAdminStatus {
    pub is_elevated: bool,
}

#[tauri::command]
pub async fn get_terminal_prefs() -> Result<TerminalPrefs, String> {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG
        .read()
        .map_err(|e| e.to_string())?;
    Ok(TerminalPrefs {
        default_shell: cfg.terminal_default_shell.clone(),
    })
}

#[tauri::command]
pub async fn set_terminal_prefs(
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
    let mut mgr = state.session_manager.lock().await;
    mgr.set_default_shell(&prefs.default_shell);
    Ok(())
}

#[tauri::command]
pub async fn start_terminal(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let mut mgr = state.session_manager.lock().await;
    let sid = mgr.create_session(None, None).await;
    mgr.start_session(&sid, &app, None).await?;
    Ok(sid)
}

#[tauri::command]
pub async fn write_terminal(
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
pub async fn kill_terminal(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut mgr = state.session_manager.lock().await;
    mgr.kill_session(&session_id).await?;
    drop(mgr);
    crate::sync_session_to_server(&state, "session:update", &session_id, None).await;
    Ok(())
}

#[tauri::command]
pub async fn create_session(
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
    crate::sync_session_to_server(&state, "session:register", &sid_clone, None).await;
    Ok(sid)
}

#[tauri::command]
pub async fn start_session(
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
    if let Some(ws_tx) = state.ws_tx.lock().await.clone() {
        mgr.start_session_with_ws(&session_id, &app, ws_tx, initial_size)
            .await?;
    } else {
        mgr.start_session(&session_id, &app, initial_size).await?;
    }
    drop(mgr);
    crate::sync_session_to_server(&state, "session:update", &session_id, None).await;
    Ok(())
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<terminal::SessionInfo>, String> {
    let mgr = state.session_manager.lock().await;
    Ok(mgr.list_sessions().await)
}

#[tauri::command]
pub async fn get_session_buffer(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let mgr = state.session_manager.lock().await;
    mgr.get_session_buffer(&session_id)
        .await
        .ok_or_else(|| format!("Session not found: {session_id}"))
}

#[tauri::command]
pub async fn remove_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    crate::mark_session_closing(&state, &session_id).await;
    let mut mgr = state.session_manager.lock().await;
    mgr.remove_session(&session_id).await?;
    drop(mgr);
    crate::sync_session_to_server(&state, "session:unregister", &session_id, None).await;
    Ok(())
}

#[tauri::command]
pub async fn resize_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut mgr = state.session_manager.lock().await;
    mgr.resize_session(&session_id, cols, rows).await
}

#[cfg(target_os = "windows")]
pub(crate) fn current_process_is_elevated() -> Result<bool, String> {
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
pub async fn get_console_admin_status() -> Result<ConsoleAdminStatus, String> {
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
pub async fn request_console_admin(app: tauri::AppHandle) -> Result<(), String> {
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
