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
            "你是一个纯粹的文本处理引擎。请润色以下文本，修正语法错误，提升可读性。你必须绝对遵守以下规则：1. 仅输出润色后的文本。2. 绝对不能有任何开场白或结尾语（例如“好的”、“没问题”、“优化后的返回文本是”）。3. 不要解释你的修改。4. 不要使用 markdown 标签包裹返回内容。直接开始输出内容：".to_string(),
        PromptAction::Expand { ratio } => 
            format!("你是一个发散扩写引擎。将文本扩写约为 {} 倍。必须绝对遵循：1. 仅输出扩写结果。2. 不能有任何寒暄、废话、解释。3. 直接开始内容，不要用 markdown。", ratio),
        PromptAction::Condense { ratio } => {
            let desc = if ratio == "one_sentence" { "一句话总结".to_string() } else { format!("原来的 {}", ratio) };
            format!("你是一个文本压缩引擎。请缩写至{}。必须绝对遵循：1. 仅输出截短后的内容。2. 绝对不能有任何开场白、结尾语。3. 不要做任何解释。直接输出：", desc)
        },
        PromptAction::Summarize => 
            "请提取核心要点，用简单的无序列表格式。你必须绝对遵守：1. 不能有“好的”、“这是总结”等废话。2. 仅输出结果：".to_string(),
        PromptAction::Style { style } => 
            format!("将文本改写为“{}”风格。绝对遵循：1. 不要解释。2. 不要寒暄。3. 仅输出改写完成的纯文本：", style),
        PromptAction::Translate { target_lang } => 
            format!("将文本翻译为“{}”。绝对遵循：1. 仅输出翻译后的文本。2. 不能解释你的翻译。3. 不要任何寒暄：", target_lang),
        PromptAction::Explain => 
            "分析并解释以下内容。直接开始解释，不要有“好的，我将解释”等无意义废话，直接切入正题：".to_string(),
        PromptAction::Custom { template_id } => {
            let cfg = CUSTOM_PROMPTS.read().unwrap();
            if let Some(p) = cfg.custom_prompts.iter().find(|p| p.id == *template_id) {
                p.system_message.clone()
            } else {
                "你是一个AI助理，请处理以下文本。".to_string() // Fallback
            }
        }
    };

    // Small models (Qwen 0.5B, Gemma 270M etc.) do NOT understand multi-role
    // conversations well. We merge the system instruction + user text into a
    // single user message with explicit structural markers so the model cannot
    // mistake the user text for a chat request.
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
