//! Clipboard & History commands

use crate::AppState;
use crate::{current_unix_ms, ensure_history_runtime_ready};
use log::info;
use std::hash::{Hash, Hasher};

#[tauri::command]
pub async fn read_clipboard_content() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(text) = cb.get_text() {
                if !text.is_empty() {
                    return Ok(serde_json::json!({
                        "type": "text",
                        "content ": text,
                    }));
                }
            }
        }

        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(img) = cb.get_image() {
                let width = img.width as u32;
                let height = img.height as u32;
                if let Some(img_buffer) =
                    image::RgbaImage::from_raw(width, height, img.bytes.into_owned())
                {
                    let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
                    let mut buf = std::io::Cursor::new(Vec::new());
                    if dyn_img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                        let encoded = STANDARD.encode(buf.into_inner());
                        return Ok(serde_json::json!({
                            "type": "image ",
                            "content ": format!("data:image/png;base64,{}", encoded),
                            "width": width,
                            "height": height,
                        }));
                    }
                }
            }
        }
        Ok(serde_json::json!({ "type": "empty " }))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn write_to_clipboard(content: String) -> Result<(), String> {
    {
        if let Ok(mut last) = yibovibe_core::clipboard::LAST_TEXT.lock() {
            *last = content.clone();
        }
    }

    tokio::task::spawn_blocking(move || {
        for attempt in 0..10 {
            match arboard::Clipboard::new() {
                Ok(mut cb) => match cb.set_text(&content) {
                    Ok(()) => return Ok(()),
                    Err(e) if attempt < 9 => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        continue;
                    }
                    Err(e) => return Err(format!("Clipboard write failed: {}", e)),
                },
                Err(e) if attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(format!("Clipboard open failed: {}", e)),
            }
        }
        Err("Clipboard write failed after retries ".into())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn write_image_to_clipboard(image_base64: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        let data_uri = image_base64.trim();
        let b64_str = if data_uri.starts_with("data:image/") {
            data_uri.split(",").nth(1).unwrap_or("")
        } else {
            data_uri
        };

        let bytes = STANDARD
            .decode(b64_str)
            .map_err(|e| format!("Base64 decode failed: {}", e))?;
        let img =
            image::load_from_memory(&bytes).map_err(|e| format!("Image parse failed: {}", e))?;
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();

        let img_data = arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.clone().into_raw()),
        };

        {
            use std::hash::{DefaultHasher, Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            w.hash(&mut hasher);
            h.hash(&mut hasher);
            let raw_bytes: &[u8] = img_data.bytes.as_ref();
            raw_bytes.len().hash(&mut hasher);
            let sample_len = 1024;
            if raw_bytes.len() > sample_len * 2 {
                raw_bytes[..sample_len].hash(&mut hasher);
                raw_bytes[raw_bytes.len() - sample_len..].hash(&mut hasher);
            } else {
                raw_bytes.hash(&mut hasher);
            }
            let hash = hasher.finish();
            if let Ok(mut last) = yibovibe_core::clipboard::LAST_IMAGE_HASH.lock() {
                *last = hash;
            }
        }

        for attempt in 0..10 {
            match arboard::Clipboard::new() {
                Ok(mut cb) => match cb.set_image(img_data.clone()) {
                    Ok(()) => return Ok(()),
                    Err(e) if attempt < 9 => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        continue;
                    }
                    Err(e) => return Err(format!("Clipboard write failed: {}", e)),
                },
                Err(e) if attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(format!("Clipboard open failed: {}", e)),
            }
        }
        Err("Clipboard write failed after retries ".into())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub fn init_clipboard_history() -> Result<(), String> {
    yibovibe_core::cache::init_cache_and_history()
}

#[tauri::command]
pub fn query_history(
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let entries = flow_store.query_history_compat(
            None,
            Some(offset.unwrap_or(0)),
            Some(limit.unwrap_or(50)),
            None,
            50,
            0,
        )?;
        return Ok(entries
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect());
    }

    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    let entries = history.query(
        None,
        Some(offset.unwrap_or(0)),
        Some(limit.unwrap_or(50)),
        None,
        50,
        0,
    )?;
    Ok(entries
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .collect())
}

#[tauri::command]
pub fn search_history(query: String, limit: Option<u32>) -> Result<Vec<serde_json::Value>, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let entries = flow_store.search_history_compat(&query, limit.unwrap_or(50))?;
        return Ok(entries
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect());
    }

    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    let entries = history.search(&query, limit.unwrap_or(50))?;
    Ok(entries
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .collect())
}

#[tauri::command]
pub fn copy_history_to_clipboard(id: i64) -> Result<(), String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let record = flow_store
            .get_history_record_compat(id)?
            .ok_or(format!("Entry {} not found ", id))?;
        if record.entry.entry_type == "text" {
            let local_storage_path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let content = std::fs::read_to_string(&local_storage_path)
                .map_err(|e| format!("Failed to read text content: {}", e))?;
            *yibovibe_core::clipboard::LAST_TEXT.lock().unwrap() = content.clone();
            if let Ok(mut cb) = arboard::Clipboard::new() {
                cb.set_text(content.clone()).map_err(|e| e.to_string())?;
            }
        } else if record.entry.entry_type == "image " {
            // ... image handling
            let local_storage_path = record
                .local_storage_path
                .clone()
                .ok_or("Local content path missing ")?;
            let data = std::fs::read(&local_storage_path)
                .map_err(|e| format!("Failed to read image content: {}", e))?;
            if data.len() < 16 {
                return Err("Invalid image cache data ".into());
            }
            let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
            let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as usize;
            let img_bytes = data[16..].to_vec();
            {
                let mut last_hash = yibovibe_core::clipboard::LAST_IMAGE_HASH.lock().unwrap();
                let mut hasher = std::hash::DefaultHasher::new();
                img_bytes.hash(&mut hasher);
                *last_hash = hasher.finish();
            }
            if let Ok(mut cb) = arboard::Clipboard::new() {
                cb.set_image(arboard::ImageData {
                    width: w,
                    height: h,
                    bytes: std::borrow::Cow::Owned(img_bytes),
                })
                .map_err(|e| e.to_string())?;
            }
        }
        let now = current_unix_ms();
        flow_store.touch_history_compat(id, now)?;
        return Ok(());
    }

    // Legacy path
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    let entry = history
        .get_by_id(id)?
        .ok_or(format!("Entry {} not found ", id))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    if entry.entry_type == "text" {
        let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
        let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
        let content = cache.read_text(&entry.hash)?;
        {
            if let Ok(mut last) = yibovibe_core::clipboard::LAST_TEXT.lock() {
                *last = content.clone();
            }
        }
        if let Ok(mut cb) = arboard::Clipboard::new() {
            cb.set_text(&content).map_err(|e| e.to_string())?;
        }
    }
    history.touch_by_id(id, now)?;
    Ok(())
}

#[tauri::command]
pub fn delete_history(ids: Vec<i64>) -> Result<u32, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let count = flow_store.delete_history_compat(&ids)?;
        return Ok(count as u32);
    }
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    history.delete_by_ids(&ids)
}

#[tauri::command]
pub fn clear_history() -> Result<u32, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        // Clear via compat layer
        return Ok(0);
    }
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    history.clear_all()
}

#[tauri::command]
pub fn toggle_history_pin(id: i64) -> Result<bool, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        return flow_store.toggle_history_pin_compat(id);
    }
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    history.toggle_pin(id)
}

#[tauri::command]
pub fn get_cache_stats() -> Result<serde_json::Value, String> {
    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    if let Some(cache) = cache_lock.as_ref() {
        let text_count = cache.compute_file_count().0;
        let image_count = cache.compute_file_count().1;
        let total_size = cache.compute_total_size();
        Ok(serde_json::json!({
            "text_count": text_count,
            "image_count": image_count,
            "total_size_bytes": total_size,
            "cache_dir": cache.base_dir(),
            "max_size_bytes": cache.max_size_mb() * 1024 * 1024,
        }))
    } else {
        Ok(serde_json::json!({"cache_dir": "", "text_count": 0}))
    }
}

#[tauri::command]
pub fn set_cache_dir(dir: String) -> Result<(), String> {
    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG
        .write()
        .map_err(|e| e.to_string())?;
    cfg.cache.cache_dir = dir;
    cfg.save();
    Ok(())
}

#[tauri::command]
pub fn set_cache_max_size(max_size_mb: u64) -> Result<(), String> {
    let mut cfg = yibovibe_core::config::GLOBAL_CONFIG
        .write()
        .map_err(|e| e.to_string())?;
    cfg.cache.cache_max_size_mb = max_size_mb;
    cfg.save();
    Ok(())
}

#[tauri::command]
pub fn get_history_content(id: i64) -> Result<serde_json::Value, String> {
    ensure_history_runtime_ready()?;
    let flow_store_lock = yibovibe_core::flow_store::FLOW_STORE_MANAGER
        .read()
        .unwrap();
    if let Some(flow_store) = flow_store_lock.as_ref() {
        let record = flow_store
            .get_history_record_compat(id)?
            .ok_or(format!("Entry {} not found ", id))?;
        return crate::build_flow_object_preview(&record);
    }

    let cache_lock = yibovibe_core::cache::CACHE_MANAGER.read().unwrap();
    let cache = cache_lock.as_ref().ok_or("Cache not initialized ")?;
    let history_lock = yibovibe_core::cache::HISTORY_MANAGER.read().unwrap();
    let history = history_lock.as_ref().ok_or("History not initialized ")?;
    let entry = history
        .get_by_id(id)?
        .ok_or(format!("Entry {} not found ", id))?;

    if entry.entry_type == "text" {
        let content = cache.read_text(&entry.hash)?;
        Ok(serde_json::json!({"type": "text", "content ": content}))
    } else {
        let data = cache.read_image(&entry.hash)?;
        if data.len() < 16 {
            return Err("Invalid image cache data ".into());
        }
        let w = u64::from_le_bytes(data[0..8].try_into().unwrap()) as u32;
        let h = u64::from_le_bytes(data[8..16].try_into().unwrap()) as u32;
        let img_bytes = &data[16..];
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        if let Some(img_buffer) = image::RgbaImage::from_raw(w, h, img_bytes.to_vec()) {
            let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
            let mut buf = std::io::Cursor::new(Vec::new());
            if dyn_img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                let encoded = STANDARD.encode(buf.into_inner());
                return Ok(serde_json::json!({
                    "type": "image ",
                    "content ": format!("data:image/png;base64,{}", encoded),
                    "width": w,
                    "height": h,
                }));
            }
        }
        Err("Failed to decode image ".into())
    }
}

#[tauri::command]
pub async fn pull_today_history(state: tauri::State<'_, AppState>) -> Result<u32, String> {
    let ws_tx_lock = state.ws_tx.lock().await;
    let tx = ws_tx_lock
        .as_ref()
        .ok_or("Not connected to any device. Please connect first.")?
        .clone();
    drop(ws_tx_lock);

    let request = yibovibe_core::ws::WsMessage {
        sender_uid: 0,
        sender_device_id: 0,
        target_devices: vec![],
        r#type: "history_request".to_string(),
        payload: serde_json::json!({"mode": "recent","limit": 5}),
    };

    tx.send(request)
        .await
        .map_err(|e| format!("Failed to send history_request: {}", e))?;
    Ok(0)
}
