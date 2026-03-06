#[cfg(target_os = "windows")]
use log::{error, info};
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM, MAX_PATH};
#[cfg(target_os = "windows")]
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(target_os = "windows")]
use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP, SendInput,
    VK_OEM_2,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, HHOOK, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN,
    GetForegroundWindow, GetWindowThreadProcessId,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HintSource {
    FlowHint,
    FlowSnapMulti,
}

lazy_static::lazy_static! {
    static ref KEY_BUFFER: Mutex<String> = Mutex::new(String::new());
    static ref CURRENT_HINT: Mutex<HintState> = Mutex::new(HintState {
        is_active: false,
        candidates: vec![],
        selected_index: 0,
        prefix_len: 0,
        source: HintSource::FlowHint,
        snap_backspace_count: 0,
    });
    static ref LAST_HWND: Mutex<isize> = Mutex::new(0);
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
    *HINT_TX.lock().unwrap() = Some(tx);
}

fn send_hint_event(event: HintEvent) {
    if let Some(tx) = HINT_TX.lock().unwrap().as_ref() {
        let _ = tx.send(event);
    }
}

pub fn set_hint_tx_test_send() {
    send_hint_event(HintEvent::Show {
        candidates: vec!["[诊断] git init".to_string(), "[诊断] git status".to_string()],
        selected_index: 0,
        x: 300,
        y: 300,
    });
}

/// Accept a FlowHint candidate by index (called from frontend mouse click)
pub fn accept_hint_by_index(index: usize) {
    let mut hint_state = CURRENT_HINT.lock().unwrap();
    if !hint_state.is_active || index >= hint_state.candidates.len() {
        return;
    }
    let candidate = hint_state.candidates[index].clone();
    let prefix_len = hint_state.prefix_len;
    hint_state.is_active = false;
    drop(hint_state);

    send_hint_event(HintEvent::Hide);
    KEY_BUFFER.lock().unwrap().clear();

    // Plan B: paste only the suffix
    let suffix: String = candidate.chars().skip(prefix_len).collect();
    if !suffix.is_empty() {
        #[cfg(target_os = "windows")]
        {
            std::thread::spawn(move || {
                paste_text_only(&suffix);
            });
        }
    }
}

/// Dismiss the hint window (called from diagnostic UI)
pub fn dismiss_hint() {
    let mut hint_state = CURRENT_HINT.lock().unwrap();
    hint_state.is_active = false;
    drop(hint_state);
    send_hint_event(HintEvent::Hide);
}

// ---------------------------------------------------------------------------
// Caret Coordinate Fetcher
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
unsafe fn get_caret_pos(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> { unsafe {
    use windows::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GUITHREADINFO};
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::ClientToScreen;

    let thread_id = windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, None);
    let mut gui_info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    if GetGUIThreadInfo(thread_id, &mut gui_info).is_ok()
        && gui_info.hwndCaret.0 != 0 {
            let mut pt = POINT { x: gui_info.rcCaret.left, y: gui_info.rcCaret.bottom };
            if ClientToScreen(gui_info.hwndCaret, &mut pt).as_bool() {
                return Some((pt.x, pt.y));
            }
        }
    None
}}

#[derive(Debug, Clone)]
pub struct HintState {
    pub is_active: bool,
    pub candidates: Vec<String>,
    pub selected_index: usize,
    pub prefix_len: usize,
    pub source: HintSource,
    pub snap_backspace_count: usize,
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

            let hook = match SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(hook_callback),
                hinstance,
                0, // Global hook attached to all desktop threads
            ) {
                Ok(h) => h,
                Err(e) => {
                    error!("Failed to install global keyboard hook: {:?}", e);
                    return;
                }
            };

            HHOOK_HANDLE = hook;
            info!("Win32 Keyboard Hook installed successfully. Message pump running.");

            let mut msg = MSG::default();
            // This blocks the thread and pumps window messages so the OS can call our Hook
            while GetMessageW(&mut msg, None, 0, 0).into() {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            UnhookWindowsHookEx(HHOOK_HANDLE).unwrap();
        }
    });
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn hook_callback(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // Only process WM_KEYDOWN for actual key presses, ignore keyup and sys messages unless needed
    if ncode >= 0 && wparam.0 as u32 == WM_KEYDOWN {
        let kb_struct = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };

        // Skip injected/synthetic events (from our own SendInput calls)
        // LLKHF_INJECTED = 0x10, LLKHF_LOWER_IL_INJECTED = 0x02
        if kb_struct.flags.0 & 0x10 != 0 {
            return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
        }

        let key_code = kb_struct.vkCode;



        let hwnd = unsafe { GetForegroundWindow() };

        // 0. Detect window switch → clear buffer to avoid cross-window pollution
        {
            let mut last_hwnd = LAST_HWND.lock().unwrap();
            let current_hwnd = hwnd.0 as isize;
            if current_hwnd != *last_hwnd {
                *last_hwnd = current_hwnd;
                KEY_BUFFER.lock().unwrap().clear();
                let mut hs = CURRENT_HINT.lock().unwrap();
                if hs.is_active {
                    hs.is_active = false;
                    send_hint_event(HintEvent::Hide);
                }
            }
        }


        // 2. Check FlowRules: per-feature per-app permission matrix
        let mut active_exe = String::new();
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0
                && let Ok(process_handle) = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) {
                    let mut buf = [0u16; MAX_PATH as usize];
                    let len = GetModuleFileNameExW(process_handle, None, &mut buf);
                    if len > 0 {
                        let mut current_exe = String::from_utf16_lossy(&buf[..len as usize]);
                        current_exe = current_exe.trim_matches('\0').to_string();
                        active_exe = current_exe.split('\\').next_back().unwrap_or("").to_lowercase();
                    }
                }
        }
        
        // Determine per-feature permission for the active foreground process
        let snap_allowed = if !active_exe.is_empty() {
            crate::rules::is_feature_enabled(&active_exe, crate::rules::Feature::FlowSnap)
        } else { true };
        let hint_allowed = if !active_exe.is_empty() {
            crate::rules::is_feature_enabled(&active_exe, crate::rules::Feature::FlowHint)
        } else { true };

        // Combine global toggle with per-app permission
        let snippets_active = snap_allowed;
        let autofill_active = hint_allowed;

        if !snippets_active && !autofill_active {
            KEY_BUFFER.lock().unwrap().clear();
            return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
        }

        let mut hint_state = CURRENT_HINT.lock().unwrap();

        // If FlowHint is active, hijack navigation & confirmation keys
        if hint_state.is_active {
            if key_code == 0x1B { // Esc: Hide Hint
                hint_state.is_active = false;
                send_hint_event(HintEvent::Hide);
                return LRESULT(1);
            } else if key_code == 0x26 { // Up: Select Previous
                if hint_state.selected_index > 0 {
                    hint_state.selected_index -= 1;
                    send_hint_event(HintEvent::UpdateSelection(hint_state.selected_index));
                }
                return LRESULT(1);
            } else if key_code == 0x28 { // Down: Select Next
                if hint_state.selected_index < hint_state.candidates.len().saturating_sub(1) {
                    hint_state.selected_index += 1;
                    send_hint_event(HintEvent::UpdateSelection(hint_state.selected_index));
                }
                return LRESULT(1);
            } else if key_code == crate::config::GLOBAL_CONFIG.read().unwrap().flowhint_accept_key { // Accept Candidate
                let candidate = hint_state.candidates[hint_state.selected_index].clone();
                let prefix_len = hint_state.prefix_len;
                let source = hint_state.source.clone();
                let snap_backspace_count = hint_state.snap_backspace_count;
                hint_state.is_active = false;
                send_hint_event(HintEvent::Hide);
                
                KEY_BUFFER.lock().unwrap().clear();

                // Bump word frequency
                crate::dictionary::bump_freq(&candidate);

                if source == HintSource::FlowSnapMulti {
                    drop(hint_state); // Release lock before spawning
                    thread::spawn(move || {
                        replace_text_with_snippet(&candidate, snap_backspace_count);
                    });
                } else {
                    // Plan B: paste only the suffix (what user hasn't typed yet)
                    let suffix: String = candidate.chars().skip(prefix_len).collect();
                    drop(hint_state); // Release lock before spawning
                    if !suffix.is_empty() {
                        thread::spawn(move || {
                            paste_text_only(&suffix);
                        });
                    }
                }
                return LRESULT(1); // Swallows Tab
            }
        }

        let mut buf_changed = false;
        let mut swallowed_char = false;

        // Detect IME Chinese mode using SendMessageW (cross-thread safe).
        // Use GetGUIThreadInfo to find the actual focused control (e.g. Edit in Notepad)
        // because IME context is attached to the focused control, not the top-level window.
        let is_ime_chinese_mode = unsafe {
            use windows::Win32::UI::Input::Ime::ImmGetDefaultIMEWnd;
            use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, GetGUIThreadInfo, GUITHREADINFO};

            // Get the focused hwnd via GetGUIThreadInfo
            let thread_id = GetWindowThreadProcessId(hwnd, None);
            let mut gui_info = GUITHREADINFO::default();
            gui_info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
            let target_hwnd = if GetGUIThreadInfo(thread_id, &mut gui_info).is_ok() && gui_info.hwndFocus.0 as usize != 0 {
                gui_info.hwndFocus
            } else {
                hwnd
            };

            let ime_wnd = ImmGetDefaultIMEWnd(target_hwnd);
            if ime_wnd.0 as usize != 0 {
                // WM_IME_CONTROL = 0x0283
                // IMC_GETOPENSTATUS = 0x0005, IMC_GETCONVERSIONMODE = 0x0001
                let open_status = SendMessageW(ime_wnd, 0x0283, WPARAM(0x0005), LPARAM(0));
                if open_status.0 != 0 {
                    let conv_mode = SendMessageW(ime_wnd, 0x0283, WPARAM(0x0001), LPARAM(0));
                    // IME_CMODE_NATIVE = 0x1 → Chinese input mode
                    (conv_mode.0 & 0x1) != 0
                } else {
                    false
                }
            } else {
                false
            }
        };

        // When switching into Chinese mode, clear the English buffer
        if is_ime_chinese_mode && (0x41..=0x5A).contains(&key_code) {
            let mut buf = KEY_BUFFER.lock().unwrap();
            if !buf.is_empty() {
                buf.clear();
                if hint_state.is_active {
                    hint_state.is_active = false;
                    send_hint_event(HintEvent::Hide);
                }
            }
        }

        if (0x41..=0x5A).contains(&key_code) && !is_ime_chinese_mode {
            if let Some(ch) = std::char::from_u32(key_code + 32) { // Lowercase a-z
                let mut buf = KEY_BUFFER.lock().unwrap();
                buf.push(ch);
                if buf.len() > 50 { buf.remove(0); }
                buf_changed = true;
                swallowed_char = true; // Potentially swallow if it completes a FlowSnap
            }
        } else if (0x30..=0x39).contains(&key_code) {
            if let Some(ch) = std::char::from_u32(key_code) { // 0-9
                KEY_BUFFER.lock().unwrap().push(ch);
                buf_changed = true;
                swallowed_char = true;
            }
        } else if (0x60..=0x69).contains(&key_code) {
            if let Some(ch) = std::char::from_u32(key_code - 0x60 + 0x30) { // Numpad 0-9
                KEY_BUFFER.lock().unwrap().push(ch);
                buf_changed = true;
                swallowed_char = true;
            }
        } else if key_code == VK_OEM_2.0 as u32 || key_code == 0x6F { // / (slash)
            KEY_BUFFER.lock().unwrap().push('/');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xBA { // VK_OEM_1 = ; (semicolon)
            KEY_BUFFER.lock().unwrap().push(';');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xBC { // VK_OEM_COMMA = , (comma)
            KEY_BUFFER.lock().unwrap().push(',');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xBE { // VK_OEM_PERIOD = . (period)
            KEY_BUFFER.lock().unwrap().push('.');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xDE { // VK_OEM_7 = ' (single quote)
            KEY_BUFFER.lock().unwrap().push('\'');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xC0 { // VK_OEM_3 = ` (backtick)
            KEY_BUFFER.lock().unwrap().push('`');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xDB { // VK_OEM_4 = [ (left bracket)
            KEY_BUFFER.lock().unwrap().push('[');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xDD { // VK_OEM_6 = ] (right bracket)
            KEY_BUFFER.lock().unwrap().push(']');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xBB { // VK_OEM_PLUS = = (equals)
            KEY_BUFFER.lock().unwrap().push('=');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0xBD { // VK_OEM_MINUS = - (minus/hyphen)
            KEY_BUFFER.lock().unwrap().push('-');
            buf_changed = true;
            swallowed_char = true;
        } else if key_code == 0x08 { // Backspace
            if KEY_BUFFER.lock().unwrap().pop().is_some() {
                buf_changed = true;
            }
        } else if key_code == 0x20 { // Space: add to buffer for multi-word matching (e.g. "git init")
            let mut buf_lock = KEY_BUFFER.lock().unwrap();
            buf_lock.push(' ');
            if buf_lock.len() > 50 { buf_lock.remove(0); }
            buf_changed = true;
        } else if key_code == 0x0D { // Enter: clear buffer
            let mut buf_lock = KEY_BUFFER.lock().unwrap();
            if !buf_lock.is_empty() {
                buf_lock.clear();
            }
            if hint_state.is_active {
                hint_state.is_active = false;
                send_hint_event(HintEvent::Hide);
            }
        }

        if buf_changed {
            let buf = KEY_BUFFER.lock().unwrap().clone();
            let mut matched_trigger: Option<String> = None;
            let mut matched_replacements: Vec<String> = Vec::new();

            // 1. Check FlowSnap
            if snippets_active {
                let snap_table = crate::smart_router::build_snap_table();
                let buf_lower = buf.to_lowercase();
                for (trigger, replacements) in snap_table.iter() {
                    let trigger_lower = trigger.to_lowercase();
                    if buf_lower.ends_with(&trigger_lower) {
                        // Support 1:N multi-match
                        if let Some(existing_trigger) = &matched_trigger {
                            if trigger == existing_trigger {
                                matched_replacements.extend(replacements.clone());
                            } else if trigger.len() > existing_trigger.len() {
                                // Prefer longer trigger match
                                matched_trigger = Some(trigger.clone());
                                matched_replacements = replacements.clone();
                            }
                        } else {
                            matched_trigger = Some(trigger.clone());
                            matched_replacements = replacements.clone();
                        }
                    }
                }
            }

            // Release the initial hint_state lock.
            // We'll re-acquire as needed in FlowSnap and FlowHint below.
            drop(hint_state);

            let mut matched_snap = false;
            // --- FlowSnap Processing ---
             if let Some(trigger) = matched_trigger
                && !matched_replacements.is_empty() {
                    matched_snap = true;
                    let trigger_len = trigger.chars().count();
                    // Swallow the last char (LRESULT(1)), so we need N-1 backspaces
                    let bs_count = if swallowed_char { trigger_len.saturating_sub(1) } else { trigger_len };
                    info!("[HOOK] FlowSnap 匹配成功! buf='{}', trigger='{}', bs_count={}, swallowed={}, replacements={:?}", 
                          buf, trigger, bs_count, swallowed_char, matched_replacements);

                    if matched_replacements.len() == 1 {
                        KEY_BUFFER.lock().unwrap().clear();
                        {
                            let mut hs = CURRENT_HINT.lock().unwrap();
                            if hs.is_active {
                                hs.is_active = false;
                                send_hint_event(HintEvent::Hide);
                            }
                        }

                        crate::dictionary::bump_freq(&matched_replacements[0]);

                        let target_clone = matched_replacements[0].clone();
                        thread::spawn(move || {
                            replace_text_with_snippet(&target_clone, bs_count);
                        });
                        // Swallow the last keystroke so it doesn't appear on screen
                        if swallowed_char {
                            return LRESULT(1);
                        }
                    } else {
                        // 1:N FlowSnap multi-match
                        {
                            let mut hs = CURRENT_HINT.lock().unwrap();
                            hs.is_active = true;
                            hs.candidates = matched_replacements.clone();
                            hs.selected_index = 0;
                            hs.source = HintSource::FlowSnapMulti;
                            hs.snap_backspace_count = bs_count;
                        }
                        
                        let (mut cx, mut cy) = (0, 0);
                        if let Some((px, py)) = unsafe { get_caret_pos(hwnd) } {
                            cx = px;
                            cy = py;
                        } else {
                            use windows::Win32::Foundation::POINT;
                            use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
                            let mut pt = POINT::default();
                            unsafe { if GetCursorPos(&mut pt).is_ok() {
                                cx = pt.x; cy = pt.y;
                            } }
                        }

                        send_hint_event(HintEvent::Show {
                            candidates: matched_replacements,
                            selected_index: 0,
                            x: cx,
                            y: cy,
                        });
                        
                        if swallowed_char {
                            return LRESULT(1);
                        }
                    }
                }

            // --- FlowHint Processing ---
            if !matched_snap {
                let mut hint_state = CURRENT_HINT.lock().unwrap();
                if autofill_active && !buf.is_empty() {
                    let dict_ids = crate::rules::get_app_flowhint_dicts(&active_exe);
                    if !dict_ids.is_empty() {
                        let cands = crate::dictionary::search_candidates_tail(&dict_ids, &buf);
                        if !cands.is_empty() {
                            hint_state.is_active = true;
                            hint_state.candidates = cands.clone();
                            hint_state.selected_index = 0;
                            hint_state.prefix_len = crate::dictionary::get_tail_match_prefix_len(&dict_ids, &buf);
                            hint_state.source = HintSource::FlowHint;
                            
                            let (mut cx, mut cy) = (0, 0);
                            if let Some((px, py)) = unsafe { get_caret_pos(hwnd) } {
                                cx = px;
                                cy = py;
                            } else {
                                use windows::Win32::Foundation::POINT;
                                use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
                                let mut pt = POINT::default();
                                unsafe { if GetCursorPos(&mut pt).is_ok() {
                                    cx = pt.x; cy = pt.y;
                                } }
                            }

                            info!("FlowHint Match Show: {:?}", cands);

                            send_hint_event(HintEvent::Show {
                                candidates: cands,
                                selected_index: 0,
                                x: cx,
                                y: cy,
                            });
                        } else if hint_state.is_active {
                            hint_state.is_active = false;
                            send_hint_event(HintEvent::Hide);
                        }
                    }
                } else if hint_state.is_active && buf.is_empty() {
                    hint_state.is_active = false;
                    send_hint_event(HintEvent::Hide);
                }
            }
        }
    }

    // Pass the control to next hook chain
    unsafe { CallNextHookEx(None, ncode, wparam, lparam) }
}

/// Plan B: paste text via clipboard without any backspace deletion
/// Used by FlowHint to append the remaining suffix of a candidate
#[cfg(target_os = "windows")]
fn paste_text_only(text: &str) {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VIRTUAL_KEY};

    std::thread::sleep(Duration::from_millis(5));

    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let old_text_opt = clipboard.get_text().ok();
        let _ = clipboard.set_text(text);
        std::thread::sleep(Duration::from_millis(8));

        unsafe {
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
        }

        // Restore old clipboard after delay
        if let Some(old_text) = old_text_opt {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    let _ = cb.set_text(old_text);
                }
            });
        }
    }
}

/// Deletes trigger text via Backspace then pastes replacement via clipboard Ctrl+V.
#[cfg(target_os = "windows")]
fn replace_text_with_snippet(target: &str, backspace_count: usize) {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_BACK, VK_CONTROL, VIRTUAL_KEY};

    // Wait for the OS to finish processing the current keystroke
    std::thread::sleep(Duration::from_millis(50));

    unsafe {
        // 1. Erase the typed trigger with backspaces
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

        // Wait for the app to process backspaces
        std::thread::sleep(Duration::from_millis(30));

        // 2. Insert replacement text via clipboard paste
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            let old_text_opt = clipboard.get_text().ok();

            let _ = clipboard.set_text(target);
            std::thread::sleep(Duration::from_millis(15));

            // Simulate Ctrl+V
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

            // Restore old clipboard content after a delay
            if let Some(old_text) = old_text_opt {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(500));
                    if let Ok(mut cb) = arboard::Clipboard::new() {
                        let _ = cb.set_text(old_text);
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
