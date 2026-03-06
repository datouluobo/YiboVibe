use crate::config::{AiEndpoint, AiProvider, AiEngineConfig};
use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use std::sync::{Arc, RwLock};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use tokio::sync::mpsc;
use log::{info, error, warn};

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

lazy_static::lazy_static! {
    static ref ACTIVE_ENDPOINT: Arc<RwLock<Option<AiEndpoint>>> = Arc::new(RwLock::new(None));
}

pub struct AiClient {
    http_client: Client,
    config: AiEngineConfig,
}

impl AiClient {
    pub fn new(config: AiEngineConfig) -> Self {
        // Fallback value for timeout_ms to avoid panic if configured to 0
        let ms = if config.timeout_ms == 0 { 30000 } else { config.timeout_ms };
        let client = Client::builder()
            .timeout(Duration::from_millis(ms))
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
        // Light probe: try to hit base_url /models
        let mut root_url = endpoint.base_url.clone();
        if root_url.ends_with("/chat/completions") {
            root_url = root_url.replace("/chat/completions", "/models");
        } else if root_url.ends_with("/v1") {
            root_url = format!("{}/models", root_url);
        } else {
            root_url = format!("{}/models", root_url); // basic heuristic
        }

        let mut request = self.http_client.get(&root_url);
        if !endpoint.api_key.is_empty() {
            request = request.header(header::AUTHORIZATION, format!("Bearer {}", endpoint.api_key));
        }

        let _res = request.send().await?;
        // Any response (even 401 unauth) proves connectivity
        Ok(start.elapsed().as_millis() as u64)
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
            temperature: Some(0.7),
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
                    
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                        if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                            if let Some(choice) = choices.first() {
                                if let Some(delta) = choice.get("delta") {
                                    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                        let _ = tx.send(Ok(content.to_string())).await;
                                    }
                                }
                            }
                        }
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
