// ConPTY-based terminal backend
// Windows Pseudo Console (ConPTY) for true terminal emulation support

use encoding_rs::GBK;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use windows::Win32::Foundation::{
    HANDLE, CloseHandle, WAIT_OBJECT_0,
};
use windows::Win32::System::Console::{
    CreatePseudoConsole, ClosePseudoConsole, ResizePseudoConsole, HPCON, COORD,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, InitializeProcThreadAttributeList, UpdateProcThreadAttribute,
    DeleteProcThreadAttributeList, WaitForSingleObject, GetExitCodeProcess,
    PROCESS_INFORMATION, STARTUPINFOEXW, EXTENDED_STARTUPINFO_PRESENT,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
};
use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};

pub type SessionId = String;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum SessionStatus {
    Running,
    Exited(i32),
    Error(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: SessionId,
    pub shell_kind: String,
    pub cwd: String,
    pub status: SessionStatus,
    pub started_at: u64,
    pub last_output_at: u64,
    pub exit_code: Option<i32>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn generate_session_id() -> SessionId {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = now_secs();
    let seq = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("sess-{:x}-{:04x}", ts, seq)
}

fn normalize_shell_kind(shell_kind: &str) -> String {
    match shell_kind.trim().to_ascii_lowercase().as_str() {
        "powershell" | "powershell.exe" | "pwsh.exe" => "pwsh".to_string(),
        "wsl.exe" => "wsl".to_string(),
        "cmd.exe" => "cmd".to_string(),
        "cmd" | "pwsh" | "wsl" => shell_kind.trim().to_ascii_lowercase(),
        _ => "cmd".to_string(),
    }
}

fn resolve_session_cwd(cwd: &str) -> String {
    use std::path::PathBuf;
    let candidate = PathBuf::from(cwd);
    let absolute = if candidate.as_os_str().is_empty() || cwd == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(candidate)
    };
    absolute.to_string_lossy().into_owned()
}

fn to_wsl_path(path: &str) -> Option<String> {
    let normalized = path.replace("\\", "/");
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        let drive = normalized.chars().next()?.to_ascii_lowercase();
        let rest = normalized[2..].trim_start_matches('/');
        if rest.is_empty() {
            Some(format!("/mnt/{drive}"))
        } else {
            Some(format!("/mnt/{drive}/{rest}"))
        }
    } else {
        None
    }
}

fn decode_terminal_bytes(shell_kind: &str, bytes: &[u8]) -> String {
    if shell_kind == "cmd" {
        if let Ok(decoded) = String::from_utf8(bytes.to_vec()) {
            decoded
        } else {
            let (decoded, _, _) = GBK.decode(bytes);
            decoded.into_owned()
        }
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn build_command_line(shell_kind: &str, cwd: &str) -> Vec<u16> {
    match shell_kind {
        "wsl" => {
            if let Some(wsl_cwd) = to_wsl_path(cwd) {
                format!(
                    "wsl.exe --cd \"{}\" --exec /usr/bin/script -qfec \"/bin/bash -i\" /dev/null",
                    wsl_cwd
                )
            } else {
                "wsl.exe --cd ~ --exec /usr/bin/script -qfec \"/bin/bash -i\" /dev/null".to_string()
            }
        }
        "pwsh" => "pwsh.exe -NoLogo -NoExit".to_string(),
        _ => {
            let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
            format!("{comspec} /D /Q /K")
        }
    }
    .encode_utf16()
    .chain(std::iter::once(0))
    .collect()
}

fn debug_preview(text: &str) -> String {
    let preview: String = text.chars().take(120).collect();
    preview
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

fn shell_init_input(shell_kind: &str) -> Option<&'static str> {
    match shell_kind {
        _ => None,
    }
}

struct PtyHandle(HANDLE);

impl PtyHandle {
    fn new(h: HANDLE) -> Self {
        PtyHandle(h)
    }
}

unsafe impl Send for PtyHandle {}
unsafe impl Sync for PtyHandle {}

impl Drop for PtyHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe { let _ = CloseHandle(self.0); }
        }
    }
}

fn create_pipe_pair() -> Result<(HANDLE, HANDLE), String> {
    let mut read_h = HANDLE::default();
    let mut write_h = HANDLE::default();
    unsafe {
        CreatePipe(
            &mut read_h as *mut HANDLE,
            &mut write_h as *mut HANDLE,
            None,
            0,
        )
        .map_err(|e| format!("CreatePipe failed: {e}"))?;
    }
    Ok((read_h, write_h))
}

struct ConPtySession {
    session_id: SessionId,
    shell_kind: String,
    cwd: String,
    hpc: Option<HPCON>,
    input_read: Option<PtyHandle>,
    output_write: Option<PtyHandle>,
    input_write: Option<PtyHandle>,
    output_read: Option<PtyHandle>,
    output_thread: Option<thread::JoinHandle<()>>,
    wait_thread: Option<thread::JoinHandle<()>>,
    is_running: Arc<AtomicBool>,
    started_at: u64,
    last_output_at: Arc<AtomicU64>,
    exit_code: Arc<StdMutex<Option<i32>>>,
    error_message: Arc<StdMutex<Option<String>>>,
}

impl ConPtySession {
    fn new(shell_kind: String, cwd: String) -> Self {
        ConPtySession {
            session_id: generate_session_id(),
            shell_kind: normalize_shell_kind(&shell_kind),
            cwd: resolve_session_cwd(&cwd),
            hpc: None,
            input_read: None,
            output_write: None,
            input_write: None,
            output_read: None,
            output_thread: None,
            wait_thread: None,
            is_running: Arc::new(AtomicBool::new(false)),
            started_at: 0,
            last_output_at: Arc::new(AtomicU64::new(0)),
            exit_code: Arc::new(StdMutex::new(None)),
            error_message: Arc::new(StdMutex::new(None)),
        }
    }

    fn info(&self) -> SessionInfo {
        let exit_code = self.exit_code.lock().ok().and_then(|g| *g);
        let error_msg = self.error_message.lock().ok().and_then(|g| g.clone());
        let status = if self.is_running.load(Ordering::SeqCst) {
            SessionStatus::Running
        } else if let Some(msg) = error_msg {
            SessionStatus::Error(msg)
        } else {
            SessionStatus::Exited(exit_code.unwrap_or(0))
        };
        SessionInfo {
            session_id: self.session_id.clone(),
            shell_kind: self.shell_kind.clone(),
            cwd: self.cwd.clone(),
            status,
            started_at: self.started_at,
            last_output_at: self.last_output_at.load(Ordering::SeqCst),
            exit_code,
        }
    }

    fn start_with_callbacks<FStdout, FExit>(
        &mut self,
        on_stdout: FStdout,
        on_exit: FExit,
    ) -> Result<(), String>
    where
        FStdout: Fn(String) + Send + 'static,
        FExit: Fn(i32) + Send + 'static,
    {
        if self.is_running.load(Ordering::SeqCst) {
            return Err("Session already running".to_string());
        }

        self.started_at = now_secs();
        self.last_output_at.store(self.started_at, Ordering::SeqCst);
        if let Ok(mut g) = self.exit_code.lock() { *g = None; }
        if let Ok(mut g) = self.error_message.lock() { *g = None; }

        // 1. Create pipes
        let (h_input_read, h_input_write) = create_pipe_pair()?;
        let (h_output_read, h_output_write) = create_pipe_pair()?;

        // 2. Create pseudo console (80x24 initial)
        let coord = COORD { X: 80, Y: 24 };
        let hpc = unsafe {
            CreatePseudoConsole(coord, h_input_read, h_output_write, 0)
                .map_err(|e| format!("CreatePseudoConsole failed: {e}"))?
        };

        // 3. Build command line
        let cmd_line = build_command_line(&self.shell_kind, &self.cwd);
        if self.shell_kind == "wsl" {
            let command = String::from_utf16_lossy(
                &cmd_line.iter().copied().take_while(|unit| *unit != 0).collect::<Vec<u16>>(),
            );
            eprintln!(
                "[VibeConsole][WSL][start] session={} cwd={} command={}",
                self.session_id,
                self.cwd,
                command
            );
        }

        // 4. Initialize attribute list (two-call pattern)
        let mut attr_list_size: usize = 0;
        unsafe {
            let _ = InitializeProcThreadAttributeList(
                None, 1, None, &mut attr_list_size,
            );
        }

        let mut attr_list_buf = vec![0u8; attr_list_size];
        let lpp_list = LPPROC_THREAD_ATTRIBUTE_LIST(attr_list_buf.as_mut_ptr() as *mut _);

        unsafe {
            InitializeProcThreadAttributeList(
                Some(lpp_list), 1, None, &mut attr_list_size,
            )
            .map_err(|e| format!("InitializeProcThreadAttributeList failed: {e}"))?;
        }

        // 5. Set pseudo console attribute
        unsafe {
            UpdateProcThreadAttribute(
                lpp_list, 0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                Some(hpc.0 as *const _),
                std::mem::size_of::<HPCON>(),
                None, None,
            )
            .map_err(|e| format!("UpdateProcThreadAttribute failed: {e}"))?;
        }

        // 6. Prepare startup info
        let mut startup_info = STARTUPINFOEXW {
            StartupInfo: unsafe { std::mem::zeroed() },
            lpAttributeList: lpp_list,
        };
        startup_info.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;

        let mut process_info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let mut cmd_mut = cmd_line.clone();

        let cwd_wide: Vec<u16> = if self.shell_kind != "wsl" && !self.cwd.is_empty() {
            self.cwd.encode_utf16().chain(std::iter::once(0)).collect()
        } else {
            vec![]
        };

        // 7. Create process with ConPTY
        unsafe {
            CreateProcessW(
                windows::core::PCWSTR::null(),
                Some(windows::core::PWSTR(cmd_mut.as_mut_ptr())),
                None, None,
                false,
                EXTENDED_STARTUPINFO_PRESENT,
                None,
                if cwd_wide.is_empty() {
                    windows::core::PCWSTR::null()
                } else {
                    windows::core::PCWSTR(cwd_wide.as_ptr())
                },
                &startup_info.StartupInfo as *const _ as *const _,
                &mut process_info,
            )
            .map_err(|e| format!("CreateProcessW failed: {e}"))?;
        }

        // 8. Clean up attribute list
        unsafe { DeleteProcThreadAttributeList(lpp_list); }

        if !process_info.hThread.is_invalid() {
            unsafe { let _ = CloseHandle(process_info.hThread); }
        }

        self.hpc = Some(hpc);
        self.input_read = Some(PtyHandle::new(h_input_read));
        self.output_write = Some(PtyHandle::new(h_output_write));
        self.input_write = Some(PtyHandle::new(h_input_write));
        self.output_read = Some(PtyHandle::new(h_output_read));
        self.is_running.store(true, Ordering::SeqCst);

        // 9. Spawn output reader thread
        let sk = self.shell_kind.clone();
        let out_h_val = h_output_read.0 as isize;
        let is_run = self.is_running.clone();
        let last_out = self.last_output_at.clone();

        let out_th = thread::spawn(move || {
            let mut buf = vec![0u8; 4096];
            loop {
                let mut br: u32 = 0;
                let r = unsafe {
                    ReadFile(HANDLE(out_h_val as *mut _), Some(&mut buf), Some(&mut br as *mut u32), None)
                };
                if r.is_err() || br == 0 {
                    break;
                }
                last_out.store(now_secs(), Ordering::SeqCst);
                let decoded = decode_terminal_bytes(&sk, &buf[..br as usize]);
                if sk == "wsl" {
                    eprintln!(
                        "[VibeConsole][WSL][stdout] bytes={} preview={}",
                        br,
                        debug_preview(&decoded)
                    );
                }
                on_stdout(decoded);
                if !is_run.load(Ordering::SeqCst) {
                    break;
                }
            }
        });

        // 10. Spawn process wait thread
        let proc_h_val = process_info.hProcess.0 as isize;
        let is_run2 = self.is_running.clone();
        let ec2 = self.exit_code.clone();
        let wait_th = thread::spawn(move || {
            let wr = unsafe { WaitForSingleObject(HANDLE(proc_h_val as *mut _), u32::MAX) };
            let code = if wr == WAIT_OBJECT_0 {
                let mut ec: u32 = 0;
                if unsafe { GetExitCodeProcess(HANDLE(proc_h_val as *mut _), &mut ec) }.is_ok() {
                    ec as i32
                } else { -1 }
            } else { -1 };

            is_run2.store(false, Ordering::SeqCst);
            if let Ok(mut g) = ec2.lock() { *g = Some(code); }

            on_exit(code);
        });

        self.output_thread = Some(out_th);
        self.wait_thread = Some(wait_th);

        Ok(())
    }

    fn start(&mut self, app_handle: &AppHandle) -> Result<(), String> {
        let stdout_sid = self.session_id.clone();
        let stdout_app = app_handle.clone();
        let exit_sid = self.session_id.clone();
        let exit_app = app_handle.clone();
        self.start_with_callbacks(
            move |text| {
                let _ = stdout_app.emit(&format!("term:stdout:{stdout_sid}"), &text);
            },
            move |code| {
                let _ = exit_app.emit(&format!("term:exit:{exit_sid}"), code);
            },
        )
    }

    fn write_input(&self, text: &str) -> Result<(), String> {
        let input = self.input_write.as_ref().ok_or("Session not started")?;
        if self.shell_kind == "wsl" {
            eprintln!(
                "[VibeConsole][WSL][stdin] session={} preview={}",
                self.session_id,
                debug_preview(text)
            );
        }
        let mut written = 0u32;
        unsafe {
            WriteFile(input.0, Some(text.as_bytes()), Some(&mut written), None)
                .map_err(|e| format!("WriteFile error: {e}"))?;
        }
        self.last_output_at.store(now_secs(), Ordering::SeqCst);
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let hpc = self.hpc.ok_or("Session not started")?;
        unsafe {
            ResizePseudoConsole(hpc, COORD { X: cols as i16, Y: rows as i16 })
                .map_err(|e| format!("ResizePseudoConsole failed: {e}"))
        }
    }

    fn kill(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        // Close pseudo console first — this breaks ReadFile (output thread exits)
        // and causes the child process to exit (wait thread exits)
        if let Some(hpc) = self.hpc.take() {
            unsafe { ClosePseudoConsole(hpc); }
        }
        // Join threads before closing handles to avoid races
        if let Some(th) = self.output_thread.take() {
            let _ = th.join();
        }
        if let Some(th) = self.wait_thread.take() {
            let _ = th.join();
        }
        // Now safe to close handles — no threads are using them
        self.input_read = None;
        self.output_write = None;
        self.input_write = None;
        self.output_read = None;
    }
}

impl Drop for ConPtySession {
    fn drop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        if let Some(hpc) = self.hpc.take() {
            unsafe { ClosePseudoConsole(hpc); }
        }
    }
}

pub struct SessionManager {
    sessions: HashMap<SessionId, ConPtySession>,
    default_shell: String,
}

impl SessionManager {
    pub fn new(default_shell: &str) -> Self {
        SessionManager {
            sessions: HashMap::new(),
            default_shell: normalize_shell_kind(default_shell),
        }
    }

    pub fn set_default_shell(&mut self, shell: &str) {
        self.default_shell = normalize_shell_kind(shell);
    }

    pub async fn create_session(&mut self, shell_kind: Option<&str>, cwd: Option<&str>) -> SessionId {
        let shell = normalize_shell_kind(shell_kind.unwrap_or(&self.default_shell));
        let dir = cwd.unwrap_or(".").to_string();
        let session = ConPtySession::new(shell, dir);
        let id = session.session_id.clone();
        self.sessions.insert(id.clone(), session);
        id
    }

    pub async fn start_session(&mut self, session_id: &str, app_handle: &AppHandle) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.start(app_handle)?;
        if let Some(init) = shell_init_input(&session.shell_kind) {
            let _ = session.write_input(init);
        }
        Ok(())
    }

    pub async fn write_session(&mut self, session_id: &str, text: &str) -> Result<(), String> {
        let session = self.sessions.get(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.write_input(text)
    }

    pub async fn resize_session(&mut self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.sessions.get(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.resize(cols, rows)
    }

    pub async fn kill_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.kill();
        Ok(())
    }

    pub async fn remove_session(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.kill();
        }
        self.sessions.remove(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info()).collect()
    }

    pub async fn get_session_info(&self, session_id: &str) -> Option<SessionInfo> {
        self.sessions.get(session_id).map(|s| s.info())
    }

    pub async fn session_exists(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }
}

pub type SharedSessionManager = Arc<Mutex<SessionManager>>;

pub fn new_shared_manager(default_shell: &str) -> SharedSessionManager {
    Arc::new(Mutex::new(SessionManager::new(default_shell)))
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver};
    use std::time::{Duration, Instant};

    fn wait_for_contains(
        rx: &Receiver<String>,
        exit_rx: &Receiver<i32>,
        token: &str,
        timeout: Duration,
    ) -> String {
        let deadline = Instant::now() + timeout;
        let mut collected = String::new();
        while Instant::now() < deadline {
            if let Ok(code) = exit_rx.try_recv() {
                panic!(
                    "Session exited before token {token:?} arrived. Exit code: {code}. Output so far: {collected:?}"
                );
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(remaining.min(Duration::from_millis(250))) {
                Ok(chunk) => {
                    collected.push_str(&chunk);
                    if collected.contains(token) {
                        return collected;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        panic!("Timed out waiting for token {token:?}. Output so far: {collected:?}");
    }

    fn verify_shell_command(shell_kind: &str, command: &str, token: &str) {
        let mut session = ConPtySession::new(shell_kind.to_string(), ".".to_string());
        let (stdout_tx, stdout_rx) = mpsc::channel::<String>();
        let (exit_tx, exit_rx) = mpsc::channel::<i32>();

        session
            .start_with_callbacks(
                move |text| {
                    let _ = stdout_tx.send(text);
                },
                move |code| {
                    let _ = exit_tx.send(code);
                },
            )
            .unwrap_or_else(|err| panic!("failed to start {shell_kind}: {err}"));

        std::thread::sleep(Duration::from_millis(250));
        session
            .write_input(command)
            .unwrap_or_else(|err| panic!("failed to write to {shell_kind}: {err}"));

        let output = wait_for_contains(&stdout_rx, &exit_rx, token, Duration::from_secs(10));
        assert!(
            output.contains(token),
            "expected token {token:?} in output {output:?}"
        );

        let _ = session.write_input("exit\r");
        session.kill();
    }

    #[test]
    fn cmd_session_accepts_input_and_returns_output() {
        verify_shell_command("cmd", "echo YBV_CMD_OK\n", "YBV_CMD_OK");
    }

    #[test]
    fn pwsh_session_accepts_input_and_returns_output() {
        verify_shell_command("pwsh", "Write-Output 'YBV_PWSH_OK'\n", "YBV_PWSH_OK");
    }

    #[test]
    fn wsl_session_accepts_input_and_returns_output() {
        verify_shell_command("wsl", "printf 'YBV_WSL_OK\\n'\n", "YBV_WSL_OK");
    }
}
