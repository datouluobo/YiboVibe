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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub snippets: HashMap<String, String>,
    #[serde(default = "default_empty_hashmap")]
    pub autofill_dict: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub is_snippets_enabled: bool,
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
}

fn default_true() -> bool { true }
fn default_empty_vec() -> Vec<String> { Vec::new() }
fn default_empty_string() -> String { String::new() }
fn default_empty_hashmap() -> HashMap<String, String> { HashMap::new() }

impl AppConfig {
    pub fn config_path() -> PathBuf {
        let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("./"));
        path.push("YiboFlow");
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        path.push("config.json");
        path
    }

    pub fn load_or_default() -> Self {
        let path = Self::config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(config) => return config,
                    Err(e) => error!("Failed to parse config: {}", e),
                },
                Err(e) => error!("Failed to read config file: {}", e),
            }
        }
        
        // Default Config
        let mut default_snippets = HashMap::new();
        default_snippets.insert("/demo".to_string(), "【YiboFlow Mock Magic Snippet Inject!】".to_string());
        default_snippets.insert("/em".to_string(), "master@yiboflow.local".to_string());

        let cfg = Self { 
            snippets: default_snippets,
            autofill_dict: HashMap::new(),
            is_snippets_enabled: true,
            is_autofill_enabled: true,
            is_sync_enabled: true,
            blocked_apps: default_empty_vec(),
            local_password_hash: default_empty_string(),
            local_kdf_salt: default_empty_string(),
        };
        cfg.save();
        cfg
    }

    pub fn save(&self) {
        let path = Self::config_path();
        match serde_json::to_string_pretty(self) {
            Ok(json) => {
                if let Err(e) = fs::write(path, json) {
                    error!("Failed to save config: {}", e);
                }
            }
            Err(e) => error!("Failed to serialize config: {}", e),
        }
    }
}

pub fn add_snippet(trigger: String, replacement: String) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.snippets.insert(trigger, replacement);
    cfg.save();
    info!("Snippet added successfully.");
    Ok(())
}

pub fn remove_snippet(trigger: String) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.snippets.remove(&trigger);
    cfg.save();
    info!("Snippet removed successfully.");
    Ok(())
}

pub fn get_snippets() -> HashMap<String, String> {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    cfg.snippets.clone()
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

pub fn get_settings() -> (bool, bool, bool) {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    (cfg.is_snippets_enabled, cfg.is_sync_enabled, cfg.is_autofill_enabled)
}

pub fn update_settings(is_snippets_enabled: bool, is_sync_enabled: bool, is_autofill_enabled: bool) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.is_snippets_enabled = is_snippets_enabled;
    cfg.is_sync_enabled = is_sync_enabled;
    cfg.is_autofill_enabled = is_autofill_enabled;
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
