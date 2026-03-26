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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StandardPrompts {
    pub polish: String,
    pub expand: String,
    pub condense: String,
    pub summarize: String,
    pub style: String,
    pub translate: String,
    pub explain: String,
}

impl Default for StandardPrompts {
    fn default() -> Self {
        Self {
            polish: "你是一个资深文学编辑。请对文本进行深度润色：维护原意、修正语法、优化句式，并严格保留所有 Markdown 标记及代码块。规则：1. 直接输出润色后的结果。2. 绝对禁止输出任何开场白、分析、备注。".to_string(),
            expand: "你是一个内容创作专家。请将以下文本通过增加细节、案例或逻辑推导，合理扩写约为原来的 {ratio} 倍。要求：1. 保持原有意图与风格。2. 直接输出扩写后的文本，严禁包含任何指令性废话。".to_string(),
            condense: "你是一个信息提炼专家。请将文本精简至 {ratio}。要求：1. 去芜存菁，保留核心逻辑与关键事实。2. 直接输出精简结果，绝对禁止任何额外解释。".to_string(),
            summarize: "你是一位专业的首席摘要官。请提取文本核心。要求：1. 若内容较长请分条列出重点；若内容较短则进行高度归纳。2. 直接由摘要内容开始，严禁任何形式的引导语。".to_string(),
            style: "你是一位全能的文案策划。请将输入文本改写为“{style}”风格。要求：1. 从语感、用词、句式上深度适配。2. 直接输出改写结果，禁止输出开场白或解释。".to_string(),
            translate: "你是一个极其精准的翻译专家。请将文本精准翻译为“{target_lang}”。要求：1. 译文风格需符合该国语言的文化语境。2. 强制保留所有 Markdown 标签、代码块、数学公式等特殊格式。3. 绝对只输出译文本身。".to_string(),
            explain: "你是一位博学且善于化繁为简的专业导师。请深度解析以下内容。要求：1. 采用结构化方式（如要点说明或类比）提高理解效率。2. 严禁客套话，第一句直接进入正文。".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct CustomPromptsConfig {
    pub custom_prompts: Vec<CustomPromptTemplate>,
    pub custom_languages: Vec<String>,
    #[serde(default)]
    pub standard_prompts: StandardPrompts,
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
            if let Ok(cfg) = serde_json::from_str::<CustomPromptsConfig>(&content) {
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
        standard_prompts: StandardPrompts::default(),
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

pub fn update_standard_prompts(prompts: StandardPrompts) -> Result<(), String> {
    let mut cfg = CUSTOM_PROMPTS.write().map_err(|e| e.to_string())?;
    cfg.standard_prompts = prompts;
    save_custom_prompts_inner(&cfg);
    Ok(())
}

pub fn reset_standard_prompts() -> Result<(), String> {
    let mut cfg = CUSTOM_PROMPTS.write().map_err(|e| e.to_string())?;
    cfg.standard_prompts = StandardPrompts::default();
    save_custom_prompts_inner(&cfg);
    Ok(())
}

pub fn build_messages(action: &PromptAction, user_input: &str) -> Vec<ChatMessage> {
    let cfg_lock = CUSTOM_PROMPTS.read().unwrap();
    let std = &cfg_lock.standard_prompts;
    
    let system_message = match action {
        PromptAction::Polish => std.polish.clone(),
        PromptAction::Expand { ratio } => std.expand.replace("{ratio}", &ratio.to_string()),
        PromptAction::Condense { ratio } => {
            let desc = if ratio == "one_sentence" { "一句话精炼" } else { ratio };
            std.condense.replace("{ratio}", desc)
        },
        PromptAction::Summarize => std.summarize.clone(),
        PromptAction::Style { style } => std.style.replace("{style}", style),
        PromptAction::Translate { target_lang } => std.translate.replace("{target_lang}", target_lang),
        PromptAction::Explain => std.explain.clone(),
        PromptAction::Custom { template_id } => {
            cfg_lock.custom_prompts.iter()
                .find(|p| p.id == *template_id)
                .map(|p| p.system_message.clone())
                .unwrap_or_else(|| "你是一个AI助理，请处理以下文本。".to_string())
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
