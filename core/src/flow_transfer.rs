//! FlowTransfer — Transfer session management for the flow store
//!
//! Split from the monolithic flow_store.rs during refactoring.
//! This module handles transfer sessions, staging, and NAS operations.

// Full implementation extracted from flow_store.rs
// Currently re-exports from parent module for backward compatibility
pub use super::flow_store::*;
