use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::time::interval;

use super::HostEvent;

const HEARTBEAT_INTERVAL_SECS: u64 = 5;
const STALL_THRESHOLD_SECS: u64 = 30;

pub struct VitalityMonitor {
    running: Arc<AtomicBool>,
    last_beat: Arc<std::sync::Mutex<u64>>,
}

impl VitalityMonitor {
    pub fn new() -> Self {
        VitalityMonitor {
            running: Arc::new(AtomicBool::new(false)),
            last_beat: Arc::new(std::sync::Mutex::new(0)),
        }
    }

    /// Start the vitality monitor in a background tokio task.
    /// Returns a handle that can be used to stop the monitor.
    pub fn start(
        self: Arc<Self>,
        event_tx: tokio::sync::broadcast::Sender<HostEvent>,
    ) -> VitalityHandle {
        self.running.store(true, Ordering::SeqCst);

        let running = self.running.clone();
        let last_beat = self.last_beat.clone();

        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        if let Ok(beat) = last_beat.lock() {
                            if now - *beat > STALL_THRESHOLD_SECS {
                                let _ = event_tx.send(HostEvent::SelfHeal(
                                    "host stalled, attempting recovery".to_string()
                                ));
                            }
                        }
                        let _ = event_tx.send(HostEvent::Heartbeat(now));
                    }
                    _ = stop_rx.recv() => {
                        break;
                    }
                }
            }
        });

        VitalityHandle { stop_tx }
    }

    pub fn ping(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if let Ok(mut beat) = self.last_beat.lock() {
            *beat = now;
        }
    }
}

pub struct VitalityHandle {
    stop_tx: mpsc::Sender<()>,
}

impl VitalityHandle {
    pub async fn stop(self) {
        let _ = self.stop_tx.send(()).await;
    }
}

/// A simplified watchdog that ensures the host process is responsive.
pub struct Watchdog {
    running: Arc<AtomicBool>,
}

impl Watchdog {
    pub fn new() -> Self {
        Watchdog {
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(self: Arc<Self>, event_tx: tokio::sync::broadcast::Sender<HostEvent>) {
        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(15));
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                        let _ = event_tx.send(HostEvent::Heartbeat(
                            SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs()
                        ));
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}
