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
            last_text: Arc::new(Mutex::new(String::new())),
            last_image_hash: Arc::new(Mutex::new(0)),
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
        let width = image_data.width as u32;
        let height = image_data.height as u32;

        if let Some(img_buffer) = image::RgbaImage::from_raw(width, height, image_data.bytes.to_vec()) {
            let dyn_img = DynamicImage::ImageRgba8(img_buffer);
            let thumb = dyn_img.thumbnail(200, 200);
            let mut buf = std::io::Cursor::new(Vec::new());
            if thumb.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                let encoded = STANDARD.encode(buf.into_inner());
                return format!("data:image/png;base64,{}", encoded);
            }
        }
        format!("[Image {}x{}]", width, height)
    }

    /// Spawns an asynchronous background task that polls the system clipboard
    /// for text changes and dispatches them via Tokio channel or directly returns logic.
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
            info!("Clipboard monitoring daemon started (polling mode).");

            let mut clipboard = match Clipboard::new() {
                Ok(cb) => cb,
                Err(e) => {
                    error!("Failed to initialize clipboard manager: {}", e);
                    return;
                }
            };

            loop {
                // Poll every 1 second (adjust based on performance needs, Windows hooks are better
                // but arboard polling is universally cross-platform rust-native)
                sleep(Duration::from_secs(1)).await;

                if let Ok(current_text) = clipboard.get_text() {
                    let should_dispatch = {
                        let mut last = last_text_ref.lock().unwrap();
                        if current_text != *last && !current_text.is_empty() {
                            info!(
                                "Clipboard text changed. Length: {} chars",
                                current_text.len()
                            );
                            *last = current_text.clone();
                            true
                        } else {
                            false
                        }
                    };

                    if should_dispatch {
                        let (is_sync_enabled, _, _) = crate::config::get_settings();
                        if is_sync_enabled {
                            Self::secure_dispatch(&current_text, &mk, &tx, &ui_tx).await;
                        }
                    }
                } else if let Ok(current_image) = clipboard.get_image() {
                    let hash = Self::calculate_image_hash(&current_image);
                    let should_dispatch = {
                        let mut last = last_image_hash_ref.lock().unwrap();
                        if hash != *last {
                            info!("Clipboard image changed. hash: {}", hash);
                            *last = hash;
                            true
                        } else {
                            false
                        }
                    };

                    if should_dispatch {
                        let (is_sync_enabled, _, _) = crate::config::get_settings();
                        if is_sync_enabled {
                            Self::secure_dispatch_image(current_image, &mk, &tx, &ui_tx, &client, &srv_url, &tok).await;
                        }
                    }
                }
            }
        });
    }

    async fn secure_dispatch(plaintext: &str, mk: &MasterKey, tx: &mpsc::Sender<WsMessage>, ui_tx: &Option<mpsc::Sender<ClipboardEvent>>) {
        let preview = if plaintext.len() > 15 {
            format!("{}...", &plaintext[..15])
        } else {
            plaintext.to_string()
        };
        info!(
            "[Intercepted] Preparing to E2EE encrypt locally: {:?}",
            preview
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
                    preview: preview.clone(),
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

        tokio::spawn(async move {
            info!("Clipboard receiving daemon started.");
            while let Some(msg) = rx.recv().await {
                if msg.r#type == "clipboard_update" {
                    let (is_sync_enabled, _, _) = crate::config::get_settings();
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

                        // Set text with loopback protection
                        {
                            let mut last = last_text_ref.lock().unwrap();
                            *last = plaintext.clone();
                        } // MutexGuard is dropped here before await!

                        if let Ok(mut clipboard) = arboard::Clipboard::new() {
                            if let Err(e) = clipboard.set_text(plaintext.clone()) {
                                error!("Failed to set arboard clipboard: {}", e);
                            } else {
                                if let Some(chan) = ui_tx.as_ref() {
                                    let preview = if plaintext.len() > 15 { format!("{}...", &plaintext[..15]) } else { plaintext.clone() };
                                    let _ = chan.send(ClipboardEvent {
                                        status: "received".to_string(),
                                        preview,
                                    }).await;
                                }
                            }
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

                            if let Err(e) = clipboard.set_image(arboard_img.clone()) {
                                error!("Failed to set arboard image clipboard: {}", e);
                            } else {
                                if let Some(chan) = ui_tx.as_ref() {
                                    let preview = Self::generate_thumbnail_base64(&arboard_img);
                                    let _ = chan.send(ClipboardEvent {
                                        status: "received".to_string(),
                                        preview,
                                    }).await;
                                }
                            }
                        }
                    }
                } else if msg.r#type == "p2p_file_offer" {
                    if let Ok(offer) = serde_json::from_value::<crate::p2p::P2POffer>(msg.payload.clone()) {
                        let mut save_dir = std::env::temp_dir();
                        if let Some(dirs) = directories::UserDirs::new() {
                            if let Some(dl) = dirs.download_dir() {
                                save_dir = dl.to_path_buf();
                            }
                        }
                        
                        crate::p2p::handle_p2p_offer(offer, save_dir).await;
                    } else {
                        error!("Failed to parse p2p_file_offer payload.");
                    }
                }
            }
        });
    }
}
