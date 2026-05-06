#[cfg(target_os = "windows")]
use log::{error, info};
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{LPARAM, LRESULT, MAX_PATH, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(target_os = "windows")]
use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyboardState, INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP, SendInput, ToUnicode, VIRTUAL_KEY,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId,
    HHOOK, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
    WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

/// Maps OEM / layout keys (e.g. full-width ￥) and any key not covered by the ASCII branches.
#[cfg(target_os = "windows")]
fn key_event_to_unicode_char(vk: u32, scan: u32) -> Option<char> {
    let mut state = [0u8; 256];
    if unsafe { GetKeyboardState(&mut state) }.is_err() {
        return None;
    }
    let mut buf = [0u16; 8];
    let n = unsafe { ToUnicode(vk, scan, Some(&state), &mut buf, 0) };
    if n <= 0 {
        return None;
    }
    let take = (n as usize).min(buf.len());
    if let Ok(s) = String::from_utf16(&buf[..take]) {
        return s.chars().next().filter(|c| !c.is_control());
    }
    None
}
use std::collections::HashMap;

// ─── Key Remapping Support ───

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KeyRemapEntry {
    pub source_key: String,
    pub source_key_id: String,
    pub target_key: String,
    pub target_key_id: String,
    pub target_modifiers: Vec<String>,
    pub enabled: bool,
}

lazy_static::lazy_static! {
    static ref KEY_REMAP_TABLE: Mutex<Vec<KeyRemapEntry>> = Mutex::new(Vec::new());
}

pub fn update_key_remap_table(entries: Vec<KeyRemapEntry>) {
    if let Ok(mut table) = KEY_REMAP_TABLE.lock() {
        *table = entries;
        log::info!(
            "[FlowKeys] Remap table updated: {} active entries",
            table.iter().filter(|e| e.enabled).count()
        );
    }
}

/// Parse a key name to its VK code
fn key_name_to_vk(name: &str) -> Option<u32> {
    match name {
        "Backspace" => Some(0x08),
        "Tab" => Some(0x09),
        "Enter" => Some(0x0D),
        "Shift" | "ShiftLeft" | "ShiftRight" => Some(0x10),
        "Ctrl" | "ControlLeft" | "ControlRight" => Some(0x11),
        "Alt" | "AltLeft" | "AltRight" => Some(0x12),
        "Pause" => Some(0x13),
        "CapsLock" => Some(0x14),
        "Escape" => Some(0x1B),
        "Space" => Some(0x20),
        "PageUp" => Some(0x21),
        "PageDown" => Some(0x22),
        "End" => Some(0x23),
        "Home" => Some(0x24),
        "ArrowLeft" => Some(0x25),
        "ArrowUp" => Some(0x26),
        "ArrowRight" => Some(0x27),
        "ArrowDown" => Some(0x28),
        "Insert" => Some(0x2D),
        "Delete" => Some(0x2E),
        "Win" | "MetaLeft" | "MetaRight" => Some(0x5B),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        "NumLock" => Some(0x90),
        "ScrollLock" => Some(0x91),
        "PrintScreen" => Some(0x2C),
        "ContextMenu" => Some(0x5D),
        "Numpad0" => Some(0x60),
        "Numpad1" => Some(0x61),
        "Numpad2" => Some(0x62),
        "Numpad3" => Some(0x63),
        "Numpad4" => Some(0x64),
        "Numpad5" => Some(0x65),
        "Numpad6" => Some(0x66),
        "Numpad7" => Some(0x67),
        "Numpad8" => Some(0x68),
        "Numpad9" => Some(0x69),
        "NumpadMultiply" => Some(0x6A),
        "NumpadAdd" => Some(0x6B),
        "NumpadSubtract" => Some(0x6D),
        "NumpadDecimal" => Some(0x6E),
        "NumpadDivide" => Some(0x6F),
        "NumpadEnter" => Some(0x0D),
        s if s.starts_with("Key") && s.len() == 4 => {
            let c = s.chars().nth(3)?;
            if c.is_ascii_alphabetic() {
                Some(0x41 + (c as u32).wrapping_sub(b'A' as u32))
            } else {
                None
            }
        }
        s if s.starts_with("Digit") && s.len() == 6 => {
            let c = s.chars().nth(5)?;
            if c.is_ascii_digit() {
                Some(c as u32)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Check if the current key event matches a remap entry, and if so, simulate the target key
#[cfg(target_os = "windows")]
fn check_key_remap(vk_code: u32, _scan_code: u32, is_key_down: bool) -> bool {
    let table = match KEY_REMAP_TABLE.try_lock() {
        Ok(t) => t,
        Err(_) => return false,
    };

    if table.iter().filter(|e| e.enabled).count() == 0 {
        return false;
    }

    // Check per-process FlowKeys rule
    let hwnd = unsafe { GetForegroundWindow() };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    let my_pid = unsafe { windows::Win32::System::Threading::GetCurrentProcessId() };

    // Never remap keys in our own process
    if pid == my_pid {
        return false;
    }

    // Resolve exe name and check FlowKeys feature via cache
    {
        let mut cache = EXE_CACHE.lock().unwrap();
        let keys_enabled = if let Some(cached) = cache.get(&pid) {
            cached.keys_enabled
        } else {
            let mut active_exe = String::new();
            if let Ok(handle) =
                unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) }
            {
                let mut buffer = [0u16; MAX_PATH as usize];
                let len = unsafe { GetModuleFileNameExW(handle, None, &mut buffer) };
                if len > 0 {
                    active_exe = String::from_utf16_lossy(&buffer[..len as usize]);
                }
            }

            let name = std::path::Path::new(&active_exe)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();

            let s_active = crate::rules::is_feature_enabled(&name, crate::rules::Feature::FlowSnap);
            let a_active = crate::rules::is_feature_enabled(&name, crate::rules::Feature::FlowHint);
            let k_active = crate::rules::is_feature_enabled(&name, crate::rules::Feature::FlowKeys);

            cache.insert(
                pid,
                ProcessCache {
                    exe_name: name.clone(),
                    snap_enabled: s_active,
                    hint_enabled: a_active,
                    keys_enabled: k_active,
                },
            );
            k_active
        };

        if !keys_enabled {
            return false;
        }
    }

    for entry in table.iter() {
        if !entry.enabled {
            continue;
        }

        // Check if source key matches
        let source_vk = match key_name_to_vk(&entry.source_key_id) {
            Some(vk) => vk,
            None => continue,
        };

        if vk_code != source_vk {
            continue;
        }

        // Parse source modifiers from source_key (e.g. "Ctrl+Alt+K")
        let source_parts: Vec<&str> = entry.source_key.split('+').collect();
        let mut need_ctrl = false;
        let mut need_alt = false;
        let mut need_shift = false;
        let mut need_win = false;
        for part in &source_parts {
            match part.trim() {
                "Ctrl" => need_ctrl = true,
                "Alt" => need_alt = true,
                "Shift" => need_shift = true,
                "Win" => need_win = true,
                _ => {}
            }
        }

        // Check modifier state
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
        };
        let ctrl_down = (unsafe { GetAsyncKeyState(VK_CONTROL.0 as i32) } as u16 & 0x8000) != 0;
        let alt_down = (unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } as u16 & 0x8000) != 0;
        let shift_down = (unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } as u16 & 0x8000) != 0;
        let win_down = (unsafe { GetAsyncKeyState(VK_LWIN.0 as i32) } as u16 & 0x8000) != 0
            || (unsafe { GetAsyncKeyState(VK_RWIN.0 as i32) } as u16 & 0x8000) != 0;

        if ctrl_down != need_ctrl
            || alt_down != need_alt
            || shift_down != need_shift
            || win_down != need_win
        {
            continue;
        }

        // Match found! Swallow this key and send target
        if is_key_down {
            // Parse target key
            let target_vk = key_name_to_vk(&entry.target_key_id);
            let mut target_ctrl = false;
            let mut target_alt = false;
            let mut target_shift = false;
            let mut target_win = false;

            for mod_name in &entry.target_modifiers {
                match mod_name.as_str() {
                    "Ctrl" => target_ctrl = true,
                    "Alt" => target_alt = true,
                    "Shift" => target_shift = true,
                    "Win" => target_win = true,
                    _ => {}
                }
            }

            if let Some(tvk) = target_vk {
                std::thread::spawn(move || {
                    use std::time::Duration;
                    std::thread::sleep(Duration::from_millis(5));

                    let mut inputs: Vec<INPUT> = Vec::new();

                    // Release modifiers that differ
                    if need_ctrl && !target_ctrl {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_CONTROL;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }
                    if need_alt && !target_alt {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_MENU;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }
                    if need_shift && !target_shift {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_SHIFT;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }
                    if need_win && !target_win {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_LWIN;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }

                    // Press target modifiers
                    if target_ctrl && !need_ctrl {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_CONTROL;
                        inputs.push(down);
                    }
                    if target_alt && !need_alt {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_MENU;
                        inputs.push(down);
                    }
                    if target_shift && !need_shift {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_SHIFT;
                        inputs.push(down);
                    }
                    if target_win && !need_win {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_LWIN;
                        inputs.push(down);
                    }

                    // Press target key
                    let mut kd = INPUT::default();
                    kd.r#type = INPUT_KEYBOARD;
                    kd.Anonymous.ki.wVk = VIRTUAL_KEY(tvk as u16);
                    inputs.push(kd);

                    // Release target key
                    let mut ku = INPUT::default();
                    ku.r#type = INPUT_KEYBOARD;
                    ku.Anonymous.ki.wVk = VIRTUAL_KEY(tvk as u16);
                    ku.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                    inputs.push(ku);

                    // Restore target modifiers that were newly pressed
                    if target_ctrl && !need_ctrl {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_CONTROL;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }
                    if target_alt && !need_alt {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_MENU;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }
                    if target_shift && !need_shift {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_SHIFT;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }
                    if target_win && !need_win {
                        let mut up = INPUT::default();
                        up.r#type = INPUT_KEYBOARD;
                        up.Anonymous.ki.wVk = VK_LWIN;
                        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        inputs.push(up);
                    }

                    // Restore source modifiers that were released
                    if need_ctrl && !target_ctrl {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_CONTROL;
                        inputs.push(down);
                    }
                    if need_alt && !target_alt {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_MENU;
                        inputs.push(down);
                    }
                    if need_shift && !target_shift {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_SHIFT;
                        inputs.push(down);
                    }
                    if need_win && !target_win {
                        let mut down = INPUT::default();
                        down.r#type = INPUT_KEYBOARD;
                        down.Anonymous.ki.wVk = VK_LWIN;
                        inputs.push(down);
                    }

                    unsafe {
                        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
                    }
                });
            }
        }

        return true; // Swallow the original key
    }

    false
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum HintSource {
    FlowHint,
    FlowSnapMulti,
}

struct ProcessCache {
    exe_name: String,
    snap_enabled: bool,
    hint_enabled: bool,
    keys_enabled: bool,
}

lazy_static::lazy_static! {
    static ref KEY_BUFFER: Mutex<String> = Mutex::new(String::new());
    pub static ref CURRENT_HINT: Mutex<HintState> = Mutex::new(HintState {
        is_active: false,
        candidates: vec![],
        selected_index: 0,
        prefix_lens: vec![],
        source: HintSource::FlowHint,
        snap_backspace_count: 0,
        is_buffered: false,
    });
    static ref LAST_HWND: Mutex<isize> = Mutex::new(0);
    static ref EXE_CACHE: Mutex<HashMap<u32, ProcessCache>> = Mutex::new(HashMap::new());
}

pub fn invalidate_process_cache() {
    if let Ok(mut cache) = EXE_CACHE.lock() {
        cache.clear();
        log::info!("[FlowRules] Cleared per-process feature cache.");
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "data")]
pub enum HintEvent {
    Show {
        candidates: Vec<String>,
        selected_index: usize,
        x: i32,
        y: i32,
    },
    UpdateSelection(usize),
    Hide,
    MoveWindow {
        x: i32,
        y: i32,
    },
}

pub static HINT_TX: Mutex<Option<std::sync::mpsc::Sender<HintEvent>>> = Mutex::new(None);

pub fn set_hint_tx(tx: std::sync::mpsc::Sender<HintEvent>) {
    if let Ok(mut lock) = HINT_TX.lock() {
        *lock = Some(tx);
    }
}

fn send_hint_event(event: HintEvent) {
    if let Ok(lock) = HINT_TX.lock() {
        if let Some(tx) = lock.as_ref() {
            let _ = tx.send(event);
        }
    }
}

pub fn set_hint_tx_test_send() {
    send_hint_event(HintEvent::Show {
        candidates: vec![
            "[诊断] git init".to_string(),
            "[诊断] git status".to_string(),
        ],
        selected_index: 0,
        x: 300,
        y: 300,
    });
}

/// Accept a FlowHint candidate by index (called from frontend mouse click)
pub fn accept_hint_by_index(index: usize) {
    let mut data_opt = None;

    if let Ok(mut hs) = CURRENT_HINT.lock() {
        if hs.is_active && index < hs.candidates.len() {
            let candidate = hs.candidates[index].clone();
            let prefix_len = hs.prefix_lens.get(index).copied().unwrap_or(0);
            data_opt = Some((
                candidate,
                prefix_len,
                hs.source.clone(),
                hs.is_buffered,
                hs.snap_backspace_count,
            ));
            hs.is_active = false;
        }
    }

    if let Some((candidate, prefix_len, source, is_buffered, bs_count)) = data_opt {
        send_hint_event(HintEvent::Hide);
        if let Ok(mut buf) = KEY_BUFFER.lock() {
            buf.clear();
        }

        #[cfg(target_os = "windows")]
        std::thread::spawn(move || {
            // Try to restore the original window focus if clicked from Tauri UI
            if let Ok(last_hwnd_val) = LAST_HWND.lock().map(|h| *h) {
                if last_hwnd_val != 0 {
                    let hwnd = windows::Win32::Foundation::HWND(last_hwnd_val as _);
                    unsafe {
                        windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(30)); // allow focus sequence to finish
                }
            }

            if source == HintSource::FlowSnapMulti || is_buffered {
                replace_text_with_snippet(&candidate, bs_count);
            } else {
                let suffix: String = candidate.chars().skip(prefix_len).collect();
                if !suffix.is_empty() {
                    paste_text_only(&suffix);
                }
            }
        });
    }
}

/// Dismiss the hint window
pub fn dismiss_hint() {
    if let Ok(mut hint_state) = CURRENT_HINT.lock() {
        hint_state.is_active = false;
        drop(hint_state);
        send_hint_event(HintEvent::Hide);
    }
}

#[cfg(target_os = "windows")]
unsafe fn get_caret_pos(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::{GUITHREADINFO, GetGUIThreadInfo};

    let thread_id =
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, None) };
    let mut gui_info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };

    // 优先尝试获取文本光标位置
    if unsafe { GetGUIThreadInfo(thread_id, &mut gui_info) }.is_ok() && gui_info.hwndCaret.0 != 0 {
        let mut pt = POINT {
            x: gui_info.rcCaret.left,
            y: gui_info.rcCaret.bottom,
        };
        if unsafe { ClientToScreen(gui_info.hwndCaret, &mut pt) }.as_bool() {
            return Some((pt.x, pt.y));
        }
    }

    // 兜底：如果获取不到光标（如 VSCode/Chrome），则跟随物理鼠标指针
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT::default();
    if unsafe { GetCursorPos(&mut pt) }.is_ok() {
        return Some((pt.x, pt.y));
    }

    None
}

#[derive(Debug, Clone)]
pub struct HintState {
    pub is_active: bool,
    pub candidates: Vec<String>,
    pub selected_index: usize,
    pub prefix_lens: Vec<usize>,
    pub source: HintSource,
    pub snap_backspace_count: usize,
    pub is_buffered: bool,
}

#[cfg(target_os = "windows")]
static mut HHOOK_HANDLE: HHOOK = HHOOK(0);

#[cfg(target_os = "windows")]
pub fn start_global_hook() {
    thread::spawn(|| {
        info!("Initializing Win32 LowLevelKeyboardProc hook daemon...");
        unsafe {
            let hinstance = match GetModuleHandleW(None) {
                Ok(h) => h,
                Err(e) => {
                    error!("Failed to get module handle for Hook: {:?}", e);
                    return;
                }
            };

            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_callback), hinstance, 0) {
                Ok(h) => h,
                Err(e) => {
                    error!("Failed to install global keyboard hook: {:?}", e);
                    return;
                }
            };

            HHOOK_HANDLE = hook;
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(HHOOK_HANDLE);
        }
    });
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn hook_callback(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let is_key_down = wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;
    if ncode >= 0 && is_key_down {
        let kb_struct = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if kb_struct.flags.0 & 0x10 != 0 {
            return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
        }

        // ─── FlowKeys: Key Remapping (highest priority) ───
        if check_key_remap(kb_struct.vkCode, kb_struct.scanCode, true) {
            return LRESULT(1);
        }

        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0 != 0 {
            let mut pid = 0;
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            let my_pid = unsafe { windows::Win32::System::Threading::GetCurrentProcessId() };

            if pid != my_pid {
                if let Ok(mut lock) = LAST_HWND.try_lock() {
                    if *lock != hwnd.0 as isize {
                        // Window focus changed -> Reset key buffer to prevent cross-app triggers
                        if let Ok(mut buf) = KEY_BUFFER.try_lock() {
                            if !buf.is_empty() {
                                log::info!(
                                    "[FocusChange] Resetting key buffer. New HWND: 0x{:X}",
                                    hwnd.0
                                );
                                buf.clear();
                            }
                        }
                        *lock = hwnd.0 as isize;
                    }
                }
            } else {
                // Ignore our own windows for LAST_HWND tracking to ensure focus-restore works correctly
            }
        }

        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };

        // ---------------------------------------------------------
        // 1. Process cache: avoid OpenProcess on every keystroke
        // ---------------------------------------------------------

        let exe_name;
        let snippets_active;
        let autofill_active;

        {
            let mut cache = EXE_CACHE.lock().unwrap();
            if let Some(cached) = cache.get(&pid) {
                exe_name = cached.exe_name.clone();
                snippets_active = cached.snap_enabled;
                autofill_active = cached.hint_enabled;
            } else {
                let mut active_exe = String::new();
                if let Ok(handle) =
                    unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) }
                {
                    let mut buffer = [0u16; MAX_PATH as usize];
                    let len = unsafe { GetModuleFileNameExW(handle, None, &mut buffer) };
                    if len > 0 {
                        active_exe = String::from_utf16_lossy(&buffer[..len as usize]);
                    }
                }

                let name = std::path::Path::new(&active_exe)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let s_active =
                    crate::rules::is_feature_enabled(&name, crate::rules::Feature::FlowSnap);
                let a_active =
                    crate::rules::is_feature_enabled(&name, crate::rules::Feature::FlowHint);
                let k_active =
                    crate::rules::is_feature_enabled(&name, crate::rules::Feature::FlowKeys);

                cache.insert(
                    pid,
                    ProcessCache {
                        exe_name: name.clone(),
                        snap_enabled: s_active,
                        hint_enabled: a_active,
                        keys_enabled: k_active,
                    },
                );

                exe_name = name;
                snippets_active = s_active;
                autofill_active = a_active;
            }
        }

        let key_code = kb_struct.vkCode;
        let mut buf_changed = false;

        // 1. IME Status Check (MUST be first to inform subsequent logic)
        use windows::Win32::UI::Input::Ime::ImmGetDefaultIMEWnd;
        use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_IME_CONTROL};
        let ime_wnd = unsafe { ImmGetDefaultIMEWnd(hwnd) };
        let is_ime_chinese_mode = if ime_wnd.0 != 0 {
            unsafe { SendMessageW(ime_wnd, WM_IME_CONTROL, WPARAM(0x005), LPARAM(0)) }.0 != 0
        } else {
            false
        };

        log::debug!(
            "[FlowSnap-DBG] key=0x{:X} ime_cn={} exe={}",
            key_code,
            is_ime_chinese_mode,
            exe_name
        );

        // 2. Hint UI Logic (Using try_lock to be cross-thread safe)
        let hint_res = {
            if let Ok(mut hs) = CURRENT_HINT.try_lock() {
                let mut act = 0; // 0=none, 1=confirm, 2=hide, 3=up, 4=down
                let mut idx = 0;

                if hs.is_active {
                    let cfg = crate::config::GLOBAL_CONFIG.read().unwrap();
                    let accept_tab = cfg.flowhint_accept_tab;
                    let accept_right = cfg.flowhint_accept_right;
                    drop(cfg);
                    if (accept_tab && key_code == 0x09) || (accept_right && key_code == 0x27) {
                        idx = hs.selected_index;
                        act = 1;
                    } else if key_code == 0x1B {
                        // ESC
                        hs.is_active = false;
                        act = 2;
                    } else if key_code == 0x26 {
                        // Up
                        if hs.selected_index > 0 {
                            hs.selected_index -= 1;
                            idx = hs.selected_index;
                            act = 3;
                        }
                    } else if key_code == 0x28 {
                        // Down
                        if hs.selected_index + 1 < hs.candidates.len() {
                            hs.selected_index += 1;
                            idx = hs.selected_index;
                            act = 4;
                        }
                    }
                }

                // Add action for Chinese Mode auto-hide
                let mut ime_hide = false;
                if hs.is_active
                    && hs.source == HintSource::FlowHint
                    && is_ime_chinese_mode
                    && (0x41..=0x5A).contains(&key_code)
                {
                    hs.is_active = false;
                    ime_hide = true;
                }

                (act, idx, ime_hide)
            } else {
                (0, 0, false)
            }
        };

        if hint_res.2 {
            send_hint_event(HintEvent::Hide);
        }

        match hint_res.0 {
            1 => {
                accept_hint_by_index(hint_res.1);
                return LRESULT(1);
            }
            2 => {
                send_hint_event(HintEvent::Hide);
                if let Ok(mut buf) = KEY_BUFFER.lock() {
                    buf.clear();
                }
                return LRESULT(1);
            }
            3 | 4 => {
                send_hint_event(HintEvent::UpdateSelection(hint_res.1));
                return LRESULT(1);
            }
            _ => {}
        }

        let is_shift = {
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
            (unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } as u16 & 0x8000) != 0
        };

        let is_ctrl_alt_win = {
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN,
            };
            let ctrl = (unsafe { GetAsyncKeyState(VK_CONTROL.0 as i32) } as u16 & 0x8000) != 0;
            let alt = (unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } as u16 & 0x8000) != 0;
            let lwin = (unsafe { GetAsyncKeyState(VK_LWIN.0 as i32) } as u16 & 0x8000) != 0;
            let rwin = (unsafe { GetAsyncKeyState(VK_RWIN.0 as i32) } as u16 & 0x8000) != 0;
            ctrl || alt || lwin || rwin
        };

        if is_ctrl_alt_win {
            if let Ok(mut buf) = KEY_BUFFER.lock() {
                buf.clear();
            }
            if let Ok(mut hs) = CURRENT_HINT.lock() {
                if hs.is_active {
                    hs.is_active = false;
                    send_hint_event(HintEvent::Hide);
                }
            }
            return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
        }

        if (0x41..=0x5A).contains(&key_code) {
            if let Some(ch) = std::char::from_u32(key_code + 32) {
                if let Ok(mut buf) = KEY_BUFFER.lock() {
                    buf.push(ch);
                    if buf.len() > 50 {
                        buf.remove(0);
                    }
                    buf_changed = true;
                }
            }
        } else if (0x30..=0x39).contains(&key_code) {
            let ch = if is_shift {
                match key_code {
                    0x31 => '!',
                    0x32 => '@',
                    0x33 => '#',
                    0x34 => '$',
                    0x35 => '%',
                    0x36 => '^',
                    0x37 => '&',
                    0x38 => '*',
                    0x39 => '(',
                    0x30 => ')',
                    _ => std::char::from_u32(key_code).unwrap_or(' '),
                }
            } else {
                std::char::from_u32(key_code).unwrap_or(' ')
            };
            if let Ok(mut buf) = KEY_BUFFER.lock() {
                buf.push(ch);
                buf_changed = true;
            }
        } else if (0x60..=0x69).contains(&key_code) {
            // Numpad 0-9: distinct VK from main row; was ignored so buffers never saw digits
            if let Some(ch) = char::from_u32(0x30 + (key_code - 0x60)) {
                if let Ok(mut buf) = KEY_BUFFER.lock() {
                    buf.push(ch);
                    if buf.len() > 50 {
                        buf.remove(0);
                    }
                    buf_changed = true;
                }
            }
        } else if key_code == 0x08 {
            // Backspace
            if let Ok(mut buf) = KEY_BUFFER.lock() {
                if buf.pop().is_some() {
                    buf_changed = true;
                }
            }
        } else if key_code == 0x20 {
            // Space
            if let Ok(mut buf) = KEY_BUFFER.lock() {
                buf.push(' ');
                if buf.len() > 50 {
                    buf.remove(0);
                }
                buf_changed = true;
            }
        } else {
            let ch = match key_code {
                0xBF | 0x6F => Some(if is_shift { '?' } else { '/' }),
                0xBA => Some(if is_shift { ':' } else { ';' }),
                0xBC => Some(if is_shift { '<' } else { ',' }),
                0xBE => Some(if is_shift { '>' } else { '.' }),
                0xDE => Some(if is_shift { '"' } else { '\'' }),
                0xC0 => Some(if is_shift { '~' } else { '`' }),
                0xDB => Some(if is_shift { '{' } else { '[' }),
                0xDD => Some(if is_shift { '}' } else { ']' }),
                0xBB | 0x6B => Some(if is_shift { '+' } else { '=' }),
                0xBD | 0x6D => Some(if is_shift { '_' } else { '-' }),
                0xDC => Some(if is_shift { '|' } else { '\\' }),
                0x6A => Some('*'),
                0x6E => Some('.'),
                _ => None,
            }
            .or_else(|| {
                // Layout-specific symbols (e.g. full-width ￥) and keys not in the table above
                key_event_to_unicode_char(key_code, kb_struct.scanCode)
            });
            if let Some(c) = ch {
                if let Ok(mut buf) = KEY_BUFFER.lock() {
                    buf.push(c);
                    if buf.len() > 50 {
                        buf.remove(0);
                    }
                    buf_changed = true;
                }
            }
        }

        if buf_changed {
            let buf = if let Ok(b) = KEY_BUFFER.lock() {
                b.clone()
            } else {
                String::new()
            };
            log::debug!(
                "[FlowSnap-DBG] buffer='{}' snippets_active={}",
                buf,
                snippets_active
            );
            let mut matched_trigger: Option<String> = None;
            let mut matched_replacements: Vec<String> = Vec::new();
            // FlowSnap: ALWAYS attempt matching regardless of IME state
            if snippets_active {
                let snap_table = crate::smart_router::build_snap_table();
                let buf_lower = buf.to_lowercase();
                for (trigger, replacements) in snap_table.iter() {
                    if buf_lower.ends_with(&trigger.to_lowercase()) {
                        if matched_trigger
                            .as_ref()
                            .map_or(true, |t| trigger.len() > t.len())
                        {
                            matched_trigger = Some(trigger.clone());
                            matched_replacements = replacements.clone();
                        }
                    }
                }
            }

            // 5. Apply FlowSnap
            if let Some(trigger) = matched_trigger {
                if !matched_replacements.is_empty() {
                    if let Ok(mut buf_lock) = KEY_BUFFER.lock() {
                        buf_lock.clear();
                    }

                    let trigger_len = trigger.chars().count();
                    let bs_actual = trigger_len.saturating_sub(1);

                    if matched_replacements.len() == 1 {
                        let target = matched_replacements[0].clone();
                        thread::spawn(move || {
                            replace_text_with_snippet(&target, bs_actual);
                        });
                        return LRESULT(1);
                    } else {
                        if let Ok(mut hs) = CURRENT_HINT.lock() {
                            hs.is_active = true;
                            hs.candidates = matched_replacements.clone();
                            hs.selected_index = 0;
                            hs.source = HintSource::FlowSnapMulti;
                            hs.snap_backspace_count = bs_actual;
                            hs.is_buffered = false;

                            let (mut cx, mut cy) = (0, 0);
                            if let Some((px, py)) = unsafe { get_caret_pos(hwnd) } {
                                cx = px;
                                cy = py;
                            }
                            send_hint_event(HintEvent::Show {
                                candidates: matched_replacements.clone(),
                                selected_index: 0,
                                x: cx,
                                y: cy,
                            });
                        }
                        return LRESULT(1);
                    }
                }
            }

            if matched_replacements.is_empty() && !is_ime_chinese_mode {
                if autofill_active && !buf.is_empty() {
                    let dict_ids = crate::rules::get_app_flowhint_dicts(&exe_name);
                    let cands_with_len = crate::dictionary::search_candidates_tail(&dict_ids, &buf);
                    if !cands_with_len.is_empty() {
                        let cands: Vec<String> =
                            cands_with_len.iter().map(|(c, _)| c.clone()).collect();
                        let prefix_lens: Vec<usize> =
                            cands_with_len.iter().map(|(_, l)| *l).collect();
                        if let Ok(mut hs) = CURRENT_HINT.lock() {
                            hs.is_active = true;
                            hs.candidates = cands.clone();
                            hs.selected_index = 0;
                            hs.prefix_lens = prefix_lens;
                            hs.source = HintSource::FlowHint;
                            hs.is_buffered = false;
                            let (mut cx, mut cy) = (0, 0);
                            if let Some((px, py)) = unsafe { get_caret_pos(hwnd) } {
                                cx = px;
                                cy = py;
                            }
                            send_hint_event(HintEvent::Show {
                                candidates: cands,
                                selected_index: 0,
                                x: cx,
                                y: cy,
                            });
                        }
                    } else {
                        if let Ok(mut hs) = CURRENT_HINT.lock() {
                            if hs.is_active {
                                hs.is_active = false;
                                send_hint_event(HintEvent::Hide);
                            }
                        }
                    }
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, ncode, wparam, lparam) }
}

#[cfg(target_os = "windows")]
pub fn paste_text_only(text: &str) {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{KEYBDINPUT, KEYEVENTF_UNICODE};

    std::thread::sleep(Duration::from_millis(15));

    // Use Unicode input for maximum compatibility (bypasses clipboard issues in terminals)
    let utf16: Vec<u16> = text.encode_utf16().collect();
    let mut inputs: Vec<INPUT> = Vec::with_capacity(utf16.len() * 2);

    for &code in &utf16 {
        // Key down
        let mut kd = INPUT::default();
        kd.r#type = INPUT_KEYBOARD;
        kd.Anonymous.ki = KEYBDINPUT {
            wVk: VIRTUAL_KEY(0),
            wScan: code,
            dwFlags: KEYEVENTF_UNICODE,
            time: 0,
            dwExtraInfo: 0,
        };
        inputs.push(kd);

        // Key up
        let mut ku = INPUT::default();
        ku.r#type = INPUT_KEYBOARD;
        ku.Anonymous.ki = KEYBDINPUT {
            wVk: VIRTUAL_KEY(0),
            wScan: code,
            dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };
        inputs.push(ku);
    }

    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Helper to restore focus to the original window and paste text.
/// Used by text insertion and replacement flows after a window hop.
pub fn paste_to_last_focused_window(text: String) {
    let hwnd_val = {
        if let Ok(lock) = LAST_HWND.lock() {
            *lock
        } else {
            0
        }
    };

    std::thread::spawn(move || {
        if hwnd_val != 0 {
            log::info!(
                "[FocusRestore] Attempting to restore focus to HWND: 0x{:X}",
                hwnd_val
            );
            let hwnd = windows::Win32::Foundation::HWND(hwnd_val as _);
            unsafe {
                windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd);
            }
            // Increase wait time for the OS to complete window switching
            std::thread::sleep(std::time::Duration::from_millis(150));
        } else {
            log::warn!("[FocusRestore] No LAST_HWND recorded, pasting blindly.");
        }
        paste_text_only(&text);
    });
}

#[cfg(target_os = "windows")]
fn replace_text_with_snippet(target: &str, backspace_count: usize) {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VIRTUAL_KEY, VK_BACK, VK_CONTROL};

    std::thread::sleep(Duration::from_millis(30));
    unsafe {
        // 1. 发送退格键删除触发词
        if backspace_count > 0 {
            let mut inputs: Vec<INPUT> = Vec::new();
            for _ in 0..backspace_count {
                let mut kd = INPUT::default();
                kd.r#type = INPUT_KEYBOARD;
                kd.Anonymous.ki.wVk = VK_BACK;
                inputs.push(kd);

                let mut ku = INPUT::default();
                ku.r#type = INPUT_KEYBOARD;
                ku.Anonymous.ki.wVk = VK_BACK;
                ku.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                inputs.push(ku);
            }
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
        std::thread::sleep(Duration::from_millis(15));

        // 方案 A：针对中短文本，直接使用 Unicode 注入（无感替换，完全不碰剪切板）
        // 这里把阈值设为 300 字符，兼顾速度与稳定性
        if target.chars().count() < 300 {
            paste_text_only(target);
            return;
        }

        // 方案 B：长文本回退到剪切板模式（带影子检查与保护）
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            let old_text_opt = clipboard.get_text().ok();
            // Drop the clipboard instance immediately after reading old content
            drop(clipboard);

            // Update global cache before setting, to prevent sync loop
            if let Ok(mut last) = crate::clipboard::LAST_TEXT.lock() {
                *last = target.to_string();
            }

            // Re-open clipboard with retries to set new content
            let mut set_ok = false;
            for attempt in 0..5 {
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    if cb.set_text(target).is_ok() {
                        set_ok = true;
                        break;
                    }
                }
                if attempt + 1 < 5 {
                    std::thread::sleep(Duration::from_millis(30));
                }
            }
            if !set_ok {
                log::error!("[ShadowClipboard] Failed to set clipboard text after retries.");
                return;
            }

            // Execute Ctrl+V paste
            std::thread::sleep(Duration::from_millis(20));
            let vk_v = VIRTUAL_KEY(0x56);
            let mut inputs: Vec<INPUT> = Vec::new();
            let mut kd_ctrl = INPUT::default();
            kd_ctrl.r#type = INPUT_KEYBOARD;
            kd_ctrl.Anonymous.ki.wVk = VK_CONTROL;
            inputs.push(kd_ctrl);
            let mut kd_v = INPUT::default();
            kd_v.r#type = INPUT_KEYBOARD;
            kd_v.Anonymous.ki.wVk = vk_v;
            inputs.push(kd_v);
            let mut ku_v = INPUT::default();
            ku_v.r#type = INPUT_KEYBOARD;
            ku_v.Anonymous.ki.wVk = vk_v;
            ku_v.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
            inputs.push(ku_v);
            let mut ku_ctrl = INPUT::default();
            ku_ctrl.r#type = INPUT_KEYBOARD;
            ku_ctrl.Anonymous.ki.wVk = VK_CONTROL;
            ku_ctrl.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
            inputs.push(ku_ctrl);
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

            // Shadow restore logic: only restore if user hasn't copied new content
            if let Some(old_text) = old_text_opt {
                let target_owned = target.to_string();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(600));
                    // Open clipboard with retries to avoid conflicting with user operations
                    for attempt in 0..5 {
                        if let Ok(mut cb) = arboard::Clipboard::new() {
                            if let Ok(current) = cb.get_text() {
                                if current == target_owned {
                                    if let Ok(mut last) = crate::clipboard::LAST_TEXT.lock() {
                                        *last = old_text.clone();
                                    }
                                    let _ = cb.set_text(old_text);
                                    log::info!(
                                        "[ShadowClipboard] Context restored successfully (no sync loop)."
                                    );
                                } else {
                                    log::warn!(
                                        "[ShadowClipboard] User copied new content, skipping restoration."
                                    );
                                }
                            }
                            break;
                        }
                        if attempt + 1 < 5 {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                    }
                });
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn start_global_hook() {
    println!("Keyboard hook is only supported on Windows OS target.");
}
