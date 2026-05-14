use lazy_static::lazy_static;
use log::error;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

lazy_static! {
    pub static ref GLOBAL_CONFIG: Arc<RwLock<AppConfig>> =
        Arc::new(RwLock::new(AppConfig::load_or_default()));
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum ProbeProtocol {
    OpenAiCompatible,
    Ollama,
    GeminiOpenAiCompatible,
    Anthropic,
    Custom,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum ProbeRouteKind {
    OpenAi,
    Anthropic,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProbeCredential {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub protocol: ProbeProtocol,
    pub base_url: String,
    pub default_model: String,
    #[serde(default)]
    pub discovered_models: Vec<String>,
    #[serde(default)]
    pub model_catalog_updated_at_ms: Option<u64>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub enabled: bool,
    pub sort_order: i32,
    #[serde(default)]
    pub input_price_per_million: Option<f64>,
    #[serde(default)]
    pub output_price_per_million: Option<f64>,
    #[serde(default = "default_probe_price_unit")]
    pub price_unit: String,
    #[serde(default = "default_probe_price_currency")]
    pub price_currency: String,
    #[serde(default)]
    pub last_test_latency_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProbeRoute {
    pub kind: ProbeRouteKind,
    pub credential_id: String,
    #[serde(default)]
    pub model_override: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProbeProxyConfig {
    pub listen_host: String,
    pub listen_port: u16,
    pub local_token: String,
    pub is_enabled: bool,
    pub collect_usage: bool,
}

impl Default for ProbeProxyConfig {
    fn default() -> Self {
        Self {
            listen_host: "127.0.0.1".to_string(),
            listen_port: 17861,
            local_token: generate_probe_local_token(),
            is_enabled: true,
            collect_usage: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LegacyProbeTarget {
    pub id: String,
    pub name: String,
    pub protocol: ProbeProtocol,
    pub base_url: String,
    pub model: String,
    pub is_enabled: bool,
    pub order: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProbeToolConfig {
    #[serde(default)]
    pub credentials: Vec<ProbeCredential>,
    #[serde(default)]
    pub routes: Vec<ProbeRoute>,
    #[serde(default)]
    pub proxy: ProbeProxyConfig,
    #[serde(default = "default_probe_timeout")]
    pub timeout_ms: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<LegacyProbeTarget>,
}

impl Default for ProbeToolConfig {
    fn default() -> Self {
        let credentials = default_probe_credentials();
        let routes = default_probe_routes(&credentials);
        Self {
            credentials,
            routes,
            proxy: ProbeProxyConfig::default(),
            timeout_ms: default_probe_timeout(),
            targets: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowConfig {
    pub pos_type: i32,
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

fn default_cache_dir() -> String {
    String::new()
}

fn default_cache_max_size() -> u64 {
    200
}

fn default_cleanup_days() -> u32 {
    7
}

fn default_image_transport_format() -> String {
    "png".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppConfig {
    #[serde(default = "default_true")]
    pub is_sync_enabled: bool,
    #[serde(default = "default_true")]
    pub auto_sync_text: bool,
    #[serde(default = "default_true")]
    pub auto_sync_image: bool,
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
    pub flowprobe_backup_keys: bool,
    #[serde(default)]
    pub dictionary_order: Vec<String>,
    #[serde(default = "default_fingerprint")]
    pub device_fingerprint: String,
    #[serde(default)]
    pub hint_window: WindowConfig,
    #[serde(default)]
    pub is_window_config_unified: bool,
    #[serde(default = "default_terminal_shell")]
    pub terminal_default_shell: String,
    #[serde(default)]
    pub cache: CacheConfig,
}

fn default_min_chars() -> usize {
    2
}

fn default_true() -> bool {
    true
}

fn default_empty_string() -> String {
    String::new()
}

fn default_fingerprint() -> String {
    stable_device_fingerprint()
}

fn default_terminal_shell() -> String {
    "cmd".to_string()
}

fn default_probe_timeout() -> u64 {
    10000
}

fn default_probe_price_unit() -> String {
    "1M tokens".to_string()
}

fn default_probe_price_currency() -> String {
    "USD".to_string()
}

fn default_probe_credentials() -> Vec<ProbeCredential> {
    vec![
        ProbeCredential {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Local Ollama".to_string(),
            provider: "Ollama".to_string(),
            protocol: ProbeProtocol::Ollama,
            base_url: "http://127.0.0.1:11434".to_string(),
            default_model: "".to_string(),
            discovered_models: Vec::new(),
            model_catalog_updated_at_ms: None,
            note: "Local model runtime".to_string(),
            tags: vec!["local".to_string(), "private".to_string()],
            enabled: true,
            sort_order: 1,
            input_price_per_million: None,
            output_price_per_million: None,
            price_unit: default_probe_price_unit(),
            price_currency: default_probe_price_currency(),
            last_test_latency_ms: None,
        },
        ProbeCredential {
            id: uuid::Uuid::new_v4().to_string(),
            name: "NAS Ollama".to_string(),
            provider: "Ollama".to_string(),
            protocol: ProbeProtocol::Ollama,
            base_url: "http://192.168.1.88:11434".to_string(),
            default_model: "".to_string(),
            discovered_models: Vec::new(),
            model_catalog_updated_at_ms: None,
            note: "NAS-hosted model runtime".to_string(),
            tags: vec!["nas".to_string(), "private".to_string()],
            enabled: true,
            sort_order: 2,
            input_price_per_million: None,
            output_price_per_million: None,
            price_unit: default_probe_price_unit(),
            price_currency: default_probe_price_currency(),
            last_test_latency_ms: None,
        },
        ProbeCredential {
            id: uuid::Uuid::new_v4().to_string(),
            name: "DeepSeek API".to_string(),
            provider: "DeepSeek".to_string(),
            protocol: ProbeProtocol::OpenAiCompatible,
            base_url: "https://api.deepseek.com/v1".to_string(),
            default_model: "deepseek-chat".to_string(),
            discovered_models: Vec::new(),
            model_catalog_updated_at_ms: None,
            note: "OpenAI-compatible upstream".to_string(),
            tags: vec!["cloud".to_string(), "openai".to_string()],
            enabled: true,
            sort_order: 3,
            input_price_per_million: None,
            output_price_per_million: None,
            price_unit: default_probe_price_unit(),
            price_currency: default_probe_price_currency(),
            last_test_latency_ms: None,
        },
        ProbeCredential {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Anthropic API".to_string(),
            provider: "Anthropic".to_string(),
            protocol: ProbeProtocol::Anthropic,
            base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            discovered_models: Vec::new(),
            model_catalog_updated_at_ms: None,
            note: "Anthropic official API".to_string(),
            tags: vec!["cloud".to_string(), "anthropic".to_string()],
            enabled: true,
            sort_order: 4,
            input_price_per_million: None,
            output_price_per_million: None,
            price_unit: default_probe_price_unit(),
            price_currency: default_probe_price_currency(),
            last_test_latency_ms: None,
        },
    ]
}

fn default_probe_routes(credentials: &[ProbeCredential]) -> Vec<ProbeRoute> {
    let openai_id = credentials
        .iter()
        .find(|credential| {
            credential.enabled
                && matches!(
                    credential.protocol,
                    ProbeProtocol::OpenAiCompatible | ProbeProtocol::GeminiOpenAiCompatible
                )
        })
        .map(|credential| credential.id.clone())
        .unwrap_or_default();
    let anthropic_id = credentials
        .iter()
        .find(|credential| credential.enabled && credential.protocol == ProbeProtocol::Anthropic)
        .map(|credential| credential.id.clone())
        .unwrap_or_default();

    vec![
        ProbeRoute {
            kind: ProbeRouteKind::OpenAi,
            credential_id: openai_id,
            model_override: String::new(),
            enabled: true,
        },
        ProbeRoute {
            kind: ProbeRouteKind::Anthropic,
            credential_id: anthropic_id,
            model_override: String::new(),
            enabled: true,
        },
    ]
}

fn generate_probe_local_token() -> String {
    let token = uuid::Uuid::new_v4().simple().to_string();
    format!("yfp-{}", &token[..12])
}

fn normalize_probe_provider(name: &str, protocol: &ProbeProtocol) -> String {
    let lower = name.to_lowercase();
    if lower.contains("openrouter") {
        "OpenRouter".to_string()
    } else if lower.contains("deepseek") {
        "DeepSeek".to_string()
    } else if lower.contains("anthropic") || matches!(protocol, ProbeProtocol::Anthropic) {
        "Anthropic".to_string()
    } else if lower.contains("ollama") || matches!(protocol, ProbeProtocol::Ollama) {
        "Ollama".to_string()
    } else if lower.contains("gemini") {
        "Gemini".to_string()
    } else {
        name.trim().to_string()
    }
}

fn migrate_legacy_targets(targets: &[LegacyProbeTarget]) -> Vec<ProbeCredential> {
    let mut ordered = targets.to_vec();
    ordered.sort_by_key(|target| target.order);
    ordered
        .into_iter()
        .enumerate()
        .map(|(index, target)| ProbeCredential {
            id: target.id,
            name: target.name.clone(),
            provider: normalize_probe_provider(&target.name, &target.protocol),
            protocol: target.protocol,
            base_url: target.base_url.trim().trim_end_matches('/').to_string(),
            default_model: target.model.trim().to_string(),
            discovered_models: Vec::new(),
            model_catalog_updated_at_ms: None,
            note: "Migrated from legacy FlowProbe targets".to_string(),
            tags: Vec::new(),
            enabled: target.is_enabled,
            sort_order: index as i32 + 1,
            input_price_per_million: None,
            output_price_per_million: None,
            price_unit: default_probe_price_unit(),
            price_currency: default_probe_price_currency(),
            last_test_latency_ms: None,
        })
        .collect()
}

fn ensure_probe_defaults(config: &mut AppConfig) -> bool {
    let mut mutated = false;

    if config.probe_tool.credentials.is_empty() {
        if !config.probe_tool.targets.is_empty() {
            config.probe_tool.credentials = migrate_legacy_targets(&config.probe_tool.targets);
        } else {
            config.probe_tool.credentials = default_probe_credentials();
        }
        mutated = true;
    }

    if config.probe_tool.routes.is_empty() {
        config.probe_tool.routes = default_probe_routes(&config.probe_tool.credentials);
        mutated = true;
    }

    if config.probe_tool.proxy.listen_host.trim().is_empty() {
        config.probe_tool.proxy.listen_host = ProbeProxyConfig::default().listen_host;
        mutated = true;
    }
    if config.probe_tool.proxy.listen_port == 0 {
        config.probe_tool.proxy.listen_port = ProbeProxyConfig::default().listen_port;
        mutated = true;
    }
    if config.probe_tool.proxy.local_token.trim().is_empty() {
        config.probe_tool.proxy.local_token = generate_probe_local_token();
        mutated = true;
    }
    if config.probe_tool.timeout_ms == 0 {
        config.probe_tool.timeout_ms = default_probe_timeout();
        mutated = true;
    }
    if !config.probe_tool.targets.is_empty() {
        config.probe_tool.targets.clear();
        mutated = true;
    }

    let mut credentials = config.probe_tool.credentials.clone();
    credentials.sort_by_key(|credential| credential.sort_order);
    for (index, credential) in credentials.iter_mut().enumerate() {
        let order = index as i32 + 1;
        if credential.sort_order != order {
            credential.sort_order = order;
            mutated = true;
        }
        if credential.price_unit.trim().is_empty() {
            credential.price_unit = default_probe_price_unit();
            mutated = true;
        }
        if credential.price_currency.trim().is_empty() {
            credential.price_currency = default_probe_price_currency();
            mutated = true;
        }
    }
    config.probe_tool.credentials = credentials;

    for route in &mut config.probe_tool.routes {
        let route_kind = route.kind.clone();
        let is_valid = config
            .probe_tool
            .credentials
            .iter()
            .any(|credential| credential.id == route.credential_id);
        if !is_valid {
            route.credential_id = default_probe_routes(&config.probe_tool.credentials)
                .into_iter()
                .find(|candidate| candidate.kind == route_kind)
                .map(|candidate| candidate.credential_id)
                .unwrap_or_default();
            mutated = true;
        }
    }

    mutated
}

fn stable_device_fingerprint() -> String {
    let mut seed_parts = Vec::new();

    if let Ok(value) = std::env::var("YIBOVIBE_MACHINE_FINGERPRINT") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            seed_parts.push(format!("env:{trimmed}"));
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(value) = read_windows_machine_guid() {
        seed_parts.push(format!("machine-guid:{value}"));
    }

    #[cfg(not(target_os = "windows"))]
    if let Some(value) = read_machine_id_file() {
        seed_parts.push(format!("machine-id:{value}"));
    }

    for (key, label) in [
        ("COMPUTERNAME", "computer"),
        ("HOSTNAME", "hostname"),
        ("USERDOMAIN", "domain"),
    ] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                seed_parts.push(format!("{label}:{trimmed}"));
            }
        }
    }

    if seed_parts.is_empty() {
        return format!("machine-{}", uuid::Uuid::new_v4());
    }

    let digest = Sha256::digest(seed_parts.join("|").as_bytes());
    format!("machine-{}", hex::encode(&digest[..16]))
}

#[cfg(target_os = "windows")]
fn read_windows_machine_guid() -> Option<String> {
    let output = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    stdout.lines().find_map(|line| {
        if !line.contains("MachineGuid") {
            return None;
        }

        let value = line.split_whitespace().last()?.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

#[cfg(not(target_os = "windows"))]
fn read_machine_id_file() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| {
            let value = fs::read_to_string(path).ok()?;
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
}

fn needs_fingerprint_migration(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok()
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
                        let mut mutated = ensure_probe_defaults(&mut config);
                        if config.cache.image_transport_format.is_empty() {
                            config.cache.image_transport_format = default_image_transport_format();
                            mutated = true;
                        }
                        if config.device_fingerprint.trim().is_empty()
                            || needs_fingerprint_migration(&config.device_fingerprint)
                        {
                            config.device_fingerprint = stable_device_fingerprint();
                            mutated = true;
                        }
                        if mutated {
                            config.save();
                        }
                        return config;
                    }
                    Err(e) => error!("Failed to parse config: {}", e),
                },
                Err(e) => error!("Failed to read config file: {}", e),
            }
        }

        let cfg = Self {
            is_sync_enabled: true,
            auto_sync_text: true,
            auto_sync_image: true,
            local_password_hash: default_empty_string(),
            local_kdf_salt: default_empty_string(),
            flowhint_min_chars: 2,
            flowhint_accept_tab: true,
            flowhint_accept_right: true,
            debug_mode: false,
            probe_tool: ProbeToolConfig::default(),
            flowprobe_backup_keys: false,
            sync_meta: crate::sync::SyncMeta::default(),
            dictionary_order: Vec::new(),
            device_fingerprint: default_fingerprint(),
            hint_window: WindowConfig::default(),
            is_window_config_unified: false,
            terminal_default_shell: default_terminal_shell(),
            cache: CacheConfig::default(),
        };
        cfg.save();
        cfg
    }

    pub fn save(&self) {
        let mut to_save = self.clone();
        if to_save.is_sync_enabled {
            to_save.sync_meta.global_updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
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
    (
        cfg.is_sync_enabled,
        cfg.flowhint_min_chars,
        cfg.flowhint_accept_tab,
        cfg.flowhint_accept_right,
    )
}

pub fn get_flowsync_auto_sync_prefs() -> (bool, bool) {
    let cfg = GLOBAL_CONFIG.read().unwrap();
    (cfg.auto_sync_text, cfg.auto_sync_image)
}

pub fn set_flowsync_auto_sync_prefs(
    auto_sync_text: bool,
    auto_sync_image: bool,
) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.auto_sync_text = auto_sync_text;
    cfg.auto_sync_image = auto_sync_image;
    cfg.save();
    Ok(())
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
