/// Context Projection module
/// Captures and structures the current development context for remote consumption.
/// Projects: terminal state, active files, current task, error context, etc.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSnapshot {
    pub timestamp: u64,
    pub active_sessions: Vec<String>,
    pub terminal_cwd: Option<String>,
    pub terminal_history: Vec<String>,
    pub active_process: Option<String>,
    pub environment_vars: HashMap<String, String>,
    pub recent_errors: Vec<String>,
    pub project_root: Option<String>,
}

pub struct ContextProjector {
    snapshot: std::sync::Mutex<Option<ContextSnapshot>>,
}

impl ContextProjector {
    pub fn new() -> Self {
        ContextProjector {
            snapshot: std::sync::Mutex::new(None),
        }
    }

    pub fn capture(&self) -> ContextSnapshot {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let snap = ContextSnapshot {
            timestamp: now,
            active_sessions: Vec::new(),
            terminal_cwd: std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string()),
            terminal_history: Vec::new(),
            active_process: None,
            environment_vars: std::env::vars().take(20).collect(),
            recent_errors: Vec::new(),
            project_root: std::env::var("CARGO_MANIFEST_DIR").ok(),
        };

        if let Ok(mut s) = self.snapshot.lock() {
            *s = Some(snap.clone());
        }
        snap
    }

    pub fn latest(&self) -> Option<ContextSnapshot> {
        self.snapshot.lock().ok()?.clone()
    }

    pub fn add_error(&self, error: String) {
        if let Ok(mut s) = self.snapshot.lock() {
            if let Some(ref mut snap) = *s {
                snap.recent_errors.push(error);
                if snap.recent_errors.len() > 10 {
                    snap.recent_errors.remove(0);
                }
            }
        }
    }

    pub fn to_json(&self) -> String {
        match self.latest() {
            Some(snap) => serde_json::to_string_pretty(&snap).unwrap_or_default(),
            None => String::from("{}"),
        }
    }
}
