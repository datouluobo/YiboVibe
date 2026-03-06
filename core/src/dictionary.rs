use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use walkdir::WalkDir;

lazy_static::lazy_static! {
    pub static ref DICT_CACHE: RwLock<HashMap<String, SmartDictionary>> = RwLock::new(HashMap::new());
    pub static ref FREQ_CACHE: RwLock<HashMap<String, u32>> = RwLock::new(HashMap::new());
}


#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SmartEntry {
    pub trigger_key: Option<String>,
    pub keyword: Option<String>,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SmartDictionary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default = "default_min_trigger")]
    pub min_trigger_chars: usize,
    pub entries: Vec<SmartEntry>,
    #[serde(default = "default_type_custom")]
    pub dict_type: String, // "builtin" | "custom"
}

fn default_type_custom() -> String { "custom".to_string() }

fn default_min_trigger() -> usize {
    2
}

pub fn get_dict_dir() -> PathBuf {
    let mut path = crate::local_auth::get_active_user_dir();
    path.push("dictionaries");
    path
}

fn get_freq_path() -> PathBuf {
    let mut path = crate::local_auth::get_active_user_dir();
    path.push("freq.json");
    path
}

pub fn reload() {
    load_freq_cache();
    init_and_load_dictionaries();
}

pub fn load_freq_cache() {
    let path = get_freq_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, u32>>(&content) {
                let mut cache = FREQ_CACHE.write().unwrap();
                *cache = map;
                info!("Loaded {} frequency entries.", cache.len());
                return;
            }
        }
    }
    info!("No freq cache found, starting fresh.");
}

fn save_freq_cache() {
    let cache = FREQ_CACHE.read().unwrap();
    let path = get_freq_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(&*cache) {
        let _ = fs::write(path, json);
    }
}

/// Bump frequency counter for a given content string. Called on accept.
pub fn bump_freq(content: &str) {
    {
        let mut cache = FREQ_CACHE.write().unwrap();
        let counter = cache.entry(content.to_string()).or_insert(0);
        *counter += 1;
    }
    // Persist in background to avoid blocking the hook
    std::thread::spawn(move || {
        save_freq_cache();
    });
}

pub fn get_freq(content: &str) -> u32 {
    let cache = FREQ_CACHE.read().unwrap();
    cache.get(content).copied().unwrap_or(0)
}

// 供 config.rs 迁移旧版 FlowSnap 配置调用
pub fn migrate_legacy_config(config: &mut crate::config::AppConfig) {
    let mut entries = Vec::new();

    for (k, v) in &config.snippets {
        let contents = match v {
            crate::config::SnippetValue::Single(s) => vec![s.clone()],
            crate::config::SnippetValue::Multi(vec) => vec.clone(),
        };
        for content in contents {
            entries.push(SmartEntry {
                trigger_key: Some(k.clone()),
                keyword: None,
                content,
            });
        }
    }

    if !entries.is_empty() {
        let migrated_dict = SmartDictionary {
            id: "migrated_snippets".to_string(),
            name: "已迁移的 FlowSnap 词条".to_string(),
            description: "旧版本 FlowSnap 的备份词条".to_string(),
            version: "1.0".to_string(),
            author: "System".to_string(),
            min_trigger_chars: 2,
            entries,
            dict_type: "custom".to_string(),
        };
        let _ = save_dictionary(migrated_dict);
    }
}

/// 首次初始化并加载所有词库
pub fn init_and_load_dictionaries() {
    let base_dir = get_dict_dir();
    let builtin_dir = base_dir.join("builtin");
    let custom_dir = base_dir.join("custom");

    // 1. Create directories if not exist
    let _ = fs::create_dir_all(&builtin_dir);
    let _ = fs::create_dir_all(&custom_dir);

    // 2. Hydrate built-in dictionaries if missing
    let cmd_dict_path = builtin_dir.join("cmd.json");
    if !cmd_dict_path.exists() {
        let cmd_dict = SmartDictionary {
            id: "cmd_commands".to_string(),
            name: "CMD 命令词库".to_string(),
            description: "Windows 命令提示符常用命令补全".to_string(),
            version: "1.0".to_string(),
            author: "YiboFlow Built-in".to_string(),
            min_trigger_chars: 2,
            dict_type: "builtin".to_string(),
            entries: vec![
                "ping".to_string(),
                "ping 127.0.0.1".to_string(),
                "pip install".to_string(),
                "ipconfig".to_string(),
                "ipconfig /all".to_string(),
                "ipconfig /flushdns".to_string(),
            ].into_iter().map(|s| SmartEntry { trigger_key: None, keyword: None, content: s }).collect(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&cmd_dict) {
            let _ = fs::write(cmd_dict_path, json);
        }
    }

    let git_dict_path = builtin_dir.join("git.json");
    if !git_dict_path.exists() {
        let git_dict = SmartDictionary {
            id: "git_commands".to_string(),
            name: "Git 命令词库".to_string(),
            description: "Git 常用操作快捷补全".to_string(),
            version: "1.0".to_string(),
            author: "YiboFlow Built-in".to_string(),
            min_trigger_chars: 2,
            dict_type: "builtin".to_string(),
            entries: vec![
                "git init".to_string(),
                "git status".to_string(),
                "git commit -m \"\"".to_string(),
                "git checkout".to_string(),
                "git push origin dev".to_string(),
                "git pull".to_string(),
            ].into_iter().map(|s| SmartEntry { trigger_key: None, keyword: None, content: s }).collect(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&git_dict) {
            let _ = fs::write(git_dict_path, json);
        }
    }

    let npm_dict_path = builtin_dir.join("npm.json");
    if !npm_dict_path.exists() {
        let npm_dict = SmartDictionary {
            id: "npm_commands".to_string(),
            name: "NPM 包管理".to_string(),
            description: "NPM/PNPM 常用命令大全".to_string(),
            version: "1.0".to_string(),
            author: "YiboFlow Built-in".to_string(),
            min_trigger_chars: 2,
            dict_type: "builtin".to_string(),
            entries: vec![
                "npm install".to_string(),
                "pnpm install".to_string(),
                "yarn install".to_string(),
                "npm run dev".to_string(),
                "npm run build".to_string(),
                "pnpm dev".to_string(),
            ].into_iter().map(|s| SmartEntry { trigger_key: None, keyword: None, content: s }).collect(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&npm_dict) { let _ = fs::write(npm_dict_path, json); }
    }

    let html_dict_path = builtin_dir.join("html.json");
    if !html_dict_path.exists() {
        let html_dict = SmartDictionary {
            id: "html_tags".to_string(),
            name: "HTML 标签".to_string(),
            description: "常用 HTML5 标签补全".to_string(),
            version: "1.0".to_string(),
            author: "YiboFlow Built-in".to_string(),
            min_trigger_chars: 2,
            dict_type: "builtin".to_string(),
            entries: vec![
                "<html>\n</html>".to_string(),
                "https://".to_string(),
                "<div>\n</div>".to_string(),
                "<div class=\"\">".to_string(),
                "<span></span>".to_string(),
            ].into_iter().map(|s| SmartEntry { trigger_key: None, keyword: None, content: s }).collect(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&html_dict) { let _ = fs::write(html_dict_path, json); }
    }

    let docker_dict_path = builtin_dir.join("docker.json");
    if !docker_dict_path.exists() {
        let docker_dict = SmartDictionary {
            id: "docker_commands".to_string(),
            name: "Docker 指令".to_string(),
            description: "Docker 及 Compose 常用部署指令".to_string(),
            version: "1.0".to_string(),
            author: "YiboFlow Built-in".to_string(),
            min_trigger_chars: 2,
            dict_type: "builtin".to_string(),
            entries: vec![
                "docker pull".to_string(),
                "docker ps -a".to_string(),
                "docker-compose up -d".to_string(),
                "docker-compose down".to_string(),
            ].into_iter().map(|s| SmartEntry { trigger_key: None, keyword: None, content: s }).collect(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&docker_dict) { let _ = fs::write(docker_dict_path, json); }
    }

    // 3. Load all JSONs into memory
    reload_all_dictionaries();
}

#[derive(Deserialize)]
struct LegacyDictionary {
    pub id: String,
    pub name: String,
    #[serde(default)] pub description: String,
    #[serde(default)] pub version: String,
    #[serde(default)] pub author: String,
    #[serde(default = "default_min_trigger")] pub min_trigger_chars: usize,
    pub entries: Vec<String>,
}

pub fn reload_all_dictionaries() {
    let base_dir = get_dict_dir();
    let mut loaded_map = HashMap::new();

    for entry in WalkDir::new(&base_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(dict) = serde_json::from_str::<SmartDictionary>(&content) {
                    loaded_map.insert(dict.id.clone(), dict);
                } else if let Ok(legacy) = serde_json::from_str::<LegacyDictionary>(&content) {
                    let mut entries = Vec::new();
                    for s in legacy.entries {
                        entries.push(SmartEntry { trigger_key: None, keyword: None, content: s });
                    }
                    let dict = SmartDictionary {
                        id: legacy.id,
                        name: legacy.name,
                        description: legacy.description,
                        version: legacy.version,
                        author: legacy.author,
                        min_trigger_chars: legacy.min_trigger_chars,
                        entries,
                        dict_type: "custom".to_string(), // mark migrated legacy as custom
                    };
                    loaded_map.insert(dict.id.clone(), dict.clone());
                    let _ = save_dictionary(dict);
                } else {
                    warn!("Failed to parse dict JSON: {:?}", path);
                }
            }
        }
    }

    let count = loaded_map.len();
    let mut cache = DICT_CACHE.write().unwrap();
    *cache = loaded_map;
    info!("Loaded {} FlowHint dictionaries into memory.", count);
}

/// 前缀匹配查询：根据绑定的 dict_ids 查找候选词
pub fn search_candidates(dict_ids: &[String], buffer: &str) -> Vec<String> {
    if buffer.is_empty() {
        return vec![];
    }

    let buf_lower = buffer.to_lowercase();
    let cache = DICT_CACHE.read().unwrap();
    let mut results = Vec::new();

    for id in dict_ids {
        if let Some(dict) = cache.get(id) {
            if buf_lower.chars().count() < dict.min_trigger_chars {
                continue;
            }
            for entry in &dict.entries {
                let cand = &entry.content;
                let cand_lower = cand.to_lowercase();
                if buf_lower.chars().count() >= dict.min_trigger_chars {
                    // search_candidates in new design: you can keep it matching cand_lower startswith buf_lower
                    if cand_lower.starts_with(&buf_lower) {
                        if !results.contains(cand) {
                            results.push(cand.clone());
                        }
                    }
                }
            }
        }
    }

    results.truncate(5); // max_candidates = 5
    results
}

/// 尾部匹配查询：检查 buffer 末尾是否匹配任何 candidate 的开头部分
/// 只要输入长度 >= min_trigger_chars，就会触发匹配
/// 例如: buffer="git" 匹配 candidate "git init"（前3字母匹配）
pub fn search_candidates_tail(dict_ids: &[String], buffer: &str) -> Vec<String> {
    if buffer.is_empty() {
        return vec![];
    }

    let buf_lower = buffer.to_lowercase();
    let buf_chars: Vec<char> = buf_lower.chars().collect();
    let cache = DICT_CACHE.read().unwrap();
    let mut results: Vec<(usize, String)> = Vec::new(); // (match_len, candidate)

    for id in dict_ids {
        if let Some(dict) = cache.get(id) {
            let min_chars = crate::config::GLOBAL_CONFIG.read().unwrap().flowhint_min_chars;
            for entry in &dict.entries {
                let cand = &entry.content;
                let cand_lower = cand.to_lowercase();
                let cand_chars: Vec<char> = cand_lower.chars().collect();

                // Try matching buffer tail against candidate beginning
                // Check all possible tail lengths from longest to shortest
                for tail_len in (min_chars..=buf_chars.len().min(cand_chars.len())).rev() {
                    let buf_tail: String = buf_chars[buf_chars.len() - tail_len..].iter().collect();
                    let cand_head: String = cand_chars[..tail_len].iter().collect();

                    if buf_tail == cand_head {
                        // Don't suggest if user already typed the full candidate
                        if tail_len < cand_chars.len() {
                            if !results.iter().any(|(_, c)| c == cand) {
                                results.push((tail_len, cand.clone()));
                            }
                        }
                        break; // found best match for this candidate
                    }
                }
            }
        }
    }

    // Sort by: frequency descending first, then match length descending
    results.sort_by(|a, b| {
        let freq_a = get_freq(&a.1);
        let freq_b = get_freq(&b.1);
        freq_b.cmp(&freq_a).then_with(|| b.0.cmp(&a.0))
    });
    let out: Vec<String> = results.into_iter().map(|(_, c)| c).collect();
    out.into_iter().take(15).collect()
}

/// 获取尾部匹配的长度（buffer尾部与candidate开头匹配了多少字符）
/// 用于 Plan B 的 suffix 计算: candidate.skip(prefix_len)
pub fn get_tail_match_prefix_len(dict_ids: &[String], buffer: &str) -> usize {
    if buffer.is_empty() {
        return 0;
    }
    let buf_lower = buffer.to_lowercase();
    let buf_chars: Vec<char> = buf_lower.chars().collect();
    let cache = DICT_CACHE.read().unwrap();
    let mut best = 0usize;

    for id in dict_ids {
        if let Some(dict) = cache.get(id) {
            let min_chars = crate::config::GLOBAL_CONFIG.read().unwrap().flowhint_min_chars;
            for entry in &dict.entries {
                let cand = &entry.content;
                let cand_lower = cand.to_lowercase();
                let cand_chars: Vec<char> = cand_lower.chars().collect();

                for tail_len in (min_chars..=buf_chars.len().min(cand_chars.len())).rev() {
                    let buf_tail: String = buf_chars[buf_chars.len() - tail_len..].iter().collect();
                    let cand_head: String = cand_chars[..tail_len].iter().collect();
                    if buf_tail == cand_head && tail_len > best {
                        best = tail_len;
                    }
                    break;
                }
            }
        }
    }
    best
}

// ---------------------------------------------------------------------------
// CRUD APIS (For Tauri)
// ---------------------------------------------------------------------------

pub fn get_all_dictionaries() -> Vec<SmartDictionary> {
    let cache = DICT_CACHE.read().unwrap();
    cache.values().cloned().collect()
}

pub fn save_dictionary(dict: SmartDictionary) -> Result<(), String> {
    let base_dir = get_dict_dir();
    
    // determine path: check if it exists in builtin, otherwise custom
    let builtin_path = base_dir.join("builtin").join(format!("{}.json", dict.id));
    let mut save_path = base_dir.join("custom").join(format!("{}.json", dict.id));
    
    if builtin_path.exists() {
        save_path = builtin_path;
    }

    if let Some(parent) = save_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    let json = serde_json::to_string_pretty(&dict).map_err(|e| e.to_string())?;
    fs::write(save_path, json).map_err(|e| e.to_string())?;
    
    // Update memory cache
    {
        let mut cache = DICT_CACHE.write().unwrap();
        cache.insert(dict.id.clone(), dict);
    }
    
    Ok(())
}

pub fn delete_dictionary(id: &str) -> Result<(), String> {
    let base_dir = get_dict_dir();
    let builtin_path = base_dir.join("builtin").join(format!("{}.json", id));
    let custom_path = base_dir.join("custom").join(format!("{}.json", id));

    let mut deleted = false;
    if builtin_path.exists() {
        fs::remove_file(&builtin_path).map_err(|e| e.to_string())?;
        deleted = true;
    }
    if custom_path.exists() {
        fs::remove_file(&custom_path).map_err(|e| e.to_string())?;
        deleted = true;
    }

    if !deleted {
        return Err("Dictionary not found".to_string());
    }

    // Update memory cache
    {
        let mut cache = DICT_CACHE.write().unwrap();
        cache.remove(id);
    }

    Ok(())
}
