use crate::crypto::{DataKey, MasterKey};
use crate::ws::WsMessage;
use arboard::Clipboard;
use log::{error, info};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::sleep;
use std::hash::{DefaultHasher, Hash, Hasher};
use image::DynamicImage;
use lazy_static::lazy_static;

lazy_static! {
    /// Shared clipboard caches used by both the monitor and the hook manager to prevent sync loops.
    pub static ref LAST_TEXT: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    pub static ref LAST_IMAGE_HASH: Arc<Mutex<u64>> = Arc::new(Mutex::new(0));
}

#[cfg(target_os = "windows")]
struct Win32State {
    last_text: Arc<Mutex<String>>,
    last_image_hash: Arc<Mutex<u64>>,
    master_key: Arc<MasterKey>,
    ws_tx: mpsc::Sender<WsMessage>,
    ui_tx: Option<mpsc::Sender<ClipboardEvent>>,
    http_client: reqwest::Client,
    server_url: String,
    token: String,
    runtime: tokio::runtime::Handle,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ClipboardEvent {
    pub status: String,
    pub preview: String,
}

/// Holds the last grabbed clipboard string to prevent infinite duplicate sync loops
pub struct ClipboardMonitor {
    server_url: String,
    token: String,
    http_client: reqwest::Client,
    last_text: Arc<Mutex<String>>,
    last_image_hash: Arc<Mutex<u64>>,
    master_key: Arc<MasterKey>,
    ws_tx: mpsc::Sender<WsMessage>,
    ui_tx: Option<mpsc::Sender<ClipboardEvent>>,
}

impl ClipboardMonitor {
    pub fn new(server_url: String, token: String, master_key: Arc<MasterKey>, ws_tx: mpsc::Sender<WsMessage>, ui_tx: Option<mpsc::Sender<ClipboardEvent>>) -> Self {
        Self {
            server_url,
            token,
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            last_text: Arc::clone(&LAST_TEXT),
            last_image_hash: Arc::clone(&LAST_IMAGE_HASH),
            master_key,
            ws_tx,
            ui_tx,
        }
    }

    fn calculate_image_hash(image: &arboard::ImageData<'_>) -> u64 {
        let mut hasher = DefaultHasher::new();
        image.width.hash(&mut hasher);
        image.height.hash(&mut hasher);
        image.bytes.len().hash(&mut hasher);
        
        let sample_len = 1024;
        if image.bytes.len() > sample_len * 2 {
            image.bytes[..sample_len].hash(&mut hasher);
            image.bytes[image.bytes.len()-sample_len..].hash(&mut hasher);
        } else {
            image.bytes.hash(&mut hasher);
        }
        
        hasher.finish()
    }

    fn generate_thumbnail_base64(image_data: &arboard::ImageData<'_>) -> String {
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        use image::imageops::FilterType;
        const MAX_EDGE: u32 = 512;
        let width = image_data.width as u32;
        let height = image_data.height as u32;

        if let Some(img_buffer) = image::RgbaImage::from_raw(width, height, image_data.bytes.to_vec()) {
            let dyn_img = DynamicImage::ImageRgba8(img_buffer);
            let max_dim = width.max(height);
            let thumb = if max_dim <= MAX_EDGE {
                dyn_img
            } else {
                let scale = MAX_EDGE as f32 / max_dim as f32;
                let tw = (width as f32 * scale).round() as u32;
                let th = (height as f32 * scale).round() as u32;
                dyn_img.resize(tw.max(1), th.max(1), FilterType::Lanczos3)
            };
            let mut buf = std::io::Cursor::new(Vec::new());
            if thumb.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                let encoded = STANDARD.encode(buf.into_inner());
                return format!("data:image/png;base64,{}", encoded);
            }
        }
        format!("[Image {}x{}]", width, height)
    }

    /// Spawns an asynchronous background task that monitors the system clipboard.
    /// On Windows, it uses a message-based listener (WM_CLIPBOARDUPDATE).
    /// On other platforms, it falls back to polling.
    pub fn start_monitoring(&self) {
        #[cfg(target_os = "windows")]
        {
            self.start_win32_listener();
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.start_polling();
        }
    }

    #[cfg(target_os = "windows")]
    fn start_win32_listener(&self) {
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DispatchMessageW, GetMessageW, RegisterClassW, CS_HREDRAW,
            CS_VREDRAW, CW_USEDEFAULT, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
        };
        use windows::Win32::System::DataExchange::AddClipboardFormatListener;
        use windows::core::PCWSTR;

        let last_text_ref = Arc::clone(&self.last_text);
        let last_image_hash_ref = Arc::clone(&self.last_image_hash);
        let mk = Arc::clone(&self.master_key);
        let tx = self.ws_tx.clone();
        let ui_tx = self.ui_tx.clone();
        let client = self.http_client.clone();
        let srv_url = self.server_url.clone();
        let tok = self.token.clone();
        let runtime_handle = tokio::runtime::Handle::current();

        std::thread::spawn(move || {
            unsafe {
                let instance = windows::Win32::System::LibraryLoader::GetModuleHandleW(None).unwrap();
                let class_name_str = "YiboFlowClipboardListener\0";
                let class_name_u16: Vec<u16> = class_name_str.encode_utf16().collect();
                
                let wnd_class = WNDCLASSW {
                    style: CS_HREDRAW | CS_VREDRAW,
                    lpfnWndProc: Some(Self::clipboard_wnd_proc),
                    hInstance: instance.into(),
                    lpszClassName: PCWSTR(class_name_u16.as_ptr()),
                     ..Default::default()
                };

                RegisterClassW(&wnd_class);

                let hwnd = CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    PCWSTR(class_name_u16.as_ptr()),
                    PCWSTR(class_name_u16.as_ptr()),
                    WINDOW_STYLE(0),
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    None,
                    None,
                    instance,
                    None,
                );

                if hwnd.0 == 0 {
                    error!("Failed to create hidden clipboard listener window");
                    return;
                }

                // Start listening
                let _ = AddClipboardFormatListener(hwnd);
                
                // Store state in window long ptr for the static wnd_proc to access
                let state = Box::new(Win32State {
                    last_text: last_text_ref,
                    last_image_hash: last_image_hash_ref,
                    master_key: mk,
                    ws_tx: tx,
                    ui_tx,
                    http_client: client,
                    server_url: srv_url,
                    token: tok,
                    runtime: runtime_handle,
                });
                
                #[cfg(target_pointer_width = "64")]
                windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
                    hwnd,
                    windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA,
                    Box::into_raw(state) as isize,
                );
                
                info!("Clipboard monitoring daemon started (Win32 Message Listener mode).");

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).into() {
                    let _ = DispatchMessageW(&msg);
                }
            }
        });
    }

    #[cfg(target_os = "windows")]
    unsafe extern "system" fn clipboard_wnd_proc(hwnd: windows::Win32::Foundation::HWND, msg: u32, wparam: windows::Win32::Foundation::WPARAM, lparam: windows::Win32::Foundation::LPARAM) -> windows::Win32::Foundation::LRESULT {
        use windows::Win32::UI::WindowsAndMessaging::{DefWindowProcW, GWLP_USERDATA, WM_CLIPBOARDUPDATE};
        use windows::Win32::Foundation::LRESULT;
        
        if msg == WM_CLIPBOARDUPDATE {
            #[cfg(target_pointer_width = "64")]
            let ptr = unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(hwnd, GWLP_USERDATA) };
            if ptr != 0 {
                let state = unsafe { &*(ptr as *const Win32State) };
                state.runtime.spawn(Self::on_clipboard_change(
                    state.last_text.clone(),
                    state.last_image_hash.clone(),
                    state.master_key.clone(),
                    state.ws_tx.clone(),
                    state.ui_tx.clone(),
                    state.http_client.clone(),
                    state.server_url.clone(),
                    state.token.clone()
                ));
            }
            return LRESULT(0);
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    async fn on_clipboard_change(
        last_text_ref: Arc<Mutex<String>>,
        last_image_hash_ref: Arc<Mutex<u64>>,
        mk: Arc<MasterKey>,
        tx: mpsc::Sender<WsMessage>,
        ui_tx: Option<mpsc::Sender<ClipboardEvent>>,
        client: reqwest::Client,
        srv_url: String,
        tok: String,
    ) {
        // Debounce to allow OS or source app to finish I/O
        tokio::time::sleep(Duration::from_millis(200)).await;

        // Open clipboard, read immediately, and drop right away to release the OS lock.
        // Each read attempt gets its own short-lived Clipboard instance so we never
        // hold the system clipboard open across sleep/retry boundaries.
        let current_text = Self::try_read_clipboard_text(1, Duration::from_millis(50)).await;

        if let Some(text) = current_text {
            let should_dispatch = {
                let mut last = last_text_ref.lock().unwrap();
                if text != *last && !text.is_empty() {
                    info!("Clipboard [Text] changed via message listener.");
                    *last = text.clone();
                    true
                } else { false }
            };

            if should_dispatch {
                let config = crate::config::GLOBAL_CONFIG.read().unwrap().clone();
                crate::cache::record_clipboard_text(&text, "local");
                if let Some(chan) = ui_tx.as_ref() {
                    let _ = chan.send(ClipboardEvent {
                        status: "sent".to_string(),
                        preview: text.clone(),
                    }).await;
                }
                if config.is_sync_enabled {
                    Self::secure_dispatch(&text, &mk, &tx, &ui_tx).await;
                }
            }
        } else {
            let current_image = Self::try_read_clipboard_image(2, Duration::from_millis(50)).await;

            if let Some(image) = current_image {
                let hash = Self::calculate_image_hash(&image);
                let should_dispatch = {
                    let mut last = last_image_hash_ref.lock().unwrap();
                    if hash != *last {
                        info!("Clipboard [Image] changed via message listener.");
                        *last = hash;
                        true
                    } else { false }
                };

                if should_dispatch {
                    {
                        let img_bytes = &image.bytes;
                        let mut raw = Vec::with_capacity(16 + img_bytes.len());
                        raw.extend_from_slice(&(image.width as u64).to_le_bytes());
                        raw.extend_from_slice(&(image.height as u64).to_le_bytes());
                        raw.extend_from_slice(img_bytes);
                        crate::cache::record_clipboard_image(&raw, "local");
                    }
                    // Notify UI immediately, before the slow network upload
                    if let Some(chan) = ui_tx.as_ref() {
                        let preview = tokio::task::spawn_blocking({
                            let width = image.width;
                            let height = image.height;
                            let bytes = image.bytes.clone().into_owned();
                            move || {
                                let img_data = arboard::ImageData {
                                    width,
                                    height,
                                    bytes: std::borrow::Cow::Owned(bytes),
                                };
                                Self::generate_thumbnail_base64(&img_data)
                            }
                        }).await.unwrap_or_else(|_| format!("[Image {}x{}]", image.width, image.height));
                        let _ = chan.send(ClipboardEvent {
                            status: "sent".to_string(),
                            preview,
                        }).await;
                    }
                    // Background sync upload happens after UI notification
                    let (is_sync_enabled, _, _, _) = crate::config::get_settings();
                    if is_sync_enabled {
                        Self::secure_dispatch_image(image, &mk, &tx, &ui_tx, &client, &srv_url, &tok).await;
                    }
                }
            }
        }
    }

    /// Open the system clipboard, read text, and release immediately.
    /// Retries with fresh Clipboard instances so we never hold the OS lock while sleeping.
    async fn try_read_clipboard_text(max_retries: u32, retry_delay: Duration) -> Option<String> {
        for i in 0..max_retries {
            if let Ok(mut cb) = Clipboard::new() {
                if let Ok(t) = cb.get_text() {
                    return Some(t);
                }
            }
            if i + 1 < max_retries {
                log::warn!("Clipboard text read busy (attempt {}), retrying...", i + 1);
                tokio::time::sleep(retry_delay).await;
            }
        }
        None
    }

    /// Open the system clipboard, read image, and release immediately.
    async fn try_read_clipboard_image(max_retries: u32, retry_delay: Duration) -> Option<arboard::ImageData<'static>> {
        for i in 0..max_retries {
            if let Ok(mut cb) = Clipboard::new() {
                if let Ok(img) = cb.get_image() {
                    // Convert to owned data so the lifetime is 'static
                    return Some(arboard::ImageData {
                        width: img.width,
                        height: img.height,
                        bytes: std::borrow::Cow::Owned(img.bytes.into_owned()),
                    });
                }
            }
            if i + 1 < max_retries {
                log::warn!("Clipboard image read busy (attempt {}), retrying...", i + 1);
                tokio::time::sleep(retry_delay).await;
            }
        }
        None
    }

    /// Try to write text to the system clipboard with retries, releasing the lock between attempts.
    async fn try_set_clipboard_text(text: &str, max_retries: u32, retry_delay: Duration) -> bool {
        for i in 0..max_retries {
            if let Ok(mut cb) = Clipboard::new() {
                if cb.set_text(text.to_string()).is_ok() {
                    return true;
                }
            }
            if i + 1 < max_retries {
                log::warn!("Clipboard text write busy (attempt {}), retrying...", i + 1);
                tokio::time::sleep(retry_delay).await;
            }
        }
        false
    }

    pub fn start_polling(&self) {
        let last_text_ref = Arc::clone(&self.last_text);
        let last_image_hash_ref = Arc::clone(&self.last_image_hash);
        let mk = Arc::clone(&self.master_key);
        let tx = self.ws_tx.clone();
        let ui_tx = self.ui_tx.clone();
        let client = self.http_client.clone();
        let srv_url = self.server_url.clone();
        let tok = self.token.clone();

        tokio::spawn(async move {
            info!("Clipboard monitoring daemon started (polling fallback mode).");
            loop {
                sleep(Duration::from_secs(1)).await;
                Self::on_clipboard_change(
                    last_text_ref.clone(),
                    last_image_hash_ref.clone(),
                    mk.clone(),
                    tx.clone(),
                    ui_tx.clone(),
                    client.clone(),
                    srv_url.clone(),
                    tok.clone()
                ).await;
            }
        });
    }

    async fn secure_dispatch(plaintext: &str, mk: &MasterKey, tx: &mpsc::Sender<WsMessage>, ui_tx: &Option<mpsc::Sender<ClipboardEvent>>) {
        let log_preview = if plaintext.chars().count() > 40 {
            format!("{}...", plaintext.chars().take(40).collect::<String>())
        } else {
            plaintext.to_string()
        };
        info!(
            "[Intercepted] Preparing to E2EE encrypt locally: {:?}",
            log_preview
        );

        // 1. Generate fresh DK
        let dk = DataKey::generate();

        // 2. Encrypt payload using DK
        let enc_data = match dk.encrypt_payload(plaintext) {
            Ok(d) => d,
            Err(e) => {
                error!("Failed to encrypt payload: {:?}", e);
                return;
            }
        };

        // 3. Wrap DK using MK
        let wrapped_dk = match mk.wrap_dk(&dk) {
            Ok(w) => w,
            Err(e) => {
                error!("Failed to wrap DataKey: {:?}", e);
                return;
            }
        };

        // 4. Construct JSON payload
        let payload = serde_json::json!({
            "type": "text",
            "encrypted_data": enc_data,
            "wrapped_key": wrapped_dk
        });

        let msg = WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: vec![], // broadcast to all
            r#type: "clipboard_update".to_string(),
            payload,
        };

        if let Err(e) = tx.send(msg).await {
            error!("Failed to dispatch clipboard over WS channel: {}", e);
        } else {
            info!("Successfully dispatched encrypted payload to WS channel.");
            if let Some(chan) = ui_tx {
                let _ = chan.send(ClipboardEvent {
                    status: "sent".to_string(),
                    preview: plaintext.to_string(),
                }).await;
            }
        }
    }

    async fn secure_dispatch_image(
        image: arboard::ImageData<'_>,
        mk: &MasterKey,
        tx: &mpsc::Sender<WsMessage>,
        ui_tx: &Option<mpsc::Sender<ClipboardEvent>>,
        http_client: &reqwest::Client,
        server_url: &str,
        token: &str,
    ) {
        info!("[Intercepted] Preparing to E2EE encrypt locally: Image {}x{}", image.width, image.height);

        let dk = DataKey::generate();

        #[derive(serde::Serialize)]
        struct ImageBinaryFormat<'a> {
            w: usize,
            h: usize,
            bytes: &'a [u8],
        }

        let payload = serde_json::to_vec(&ImageBinaryFormat {
            w: image.width,
            h: image.height,
            bytes: &image.bytes,
        }).unwrap();

        let enc_data = match dk.encrypt_binary(&payload) {
            Ok(d) => d,
            Err(e) => {
                error!("Failed to encrypt image payload: {:?}", e);
                return;
            }
        };

        let wrapped_dk = match mk.wrap_dk(&dk) {
            Ok(w) => w,
            Err(e) => {
                error!("Failed to wrap DataKey: {:?}", e);
                return;
            }
        };

        let enc_bytes = serde_json::to_vec(&enc_data).unwrap();
        let mut http_base = server_url.replace("ws://", "http://").replace("wss://", "https://");
        if http_base.ends_with("/api/v1/ws") {
            http_base = http_base.replace("/api/v1/ws", "");
        }
        let url = format!("{}/api/v1/sync/blob", http_base);

        let res = match http_client.post(&url).bearer_auth(token).body(enc_bytes).send().await {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to upload encrypted image blob: {}", e);
                return;
            }
        };

        if !res.status().is_success() {
            error!("Image upload failed with status: {}", res.status());
            return;
        }

        #[derive(serde::Deserialize)]
        struct UploadRes {
            data: Option<serde_json::Value>,
        }

        let uuid = if let Ok(u_res) = res.json::<UploadRes>().await {
            if let Some(d) = u_res.data {
                d["uuid"].as_str().unwrap_or("").to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        if uuid.is_empty() {
            error!("No UUID received from image upload");
            return;
        }

        let payload = serde_json::json!({
            "type": "image",
            "blob_uuid": uuid,
            "wrapped_key": wrapped_dk
        });

        let msg = WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: vec![],
            r#type: "clipboard_update".to_string(),
            payload,
        };

        if let Err(e) = tx.send(msg).await {
            error!("Failed to dispatch image over WS channel: {}", e);
        } else {
            info!("Successfully dispatched encrypted image to WS channel.");
            if let Some(chan) = ui_tx {
                let _ = chan.send(ClipboardEvent {
                    status: "sent".to_string(),
                    preview: Self::generate_thumbnail_base64(&image),
                }).await;
            }
        }
    }

    pub fn start_receiving(&self, mut rx: mpsc::Receiver<WsMessage>) {
        let last_text_ref = Arc::clone(&self.last_text);
        let last_image_hash_ref = Arc::clone(&self.last_image_hash);
        let mk = Arc::clone(&self.master_key);
        let ui_tx = self.ui_tx.clone();
        let client = self.http_client.clone();
        let srv_url = self.server_url.clone();
        let tok = self.token.clone();
        let ws_tx = self.ws_tx.clone();

        tokio::spawn(async move {
            info!("Clipboard receiving daemon started.");
            while let Some(msg) = rx.recv().await {
                if msg.r#type == "clipboard_update" {
                    let (is_sync_enabled, _, _, _) = crate::config::get_settings();
                    if !is_sync_enabled {
                        continue;
                    }

                    let format_type = msg.payload["type"].as_str().unwrap_or("text");

                    if format_type == "text" {
                        // Extract wrapped key and encrypted data
                        let wrapped_dk_val = &msg.payload["wrapped_key"];
                        let enc_data_val = &msg.payload["encrypted_data"];

                        if wrapped_dk_val.is_null() || enc_data_val.is_null() {
                            error!("Missing encrypted payload fields");
                            continue;
                        }

                        // Parse wrapped DK and enc data to proper types
                        let wrapped_dk: crate::crypto::WrappedDataKey = match serde_json::from_value(wrapped_dk_val.clone()) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to parse wrapped key: {}", e); continue; }
                        };
                        
                        let enc_data: crate::crypto::EncryptedData = match serde_json::from_value(enc_data_val.clone()) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to parse enc data: {}", e); continue; }
                        };

                        // Unwrap DK using MK
                        let dk = match mk.unwrap_dk(&wrapped_dk) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to unwrap DK: {:?}", e); continue; }
                        };

                        // Decrypt Payload using DK
                        let plaintext = match dk.decrypt_payload(&enc_data) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to decrypt payload: {:?}", e); continue; }
                        };

                        info!("Successfully decrypted incoming clipboard (len {}). Setting OS clipboard...", plaintext.len());

                        crate::cache::record_clipboard_text(&plaintext, "sync");

                        // Set text with loopback protection
                        {
                            let mut last = last_text_ref.lock().unwrap();
                            *last = plaintext.clone();
                        }

                        if Self::try_set_clipboard_text(&plaintext, 5, Duration::from_millis(100)).await {
                            if let Some(chan) = ui_tx.as_ref() {
                                let _ = chan.send(ClipboardEvent {
                                    status: "received".to_string(),
                                    preview: plaintext.clone(),
                                }).await;
                            }
                        } else {
                            error!("Failed to set clipboard text after retries (received sync).");
                        }
                    } else if format_type == "image" {
                        let uuid = msg.payload["blob_uuid"].as_str().unwrap_or("");
                        let wrapped_dk_val = &msg.payload["wrapped_key"];
                        
                        if uuid.is_empty() || wrapped_dk_val.is_null() {
                            error!("Missing image payload fields");
                            continue;
                        }

                        let wrapped_dk: crate::crypto::WrappedDataKey = match serde_json::from_value(wrapped_dk_val.clone()) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to parse wrapped key: {}", e); continue; }
                        };

                        let dk = match mk.unwrap_dk(&wrapped_dk) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to unwrap DK: {:?}", e); continue; }
                        };

                        let mut http_base = srv_url.replace("ws://", "http://").replace("wss://", "https://");
                        if http_base.ends_with("/api/v1/ws") {
                            http_base = http_base.replace("/api/v1/ws", "");
                        }
                        let url = format!("{}/api/v1/sync/blob/{}", http_base, uuid);

                        let res = match client.get(&url).bearer_auth(&tok).send().await {
                            Ok(r) => r,
                            Err(e) => {
                                error!("Failed to download image: {}", e);
                                continue;
                            }
                        };

                        if !res.status().is_success() {
                            error!("Image download failed: {}", res.status());
                            continue;
                        }

                        let enc_bytes = match res.bytes().await {
                            Ok(b) => b,
                            Err(e) => { error!("Failed to read image bytes: {}", e); continue; }
                        };

                        let enc_data: crate::crypto::EncryptedData = match serde_json::from_slice(&enc_bytes) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to parse downloaded encrypted data: {}", e); continue; }
                        };

                        let dec_bytes = match dk.decrypt_binary(&enc_data) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to decrypt image: {:?}", e); continue; }
                        };

                        #[derive(serde::Deserialize)]
                        struct ImageBinaryFormat {
                            w: usize,
                            h: usize,
                            bytes: Vec<u8>,
                        }

                        let img_data: ImageBinaryFormat = match serde_json::from_slice(&dec_bytes) {
                            Ok(v) => v,
                            Err(e) => { error!("Failed to parse decrypted image shape: {}", e); continue; }
                        };

                        {
                            let mut raw = Vec::with_capacity(16 + img_data.bytes.len());
                            raw.extend_from_slice(&(img_data.w as u64).to_le_bytes());
                            raw.extend_from_slice(&(img_data.h as u64).to_le_bytes());
                            raw.extend_from_slice(&img_data.bytes);
                            crate::cache::record_clipboard_image(&raw, "sync");
                        }

                        if let Ok(mut clipboard) = arboard::Clipboard::new() {
                            let arboard_img = arboard::ImageData {
                                width: img_data.w,
                                height: img_data.h,
                                bytes: std::borrow::Cow::Owned(img_data.bytes),
                            };
                            
                            let hash = Self::calculate_image_hash(&arboard_img);
                            {
                                let mut last = last_image_hash_ref.lock().unwrap();
                                *last = hash;
                            }

                            // Use a short-lived clipboard instance: open, write, release immediately
                            if let Err(e) = clipboard.set_image(arboard_img.clone()) {
                                error!("Failed to set arboard image clipboard: {}", e);
                            } else if let Some(chan) = ui_tx.as_ref() {
                                let preview = Self::generate_thumbnail_base64(&arboard_img);
                                let _ = chan.send(ClipboardEvent {
                                    status: "received".to_string(),
                                    preview,
                                }).await;
                            }
                        }
                    }
                } else if msg.r#type == "p2p_file_offer" {
                    if let Ok(offer) = serde_json::from_value::<crate::p2p::P2POffer>(msg.payload.clone()) {
                        let mut save_dir = std::env::temp_dir();
                        if let Some(dirs) = directories::UserDirs::new()
                            && let Some(dl) = dirs.download_dir() {
                                save_dir = dl.to_path_buf();
                            }
                        
                        crate::p2p::handle_p2p_offer(offer, save_dir).await;
                    } else {
                        error!("Failed to parse p2p_file_offer payload.");
                    }
                } else if msg.r#type == "history_request" {
                    info!("Received history_request from peer device");
                    let items = {
                        let history_lock = crate::cache::HISTORY_MANAGER.read().unwrap();
                        if let Some(history) = history_lock.as_ref() {
                            match history.get_today_entries() {
                                Ok(entries) => {
                                    let mut items = Vec::new();
                                    for e in &entries {
                                        let cache_lock = crate::cache::CACHE_MANAGER.read().unwrap();
                                        let data_val = if e.entry_type == "text" {
                                            cache_lock.as_ref().and_then(|c| c.read_text(&e.hash).ok())
                                                .map(|content| serde_json::json!({
                                                    "timestamp": e.timestamp,
                                                    "type": "text",
                                                    "hash": e.hash,
                                                    "content": content,
                                                }))
                                        } else {
                                            cache_lock.as_ref().and_then(|c| c.read_image(&e.hash).ok())
                                                .map(|data| {
                                                    use base64::{Engine as _, engine::general_purpose::STANDARD};
                                                    serde_json::json!({
                                                        "timestamp": e.timestamp,
                                                        "type": "image",
                                                        "hash": e.hash,
                                                        "data_b64": STANDARD.encode(&data),
                                                    })
                                                })
                                        };
                                        if let Some(val) = data_val {
                                            items.push(val);
                                        }
                                    }
                                    Some(items)
                                }
                                Err(e) => {
                                    error!("Failed to get today entries: {}", e);
                                    None
                                }
                            }
                        } else {
                            None
                        }
                    };
                    if let Some(items) = items {
                        let response = crate::ws::WsMessage {
                            sender_uid: 0,
                            sender_device_id: 0,
                            target_devices: vec![],
                            r#type: "history_response".to_string(),
                            payload: serde_json::json!({
                                "items": items,
                                "has_more": false,
                            }),
                        };
                        if let Err(e) = ws_tx.send(response).await {
                            error!("Failed to send history_response: {}", e);
                        } else {
                            info!("Sent history_response with {} items", items.len());
                        }
                    }
                } else if msg.r#type == "history_response" {
                    info!("Received history_response from peer device");
                    let items = match msg.payload["items"].as_array() {
                        Some(arr) => arr,
                        None => { error!("Invalid history_response: no items array"); continue; }
                    };
                    let mut imported = 0u32;
                    for item in items {
                        let entry_type = item["type"].as_str().unwrap_or("");
                        let hash = item["hash"].as_str().unwrap_or("");
                        let _timestamp = item["timestamp"].as_i64().unwrap_or(0);
                        if hash.is_empty() { continue; }

                        if entry_type == "text" {
                            if let Some(content) = item["content"].as_str() {
                                crate::cache::record_clipboard_text(content, "pull");
                                imported += 1;
                            }
                        } else if entry_type == "image" {
                            if let Some(data_b64) = item["data_b64"].as_str() {
                                use base64::{Engine as _, engine::general_purpose::STANDARD};
                                if let Ok(data) = STANDARD.decode(data_b64) {
                                    crate::cache::record_clipboard_image(&data, "pull");
                                    imported += 1;
                                }
                            }
                        }
                    }
                    info!("Imported {} history items from peer", imported);
                    if let Some(chan) = ui_tx.as_ref() {
                        let _ = chan.send(ClipboardEvent {
                            status: "history_pulled".to_string(),
                            preview: format!("Imported {} items", imported),
                        }).await;
                    }
                }
            }
        });
    }
}
