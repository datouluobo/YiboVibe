use log::{error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use lazy_static::lazy_static;

lazy_static! {
    pub static ref GLOBAL_CONFIG: Arc<RwLock<AppConfig>> = Arc::new(RwLock::new(AppConfig::load_or_default()));
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum SnippetValue {
    Multi(Vec<String>),
    Single(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    #[serde(default = "default_empty_snippet_hashmap", skip_serializing)]
    pub snippets: HashMap<String, SnippetValue>,
    #[serde(default = "default_empty_hashmap", skip_serializing)]
    pub snippet_folders: HashMap<String, String>,
    #[serde(default = "default_empty_hashmap", skip_serializing)]
    pub autofill_dict: HashMap<String, String>,
    #[serde(default = "default_true", alias = "is_snippets_enabled")]
    pub is_smartlib_enabled: bool,
    #[serde(default = "default_true")]
    pub is_autofill_enabled: bool,
    #[serde(default = "default_true")]
    pub is_sync_enabled: bool,
    #[serde(default = "default_empty_vec")]
    pub blocked_apps: Vec<String>,
    #[serde(default = "default_empty_string")]
    pub local_password_hash: String,
    #[serde(default = "default_empty_string")]
    pub local_kdf_salt: String,
    #[serde(default = "default_min_chars")]
    pub flowhint_min_chars: usize,
    #[serde(default = "default_tab_key")]
    pub flowhint_accept_key: u32,
    #[serde(default = "default_neg_one")]
    pub hint_fixed_x: i32,
    #[serde(default = "default_neg_one")]
    pub hint_fixed_y: i32,
    #[serde(default)]
    pub sync_meta: crate::sync::SyncMeta,
}

fn default_min_chars() -> usize { 2 }
fn default_tab_key() -> u32 { 0x09 }
fn default_neg_one() -> i32 { -1 }

fn default_true() -> bool { true }
fn default_empty_vec() -> Vec<String> { Vec::new() }
fn default_empty_string() -> String { String::new() }
fn default_empty_hashmap() -> HashMap<String, String> { HashMap::new() }
fn default_empty_snippet_hashmap() -> HashMap<String, SnippetValue> { HashMap::new() }

impl AppConfig {
    pub fn config_path() -> PathBuf {
        let mut path = crate::local_auth::get_active_user_dir();
        path.push("config.json");
        path
    }

    pub fn reload() {
        if let Ok(mut lock) = GLOBAL_CONFIG.write() {
            *lock = Self::load_or_default();
        }
    }

    pub fn load_or_default() -> Self {
        let path = Self::config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<Self>(&content) {
                    Ok(mut config) => {
                        // Migration: blocked_apps → FlowRules (one-time)
                        if !config.blocked_apps.is_empty() {
                            info!("Detected legacy blocked_apps ({}), migrating to FlowRules...", config.blocked_apps.len());
                            crate::rules::migrate_from_blocked_apps(&config.blocked_apps);
                            config.blocked_apps.clear();
                            config.save();
                            info!("Legacy blocked_apps migration completed.");
                        }

                        // Migration: legacy snippets/autofill -> SmartDictionary
                        if !config.snippets.is_empty() || !config.autofill_dict.is_empty() {
                            info!("Detected legacy snippets/autofill, migrating to SmartDictionary...");
                            crate::dictionary::migrate_legacy_config(&mut config);
                            config.snippets.clear();
                            config.autofill_dict.clear();
                            config.snippet_folders.clear();
                            config.save();
                            info!("Legacy snippets migration completed.");
                        }

                        return config;
                    }
                    Err(e) => error!("Failed to parse config: {}", e),
                },
                Err(e) => error!("Failed to read config file: {}", e),
            }
        }
        
        // Default Config
        let cfg = Self { 
            snippets: HashMap::new(),
            snippet_folders: HashMap::new(),
            autofill_dict: HashMap::new(),
            is_smartlib_enabled: true,
            is_autofill_enabled: true,
            is_sync_enabled: true,
            blocked_apps: default_empty_vec(),
            local_password_hash: default_empty_string(),
            local_kdf_salt: default_empty_string(),
            flowhint_min_chars: 2,
            flowhint_accept_key: 0x09,
            hint_fixed_x: -1,
            hint_fixed_y: -1,
            sync_meta: crate::sync::SyncMeta::default(),
        };
        cfg.save();
        cfg
    }

    pub fn save(&self) {
        // Automatically bump the timestamp on save if sync is enabled locally
        let mut to_save = self.clone();
        if to_save.is_sync_enabled {
            to_save.sync_meta.global_updated_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        }

        let path = Self::config_path();
        match serde_json::to_string_pretty(&to_save) {
            Ok(json) => {
                if let Err(e) = fs::write(path, json) {
                    error!("Failed to save config: {}", e);
                }
            }
            Err(e) => error!("Failed to serialize config: {}", e),
        }
    }
}

pub fn add_snippet(trigger: String, replacement: String, folder: Option<String>) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    // Always insert as an array to migrate over time
    cfg.snippets.insert(trigger.clone(), SnippetValue::Multi(vec![replacement]));
    if let Some(f) = folder {
        cfg.snippet_folders.insert(trigger, f);
    } else {
        cfg.snippet_folders.remove(&trigger);
    }
    cfg.save();
    info!("Snippet added successfully.");
    Ok(())
}

pub fn remove_snippet(trigger: String) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.snippets.remove(&trigger);
    cfg.snippet_folders.remove(&trigger);
    cfg.save();
    info!("Snippet removed successfully.");
    Ok(())
}

pub fn get_snippets() -> (HashMap<String, Vec<String>>, HashMap<String, String>) {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    let mut normalized_snippets = HashMap::new();
    for (k, v) in &cfg.snippets {
        match v {
            SnippetValue::Single(s) => { normalized_snippets.insert(k.clone(), vec![s.clone()]); },
            SnippetValue::Multi(vec) => { normalized_snippets.insert(k.clone(), vec.clone()); }
        }
    }
    (normalized_snippets, cfg.snippet_folders.clone())
}

pub fn add_autofill(trigger: String, candidate: String) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.autofill_dict.insert(trigger, candidate);
    cfg.save();
    info!("Autofill added successfully.");
    Ok(())
}

pub fn remove_autofill(trigger: String) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.autofill_dict.remove(&trigger);
    cfg.save();
    info!("Autofill removed successfully.");
    Ok(())
}

pub fn get_autofills() -> HashMap<String, String> {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    cfg.autofill_dict.clone()
}

pub fn get_settings() -> (bool, bool, bool, usize, u32) {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    (cfg.is_smartlib_enabled, cfg.is_sync_enabled, cfg.is_autofill_enabled, cfg.flowhint_min_chars, cfg.flowhint_accept_key)
}

pub fn update_settings(is_smartlib_enabled: bool, is_sync_enabled: bool, is_autofill_enabled: bool, flowhint_min_chars: usize, flowhint_accept_key: u32) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.is_smartlib_enabled = is_smartlib_enabled;
    cfg.is_sync_enabled = is_sync_enabled;
    cfg.is_autofill_enabled = is_autofill_enabled;
    cfg.flowhint_min_chars = flowhint_min_chars;
    cfg.flowhint_accept_key = flowhint_accept_key;
    cfg.save();
    Ok(())
}

pub fn get_blocked_apps() -> Vec<String> {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    cfg.blocked_apps.clone()
}

pub fn add_blocked_app(app_name: String) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    let sanitized_app_name = app_name.trim_matches(|c| c == '\0' || c == ' ').to_lowercase();
    if !cfg.blocked_apps.contains(&sanitized_app_name) {
        cfg.blocked_apps.push(sanitized_app_name);
        cfg.save();
    }
    Ok(())
}

pub fn remove_blocked_app(app_name: String) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    let sanitized_app_name = app_name.trim_matches(|c| c == '\0' || c == ' ').to_lowercase();
    cfg.blocked_apps.retain(|a| a != &sanitized_app_name);
    cfg.save();
    Ok(())
}

pub fn reload() {
    AppConfig::reload();
}
