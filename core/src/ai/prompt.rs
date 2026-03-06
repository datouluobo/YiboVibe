use crate::ai::client::ChatMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum PromptAction {
    Polish,
    Expand { ratio: f32 },
    Condense { ratio: String },
    Summarize,
    Style { style: String },
    Translate { target_lang: String },
    Explain,
    Custom { template_id: String },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CustomPromptTemplate {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub system_message: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct CustomPromptsConfig {
    pub custom_prompts: Vec<CustomPromptTemplate>,
    pub custom_languages: Vec<String>,
}

lazy_static::lazy_static! {
    static ref CUSTOM_PROMPTS: std::sync::RwLock<CustomPromptsConfig> = std::sync::RwLock::new(load_custom_prompts());
}

fn get_prompts_file_path() -> PathBuf {
    let mut path = crate::local_auth::get_active_user_dir();
    path.push("ai_prompts.json");
    path
}

pub fn load_custom_prompts() -> CustomPromptsConfig {
    let path = get_prompts_file_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str(&content) {
                return cfg;
            }
        }
    }
    let default_cfg = CustomPromptsConfig {
        custom_prompts: Vec::new(),
        custom_languages: vec![
            "英语".to_string(),
            "日语".to_string(),
            "韩语".to_string(),
            "法语".to_string(),
        ],
    };
    save_custom_prompts_inner(&default_cfg);
    default_cfg
}

fn save_custom_prompts_inner(cfg: &CustomPromptsConfig) {
    let path = get_prompts_file_path();
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(path, json);
    }
}

pub fn get_custom_prompts_config() -> CustomPromptsConfig {
    CUSTOM_PROMPTS.read().unwrap().clone()
}

pub fn add_custom_prompt(prompt: CustomPromptTemplate) -> Result<(), String> {
    let mut cfg = CUSTOM_PROMPTS.write().map_err(|e| e.to_string())?;
    cfg.custom_prompts.retain(|p| p.id != prompt.id);
    cfg.custom_prompts.push(prompt);
    save_custom_prompts_inner(&cfg);
    Ok(())
}

pub fn remove_custom_prompt(id: &str) -> Result<(), String> {
    let mut cfg = CUSTOM_PROMPTS.write().map_err(|e| e.to_string())?;
    cfg.custom_prompts.retain(|p| p.id != id);
    save_custom_prompts_inner(&cfg);
    Ok(())
}

pub fn build_messages(action: &PromptAction, user_input: &str) -> Vec<ChatMessage> {
    let system_message = match action {
        PromptAction::Polish => 
            "你是一个专业的文本编辑引擎。请优化以下文本的措辞、修正语法错误，整体提升可读性，但必须保持原意不变。直接返回润色后的文本，不要输出任何其他的解释或对话标签。".to_string(),
        PromptAction::Expand { ratio } => 
            format!("你是一个能够发散思维的扩写引擎。请将下文扩写为原来的 {} 倍左右。在保持整体主题和逻辑的前提下，补充更丰富的细节、背景或论据。直接输出扩写后的文本，不要带有其它赘述。", ratio),
        PromptAction::Condense { ratio } => {
            let desc = if ratio == "one_sentence" {
                "一句话总结".to_string()
            } else {
                format!("原来的 {}", ratio)
            };
            format!("你是一个精练的文本压缩引擎。请剔除以下文本的冗余信息，将其缩写至{}，但必须保留所有的核心要点和关键信息。直接输出缩写后的内容。", desc)
        },
        PromptAction::Summarize => 
            "你是一个要点提取引擎。请提取以下文本的核心要点，以简洁的无序条目（Bullet Points）形式列出。直接输出要点，无需开场白。".to_string(),
        PromptAction::Style { style } => 
            format!("你是一个深谙各种文风的作家。请将以下文本无缝改写为“{}”风格，确保语气和用词贴合该风格，但是不要改变客观信息和原意。直接返回风格转换后的文本。", style),
        PromptAction::Translate { target_lang } => 
            format!("你是一个精准度极高的多语言翻译引擎。请将以下文本翻译成“{}”。注意保持原文的语气、格式和专业术语的准确性。直接返回翻译后的内容，不要进行解释。", target_lang),
        PromptAction::Explain => 
            "你是一个知识渊博的分析助理。请详细解释以下内容（可能是代码、学术概念或由于语境不全而不容易理解的话语），用易懂的人类语言提供背景、含义及相关的要点补充。".to_string(),
        PromptAction::Custom { template_id } => {
            let cfg = CUSTOM_PROMPTS.read().unwrap();
            if let Some(p) = cfg.custom_prompts.iter().find(|p| p.id == *template_id) {
                p.system_message.clone()
            } else {
                "你是一个AI助理，请处理以下文本。".to_string() // Fallback
            }
        }
    };

    vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_message,
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_input.to_string(),
        },
    ]
}
