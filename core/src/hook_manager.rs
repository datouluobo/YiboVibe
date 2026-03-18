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
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, HHOOK, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN,
    GetForegroundWindow, GetWindowThreadProcessId,
};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
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
        is_buffered: false,
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
    let source = hint_state.source.clone();
    let is_buffered = hint_state.is_buffered;
    let bs_count = hint_state.snap_backspace_count;
    hint_state.is_active = false;
    drop(hint_state);

    send_hint_event(HintEvent::Hide);
    KEY_BUFFER.lock().unwrap().clear();

    if source == HintSource::FlowSnapMulti || is_buffered {
        #[cfg(target_os = "windows")]
        std::thread::spawn(move || {
            replace_text_with_snippet(&candidate, bs_count);
        });
    } else {
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
}

/// Dismiss the hint window
pub fn dismiss_hint() {
    let mut hint_state = CURRENT_HINT.lock().unwrap();
    hint_state.is_active = false;
    drop(hint_state);
    send_hint_event(HintEvent::Hide);
}

#[cfg(target_os = "windows")]
unsafe fn get_caret_pos(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> {
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
}

#[derive(Debug, Clone)]
pub struct HintState {
    pub is_active: bool,
    pub candidates: Vec<String>,
    pub selected_index: usize,
    pub prefix_len: usize,
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

            let hook = match SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(hook_callback),
                hinstance,
                0,
            ) {
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
    if ncode >= 0 && wparam.0 as u32 == WM_KEYDOWN {
        let kb_struct = *(lparam.0 as *const KBDLLHOOKSTRUCT);
        if kb_struct.flags.0 & 0x10 != 0 {
            return CallNextHookEx(None, ncode, wparam, lparam);
        }

        let hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        
        let mut active_exe = String::new();
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) {
            let mut buffer = [0u16; MAX_PATH as usize];
            let len = GetModuleFileNameExW(handle, None, &mut buffer);
            if len > 0 {
                active_exe = String::from_utf16_lossy(&buffer[..len as usize]);
            }
        }

        let exe_name = std::path::Path::new(&active_exe)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let key_code = kb_struct.vkCode;
        let mut swallowed_char = false;
        let mut buf_changed = false;
        let mut hint_state = CURRENT_HINT.lock().unwrap();

        let snippets_active = crate::rules::is_feature_enabled(&exe_name, crate::rules::Feature::FlowSnap);
        let autofill_active = crate::rules::is_feature_enabled(&exe_name, crate::rules::Feature::FlowHint);

        if hint_state.is_active {
            if key_code == 0x0D { // Enter
                let idx = hint_state.selected_index;
                drop(hint_state);
                accept_hint_by_index(idx);
                return LRESULT(1);
            } else if key_code == 0x1B { // ESC
                hint_state.is_active = false;
                drop(hint_state);
                send_hint_event(HintEvent::Hide);
                KEY_BUFFER.lock().unwrap().clear();
                return LRESULT(1);
            } else if key_code == 0x26 { // Up
                if hint_state.selected_index > 0 {
                    hint_state.selected_index -= 1;
                    send_hint_event(HintEvent::UpdateSelection(hint_state.selected_index));
                }
                return LRESULT(1);
            } else if key_code == 0x28 { // Down
                if hint_state.selected_index + 1 < hint_state.candidates.len() {
                    hint_state.selected_index += 1;
                    send_hint_event(HintEvent::UpdateSelection(hint_state.selected_index));
                }
                return LRESULT(1);
            }
        }

        // IME Status Check
        use windows::Win32::UI::Input::Ime::{ImmGetDefaultIMEWnd, GCS_COMPSTR};
        use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_IME_CONTROL};
        let ime_wnd = ImmGetDefaultIMEWnd(hwnd);
        let is_ime_chinese_mode = if ime_wnd.0 != 0 {
            SendMessageW(ime_wnd, WM_IME_CONTROL, WPARAM(0x005), LPARAM(0)).0 != 0
        } else { false };

        log::info!("[FlowSnap-DBG] key=0x{:X} ime_cn={} exe={}", key_code, is_ime_chinese_mode, exe_name);
        // In Chinese mode, hide any active FlowHint popup (but do NOT clear the buffer,
        // because FlowSnap still needs the accumulated keystrokes to match triggers)
        if is_ime_chinese_mode && (0x41..=0x5A).contains(&key_code) {
            if hint_state.is_active && hint_state.source == HintSource::FlowHint {
                hint_state.is_active = false;
                send_hint_event(HintEvent::Hide);
            }
        }

        let is_shift = {
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_SHIFT};
            (GetKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0
        };

        if (0x41..=0x5A).contains(&key_code) {
            if let Some(ch) = std::char::from_u32(key_code + 32) {
                let mut buf = KEY_BUFFER.lock().unwrap();
                buf.push(ch); if buf.len() > 50 { buf.remove(0); }
                buf_changed = true;
            }
        } else if (0x30..=0x39).contains(&key_code) {
            let ch = if is_shift {
                match key_code {
                    0x31=>'!', 0x32=>'@', 0x33=>'#', 0x34=>'$', 0x35=>'%',
                    0x36=>'^', 0x37=>'&', 0x38=>'*', 0x39=>'(', 0x30=>')',
                    _ => std::char::from_u32(key_code).unwrap_or(' '),
                }
            } else { std::char::from_u32(key_code).unwrap_or(' ') };
            KEY_BUFFER.lock().unwrap().push(ch);
            buf_changed = true;
        } else if key_code == 0x08 { // Backspace
            if KEY_BUFFER.lock().unwrap().pop().is_some() { buf_changed = true; }
        } else if key_code == 0x20 { // Space
            let mut buf = KEY_BUFFER.lock().unwrap();
            buf.push(' '); if buf.len() > 50 { buf.remove(0); }
            buf_changed = true;
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
            };
            if let Some(c) = ch {
                let mut buf = KEY_BUFFER.lock().unwrap();
                buf.push(c); if buf.len() > 50 { buf.remove(0); }
                buf_changed = true;
            }
        }

        if !is_ime_chinese_mode { swallowed_char = true; }

        if buf_changed {
            let buf = KEY_BUFFER.lock().unwrap().clone();
            log::info!("[FlowSnap-DBG] buffer='{}' snippets_active={}", buf, snippets_active);
            let mut matched_trigger: Option<String> = None;
            let mut matched_replacements: Vec<String> = Vec::new();
            // FlowSnap: ALWAYS attempt matching regardless of IME state
            // (Chinese-mode replacement is handled via ESC+paste with 0 backspaces)
            if snippets_active {
                let snap_table = crate::smart_router::build_snap_table();
                for (trigger, replacements) in snap_table.iter() {
                    if buf.to_lowercase().ends_with(&trigger.to_lowercase()) {
                        if matched_trigger.as_ref().map_or(true, |t| trigger.len() > t.len()) {
                            matched_trigger = Some(trigger.clone());
                            matched_replacements = replacements.clone();
                        }
                    }
                }
            }

            drop(hint_state);
            let mut matched_snap = false;
            // 5. Apply FlowSnap
            if let Some(trigger) = matched_trigger {
                if !matched_replacements.is_empty() {
                    matched_snap = true;
                    // ALWAYS swallow the key that completed the match
                    swallowed_char = true; 
                    
                    // The universal undo math:
                    // If trigger is `gh (len 3), we swallowed 'h'. 
                    // So exactly 2 keys reached the OS (to IME or Editor).
                    // Sending 2 backspaces perfectly reverses this, universally closing any IME 
                    // compositions and erasing committed punctuation, regardless of IME brand.
                    let trigger_len = trigger.chars().count();
                    let bs_actual = trigger_len.saturating_sub(1);

                    if matched_replacements.len() == 1 {
                        KEY_BUFFER.lock().unwrap().clear();
                        let target = matched_replacements[0].clone();
                        thread::spawn(move || {
                            replace_text_with_snippet(&target, bs_actual);
                        });
                        return LRESULT(1);
                    } else {
                        let mut hs = CURRENT_HINT.lock().unwrap();
                        hs.is_active = true;
                        hs.candidates = matched_replacements.clone();
                        hs.selected_index = 0;
                        hs.source = HintSource::FlowSnapMulti;
                        hs.snap_backspace_count = bs_actual;
                        hs.is_buffered = false; // No longer needed
                        let (mut cx, mut cy) = (0, 0);
                        if let Some((px, py)) = unsafe { get_caret_pos(hwnd) } { cx = px; cy = py; }
                        send_hint_event(HintEvent::Show { 
                            candidates: matched_replacements.clone(), 
                            selected_index: 0, x: cx, y: cy 
                        });
                        return LRESULT(1);
                    }
                }
            }

            if !matched_snap && !is_ime_chinese_mode {
                let mut hs = CURRENT_HINT.lock().unwrap();
                if autofill_active && !buf.is_empty() {
                    let dict_ids = crate::rules::get_app_flowhint_dicts(&active_exe);
                    let cands = crate::dictionary::search_candidates_tail(&dict_ids, &buf);
                    if !cands.is_empty() {
                        hs.is_active = true; hs.candidates = cands.clone();
                        hs.selected_index = 0; hs.prefix_len = crate::dictionary::get_tail_match_prefix_len(&dict_ids, &buf);
                        hs.source = HintSource::FlowHint; hs.is_buffered = false;
                        let (mut cx, mut cy) = (0, 0);
                        if let Some((px, py)) = unsafe { get_caret_pos(hwnd) } { cx = px; cy = py; }
                        send_hint_event(HintEvent::Show { candidates: cands, selected_index: 0, x: cx, y: cy });
                    } else if hs.is_active { hs.is_active = false; send_hint_event(HintEvent::Hide); }
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, ncode, wparam, lparam) }
}

fn parse_hotkey(hk: &str) -> (bool, bool, bool, bool, u32) {
    let mut ctrl = false; let mut alt = false; let mut shift = false; let mut win = false;
    let mut key = 0;
    for p in hk.split('+') {
        let p_upper = p.trim().to_uppercase();
        match p_upper.as_str() {
            "CTRL" => ctrl = true,
            "ALT" => alt = true,
            "SHIFT" => shift = true,
            "WIN" => win = true,
            _ => {
                if p_upper.len() == 1 {
                    key = p_upper.chars().next().unwrap() as u32;
                } else if p_upper.eq("ENTER") {
                    key = 0x0D;
                } else if p_upper.eq("ESC") {
                    key = 0x1B;
                } else if p_upper.eq("SPACE") {
                    key = 0x20;
                }
            }
        }
    }
    (ctrl, alt, shift, win, key)
}

#[cfg(target_os = "windows")]
pub fn paste_text_only(text: &str) {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VIRTUAL_KEY};

    std::thread::sleep(Duration::from_millis(5));

    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let old_text_opt = clipboard.get_text().ok();
        let _ = clipboard.set_text(text);
        std::thread::sleep(Duration::from_millis(15));
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

#[cfg(target_os = "windows")]
fn replace_text_with_snippet(target: &str, backspace_count: usize) {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_BACK, VK_CONTROL, VIRTUAL_KEY};

    std::thread::sleep(Duration::from_millis(50));
    unsafe {
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
        std::thread::sleep(Duration::from_millis(30));

        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            let old_text_opt = clipboard.get_text().ok();
            let _ = clipboard.set_text(target);
            std::thread::sleep(Duration::from_millis(15));
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
