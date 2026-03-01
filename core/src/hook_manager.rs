#[cfg(target_os = "windows")]
use log::{error, info};
#[cfg(target_os = "windows")]
use std::ptr::null_mut;
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::ffi::OsString;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStringExt;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM, MAX_PATH};
#[cfg(target_os = "windows")]
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(target_os = "windows")]
use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::Ime::{ImmGetContext, ImmGetOpenStatus, ImmReleaseContext};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput,
    VK_OEM_2,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, HHOOK, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    GetForegroundWindow, GetWindowThreadProcessId,
};

#[cfg(target_os = "windows")]
lazy_static::lazy_static! {
    static ref KEY_BUFFER: Mutex<String> = Mutex::new(String::new());
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
        let (snippets_enabled, _) = crate::config::get_settings();
        if !snippets_enabled {
            return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
        }

        let hwnd = unsafe { GetForegroundWindow() };

        // 1. Check IME Open Status
        let mut is_composing = false;
        unsafe {
            let himc = ImmGetContext(hwnd);
            if himc.0 != 0 {
                let status = ImmGetOpenStatus(himc);
                is_composing = status.as_bool();
                ImmReleaseContext(hwnd, himc);
            }
        }
        if is_composing {
            KEY_BUFFER.lock().unwrap().clear();
            return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
        }

        // 2. Check Blacklist
        let mut active_exe = String::new();
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0 {
                if let Ok(process_handle) = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) {
                    let mut buf = [0u16; MAX_PATH as usize];
                    let len = GetModuleFileNameExW(process_handle, None, &mut buf);
                    if len > 0 {
                        let mut current_exe = String::from_utf16_lossy(&buf[..len as usize]);
                        current_exe = current_exe.trim_matches('\0').to_string();
                        active_exe = current_exe.split('\\').last().unwrap_or("").to_lowercase();
                    }
                }
            }
        }
        
        if !active_exe.is_empty() {
            let blocked_apps = crate::config::get_blocked_apps();
            if blocked_apps.iter().any(|app| app.to_lowercase() == active_exe) {
                KEY_BUFFER.lock().unwrap().clear();
                return unsafe { CallNextHookEx(None, ncode, wparam, lparam) };
            }
        }

        let kb_struct = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let key_code = kb_struct.vkCode;
        let mut c: Option<char> = None;

        if key_code >= 0x41 && key_code <= 0x5A {
            c = std::char::from_u32(key_code + 32); // Lowercase a-z
        } else if key_code >= 0x30 && key_code <= 0x39 {
            c = std::char::from_u32(key_code); // 0-9
        } else if key_code >= 0x60 && key_code <= 0x69 {
            c = std::char::from_u32(key_code - 0x60 + 0x30); // Numpad 0-9
        } else if key_code == VK_OEM_2.0 as u32 || key_code == 0x6F {
            c = Some('/'); // Main Slash or Numpad Slash
        } else if key_code == 0x08 { // Backspace
            KEY_BUFFER.lock().unwrap().pop();
        } else if key_code == 0x20 || key_code == 0x0D { // Space or Enter
            KEY_BUFFER.lock().unwrap().clear();
        } else {
            // Other special keys (like Esc, F1, etc) might break the word flow
        }

        if let Some(ch) = c {
            let mut buf = KEY_BUFFER.lock().unwrap();
            buf.push(ch);
            if buf.len() > 50 {
                // Keep buffer size manageable
                buf.remove(0);
            }

            // Check against all snippets
            let snippets = crate::config::get_snippets();
            for (trigger, replacement) in snippets.iter() {
                if buf.ends_with(trigger) {
                    info!("[HOOK] Match Snippet {}! Returning target string...", trigger);
                    let backspace_count = trigger.chars().count() - 1; // Don't delete the swallowed last char
                    buf.clear(); // Reset

                    // 1. Spawning a new thread to send BACKSPACEs and then the target text
                    let target_clone = replacement.clone();
                    thread::spawn(move || {
                        replace_text_with_snippet(&target_clone, backspace_count);
                    });

                    // 2. We return 1 to swallow the character that triggered the match so it isn't printed!
                    return LRESULT(1);
                }
            }
        }
    }

    // Pass the control to next hook chain
    unsafe { CallNextHookEx(None, ncode, wparam, lparam) }
}

/// Uses SendInput to simulate deleting the shorthand command and inserting the real text
#[cfg(target_os = "windows")]
fn replace_text_with_snippet(target: &str, backspace_count: usize) {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_BACK, VK_CONTROL, VIRTUAL_KEY};

    // Give the OS a tiny delay to finish processing the current hooked thread context
    std::thread::sleep(Duration::from_millis(15));

    unsafe {
        let mut inputs: Vec<INPUT> = Vec::new();
        // 1. Erase typed snippet minus the swallowed last char
        for _ in 0..backspace_count {
            // Key Down Backspace
            let mut kd = INPUT::default();
            kd.r#type = INPUT_KEYBOARD;
            kd.Anonymous.ki.wVk = VK_BACK;
            inputs.push(kd);

            // Key Up Backspace
            let mut ku = INPUT::default();
            ku.r#type = INPUT_KEYBOARD;
            ku.Anonymous.ki.wVk = VK_BACK;
            ku.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
            inputs.push(ku);
        }

        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        inputs.clear();

        if target.len() > 50 {
            // Clipboard Fallback Strategy for large text chunks
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                // save original clipboard (best effort)
                let old_text_opt = clipboard.get_text().ok();
                let _ = clipboard.set_text(target);
                
                std::thread::sleep(Duration::from_millis(30)); // wait for clipboard

                let vk_v = VIRTUAL_KEY(0x56); // 'V'
                // simulate Ctrl + V
                let mut kd_ctrl = INPUT::default();  kd_ctrl.r#type = INPUT_KEYBOARD; kd_ctrl.Anonymous.ki.wVk = VK_CONTROL;
                let mut kd_v = INPUT::default(); kd_v.r#type = INPUT_KEYBOARD; kd_v.Anonymous.ki.wVk = vk_v;
                let mut ku_v = INPUT::default(); ku_v.r#type = INPUT_KEYBOARD; ku_v.Anonymous.ki.wVk = vk_v; ku_v.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                let mut ku_ctrl = INPUT::default(); ku_ctrl.r#type = INPUT_KEYBOARD; ku_ctrl.Anonymous.ki.wVk = VK_CONTROL; ku_ctrl.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

                inputs.push(kd_ctrl); inputs.push(kd_v); inputs.push(ku_v); inputs.push(ku_ctrl);
                SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
                
                // restore old clipboard asynchronously
                if let Some(old_text) = old_text_opt {
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(500));
                        if let Ok(mut cb) = arboard::Clipboard::new() {
                            let _ = cb.set_text(old_text);
                        }
                    });
                }
                return;
            }
        }

        // 2. Insert target string via Unicode SendInput event
        for c in target.encode_utf16() {
            // Key down
            let mut kd = INPUT::default();
            kd.r#type = INPUT_KEYBOARD;
            kd.Anonymous.ki.wScan = c;
            kd.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs.push(kd);

            // Key up
            let mut ku = INPUT::default();
            ku.r#type = INPUT_KEYBOARD;
            ku.Anonymous.ki.wScan = c;
            ku.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            inputs.push(ku);
        }

        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn start_global_hook() {
    println!("Keyboard hook is only supported on Windows OS target.");
}
