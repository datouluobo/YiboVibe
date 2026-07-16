//! RuntimeRegistry — discover, register, and resolve AgentRuntimes

use crate::agent_host::runtime::{AgentRuntime, RuntimeProbeResult};
use std::collections::HashMap;
use std::sync::RwLock;

/// Registry for pluggable agent runtimes.
/// Supports registration, discovery (probing), and resolution by ID.
pub struct RuntimeRegistry {
    runtimes: RwLock<HashMap<&'static str, Box<dyn AgentRuntime>>>,
}

impl RuntimeRegistry {
    /// Create an empty registry
    pub fn new() -> Self {
        Self {
            runtimes: RwLock::new(HashMap::new()),
        }
    }

    /// Register a runtime
    pub fn register(&self, runtime: Box<dyn AgentRuntime>) {
        let id = runtime.id();
        if let Ok(mut map) = self.runtimes.write() {
            map.insert(id, runtime);
        }
    }

    /// Unregister a runtime by ID
    pub fn unregister(&self, id: &str) {
        if let Ok(mut map) = self.runtimes.write() {
            map.remove(id);
        }
    }

    /// Probe all registered runtimes and return those that are available
    pub fn discover(&self) -> Vec<(&'static str, RuntimeProbeResult)> {
        let mut results = Vec::new();
        if let Ok(map) = self.runtimes.read() {
            for (id, runtime) in map.iter() {
                let probe = runtime.probe();
                results.push((*id, probe));
            }
        }
        results.sort_by(|a, b| a.0.cmp(b.0));
        results
    }

    /// List all registered runtime IDs
    pub fn list(&self) -> Vec<&'static str> {
        self.runtimes
            .read()
            .ok()
            .map(|map| map.keys().copied().collect())
            .unwrap_or_default()
    }

    /// Number of registered runtimes
    pub fn len(&self) -> usize {
        self.runtimes.read().ok().map(|map| map.len()).unwrap_or(0)
    }

    /// Whether the registry is empty
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for RuntimeRegistry {
    fn default() -> Self {
        Self::new()
    }
}
