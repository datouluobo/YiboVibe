use crate::dictionary::DICT_CACHE;
use std::collections::HashMap;

/// FlowSnap 引擎所需的匹配表
/// key = "trigger_key + keyword" (如 "#git")
/// value = Vec<content>（支持 1:N）
pub fn build_snap_table() -> HashMap<String, Vec<String>> {
    let cache = DICT_CACHE.read().unwrap();
    let mut table: HashMap<String, Vec<String>> = HashMap::new();

    // 假设所有的 dict_ids 都要作为 snap table (也可以过滤 enabled)
    for dict in cache.values() {
        for entry in &dict.entries {
            if let (Some(tk), Some(kw)) = (&entry.trigger_key, &entry.keyword) {
                // Skip entries with empty trigger_key or keyword
                if !tk.is_empty() && !kw.is_empty() {
                    let full_trigger = format!("{}{}", tk, kw);
                    table.entry(full_trigger).or_default().push(entry.content.clone());
                }
            }
        }
    }
    log::info!("[FlowSnap] snap_table 已构建: {} 个触发器", table.len());
    for (trigger, contents) in &table {
        log::info!("[FlowSnap]   触发器='{}' → {} 个替换", trigger, contents.len());
    }
    table
}

/// FlowHint 引擎所需的全量 content 列表
/// 此方法根据传入的开启的词库 ID，聚合所有词条的内容用于前缀匹配
pub fn build_hint_entries(dict_ids: &[String]) -> Vec<String> {
    let cache = DICT_CACHE.read().unwrap();
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
