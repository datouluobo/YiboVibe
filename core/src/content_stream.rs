use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ContentStreamEntryKind {
    Text,
    Image,
    File,
    Bundle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentStreamEntryStub {
    pub kind: ContentStreamEntryKind,
    pub auto_sync: bool,
}

impl ContentStreamEntryStub {
    pub fn new(kind: ContentStreamEntryKind) -> Self {
        Self {
            kind,
            auto_sync: false,
        }
    }
}
