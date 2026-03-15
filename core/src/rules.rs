use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use lazy_static::lazy_static;

// ---------------------------------------------------------------------------
// Data Model — mirrors specs.md §5.6
// ---------------------------------------------------------------------------

/// 每个功能模块的功能 ID（用于查询）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Feature {
    FlowSnap,
    FlowHint,
    FlowWriter,
    FlowPredict,
    FlowSync,
}

/// 默认行：未列入矩阵的应用均继承此策略
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DefaultRules {
    pub flowsnap: bool,
    pub flowhint: bool,
    pub flowwriter: bool,
    pub flowpredict: bool,
    pub flowsync: bool,
}

impl Default for DefaultRules {
    fn default() -> Self {
        Self {
            flowsnap: true,
            flowhint: false,
            flowwriter: true,
            flowpredict: true,
            flowsync: true,
        }
    }
}

impl DefaultRules {
    pub fn is_enabled(&self, feature: Feature) -> bool {
        match feature {
            Feature::FlowSnap => self.flowsnap,
            Feature::FlowHint => self.flowhint,
            Feature::FlowWriter => self.flowwriter,
            Feature::FlowPredict => self.flowpredict,
            Feature::FlowSync => self.flowsync,
        }
    }
}

/// 单条应用覆写规则
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppRule {
    pub process: String,
    pub display_name: String,
    pub flowsnap: bool,
    pub flowhint: bool,
    #[serde(default)]
    pub flowhint_dicts: Vec<String>,
    pub flowwriter: bool,
    pub flowpredict: bool,
    pub flowsync: bool,
}

impl AppRule {
    pub fn is_enabled(&self, feature: Feature) -> bool {
        match feature {
            Feature::FlowSnap => self.flowsnap,
            Feature::FlowHint => self.flowhint,
            Feature::FlowWriter => self.flowwriter,
            Feature::FlowPredict => self.flowpredict,
            Feature::FlowSync => self.flowsync,
        }
    }
}

/// 完整 FlowRules 配置
#[derive(Serialize, Deserialize, Clone, Debug)]
#[derive(Default)]
pub struct FlowRulesConfig {
    pub default: DefaultRules,
    pub app_overrides: Vec<AppRule>,
}


// ---------------------------------------------------------------------------
// Runtime Cache — 热路径查询 O(1)
// ---------------------------------------------------------------------------

/// 内存中的运行时缓存，以 process 名 (小写) 为 key，避免 Hook 回调每次遍历 Vec
struct RulesCache {
    default: DefaultRules,
    app_map: HashMap<String, AppRule>,
}

impl RulesCache {
    fn from_config(cfg: &FlowRulesConfig) -> Self {
        let mut app_map = HashMap::with_capacity(cfg.app_overrides.len());
        for rule in &cfg.app_overrides {
            let key = rule.process.trim().to_lowercase();
            app_map.insert(key, rule.clone());
        }
        Self {
            default: cfg.default.clone(),
            app_map,
        }
    }
}

// ---------------------------------------------------------------------------
// Global Singleton
// ---------------------------------------------------------------------------

lazy_static! {
    static ref RULES_CONFIG: RwLock<FlowRulesConfig> = RwLock::new(FlowRulesConfig::load_or_default());
    static ref RULES_CACHE: RwLock<RulesCache> = {
        let cfg = RULES_CONFIG.read().unwrap();
        RwLock::new(RulesCache::from_config(&cfg))
    };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

impl FlowRulesConfig {
    pub fn rules_path() -> PathBuf {
        let mut path = crate::local_auth::get_active_user_dir();
        path.push("rules.json");
        path
    }

    pub fn reload() {
        let new_cfg = Self::load_or_default();
        if let Ok(mut lock) = RULES_CONFIG.write() {
            *lock = new_cfg.clone();
        }
        if let Ok(mut lock) = RULES_CACHE.write() {
            *lock = RulesCache::from_config(&new_cfg);
        }
    }

    pub fn load_or_default() -> Self {
        let path = Self::rules_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(config) => return config,
                    Err(e) => error!("Failed to parse rules.json: {}", e),
                },
                Err(e) => error!("Failed to read rules.json: {}", e),
            }
        }
        let default_cfg = Self::default();
        default_cfg.save();
        default_cfg
    }

    pub fn save(&self) {
        let path = Self::rules_path();
        match serde_json::to_string_pretty(self) {
            Ok(json) => {
                if let Err(e) = fs::write(path, json) {
                    error!("Failed to save rules.json: {}", e);
                }
            }
            Err(e) => error!("Failed to serialize rules: {}", e),
        }
    }
}

pub fn reload() {
    FlowRulesConfig::reload();
}

/// 将当前 CONFIG 刷入磁盘并重建缓存
fn persist_and_rebuild() {
    let cfg = RULES_CONFIG.read().unwrap();
    cfg.save();
    let mut cache = RULES_CACHE.write().unwrap();
    *cache = RulesCache::from_config(&cfg);
}

// ---------------------------------------------------------------------------
// Hot-path Query API（被 hook_manager 调用，必须极低开销）
// ---------------------------------------------------------------------------

/// 查询某个进程名 (小写) 的某个功能是否启用
/// 若进程有覆写规则，使用覆写；否则使用默认值
pub fn is_feature_enabled(process_name: &str, feature: Feature) -> bool {
    let cache = RULES_CACHE.read().unwrap();
    if let Some(rule) = cache.app_map.get(process_name) {
        rule.is_enabled(feature)
    } else {
        cache.default.is_enabled(feature)
    }
}

/// 查询某个进程是否对 **任何** 功能都被禁用（全行关），等效于旧版 blocked_apps
pub fn is_all_disabled(process_name: &str) -> bool {
    let cache = RULES_CACHE.read().unwrap();
    if let Some(rule) = cache.app_map.get(process_name) {
        !rule.flowsnap && !rule.flowhint && !rule.flowwriter && !rule.flowpredict && !rule.flowsync
    } else {
        // 默认行不太可能全关，但仍做判断
        let d = &cache.default;
        !d.flowsnap && !d.flowhint && !d.flowwriter && !d.flowpredict && !d.flowsync
    }
}

/// 获取某个进程专属绑定的 FlowHint 词库 ID 列表
pub fn get_app_flowhint_dicts(process_name: &str) -> Vec<String> {
    let cache = RULES_CACHE.read().unwrap();
    let is_enabled = if let Some(rule) = cache.app_map.get(process_name) {
        if !rule.flowhint_dicts.is_empty() && rule.flowhint {
            return rule.flowhint_dicts.clone();
        }
        rule.flowhint
    } else {
        cache.default.flowhint
    };

    if is_enabled {
        let dict_cache = crate::dictionary::DICT_CACHE.read().unwrap();
        return dict_cache.keys().cloned().collect();
    }
    Vec::new()
}

/// 获取完整规则配置（序列化到前端）
pub fn get_rules() -> FlowRulesConfig {
    let cfg = RULES_CONFIG.read().unwrap();
    cfg.clone()
}

/// 更新默认行
pub fn set_default_rules(default: DefaultRules) -> Result<(), String> {
    let mut cfg = RULES_CONFIG.write().map_err(|e| e.to_string())?;
    cfg.default = default;
    drop(cfg);
    persist_and_rebuild();
    info!("Default rules updated.");
    Ok(())
}

/// 添加一条应用覆写规则（若 process 已存在则覆盖）
pub fn upsert_app_rule(rule: AppRule) -> Result<(), String> {
    let mut cfg = RULES_CONFIG.write().map_err(|e| e.to_string())?;
    let key = rule.process.trim().to_lowercase();
    if let Some(existing) = cfg.app_overrides.iter_mut().find(|r| r.process.trim().to_lowercase() == key) {
        *existing = rule;
    } else {
        cfg.app_overrides.push(rule);
    }
    drop(cfg);
    persist_and_rebuild();
    info!("App rule upserted for process.");
    Ok(())
}

/// 删除一条应用覆写规则
pub fn remove_app_rule(process: String) -> Result<(), String> {
    let mut cfg = RULES_CONFIG.write().map_err(|e| e.to_string())?;
    let key = process.trim().to_lowercase();
    let before = cfg.app_overrides.len();
    cfg.app_overrides.retain(|r| r.process.trim().to_lowercase() != key);
    if cfg.app_overrides.len() == before {
        warn!("remove_app_rule: process '{}' not found in overrides.", process);
    }
    drop(cfg);
    persist_and_rebuild();
    info!("App rule removed for process: {}", process);
    Ok(())
}

/// 切换某条规则中某个功能的开关
pub fn toggle_app_feature(process: String, feature: Feature) -> Result<(), String> {
    let mut cfg = RULES_CONFIG.write().map_err(|e| e.to_string())?;
    let key = process.trim().to_lowercase();
    if let Some(rule) = cfg.app_overrides.iter_mut().find(|r| r.process.trim().to_lowercase() == key) {
        match feature {
            Feature::FlowSnap => rule.flowsnap = !rule.flowsnap,
            Feature::FlowHint => rule.flowhint = !rule.flowhint,
            Feature::FlowWriter => rule.flowwriter = !rule.flowwriter,
            Feature::FlowPredict => rule.flowpredict = !rule.flowpredict,
            Feature::FlowSync => rule.flowsync = !rule.flowsync,
        }
    } else {
        return Err(format!("No override rule found for process: {}", process));
    }
    drop(cfg);
    persist_and_rebuild();
    Ok(())
}

/// 切换默认行中某个功能的开关
pub fn toggle_default_feature(feature: Feature) -> Result<(), String> {
    let mut cfg = RULES_CONFIG.write().map_err(|e| e.to_string())?;
    match feature {
        Feature::FlowSnap => cfg.default.flowsnap = !cfg.default.flowsnap,
        Feature::FlowHint => cfg.default.flowhint = !cfg.default.flowhint,
        Feature::FlowWriter => cfg.default.flowwriter = !cfg.default.flowwriter,
        Feature::FlowPredict => cfg.default.flowpredict = !cfg.default.flowpredict,
        Feature::FlowSync => cfg.default.flowsync = !cfg.default.flowsync,
    }
    drop(cfg);
    persist_and_rebuild();
    Ok(())
}



/// 重新从磁盘加载配置，覆盖当前内存（用于导入备份后刷新）
pub fn force_reload_from_disk() {
    let cfg = FlowRulesConfig::load_or_default();
    let mut config_lock = RULES_CONFIG.write().unwrap();
    *config_lock = cfg.clone();
    let mut cache_lock = RULES_CACHE.write().unwrap();
    *cache_lock = RulesCache::from_config(&cfg);
    info!("FlowRules force reloaded from disk.");
}
