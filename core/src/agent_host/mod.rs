use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, broadcast, mpsc};
use serde::{Deserialize, Serialize};

pub mod heartbeat;
pub mod session;
pub mod recovery;

/// Agent host state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HostState {
    Starting,
    Running,
    Paused,
    Stopped,
    Error(String),
}

/// Core event types emitted by the host
#[derive(Debug, Clone, Serialize)]
pub enum HostEvent {
    StateChanged(HostState),
    SessionStarted(String),
    SessionStopped(String, i32),
    SessionCrashed(String, String),
    Heartbeat(u64),
    RecoveryTriggered(String),
    SelfHeal(String),
    ShuttingDown,
}

/// The headless agent host
pub struct AgentHost {
    state: Arc<Mutex<HostState>>,
    sessions: Arc<Mutex<HashMap<String, session::SessionHandle>>>,
    event_tx: broadcast::Sender<HostEvent>,
    vitality_tx: mpsc::Sender<()>,
    recovery_path: PathBuf,
    started_at: Arc<Mutex<u64>>,
}

impl AgentHost {
    pub fn new(recovery_path: PathBuf) -> (Self, broadcast::Receiver<HostEvent>) {
        let (event_tx, event_rx) = broadcast::channel(256);
        let (vitality_tx, _) = mpsc::channel(64);

        let host = AgentHost {
            state: Arc::new(Mutex::new(HostState::Stopped)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            vitality_tx,
            recovery_path,
            started_at: Arc::new(Mutex::new(0)),
        };

        (host, event_rx)
    }

    pub async fn start(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if *state == HostState::Running {
            return Ok(());
        }

        *state = HostState::Starting;
        let _ = self.event_tx.send(HostEvent::StateChanged(HostState::Starting));

        // Try recovery from previous state
        let recovered = recovery::try_recover(&self.recovery_path).await;
        if let Some(sessions) = recovered {
            let mut session_map = self.sessions.lock().await;
            for sess in sessions {
                let handle = session::SessionHandle::recover(sess);
                session_map.insert(handle.id().to_string(), handle);
            }
            let _ = self
                .event_tx
                .send(HostEvent::RecoveryTriggered(format!(
                    "recovered {} sessions",
                    session_map.len()
                )));
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        *self.started_at.lock().await = now;

        // Spawn vitality monitoring
        let vitality = std::sync::Arc::new(heartbeat::VitalityMonitor::new());
        vitality.ping();
        let _v_handle = vitality.clone().start(self.event_tx.clone());
        // Watchdog for self-heal
        let watchdog = std::sync::Arc::new(heartbeat::Watchdog::new());
        watchdog.clone().start(self.event_tx.clone());

        *state = HostState::Running;
        let _ = self.event_tx.send(HostEvent::StateChanged(HostState::Running));
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if *state == HostState::Stopped {
            return Ok(());
        }

        // Save state before stopping
        let sessions = self.sessions.lock().await;
        let snapshots: Vec<session::SessionSnapshot> = sessions
            .values()
            .filter_map(|h| h.snapshot())
            .collect();
        drop(sessions);

        recovery::save_snapshots(&self.recovery_path, &snapshots).await;

        *state = HostState::Stopped;
        let _ = self.event_tx.send(HostEvent::StateChanged(HostState::Stopped));
        let _ = self.event_tx.send(HostEvent::ShuttingDown);
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        self.stop().await?;
        let _ = self.event_tx.send(HostEvent::ShuttingDown);
        Ok(())
    }

    pub async fn state(&self) -> HostState {
        self.state.lock().await.clone()
    }

    pub async fn session_count(&self) -> usize {
        self.sessions.lock().await.len()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<HostEvent> {
        self.event_tx.subscribe()
    }

    pub async fn vitality_ping(&self) {
        let _ = self.vitality_tx.try_send(());
        let _ = self
            .event_tx
            .send(HostEvent::Heartbeat(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            ));
    }
}

unsafe impl Send for AgentHost {}
unsafe impl Sync for AgentHost {}
