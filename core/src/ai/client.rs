use crate::config::{AiEndpoint, AiEngineConfig};
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
        let timeout = Duration::from_millis(if config.timeout_ms > 0 { config.timeout_ms } else { 120000 }); // 增加默认宽容度至 120s
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .danger_accept_invalid_certs(true) 
            .connect_timeout(Duration::from_secs(12)) // 稍微延长连接超时
            .timeout(timeout) // 全局请求/读取超时
            .tcp_keepalive(Some(Duration::from_secs(60))) // 增加 TCP 保活
            .pool_idle_timeout(Duration::from_secs(90))   // 增加连接池保活
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { http_client: client, config }
    }

    pub fn get_active_endpoint(&self) -> Option<AiEndpoint> {
        if !self.config.auto_mode {
            // Find highest priority enabled endpoint manually
            let mut enabled: Vec<_> = self.config.endpoints.iter().filter(|e| e.is_enabled).map(|e| e.clone()).collect();
            enabled.sort_by_key(|e| e.priority);
            return enabled.first().cloned();
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
        let mut enabled: Vec<_> = self.config.endpoints.iter().filter(|e| e.is_enabled).cloned().collect();
        enabled.sort_by_key(|e| e.priority);
        
        for ep in enabled {
            match self.probe(&ep).await {
                Ok(latency) => {
                    info!("[AI-Probe] {} successful ({}ms)", ep.base_url, latency);
                    let mut lock = ACTIVE_ENDPOINT.write().unwrap();
                    *lock = Some(ep.clone());
                    return Ok(ep.clone());
                }
                Err(e) => {
                    warn!("[AI-Probe] {} failed: {}", ep.base_url, e);
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

            // Use a slightly longer timeout for NAS/Remote endpoints
            match request.timeout(Duration::from_millis(3500)).send().await {
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
            let mut request = self.http_client.get(&url).timeout(Duration::from_secs(10));
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

        Err(AiError::Api("未检测到模型。请检查接口地址或网络。".into()))
    }

    pub async fn invalidate_active_endpoint() {
        let mut lock = ACTIVE_ENDPOINT.write().unwrap();
        *lock = None;
    }

    fn build_request_body(&self, endpoint: &AiEndpoint, messages: Vec<ChatMessage>) -> ChatCompletionRequest {
        ChatCompletionRequest {
            model: endpoint.model.clone(),
            messages,
            temperature: Some(0.3),
            max_tokens: Some(4096),
            stream: Some(false),
        }
    }

    pub async fn chat(&self, messages: Vec<ChatMessage>) -> Result<String, AiError> {
        let mut endpoints = self.config.endpoints.iter().filter(|e| e.is_enabled).cloned().collect::<Vec<_>>();
        endpoints.sort_by_key(|e| e.priority);

        if endpoints.is_empty() {
            return Err(AiError::NoEndpoint);
        }

        let mut last_err = AiError::NoEndpoint;

        for endpoint in endpoints {
            let mut req_body = self.build_request_body(&endpoint, messages.clone());
            req_body.stream = Some(false);

            let mut url = endpoint.base_url.clone();
            if !url.ends_with("/chat/completions") && !url.contains("generativelanguage") {
                url = format!("{}/chat/completions", url.trim_end_matches('/'));
            } else if url.contains("generativelanguage") && !url.ends_with(":generateContent") && !url.contains("openai") {
                // Handle raw Gemini API if not using OpenAI compatibility layer
                url = format!("{}:generateContent", url.trim_end_matches('/'));
            }

            let mut request = self.http_client.post(&url).json(&req_body);
            if !endpoint.api_key.is_empty() {
                request = request.header(header::AUTHORIZATION, format!("Bearer {}", endpoint.api_key));
            }

            match request.send().await {
                Ok(response) => {
                    if response.status().is_success() {
                        let json_resp: ChatCompletionResponse = response.json().await?;
                        if let Some(choice) = json_resp.choices.first() {
                            return Ok(choice.message.content.clone().unwrap_or_default());
                        }
                    } else {
                        let status = response.status();
                        let text = response.text().await.unwrap_or_default();
                        warn!("[AI-Chat] {} failed: {} - {}", endpoint.base_url, status, text);
                        last_err = AiError::Api(format!("{} - {}", status, text));
                    }
                }
                Err(e) => {
                    warn!("[AI-Chat] {} network error: {}", endpoint.base_url, e);
                    last_err = AiError::Network(e);
                }
            }
        }
        
        Err(last_err)
    }

    pub async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        tx: mpsc::Sender<Result<String, AiError>>,
    ) {
        let mut endpoints = self.config.endpoints.iter().filter(|e| e.is_enabled).cloned().collect::<Vec<_>>();
        endpoints.sort_by_key(|e| e.priority);

        if endpoints.is_empty() {
            let _ = tx.send(Err(AiError::NoEndpoint)).await;
            return;
        }

        let mut last_err_msg = String::from("所有节点均不可用");

        for (ep_idx, endpoint) in endpoints.iter().enumerate() {
            let mut req_body = self.build_request_body(endpoint, messages.clone());
            req_body.stream = Some(true);

            let mut url = endpoint.base_url.clone();
            if !url.ends_with("/chat/completions") && !url.contains("generativelanguage") {
                url = format!("{}/chat/completions", url.trim_end_matches('/'));
            }

            info!("[AI-Stream] Attempting node {}/{}: {} ({})", ep_idx + 1, endpoints.len(), url, endpoint.model);

            let mut request = self.http_client.post(&url).json(&req_body).timeout(Duration::from_secs(600));
            if !endpoint.api_key.is_empty() {
                request = request.header(header::AUTHORIZATION, format!("Bearer {}", endpoint.api_key));
            }

            // Connection timeout (Initial headers)
            let response = match tokio::time::timeout(Duration::from_secs(12), request.send()).await {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    warn!("[AI-Stream] Node {} network error: {}", ep_idx + 1, e);
                    last_err_msg = format!("网络错误: {}", e);
                    continue; // Try next endpoint
                }
                Err(_) => {
                    warn!("[AI-Stream] Node {} connection timeout (12s)", ep_idx + 1);
                    last_err_msg = "连接服务器超时 (12s)".into();
                    continue; // Try next endpoint
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                warn!("[AI-Stream] Node {} API error: {} - {}", ep_idx + 1, status, text);
                last_err_msg = format!("API 错误 ({}): {}", status, text);
                continue; // Try next endpoint
            }

            // If we're here, we successfully started a stream!
            let mut stream = response.bytes_stream().eventsource();
            let mut first_token = true;
            let mut chunk_received = false;
            let mut in_thinking_block = false;

            loop {
                // Watchdog for next chunk: 
                // 90s for the very first token (Reasoning models can take long)
                // 30s for subsequent tokens
                let chunk_timeout = if first_token { Duration::from_secs(90) } else { Duration::from_secs(30) };
                
                match tokio::time::timeout(chunk_timeout, stream.next()).await {
                    Ok(Some(Ok(event))) => {
                        chunk_received = true;
                        let data = event.data;
                        if data == "[DONE]" {
                            info!("[AI-Stream] Node {} completed.", ep_idx + 1);
                            return; // Success!
                        }
                        if data.trim().is_empty() {
                            continue;
                        }
                        
                        // Parse OpenAI compatible format
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                            let mut found_content = false;
                            if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                                if let Some(choice) = choices.first() {
                                    if let Some(delta) = choice.get("delta") {
                                        if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                            found_content = true;
                                            
                                            // Handle <think> blocks for clean output
                                            let mut output = content.to_string();
                                            if output.contains("<think>") {
                                                in_thinking_block = true;
                                                output = output.split("<think>").next().unwrap_or("").to_string();
                                            }
                                            
                                            if in_thinking_block {
                                                if output.contains("</think>") {
                                                    in_thinking_block = false;
                                                    output = output.split("</think>").nth(1).unwrap_or("").to_string();
                                                } else {
                                                    output = String::new(); // Skip everything inside <think>
                                                }
                                            }

                                            if !output.is_empty() {
                                                let _ = tx.send(Ok(output)).await;
                                                first_token = false;
                                            }
                                        }
                                    }
                                }
                            }
                            
                            if !found_content {
                                if let Some(error) = json.get("error") {
                                    let msg = error.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown AI error");
                                    let _ = tx.send(Err(AiError::Api(msg.to_string()))).await;
                                    return; // Critical API error, don't retry if it already started sending?
                                    // Actually, if we haven't sent any tokens to UI yet, we COULD retry.
                                    // But if we've sent some, we shouldn't mix results from different models.
                                }
                            }
                        } else {
                            // Non-standard chunk parsing fallback
                            // Some providers send raw text if it's not strictly SSE formatted
                            if first_token {
                                warn!("[AI-Stream] Unexpected non-JSON chunk received: {}", data);
                            }
                            let _ = tx.send(Ok(data)).await;
                            first_token = false;
                        }
                    }
                    Ok(Some(Err(e))) => {
                        warn!("[AI-Stream] Node {} stream event error: {:?}", ep_idx + 1, e);
                        if !chunk_received {
                            last_err_msg = format!("数据流异常: {:?}", e);
                            break; // Inner loop break -> try next endpoint
                        } else {
                            let _ = tx.send(Err(AiError::Api(format!("数据流中断: {:?}", e)))).await;
                            return;
                        }
                    }
                    Ok(None) => {
                        info!("[AI-Stream] Node {} stream closed.", ep_idx + 1);
                        return;
                    }
                    Err(_) => {
                        warn!("[AI-Stream] Node {} chunk timeout ({}s)", ep_idx + 1, chunk_timeout.as_secs());
                        if !chunk_received {
                            last_err_msg = "模型响应超时，正在尝试备用节点...".into();
                            break; // Inner loop break -> try next endpoint
                        } else {
                            let _ = tx.send(Err(AiError::Api("读取超时，后续内容生成中断".into()))).await;
                            return;
                        }
                    }
                }
            }
            
            // If we reached here, the inner loop broke before success.
            // Continue to next endpoint in the outer loop.
        }

        // If we exhausted all endpoints
        let _ = tx.send(Err(AiError::Api(last_err_msg))).await;
    }
}
