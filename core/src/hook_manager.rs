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
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, HHOOK, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    GetForegroundWindow, GetWindowThreadProcessId,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP, SendInput, VK_CONTROL, VK_MENU, VIRTUAL_KEY,
};

const VK_C: VIRTUAL_KEY = VIRTUAL_KEY(0x43);

#[cfg(target_os = "windows")]
fn send_ctrl_c() {
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_SHIFT, VK_LWIN, VK_RWIN};
        
        let mut inputs = Vec::new();
        
        // 1. 记录当前按键状态并准备释放修饰键
        // 这一步很重要，防止 Ctrl+C 变成 Ctrl+Alt+C 或其他组合键
        for vk in [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN] {
            let mut input = INPUT::default();
            input.r#type = INPUT_KEYBOARD;
            input.Anonymous.ki.wVk = vk;
            input.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
            inputs.push(input);
        }

        // 2. 模拟按下 Ctrl+C
        let modifiers = [VK_CONTROL, VK_C];
        for vk in modifiers {
            let mut down = INPUT::default();
            down.r#type = INPUT_KEYBOARD;
            down.Anonymous.ki.wVk = vk;
            inputs.push(down);
        }
        for vk in modifiers.iter().rev() {
            let mut up = INPUT::default();
            up.r#type = INPUT_KEYBOARD;
            up.Anonymous.ki.wVk = *vk;
            up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
            inputs.push(up);
        }

        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}




lazy_static::lazy_static! {
    static ref KEY_BUFFER: Mutex<String> = Mutex::new(String::new());
    static ref CURRENT_HINT: Mutex<HintState> = Mutex::new(HintState {
        is_active: false,
        candidates: vec![],
        selected_index: 0,
        prefix_lens: vec![],
        snap_backspace_count: 0,
        is_buffered: false,
    });
    static ref LAST_HWND: Mutex<isize> = Mutex::new(0);
}



#[cfg(target_os = "windows")]
unsafe fn get_caret_pos(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> {
    use windows::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GUITHREADINFO};
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::ClientToScreen;

    let thread_id = unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, None) };
    let mut gui_info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    
    // 优先尝试获取文本光标位置
    if unsafe { GetGUIThreadInfo(thread_id, &mut gui_info) }.is_ok()
        && gui_info.hwndCaret.0 != 0 {
            let mut pt = POINT { x: gui_info.rcCaret.left, y: gui_info.rcCaret.bottom };
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
    let is_key_down = wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;
    if ncode >= 0 && is_key_down {
        let kb_struct = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if kb_struct.flags.0 & 0x10 != 0 {
            return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
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
                                log::info!("[FocusChange] Resetting key buffer. New HWND: 0x{:X}", hwnd.0);
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
        // 1. FlowWriter Hotkey Check (Alt+Q by default)
        // ---------------------------------------------------------


        let mut active_exe = String::new();
        if let Ok(handle) = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) } {
            let mut buffer = [0u16; MAX_PATH as usize];
            let len = unsafe { GetModuleFileNameExW(handle, None, &mut buffer) };
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
        
        // 1. IME Status Check (MUST be first to inform subsequent logic)
        use windows::Win32::UI::Input::Ime::ImmGetDefaultIMEWnd;
        use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_IME_CONTROL};
        let ime_wnd = unsafe { ImmGetDefaultIMEWnd(hwnd) };
        let is_ime_chinese_mode = if ime_wnd.0 != 0 {
            unsafe { SendMessageW(ime_wnd, WM_IME_CONTROL, WPARAM(0x005), LPARAM(0)) }.0 != 0
        } else { false };

        log::info!("[FlowSnap-DBG] key=0x{:X} ime_cn={} exe={}", key_code, is_ime_chinese_mode, exe_name);

        // 2. Feature Check (FlowSnap only now, FlowHint/Xianzhi removed)
        let snippets_active = crate::rules::is_feature_enabled(&exe_name, crate::rules::Feature::FlowSnap);






        let is_shift = {
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
            (unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } as u16 & 0x8000) != 0
        };

        if (0x41..=0x5A).contains(&key_code) {
            if let Some(ch) = std::char::from_u32(key_code + 32) {
                if let Ok(mut buf) = KEY_BUFFER.lock() {
                    buf.push(ch); if buf.len() > 50 { buf.remove(0); }
                    buf_changed = true;
                }
            }
        } else if (0x30..=0x39).contains(&key_code) {
            let ch = if is_shift {
                match key_code {
                    0x31=>'!', 0x32=>'@', 0x33=>'#', 0x34=>'$', 0x35=>'%',
                    0x36=>'^', 0x37=>'&', 0x38=>'*', 0x39=>'(', 0x30=>')',
                    _ => std::char::from_u32(key_code).unwrap_or(' '),
                }
            } else { std::char::from_u32(key_code).unwrap_or(' ') };
            if let Ok(mut buf) = KEY_BUFFER.lock() {
                buf.push(ch);
                buf_changed = true;
            }
        } else if key_code == 0x08 { // Backspace
            if let Ok(mut buf) = KEY_BUFFER.lock() {
                if buf.pop().is_some() { buf_changed = true; }
            }
        } else if key_code == 0x20 { // Space
            if let Ok(mut buf) = KEY_BUFFER.lock() {
                buf.push(' '); if buf.len() > 50 { buf.remove(0); }
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
            };
            if let Some(c) = ch {
                if let Ok(mut buf) = KEY_BUFFER.lock() {
                    buf.push(c); if buf.len() > 50 { buf.remove(0); }
                    buf_changed = true;
                }
            }
        }

        if !is_ime_chinese_mode { let _ = swallowed_char; swallowed_char = true; }

        if buf_changed {
            let buf = if let Ok(b) = KEY_BUFFER.lock() { b.clone() } else { String::new() };
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

            // hint_state_opt lock released automatically
            let mut matched_snap = false;
            // 5. Apply FlowSnap
            if let Some(trigger) = matched_trigger {
                if !matched_replacements.is_empty() {
                    matched_snap = true;
                    if let Ok(mut buf_lock) = KEY_BUFFER.lock() { buf_lock.clear(); }
                    
                    let trigger_len = trigger.chars().count();
                    let bs_actual = trigger_len.saturating_sub(1);

                    if matched_replacements.len() == 1 {
                        let target = matched_replacements[0].clone();
                        thread::spawn(move || {
                            replace_text_with_snippet(&target, bs_actual);
                        });
                        return LRESULT(1);
                    } else {
                        // Since HintWindow is deleted, FlowSnapMulti defaults to picking first candidate
                        let target = matched_replacements[0].clone();
                        thread::spawn(move || {
                            replace_text_with_snippet(&target, bs_actual);
                        });
                        return LRESULT(1);
                    }
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
                    key = p_upper.chars().next().unwrap_or('\0') as u32;
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

/// Helper to restore focus to original window and paste text.
/// Designed for FlowWriter insert/replace actions.
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
            log::info!("[FocusRestore] Attempting to restore focus to HWND: 0x{:X}", hwnd_val);
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
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_BACK, VK_CONTROL, VIRTUAL_KEY};

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
            
            // 关键：在设置剪切板前，先更新全局缓存，防止监听器误触发同步
            if let Ok(mut last) = crate::clipboard::LAST_TEXT.lock() {
                *last = target.to_string();
            }
            let _ = clipboard.set_text(target);
            
            // 执行粘贴
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

            // 影子保护逻辑：仅当剪切板内容没被用户手动更改时，才进行还原
            if let Some(old_text) = old_text_opt {
                let target_owned = target.to_string();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(500));
                    if let Ok(mut cb) = arboard::Clipboard::new() {
                        if let Ok(current) = cb.get_text() {
                            // 关键判断：如果当前内容还是我们要注入的那个片段，说明用户没在期间复制
                            if current == target_owned {
                                // 还原前也需更新缓存，避免还原本身触发同步回读
                                if let Ok(mut last) = crate::clipboard::LAST_TEXT.lock() {
                                    *last = old_text.clone();
                                }
                                let _ = cb.set_text(old_text);
                                log::info!("[ShadowClipboard] Context restored successfully (no sync loop).");
                            } else {
                                log::warn!("[ShadowClipboard] User copied new content, skipping restoration.");
                            }
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
