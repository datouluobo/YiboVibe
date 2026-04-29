use log::error;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use lazy_static::lazy_static;

lazy_static! {
    pub static ref GLOBAL_CONFIG: Arc<RwLock<AppConfig>> = Arc::new(RwLock::new(AppConfig::load_or_default()));
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum ProbeProtocol {
    OpenAiCompatible,
    Ollama,
    GeminiOpenAiCompatible,
    Anthropic,
    Custom,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProbeTarget {
    pub id: String,
    pub name: String,
    pub protocol: ProbeProtocol,
    pub base_url: String,
    pub model: String,
    pub is_enabled: bool,
    pub order: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProbeToolConfig {
    pub targets: Vec<ProbeTarget>,
    pub timeout_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowConfig {
    pub pos_type: i32, // 0: Follow, 1: Fixed
    pub fixed_x: i32,
    pub fixed_y: i32,
    pub offset_x: i32,
    pub offset_y: i32,
    #[serde(default = "default_scale")]
    pub scale: f32,
    #[serde(default = "default_neg1")]
    pub width: i32,  // -1 = auto (300 * scale)
    #[serde(default = "default_neg1")]
    pub height: i32, // -1 = auto (base * scale)
}

fn default_scale() -> f32 { 1.0 }
fn default_neg1() -> i32 { -1 }

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            pos_type: 0,
            fixed_x: -1,
            fixed_y: -1,
            offset_x: 0,
            offset_y: 0,
            scale: default_scale(),
            width: -1,
            height: -1,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SearchEngine {
    pub name: String,
    pub template_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CacheConfig {
    #[serde(default = "default_cache_dir")]
    pub cache_dir: String,
    #[serde(default = "default_cache_max_size")]
    pub cache_max_size_mb: u64,
    #[serde(default = "default_cleanup_days")]
    pub auto_cleanup_days: u32,
    #[serde(default = "default_image_transport_format")]
    pub image_transport_format: String,
}

fn default_cache_dir() -> String { String::new() }
fn default_cache_max_size() -> u64 { 200 }
fn default_cleanup_days() -> u32 { 7 }
fn default_image_transport_format() -> String { "png".to_string() }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppConfig {
    #[serde(default = "default_true")]
    pub is_sync_enabled: bool,
    #[serde(default = "default_empty_string")]
    pub local_password_hash: String,
    #[serde(default = "default_empty_string")]
    pub local_kdf_salt: String,
    #[serde(default = "default_min_chars")]
    pub flowhint_min_chars: usize,
    #[serde(default = "default_true")]
    pub flowhint_accept_tab: bool,
    #[serde(default = "default_true")]
    pub flowhint_accept_right: bool,
    #[serde(default)]
    pub debug_mode: bool,
    #[serde(default)]
    pub sync_meta: crate::sync::SyncMeta,
    #[serde(default)]
    pub probe_tool: ProbeToolConfig,
    #[serde(default)]
    pub dictionary_order: Vec<String>,
    #[serde(default = "default_fingerprint")]
    pub device_fingerprint: String,
    #[serde(default)]
    pub hint_window: WindowConfig,
    #[serde(default)]
    pub is_window_config_unified: bool,
    #[serde(default)]
    pub cache: CacheConfig,
}

fn default_min_chars() -> usize { 2 }


fn default_true() -> bool { true }
fn default_empty_string() -> String { String::new() }
fn default_fingerprint() -> String { uuid::Uuid::new_v4().to_string() }
fn default_probe_timeout() -> u64 { 10000 }

fn default_probe_targets() -> Vec<ProbeTarget> {
    vec![
        ProbeTarget {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Local Ollama".to_string(),
            protocol: ProbeProtocol::Ollama,
            base_url: "http://127.0.0.1:11434".to_string(),
            model: "".to_string(),
            is_enabled: true,
            order: 1,
        },
        ProbeTarget {
            id: uuid::Uuid::new_v4().to_string(),
            name: "NAS Ollama".to_string(),
            protocol: ProbeProtocol::Ollama,
            base_url: "http://192.168.1.88:11434".to_string(),
            model: "".to_string(),
            is_enabled: true,
            order: 2,
        },
        ProbeTarget {
            id: uuid::Uuid::new_v4().to_string(),
            name: "DeepSeek API".to_string(),
            protocol: ProbeProtocol::OpenAiCompatible,
            base_url: "https://api.deepseek.com/v1".to_string(),
            model: "deepseek-chat".to_string(),
            is_enabled: true,
            order: 3,
        },
        ProbeTarget {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Anthropic API".to_string(),
            protocol: ProbeProtocol::Anthropic,
            base_url: "https://api.anthropic.com".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            is_enabled: true,
            order: 4,
        },
    ]
}

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
                        if config.probe_tool.targets.is_empty() {
                            config.probe_tool.targets = default_probe_targets();
                        }
                        if config.probe_tool.timeout_ms == 0 {
                            config.probe_tool.timeout_ms = default_probe_timeout();
                            config.save();
                        }
                        if config.cache.image_transport_format.is_empty() {
                            config.cache.image_transport_format = default_image_transport_format();
                            config.save();
                        }
                        return config;
                    },
                    Err(e) => error!("Failed to parse config: {}", e),
                },
                Err(e) => error!("Failed to read config file: {}", e),
            }
        }
        
        // Default Config
        let cfg = Self { 
            is_sync_enabled: true,
            local_password_hash: default_empty_string(),
            local_kdf_salt: default_empty_string(),
            flowhint_min_chars: 2,
            flowhint_accept_tab: true,
            flowhint_accept_right: true,
            debug_mode: false,
            probe_tool: ProbeToolConfig {
                targets: default_probe_targets(),
                timeout_ms: default_probe_timeout(),
            },
            sync_meta: crate::sync::SyncMeta::default(),
            dictionary_order: Vec::new(),
            device_fingerprint: default_fingerprint(),
            hint_window: WindowConfig::default(),
            is_window_config_unified: false,
            cache: CacheConfig::default(),
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

pub fn get_settings() -> (bool, usize, bool, bool) {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    (cfg.is_sync_enabled, cfg.flowhint_min_chars, cfg.flowhint_accept_tab, cfg.flowhint_accept_right)
}

pub fn update_settings(
    is_sync_enabled: bool,
    flowhint_min_chars: usize,
    flowhint_accept_tab: bool,
    flowhint_accept_right: bool,
) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.is_sync_enabled = is_sync_enabled;
    cfg.flowhint_min_chars = flowhint_min_chars;
    cfg.flowhint_accept_tab = flowhint_accept_tab;
    cfg.flowhint_accept_right = flowhint_accept_right;
    cfg.save();
    Ok(())
}

pub fn set_dictionary_order(order: Vec<String>) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.dictionary_order = order;
    cfg.save();
    Ok(())
}

pub fn reload() {
    AppConfig::reload();
}
