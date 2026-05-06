use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use yiboflow_core::config::{AppConfig, ProbeProtocol, ProbeTarget, GLOBAL_CONFIG};

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProbeTargetPayload {
    pub id: String,
    pub name: String,
    pub protocol: ProbeProtocol,
    pub base_url: String,
    pub model: String,
    pub is_enabled: bool,
    pub order: i32,
    pub api_key: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProbeResult {
    pub success: bool,
    pub code: String,
    pub summary: String,
    pub detail: String,
    pub latency_ms: Option<u64>,
    pub detected_protocol: Option<String>,
    pub auth_status: String,
    pub model_count: Option<usize>,
}

#[derive(Serialize, Deserialize, Default)]
struct ProbeSecretsFile {
    api_keys: HashMap<String, String>,
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

#[derive(Deserialize)]
struct AnthropicModel {
    id: String,
}

#[derive(Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModel>,
}

pub fn get_probe_targets() -> Result<Vec<ProbeTargetPayload>, String> {
    let cfg = GLOBAL_CONFIG.read().map_err(|e| e.to_string())?.clone();
    let secrets = load_probe_secrets().unwrap_or_default();

    let mut targets: Vec<_> = cfg
        .probe_tool
        .targets
        .into_iter()
        .map(|target| ProbeTargetPayload {
            api_key: secrets
                .api_keys
                .get(&target.id)
                .cloned()
                .unwrap_or_default(),
            id: target.id,
            name: target.name,
            protocol: target.protocol,
            base_url: target.base_url,
            model: target.model,
            is_enabled: target.is_enabled,
            order: target.order,
        })
        .collect();

    targets.sort_by_key(|target| target.order);
    Ok(targets)
}

pub fn save_probe_targets(targets: Vec<ProbeTargetPayload>) -> Result<(), String> {
    let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
    let mut normalized = targets;
    normalized.sort_by_key(|target| target.order);

    cfg.probe_tool.targets = normalized
        .iter()
        .enumerate()
        .map(|(index, target)| ProbeTarget {
            id: target.id.clone(),
            name: target.name.trim().to_string(),
            protocol: target.protocol.clone(),
            base_url: target.base_url.trim().trim_end_matches('/').to_string(),
            model: target.model.trim().to_string(),
            is_enabled: target.is_enabled,
            order: index as i32 + 1,
        })
        .collect();
    cfg.save();
    drop(cfg);

    let mut secrets = ProbeSecretsFile::default();
    for target in normalized {
        if !target.api_key.trim().is_empty() {
            secrets
                .api_keys
                .insert(target.id.clone(), target.api_key.trim().to_string());
        }
    }
    save_probe_secrets(&secrets)
}

pub async fn probe_target(target: ProbeTargetPayload) -> Result<ProbeResult, String> {
    let client = build_http_client(default_timeout_ms())?;
    let start = Instant::now();

    let result = match target.protocol {
        ProbeProtocol::Ollama => probe_ollama(&client, &target, start).await,
        ProbeProtocol::OpenAiCompatible => probe_openai_compatible(&client, &target, start).await,
        ProbeProtocol::GeminiOpenAiCompatible => {
            probe_openai_compatible(&client, &target, start).await
        }
        ProbeProtocol::Anthropic => probe_anthropic(&client, &target, start).await,
        ProbeProtocol::Custom => probe_custom(&client, &target, start).await,
    };

    Ok(result)
}

pub async fn list_probe_target_models(target: ProbeTargetPayload) -> Result<Vec<String>, String> {
    let client = build_http_client(default_timeout_ms())?;
    let models = match target.protocol {
        ProbeProtocol::Ollama => fetch_ollama_models(&client, &target).await?,
        ProbeProtocol::OpenAiCompatible => fetch_openai_models(&client, &target).await?,
        ProbeProtocol::GeminiOpenAiCompatible => fetch_openai_models(&client, &target).await?,
        ProbeProtocol::Anthropic => fetch_anthropic_models(&client, &target).await?,
        ProbeProtocol::Custom => {
            if let Ok(models) = fetch_ollama_models(&client, &target).await {
                models
            } else if let Ok(models) = fetch_anthropic_models(&client, &target).await {
                models
            } else {
                fetch_openai_models(&client, &target).await?
            }
        }
    };
    Ok(models)
}

fn default_timeout_ms() -> u64 {
    GLOBAL_CONFIG
        .read()
        .ok()
        .map(|cfg| cfg.probe_tool.timeout_ms)
        .filter(|timeout| *timeout > 0)
        .unwrap_or(10000)
}

fn build_http_client(timeout_ms: u64) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_millis(timeout_ms.max(1000)))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn probe_secrets_path() -> PathBuf {
    let mut path = AppConfig::config_path();
    path.set_file_name("probe_secrets.json");
    path
}

fn load_probe_secrets() -> Result<ProbeSecretsFile, String> {
    let path = probe_secrets_path();
    if !path.exists() {
        return Ok(ProbeSecretsFile::default());
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read probe secrets: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse probe secrets: {e}"))
}

fn save_probe_secrets(secrets: &ProbeSecretsFile) -> Result<(), String> {
    let path = probe_secrets_path();
    let json = serde_json::to_string_pretty(secrets)
        .map_err(|e| format!("Failed to serialize probe secrets: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to save probe secrets: {e}"))
}

async fn probe_custom(client: &Client, target: &ProbeTargetPayload, start: Instant) -> ProbeResult {
    let ollama = probe_ollama(client, target, start).await;
    if ollama.success || ollama.code == "ERR_UNAUTHORIZED" {
        return ollama;
    }

    let anthropic = probe_anthropic(client, target, start).await;
    if anthropic.success || anthropic.code == "ERR_UNAUTHORIZED" {
        return anthropic;
    }

    let openai = probe_openai_compatible(client, target, start).await;
    if openai.success || openai.code == "ERR_UNAUTHORIZED" {
        return openai;
    }

    failure_result(
        "ERR_PROTOCOL_MISMATCH",
        "No supported protocol matched",
        "The target did not behave like Ollama, OpenAI-compatible, or Anthropic APIs. Check the base URL and selected protocol.",
        start,
        None,
        "unknown",
        None,
    )
}

async fn probe_ollama(client: &Client, target: &ProbeTargetPayload, start: Instant) -> ProbeResult {
    let version_url = ollama_version_url(&target.base_url);
    match client.get(version_url).send().await {
        Ok(response) if response.status().is_success() => {
            match fetch_ollama_models(client, target).await {
                Ok(models) => success_result(
                    "OK_MODELS_FOUND",
                    "Ollama endpoint is reachable",
                    format!(
                        "Connected directly to Ollama and found {} model(s).",
                        models.len()
                    ),
                    start,
                    Some("ollama"),
                    "not_required",
                    Some(models.len()),
                ),
                Err(err) => success_result(
                    "OK_CONNECTED",
                    "Ollama endpoint is reachable",
                    format!("Connected to Ollama, but model discovery failed: {err}"),
                    start,
                    Some("ollama"),
                    "not_required",
                    None,
                ),
            }
        }
        Ok(response) => {
            http_failure_result(response.status(), start, Some("ollama"), "not_required")
        }
        Err(err) => network_failure_result(err.to_string(), start, Some("ollama")),
    }
}

async fn probe_openai_compatible(
    client: &Client,
    target: &ProbeTargetPayload,
    start: Instant,
) -> ProbeResult {
    let url = openai_models_url(&target.base_url);
    let mut request = client.get(url);
    if !target.api_key.trim().is_empty() {
        request = request.header(AUTHORIZATION, format!("Bearer {}", target.api_key.trim()));
    }

    match request.send().await {
        Ok(response) if response.status().is_success() => {
            let model_count = response
                .text()
                .await
                .ok()
                .and_then(|text| serde_json::from_str::<OpenAiModelsResponse>(&text).ok())
                .map(|data| data.data.len());

            success_result(
                model_count.map(|count| if count > 0 { "OK_MODELS_FOUND" } else { "OK_CONNECTED" }).unwrap_or("OK_CONNECTED"),
                "OpenAI-compatible endpoint is reachable",
                match model_count {
                    Some(count) if count > 0 => format!("Connected and found {count} model(s) via the /models endpoint."),
                    Some(_) => "Connected successfully, but the /models response was empty.".to_string(),
                    None => "Connected successfully. The /models response was reachable but could not be fully parsed.".to_string(),
                },
                start,
                Some("openai_compatible"),
                if target.api_key.trim().is_empty() { "not_provided" } else { "authorized" },
                model_count,
            )
        }
        Ok(response) => http_failure_result(
            response.status(),
            start,
            Some("openai_compatible"),
            if target.api_key.trim().is_empty() {
                "not_provided"
            } else {
                "provided"
            },
        ),
        Err(err) => network_failure_result(err.to_string(), start, Some("openai_compatible")),
    }
}

async fn probe_anthropic(
    client: &Client,
    target: &ProbeTargetPayload,
    start: Instant,
) -> ProbeResult {
    let url = anthropic_models_url(&target.base_url);
    match client
        .get(url)
        .headers(anthropic_headers(&target.api_key))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            let model_count = response
                .text()
                .await
                .ok()
                .and_then(|text| serde_json::from_str::<AnthropicModelsResponse>(&text).ok())
                .map(|data| data.data.len());

            success_result(
                model_count.map(|count| if count > 0 { "OK_MODELS_FOUND" } else { "OK_CONNECTED" }).unwrap_or("OK_CONNECTED"),
                "Anthropic endpoint is reachable",
                match model_count {
                    Some(count) if count > 0 => format!("Connected and found {count} model(s) via GET /v1/models."),
                    Some(_) => "Connected successfully, but the Anthropic model list was empty.".to_string(),
                    None => "Connected successfully. The Anthropic response was reachable but could not be fully parsed.".to_string(),
                },
                start,
                Some("anthropic"),
                if target.api_key.trim().is_empty() { "not_provided" } else { "authorized" },
                model_count,
            )
        }
        Ok(response) => http_failure_result(
            response.status(),
            start,
            Some("anthropic"),
            if target.api_key.trim().is_empty() {
                "not_provided"
            } else {
                "provided"
            },
        ),
        Err(err) => network_failure_result(err.to_string(), start, Some("anthropic")),
    }
}

async fn fetch_ollama_models(
    client: &Client,
    target: &ProbeTargetPayload,
) -> Result<Vec<String>, String> {
    let response = client
        .get(ollama_models_url(&target.base_url))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    let payload: OllamaModelsResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse Ollama response: {e}"))?;
    Ok(payload.models.into_iter().map(|model| model.name).collect())
}

async fn fetch_openai_models(
    client: &Client,
    target: &ProbeTargetPayload,
) -> Result<Vec<String>, String> {
    let mut request = client.get(openai_models_url(&target.base_url));
    if !target.api_key.trim().is_empty() {
        request = request.header(AUTHORIZATION, format!("Bearer {}", target.api_key.trim()));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    let payload: OpenAiModelsResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse OpenAI-compatible response: {e}"))?;
    Ok(payload.data.into_iter().map(|model| model.id).collect())
}

async fn fetch_anthropic_models(
    client: &Client,
    target: &ProbeTargetPayload,
) -> Result<Vec<String>, String> {
    let response = client
        .get(anthropic_models_url(&target.base_url))
        .headers(anthropic_headers(&target.api_key))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    let payload: AnthropicModelsResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse Anthropic response: {e}"))?;
    Ok(payload.data.into_iter().map(|model| model.id).collect())
}

fn anthropic_headers(api_key: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static(ANTHROPIC_VERSION),
    );
    if !api_key.trim().is_empty() {
        if let Ok(value) = HeaderValue::from_str(api_key.trim()) {
            headers.insert("x-api-key", value);
        }
    }
    headers
}

fn openai_models_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/models") {
        base.to_string()
    } else {
        format!("{base}/models")
    }
}

fn ollama_models_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/api/tags") {
        return base.to_string();
    }
    let stripped = base
        .strip_suffix("/v1")
        .unwrap_or(base)
        .trim_end_matches('/');
    format!("{stripped}/api/tags")
}

fn ollama_version_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/api/version") {
        return base.to_string();
    }
    let stripped = base
        .strip_suffix("/v1")
        .unwrap_or(base)
        .trim_end_matches('/');
    format!("{stripped}/api/version")
}

fn anthropic_models_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/v1/models") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/models")
    } else {
        format!("{base}/v1/models")
    }
}

fn success_result(
    code: &str,
    summary: &str,
    detail: String,
    start: Instant,
    detected_protocol: Option<&str>,
    auth_status: &str,
    model_count: Option<usize>,
) -> ProbeResult {
    ProbeResult {
        success: true,
        code: code.to_string(),
        summary: summary.to_string(),
        detail,
        latency_ms: Some(start.elapsed().as_millis() as u64),
        detected_protocol: detected_protocol.map(str::to_string),
        auth_status: auth_status.to_string(),
        model_count,
    }
}

fn failure_result(
    code: &str,
    summary: &str,
    detail: &str,
    start: Instant,
    detected_protocol: Option<&str>,
    auth_status: &str,
    model_count: Option<usize>,
) -> ProbeResult {
    ProbeResult {
        success: false,
        code: code.to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        latency_ms: Some(start.elapsed().as_millis() as u64),
        detected_protocol: detected_protocol.map(str::to_string),
        auth_status: auth_status.to_string(),
        model_count,
    }
}

fn http_failure_result(
    status: StatusCode,
    start: Instant,
    detected_protocol: Option<&str>,
    auth_status: &str,
) -> ProbeResult {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => failure_result(
            "ERR_UNAUTHORIZED",
            "Authentication failed",
            "The server is reachable, but the credentials were rejected. Check the API key and required headers.",
            start,
            detected_protocol,
            "unauthorized",
            None,
        ),
        StatusCode::NOT_FOUND => failure_result(
            "ERR_NOT_FOUND",
            "Endpoint path not found",
            "The server responded, but the expected API path was not found. Check the base URL and selected protocol type.",
            start,
            detected_protocol,
            auth_status,
            None,
        ),
        _ => failure_result(
            "ERR_PROTOCOL_MISMATCH",
            "The endpoint did not respond as expected",
            &format!("The server returned HTTP {status}. Check the selected protocol type and target URL."),
            start,
            detected_protocol,
            auth_status,
            None,
        ),
    }
}

fn network_failure_result(
    error: String,
    start: Instant,
    detected_protocol: Option<&str>,
) -> ProbeResult {
    let code = if error.to_lowercase().contains("timed out") {
        "ERR_TIMEOUT"
    } else {
        "ERR_NETWORK"
    };
    let summary = if code == "ERR_TIMEOUT" {
        "Connection timed out"
    } else {
        "Network connection failed"
    };

    failure_result(
        code,
        summary,
        &format!("Direct connection failed: {error}"),
        start,
        detected_protocol,
        "unknown",
        None,
    )
}
