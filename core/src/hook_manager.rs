#[cfg(target_os = "windows")]
use log::{error, info};
#[cfg(target_os = "windows")]
use std::ptr::null_mut;
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput,
    VK_OEM_2,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, HHOOK, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
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
        let kb_struct = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let key_code = kb_struct.vkCode;

        // Determine if it's the start of a command, e.g., '/' (Forward Slash)
        // VK_OEM_2 is usually the '/' key on US keyboards
        if key_code == VK_OEM_2.0 as u32 {
            info!("[HOOK] Captured forward slash '/'. Beginning command intercept buffer.");
            let mut buf = KEY_BUFFER.lock().unwrap();
            buf.clear();
            buf.push('/');
        } else {
            // Very simplified demonstration character conversion: ALPHABET
            if key_code >= 0x41 && key_code <= 0x5A {
                // A-Z
                let mut buf = KEY_BUFFER.lock().unwrap();
                if buf.starts_with('/') && buf.len() < 10 {
                    // Max command length 10
                    let c = std::char::from_u32(key_code + 32).unwrap_or('?'); // To lowercase
                    buf.push(c);
                    info!("[HOOK] Key Buffer is now: {}", *buf);

                    // Check for a match using global config
                    let current_text = buf.clone();
                    let snippets = crate::config::get_snippets();
                    
                    if let Some(target_text) = snippets.get(&current_text) {
                        info!("[HOOK] Match Snippet {}! Returning target string...", current_text);
                        let backspace_count = current_text.chars().count() - 1; // Don't delete the swallowed last char
                        buf.clear(); // Reset

                        // 1. Spawning a new thread to send BACKSPACEs and then the target text
                        // so we don't block the hook callback thread (which would freeze the global keyboard).
                        let target_clone = target_text.clone();
                        thread::spawn(move || {
                            replace_text_with_snippet(&target_clone, backspace_count);
                        });

                        // 2. We return 1 to swallow the character that triggered the match so it isn't printed!
                        return LRESULT(1);
                    }
                }
            } else if key_code == 0x08 {
                // Backspace
                let mut buf = KEY_BUFFER.lock().unwrap();
                buf.pop(); // Remove last character
            } else if key_code == 0x20 || key_code == 0x0D {
                // Space or Enter
                // Break buffer
                let mut buf = KEY_BUFFER.lock().unwrap();
                buf.clear();
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
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_BACK;

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
