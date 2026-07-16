//! Key remapping support for FlowKeys
//!
//! Split from the monolithic hook_manager.rs during refactoring.
//! This module handles key-to-key remapping for custom keyboard layouts.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// A single key remap entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyRemapEntry {
    pub source_key: String,
    pub source_key_id: String,
    pub target_key: String,
    pub target_key_id: String,
    pub target_modifiers: Vec<String>,
    pub enabled: bool,
}

lazy_static::lazy_static! {
    static ref KEY_REMAP_TABLE: Mutex<Vec<KeyRemapEntry>> = Mutex::new(Vec::new());
}

/// Update the global key remap table
pub fn update_key_remap_table(entries: Vec<KeyRemapEntry>) {
    if let Ok(mut table) = KEY_REMAP_TABLE.lock() {
        *table = entries;
        log::info!(
            "[FlowKeys] Remap table updated: {} active entries",
            table.iter().filter(|e| e.enabled).count()
        );
    }
}

/// Get the current key remap table
pub fn get_key_remap_table() -> Vec<KeyRemapEntry> {
    KEY_REMAP_TABLE.lock().map(|t| t.clone()).unwrap_or_default()
}
