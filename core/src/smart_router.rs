use std::collections::HashMap;
use std::sync::RwLock;
use lazy_static::lazy_static;

lazy_static! {
    static ref SNAP_TABLE_CACHE: RwLock<Option<HashMap<String, Vec<String>>>> = RwLock::new(None);
}

/// Invalidates the snap table cache (call this when dictionaries change)
pub fn invalidate_snap_cache() {
    let mut cache = SNAP_TABLE_CACHE.write().unwrap();
    *cache = None;
}

pub fn build_snap_table() -> HashMap<String, Vec<String>> {
    // Check cache first
    {
        let cache = SNAP_TABLE_CACHE.read().unwrap();
        if let Some(ref table) = *cache {
            return table.clone();
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
    
    log::debug!("[FlowSnap] snap_table 已构建: {} 个触发器", table.len());
    
    // Save to cache
    let mut cache = SNAP_TABLE_CACHE.write().unwrap();
    *cache = Some(table.clone());
    
    table
}

/// FlowHint 引擎所需的全量 content 列表
/// 此方法根据传入的开启的词库 ID，聚合所有词条的内容用于前缀匹配
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
