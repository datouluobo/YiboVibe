use std::ptr::null_mut;
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    VIRTUAL_KEY, VK_BACK, VK_ESCAPE, VK_RETURN, VK_SPACE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT,
    MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

// Global handle to unhook cleanly on exit (though not strictly required for this test)
static mut HHOOK_HANDLE: HHOOK = HHOOK(0);

/// Our global LowLevelKeyboardProc
unsafe extern "system" fn hook_callback(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // Only process >= 0 and process KEYDOWN
    if ncode >= 0 && (wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN) {
        let kb_struct = *(lparam.0 as *const KBDLLHOOKSTRUCT);
        let key_code = kb_struct.vkCode;
        let vk = VIRTUAL_KEY(key_code as u16);

        // This is a simplified logic. In real YiboFlow we match against a buffer.
        match vk {
            VK_SPACE => println!("[HOOK] Space pressed! End of candidate word."),
            VK_BACK => println!("[HOOK] Backspace. Popping key buffer."),
            VK_ESCAPE | VK_RETURN => println!("[HOOK] Clearing key buffer (Action terminated)."),
            _ => {
                // If it's a character or number
                let c = char::from_u32(key_code).unwrap_or('?');
                println!("[HOOK] Key: {:?} (code {})", c, key_code);

                // Simulation: if users typed '/', intercept it?
                // Return 1 from this callback to SWALLOW the key event, or CallNextHookEx to pass it.
            }
        }
    }

    // Always pass it to other hooks. If we matched a snippet, we return LRESULT(1) to block it!
    CallNextHookEx(None, ncode, wparam, lparam)
}

fn main() {
    println!("--- YiboFlow Keyboard Hook Prototype ---");
    println!("Installing WH_KEYBOARD_LL global hook...");

    unsafe {
        let hinstance = GetModuleHandleW(None).unwrap();
        let hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(hook_callback),
            hinstance,
            0, // Global hook
        )
        .expect("Failed to install global keyboard hook.");

        HHOOK_HANDLE = hook;

        println!("Hook installed successfully. Type anywhere! Close console to exit.");

        // Message pump is required for hooks to be processed by Windows efficiently
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            windows::Win32::UI::WindowsAndMessaging::TranslateMessage(&msg);
            windows::Win32::UI::WindowsAndMessaging::DispatchMessageW(&msg);
        }

        UnhookWindowsHookEx(HHOOK_HANDLE).unwrap();
    }
}
