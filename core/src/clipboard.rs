use crate::crypto::{DataKey, MasterKey};
use crate::ws::WsMessage;
use arboard::Clipboard;
use log::{error, info};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::sleep;

#[derive(serde::Serialize, Clone, Debug)]
pub struct ClipboardEvent {
    pub status: String,
    pub preview: String,
}

/// Holds the last grabbed clipboard string to prevent infinite duplicate sync loops
pub struct ClipboardMonitor {
    last_text: Arc<Mutex<String>>,
    master_key: Arc<MasterKey>,
    ws_tx: mpsc::Sender<WsMessage>,
    ui_tx: Option<mpsc::Sender<ClipboardEvent>>,
}

impl ClipboardMonitor {
    pub fn new(master_key: Arc<MasterKey>, ws_tx: mpsc::Sender<WsMessage>, ui_tx: Option<mpsc::Sender<ClipboardEvent>>) -> Self {
        Self {
            last_text: Arc::new(Mutex::new(String::new())),
            master_key,
            ws_tx,
            ui_tx,
        }
    }

    /// Spawns an asynchronous background task that polls the system clipboard
    /// for text changes and dispatches them via Tokio channel or directly returns logic.
    pub fn start_polling(&self) {
        let last_text_ref = Arc::clone(&self.last_text);
        let mk = Arc::clone(&self.master_key);
        let tx = self.ws_tx.clone();
        let ui_tx = self.ui_tx.clone();

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
                        let (_, is_sync_enabled) = crate::config::get_settings();
                        if is_sync_enabled {
                            Self::secure_dispatch(&current_text, &mk, &tx, &ui_tx).await;
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

    pub fn start_receiving(&self, mut rx: mpsc::Receiver<WsMessage>) {
        let last_text_ref = Arc::clone(&self.last_text);
        let mk = Arc::clone(&self.master_key);
        let ui_tx = self.ui_tx.clone();

        tokio::spawn(async move {
            info!("Clipboard receiving daemon started.");
            while let Some(msg) = rx.recv().await {
                if msg.r#type == "clipboard_update" {
                    let (_, is_sync_enabled) = crate::config::get_settings();
                    if !is_sync_enabled {
                        continue;
                    }

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
                }
            }
        });
    }
}
