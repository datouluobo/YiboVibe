use crate::ai::client::ChatMessage;
use serde::{Deserialize, Serialize};
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
    if path.exists()
        && let Ok(content) = fs::read_to_string(&path)
            && let Ok(cfg) = serde_json::from_str(&content) {
                return cfg;
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
            "你是一个专业的文本润色专家。请对文本进行润色，修正语法错误，提升可读性。规则：1. 直接输出润色后的结果。2. 绝对禁止输出任何开场白、结尾语或解释。".to_string(),
        PromptAction::Expand { ratio } => 
            format!("你是一个发散扩写专家。请将文本扩写约为原来的 {} 倍。规则：1. 直接输出结果。2. 禁止废话。", ratio),
        PromptAction::Condense { ratio } => {
            let desc = if ratio == "one_sentence" { "一句话精炼" } else { ratio };
            format!("你是一个文本精简专家。请将文本压缩至{}。规则：1. 直接输出结果。2. 禁止解释。", desc)
        },
        PromptAction::Summarize => 
            "你是一个专业的文本总结专家。请提取核心要义。规则：1. 如果内容较长，请分条列出要点；如果内容较短，请归纳总结。2. 直接输出结果。3. 禁止任何废话说明。".to_string(),
        PromptAction::Style { style } => 
            format!("你是一个文风改写专家。请将文本改写为“{}”风格。要求：直接输出结果，禁止任何解释说明。", style),
        PromptAction::Translate { target_lang } => 
            format!("你是一个精准的翻译专家。请将以下文本精准翻译为“{}”。要求：直接输出结果，保持语气自然、内容真实。", target_lang),
        PromptAction::Explain => 
            "你是一个知识渊博的专业助手。请分析并解释以下内容。要求：直接开始解释，严禁任何形式的客套话或前置废话。".to_string(),
        PromptAction::Custom { template_id } => {
            let cfg = CUSTOM_PROMPTS.read().unwrap();
            cfg.custom_prompts.iter()
                .find(|p| p.id == *template_id)
                .map(|p| p.system_message.clone())
                .unwrap_or_else(|| "你是一个AI助理，请处理以下文本。".to_string())
        }
    };

    // 极致兼容方案：合并为单条 User 消息
    let combined = format!(
        "<instruction>\n{}\n</instruction>\n\n<input>\n{}\n</input>\n\n<output>\n",
        system_message,
        user_input
    );

    vec![
        ChatMessage {
            role: "user".to_string(),
            content: combined,
        },
    ]
}
