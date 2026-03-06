use std::sync::Mutex;
use serde::Serialize;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum WriterEvent {
    TextSelected { text: String, x: i32, y: i32 },
    TextCopied { text: String },
    Hide,
}

lazy_static::lazy_static! {
    pub static ref WRITER_TX: Mutex<Option<std::sync::mpsc::Sender<WriterEvent>>> = Mutex::new(None);
    pub static ref LAST_HOTKEY_TRIGGER_TIME: Mutex<Option<Instant>> = Mutex::new(None);
}

#[allow(dead_code)]
pub fn set_writer_tx(tx: std::sync::mpsc::Sender<WriterEvent>) {
    *WRITER_TX.lock().unwrap() = Some(tx);
}

pub fn send_writer_event(event: WriterEvent) {
    if let Some(tx) = WRITER_TX.lock().unwrap().as_ref() {
        let _ = tx.send(event);
    }
}
