/// State-Aware Action Bar protocol
/// Defines the action cards and confirmation protocol for remote control.
/// Maps session/agent state to available actions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActionLevel {
    Info,
    Normal,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionCard {
    pub id: String,
    pub label: String,
    pub description: String,
    pub level: ActionLevel,
    pub requires_confirm: bool,
    pub action_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionBarState {
    pub actions: Vec<ActionCard>,
    pub pending_confirmation: Vec<ActionCard>,
}

impl ActionBarState {
    pub fn new() -> Self {
        ActionBarState {
            actions: Vec::new(),
            pending_confirmation: Vec::new(),
        }
    }

    pub fn add_action(&mut self, action: ActionCard) {
        if action.requires_confirm {
            self.pending_confirmation.push(action);
        } else {
            self.actions.push(action);
        }
    }

    pub fn confirm(&mut self, action_id: &str) -> Option<ActionCard> {
        if let Some(pos) = self.pending_confirmation.iter().position(|a| a.id == action_id) {
            Some(self.pending_confirmation.remove(pos))
        } else {
            None
        }
    }

    pub fn reject(&mut self, action_id: &str) {
        self.pending_confirmation.retain(|a| a.id != action_id);
    }

    pub fn clear(&mut self) {
        self.actions.clear();
        self.pending_confirmation.clear();
    }
}
