//! Window & Hint commands

use log::warn;
use std::hash::{Hash, Hasher};
use tauri::Emitter;
#[tauri::command]
pub fn get_window_under_cursor() -> Result<String, String> {
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
pub async fn start_app_picker(
    app: tauri::AppHandle,
    _window: tauri::WebviewWindow,
) -> Result<(), String> {
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        use std::thread::sleep;
        use std::time::Duration;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

        while (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000) != 0 {
            sleep(Duration::from_millis(20));
        }

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

        while (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000) != 0 {
            sleep(Duration::from_millis(20));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn update_key_mappings(
    mappings: Vec<yibovibe_core::hook_manager::KeyRemapEntry>,
) -> Result<(), String> {
    yibovibe_core::hook_manager::update_key_remap_table(mappings);
    Ok(())
}

#[tauri::command]
pub fn diagnose_flowhint() -> Result<String, String> {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
    Ok(format!(
        "min_chars={}, accept_tab={}, accept_right={}, dicts_loaded={}",
        cfg.flowhint_min_chars,
        cfg.flowhint_accept_tab,
        cfg.flowhint_accept_right,
        yibovibe_core::dictionary::get_all_dictionaries().len()
    ))
}

#[tauri::command]
pub fn accept_hint_candidate(index: usize) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_UNICODE, VIRTUAL_KEY,
        };

        let candidate = crate::find_dictionary_candidate(index);
        if let Some(text) = candidate {
            // Send text via Unicode keystrokes
            for ch in text.encode_utf16() {
                let mut input = INPUT::default();
                input.r#type = INPUT_KEYBOARD;
                input.Anonymous.ki = KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: ch,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                };
                unsafe {
                    let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
                }
            }
            Ok(())
        } else {
            Err("No candidate at index".to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    Err("FlowHint windows-only feature".to_string())
}

#[tauri::command]
pub fn dismiss_hint_window() -> Result<(), String> {
    crate::dismiss_hint_window_internal();
    Ok(())
}

#[tauri::command]
pub fn update_hint_position(x: i32, y: i32) -> Result<(), String> {
    let mut anchor = crate::LAST_HINT_ANCHOR.lock().unwrap();
    *anchor = (x, y);
    // update_hint_position — refactor later
    Ok(())
}

#[tauri::command]
pub fn move_hint_window(x: i32, y: i32) -> Result<(), String> {
    let mut anchor = crate::LAST_HINT_ANCHOR.lock().unwrap();
    *anchor = (x, y);
    // move_hint — refactor later
    Ok(())
}

#[tauri::command]
pub fn reset_hint_position() -> Result<(), String> {
    let mut anchor = crate::LAST_HINT_ANCHOR.lock().unwrap();
    *anchor = (400, 400);
    // move_hint — refactor later
    Ok(())
}

#[tauri::command]
pub fn set_hint_window_mode(mode: String) -> Result<(), String> {
    match mode.as_str() {
        "auto" | "fixed" | "disabled" => {
            let mut cfg = yibovibe_core::config::GLOBAL_CONFIG
                .write()
                .map_err(|e| e.to_string())?;
            cfg.hint_window.pos_type = if mode == "auto" { 0 } else { 1 };
            cfg.save();
            crate::refresh_hint_window_cfg();
            Ok(())
        }
        _ => Err(format!("Unknown hint mode: {}", mode)),
    }
}
