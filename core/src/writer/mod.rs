use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use serde::Serialize;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum WriterEvent {
    TextSelected { text: String, x: i32, y: i32 },
    TextCopied { text: String },
    MoveWindow { x: i32, y: i32 },
    Hide,
}

lazy_static::lazy_static! {
    pub static ref WRITER_TX: Mutex<Option<std::sync::mpsc::Sender<WriterEvent>>> = Mutex::new(None);
    pub static ref LAST_HOTKEY_TRIGGER_TIME: Mutex<Option<Instant>> = Mutex::new(None);
}

/// Atomic flag: is the writer window currently visible?
/// Set by the Rust event loop when Show/Hide events fire.
pub static WRITER_VISIBLE: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
pub fn set_writer_tx(tx: std::sync::mpsc::Sender<WriterEvent>) {
    *WRITER_TX.lock().unwrap() = Some(tx);
}

pub fn send_writer_event(event: WriterEvent) {
    if let Some(tx) = WRITER_TX.lock().unwrap().as_ref() {
        let _ = tx.send(event);
    }
}
