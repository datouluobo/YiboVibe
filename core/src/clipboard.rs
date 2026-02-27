use crate::crypto::{DataKey, MasterKey};
use crate::ws::WsMessage;
use arboard::Clipboard;
use log::{error, info};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::sleep;

/// Holds the last grabbed clipboard string to prevent infinite duplicate sync loops
pub struct ClipboardMonitor {
    last_text: Arc<Mutex<String>>,
    master_key: Arc<MasterKey>,
    ws_tx: mpsc::Sender<WsMessage>,
}

impl ClipboardMonitor {
    pub fn new(master_key: Arc<MasterKey>, ws_tx: mpsc::Sender<WsMessage>) -> Self {
        Self {
            last_text: Arc::new(Mutex::new(String::new())),
            master_key,
            ws_tx,
        }
    }

    /// Spawns an asynchronous background task that polls the system clipboard
    /// for text changes and dispatches them via Tokio channel or directly returns logic.
    pub fn start_polling(&self) {
        let last_text_ref = Arc::clone(&self.last_text);
        let mk = Arc::clone(&self.master_key);
        let tx = self.ws_tx.clone();

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
                        Self::secure_dispatch(&current_text, &mk, &tx).await;
                    }
                }
            }
        });
    }

    async fn secure_dispatch(plaintext: &str, mk: &MasterKey, tx: &mpsc::Sender<WsMessage>) {
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
        }
    }
}
