use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub id: String,
    pub label: String,
    pub shell_kind: String,
    pub cwd: String,
    pub started_at: u64,
    pub last_active_at: u64,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct SessionHandle {
    id: String,
    label: String,
    shell_kind: String,
    cwd: String,
    started_at: u64,
    last_active_at: u64,
}

impl SessionHandle {
    pub fn new(label: String, shell_kind: String, cwd: String) -> Self {
        let id = generate_session_id();
        let now = now_secs();
        SessionHandle {
            id,
            label,
            shell_kind,
            cwd,
            started_at: now,
            last_active_at: now,
        }
    }

    pub fn recover(snapshot: SessionSnapshot) -> Self {
        SessionHandle {
            id: snapshot.id,
            label: snapshot.label,
            shell_kind: snapshot.shell_kind,
            cwd: snapshot.cwd,
            started_at: snapshot.started_at,
            last_active_at: snapshot.last_active_at,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn snapshot(&self) -> Option<SessionSnapshot> {
        Some(SessionSnapshot {
            id: self.id.clone(),
            label: self.label.clone(),
            shell_kind: self.shell_kind.clone(),
            cwd: self.cwd.clone(),
            started_at: self.started_at,
            last_active_at: self.last_active_at,
            exit_code: None,
        })
    }

    pub fn touch(&mut self) {
        self.last_active_at = now_secs();
    }
}

fn generate_session_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = now_secs();
    let seq = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("host-sess-{:x}-{:04x}", ts, seq)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
