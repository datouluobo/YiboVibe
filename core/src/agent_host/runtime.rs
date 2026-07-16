//! AgentRuntime trait — pluggable AI runtime backend
//!
//! Allows AgentHost to support different agent backends
//! (Codex, Cursor, Claude Code, etc.) via a common trait.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Capabilities a runtime can advertise
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub enum RuntimeCapability {
    SessionManagement,
    EventStream,
    ApprovalWorkflow,
    ProjectContext,
    GitIntegration,
    ModelDiscovery,
    ConfigManagement,
    StdioTransport,
    AppServerIpc,
    DesktopIpc,
}

/// Result of probing whether a runtime is available
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeProbeResult {
    pub available: bool,
    pub version: Option<String>,
    pub display_name: String,
    pub transport: String,
}

/// Configuration for starting a runtime session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub approval_policy: Option<String>,
    pub sandbox_mode: Option<String>,
    pub extra: Option<serde_json::Value>,
}

/// Handle for an active runtime session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandle {
    pub id: String,
    pub runtime_id: String,
    pub label: String,
    pub started_at: u64,
}

/// Pluggable agent runtime — implemented by each AI provider adapter.
///
/// Methods are synchronous to avoid requiring `async-trait` dependency.
/// Runtimes that need async behavior should use `tokio::spawn` internally.
pub trait AgentRuntime: Send + Sync {
    /// Unique identifier (e.g., "codex", "cursor", "claude-code")
    fn id(&self) -> &'static str;

    /// Human-readable name
    fn display_name(&self) -> &'static str;

    /// Probe whether this runtime is available on the current system
    fn probe(&self) -> RuntimeProbeResult;

    /// List of capabilities this runtime supports
    fn capabilities(&self) -> HashSet<RuntimeCapability>;
}
