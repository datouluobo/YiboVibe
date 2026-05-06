use log::{error, info};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct CacheManager {
    base_dir: Mutex<PathBuf>,
    max_size_mb: Mutex<u64>,
}

impl CacheManager {
    pub fn new(base_dir: PathBuf, max_size_mb: u64) -> Self {
        let dirs = vec![base_dir.join("text"), base_dir.join("image")];
        for d in &dirs {
            if let Err(e) = fs::create_dir_all(d) {
                error!("Failed to create cache dir {:?}: {}", d, e);
            }
        }
        info!(
            "CacheManager initialized at {:?}, max {}MB",
            base_dir, max_size_mb
        );
        Self {
            base_dir: Mutex::new(base_dir),
            max_size_mb: Mutex::new(max_size_mb),
        }
    }

    pub fn base_dir(&self) -> PathBuf {
        self.base_dir.lock().unwrap().clone()
    }

    pub fn max_size_mb(&self) -> u64 {
        *self.max_size_mb.lock().unwrap()
    }

    pub fn set_max_size_mb(&self, mb: u64) {
        *self.max_size_mb.lock().unwrap() = mb;
    }

    pub fn db_path(&self) -> PathBuf {
        self.base_dir.lock().unwrap().join("clipboard.db")
    }

    pub fn text_path(&self, hash: &str) -> PathBuf {
        self.base_dir
            .lock()
            .unwrap()
            .join("text")
            .join(format!("{}.txt", hash))
    }

    pub fn image_path(&self, hash: &str) -> PathBuf {
        self.base_dir
            .lock()
            .unwrap()
            .join("image")
            .join(format!("{}.png", hash))
    }

    pub fn write_text(&self, hash: &str, content: &str) -> Result<(), String> {
        let path = self.text_path(hash);
        fs::write(&path, content).map_err(|e| format!("Failed to write text cache: {}", e))
    }

    pub fn write_image(&self, hash: &str, data: &[u8]) -> Result<(), String> {
        let path = self.image_path(hash);
        fs::write(&path, data).map_err(|e| format!("Failed to write image cache: {}", e))
    }

    pub fn read_text(&self, hash: &str) -> Result<String, String> {
        let path = self.text_path(hash);
        fs::read_to_string(&path).map_err(|e| format!("Failed to read text cache: {}", e))
    }

    pub fn read_image(&self, hash: &str) -> Result<Vec<u8>, String> {
        let path = self.image_path(hash);
        fs::read(&path).map_err(|e| format!("Failed to read image cache: {}", e))
    }

    pub fn delete_file(&self, entry_type: &str, hash: &str) -> Result<(), String> {
        let path = match entry_type {
            "text" => self.text_path(hash),
            "image" => self.image_path(hash),
            _ => return Err(format!("Unknown type: {}", entry_type)),
        };
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete cache file: {}", e))
        } else {
            Ok(())
        }
    }

    pub fn compute_total_size(&self) -> u64 {
        let base = self.base_dir.lock().unwrap().clone();
        let text_dir = base.join("text");
        let image_dir = base.join("image");
        let mut total: u64 = 0;
        if let Ok(entries) = fs::read_dir(&text_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    total += meta.len();
                }
            }
        }
        if let Ok(entries) = fs::read_dir(&image_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    total += meta.len();
                }
            }
        }
        total
    }

    pub fn compute_file_count(&self) -> (usize, usize) {
        let base = self.base_dir.lock().unwrap().clone();
        let text_count = count_files(&base.join("text"));
        let image_count = count_files(&base.join("image"));
        (text_count, image_count)
    }

    pub fn migrate_to(&self, new_dir: PathBuf) -> Result<(), String> {
        let old_dir = self.base_dir.lock().unwrap().clone();
        if old_dir == new_dir {
            return Ok(());
        }

        let new_text = new_dir.join("text");
        let new_image = new_dir.join("image");
        fs::create_dir_all(&new_text)
            .map_err(|e| format!("Failed to create new text dir: {}", e))?;
        fs::create_dir_all(&new_image)
            .map_err(|e| format!("Failed to create new image dir: {}", e))?;

        move_all_files(&old_dir.join("text"), &new_text)?;
        move_all_files(&old_dir.join("image"), &new_image)?;

        let old_db = old_dir.join("clipboard.db");
        let new_db = new_dir.join("clipboard.db");
        if old_db.exists() {
            fs::copy(&old_db, &new_db).map_err(|e| format!("Failed to copy db: {}", e))?;
        }

        *self.base_dir.lock().unwrap() = new_dir.clone();
        info!("Cache migrated from {:?} to {:?}", old_dir, new_dir);
        Ok(())
    }

    pub fn enforce_size_limit(&self, history: &crate::history::HistoryManager) {
        let max_bytes = *self.max_size_mb.lock().unwrap() * 1024 * 1024;
        if max_bytes == 0 {
            return;
        }
        if let Ok((_, _, _)) = history.get_stats() {
            let total = self.compute_total_size();
            if total <= max_bytes {
                return;
            }
            let excess = total - max_bytes;
            let candidates = history.get_lru_unpinned(excess);
            let ids: Vec<i64> = candidates.iter().map(|(id, _, _)| *id).collect();
            for (_id, entry_type, hash) in &candidates {
                if let Err(err) = self.delete_file(entry_type, hash) {
                    log::warn!(
                        "Failed to delete cache file during eviction for {}:{}: {}",
                        entry_type,
                        hash,
                        err
                    );
                }
            }
            if !ids.is_empty() {
                match history.delete_by_ids(&ids) {
                    Ok(_) => log::info!("Cache eviction: removed {} entries", ids.len()),
                    Err(err) => {
                        log::error!("Cache eviction failed to delete history rows: {}", err)
                    }
                }
            }
        }
    }
}

fn count_files(dir: &Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| entries.count())
        .unwrap_or(0)
}

fn move_all_files(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir failed: {}", e))? {
        let entry = entry.map_err(|e| format!("dir entry failed: {}", e))?;
        let file_name = entry.file_name();
        let src_path = entry.path();
        let dst_path = dst.join(&file_name);
        if dst_path.exists() {
            fs::remove_file(&dst_path).ok();
        }
        fs::rename(&src_path, &dst_path)
            .or_else(|_| {
                fs::copy(&src_path, &dst_path)?;
                fs::remove_file(&src_path)
            })
            .map_err(|e| format!("Failed to move {:?}: {}", src_path, e))?;
    }
    Ok(())
}

pub fn hash_bytes(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
}

use std::sync::RwLock;

pub static CACHE_MANAGER: RwLock<Option<CacheManager>> = RwLock::new(None);
pub static HISTORY_MANAGER: RwLock<Option<crate::history::HistoryManager>> = RwLock::new(None);

pub fn init_cache_and_history() -> Result<(), String> {
    let cfg = crate::config::GLOBAL_CONFIG.read().unwrap();
    let cache_dir_str = cfg.cache.cache_dir.clone();
    let max_size = cfg.cache.cache_max_size_mb;
    drop(cfg);

    let cache_dir = if cache_dir_str.is_empty() {
        crate::local_auth::get_active_user_dir().join("cache")
    } else {
        std::path::PathBuf::from(&cache_dir_str)
    };

    let cache = CacheManager::new(cache_dir, max_size);
    let db_path = cache.db_path();
    let history = crate::history::HistoryManager::new(db_path)?;
    let flow_store_root = crate::local_auth::get_active_user_dir().join("flowsync");
    let flow_store = crate::flow_store::FlowStoreManager::new(flow_store_root)?;
    let migration_report = crate::flow_migration::FlowMigrationManager::backfill_legacy_history(
        &flow_store,
        &cache.db_path(),
        &cache.base_dir(),
    )?;

    *CACHE_MANAGER.write().unwrap() = Some(cache);
    *HISTORY_MANAGER.write().unwrap() = Some(history);
    *crate::flow_store::FLOW_STORE_MANAGER.write().unwrap() = Some(flow_store);

    log::info!(
        "Cache, History, and FlowSync store initialized (legacy backfill: scanned={}, inserted={}, skipped={})",
        migration_report.scanned,
        migration_report.inserted,
        migration_report.skipped_existing
    );
    Ok(())
}

pub fn enforce_cache_limit_now() {
    let cache_lock = CACHE_MANAGER.read().unwrap();
    let history_lock = HISTORY_MANAGER.read().unwrap();
    if let (Some(cache), Some(history)) = (cache_lock.as_ref(), history_lock.as_ref()) {
        cache.enforce_size_limit(history);
    }
}

pub fn record_clipboard_text(content: &str, source: &str) {
    let hash = hash_bytes(content.as_bytes());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let cache_lock = CACHE_MANAGER.read().unwrap();
    let history_lock = HISTORY_MANAGER.read().unwrap();
    let flow_store_lock = crate::flow_store::FLOW_STORE_MANAGER.read().unwrap();
    if let (Some(cache), Some(history)) = (cache_lock.as_ref(), history_lock.as_ref()) {
        if history.exists_by_hash(&hash) {
            let _ = history.touch_by_hash(&hash, now);
            let _ = history.update_source_by_hash(&hash, source);
            if let Some(flow_store) = flow_store_lock.as_ref() {
                let _ = flow_store.upsert_clipboard_entry(
                    "text",
                    &hash,
                    content.len() as i64,
                    Some(content),
                    source,
                    Some(&cache.text_path(&hash)),
                    now,
                );
            }
            return;
        }
        let preview = if content.chars().count() > 200 {
            format!("{}...", content.chars().take(200).collect::<String>())
        } else {
            content.to_string()
        };
        let size = content.len() as i64;
        if let Err(e) = cache.write_text(&hash, content) {
            log::error!("Failed to cache text: {}", e);
            return;
        }
        if let Err(e) = history.insert(now, "text", &hash, size, Some(&preview), source) {
            log::error!("Failed to insert history: {}", e);
        }
        if let Some(flow_store) = flow_store_lock.as_ref() {
            if let Err(e) = flow_store.upsert_clipboard_entry(
                "text",
                &hash,
                size,
                Some(&preview),
                source,
                Some(&cache.text_path(&hash)),
                now,
            ) {
                log::error!("Failed to upsert FlowSync text entry: {}", e);
            }
        }
        cache.enforce_size_limit(history);
    }
}

pub fn record_clipboard_image(data: &[u8], source: &str, content_id: Option<&str>) {
    let hash = content_id
        .filter(|id| !id.trim().is_empty())
        .map(|id| id.to_string())
        .unwrap_or_else(|| hash_bytes(data));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let cache_lock = CACHE_MANAGER.read().unwrap();
    let history_lock = HISTORY_MANAGER.read().unwrap();
    let flow_store_lock = crate::flow_store::FLOW_STORE_MANAGER.read().unwrap();
    if let (Some(cache), Some(history)) = (cache_lock.as_ref(), history_lock.as_ref()) {
        if history.exists_by_hash(&hash) {
            let _ = history.touch_by_hash(&hash, now);
            let _ = history.update_source_by_hash(&hash, source);
            if let Some(flow_store) = flow_store_lock.as_ref() {
                let _ = flow_store.upsert_clipboard_entry(
                    "image",
                    &hash,
                    data.len() as i64,
                    generate_image_thumbnail(data).as_deref(),
                    source,
                    Some(&cache.image_path(&hash)),
                    now,
                );
            }
            return;
        }
        let size = data.len() as i64;
        if let Err(e) = cache.write_image(&hash, data) {
            log::error!("Failed to cache image: {}", e);
            return;
        }
        let preview = generate_image_thumbnail(data);
        if let Err(e) = history.insert(now, "image", &hash, size, preview.as_deref(), source) {
            log::error!("Failed to insert image history: {}", e);
        }
        if let Some(flow_store) = flow_store_lock.as_ref() {
            if let Err(e) = flow_store.upsert_clipboard_entry(
                "image",
                &hash,
                size,
                preview.as_deref(),
                source,
                Some(&cache.image_path(&hash)),
                now,
            ) {
                log::error!("Failed to upsert FlowSync image entry: {}", e);
            }
        }
        cache.enforce_size_limit(history);
    }
}

pub fn record_local_path_entry(path: &Path, entry_source: &str) -> Result<i64, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let flow_store_lock = crate::flow_store::FLOW_STORE_MANAGER.read().unwrap();
    let flow_store = flow_store_lock
        .as_ref()
        .ok_or("FlowSync store not initialized")?;
    flow_store.create_local_path_entry(path, entry_source, now)
}

/// Longest edge in pixels. FlowSync list cards render much smaller than the full image, so
/// a 320px preview keeps the activity stream snappy while staying clear enough for screenshots.
const PREVIEW_MAX_EDGE: u32 = 320;

fn downscale_for_preview(dyn_img: image::DynamicImage) -> image::DynamicImage {
    use image::imageops::FilterType;
    let max_dim = dyn_img.width().max(dyn_img.height());
    if max_dim <= PREVIEW_MAX_EDGE {
        return dyn_img;
    }
    let scale = PREVIEW_MAX_EDGE as f32 / max_dim as f32;
    let tw = (dyn_img.width() as f32 * scale).round() as u32;
    let th = (dyn_img.height() as f32 * scale).round() as u32;
    dyn_img.resize(tw.max(1), th.max(1), FilterType::Triangle)
}

fn generate_image_thumbnail(data: &[u8]) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    if data.len() < 16 {
        return None;
    }
    let w = u64::from_le_bytes(data[0..8].try_into().ok()?) as u32;
    let h = u64::from_le_bytes(data[8..16].try_into().ok()?) as u32;
    let pixels = &data[16..];
    if let Some(img_buffer) = image::RgbaImage::from_raw(w, h, pixels.to_vec()) {
        let dyn_img = image::DynamicImage::ImageRgba8(img_buffer);
        let thumb = downscale_for_preview(dyn_img);
        let mut buf = std::io::Cursor::new(Vec::new());
        if thumb.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
            let encoded = STANDARD.encode(buf.into_inner());
            return Some(format!("data:image/png;base64,{}", encoded));
        }
    }
    None
}
