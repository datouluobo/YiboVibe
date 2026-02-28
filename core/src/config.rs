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
}

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

        let cfg = Self { snippets: default_snippets };
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
