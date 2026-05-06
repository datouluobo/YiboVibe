use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows::Win32::Foundation::MAX_PATH;
use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
use windows::Win32::UI::Input::Ime::{ImmGetContext, ImmGetOpenStatus, ImmReleaseContext};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

fn main() {
    unsafe {
        let hwnd = GetForegroundWindow();
        let himc = ImmGetContext(hwnd);
        if himc.0 != 0 {
            let status = ImmGetOpenStatus(himc);
            println!("IME OPEN STATUS: {:?}", status.as_bool());
            ImmReleaseContext(hwnd, himc);
        } else {
            println!("No IME context for foreground window.");
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        if let Ok(process_handle) =
            OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
        {
            let mut buf = [0u16; MAX_PATH as usize];
            let len = GetModuleFileNameExW(process_handle, None, &mut buf);
            if len > 0 {
                let current_exe = OsString::from_wide(&buf[..len as usize]);
                if let Some(s) = current_exe.to_str() {
                    let exe_name = s.split('\\').next_back().unwrap_or("").to_lowercase();
                    println!("Foreground exe: {}", exe_name);
                }
            }
        }
    }
}
