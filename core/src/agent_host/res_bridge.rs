/// Resource Bridge module
/// Bridges local files, NAS resources, clipboard content, and other assets
/// into agent sessions for processing or transfer.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResourceKind {
    File,
    Directory,
    ClipboardText,
    ClipboardImage,
    NasFile,
    Url,
    Snippet,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    pub kind: ResourceKind,
    pub name: String,
    pub size: Option<u64>,
    pub path: Option<String>,
    pub mime_type: Option<String>,
    pub checksum: Option<String>,
}

pub struct ResourceBridge {
    resources: std::sync::Mutex<Vec<Resource>>,
}

impl ResourceBridge {
    pub fn new() -> Self {
        ResourceBridge {
            resources: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn register(&self, resource: Resource) {
        if let Ok(mut r) = self.resources.lock() {
            r.push(resource);
        }
    }

    pub fn list(&self) -> Vec<Resource> {
        self.resources.lock()
            .map(|r| r.clone())
            .unwrap_or_default()
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut r) = self.resources.lock() {
            r.retain(|res| res.id != id);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut r) = self.resources.lock() {
            r.clear();
        }
    }
}
