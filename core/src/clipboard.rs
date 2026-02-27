use arboard::Clipboard;
use log::{error, info};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

/// Holds the last grabbed clipboard string to prevent infinite duplicate sync loops
pub struct ClipboardMonitor {
    last_text: Arc<Mutex<String>>,
}

impl ClipboardMonitor {
    pub fn new() -> Self {
        Self {
            last_text: Arc::new(Mutex::new(String::new())),
        }
    }

    /// Spawns an asynchronous background task that polls the system clipboard
    /// for text changes and dispatches them via Tokio channel or directly returns logic.
    pub fn start_polling(&self) {
        let last_text_ref = Arc::clone(&self.last_text);

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
                    let mut last = last_text_ref.lock().unwrap();

                    if current_text != *last && !current_text.is_empty() {
                        info!(
                            "Clipboard text changed. Length: {} chars",
                            current_text.len()
                        );
                        *last = current_text.clone();

                        // TODO: Here we should trigger the DK (DataKey) encryption and
                        // push it out via the WsClient channel we built earlier.
                        // For now, we just simulate intercepting it.
                        Self::simulate_secure_dispatch(&current_text);
                    }
                }
            }
        });
    }

    fn simulate_secure_dispatch(plaintext: &str) {
        let preview = if plaintext.len() > 15 {
            format!("{}...", &plaintext[..15])
        } else {
            plaintext.to_string()
        };
        info!(
            "[Intercepted] Preparing to E2EE encrypt locally: {:?}",
            preview
        );
    }
}
