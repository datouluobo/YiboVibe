/// Agent Vital Signs module
/// Aggregates health metrics from the vitality monitor, watchdog, and session manager.
/// Provides structured health reports for remote monitoring.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalSignsReport {
    pub timestamp: u64,
    pub uptime_secs: u64,
    pub session_count: usize,
    pub memory_mb: Option<u64>,
    pub cpu_percent: Option<f64>,
    pub last_heartbeat: u64,
    pub stalled: bool,
    pub active_sessions: Vec<String>,
    pub recent_alerts: Vec<String>,
}

pub struct VitalSignsCollector {
    started_at: std::sync::Mutex<u64>,
    alerts: std::sync::Mutex<Vec<String>>,
}

impl VitalSignsCollector {
    pub fn new() -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        VitalSignsCollector {
            started_at: std::sync::Mutex::new(now),
            alerts: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn report(&self, session_count: usize, last_heartbeat: u64) -> VitalSignsReport {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let uptime = self.started_at.lock()
            .map(|started| now.saturating_sub(*started))
            .unwrap_or(0);

        VitalSignsReport {
            timestamp: now,
            uptime_secs: uptime,
            session_count,
            memory_mb: None,
            cpu_percent: None,
            last_heartbeat,
            stalled: now.saturating_sub(last_heartbeat) > 30,
            active_sessions: Vec::new(),
            recent_alerts: self.alerts.lock()
                .map(|a| a.clone())
                .unwrap_or_default(),
        }
    }

    pub fn add_alert(&self, alert: String) {
        if let Ok(mut a) = self.alerts.lock() {
            a.push(alert);
            if a.len() > 20 {
                a.remove(0);
            }
        }
    }
}
