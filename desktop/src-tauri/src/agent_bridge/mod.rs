use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Mutex};
use yibovibe_core::agent_host::{AgentHost, HostEvent, HostState};

/// Shared wrapper for AgentHost that can be managed by Tauri state
pub struct HostController {
    host: Arc<AgentHost>,
    recovery_dir: PathBuf,
}

impl HostController {
    pub fn new(app_data_dir: PathBuf) -> (Self, broadcast::Receiver<HostEvent>) {
        let recovery_dir = app_data_dir.join("host_state");
        let (host, event_rx) = AgentHost::new(recovery_dir.clone());
        (
            HostController {
                host: Arc::new(host),
                recovery_dir,
            },
            event_rx,
        )
    }

    pub fn host(&self) -> &Arc<AgentHost> {
        &self.host
    }

    pub async fn start(&self) -> Result<(), String> {
        self.host.start().await
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        self.host.shutdown().await
    }

    pub async fn state(&self) -> HostState {
        self.host.state().await
    }
}

unsafe impl Send for HostController {}
unsafe impl Sync for HostController {}

/// Spawn a task that forwards HostEvents to the Tauri frontend
pub fn spawn_event_forwarder(app_handle: AppHandle, mut event_rx: broadcast::Receiver<HostEvent>) {
    tauri::async_runtime::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    let event_type = match &event {
                        HostEvent::StateChanged(_) => "host-state-changed",
                        HostEvent::SessionStarted(_) => "host-session-started",
                        HostEvent::SessionStopped(_, _) => "host-session-stopped",
                        HostEvent::SessionCrashed(_, _) => "host-session-crashed",
                        HostEvent::Heartbeat(_) => "host-heartbeat",
                        HostEvent::RecoveryTriggered(_) => "host-recovery",
                        HostEvent::SelfHeal(_) => "host-self-heal",
                        HostEvent::ShuttingDown => "host-shutting-down",
                    };
                    let _ = app_handle.emit(event_type, event);
                }
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });
}

// ---- Tauri commands ----

#[tauri::command]
pub async fn get_host_state(
    controller: tauri::State<'_, Mutex<HostController>>,
) -> Result<HostState, String> {
    let ctrl = controller.lock().await;
    Ok(ctrl.state().await)
}

#[tauri::command]
pub async fn restart_host(
    controller: tauri::State<'_, Mutex<HostController>>,
) -> Result<(), String> {
    let ctrl = controller.lock().await;
    ctrl.shutdown().await?;
    ctrl.start().await
}

#[tauri::command]
pub async fn get_host_diagnostics(
    controller: tauri::State<'_, Mutex<HostController>>,
) -> Result<serde_json::Value, String> {
    let ctrl = controller.lock().await;
    let state = ctrl.state().await;
    Ok(serde_json::json!({
        "state": state,
        "recovery_dir": ctrl.recovery_dir.to_string_lossy(),
    }))
}
