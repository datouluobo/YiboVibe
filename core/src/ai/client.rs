use crate::config::{AiEndpoint, AiProvider, AiEngineConfig};
use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use std::sync::{Arc, RwLock};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use tokio::sync::mpsc;
use log::{info, warn};

#[derive(Error, Debug)]
pub enum AiError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("No available endpoint")]
    NoEndpoint,
    #[error("Stream error")]
    StreamError,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatCompletionChoiceMessage {
    pub role: Option<String>,
    pub content: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatCompletionChoice {
    pub message: ChatCompletionChoiceMessage,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatCompletionResponse {
    pub choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize)]
struct OpenAiModel {
    id: String,
}

#[derive(Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModel>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

#[derive(Deserialize)]
struct OllamaModelsResponse {
    models: Vec<OllamaModel>,
}

lazy_static::lazy_static! {
    static ref ACTIVE_ENDPOINT: Arc<RwLock<Option<AiEndpoint>>> = Arc::new(RwLock::new(None));
}

pub struct AiClient {
    http_client: Client,
    config: AiEngineConfig,
}

impl AiClient {
    pub fn new(config: AiEngineConfig) -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .danger_accept_invalid_certs(true) // 关键：允许 NAS 的自签名或过期证书
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { http_client: client, config }
    }

    pub fn get_active_endpoint(&self) -> Option<AiEndpoint> {
        if !self.config.auto_mode {
            // Find highest priority enabled endpoint manually
            let mut enabled: Vec<_> = self.config.endpoints.iter().filter(|e| e.is_enabled).collect();
            enabled.sort_by_key(|e| e.priority);
            return enabled.first().map(|e| (*e).clone());
        }

        let cache = ACTIVE_ENDPOINT.read().unwrap();
        if let Some(ep) = &*cache {
            return Some(ep.clone());
        }
        None
    }

    pub async fn ensure_active_endpoint(&self) -> Result<AiEndpoint, AiError> {
        if let Some(ep) = self.get_active_endpoint() {
            return Ok(ep);
        }

        if !self.config.auto_mode {
            return Err(AiError::NoEndpoint);
        }

        // Auto mode probing
        let mut enabled: Vec<_> = self.config.endpoints.iter().filter(|e| e.is_enabled).clone().collect();
        enabled.sort_by_key(|e| e.priority);
        
        for ep in enabled {
            match self.probe(ep).await {
                Ok(latency) => {
                    info!("Probed {} successfully ({}ms)", ep.base_url, latency);
                    let mut lock = ACTIVE_ENDPOINT.write().unwrap();
                    *lock = Some(ep.clone());
                    return Ok(ep.clone());
                }
                Err(e) => {
                    warn!("Probing {} failed: {}", ep.base_url, e);
                }
            }
        }
        Err(AiError::NoEndpoint)
    }

    pub async fn probe(&self, endpoint: &AiEndpoint) -> Result<u64, AiError> {
        let start = std::time::Instant::now();
        
        let base_url = endpoint.base_url.trim_end_matches('/');
        let mut probe_urls = Vec::new();

        probe_urls.push(format!("{}/models", base_url));
        probe_urls.push(format!("{}/api/tags", base_url));
        probe_urls.push(format!("{}/api/version", base_url));
        probe_urls.push(base_url.to_string());

        if base_url.contains("/v1") {
            let stripped = base_url.replace("/v1", "");
            let s = stripped.trim_end_matches('/');
            if !s.is_empty() {
                probe_urls.push(format!("{}/models", s));
                probe_urls.push(format!("{}/api/tags", s));
                probe_urls.push(format!("{}/api/version", s));
                probe_urls.push(s.to_string());
            }
        }

        let mut last_status = None;

        for url in probe_urls {
            let request = if endpoint.api_key.is_empty() {
                self.http_client.get(&url)
            } else {
                self.http_client.get(&url).header(header::AUTHORIZATION, format!("Bearer {}", endpoint.api_key))
            };

            match request.timeout(Duration::from_millis(2500)).send().await {
                Ok(res) => {
                    let status = res.status();
                    if status.is_success() || status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::METHOD_NOT_ALLOWED {
                        return Ok(start.elapsed().as_millis() as u64);
                    }
                    last_status = Some(status);
                }
                Err(_) => continue,
            }
        }

        if let Some(status) = last_status {
            return Err(AiError::Api(format!("HTTP {} (服务器回复了但路径不对，请检查网关配置)", status)));
        }

        Err(AiError::NoEndpoint)
    }

    pub async fn list_models(&self, endpoint: &AiEndpoint) -> Result<Vec<String>, AiError> {
        let base_url = endpoint.base_url.trim_end_matches('/');
        let mut try_urls = Vec::new();

        // 构造候选路径池
        try_urls.push(format!("{}/models", base_url));
        try_urls.push(format!("{}/api/tags", base_url));
        
        if base_url.contains("/v1") {
            let s = base_url.replace("/v1", "").trim_end_matches('/').to_string();
            if !s.is_empty() {
                try_urls.push(format!("{}/models", s));
                try_urls.push(format!("{}/api/tags", s));
            }
        }

        for url in try_urls {
            info!("Fetching models from: {}", url);
            let mut request = self.http_client.get(&url).timeout(Duration::from_secs(6));
            if !endpoint.api_key.is_empty() {
                request = request.header(header::AUTHORIZATION, format!("Bearer {}", endpoint.api_key));
            }

            match request.send().await {
                Ok(res) => {
                    let status = res.status();
                    if status.is_success() {
                        if let Ok(text) = res.text().await {
                            // Try A: OpenAI
                            if let Ok(data) = serde_json::from_str::<OpenAiModelsResponse>(&text) {
                                let m: Vec<_> = data.data.into_iter().map(|it| it.id).collect();
                                if !m.is_empty() { return Ok(m); }
                            }
                            // Try B: Ollama
                            if let Ok(data) = serde_json::from_str::<OllamaModelsResponse>(&text) {
                                let m: Vec<_> = data.models.into_iter().map(|it| it.name).collect();
                                if !m.is_empty() { return Ok(m); }
                            }
                            info!("Model list response was empty or unrecognized: {}", text);
                        }
                    } else {
                        warn!("Fetch models failed: HTTP {}", status);
                    }
                }
                Err(e) => warn!("Request error to {}: {}", url, e),
            }
        }

        Err(AiError::Api("未检测到模型。如果刚重装了 Ollama，请先执行 ollama pull 下载模型。".into()))
    }

    pub async fn invalidate_active_endpoint() {
        let mut lock = ACTIVE_ENDPOINT.write().unwrap();
        *lock = None;
    }

    fn build_request_body(&self, endpoint: &AiEndpoint, messages: Vec<ChatMessage>) -> ChatCompletionRequest {
        if endpoint.provider == AiProvider::Anthropic {
            // Map roles for anthropic or custom logic here if needed, for Phase 1 we use basic compat layer.
        }
        ChatCompletionRequest {
            model: endpoint.model.clone(),
            messages,
            temperature: Some(0.3),
            max_tokens: Some(2048),
            stream: Some(false),
        }
    }

    pub async fn chat(&self, messages: Vec<ChatMessage>) -> Result<String, AiError> {
        let endpoint = self.ensure_active_endpoint().await?;
        let mut req_body = self.build_request_body(&endpoint, messages);
        req_body.stream = Some(false);

        let mut url = endpoint.base_url.clone();
        if !url.ends_with("/chat/completions") && !url.contains("generativelanguage") {
            url = format!("{}/chat/completions", url.trim_end_matches('/'));
        }

        let mut request = self.http_client.post(&url).json(&req_body);

        if !endpoint.api_key.is_empty() {
            request = request.header(header::AUTHORIZATION, format!("Bearer {}", endpoint.api_key));
        }

        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                Self::invalidate_active_endpoint().await;
                return Err(AiError::Network(e));
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            Self::invalidate_active_endpoint().await;
            return Err(AiError::Api(format!("{} - {}", status, text)));
        }

        let json_resp: ChatCompletionResponse = response.json().await?;
        if let Some(choice) = json_resp.choices.first() {
            Ok(choice.message.content.clone().unwrap_or_default())
        } else {
            Err(AiError::Api("Empty choices array from API".to_string()))
        }
    }

    pub async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        tx: mpsc::Sender<Result<String, AiError>>,
    ) {
        let endpoint = match self.ensure_active_endpoint().await {
            Ok(ep) => ep,
            Err(e) => {
                let _ = tx.send(Err(e)).await;
                return;
            }
        };

        let mut req_body = self.build_request_body(&endpoint, messages);
        req_body.stream = Some(true);

        let mut url = endpoint.base_url.clone();
        if !url.ends_with("/chat/completions") && !url.contains("generativelanguage") {
            url = format!("{}/chat/completions", url.trim_end_matches('/'));
        }

        info!("AI Stream Request -> URL: {}, Model: {}, Messages: {}", url, req_body.model, req_body.messages.len());

        let mut request = self.http_client.post(&url).json(&req_body);
        if !endpoint.api_key.is_empty() {
            request = request.header(header::AUTHORIZATION, format!("Bearer {}", endpoint.api_key));
        }

        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                Self::invalidate_active_endpoint().await;
                let _ = tx.send(Err(AiError::Network(e))).await;
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            Self::invalidate_active_endpoint().await;
            let _ = tx.send(Err(AiError::Api(format!("{} - {}", status, text)))).await;
            return;
        }

        let mut stream = response.bytes_stream().eventsource();

        while let Some(event) = stream.next().await {
            match event {
                Ok(ev) => {
                    let data = ev.data;
                    if data == "[DONE]" {
                        break;
                    }
                    if data.trim().is_empty() {
                        continue;
                    }
                    
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data)
                        && let Some(choices) = json.get("choices").and_then(|c| c.as_array())
                            && let Some(choice) = choices.first()
                                && let Some(delta) = choice.get("delta")
                                    && let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                        let _ = tx.send(Ok(content.to_string())).await;
                                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(AiError::Api(format!("Stream parse err: {:?}", e)))).await;
                    break;
                }
            }
        }
    }
}
