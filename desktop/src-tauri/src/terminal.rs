// PTY-based terminal backend.
// Use a real pseudo terminal so interactive shells and TUIs keep prompts,
// completion, cursor movement, and full-screen layouts.

use encoding_rs::GBK;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

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
    let normalized = path.replace('\\', "/");
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

fn debug_preview(text: &str) -> String {
    let preview: String = text.chars().take(120).collect();
    preview.replace('\r', "\\r").replace('\n', "\\n")
}

fn normalize_terminal_input(text: &str) -> String {
    text.replace("\r\n", "\r").replace('\n', "\r")
}

fn build_command(shell_kind: &str, cwd: &str) -> CommandBuilder {
    match normalize_shell_kind(shell_kind).as_str() {
        "pwsh" => {
            let mut command = CommandBuilder::new("pwsh.exe");
            command.arg("-NoLogo");
            command.arg("-NoExit");
            command.cwd(cwd);
            command.env("TERM", "xterm-256color");
            command.env("COLORTERM", "truecolor");
            command
        }
        "wsl" => {
            let mut command = CommandBuilder::new("wsl.exe");
            if let Some(wsl_cwd) = to_wsl_path(cwd) {
                command.arg("--cd");
                command.arg(wsl_cwd);
            }
            command.arg("--exec");
            command.arg("/bin/bash");
            command.arg("-i");
            command.env("TERM", "xterm-256color");
            command.env("COLORTERM", "truecolor");
            command
        }
        _ => {
            let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
            let mut command = CommandBuilder::new(comspec);
            command.arg("/D");
            command.arg("/Q");
            command.arg("/K");
            command.cwd(cwd);
            command.env("TERM", "xterm-256color");
            command
        }
    }
}

fn describe_command(shell_kind: &str, cwd: &str) -> String {
    match normalize_shell_kind(shell_kind).as_str() {
        "pwsh" => format!("pwsh.exe -NoLogo -NoExit @ {cwd}"),
        "wsl" => {
            if let Some(wsl_cwd) = to_wsl_path(cwd) {
                format!("wsl.exe --cd {wsl_cwd} --exec /bin/bash -i")
            } else {
                "wsl.exe --cd ~ --exec /bin/bash -i".to_string()
            }
        }
        _ => {
            let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
            format!("{comspec} /D /Q /K @ {cwd}")
        }
    }
}

fn shell_init_input(_shell_kind: &str) -> Option<&'static str> {
    None
}

fn spawn_output_reader(
    shell_kind: String,
    mut reader: Box<dyn Read + Send>,
    is_running: Arc<AtomicBool>,
    last_output_at: Arc<AtomicU64>,
    on_output: Arc<dyn Fn(String) + Send + Sync>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = decode_terminal_bytes(&shell_kind, &buffer[..n]);
                    if shell_kind == "wsl" {
                        eprintln!(
                            "[VibeConsole][WSL][stdout] preview={}",
                            debug_preview(&chunk)
                        );
                    }
                    last_output_at.store(now_secs(), Ordering::SeqCst);
                    on_output(chunk);
                }
                Err(err) => {
                    if is_running.load(Ordering::SeqCst) {
                        eprintln!("[VibeConsole][{shell_kind}][pty-read-error] {err}");
                    }
                    break;
                }
            }
        }
    })
}

struct PtySession {
    session_id: SessionId,
    shell_kind: String,
    cwd: String,
    master: Option<Arc<StdMutex<Box<dyn MasterPty + Send>>>>,
    writer: Option<Arc<StdMutex<Box<dyn Write + Send>>>>,
    child: Option<Arc<StdMutex<Box<dyn portable_pty::Child + Send + Sync>>>>,
    output_thread: Option<thread::JoinHandle<()>>,
    wait_thread: Option<thread::JoinHandle<()>>,
    is_running: Arc<AtomicBool>,
    started_at: u64,
    last_output_at: Arc<AtomicU64>,
    exit_code: Arc<StdMutex<Option<i32>>>,
    error_message: Arc<StdMutex<Option<String>>>,
}

impl PtySession {
    fn new(shell_kind: String, cwd: String) -> Self {
        Self::new_with_id(generate_session_id(), shell_kind, cwd)
    }

    fn new_with_id(session_id: SessionId, shell_kind: String, cwd: String) -> Self {
        Self {
            session_id,
            shell_kind: normalize_shell_kind(&shell_kind),
            cwd: resolve_session_cwd(&cwd),
            master: None,
            writer: None,
            child: None,
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

    fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }

    fn cleanup_runtime_resources(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        if let Some(child) = self.child.take() {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
        }
        self.writer = None;
        self.master = None;
        let _ = self.output_thread.take();
        let _ = self.wait_thread.take();
    }

    fn start_with_callbacks<FStdout, FExit>(
        &mut self,
        on_stdout: FStdout,
        on_exit: FExit,
    ) -> Result<(), String>
    where
        FStdout: Fn(String) + Send + Sync + 'static,
        FExit: Fn(i32) + Send + 'static,
    {
        if self.is_running() {
            return Err("Session already running".to_string());
        }

        self.cleanup_runtime_resources();
        self.started_at = now_secs();
        self.last_output_at.store(self.started_at, Ordering::SeqCst);
        if let Ok(mut g) = self.exit_code.lock() {
            *g = None;
        }
        if let Ok(mut g) = self.error_message.lock() {
            *g = None;
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 32,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        if self.shell_kind == "wsl" {
            eprintln!(
                "[VibeConsole][WSL][start] session={} cwd={} command={}",
                self.session_id,
                self.cwd,
                describe_command(&self.shell_kind, &self.cwd)
            );
        }

        let command = build_command(&self.shell_kind, &self.cwd);
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("spawn pty command failed: {e}"))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone pty reader failed: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take pty writer failed: {e}"))?;

        let master = pair.master;
        let child = Arc::new(StdMutex::new(child));
        let writer = Arc::new(StdMutex::new(writer));
        self.master = Some(Arc::new(StdMutex::new(master)));
        self.child = Some(child.clone());
        self.writer = Some(writer);
        self.is_running.store(true, Ordering::SeqCst);

        let stdout_cb: Arc<dyn Fn(String) + Send + Sync> = Arc::new(on_stdout);
        let output_thread = spawn_output_reader(
            self.shell_kind.clone(),
            reader,
            self.is_running.clone(),
            self.last_output_at.clone(),
            stdout_cb,
        );

        let is_running = self.is_running.clone();
        let exit_code = self.exit_code.clone();
        let wait_child = child.clone();
        let wait_thread = thread::spawn(move || {
            let code = {
                let mut child = match wait_child.lock() {
                    Ok(child) => child,
                    Err(_) => return,
                };
                child
                    .wait()
                    .ok()
                    .map(|status| status.exit_code() as i32)
                    .unwrap_or(-1)
            };
            is_running.store(false, Ordering::SeqCst);
            if let Ok(mut g) = exit_code.lock() {
                *g = Some(code);
            }
            on_exit(code);
        });

        self.output_thread = Some(output_thread);
        self.wait_thread = Some(wait_thread);
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
        let writer = self.writer.as_ref().ok_or("Session not started")?;
        let normalized = normalize_terminal_input(text);
        if self.shell_kind == "wsl" {
            eprintln!(
                "[VibeConsole][WSL][stdin] session={} preview={}",
                self.session_id,
                debug_preview(&normalized)
            );
        }
        let mut writer = writer
            .lock()
            .map_err(|_| "pty writer lock poisoned".to_string())?;
        writer
            .write_all(normalized.as_bytes())
            .map_err(|e| format!("pty write error: {e}"))?;
        writer.flush().map_err(|e| format!("pty flush error: {e}"))?;
        self.last_output_at.store(now_secs(), Ordering::SeqCst);
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.as_ref().ok_or("Session not started")?;
        let master = master
            .lock()
            .map_err(|_| "pty master lock poisoned".to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("pty resize failed: {e}"))
    }

    fn kill(&mut self) {
        self.cleanup_runtime_resources();
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.cleanup_runtime_resources();
    }
}

pub struct SessionManager {
    sessions: HashMap<SessionId, PtySession>,
    default_shell: String,
}

impl SessionManager {
    pub fn new(default_shell: &str) -> Self {
        Self {
            sessions: HashMap::new(),
            default_shell: normalize_shell_kind(default_shell),
        }
    }

    pub fn set_default_shell(&mut self, shell: &str) {
        self.default_shell = normalize_shell_kind(shell);
    }

    pub async fn create_session(
        &mut self,
        shell_kind: Option<&str>,
        cwd: Option<&str>,
    ) -> SessionId {
        self.create_session_with_id(generate_session_id(), shell_kind, cwd)
            .await
    }

    pub async fn create_session_with_id(
        &mut self,
        session_id: SessionId,
        shell_kind: Option<&str>,
        cwd: Option<&str>,
    ) -> SessionId {
        let shell = normalize_shell_kind(shell_kind.unwrap_or(&self.default_shell));
        let dir = cwd.unwrap_or(".").to_string();
        let session = PtySession::new_with_id(session_id.clone(), shell, dir);
        let id = session.session_id.clone();
        self.sessions.insert(id.clone(), session);
        id
    }

    pub async fn start_session(
        &mut self,
        session_id: &str,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        if session.is_running() {
            return Ok(());
        }
        session.start(app_handle)?;
        if let Some(init) = shell_init_input(&session.shell_kind) {
            let _ = session.write_input(init);
        }
        Ok(())
    }

    pub async fn start_session_with_ws(
        &mut self,
        session_id: &str,
        app_handle: &AppHandle,
        ws_tx: tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        if session.is_running() {
            return Ok(());
        }
        let stdout_sid = session.session_id.clone();
        let stdout_app = app_handle.clone();
        let exit_sid = session.session_id.clone();
        let exit_app = app_handle.clone();
        let ws_tx_out = ws_tx.clone();
        session.start_with_callbacks(
            move |text| {
                let _ = stdout_app.emit(&format!("term:stdout:{stdout_sid}"), &text);
                let ws_msg = yibovibe_core::ws::WsMessage {
                    sender_uid: 0,
                    sender_device_id: 0,
                    target_devices: vec![],
                    r#type: "session:output".to_string(),
                    payload: serde_json::json!({
                        "session_id": stdout_sid,
                        "text": text,
                    }),
                };
                let _ = ws_tx_out.try_send(ws_msg);
            },
            move |code| {
                let _ = exit_app.emit(&format!("term:exit:{exit_sid}"), code);
                let ws_msg = yibovibe_core::ws::WsMessage {
                    sender_uid: 0,
                    sender_device_id: 0,
                    target_devices: vec![],
                    r#type: "session:update".to_string(),
                    payload: serde_json::json!({
                        "session_id": exit_sid,
                        "state": "stopped",
                        "exit_code": code,
                    }),
                };
                let _ = ws_tx.try_send(ws_msg);
            },
        )?;
        let mgr = self;
        let session = mgr.sessions.get(session_id).unwrap();
        if let Some(init) = shell_init_input(&session.shell_kind) {
            let _ = session.write_input(init);
        }
        Ok(())
    }

    pub async fn write_session(&mut self, session_id: &str, text: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.write_input(text)
    }

    pub async fn resize_session(
        &mut self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.resize(cols, rows)
    }

    pub async fn kill_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.kill();
        Ok(())
    }

    pub async fn remove_session(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.kill();
        }
        self.sessions
            .remove(session_id)
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
        let mut session = PtySession::new(shell_kind.to_string(), ".".to_string());
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

        let _ = session.write_input("exit\n");
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
