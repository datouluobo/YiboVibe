/// Multi-Agent Sessions module
/// Manages multiple independent parallel agent sessions.
/// Supports session-level isolation, channel switching, and cross-session forwarding.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentSessionState {
    Idle,
    Running,
    Paused,
    Error(String),
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub label: String,
    pub state: AgentSessionState,
    pub created_at: u64,
    pub last_active_at: u64,
    pub context_refs: Vec<String>,
    pub artifact_refs: Vec<String>,
    pub agent_type: String,
}

pub struct AgentSessionManager {
    sessions: std::sync::Mutex<HashMap<String, AgentSession>>,
    active_channel: std::sync::Mutex<Option<String>>,
}

impl AgentSessionManager {
    pub fn new() -> Self {
        AgentSessionManager {
            sessions: std::sync::Mutex::new(HashMap::new()),
            active_channel: std::sync::Mutex::new(None),
        }
    }

    pub fn create(&self, id: String, label: String, agent_type: String) -> AgentSession {
        let now = now_secs();
        let session = AgentSession {
            id: id.clone(),
            label,
            state: AgentSessionState::Idle,
            created_at: now,
            last_active_at: now,
            context_refs: Vec::new(),
            artifact_refs: Vec::new(),
            agent_type,
        };
        if let Ok(mut s) = self.sessions.lock() {
            s.insert(id, session.clone());
        }
        session
    }

    pub fn get(&self, id: &str) -> Option<AgentSession> {
        self.sessions.lock().ok()?.get(id).cloned()
    }

    pub fn list(&self) -> Vec<AgentSession> {
        self.sessions.lock()
            .map(|s| s.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn update_state(&self, id: &str, state: AgentSessionState) {
        if let Ok(mut s) = self.sessions.lock() {
            if let Some(ref mut session) = s.get_mut(id) {
                session.state = state;
                session.last_active_at = now_secs();
            }
        }
    }

    pub fn delete(&self, id: &str) {
        if let Ok(mut s) = self.sessions.lock() {
            s.remove(id);
        }
    }

    pub fn set_active_channel(&self, id: Option<String>) {
        if let Ok(mut c) = self.active_channel.lock() {
            *c = id;
        }
    }

    pub fn active_channel(&self) -> Option<String> {
        self.active_channel.lock().ok()?.clone()
    }

    pub fn forward_context(&self, from_id: &str, to_id: &str, context_ref: String) -> bool {
        let sessions = self.sessions.lock();
        if let Ok(mut s) = sessions {
            let from = s.get(from_id);
            let to = s.get_mut(to_id);
            match (from, to) {
                (Some(f), Some(t)) => {
                    t.context_refs.push(context_ref);
                    true
                }
                _ => false,
            }
        } else {
            false
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
