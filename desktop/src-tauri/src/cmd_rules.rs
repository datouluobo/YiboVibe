//! FlowRules — per-app feature permission matrix commands

use crate::parse_feature;
use serde::Serialize;

#[derive(Serialize)]
pub struct FlowRulesPayload {
    pub default: yibovibe_core::rules::DefaultRules,
    pub app_overrides: Vec<yibovibe_core::rules::AppRule>,
}

#[tauri::command]
pub fn get_flow_rules() -> Result<FlowRulesPayload, String> {
    let cfg = yibovibe_core::rules::get_rules();
    Ok(FlowRulesPayload {
        default: cfg.default,
        app_overrides: cfg.app_overrides,
    })
}

#[tauri::command]
pub fn set_default_rules(
    flowsnap: bool,
    flowhint: bool,
    flowsync: bool,
    flowkeys: bool,
) -> Result<(), String> {
    yibovibe_core::rules::set_default_rules(yibovibe_core::rules::DefaultRules {
        flowsnap,
        flowhint,
        flowsync,
        flowkeys,
    })
}

#[tauri::command]
pub fn upsert_app_rule(
    process: String,
    display_name: String,
    flowsnap: Option<bool>,
    flowhint: Option<bool>,
    flowhint_dicts: Vec<String>,
    flowsync: Option<bool>,
    flowkeys: Option<bool>,
) -> Result<(), String> {
    yibovibe_core::rules::upsert_app_rule(yibovibe_core::rules::AppRule {
        process,
        display_name,
        flowsnap,
        flowhint,
        flowhint_dicts,
        flowsync,
        flowkeys,
    })
}

#[tauri::command]
pub fn remove_app_rule(process: String) -> Result<(), String> {
    yibovibe_core::rules::remove_app_rule(process)
}

#[tauri::command]
pub fn toggle_app_feature(process: String, feature: String) -> Result<(), String> {
    let f = crate::parse_feature(&feature)?;
    yibovibe_core::rules::toggle_app_feature(process, f)
}

#[tauri::command]
pub fn toggle_default_feature(feature: String) -> Result<(), String> {
    let f = crate::parse_feature(&feature)?;
    yibovibe_core::rules::toggle_default_feature(f)
}
