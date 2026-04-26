use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use lazy_static::lazy_static;

lazy_static! {
    static ref SNAP_TABLE_CACHE: RwLock<Option<Arc<HashMap<String, Vec<String>>>>> = RwLock::new(None);
}

/// Invalidates the snap table cache (call this when dictionaries change)
pub fn invalidate_snap_cache() {
    let mut cache = SNAP_TABLE_CACHE.write().unwrap();
    *cache = None;
}

pub fn build_snap_table() -> Arc<HashMap<String, Vec<String>>> {
    // Check cache first
    {
        let cache = SNAP_TABLE_CACHE.read().unwrap();
        if let Some(ref table) = *cache {
            return Arc::clone(table);
        }
    }

    // Otherwise build it
    let dict_cache = crate::dictionary::DICT_CACHE.read().unwrap();
    let mut table: HashMap<String, Vec<String>> = HashMap::new();

    for dict in dict_cache.values() {
        for entry in &dict.entries {
            if let (Some(tk), Some(kw)) = (&entry.trigger_key, &entry.keyword) {
                if !tk.is_empty() && !kw.is_empty() {
                    let full_trigger = format!("{}{}", tk, kw);
                    table.entry(full_trigger).or_default().push(entry.content.clone());
                }
            }
        }
    }

    log::debug!("[FlowSnap] snap_table built: {} triggers", table.len());

    let table = Arc::new(table);

    // Save to cache
    let mut cache = SNAP_TABLE_CACHE.write().unwrap();
    *cache = Some(Arc::clone(&table));

    table
}

/// FlowHint engine: collect all content entries for prefix matching
pub fn build_hint_entries(dict_ids: &[String]) -> Vec<String> {
    let cache = crate::dictionary::DICT_CACHE.read().unwrap();
    let mut entries = Vec::new();

    for id in dict_ids {
        if let Some(dict) = cache.get(id) {
            for entry in &dict.entries {
                entries.push(entry.content.clone());
            }
        }
    }
    entries
}
