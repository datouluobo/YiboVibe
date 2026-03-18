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
pub enum AiProvider {
    DeepSeek,
    OpenAI,
    Gemini,
    Anthropic,
    OllamaLocal,
    OllamaLAN,
    Custom,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AiEndpoint {
    pub provider: AiProvider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub is_enabled: bool,
    pub priority: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AiEngineConfig {
    pub endpoints: Vec<AiEndpoint>,
    pub auto_mode: bool,
    pub timeout_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WindowConfig {
    pub pos_type: i32, // 0: Follow, 1: Fixed
    pub fixed_x: i32,
    pub fixed_y: i32,
    pub offset_x: i32,
    pub offset_y: i32,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            pos_type: 0,
            fixed_x: -1,
            fixed_y: -1,
            offset_x: 0,
            offset_y: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SearchEngine {
    pub name: String,
    pub template_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FlowWriterConfig {
    pub trigger_selection: bool,
    pub trigger_copy: bool,
    pub trigger_hotkey: bool,
    pub hotkey: String,
    pub preview_dismiss_on_blur: bool,
    pub default_search_engine: String,
    pub custom_search_engines: Vec<SearchEngine>,
    pub custom_translate_languages: Vec<String>,
}

impl Default for FlowWriterConfig {
    fn default() -> Self {
        Self {
            trigger_selection: true,
            trigger_copy: false,
            trigger_hotkey: true,
            hotkey: "Alt+Q".to_string(),
            preview_dismiss_on_blur: true,
            default_search_engine: "Google".to_string(),
            custom_search_engines: Vec::new(),
            custom_translate_languages: Vec::new(),
        }
    }
}


#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    #[serde(default = "default_true")]
    pub is_sync_enabled: bool,
    #[serde(default = "default_empty_string")]
    pub local_password_hash: String,
    #[serde(default = "default_empty_string")]
    pub local_kdf_salt: String,
    #[serde(default = "default_min_chars")]
    pub flowhint_min_chars: usize,
    #[serde(default = "default_tab_key")]
    pub flowhint_accept_key: u32,
    #[serde(default)]
    pub hint_window: WindowConfig,
    #[serde(default)]
    pub writer_window: WindowConfig,
    #[serde(default)]
    pub sync_meta: crate::sync::SyncMeta,
    #[serde(default)]
    pub ai_engine: AiEngineConfig,
    #[serde(default)]
    pub flowwriter: FlowWriterConfig,
    #[serde(default)]
    pub is_window_config_unified: bool,
    #[serde(default)]
    pub dictionary_order: Vec<String>,
}

fn default_min_chars() -> usize { 2 }
fn default_tab_key() -> u32 { 0x09 }


fn default_true() -> bool { true }
fn default_empty_string() -> String { String::new() }

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
                        if config.ai_engine.endpoints.is_empty() {
                            config.ai_engine.endpoints = vec![
                                AiEndpoint {
                                    provider: AiProvider::OllamaLAN,
                                    base_url: "http://192.168.1.88:11434/v1".to_string(),
                                    api_key: "".to_string(),
                                    model: "".to_string(), // Leave empty to force fetch
                                    is_enabled: true,
                                    priority: 1,
                                },
                                AiEndpoint {
                                    provider: AiProvider::OllamaLAN,
                                    base_url: "https://lisibo.top:98/v1".to_string(),
                                    api_key: "".to_string(),
                                    model: "".to_string(),
                                    is_enabled: true,
                                    priority: 2,
                                },
                            ];
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
            flowhint_accept_key: 0x09,
            hint_window: WindowConfig::default(),
            writer_window: WindowConfig::default(),
            sync_meta: crate::sync::SyncMeta::default(),
            ai_engine: AiEngineConfig {
                endpoints: vec![
                    AiEndpoint {
                        provider: AiProvider::OllamaLAN,
                        base_url: "http://127.0.0.1:11434/v1".to_string(),
                        api_key: "".to_string(),
                        model: "".to_string(),
                        is_enabled: true,
                        priority: 1,
                    },
                    AiEndpoint {
                        provider: AiProvider::OllamaLAN,
                        base_url: "http://localhost:11434/v1".to_string(),
                        api_key: "".to_string(),
                        model: "".to_string(),
                        is_enabled: true,
                        priority: 2,
                    },
                ],
                auto_mode: true,
                timeout_ms: 30000,
            },
            flowwriter: FlowWriterConfig::default(),
            is_window_config_unified: false,
            dictionary_order: Vec::new(),
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

pub fn get_settings() -> (bool, usize, u32) {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    (cfg.is_sync_enabled, cfg.flowhint_min_chars, cfg.flowhint_accept_key)
}

pub fn update_settings(
    is_sync_enabled: bool,
    flowhint_min_chars: usize,
    flowhint_accept_key: u32,
    hint_window: WindowConfig,
    writer_window: WindowConfig,
    is_window_config_unified: bool,
) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.is_sync_enabled = is_sync_enabled;
    cfg.flowhint_min_chars = flowhint_min_chars;
    cfg.flowhint_accept_key = flowhint_accept_key;
    cfg.hint_window = hint_window;
    cfg.writer_window = writer_window;
    cfg.is_window_config_unified = is_window_config_unified;
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
