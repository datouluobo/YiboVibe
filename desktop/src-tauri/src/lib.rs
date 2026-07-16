use log::{info, warn};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::{self, Duration};

mod agent_bridge;
mod codex_app_server;
mod probe;
mod terminal;
mod terminal_screen;

// ── Extracted command modules (see corresponding cmd_*.rs) ──
mod cmd_admin;
mod cmd_clipboard;
mod cmd_codex;
mod cmd_engineering;
mod cmd_flowsync;
mod cmd_probe;
mod cmd_rules;
mod cmd_settings;
mod cmd_terminal;
mod cmd_window;

pub use cmd_settings::{DesktopBuildLabel, SettingsPayload};
pub use cmd_terminal::{ConsoleAdminStatus, TerminalPrefs};
pub use codex_app_server::CodexWorkbenchSnapshotBuild;

const MAIN_WINDOW_DEFAULT_WIDTH: f64 = 1440.0;
const MAIN_WINDOW_DEFAULT_HEIGHT: f64 = 900.0;
const SESSION_CLOSE_TOMBSTONE_SECS: u64 = 8;
const FLOWSYNC_STAGE_CHUNK_BYTES: usize = 4 * 1024 * 1024;

// ── Global lazy statics ──
lazy_static::lazy_static! {
    pub(crate) static ref LAST_HINT_ANCHOR: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));
    pub(crate) static ref HINT_WINDOW_CFG: std::sync::Mutex<(i32, i32, i32, i32, i32)> = std::sync::Mutex::new((0, -1, -1, 0, 20));
    pub(crate) static ref CODEX_IPC_STATE_CACHE: std::sync::Mutex<HashMap<String, serde_json::Value>> = std::sync::Mutex::new(HashMap::new());
    pub(crate) static ref LAST_CODEX_WORKBENCH_SNAPSHOT: std::sync::Mutex<Option<serde_json::Value>> = std::sync::Mutex::new(None);
    pub(crate) static ref RECENTLY_ARCHIVED_CODEX_THREADS: std::sync::Mutex<HashMap<String, u128>> = std::sync::Mutex::new(HashMap::new());
}

// ── Shared state struct ──
pub struct AppState {
    pub session_manager: terminal::SharedSessionManager,
    pub closing_sessions: Mutex<HashMap<String, u64>>,
    pub is_connected: Mutex<bool>,
    pub ws_tx: Mutex<Option<tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>>>,
    pub runtime_server_url: Mutex<Option<String>>,
    pub runtime_username: Mutex<Option<String>>,
    pub runtime_device_name: Mutex<Option<String>>,
    pub runtime_remote_device_id: Mutex<Option<u32>>,
    pub persistent_device_fingerprint: Mutex<Option<String>>,
    pub runtime_device_fingerprint: Mutex<Option<String>>,
    pub runtime_access_token: Mutex<Option<String>>,
    pub runtime_role: Mutex<Option<String>>,
}

// ── Shared types ──
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterDevice {
    pub id: String,
    pub name: String,
    pub is_online: bool,
    pub is_local: bool,
    pub device_type: String,
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared helper functions — used by cmd_*.rs modules
// ═══════════════════════════════════════════════════════════════════════════

pub(crate) fn unix_time_ms_now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub(crate) fn current_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub(crate) fn session_close_deadline() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + SESSION_CLOSE_TOMBSTONE_SECS
}

pub(crate) async fn mark_session_closing(state: &tauri::State<'_, AppState>, session_id: &str) {
    if session_id.is_empty() {
        return;
    }
    let mut closing = state.closing_sessions.lock().await;
    closing.insert(session_id.to_string(), session_close_deadline());
}

pub(crate) async fn is_session_closing(
    state: &tauri::State<'_, AppState>,
    session_id: &str,
) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut closing = state.closing_sessions.lock().await;
    closing.retain(|_, deadline| *deadline > now);
    closing.get(session_id).is_some()
}

pub(crate) async fn resolve_runtime_device_name(state: &tauri::State<'_, AppState>) -> String {
    if let Some(device_name) = state.runtime_device_name.lock().await.clone() {
        let trimmed = device_name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Ok(instance_tag) = std::env::var("YIBOFLOW_INSTANCE_TAG") {
        let trimmed = instance_tag.trim();
        if !trimmed.is_empty() {
            return format!("YiboFlow-{trimmed}");
        }
    }
    "YiboFlow Desktop Native".to_string()
}

pub(crate) fn resolve_runtime_device_fingerprint(base_fingerprint: &str) -> String {
    let instance_tag = std::env::var("YIBOFLOW_INSTANCE_TAG")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    match instance_tag {
        Some(tag) => format!("{base_fingerprint}::{tag}"),
        None => base_fingerprint.to_string(),
    }
}

pub(crate) async fn require_runtime_server_auth(
    state: &tauri::State<'_, AppState>,
) -> Result<(String, String), String> {
    let token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("Not authenticated".to_string())?;
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("Not connected to server".to_string())?;
    Ok((server_url, token))
}

pub(crate) fn sanitize_stage_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "flowsync-object ".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn unique_path(root: &Path, preferred_name: &str) -> PathBuf {
    let candidate = root.join(preferred_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(preferred_name)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("flowsync-object ");
    let ext = Path::new(preferred_name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    for idx in 2..1000 {
        let name = if ext.is_empty() {
            format!("{stem} ({idx})")
        } else {
            format!("{stem} ({idx}).{ext}")
        };
        let next = root.join(name);
        if !next.exists() {
            return next;
        }
    }
    root.join(format!("{stem}-{}", uuid::Uuid::new_v4()))
}

pub(crate) fn stage_expire_at_ms(ttl_seconds: i32) -> i64 {
    current_unix_ms() + (ttl_seconds.max(0) as i64 * 1000)
}

pub(crate) fn normalize_main_window_size(window: &tauri::WebviewWindow) {
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        if window.is_maximized().unwrap_or(false) {
            return;
        }
        let Ok(size) = window.inner_size() else {
            return;
        };
        if (size.width as f64) < MAIN_WINDOW_DEFAULT_WIDTH
            || (size.height as f64) < MAIN_WINDOW_DEFAULT_HEIGHT
        {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                MAIN_WINDOW_DEFAULT_WIDTH,
                MAIN_WINDOW_DEFAULT_HEIGHT,
            )));
            let _ = window.center();
        }
    });
}

pub(crate) fn refresh_hint_window_cfg() {
    let cfg = yibovibe_core::config::GLOBAL_CONFIG.read().unwrap();
    let mut hint_cfg = HINT_WINDOW_CFG.lock().unwrap();
    *hint_cfg = (
        cfg.hint_window.pos_type,
        cfg.hint_window.fixed_x,
        cfg.hint_window.fixed_y,
        cfg.hint_window.offset_x,
        cfg.hint_window.offset_y,
    );
}

pub(crate) fn parse_feature(s: &str) -> Result<yibovibe_core::rules::Feature, String> {
    match s.to_lowercase().as_str() {
        "flowsnap" => Ok(yibovibe_core::rules::Feature::FlowSnap),
        "flowhint" => Ok(yibovibe_core::rules::Feature::FlowHint),
        "flowsync" => Ok(yibovibe_core::rules::Feature::FlowSync),
        "flowkeys" => Ok(yibovibe_core::rules::Feature::FlowKeys),
        _ => Err(format!("Unknown feature: {}", s)),
    }
}

pub(crate) fn ensure_history_runtime_ready() -> Result<(), String> {
    if yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap()
        .is_some()
        || yibovibe_core::cache::HISTORY_MANAGER
            .read()
            .unwrap()
            .is_some()
    {
        return Ok(());
    }
    yibovibe_core::cache::init_cache_and_history()
}

pub(crate) fn format_size_bytes(size_bytes: i64) -> String {
    let size = size_bytes.max(0) as f64;
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    if size >= GB {
        format!("{:.2} GB ", size / GB)
    } else if size >= MB {
        format!("{:.2} MB ", size / MB)
    } else if size >= KB {
        format!("{:.2} KB ", size / KB)
    } else {
        format!("{} B ", size as i64)
    }
}

pub(crate) fn build_flow_object_preview(
    record: &yibovibe_core::flow_store::FlowHistoryEntryRecord,
) -> Result<serde_json::Value, String> {
    match record.entry.entry_type.as_str() {
        "text" => {
            let path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let content =
                std::fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;
            Ok(serde_json::json!({"type": "text", "content ": content}))
        }
        "image " => {
            let path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let data = std::fs::read(&path).map_err(|e| format!("Failed to read: {}", e))?;
            if data.len() < 16 {
                return Err("Invalid image cache data ".into());
            }
            let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as u32;
            let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as u32;
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            if let Some(img_buffer) = image::RgbaImage::from_raw(w, h, data[16..].to_vec()) {
                let mut buf = std::io::Cursor::new(Vec::new());
                if image::DynamicImage::ImageRgba8(img_buffer)
                    .write_to(&mut buf, image::ImageFormat::Png)
                    .is_ok()
                {
                    return Ok(
                        serde_json::json!({"type": "image ", "content ": format!("data:image/png;base64,{}", STANDARD.encode(buf.into_inner())), "width": w, "height": h}),
                    );
                }
            }
            Err("Failed to decode image ".into())
        }
        _ => Ok(
            serde_json::json!({"type": record.entry.entry_type, "preview": record.entry.preview}),
        ),
    }
}

// ── Git helpers ──
pub(crate) fn git_command_output(cwd: &str, args: &[&str]) -> Result<String, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let output = Command::new("git")
        .args(args)
        .current_dir(trimmed)
        .output()
        .map_err(|e| format!("git {:?} failed: {}", args, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "git {:?} failed: {}",
            args,
            if stderr.is_empty() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                stderr
            }
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) fn git_branch_snapshot(cwd: &str) -> Option<(String, Vec<String>)> {
    let current = git_command_output(cwd, &["branch", "--show-current"]).ok()?;
    if current.trim().is_empty() {
        return None;
    }
    let all = git_command_output(
        cwd,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    .unwrap_or_default();
    let mut branches: Vec<String> = all
        .lines()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(String::from)
        .collect();
    if !branches.iter().any(|v| v == &current) {
        branches.insert(0, current.clone());
    }
    Some((current, branches))
}

pub(crate) fn remember_recently_archived_codex_thread(thread_id: &str) {
    let mut archived = RECENTLY_ARCHIVED_CODEX_THREADS.lock().unwrap();
    archived.insert(thread_id.to_string(), unix_time_ms_now());
}

pub(crate) fn is_recently_archived_codex_thread(thread_id: &str) -> bool {
    let archived = RECENTLY_ARCHIVED_CODEX_THREADS.lock().unwrap();
    archived
        .get(thread_id)
        .map(|&t| unix_time_ms_now().saturating_sub(t) < 15_000)
        .unwrap_or(false)
}

pub(crate) fn find_dictionary_candidate(_index: usize) -> Option<String> {
    // Candidate lookup from hook_manager state — currently returns text from internal cache
    yibovibe_core::hook_manager::accept_hint_by_index(_index);
    Some(" ".to_string())
}

pub(crate) fn dismiss_hint_window_internal() {
    yibovibe_core::hook_manager::dismiss_hint();
}

pub(crate) fn prune_archived_thread_from_snapshot(
    snapshot: &serde_json::Value,
    thread_id: &str,
) -> serde_json::Value {
    let Some(root) = snapshot.as_object() else {
        return snapshot.clone();
    };
    let mut next = root.clone();

    let filtered_conversations = root
        .get("conversations")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item.get("id").and_then(serde_json::Value::as_str) != Some(thread_id)
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let conversation_ids = filtered_conversations
        .iter()
        .filter_map(|item| item.get("id").and_then(serde_json::Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    let filtered_projects = root
        .get("projects")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let Some(project) = item.as_object() else {
                        return Some(item.clone());
                    };
                    let existing_ids = project
                        .get("conversationIds")
                        .and_then(serde_json::Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(serde_json::Value::as_str)
                                .filter(|value| *value != thread_id)
                                .map(ToString::to_string)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    if existing_ids.is_empty() {
                        return None;
                    }
                    let mut next_project = project.clone();
                    next_project.insert(
                        "conversationIds".to_string(),
                        serde_json::json!(existing_ids),
                    );
                    Some(serde_json::Value::Object(next_project))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let filtered_messages = root
        .get("messagesByConversationId")
        .and_then(serde_json::Value::as_object)
        .map(|map| {
            let mut next_map = map.clone();
            next_map.remove(thread_id);
            serde_json::Value::Object(next_map)
        })
        .unwrap_or_else(|| serde_json::json!({}));

    let next_active = root
        .get("activeConversationId")
        .and_then(serde_json::Value::as_str)
        .filter(|value| *value != thread_id)
        .map(ToString::to_string)
        .or_else(|| conversation_ids.first().cloned());

    next.insert(
        "conversations".to_string(),
        serde_json::Value::Array(filtered_conversations),
    );
    next.insert(
        "projects".to_string(),
        serde_json::Value::Array(filtered_projects),
    );
    next.insert("messagesByConversationId".to_string(), filtered_messages);
    next.insert(
        "activeConversationId".to_string(),
        next_active
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    );
    serde_json::Value::Object(next)
}

// ── Codex workbench helper functions ──
// (Kept here due to tight coupling with ws_broker and session sync)
pub(crate) fn codex_project_name_from_path(path: &str) -> String {
    let clean = path.trim_end_matches(['\\', '/']);
    clean
        .rsplit(['\\', '/'])
        .next()
        .filter(|v| !v.is_empty())
        .unwrap_or(clean)
        .to_string()
}

pub(crate) fn json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
}

pub(crate) fn json_i64(value: &serde_json::Value, key: &str) -> Option<i64> {
    value.get(key).and_then(serde_json::Value::as_i64)
}

pub(crate) fn codex_collect_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => {
            if codex_is_image_like_string(text) {
                String::new()
            } else {
                text.to_string()
            }
        }
        serde_json::Value::Array(items) => items
            .iter()
            .map(codex_collect_text)
            .filter(|t| !t.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(serde_json::Value::as_str) {
                return text.to_string();
            }
            map.values()
                .map(codex_collect_text)
                .filter(|t| !t.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => String::new(),
    }
}

fn codex_is_image_like_string(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("data:image/")
        || trimmed.starts_with("blob:")
        || trimmed.contains(".png")
        || trimmed.contains(".jpg")
        || trimmed.contains(".jpeg")
        || trimmed.contains(".gif")
        || trimmed.contains(".webp")
        || trimmed.ends_with(".png")
        || trimmed.ends_with(".jpg")
        || trimmed.ends_with(".jpeg")
        || trimmed.ends_with(".gif")
        || trimmed.ends_with(".webp")
}

fn codex_collect_image_urls(value: &serde_json::Value) -> Vec<String> {
    fn visit(value: &serde_json::Value, out: &mut Vec<String>) {
        match value {
            serde_json::Value::String(text) => {
                let trimmed = text.trim();
                if codex_is_image_like_string(trimmed) {
                    out.push(trimmed.to_string());
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    visit(item, out);
                }
            }
            serde_json::Value::Object(map) => {
                if let Some(image_url) = map.get("image_url").and_then(serde_json::Value::as_str) {
                    let trimmed = image_url.trim();
                    if !trimmed.is_empty() {
                        out.push(trimmed.to_string());
                    }
                }
                if let Some(image_url) = map.get("imageUrl").and_then(serde_json::Value::as_str) {
                    let trimmed = image_url.trim();
                    if !trimmed.is_empty() {
                        out.push(trimmed.to_string());
                    }
                }
                if let Some(url) = map.get("url").and_then(serde_json::Value::as_str) {
                    let trimmed = url.trim();
                    let looks_like_image_node = map
                        .get("type")
                        .and_then(serde_json::Value::as_str)
                        .map(|item_type| item_type.contains("image"))
                        .unwrap_or(false);
                    if looks_like_image_node && !trimmed.is_empty() {
                        out.push(trimmed.to_string());
                    }
                }
                for item in map.values() {
                    visit(item, out);
                }
            }
            _ => {}
        }
    }

    let mut urls = Vec::new();
    visit(value, &mut urls);
    urls.sort();
    urls.dedup();
    urls
}

pub(crate) fn codex_thread_status(thread: &serde_json::Value) -> &'static str {
    if thread
        .get("pendingApproval")
        .map(|v| !v.is_null())
        .unwrap_or(false)
    {
        return "waitingApproval";
    }
    let has_in_progress = thread
        .get("turns")
        .and_then(serde_json::Value::as_array)
        .map(|turns| {
            turns.iter().any(|turn| {
                turn.get("status")
                    .and_then(serde_json::Value::as_str)
                    .map(|s| s == "inProgress")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if has_in_progress {
        return "running";
    }
    let waiting_on_approval = thread
        .get("status")
        .and_then(|s| s.get("activeFlags"))
        .and_then(serde_json::Value::as_array)
        .map(|flags| {
            flags
                .iter()
                .filter_map(serde_json::Value::as_str)
                .any(|f| f == "waitingOnApproval")
        })
        .unwrap_or(false);
    if waiting_on_approval {
        return "waitingApproval";
    }
    match thread
        .get("status")
        .and_then(|s| s.get("type"))
        .and_then(serde_json::Value::as_str)
    {
        Some("notLoaded") => "notLoaded",
        Some("error") | Some("failed") => "failed",
        Some("offline") => "offline",
        _ => "idle",
    }
}

fn merge_git_info_branch(
    git_info: Option<&serde_json::Value>,
    live_branch: Option<&str>,
) -> serde_json::Value {
    let mut merged = git_info
        .and_then(serde_json::Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(branch) = live_branch.filter(|value| !value.trim().is_empty()) {
        merged.insert(
            "branch".to_string(),
            serde_json::Value::String(branch.to_string()),
        );
    }
    if merged.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::Object(merged)
    }
}

fn codex_item_to_workbench_message(
    item: &serde_json::Value,
    index: usize,
    conversation_id: &str,
) -> Option<serde_json::Value> {
    const CODEX_MOBILE_PREVIEW_CHAR_LIMIT: usize = 1600;
    const CODEX_MOBILE_FULL_TEXT_CHAR_LIMIT: usize = 3000;
    let item_type = item
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let (role, title) = match item_type {
        "userMessage" => ("user", "用户"),
        "agentMessage" => ("assistant", "Codex"),
        _ => return None,
    };

    let direct_text = item
        .get("text")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let image_urls = codex_collect_image_urls(item.get("content").unwrap_or(item));
    let clean_direct_text = if codex_is_image_like_string(&direct_text) {
        String::new()
    } else {
        direct_text
    };
    let fallback_text = codex_collect_text(item.get("content").unwrap_or(item));
    let text = if !clean_direct_text.is_empty() {
        clean_direct_text
    } else if !fallback_text.is_empty() {
        fallback_text
    } else if !image_urls.is_empty() {
        format!("[{} 张图片]", image_urls.len())
    } else {
        String::new()
    };
    let trimmed_text = text.trim();
    if trimmed_text.is_empty() {
        return None;
    }
    let full_char_count = trimmed_text.chars().count();
    let mut preview_text = serde_json::Value::Null;
    if full_char_count > CODEX_MOBILE_PREVIEW_CHAR_LIMIT {
        let mut compact_preview = trimmed_text
            .chars()
            .take(CODEX_MOBILE_PREVIEW_CHAR_LIMIT)
            .collect::<String>();
        compact_preview.push_str("\n\n[展开查看更多]");
        preview_text = serde_json::Value::String(compact_preview);
    }
    let is_truncated = full_char_count > CODEX_MOBILE_FULL_TEXT_CHAR_LIMIT;
    let mut mobile_text = trimmed_text.to_string();
    if is_truncated {
        mobile_text = trimmed_text
            .chars()
            .take(CODEX_MOBILE_FULL_TEXT_CHAR_LIMIT)
            .collect::<String>();
        mobile_text.push_str("\n\n[移动端已保留前 3000 字，剩余内容请在桌面端查看]");
    }

    Some(serde_json::json!({
        "id": format!("{conversation_id}:{item_type}:{index}"),
        "providerId": "codex",
        "conversationId": conversation_id,
        "role": role,
        "title": title,
        "text": mobile_text,
        "imageUrls": image_urls,
        "previewText": preview_text,
        "isTruncated": is_truncated,
        "fullTextCharCount": full_char_count,
        "status": item.get("status").cloned().unwrap_or(serde_json::Value::Null),
        "rawType": item_type,
    }))
}

fn codex_materialized_workbench_messages(
    thread: &serde_json::Value,
    conversation_id: &str,
) -> Vec<serde_json::Value> {
    let mut messages = Vec::new();
    let Some(turns) = thread.get("turns").and_then(serde_json::Value::as_array) else {
        return messages;
    };

    for turn in turns {
        let Some(items) = turn.get("items").and_then(serde_json::Value::as_array) else {
            continue;
        };
        let mut last_assistant_message: Option<serde_json::Value> = None;

        for (index, item) in items.iter().enumerate() {
            match item
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
            {
                "userMessage" => {
                    if let Some(message) =
                        codex_item_to_workbench_message(item, index, conversation_id)
                    {
                        messages.push(message);
                    }
                }
                "agentMessage" => {
                    if let Some(message) =
                        codex_item_to_workbench_message(item, index, conversation_id)
                    {
                        last_assistant_message = Some(message);
                    }
                }
                _ => {}
            }
        }

        if let Some(message) = last_assistant_message {
            messages.push(message);
        }
    }

    messages
}

fn codex_preview_from_thread_like(thread: &serde_json::Value) -> Option<String> {
    let conversation_id = json_string(thread, "id").unwrap_or("preview".to_string());
    let messages = codex_materialized_workbench_messages(thread, &conversation_id);
    for message in messages.iter().rev() {
        let text = message
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim();
        if text.is_empty() {
            continue;
        }
        return Some(text.replace('\n', " ").chars().take(140).collect());
    }
    None
}

fn codex_pending_approval_from_thread(thread: &serde_json::Value) -> Option<serde_json::Value> {
    if let Some(pending) = thread
        .get("pendingApproval")
        .cloned()
        .filter(|value| !value.is_null())
    {
        return Some(pending);
    }
    if codex_thread_status(thread) != "waitingApproval" {
        return None;
    }

    let items = thread
        .get("turns")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flat_map(|turns| turns.iter())
        .flat_map(|turn| {
            turn.get("items")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flat_map(|items| items.iter())
        })
        .collect::<Vec<_>>();

    let mut resolved = std::collections::HashSet::new();
    for item in &items {
        let approval_id = item
            .get("approval_id")
            .or_else(|| item.get("approvalId"))
            .or_else(|| {
                item.get("content")
                    .and_then(|value| value.get("approval_id"))
            })
            .or_else(|| {
                item.get("content")
                    .and_then(|value| value.get("approvalId"))
            })
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if approval_id.is_empty() {
            continue;
        }
        let status = item
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        let approved = item
            .get("approved")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let denied = item
            .get("denied")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if approved
            || denied
            || status.contains("approved")
            || status.contains("denied")
            || status.contains("rejected")
        {
            resolved.insert(approval_id);
        }
    }

    for item in items.into_iter().rev() {
        let approval_id = item
            .get("approval_id")
            .or_else(|| item.get("approvalId"))
            .or_else(|| {
                item.get("content")
                    .and_then(|value| value.get("approval_id"))
            })
            .or_else(|| {
                item.get("content")
                    .and_then(|value| value.get("approvalId"))
            })
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if approval_id.is_empty() || resolved.contains(&approval_id) {
            continue;
        }

        let item_type = item
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = if item_type.contains("patch") || item.get("changes").is_some() {
            "patch-approval"
        } else if item_type.contains("exec")
            || item
                .get("command")
                .and_then(serde_json::Value::as_str)
                .is_some()
        {
            "exec-approval"
        } else {
            continue;
        };
        let title = if kind == "patch-approval" {
            "补丁变更待确认"
        } else {
            "命令执行待确认"
        };
        let summary = if kind == "exec-approval" {
            item.get("command")
                .and_then(serde_json::Value::as_str)
                .map(|value| value.trim().to_string())
        } else if let Some(changes) = item.get("changes").and_then(serde_json::Value::as_array) {
            Some(format!("涉及 {} 个变更项", changes.len()))
        } else {
            None
        }
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let summary_text = codex_collect_text(item.get("summary").unwrap_or(item));
            let content_text = codex_collect_text(item.get("content").unwrap_or(item));
            let collected = if !summary_text.trim().is_empty() {
                summary_text
            } else {
                content_text
            };
            if collected.trim().is_empty() {
                None
            } else {
                Some(collected.trim().to_string())
            }
        })
        .map(|value| value.chars().take(200).collect::<String>());

        return Some(serde_json::json!({
            "requestId": approval_id,
            "approvalId": approval_id,
            "kind": kind,
            "title": title,
            "summary": summary,
        }));
    }

    None
}

fn codex_conversation_state_to_thread(state: &serde_json::Value) -> serde_json::Value {
    let runtime_type = state
        .get("threadRuntimeStatus")
        .and_then(|value| value.get("type"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("idle");
    let status_type = match runtime_type {
        "running" | "inProgress" | "active" => "running",
        "waitingApproval" => "waitingApproval",
        "failed" | "error" => "error",
        "offline" => "offline",
        _ => "loaded",
    };

    let mut thread = serde_json::json!({
        "id": state.get("id").cloned().unwrap_or(serde_json::Value::Null),
        "name": state.get("title").cloned().unwrap_or(serde_json::Value::Null),
        "cwd": state.get("cwd").cloned().unwrap_or(serde_json::Value::Null),
        "path": state.get("cwd").cloned().unwrap_or(serde_json::Value::Null),
        "cliVersion": serde_json::Value::Null,
        "source": state.get("source").cloned().unwrap_or(serde_json::Value::Null),
        "createdAt": state.get("createdAt").cloned().unwrap_or(serde_json::Value::Null),
        "updatedAt": state.get("updatedAt").cloned().unwrap_or(serde_json::Value::Null),
        "gitInfo": state.get("gitInfo").cloned().unwrap_or(serde_json::Value::Null),
        "pendingApproval": state.get("pendingApproval").cloned().unwrap_or(serde_json::Value::Null),
        "status": {
            "type": status_type,
            "activeFlags": state.get("threadRuntimeStatus").and_then(|value| value.get("activeFlags"))
                .cloned().unwrap_or_else(|| serde_json::Value::Array(vec![]))
        },
        "turns": state.get("turns").cloned().unwrap_or_else(|| serde_json::Value::Array(vec![])),
    });

    let pending_approval = codex_pending_approval_from_thread(&thread);
    if let Some(preview) = codex_preview_from_thread_like(&thread) {
        if let Some(map) = thread.as_object_mut() {
            map.insert("preview".to_string(), serde_json::Value::String(preview));
        }
    }
    if let Some(map) = thread.as_object_mut() {
        map.insert(
            "pendingApproval".to_string(),
            pending_approval.unwrap_or(serde_json::Value::Null),
        );
    }
    thread
}

fn codex_source_label(thread: &serde_json::Value) -> Option<String> {
    match thread.get("source") {
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => {
            Some(value.to_string())
        }
        Some(serde_json::Value::Object(map)) => {
            if let Some(other) = map
                .get("subAgent")
                .and_then(|value| value.get("other"))
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                return Some(format!("subAgent:{other}"));
            }
            Some("custom".to_string())
        }
        Some(serde_json::Value::Null) | None => None,
        Some(other) => {
            let serialized = other.to_string();
            if serialized.trim().is_empty() {
                None
            } else {
                Some(serialized)
            }
        }
    }
}

fn codex_is_primary_thread(thread: &serde_json::Value) -> bool {
    match thread.get("source") {
        Some(serde_json::Value::String(value)) => {
            let normalized = value.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                return false;
            }
            !codex_source_string_marks_derived_thread(&normalized)
        }
        Some(serde_json::Value::Object(map)) => !codex_source_map_marks_derived_thread(map),
        Some(serde_json::Value::Null) | None => true,
        Some(_) => true,
    }
}

fn codex_source_string_marks_derived_thread(source: &str) -> bool {
    source.starts_with("subagent")
        || source.contains("sub-agent")
        || source.contains("review")
        || source.contains("compact")
        || source.contains("threadspawn")
}

fn codex_source_map_marks_derived_thread(
    source: &serde_json::Map<String, serde_json::Value>,
) -> bool {
    source.contains_key("subAgent")
        || source.contains_key("subAgentReview")
        || source.contains_key("subAgentCompact")
        || source.contains_key("subAgentThreadSpawn")
        || source.contains_key("subAgentOther")
}

fn codex_project_path_for_thread(thread: &serde_json::Value) -> Option<String> {
    let cwd = json_string(thread, "cwd").or_else(|| json_string(thread, "path"))?;
    let normalized = cwd.replace('/', "\\").to_ascii_lowercase();
    if normalized.contains("\\documents\\codex\\") {
        return None;
    }
    Some(cwd)
}

fn merge_codex_threads(
    primary: Vec<serde_json::Value>,
    secondary: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let mut merged = HashMap::<String, serde_json::Value>::new();
    for thread in secondary {
        if let Some(id) = thread.get("id").and_then(serde_json::Value::as_str) {
            merged.insert(id.to_string(), thread);
        }
    }
    for thread in primary {
        if let Some(id) = thread.get("id").and_then(serde_json::Value::as_str) {
            merged.insert(id.to_string(), thread);
        }
    }
    merged.into_values().collect()
}

fn codex_thread_ids(threads: &[serde_json::Value]) -> std::collections::HashSet<String> {
    threads
        .iter()
        .filter_map(|thread| thread.get("id").and_then(serde_json::Value::as_str))
        .map(ToString::to_string)
        .collect()
}

fn retain_codex_threads_with_known_ids(
    threads: Vec<serde_json::Value>,
    known_ids: &std::collections::HashSet<String>,
) -> Vec<serde_json::Value> {
    if known_ids.is_empty() {
        return threads;
    }

    threads
        .into_iter()
        .filter(|thread| {
            thread
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(|thread_id| known_ids.contains(thread_id))
                .unwrap_or(false)
        })
        .collect()
}

fn codex_rpc_result(value: &serde_json::Value) -> &serde_json::Value {
    value.get("result").unwrap_or(value)
}

fn codex_sandbox_policy_from_mode(mode: Option<&str>, cwd: Option<&str>) -> serde_json::Value {
    match mode.unwrap_or("workspace-write") {
        "read-only" => serde_json::json!({
            "type": "readOnly",
            "networkAccess": true
        }),
        "danger-full-access" => serde_json::json!({
            "type": "dangerFullAccess"
        }),
        _ => serde_json::json!({
            "type": "workspaceWrite",
            "writableRoots": cwd.map(|value| vec![value]).unwrap_or_default(),
            "networkAccess": true,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false
        }),
    }
}

async fn codex_request_prefer_desktop_ipc(
    app: tauri::AppHandle,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if matches!(method, "thread/list" | "thread/read") {
        let response = codex_app_server::persistent_request(
            app,
            codex_app_server::CodexAppServerRpcRequest {
                method: method.to_string(),
                params,
            },
        )
        .await?;
        return Ok(codex_rpc_result(&response).clone());
    }

    match codex_app_server::desktop_ipc_request(
        app.clone(),
        codex_app_server::CodexDesktopIpcRequest {
            method: method.to_string(),
            params: params.clone(),
            version: Some(0),
            route_thread_id: params
                .get("threadId")
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string),
        },
    )
    .await
    {
        Ok(ipc_value) => {
            if let Some(result) = ipc_value.get("result") {
                return Ok(result.clone());
            }
            warn!("Codex Desktop IPC {} returned success envelope without result, fallback to app-server: {}", method, ipc_value);
        }
        Err(err) => {
            warn!(
                "Codex Desktop IPC {} failed, fallback to app-server: {}",
                method, err
            );
        }
    }

    let response = codex_app_server::persistent_request(
        app,
        codex_app_server::CodexAppServerRpcRequest {
            method: method.to_string(),
            params,
        },
    )
    .await?;
    Ok(codex_rpc_result(&response).clone())
}

async fn build_codex_workbench_snapshot(
    app: tauri::AppHandle,
) -> Result<CodexWorkbenchSnapshotBuild, String> {
    let started_at = Instant::now();
    let list_result = codex_request_prefer_desktop_ipc(
        app.clone(),
        "thread/list",
        serde_json::json!({
            "limit": 200,
            "archived": false
        }),
    )
    .await?;

    let listed_threads = list_result
        .get("data")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let listed_count = listed_threads.len();
    let listed_thread_ids = codex_thread_ids(&listed_threads);
    let ipc_threads = match codex_app_server::desktop_ipc_collect_conversation_states(
        app.clone(),
        Duration::from_millis(1200),
    )
    .await
    {
        Ok(states) => {
            if !states.is_empty() {
                let normalized = states
                    .iter()
                    .map(codex_conversation_state_to_thread)
                    .collect::<Vec<_>>();
                let mut cache = CODEX_IPC_STATE_CACHE.lock().unwrap();
                for thread in &normalized {
                    if let Some(id) = thread.get("id").and_then(serde_json::Value::as_str) {
                        cache.insert(id.to_string(), thread.clone());
                    }
                }
                normalized
            } else {
                Vec::new()
            }
        }
        Err(err) => {
            warn!(
                "Codex Desktop IPC conversation-state collection failed: {}",
                err
            );
            Vec::new()
        }
    };
    let ipc_count = ipc_threads.len();
    let fresh_thread_ids = {
        let mut ids = codex_thread_ids(&listed_threads);
        ids.extend(codex_thread_ids(&ipc_threads));
        ids
    };
    let cached_threads = {
        let mut cache = CODEX_IPC_STATE_CACHE.lock().unwrap();
        if !fresh_thread_ids.is_empty() {
            cache.retain(|thread_id, _| fresh_thread_ids.contains(thread_id));
        }
        cache.values().cloned().collect::<Vec<_>>()
    };
    let cached_count = cached_threads.len();
    let merged_threads = if fresh_thread_ids.is_empty() {
        cached_threads
    } else {
        merge_codex_threads(
            listed_threads,
            merge_codex_threads(ipc_threads, cached_threads),
        )
    };
    let listed_threads = retain_codex_threads_with_known_ids(merged_threads, &listed_thread_ids)
        .into_iter()
        .filter(|thread| {
            thread
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(|thread_id| !is_recently_archived_codex_thread(thread_id))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    let merged_count = listed_threads.len();

    let primary_threads = listed_threads
        .iter()
        .filter(|thread| codex_is_primary_thread(thread))
        .cloned()
        .collect::<Vec<_>>();
    let used_unfiltered_threads_fallback = primary_threads.is_empty() && !listed_threads.is_empty();
    let mut detailed_threads = if used_unfiltered_threads_fallback {
        listed_threads
    } else {
        primary_threads
    };
    detailed_threads.sort_by(|left, right| {
        json_i64(right, "updatedAt")
            .unwrap_or(0)
            .cmp(&json_i64(left, "updatedAt").unwrap_or(0))
    });

    let mut project_threads: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    for thread in &detailed_threads {
        if let Some(project_path) = codex_project_path_for_thread(thread) {
            project_threads
                .entry(project_path)
                .or_default()
                .push(thread.clone());
        }
    }

    let mut projects = Vec::new();
    for (cwd, threads) in &project_threads {
        let live_git = git_branch_snapshot(cwd);
        let live_branch = live_git.as_ref().map(|value| value.0.clone());
        let mut branches = live_git
            .as_ref()
            .map(|value| value.1.clone())
            .unwrap_or_default();
        for thread in threads {
            if let Some(branch) = thread
                .get("gitInfo")
                .and_then(|info| info.get("branch"))
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
            {
                if !branches.contains(&branch) {
                    branches.push(branch);
                }
            }
        }
        if let Some(branch) = live_branch.as_ref() {
            branches.retain(|value| value != branch);
            branches.insert(0, branch.clone());
        }

        let latest_thread = threads
            .iter()
            .max_by_key(|thread| json_i64(thread, "updatedAt").unwrap_or(0));
        let conversation_ids = threads
            .iter()
            .filter_map(|thread| json_string(thread, "id"))
            .collect::<Vec<_>>();
        let updated_at = latest_thread.and_then(|thread| json_i64(thread, "updatedAt"));
        let origin_url = latest_thread
            .and_then(|thread| thread.get("gitInfo"))
            .and_then(|info| info.get("originUrl"))
            .and_then(serde_json::Value::as_str);

        projects.push(serde_json::json!({
            "id": format!("codex:{cwd}"),
            "providerId": "codex",
            "name": codex_project_name_from_path(cwd),
            "path": cwd,
            "conversationIds": conversation_ids,
            "branches": branches,
            "originUrl": origin_url,
            "updatedAt": updated_at,
        }));
    }

    projects.sort_by(|left, right| {
        let left_updated = left
            .get("updatedAt")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        let right_updated = right
            .get("updatedAt")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        right_updated.cmp(&left_updated)
    });

    let mut conversations = Vec::new();
    let mut messages_by_conversation_id = serde_json::Map::new();
    for thread in &detailed_threads {
        let thread_id = json_string(thread, "id").unwrap_or_default();
        if thread_id.is_empty() || is_recently_archived_codex_thread(&thread_id) {
            continue;
        }

        let read_thread = match codex_request_prefer_desktop_ipc(
            app.clone(),
            "thread/read",
            serde_json::json!({
                "threadId": thread_id,
                "includeTurns": true,
            }),
        )
        .await
        {
            Ok(result) => result
                .get("thread")
                .cloned()
                .unwrap_or_else(|| thread.clone()),
            Err(err) => {
                warn!("Codex thread/read failed for {}: {}", thread_id, err);
                thread.clone()
            }
        };
        if is_recently_archived_codex_thread(&thread_id) {
            continue;
        }

        let project_path = codex_project_path_for_thread(&read_thread)
            .or_else(|| codex_project_path_for_thread(thread));
        let live_branch = project_path
            .as_deref()
            .and_then(git_branch_snapshot)
            .map(|value| value.0);
        let title = json_string(&read_thread, "name")
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                json_string(&read_thread, "preview").filter(|value| !value.trim().is_empty())
            })
            .or_else(|| json_string(thread, "preview").filter(|value| !value.trim().is_empty()))
            .unwrap_or_else(|| thread_id.clone());
        let preview = read_thread
            .get("preview")
            .cloned()
            .filter(|value| !value.is_null())
            .or_else(|| codex_preview_from_thread_like(&read_thread).map(serde_json::Value::String))
            .unwrap_or_else(|| {
                thread
                    .get("preview")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null)
            });
        let pending_approval = codex_app_server::pending_approval_for_thread(&thread_id)
            .await
            .or_else(|| codex_pending_approval_from_thread(thread))
            .or_else(|| codex_pending_approval_from_thread(&read_thread))
            .unwrap_or(serde_json::Value::Null);
        let merged_status = codex_thread_status(thread);
        let read_status = codex_thread_status(&read_thread);
        let conversation_status = if pending_approval.is_null() {
            if merged_status == "waitingApproval" || read_status == "waitingApproval" {
                "waitingApproval"
            } else if merged_status == "running" && read_status == "idle" {
                "running"
            } else {
                read_status
            }
        } else {
            "waitingApproval"
        };

        conversations.push(serde_json::json!({
            "id": thread_id,
            "providerId": "codex",
            "projectId": project_path.as_ref().map(|path| format!("codex:{path}")),
            "title": title,
            "preview": preview,
            "cwd": read_thread.get("cwd").cloned().unwrap_or_else(|| thread.get("cwd").cloned().unwrap_or(serde_json::Value::Null)),
            "source": codex_source_label(&read_thread).or_else(|| codex_source_label(thread)),
            "cliVersion": read_thread.get("cliVersion").cloned().unwrap_or_else(|| thread.get("cliVersion").cloned().unwrap_or(serde_json::Value::Null)),
            "pendingApproval": pending_approval,
            "status": conversation_status,
            "gitInfo": merge_git_info_branch(read_thread.get("gitInfo").or_else(|| thread.get("gitInfo")), live_branch.as_deref()),
            "createdAt": read_thread.get("createdAt").cloned().unwrap_or_else(|| thread.get("createdAt").cloned().unwrap_or(serde_json::Value::Null)),
            "updatedAt": read_thread.get("updatedAt").cloned().unwrap_or_else(|| thread.get("updatedAt").cloned().unwrap_or(serde_json::Value::Null)),
        }));

        let mut messages = codex_materialized_workbench_messages(&read_thread, &thread_id);
        if messages.len() > 4 {
            let keep_from = messages.len().saturating_sub(4);
            messages = messages.split_off(keep_from);
        }
        messages_by_conversation_id.insert(thread_id, serde_json::Value::Array(messages));
    }

    let config_result = codex_app_server::persistent_request(
        app.clone(),
        codex_app_server::CodexAppServerRpcRequest {
            method: "config/read".to_string(),
            params: serde_json::json!({
                "includeLayers": true,
            }),
        },
    )
    .await
    .ok()
    .map(|value| codex_rpc_result(&value).clone());

    let model_result = codex_app_server::persistent_request(
        app.clone(),
        codex_app_server::CodexAppServerRpcRequest {
            method: "model/list".to_string(),
            params: serde_json::json!({
                "includeHidden": false,
            }),
        },
    )
    .await
    .ok()
    .map(|value| codex_rpc_result(&value).clone());

    let model_list = model_result.as_ref().and_then(|value| value.get("data"))
        .and_then(serde_json::Value::as_array)
        .map(|items| items.iter().filter_map(serde_json::Value::as_object).map(|item| {
            serde_json::json!({
                "id": item.get("id").cloned().or_else(|| item.get("model").cloned()).unwrap_or(serde_json::Value::String(String::new())),
                "providerId": "codex",
                "label": item.get("displayName").cloned().or_else(|| item.get("model").cloned()).or_else(|| item.get("id").cloned())
                    .unwrap_or(serde_json::Value::String("Unknown model".to_string())),
                "description": item.get("description").cloned().unwrap_or(serde_json::Value::Null),
                "hidden": item.get("hidden").cloned().unwrap_or(serde_json::Value::Null),
                "isDefault": item.get("isDefault").cloned().unwrap_or(serde_json::Value::Null),
                "defaultReasoningEffort": item.get("defaultReasoningEffort").cloned().unwrap_or(serde_json::Value::Null),
                "supportedReasoningEfforts": item.get("supportedReasoningEfforts").cloned().unwrap_or(serde_json::Value::Array(Vec::new())),
            })
        }).collect::<Vec<_>>()).unwrap_or_default();

    let generated_at = ::time::OffsetDateTime::now_utc()
        .format(&::time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

    let active_conversation_id = conversations
        .iter()
        .find(|conversation| {
            conversation
                .get("status")
                .and_then(serde_json::Value::as_str)
                .map(|status| status == "running")
                .unwrap_or(false)
        })
        .and_then(|conversation| conversation.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            conversations
                .first()
                .and_then(|conversation| conversation.get("id"))
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        });

    let snapshot = serde_json::json!({
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "providers": [{
            "id": "codex",
            "name": "Codex",
            "transport": "app-server",
            "capabilities": [
                "project-list",
                "conversation-list",
                "conversation-read",
                "conversation-create",
                "conversation-rename",
                "conversation-archive",
                "message-send",
                "turn-cancel",
                "model-list",
                "config-read",
                "config-write",
                "event-stream"
            ]
        }],
        "projects": projects,
        "conversations": conversations,
        "activeConversationId": active_conversation_id,
        "messagesByConversationId": messages_by_conversation_id,
        "modelsByProviderId": {
            "codex": model_list
        },
        "configsByProviderId": {
            "codex": {
                "providerId": "codex",
                "model": config_result.as_ref().and_then(|value| value.get("config")).and_then(|value| value.get("model")).cloned().unwrap_or(serde_json::Value::Null),
                "modelProvider": config_result.as_ref().and_then(|value| value.get("config")).and_then(|value| value.get("model_provider")).cloned().unwrap_or(serde_json::Value::Null),
                "approvalPolicy": config_result.as_ref().and_then(|value| value.get("config")).and_then(|value| value.get("approval_policy")).cloned().unwrap_or(serde_json::Value::Null),
                "sandboxMode": config_result.as_ref().and_then(|value| value.get("config")).and_then(|value| value.get("sandbox_mode")).cloned().unwrap_or(serde_json::Value::Null),
                "serviceTier": config_result.as_ref().and_then(|value| value.get("config")).and_then(|value| value.get("service_tier")).cloned().unwrap_or(serde_json::Value::Null),
                "cwd": config_result.as_ref().and_then(|value| value.get("config")).and_then(|value| value.get("cwd")).cloned().unwrap_or(serde_json::Value::Null),
            }
        },
        "errors": [],
    });

    let snapshot_bytes = serde_json::to_vec(&snapshot)
        .map(|value| value.len())
        .unwrap_or(0);

    Ok(CodexWorkbenchSnapshotBuild {
        snapshot,
        thread_count: detailed_threads.len(),
        project_count: projects.len(),
        elapsed_ms: started_at.elapsed().as_millis() as i64,
        snapshot_bytes,
        listed_count,
        ipc_count,
        cached_count,
        merged_count,
        used_unfiltered_threads_fallback,
    })
}

pub(crate) async fn broadcast_workbench_change(
    app: &tauri::AppHandle,
    reason: &str,
    thread_id: Option<&str>,
) {
    let payload = serde_json::json!({
        "type": "workbench:changed",
        "params": {
            "reason": reason, "threadId": thread_id,
            "ts": ::time::OffsetDateTime::now_utc()
                .format(&::time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string()),
        }
    });
    let _ = app.emit("codex-workbench-sync-event", payload.clone());
    let state = app.state::<AppState>();
    let ws_tx = state.ws_tx.lock().await.clone();
    if let Some(tx) = ws_tx {
        let _ = tx
            .send(yibovibe_core::ws::WsMessage {
                sender_uid: 0,
                sender_device_id: 0,
                target_devices: vec![],
                r#type: "workbench:changed".to_string(),
                payload,
            })
            .await;
    }
}

pub(crate) async fn sync_codex_workbench_snapshot_to_server_handle(app: &tauri::AppHandle) {
    push_codex_workbench_snapshot_to_server_handle(app, vec![]).await;
}

pub(crate) async fn push_codex_workbench_snapshot_to_server_handle(
    app: &tauri::AppHandle,
    target_devices: Vec<u32>,
) {
    let state = app.state::<AppState>();
    let ws_tx = state.ws_tx.lock().await.clone();
    let tx = match ws_tx {
        Some(tx) => tx,
        None => {
            if let Err(err) = reconnect_session_signal_channel(app).await {
                warn!("[WorkbenchSync] Skip Codex snapshot push because signal channel is disconnected and reconnect failed: {}", err);
                return;
            }
            let state = app.state::<AppState>();
            let reconnected_tx = state.ws_tx.lock().await.clone();
            match reconnected_tx {
                Some(tx) => tx,
                None => {
                    warn!("[WorkbenchSync] Skip Codex snapshot push because signal channel is still unavailable after reconnect.");
                    return;
                }
            }
        }
    };

    push_workbench_snapshot_status(
        &tx,
        &target_devices,
        "build-start",
        "desktop received snapshot request",
        serde_json::json!({}),
    )
    .await;

    let build = match build_codex_workbench_snapshot(app.clone()).await {
        Ok(build) => {
            if build.thread_count > 0 {
                *LAST_CODEX_WORKBENCH_SNAPSHOT.lock().unwrap() = Some(build.snapshot.clone());
            }
            push_workbench_snapshot_status(
                &tx,
                &target_devices,
                "build-ok",
                "desktop built workbench snapshot",
                serde_json::json!({
                    "threadCount": build.thread_count,
                    "projectCount": build.project_count,
                    "elapsedMs": build.elapsed_ms,
                    "snapshotBytes": build.snapshot_bytes,
                    "listedCount": build.listed_count,
                    "ipcCount": build.ipc_count,
                    "cachedCount": build.cached_count,
                    "mergedCount": build.merged_count,
                    "usedUnfilteredFallback": build.used_unfiltered_threads_fallback,
                }),
            )
            .await;
            build
        }
        Err(err) => {
            warn!("[WorkbenchSync] Failed to build Codex snapshot: {}", err);
            push_workbench_snapshot_status(
                &tx,
                &target_devices,
                "build-failed",
                "desktop failed to build workbench snapshot",
                serde_json::json!({ "error": err }),
            )
            .await;
            let cached_snapshot = LAST_CODEX_WORKBENCH_SNAPSHOT.lock().unwrap().clone();
            match cached_snapshot {
                Some(cached) => {
                    let cached_thread_count = cached["conversations"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter(|item| item["providerId"].as_str() == Some("codex"))
                                .count()
                        })
                        .unwrap_or(0);
                    let cached_project_count = cached["projects"]
                        .as_array()
                        .map(|items| items.len())
                        .unwrap_or(0);
                    push_workbench_snapshot_status(
                        &tx,
                        &target_devices,
                        "fallback-cache",
                        "desktop fell back to last successful snapshot",
                        serde_json::json!({
                            "threadCount": cached_thread_count,
                            "projectCount": cached_project_count,
                        }),
                    )
                    .await;
                    CodexWorkbenchSnapshotBuild {
                        snapshot: cached,
                        thread_count: cached_thread_count,
                        project_count: cached_project_count,
                        elapsed_ms: 0,
                        snapshot_bytes: 0,
                        listed_count: 0,
                        ipc_count: 0,
                        cached_count: 0,
                        merged_count: 0,
                        used_unfiltered_threads_fallback: false,
                    }
                }
                None => return,
            }
        }
    };

    push_workbench_snapshot_status(
        &tx,
        &target_devices,
        "snapshot-ready",
        "desktop prepared workbench snapshot payload",
        serde_json::json!({
            "threadCount": build.thread_count,
            "projectCount": build.project_count,
            "elapsedMs": build.elapsed_ms,
            "snapshotBytes": build.snapshot_bytes,
            "listedCount": build.listed_count,
            "ipcCount": build.ipc_count,
            "cachedCount": build.cached_count,
            "mergedCount": build.merged_count,
            "usedUnfilteredFallback": build.used_unfiltered_threads_fallback,
        }),
    )
    .await;

    let snapshot_targets = target_devices.clone();
    if let Err(err) = tx
        .send(yibovibe_core::ws::WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices,
            r#type: "workbench:snapshot".to_string(),
            payload: build.snapshot,
        })
        .await
    {
        warn!("[WorkbenchSync] Failed to push Codex snapshot: {}", err);
        *state.is_connected.lock().await = false;
        *state.ws_tx.lock().await = None;
    } else {
        push_workbench_snapshot_status(
            &tx,
            &snapshot_targets,
            "snapshot-sent",
            "desktop sent workbench snapshot",
            serde_json::json!({
                "threadCount": build.thread_count,
                "projectCount": build.project_count,
                "elapsedMs": build.elapsed_ms,
                "snapshotBytes": build.snapshot_bytes,
                "listedCount": build.listed_count,
                "ipcCount": build.ipc_count,
                "cachedCount": build.cached_count,
                "mergedCount": build.merged_count,
                "usedUnfilteredFallback": build.used_unfiltered_threads_fallback,
            }),
        )
        .await;
    }
}

async fn push_cached_codex_workbench_snapshot_to_server_handle(
    app: &tauri::AppHandle,
    target_devices: Vec<u32>,
) -> bool {
    let cached = LAST_CODEX_WORKBENCH_SNAPSHOT.lock().unwrap().clone();
    let Some(snapshot) = cached else { return false };
    let cached_thread_count = snapshot["conversations"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| item["providerId"].as_str() == Some("codex"))
                .count()
        })
        .unwrap_or(0);
    if cached_thread_count == 0 {
        return false;
    }

    let state = app.state::<AppState>();
    let Some(tx) = state.ws_tx.lock().await.clone() else {
        return false;
    };
    let cached_targets = target_devices.clone();
    match tx
        .send(yibovibe_core::ws::WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices,
            r#type: "workbench:snapshot".to_string(),
            payload: snapshot,
        })
        .await
    {
        Ok(_) => {
            push_workbench_snapshot_status(
                &tx,
                &cached_targets,
                "cache-sent",
                "desktop sent cached workbench snapshot",
                serde_json::json!({ "threadCount": cached_thread_count }),
            )
            .await;
            true
        }
        Err(err) => {
            warn!(
                "[WorkbenchSync] Failed to push cached Codex snapshot: {}",
                err
            );
            false
        }
    }
}

async fn push_workbench_snapshot_status(
    tx: &tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>,
    target_devices: &[u32],
    stage: &str,
    message: &str,
    detail: serde_json::Value,
) {
    let payload = serde_json::json!({
        "stage": stage,
        "message": message,
        "detail": detail,
        "ts": ::time::OffsetDateTime::now_utc()
            .format(&::time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string()),
    });

    if let Err(err) = tx
        .send(yibovibe_core::ws::WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: target_devices.to_vec(),
            r#type: "workbench:snapshot:status".to_string(),
            payload,
        })
        .await
    {
        warn!(
            "[WorkbenchSync] Failed to push snapshot status stage {}: {}",
            stage, err
        );
    }
}

pub(crate) async fn reconnect_session_signal_channel(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.ws_tx.lock().await.is_some() {
        return Ok(());
    }
    let server_url = state
        .runtime_server_url
        .lock()
        .await
        .clone()
        .ok_or("missing runtime server url".to_string())?;
    let access_token = state
        .runtime_access_token
        .lock()
        .await
        .clone()
        .ok_or("missing runtime access token".to_string())?;
    let (ws_client, ws_rx) = yibovibe_core::ws::WsClient::connect(&server_url, &access_token)
        .await
        .map_err(|e| format!("websocket reconnect failed: {e}"))?;
    let (_clipboard_tx, _clipboard_rx) = tokio::sync::mpsc::channel(8);
    spawn_ws_broker(
        ws_rx,
        _clipboard_tx,
        ws_client.tx.clone(),
        state.session_manager.clone(),
        app.clone(),
    );
    *state.is_connected.lock().await = true;
    *state.ws_tx.lock().await = Some(ws_client.tx.clone());
    info!("[SignalSync] Reconnected session signal channel.");
    sync_all_sessions_to_server_handle(app).await;
    Ok(())
}

// ── Session sync helpers ──
pub(crate) fn build_session_sync_payload(
    session_id: &str,
    session_info: Option<terminal::SessionInfo>,
    extra: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({"session_id": session_id});
    if let Some(info) = session_info {
        let cwd_name = Path::new(&info.cwd)
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|n| !n.trim().is_empty())
            .unwrap_or("workspace");
        let short_id = session_id
            .rsplit_once('-')
            .map(|(_, s)| s)
            .unwrap_or(session_id);
        let label = format!("{} · {} · {}", info.shell_kind, cwd_name, short_id);
        let status_str = match info.status {
            terminal::SessionStatus::Running => "running",
            terminal::SessionStatus::Exited(_) => "stopped",
            terminal::SessionStatus::Error(_) => "crashed",
        };
        payload["label"] = serde_json::json!(label);
        payload["status"] = serde_json::json!(status_str);
        payload["state"] = serde_json::json!(status_str);
        payload["shell_kind"] = serde_json::json!(info.shell_kind);
        payload["cwd"] = serde_json::json!(info.cwd);
        payload["started_at"] = serde_json::json!(info.started_at);
        payload["last_output_at"] = serde_json::json!(info.last_output_at);
        payload["exit_code"] = serde_json::json!(info.exit_code);
    }
    if let Some(e) = extra {
        if let Some(obj) = e.as_object() {
            for (k, v) in obj {
                payload[k] = v.clone();
            }
        }
    }
    payload
}

pub(crate) async fn sync_session_to_server(
    state: &tauri::State<'_, AppState>,
    msg_type: &str,
    session_id: &str,
    extra: Option<serde_json::Value>,
) {
    let ws_tx = state.ws_tx.lock().await.clone();
    let Some(tx) = ws_tx else { return };
    let session_info = {
        let mgr = state.session_manager.lock().await;
        mgr.get_session_info(session_id).await
    };
    let msg = yibovibe_core::ws::WsMessage {
        sender_uid: 0,
        sender_device_id: 0,
        target_devices: vec![],
        r#type: msg_type.to_string(),
        payload: build_session_sync_payload(session_id, session_info, extra),
    };
    if let Err(e) = tx.send(msg).await {
        warn!("[SignalSync] send {} failed: {}", msg_type, e);
    }
}

pub(crate) async fn sync_all_sessions_to_server_handle(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let ws_tx = state.ws_tx.lock().await.clone();
    let Some(tx) = ws_tx else { return };
    let sessions = {
        let mgr = state.session_manager.lock().await;
        mgr.list_sessions().await
    };
    for session in sessions {
        if is_session_closing(&state, &session.session_id).await {
            continue;
        }
        let _ = tx
            .send(yibovibe_core::ws::WsMessage {
                sender_uid: 0,
                sender_device_id: 0,
                target_devices: vec![],
                r#type: "session:update".to_string(),
                payload: build_session_sync_payload(
                    &session.session_id,
                    Some(session.clone()),
                    None,
                ),
            })
            .await;
    }
}

pub(crate) fn spawn_session_sync_guard(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(30));
        loop {
            ticker.tick().await;
            if let Err(err) = reconnect_session_signal_channel(&app_handle).await {
                warn!(
                    "[SignalSync] Session sync guard skipped because reconnect failed: {}",
                    err
                );
                continue;
            }
            sync_all_sessions_to_server_handle(&app_handle).await;
        }
    });
}

pub(crate) fn spawn_workbench_sync_guard(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(15));
        loop {
            ticker.tick().await;
            if let Err(err) = reconnect_session_signal_channel(&app_handle).await {
                warn!(
                    "[WorkbenchSync] Workbench sync guard skipped because reconnect failed: {}",
                    err
                );
                continue;
            }
            push_codex_workbench_snapshot_to_server_handle(&app_handle, vec![]).await;
        }
    });
}

pub(crate) fn spawn_ws_broker(
    ws_rx: tokio::sync::mpsc::Receiver<yibovibe_core::ws::WsMessage>,
    clipboard_tx: tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>,
    ws_tx: tokio::sync::mpsc::Sender<yibovibe_core::ws::WsMessage>,
    session_manager: terminal::SharedSessionManager,
    app_handle: tauri::AppHandle,
) {
    tokio::spawn(async move {
        let mut rx = ws_rx;
        let clipboard = clipboard_tx;
        let sync_tx = ws_tx;
        let sm = session_manager;
        let app = app_handle;

        while let Some(msg) = rx.recv().await {
            let _ = clipboard.send(msg.clone()).await;

            match msg.r#type.as_str() {
                "session:start" | "session:resume" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let shell_kind = msg.payload["shell_kind"].as_str();
                    if !session_id.is_empty() {
                        let mut mgr = sm.lock().await;
                        if !mgr.session_exists(session_id).await {
                            mgr.create_session_with_id(session_id.to_string(), shell_kind, None)
                                .await;
                            let session_info = mgr.get_session_info(session_id).await;
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:register".to_string(),
                                    payload: build_session_sync_payload(
                                        session_id,
                                        session_info,
                                        None,
                                    ),
                                })
                                .await;
                        }
                        if let Err(err) = mgr
                            .start_session_with_ws(session_id, &app, sync_tx.clone(), None)
                            .await
                        {
                            warn!(
                                "[WS Broker] Remote start session {} failed: {}",
                                session_id, err
                            );
                        } else {
                            let session_info = mgr.get_session_info(session_id).await;
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:update".to_string(),
                                    payload: build_session_sync_payload(
                                        session_id,
                                        session_info,
                                        None,
                                    ),
                                })
                                .await;
                        }
                    }
                }
                "session:list" => {
                    let sessions = {
                        let mgr = sm.lock().await;
                        mgr.list_sessions().await
                    };
                    let payload = serde_json::json!({
                        "type": "session_list",
                        "sessions": sessions,
                    });
                    let _ = sync_tx
                        .send(yibovibe_core::ws::WsMessage {
                            sender_uid: 0,
                            sender_device_id: 0,
                            target_devices: if msg.sender_device_id > 0 {
                                vec![msg.sender_device_id]
                            } else {
                                vec![]
                            },
                            r#type: "session_list".to_string(),
                            payload,
                        })
                        .await;
                }
                "workbench:snapshot:request" => {
                    let target_devices = if msg.sender_device_id > 0 {
                        vec![msg.sender_device_id]
                    } else {
                        vec![]
                    };
                    let _ = push_cached_codex_workbench_snapshot_to_server_handle(
                        &app,
                        target_devices.clone(),
                    )
                    .await;
                    push_codex_workbench_snapshot_to_server_handle(&app, target_devices).await;
                }
                "workbench:changed" => {
                    let payload = if msg.payload.get("type").and_then(serde_json::Value::as_str)
                        == Some("workbench:changed")
                    {
                        msg.payload.clone()
                    } else {
                        serde_json::json!({
                            "type": "workbench:changed",
                            "params": msg.payload,
                        })
                    };
                    let _ = app.emit("codex-workbench-sync-event", payload);
                }
                "session:stop" | "session:pause" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let confirmed = msg.payload["confirmed"].as_bool().unwrap_or(false);
                    if !session_id.is_empty() {
                        if msg.r#type == "session:stop" && !confirmed {
                            continue;
                        }
                        let mut mgr = sm.lock().await;
                        if let Err(err) = mgr.kill_session(session_id).await {
                            warn!(
                                "[WS Broker] Remote kill session {} failed: {}",
                                session_id, err
                            );
                        } else {
                            let session_info = mgr.get_session_info(session_id).await;
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:update".to_string(),
                                    payload: build_session_sync_payload(
                                        session_id,
                                        session_info,
                                        Some(serde_json::json!({
                                            "status": "stopped",
                                            "state": "stopped"
                                        })),
                                    ),
                                })
                                .await;
                        }
                    }
                }
                "session:remove" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    if !session_id.is_empty() {
                        let state = app.state::<AppState>();
                        mark_session_closing(&state, session_id).await;
                        let mut mgr = sm.lock().await;
                        if let Err(err) = mgr.remove_session(session_id).await {
                            warn!(
                                "[WS Broker] Remote remove session {} failed: {}",
                                session_id, err
                            );
                        } else {
                            let _ = sync_tx
                                .send(yibovibe_core::ws::WsMessage {
                                    sender_uid: 0,
                                    sender_device_id: 0,
                                    target_devices: vec![],
                                    r#type: "session:unregister".to_string(),
                                    payload: serde_json::json!({ "session_id": session_id }),
                                })
                                .await;
                        }
                    }
                }
                "session:stdin" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let text = msg.payload["text"].as_str().unwrap_or("");
                    if !session_id.is_empty() && !text.is_empty() {
                        let mut mgr = sm.lock().await;
                        let _ = mgr.prepare_remote_input(session_id).await;
                        if let Err(err) = mgr.write_session(session_id, text).await {
                            warn!("[WS Broker] Remote stdin to {} failed: {}", session_id, err);
                        }
                    }
                }
                "session:resize" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    let cols = msg.payload["cols"].as_u64().unwrap_or(80) as u16;
                    let rows = msg.payload["rows"].as_u64().unwrap_or(24) as u16;
                    if !session_id.is_empty() {
                        let mut mgr = sm.lock().await;
                        let _ = mgr.resize_session(session_id, cols, rows).await;
                        let _ = sync_tx
                            .send(yibovibe_core::ws::WsMessage {
                                sender_uid: 0,
                                sender_device_id: 0,
                                target_devices: vec![],
                                r#type: "session:screen_resize".to_string(),
                                payload: serde_json::json!({
                                    "session_id": session_id,
                                    "cols": cols,
                                    "rows": rows,
                                }),
                            })
                            .await;
                    }
                }
                "session:screen_request_snapshot" => {
                    let session_id = msg.payload["session_id"].as_str().unwrap_or("");
                    if !session_id.is_empty() {
                        let mgr = sm.lock().await;
                        match mgr.request_screen_snapshot(session_id).await {
                            Ok(snapshot) => {
                                let _ = sync_tx
                                    .send(yibovibe_core::ws::WsMessage {
                                        sender_uid: 0,
                                        sender_device_id: 0,
                                        target_devices: if msg.sender_device_id > 0 {
                                            vec![msg.sender_device_id]
                                        } else {
                                            vec![]
                                        },
                                        r#type: "session:screen_snapshot".to_string(),
                                        payload: serde_json::to_value(snapshot)
                                            .unwrap_or_else(|_| serde_json::json!({})),
                                    })
                                    .await;
                            }
                            Err(err) => warn!(
                                "[WS Broker] Screen snapshot request for {} failed: {}",
                                session_id, err
                            ),
                        }
                    }
                }
                "codex:turn:start" => {
                    let conversation_id = msg.payload["conversation_id"]
                        .as_str()
                        .or_else(|| msg.payload["thread_id"].as_str())
                        .unwrap_or("");
                    let text = msg.payload["text"].as_str().unwrap_or("").trim();
                    if !conversation_id.is_empty() && !text.is_empty() {
                        let target_devices = if msg.sender_device_id > 0 {
                            vec![msg.sender_device_id]
                        } else {
                            vec![]
                        };
                        let cwd = msg.payload["cwd"].as_str();
                        let model = msg.payload["model"].as_str();
                        let effort = msg.payload["effort"].as_str();
                        let service_tier = msg.payload["service_tier"].as_str();
                        let approval_policy = msg.payload["approval_policy"].as_str();
                        let sandbox_mode = msg.payload["sandbox_mode"].as_str();
                        let _ = push_workbench_snapshot_status(
                            &sync_tx,
                            &target_devices,
                            "codexTurnStartStart",
                            "desktop forwarding mobile codex send",
                            serde_json::json!({ "threadId": conversation_id }),
                        )
                        .await;

                        match codex_app_server::persistent_request(
                            app.clone(),
                            codex_app_server::CodexAppServerRpcRequest {
                                method: "turn/start".to_string(),
                                params: serde_json::json!({
                                    "threadId": conversation_id,
                                    "input": [{
                                        "type": "text",
                                        "text": text,
                                        "text_elements": []
                                    }],
                                    "cwd": cwd,
                                    "model": model,
                                    "approvalPolicy": approval_policy,
                                    "sandboxPolicy": codex_sandbox_policy_from_mode(sandbox_mode, cwd),
                                    "effort": effort,
                                    "summary": serde_json::Value::Null,
                                    "serviceTier": service_tier
                                }),
                            },
                        ).await {
                            Ok(response) => {
                                let result = codex_rpc_result(&response).clone();
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexTurnStartAccepted",
                                    "desktop codex send accepted",
                                    serde_json::json!({
                                        "threadId": conversation_id,
                                        "turnId": result.get("turn").and_then(|turn| turn.get("turnId").or_else(|| turn.get("id"))).and_then(serde_json::Value::as_str),
                                    }),
                                ).await;
                                let _ = push_cached_codex_workbench_snapshot_to_server_handle(&app, target_devices.clone()).await;
                                push_codex_workbench_snapshot_to_server_handle(&app, target_devices).await;
                            }
                            Err(err) => {
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexTurnStartFailed",
                                    "mobile codex send failed",
                                    serde_json::json!({
                                        "threadId": conversation_id,
                                        "error": err,
                                    }),
                                ).await;
                            }
                        }
                    }
                }
                "codex:approval:decision" => {
                    let conversation_id = msg.payload["conversation_id"]
                        .as_str()
                        .or_else(|| msg.payload["thread_id"].as_str())
                        .unwrap_or("");
                    let request_id = msg.payload["request_id"].as_str().unwrap_or("").trim();
                    let approval_id = msg.payload["approval_id"].as_str().unwrap_or("").trim();
                    let approved = msg.payload["approved"].as_bool().unwrap_or(false);
                    let kind = msg.payload["kind"].as_str().unwrap_or("exec-approval");
                    if !conversation_id.is_empty() && !request_id.is_empty() {
                        let target_devices = if msg.sender_device_id > 0 {
                            vec![msg.sender_device_id]
                        } else {
                            vec![]
                        };
                        let _ = push_workbench_snapshot_status(
                            &sync_tx,
                            &target_devices,
                            "codexApprovalDecisionStart",
                            "desktop forwarding mobile approval decision",
                            serde_json::json!({
                                "threadId": conversation_id,
                                "requestId": request_id,
                                "approvalId": approval_id,
                                "kind": kind,
                                "approved": approved,
                            }),
                        )
                        .await;
                        match codex_app_server::respond_to_pending_approval(
                            app.clone(),
                            request_id.to_string(),
                            approved,
                        )
                        .await
                        {
                            Ok(_) => {
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexApprovalDecisionAccepted",
                                    "desktop codex approval request response accepted",
                                    serde_json::json!({
                                        "threadId": conversation_id,
                                        "requestId": request_id,
                                        "approvalId": approval_id,
                                    }),
                                )
                                .await;
                                let _ = push_cached_codex_workbench_snapshot_to_server_handle(
                                    &app,
                                    target_devices.clone(),
                                )
                                .await;
                                push_codex_workbench_snapshot_to_server_handle(
                                    &app,
                                    target_devices,
                                )
                                .await;
                            }
                            Err(err) => {
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexApprovalDecisionFailed",
                                    "mobile codex approval request response failed",
                                    serde_json::json!({
                                        "threadId": conversation_id,
                                        "requestId": request_id,
                                        "approvalId": approval_id,
                                        "error": err,
                                    }),
                                )
                                .await;
                            }
                        }
                    }
                }
                "codex:thread:archive" => {
                    let conversation_id = msg.payload["conversation_id"]
                        .as_str()
                        .or_else(|| msg.payload["thread_id"].as_str())
                        .unwrap_or("");
                    if !conversation_id.is_empty() {
                        let target_devices = if msg.sender_device_id > 0 {
                            vec![msg.sender_device_id]
                        } else {
                            vec![]
                        };
                        match codex_app_server::persistent_request(
                            app.clone(),
                            codex_app_server::CodexAppServerRpcRequest {
                                method: "thread/archive".to_string(),
                                params: serde_json::json!({
                                    "threadId": conversation_id,
                                    "conversationId": conversation_id,
                                }),
                            },
                        )
                        .await
                        {
                            Ok(_) => {
                                remember_recently_archived_codex_thread(conversation_id);
                                {
                                    let mut cached = LAST_CODEX_WORKBENCH_SNAPSHOT.lock().unwrap();
                                    if let Some(snapshot) = cached.as_ref() {
                                        *cached = Some(prune_archived_thread_from_snapshot(
                                            snapshot,
                                            conversation_id,
                                        ));
                                    }
                                }
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexArchiveAccepted",
                                    "desktop accepted mobile codex archive",
                                    serde_json::json!({ "threadId": conversation_id }),
                                )
                                .await;
                                broadcast_workbench_change(
                                    &app,
                                    "thread/archive",
                                    Some(conversation_id),
                                )
                                .await;
                                let _ = push_cached_codex_workbench_snapshot_to_server_handle(
                                    &app,
                                    target_devices.clone(),
                                )
                                .await;
                                push_codex_workbench_snapshot_to_server_handle(
                                    &app,
                                    target_devices,
                                )
                                .await;
                            }
                            Err(err) => {
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexArchiveFailed",
                                    "desktop failed mobile codex archive",
                                    serde_json::json!({
                                        "threadId": conversation_id,
                                        "error": err,
                                    }),
                                )
                                .await;
                            }
                        }
                    }
                }
                "codex:config:update" => {
                    let target_devices = if msg.sender_device_id > 0 {
                        vec![msg.sender_device_id]
                    } else {
                        vec![]
                    };
                    let model = msg.payload["model"].as_str();
                    let service_tier = msg.payload["service_tier"].as_str();
                    let approval_policy = msg.payload["approval_policy"].as_str();
                    let sandbox_mode = msg.payload["sandbox_mode"].as_str();
                    let edits = [
                        model.map(|value| serde_json::json!({ "keyPath": "model", "value": value, "mergeStrategy": "upsert" })),
                        service_tier.map(|value| serde_json::json!({ "keyPath": "service_tier", "value": value, "mergeStrategy": "upsert" })),
                        approval_policy.map(|value| serde_json::json!({ "keyPath": "approval_policy", "value": value, "mergeStrategy": "upsert" })),
                        sandbox_mode.map(|value| serde_json::json!({ "keyPath": "sandbox_mode", "value": value, "mergeStrategy": "upsert" })),
                    ].into_iter().flatten().collect::<Vec<_>>();
                    if !edits.is_empty() {
                        match codex_app_server::persistent_request(
                            app.clone(),
                            codex_app_server::CodexAppServerRpcRequest {
                                method: "config/batchWrite".to_string(),
                                params: serde_json::json!({
                                    "edits": edits,
                                    "reloadUserConfig": true,
                                }),
                            },
                        )
                        .await
                        {
                            Ok(_) => {
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexConfigUpdated",
                                    "desktop applied mobile codex config update",
                                    serde_json::json!({}),
                                )
                                .await;
                                push_codex_workbench_snapshot_to_server_handle(
                                    &app,
                                    target_devices,
                                )
                                .await;
                            }
                            Err(err) => {
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexConfigUpdateFailed",
                                    "desktop failed mobile codex config update",
                                    serde_json::json!({ "error": err }),
                                )
                                .await;
                            }
                        }
                    }
                }
                "codex:project:branch:switch" => {
                    let cwd = msg.payload["cwd"].as_str().unwrap_or("").trim();
                    let branch = msg.payload["branch"].as_str().unwrap_or("").trim();
                    let target_devices = if msg.sender_device_id > 0 {
                        vec![msg.sender_device_id]
                    } else {
                        vec![]
                    };
                    if !cwd.is_empty() && !branch.is_empty() {
                        match git_command_output(cwd, &["checkout", branch]) {
                            Ok(_) => {
                                *LAST_CODEX_WORKBENCH_SNAPSHOT.lock().unwrap() = None;
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexBranchSwitchAccepted",
                                    "desktop applied mobile git branch switch",
                                    serde_json::json!({
                                        "cwd": cwd,
                                        "branch": branch,
                                    }),
                                )
                                .await;
                                broadcast_workbench_change(&app, "git/checkout", None).await;
                                push_codex_workbench_snapshot_to_server_handle(
                                    &app,
                                    target_devices,
                                )
                                .await;
                            }
                            Err(err) => {
                                let _ = push_workbench_snapshot_status(
                                    &sync_tx,
                                    &target_devices,
                                    "codexBranchSwitchFailed",
                                    "desktop failed mobile git branch switch",
                                    serde_json::json!({
                                        "cwd": cwd,
                                        "branch": branch,
                                        "error": err,
                                    }),
                                )
                                .await;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        let state = app.state::<AppState>();
        *state.is_connected.lock().await = false;
        *state.ws_tx.lock().await = None;
        info!("[WS Broker] WS receive stream ended, broker shutting down");
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// run() — Application entry point
// ═══════════════════════════════════════════════════════════════════════════

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    yibovibe_core::local_auth::load_session();
    yibovibe_core::dictionary::init_and_load_dictionaries();
    yibovibe_core::dictionary::load_freq_cache();
    if let Err(e) = yibovibe_core::cache::init_cache_and_history() {
        log::error!("Failed to initialize clipboard history: {}", e);
    }
    #[cfg(target_os = "windows")]
    yibovibe_core::hook_manager::start_global_hook();

    let is_elevated_relaunch = std::env::args().any(|arg| arg == "--elevated-relaunch");
    let debug_mode_enabled = yibovibe_core::config::GLOBAL_CONFIG
        .read()
        .map(|cfg| cfg.debug_mode)
        .unwrap_or(false);
    let allow_multi_instance = std::env::var("YIBOFLOW_ALLOW_MULTI_INSTANCE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
        || debug_mode_enabled
        || is_elevated_relaunch;

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["hint"])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(AppState {
            session_manager: terminal::new_shared_manager(
                &yibovibe_core::config::GLOBAL_CONFIG
                    .read()
                    .map(|cfg| cfg.terminal_default_shell.clone())
                    .unwrap_or_else(|_| "cmd".to_string()),
            ),
            closing_sessions: Mutex::new(HashMap::new()),
            is_connected: Mutex::new(false),
            ws_tx: Mutex::new(None),
            runtime_server_url: Mutex::new(None),
            runtime_username: Mutex::new(None),
            runtime_device_name: Mutex::new(None),
            runtime_remote_device_id: Mutex::new(None),
            persistent_device_fingerprint: Mutex::new(None),
            runtime_device_fingerprint: Mutex::new(None),
            runtime_access_token: Mutex::new(None),
            runtime_role: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    let builder = if allow_multi_instance {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
    };

    let app_data_base = std::env::var("YIBOFLOW_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./host_state"));
    let (host_ctrl, host_event_rx) = agent_bridge::HostController::new(app_data_base);
    let host_ctrl = Arc::new(Mutex::new(host_ctrl));

    let host_ctrl_for_setup = host_ctrl.clone();
    builder
        .manage(host_ctrl)
        .setup(move |app| {
            let app_handle = app.handle().clone();
            agent_bridge::spawn_event_forwarder(app_handle, host_event_rx);
            spawn_session_sync_guard(app.handle().clone());
            spawn_workbench_sync_guard(app.handle().clone());
            let host = host_ctrl_for_setup.clone();
            tauri::async_runtime::spawn(async move {
                let ctrl = host.lock().await;
                if let Err(e) = ctrl.start().await {
                    log::error!("[AgentHost] Failed to start: {e}");
                } else {
                    info!("[AgentHost] Started successfully");
                }
            });

            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("YiboVibe")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            let main_window = app.get_webview_window("main").unwrap();
            {
                use tauri_plugin_window_state::{StateFlags, WindowExt};
                let _ = main_window.restore_state(StateFlags::all());
            }
            normalize_main_window_size(&main_window);
            let _ = main_window.show();
            let window_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                    let _ = window_clone
                        .app_handle()
                        .save_window_state(StateFlags::all());
                    window_clone.hide().unwrap();
                    api.prevent_close();
                }
            });

            // Create Hint window
            let hint_win = tauri::WebviewWindowBuilder::new(
                app,
                "hint",
                tauri::WebviewUrl::App("/#/hint".into()),
            )
            .title("FlowHint")
            .inner_size(300.0, 280.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .visible(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .build()
            .unwrap();

            #[cfg(target_os = "windows")]
            {
                use windows::Win32::UI::WindowsAndMessaging::{
                    GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
                    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
                };
                let raw_hwnd = hint_win.hwnd().unwrap();
                let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as *mut _);
                unsafe {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    let new_style = (ex_style | 0x08000000i32 | 0x00000080i32) & !0x00000020i32;
                    SetWindowLongW(hwnd, GWL_EXSTYLE, new_style);
                    let _ = SetWindowPos(
                        hwnd,
                        None,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED,
                    );
                }
            }

            // Hint event bridge
            let (hint_tx, hint_rx) = std::sync::mpsc::channel();
            yibovibe_core::hook_manager::set_hint_tx(hint_tx);
            refresh_hint_window_cfg();
            let app_handle = app.handle().clone();
            #[cfg(target_os = "windows")]
            let hint_hwnd_raw = {
                let raw = hint_win.hwnd().unwrap();
                raw.0 as isize
            };
            std::thread::spawn(move || {
                use yibovibe_core::hook_manager::HintEvent;
                while let Ok(event) = hint_rx.recv() {
                    let ev_clone = event.clone();
                    let app_handle_inner = app_handle.clone();
                    let _ = app_handle.run_on_main_thread(move || {
                        #[cfg(target_os = "windows")]
                        {
                            let hint_hwnd =
                                windows::Win32::Foundation::HWND(hint_hwnd_raw as *mut _);
                            use windows::Win32::UI::WindowsAndMessaging::{
                                SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE,
                                SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE,
                            };
                            match &ev_clone {
                                HintEvent::Show {
                                    candidates, x, y, ..
                                } => {
                                    let visible_count = candidates.len().min(8) as i32;
                                    let (_, _, _, _, _) = *HINT_WINDOW_CFG.lock().unwrap();
                                    let mut pos_x = *x;
                                    let mut pos_y = *y;
                                    // Clamp to screen
                                    unsafe {
                                        let _ = SetWindowPos(
                                            hint_hwnd,
                                            Some(HWND_TOPMOST),
                                            pos_x,
                                            pos_y,
                                            300,
                                            68 + visible_count * 34,
                                            SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                        );
                                        let _ = ShowWindow(hint_hwnd, SW_SHOWNOACTIVATE);
                                    }
                                }
                                HintEvent::Hide => unsafe {
                                    let _ = ShowWindow(hint_hwnd, SW_HIDE);
                                },
                                _ => {}
                            }
                        }
                    });
                    let _ = app_handle.emit("hint-event", event);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── Engineering ──
            cmd_engineering::register_engine,
            cmd_engineering::connect_engine,
            cmd_engineering::logout_engine,
            cmd_engineering::get_user_role,
            // ── Probe ──
            cmd_probe::get_probe_config,
            cmd_probe::save_probe_config,
            cmd_probe::test_probe_credential,
            cmd_probe::test_probe_route,
            cmd_probe::list_probe_credential_models,
            cmd_probe::list_probe_route_models,
            cmd_probe::start_probe_proxy,
            cmd_probe::stop_probe_proxy,
            cmd_probe::get_probe_dashboard,
            cmd_probe::clear_probe_logs,
            // ── Settings ──
            cmd_settings::get_app_config,
            cmd_settings::get_settings,
            cmd_settings::update_settings,
            cmd_settings::get_flowsync_auto_sync_prefs,
            cmd_settings::set_flowsync_auto_sync_prefs,
            cmd_settings::set_dictionary_order,
            cmd_settings::change_local_password,
            cmd_settings::rename_local_account,
            cmd_settings::force_override_remote,
            cmd_settings::manual_vault_compaction,
            cmd_settings::export_config,
            cmd_settings::import_config,
            cmd_settings::get_all_dictionaries,
            cmd_settings::save_dictionary,
            cmd_settings::delete_dictionary,
            cmd_settings::regenerate_device_fingerprint,
            cmd_settings::get_desktop_build_label,
            // ── Window / Hint ──
            cmd_window::get_window_under_cursor,
            cmd_window::start_app_picker,
            cmd_window::diagnose_flowhint,
            cmd_window::update_key_mappings,
            cmd_window::accept_hint_candidate,
            cmd_window::dismiss_hint_window,
            cmd_window::update_hint_position,
            cmd_window::move_hint_window,
            cmd_window::reset_hint_position,
            cmd_window::set_hint_window_mode,
            // ── Clipboard / History ──
            cmd_clipboard::read_clipboard_content,
            cmd_clipboard::write_to_clipboard,
            cmd_clipboard::write_image_to_clipboard,
            cmd_clipboard::init_clipboard_history,
            cmd_clipboard::query_history,
            cmd_clipboard::search_history,
            cmd_clipboard::copy_history_to_clipboard,
            cmd_clipboard::delete_history,
            cmd_clipboard::clear_history,
            cmd_clipboard::toggle_history_pin,
            cmd_clipboard::get_cache_stats,
            cmd_clipboard::set_cache_dir,
            cmd_clipboard::set_cache_max_size,
            cmd_clipboard::get_history_content,
            cmd_clipboard::pull_today_history,
            // ── Terminal ──
            cmd_terminal::get_terminal_prefs,
            cmd_terminal::set_terminal_prefs,
            cmd_terminal::start_terminal,
            cmd_terminal::write_terminal,
            cmd_terminal::kill_terminal,
            cmd_terminal::create_session,
            cmd_terminal::start_session,
            cmd_terminal::list_sessions,
            cmd_terminal::get_session_buffer,
            cmd_terminal::remove_session,
            cmd_terminal::resize_session,
            cmd_terminal::get_console_admin_status,
            cmd_terminal::request_console_admin,
            // ── FlowSync ──
            cmd_flowsync::get_flowsync_runtime_state,
            cmd_flowsync::get_flowsync_diagnostics,
            cmd_flowsync::set_flowsync_receive_only_mode,
            cmd_flowsync::get_cluster_devices,
            cmd_flowsync::list_flowsync_online_devices,
            cmd_flowsync::get_vault_sync_status,
            cmd_flowsync::resolve_sync_conflict,
            cmd_flowsync::create_flowsync_entry_from_path,
            cmd_flowsync::get_flowsync_entry_transfer_state,
            cmd_flowsync::download_flowsync_entry,
            cmd_flowsync::get_flowsync_staging_preferences,
            cmd_flowsync::set_flowsync_staging_preferences,
            // ── Codex ──
            cmd_codex::codex_app_server_probe,
            cmd_codex::codex_app_server_request,
            cmd_codex::get_git_branch_state,
            cmd_codex::switch_git_branch,
            cmd_codex::codex_app_server_reply_server_request,
            cmd_codex::codex_app_server_respond_pending_approval,
            cmd_codex::codex_desktop_ipc_request,
            cmd_codex::codex_app_server_disconnect,
            // ── FlowRules ──
            cmd_rules::get_flow_rules,
            cmd_rules::set_default_rules,
            cmd_rules::upsert_app_rule,
            cmd_rules::remove_app_rule,
            cmd_rules::toggle_app_feature,
            cmd_rules::toggle_default_feature,
            // ── Admin ──
            cmd_admin::admin_list_users,
            cmd_admin::admin_update_user_status,
            cmd_admin::admin_delete_user,
            cmd_admin::admin_reset_password,
            cmd_admin::admin_list_devices,
            cmd_admin::admin_kick_device,
            cmd_admin::admin_delete_user_vault,
            cmd_admin::admin_get_flowsync_staging_policy,
            cmd_admin::admin_update_flowsync_staging_policy,
            // ── Agent bridge ──
            crate::agent_bridge::get_host_state,
            crate::agent_bridge::restart_host,
            crate::agent_bridge::get_host_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_thread_filter_keeps_new_desktop_sources() {
        let thread = serde_json::json!({
            "id": "thread-new",
            "source": "desktop"
        });

        assert!(codex_is_primary_thread(&thread));
    }

    #[test]
    fn primary_thread_filter_still_rejects_derived_subagent_threads() {
        let string_thread = serde_json::json!({
            "id": "thread-derived",
            "source": "subAgentReview"
        });
        let object_thread = serde_json::json!({
            "id": "thread-derived-object",
            "source": {
                "subAgent": {
                    "other": "reviewer"
                }
            }
        });

        assert!(!codex_is_primary_thread(&string_thread));
        assert!(!codex_is_primary_thread(&object_thread));
    }

    #[test]
    fn retain_codex_threads_with_known_ids_drops_stale_ipc_only_threads() {
        let listed_ids = std::collections::HashSet::from([
            "thread-live".to_string(),
            "thread-current".to_string(),
        ]);
        let threads = vec![
            serde_json::json!({ "id": "thread-live", "name": "Live" }),
            serde_json::json!({ "id": "thread-stale", "name": "Stale archived" }),
            serde_json::json!({ "id": "thread-current", "name": "Current" }),
        ];

        let retained = retain_codex_threads_with_known_ids(threads, &listed_ids);
        let retained_ids = codex_thread_ids(&retained);

        assert_eq!(retained.len(), 2);
        assert!(retained_ids.contains("thread-live"));
        assert!(retained_ids.contains("thread-current"));
        assert!(!retained_ids.contains("thread-stale"));
    }
}
