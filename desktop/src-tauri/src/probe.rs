use bytes::Bytes;
use encoding_rs::Encoding;
use futures_util::StreamExt;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::Incoming;
use hyper::body::Frame;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use lazy_static::lazy_static;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, HOST,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::fs;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use yiboflow_core::config::{
    AppConfig, ProbeCredential, ProbeProtocol, ProbeProxyConfig, ProbeRoute, ProbeRouteKind,
    GLOBAL_CONFIG,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_PROXY_LOGS: usize = 300;
const DEFAULT_ANTHROPIC_MAX_TOKENS: u64 = 1024;
const OPENAI_MODEL_ALIAS: &str = "flowprobe-openai";
const ANTHROPIC_MODEL_ALIAS: &str = "flowprobe-anthropic";

type ProxyBody = http_body_util::combinators::BoxBody<Bytes, Infallible>;

fn default_probe_price_unit() -> String {
    "1M tokens".to_string()
}

fn default_probe_price_currency() -> String {
    "USD".to_string()
}

lazy_static! {
    static ref PROXY_RUNTIME: Mutex<ProxyRuntime> = Mutex::new(ProxyRuntime::default());
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProbeCredentialPayload {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub protocol: ProbeProtocol,
    pub base_url: String,
    pub default_model: String,
    #[serde(default)]
    pub discovered_models: Vec<String>,
    #[serde(default)]
    pub model_catalog_updated_at_ms: Option<u64>,
    pub note: String,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub sort_order: i32,
    pub api_key: String,
    pub input_price_per_million: Option<f64>,
    pub output_price_per_million: Option<f64>,
    #[serde(default = "default_probe_price_unit")]
    pub price_unit: String,
    #[serde(default = "default_probe_price_currency")]
    pub price_currency: String,
    #[serde(default)]
    pub last_test_latency_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProbeConfigPayload {
    pub credentials: Vec<ProbeCredentialPayload>,
    pub routes: Vec<ProbeRoute>,
    pub proxy: ProbeProxyConfig,
    pub timeout_ms: u64,
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

#[derive(Serialize, Clone, Debug)]
pub struct ProbeProxyStatusPayload {
    pub is_running: bool,
    pub last_error: Option<String>,
    pub listen_host: String,
    pub listen_port: u16,
    pub local_token: String,
    pub openai_endpoint: String,
    pub anthropic_endpoint: String,
    pub openai_model_alias: String,
    pub anthropic_model_alias: String,
    pub lan_host_hint: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProbeLogEntryPayload {
    pub id: u64,
    pub timestamp_ms: u64,
    pub route_kind: ProbeRouteKind,
    pub credential_id: String,
    pub credential_name: String,
    pub provider: String,
    pub protocol: ProbeProtocol,
    pub model: String,
    pub request_path: String,
    pub status_code: u16,
    pub success: bool,
    pub latency_ms: u64,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub estimated_cost: Option<f64>,
    pub error_message: Option<String>,
    pub request_kind: String,
    pub request_signature: Option<String>,
    pub response_signature: Option<String>,
    pub diagnostic_flags: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ProbeStatsPayload {
    pub total_requests: u64,
    pub success_count: u64,
    pub error_count: u64,
    pub average_latency_ms: Option<u64>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub estimated_cost: Option<f64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProbeRouteStatsPayload {
    pub route_kind: ProbeRouteKind,
    pub stats: ProbeStatsPayload,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProbeTargetStatsPayload {
    pub route_kind: ProbeRouteKind,
    pub credential_id: String,
    pub credential_name: String,
    pub provider: String,
    pub protocol: ProbeProtocol,
    pub stats: ProbeStatsPayload,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ProbeDashboardStatsPayload {
    pub current_session: ProbeStatsPayload,
    pub recent_5m: ProbeStatsPayload,
    pub by_route_current_session: Vec<ProbeRouteStatsPayload>,
    pub by_route_recent_5m: Vec<ProbeRouteStatsPayload>,
    pub by_target_current_session: Vec<ProbeTargetStatsPayload>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProbeDashboardPayload {
    pub status: ProbeProxyStatusPayload,
    pub logs: Vec<ProbeLogEntryPayload>,
    pub stats: ProbeDashboardStatsPayload,
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

#[derive(Default)]
struct ProbeSecretsFile {
    api_keys: HashMap<String, String>,
}

#[derive(Clone)]
struct ProxyResolvedRoute {
    kind: ProbeRouteKind,
    credential: ProbeCredential,
    api_key: String,
    model: String,
}

#[derive(Clone)]
struct ProxyLogEntry {
    id: u64,
    timestamp_ms: u64,
    route_kind: ProbeRouteKind,
    credential_id: String,
    credential_name: String,
    provider: String,
    protocol: ProbeProtocol,
    model: String,
    request_path: String,
    status_code: u16,
    success: bool,
    latency_ms: u64,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
    estimated_cost: Option<f64>,
    error_message: Option<String>,
    request_kind: String,
    request_signature: Option<String>,
    response_signature: Option<String>,
    diagnostic_flags: Vec<String>,
}

#[derive(Default)]
struct ProxyRequestDiagnostics {
    kind: String,
    signature: Option<String>,
    flags: Vec<String>,
}

#[derive(Default)]
struct AnthropicStreamDiagnostics {
    buffer: String,
    event_sequence: Vec<String>,
    content_block_types: Vec<String>,
    delta_types: Vec<String>,
    message_start_content_shape: Option<String>,
    assistant_role: Option<String>,
    stop_reason: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Default)]
struct ProxyRuntime {
    is_running: bool,
    last_error: Option<String>,
    task: Option<tokio::task::JoinHandle<()>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    logs: VecDeque<ProxyLogEntry>,
    next_log_id: u64,
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn runtime_lock() -> Result<MutexGuard<'static, ProxyRuntime>, String> {
    PROXY_RUNTIME
        .lock()
        .map_err(|_| "Failed to lock FlowProbe runtime state".to_string())
}

impl From<ProbeCredential> for ProbeCredentialPayload {
    fn from(value: ProbeCredential) -> Self {
        Self {
            id: value.id,
            name: value.name,
            provider: value.provider,
            protocol: value.protocol,
            base_url: value.base_url,
            default_model: value.default_model,
            discovered_models: value.discovered_models,
            model_catalog_updated_at_ms: value.model_catalog_updated_at_ms,
            note: value.note,
            tags: value.tags,
            enabled: value.enabled,
            sort_order: value.sort_order,
            api_key: String::new(),
            input_price_per_million: value.input_price_per_million,
            output_price_per_million: value.output_price_per_million,
            price_unit: value.price_unit,
            price_currency: value.price_currency,
            last_test_latency_ms: value.last_test_latency_ms,
        }
    }
}

impl From<ProbeCredentialPayload> for ProbeCredential {
    fn from(value: ProbeCredentialPayload) -> Self {
        Self {
            id: value.id,
            name: value.name,
            provider: value.provider,
            protocol: value.protocol,
            base_url: value.base_url,
            default_model: value.default_model,
            discovered_models: value.discovered_models,
            model_catalog_updated_at_ms: value.model_catalog_updated_at_ms,
            note: value.note,
            tags: value.tags,
            enabled: value.enabled,
            sort_order: value.sort_order,
            input_price_per_million: value.input_price_per_million,
            output_price_per_million: value.output_price_per_million,
            price_unit: value.price_unit,
            price_currency: value.price_currency,
            last_test_latency_ms: value.last_test_latency_ms,
        }
    }
}

impl From<&ProxyLogEntry> for ProbeLogEntryPayload {
    fn from(value: &ProxyLogEntry) -> Self {
        Self {
            id: value.id,
            timestamp_ms: value.timestamp_ms,
            route_kind: value.route_kind.clone(),
            credential_id: value.credential_id.clone(),
            credential_name: value.credential_name.clone(),
            provider: value.provider.clone(),
            protocol: value.protocol.clone(),
            model: value.model.clone(),
            request_path: value.request_path.clone(),
            status_code: value.status_code,
            success: value.success,
            latency_ms: value.latency_ms,
            input_tokens: value.input_tokens,
            output_tokens: value.output_tokens,
            total_tokens: value.total_tokens,
            estimated_cost: value.estimated_cost,
            error_message: value.error_message.clone(),
            request_kind: value.request_kind.clone(),
            request_signature: value.request_signature.clone(),
            response_signature: value.response_signature.clone(),
            diagnostic_flags: value.diagnostic_flags.clone(),
        }
    }
}

pub fn get_probe_config() -> Result<ProbeConfigPayload, String> {
    let cfg = GLOBAL_CONFIG.read().map_err(|e| e.to_string())?.clone();
    let secrets = load_probe_secrets().unwrap_or_default();
    let mut credentials: Vec<_> = cfg
        .probe_tool
        .credentials
        .into_iter()
        .map(|credential| {
            let mut payload = ProbeCredentialPayload::from(credential.clone());
            payload.api_key = secrets
                .api_keys
                .get(&credential.id)
                .cloned()
                .unwrap_or_default();
            payload
        })
        .collect();
    credentials.sort_by_key(|credential| credential.sort_order);

    Ok(ProbeConfigPayload {
        credentials,
        routes: cfg.probe_tool.routes,
        proxy: cfg.probe_tool.proxy,
        timeout_ms: cfg.probe_tool.timeout_ms,
    })
}

pub async fn save_probe_config(payload: ProbeConfigPayload) -> Result<(), String> {
    let old_proxy = {
        let cfg = GLOBAL_CONFIG.read().map_err(|e| e.to_string())?;
        cfg.probe_tool.proxy.clone()
    };

    let mut credentials = payload.credentials;
    credentials.sort_by_key(|credential| credential.sort_order);
    for (index, credential) in credentials.iter_mut().enumerate() {
        credential.sort_order = index as i32 + 1;
        credential.base_url = credential.base_url.trim().trim_end_matches('/').to_string();
        credential.default_model = credential.default_model.trim().to_string();
        credential.discovered_models = credential
            .discovered_models
            .iter()
            .map(|model| model.trim().to_string())
            .filter(|model| !model.is_empty())
            .collect();
        credential.name = credential.name.trim().to_string();
        credential.provider = credential.provider.trim().to_string();
        credential.note = credential.note.trim().to_string();
        credential.price_unit = if credential.price_unit.trim().is_empty() {
            default_probe_price_unit()
        } else {
            credential.price_unit.trim().to_string()
        };
        credential.price_currency = if credential.price_currency.trim().is_empty() {
            default_probe_price_currency()
        } else {
            credential.price_currency.trim().to_uppercase()
        };
        credential.tags = credential
            .tags
            .iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect();
        if credential
            .input_price_per_million
            .is_some_and(|value| !value.is_finite() || value < 0.0)
        {
            return Err(format!("Input price cannot be negative for API '{}'.", credential.name));
        }
        if credential
            .output_price_per_million
            .is_some_and(|value| !value.is_finite() || value < 0.0)
        {
            return Err(format!("Output price cannot be negative for API '{}'.", credential.name));
        }
    }

    {
        let mut cfg = GLOBAL_CONFIG.write().map_err(|e| e.to_string())?;
        cfg.probe_tool.credentials = credentials.iter().cloned().map(ProbeCredential::from).collect();
        cfg.probe_tool.routes = payload.routes;
        cfg.probe_tool.proxy = payload.proxy.clone();
        cfg.probe_tool.timeout_ms = payload.timeout_ms.max(1000);
        cfg.save();
    }

    let mut secrets = ProbeSecretsFile::default();
    for credential in &credentials {
        if !credential.api_key.trim().is_empty() {
            secrets
                .api_keys
                .insert(credential.id.clone(), credential.api_key.trim().to_string());
        }
    }
    save_probe_secrets(&secrets)?;

    let should_restart =
        old_proxy.listen_host != payload.proxy.listen_host || old_proxy.listen_port != payload.proxy.listen_port;
    let is_running = {
        let runtime = runtime_lock()?;
        runtime.is_running
    };
    if is_running && !payload.proxy.is_enabled {
        stop_proxy().await?;
    } else if is_running && should_restart {
        stop_proxy().await?;
        start_proxy().await?;
    }

    Ok(())
}

pub async fn start_proxy() -> Result<ProbeProxyStatusPayload, String> {
    let snapshot = GLOBAL_CONFIG.read().map_err(|e| e.to_string())?.clone();
    let proxy = snapshot.probe_tool.proxy.clone();
    if !proxy.is_enabled {
        let message = "FlowProbe proxy is disabled in configuration.".to_string();
        let _ = set_runtime_error(Some(message.clone()));
        return Err(message);
    }
    let listen_addr = format!("{}:{}", proxy.listen_host, proxy.listen_port);

    let already_running = {
        let runtime = runtime_lock()?;
        runtime.is_running
    };
    if already_running {
        return proxy_status().await;
    }

    let listener = match TcpListener::bind(&listen_addr).await {
        Ok(listener) => listener,
        Err(error) => {
            let message = format!("Failed to start FlowProbe proxy on {listen_addr}: {error}");
            let _ = set_runtime_error(Some(message.clone()));
            return Err(message);
        }
    };
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    break;
                }
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else {
                        continue;
                    };
                    tokio::spawn(async move {
                        let io = TokioIo::new(stream);
                        let service = service_fn(handle_proxy_request);
                        if let Err(error) = http1::Builder::new().serve_connection(io, service).await {
                            let _ = set_runtime_error(Some(format!("FlowProbe proxy connection error: {error}")));
                        }
                    });
                }
            }
        }
    });

    {
        let mut runtime = runtime_lock()?;
        runtime.is_running = true;
        runtime.last_error = None;
        runtime.shutdown_tx = Some(shutdown_tx);
        runtime.task = Some(task);
    }

    proxy_status().await
}

pub async fn stop_proxy() -> Result<ProbeProxyStatusPayload, String> {
    let task = {
        let mut runtime = runtime_lock()?;
        runtime.is_running = false;
        if let Some(tx) = runtime.shutdown_tx.take() {
            let _ = tx.send(());
        }
        runtime.task.take()
    };

    if let Some(task) = task {
        let _ = task.await;
    }

    proxy_status().await
}

pub async fn proxy_status() -> Result<ProbeProxyStatusPayload, String> {
    let cfg = GLOBAL_CONFIG.read().map_err(|e| e.to_string())?.clone();
    let runtime = runtime_lock()?;
    let proxy = cfg.probe_tool.proxy;
    let host = proxy.listen_host;
    let port = proxy.listen_port;
    let lan_host_hint = resolve_lan_host_hint(&host);
    Ok(ProbeProxyStatusPayload {
        is_running: runtime.is_running,
        last_error: runtime.last_error.clone(),
        openai_endpoint: format!("http://{host}:{port}/v1"),
        anthropic_endpoint: format!("http://{host}:{port}/anthropic"),
        openai_model_alias: route_model_alias(&ProbeRouteKind::OpenAi).to_string(),
        anthropic_model_alias: route_model_alias(&ProbeRouteKind::Anthropic).to_string(),
        lan_host_hint,
        listen_host: host,
        listen_port: port,
        local_token: proxy.local_token,
    })
}

pub async fn probe_dashboard() -> Result<ProbeDashboardPayload, String> {
    let status = proxy_status().await?;
    let runtime = runtime_lock()?;
    let logs: Vec<ProbeLogEntryPayload> = runtime.logs.iter().rev().map(ProbeLogEntryPayload::from).collect();
    let stats = build_stats(&runtime.logs);
    Ok(ProbeDashboardPayload { status, logs, stats })
}

pub async fn clear_proxy_logs() -> Result<(), String> {
    let mut runtime = runtime_lock()?;
    runtime.logs.clear();
    Ok(())
}

pub async fn test_credential(credential: ProbeCredentialPayload) -> Result<ProbeResult, String> {
    probe_credential(credential).await
}

pub async fn test_route(kind: ProbeRouteKind) -> Result<ProbeResult, String> {
    let route = resolve_route(kind)?;
    let payload = ProbeCredentialPayload {
        id: route.credential.id.clone(),
        name: route.credential.name.clone(),
        provider: route.credential.provider.clone(),
        protocol: route.credential.protocol.clone(),
        base_url: route.credential.base_url.clone(),
        default_model: route.model,
        discovered_models: route.credential.discovered_models.clone(),
        model_catalog_updated_at_ms: route.credential.model_catalog_updated_at_ms,
        note: route.credential.note.clone(),
        tags: route.credential.tags.clone(),
        enabled: route.credential.enabled,
        sort_order: route.credential.sort_order,
        api_key: route.api_key,
        input_price_per_million: route.credential.input_price_per_million,
        output_price_per_million: route.credential.output_price_per_million,
        price_unit: route.credential.price_unit.clone(),
        price_currency: route.credential.price_currency.clone(),
        last_test_latency_ms: route.credential.last_test_latency_ms,
    };
    probe_credential(payload).await
}

pub async fn list_credential_models(credential: ProbeCredentialPayload) -> Result<Vec<String>, String> {
    list_models_for_credential(credential).await
}

pub async fn list_route_models(kind: ProbeRouteKind) -> Result<Vec<String>, String> {
    let route = resolve_route(kind)?;
    list_models_for_credential(ProbeCredentialPayload {
        id: route.credential.id.clone(),
        name: route.credential.name.clone(),
        provider: route.credential.provider.clone(),
        protocol: route.credential.protocol.clone(),
        base_url: route.credential.base_url.clone(),
        default_model: route.model,
        discovered_models: route.credential.discovered_models.clone(),
        model_catalog_updated_at_ms: route.credential.model_catalog_updated_at_ms,
        note: route.credential.note.clone(),
        tags: route.credential.tags.clone(),
        enabled: route.credential.enabled,
        sort_order: route.credential.sort_order,
        api_key: route.api_key,
        input_price_per_million: route.credential.input_price_per_million,
        output_price_per_million: route.credential.output_price_per_million,
        price_unit: route.credential.price_unit.clone(),
        price_currency: route.credential.price_currency.clone(),
        last_test_latency_ms: route.credential.last_test_latency_ms,
    })
    .await
}

async fn handle_proxy_request(req: Request<Incoming>) -> Result<Response<ProxyBody>, hyper::Error> {
    let response = match process_proxy_request(req).await {
        Ok(response) => response,
        Err(error) => proxy_error_response(StatusCode::BAD_GATEWAY, &error),
    };
    Ok(response)
}

async fn process_proxy_request(req: Request<Incoming>) -> Result<Response<ProxyBody>, String> {
    let started_at = Instant::now();
    let path = req.uri().path().to_string();
    let raw_path_and_query = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| path.clone());
    if path == "/probe/health" {
        return Ok(json_response(
            StatusCode::OK,
            serde_json::json!({ "ok": true, "ts": current_time_ms() }),
        ));
    }

    let path_and_query = normalize_proxy_path(&raw_path_and_query);
    let normalized_path = path_and_query
        .split('?')
        .next()
        .unwrap_or(path_and_query.as_str())
        .to_string();

    let route_kind = detect_route_kind(&normalized_path, req.headers()).ok_or_else(|| {
        "Unknown FlowProbe endpoint.".to_string()
    })?;

    let route = resolve_route(route_kind.clone())?;
    let cfg = GLOBAL_CONFIG.read().map_err(|e| e.to_string())?.clone();
    let proxy_cfg = cfg.probe_tool.proxy;
    if !proxy_cfg.is_enabled {
        return Ok(proxy_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "FlowProbe proxy is disabled.",
        ));
    }
    verify_local_token(&req, &proxy_cfg.local_token, &route_kind)?;
    let collect_usage = proxy_cfg.collect_usage;

    if is_local_models_request(&route_kind, &normalized_path) {
        let current_model = route.model.trim();
        let model_count = if current_model.is_empty() || current_model == route_model_alias(&route.kind) {
            1
        } else {
            2
        };
        log_local_proxy_activity(
            &route,
            &route_kind,
            &normalized_path,
            &classify_request_kind(&route_kind, &normalized_path),
            format!("content_type=application/json; local_models=true; model_count={model_count}"),
            collect_usage,
        )?;
        return Ok(local_models_response(&route));
    }
    if let Some(model_id) = local_model_detail_request(&route_kind, &normalized_path) {
        log_local_proxy_activity(
            &route,
            &route_kind,
            &normalized_path,
            &classify_request_kind(&route_kind, &normalized_path),
            format!("content_type=application/json; local_model_detail=true; requested={model_id}"),
            collect_usage,
        )?;
        return Ok(local_model_detail_response(&route, model_id));
    }

    let (parts, body) = req.into_parts();
    let original_content_type = parts
        .headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body_bytes = body
        .collect()
        .await
        .map_err(|e| format!("Failed to read request body: {e}"))?
        .to_bytes();

    let upstream_path = if route_kind == ProbeRouteKind::Anthropic {
        path_and_query
            .strip_prefix("/anthropic")
            .unwrap_or("/")
            .to_string()
    } else {
        path_and_query.clone()
    };
    let upstream_url = build_upstream_url(&route.kind, &route.credential.base_url, &upstream_path);
    let (prepared_body, request_model) =
        prepare_request_body(&route, &upstream_path, &original_content_type, &body_bytes)?;
    let prepared_body_bytes = Bytes::from(prepared_body.clone());
    let request_diagnostics =
        inspect_request_diagnostics(&route_kind, &upstream_path, &original_content_type, &prepared_body_bytes);

    let client = build_http_client(cfg.probe_tool.timeout_ms)?;
    let mut request = client.request(parts.method.clone(), upstream_url);
    request = copy_upstream_headers(request, &parts.headers, &route, &request_model)?;
    if !prepared_body.is_empty() {
        request = request.body(prepared_body.clone());
    }

    let upstream_response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            let error_message = format!("FlowProbe upstream request failed: {error}");
            log_proxy_transport_error(
                &route,
                &route_kind,
                &request_model,
                &upstream_path,
                started_at,
                StatusCode::BAD_GATEWAY,
                &error_message,
                collect_usage,
                &request_diagnostics,
            )?;
            return Err(error_message);
        }
    };
    let status = upstream_response.status();
    let headers = upstream_response.headers().clone();
    let is_event_stream = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("text/event-stream"))
        .unwrap_or(false);
    let should_log = should_log_proxy_activity(&route_kind, &upstream_path, status);
    let is_anthropic_stream = is_event_stream && route_kind == ProbeRouteKind::Anthropic;

    if is_event_stream {
        let stream_log_id = if should_log && collect_usage {
            let log_id = next_log_id()?;
            push_proxy_log(ProxyLogEntry {
                id: log_id,
                timestamp_ms: current_time_ms(),
                route_kind,
                credential_id: route.credential.id.clone(),
                credential_name: route.credential.name.clone(),
                provider: route.credential.provider.clone(),
                protocol: route.credential.protocol.clone(),
                model: request_model,
                request_path: upstream_path.clone(),
                status_code: status.as_u16(),
                success: status.is_success(),
                latency_ms: started_at.elapsed().as_millis() as u64,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                estimated_cost: None,
                error_message: None,
                request_kind: request_diagnostics.kind.clone(),
                request_signature: request_diagnostics.signature.clone(),
                response_signature: Some("content_type=text/event-stream; streaming=true".to_string()),
                diagnostic_flags: request_diagnostics.flags.clone(),
            })?;
            Some(log_id)
        } else {
            None
        };

        let stream_diagnostics = if is_anthropic_stream && stream_log_id.is_some() {
            Some(Arc::new(Mutex::new(AnthropicStreamDiagnostics::default())))
        } else {
            None
        };

        if let (Some(log_id), Some(diagnostics)) = (stream_log_id, stream_diagnostics.as_ref()) {
            let diagnostics = diagnostics.lock().ok();
            let signature = diagnostics
                .as_ref()
                .map(|value| value.response_signature())
                .unwrap_or_else(|| "content_type=text/event-stream; streaming=true".to_string());
            let flags = diagnostics
                .as_ref()
                .map(|value| value.diagnostic_flags())
                .unwrap_or_default();
            let _ = update_proxy_log_diagnostics(log_id, Some(signature), &flags);
        }

        let mut builder = Response::builder().status(status);
        for (key, value) in &headers {
            if key == CONTENT_LENGTH || key == HOST {
                continue;
            }
            builder = builder.header(key, value);
        }
        let stream_log_id_for_body = stream_log_id;
        let stream_diagnostics_for_body = stream_diagnostics.clone();
        let body_stream = upstream_response
            .bytes_stream()
            .filter_map(move |item| {
                let stream_diagnostics = stream_diagnostics_for_body.clone();
                async move {
                    item.ok().map(|chunk| {
                        if let (Some(log_id), Some(diagnostics)) =
                            (stream_log_id_for_body, stream_diagnostics.as_ref())
                        {
                            if let Ok(mut diagnostics) = diagnostics.lock() {
                                diagnostics.ingest_chunk(chunk.as_ref());
                                let signature = diagnostics.response_signature();
                                let flags = diagnostics.diagnostic_flags();
                                let _ =
                                    update_proxy_log_diagnostics(log_id, Some(signature), &flags);
                            }
                        }
                        Ok(Frame::data(chunk))
                    })
                }
            });
        builder
            .body(BodyExt::boxed(StreamBody::new(body_stream)))
            .map_err(|e| format!("Failed to build streaming proxy response: {e}"))
    } else {
        let response_bytes = upstream_response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read upstream response: {e}"))?;

        let (input_tokens, output_tokens, total_tokens) =
            parse_usage(&response_bytes, &headers, &route.credential.protocol);
        let estimated_cost = estimate_cost(
            route.credential.input_price_per_million,
            route.credential.output_price_per_million,
            input_tokens,
            output_tokens,
        );
        let success = status.is_success();
        let error_message = if success {
            None
        } else {
            Some(extract_error_message(&response_bytes, &headers, &upstream_path))
        };

        if should_log && collect_usage {
            push_proxy_log(ProxyLogEntry {
                id: next_log_id()?,
                timestamp_ms: current_time_ms(),
                route_kind,
                credential_id: route.credential.id.clone(),
                credential_name: route.credential.name.clone(),
                provider: route.credential.provider.clone(),
                protocol: route.credential.protocol.clone(),
                model: request_model,
                request_path: upstream_path,
                status_code: status.as_u16(),
                success,
                latency_ms: started_at.elapsed().as_millis() as u64,
                input_tokens,
                output_tokens,
                total_tokens,
                estimated_cost,
                error_message,
                request_kind: request_diagnostics.kind.clone(),
                request_signature: request_diagnostics.signature.clone(),
                response_signature: inspect_response_signature(
                    &headers,
                    &response_bytes,
                    &route.credential.protocol,
                ),
                diagnostic_flags: request_diagnostics.flags.clone(),
            })?;
        }

        let mut builder = Response::builder().status(status);
        for (key, value) in &headers {
            if key == CONTENT_LENGTH || key == HOST {
                continue;
            }
            builder = builder.header(key, value);
        }
        builder
            .body(Full::new(response_bytes).boxed())
            .map_err(|e| format!("Failed to build proxy response: {e}"))
    }
}

fn verify_local_token(
    req: &Request<Incoming>,
    expected_token: &str,
    route_kind: &ProbeRouteKind,
) -> Result<(), String> {
    let authorization = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let x_api_key = req
        .headers()
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    let provided = authorization
        .as_deref()
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string)
        .or(x_api_key);

    if provided.as_deref() == Some(expected_token) {
        Ok(())
    } else {
        let protocol_label = if *route_kind == ProbeRouteKind::OpenAi {
            "OpenAI-compatible"
        } else {
            "Anthropic-compatible"
        };
        Err(format!("{protocol_label} local token verification failed."))
    }
}

fn copy_upstream_headers(
    mut request: reqwest::RequestBuilder,
    headers: &hyper::HeaderMap,
    route: &ProxyResolvedRoute,
    request_model: &str,
) -> Result<reqwest::RequestBuilder, String> {
    for (key, value) in headers {
        if should_skip_upstream_header(key) {
            continue;
        }
        request = request.header(key, value);
    }

    if route.kind == ProbeRouteKind::OpenAi {
        if !route.api_key.trim().is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", route.api_key.trim()));
        }
        if !request_model.trim().is_empty() {
            request = request.header("x-flowprobe-model", request_model);
        }
    } else {
        request = request.header("anthropic-version", ANTHROPIC_VERSION);
        if !route.api_key.trim().is_empty() {
            request = request.header("x-api-key", route.api_key.trim());
        }
    }
    Ok(request)
}

fn should_skip_upstream_header(key: &HeaderName) -> bool {
    key == HOST
        || key == CONTENT_LENGTH
        || key == AUTHORIZATION
        || key.as_str() == "x-api-key"
        || matches!(
            key.as_str().to_ascii_lowercase().as_str(),
            "connection"
                | "keep-alive"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "te"
                | "trailer"
                | "transfer-encoding"
                | "upgrade"
                | "http2-settings"
        )
}

fn log_proxy_transport_error(
    route: &ProxyResolvedRoute,
    route_kind: &ProbeRouteKind,
    request_model: &str,
    request_path: &str,
    started_at: Instant,
    status: StatusCode,
    error_message: &str,
    collect_usage: bool,
    request_diagnostics: &ProxyRequestDiagnostics,
) -> Result<(), String> {
    if !collect_usage {
        return Ok(());
    }
    push_proxy_log(ProxyLogEntry {
        id: next_log_id()?,
        timestamp_ms: current_time_ms(),
        route_kind: route_kind.clone(),
        credential_id: route.credential.id.clone(),
        credential_name: route.credential.name.clone(),
        provider: route.credential.provider.clone(),
        protocol: route.credential.protocol.clone(),
        model: request_model.to_string(),
        request_path: request_path.to_string(),
        status_code: status.as_u16(),
        success: false,
        latency_ms: started_at.elapsed().as_millis() as u64,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        estimated_cost: None,
        error_message: Some(error_message.to_string()),
        request_kind: request_diagnostics.kind.clone(),
        request_signature: request_diagnostics.signature.clone(),
        response_signature: None,
        diagnostic_flags: request_diagnostics.flags.clone(),
    })
}

fn log_local_proxy_activity(
    route: &ProxyResolvedRoute,
    route_kind: &ProbeRouteKind,
    request_path: &str,
    request_kind: &str,
    response_signature: String,
    collect_usage: bool,
) -> Result<(), String> {
    if !collect_usage {
        return Ok(());
    }
    push_proxy_log(ProxyLogEntry {
        id: next_log_id()?,
        timestamp_ms: current_time_ms(),
        route_kind: route_kind.clone(),
        credential_id: route.credential.id.clone(),
        credential_name: route.credential.name.clone(),
        provider: route.credential.provider.clone(),
        protocol: route.credential.protocol.clone(),
        model: route.model.clone(),
        request_path: request_path.to_string(),
        status_code: StatusCode::OK.as_u16(),
        success: true,
        latency_ms: 0,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        estimated_cost: None,
        error_message: None,
        request_kind: request_kind.to_string(),
        request_signature: Some("local_short_circuit=true".to_string()),
        response_signature: Some(response_signature),
        diagnostic_flags: vec!["local-response".to_string()],
    })
}

fn classify_request_kind(route_kind: &ProbeRouteKind, request_path: &str) -> String {
    match route_kind {
        ProbeRouteKind::OpenAi => {
            if request_path.starts_with("/v1/chat/completions") {
                "openai.chat.completions".to_string()
            } else if request_path.starts_with("/v1/responses") {
                "openai.responses".to_string()
            } else if request_path.starts_with("/v1/completions") {
                "openai.completions".to_string()
            } else if request_path.starts_with("/v1/embeddings") {
                "openai.embeddings".to_string()
            } else if request_path == "/v1/models" {
                "openai.models".to_string()
            } else if request_path.starts_with("/v1/models/") {
                "openai.model.detail".to_string()
            } else {
                "openai.other".to_string()
            }
        }
        ProbeRouteKind::Anthropic => {
            if request_path.starts_with("/v1/messages") {
                "anthropic.messages".to_string()
            } else if matches!(request_path, "/v1/models" | "/anthropic/v1/models" | "/anthropic/models") {
                "anthropic.models".to_string()
            } else if request_path.starts_with("/v1/models/")
                || request_path.starts_with("/anthropic/v1/models/")
                || request_path.starts_with("/anthropic/models/")
            {
                "anthropic.model.detail".to_string()
            } else {
                "anthropic.other".to_string()
            }
        }
    }
}

fn summarize_content_type(content_type: &str) -> String {
    let trimmed = content_type.trim();
    if trimmed.is_empty() {
        "-".to_string()
    } else {
        trimmed
            .split(';')
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("-")
            .to_string()
    }
}

fn value_shape(value: Option<&Value>) -> &'static str {
    match value {
        Some(Value::Null) => "null",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
        Some(Value::String(_)) => "string",
        Some(Value::Bool(_)) => "bool",
        Some(Value::Number(_)) => "number",
        None => "none",
    }
}

fn append_text_fragments(value: &Value, fragments: &mut Vec<String>, limit: usize) {
    if fragments.len() >= limit {
        return;
    }
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                fragments.push(trimmed.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                if fragments.len() >= limit {
                    break;
                }
                append_text_fragments(item, fragments, limit);
            }
        }
        Value::Object(map) => {
            for key in ["text", "input_text", "content", "value", "prompt", "message", "system"] {
                if let Some(child) = map.get(key) {
                    append_text_fragments(child, fragments, limit);
                }
                if fragments.len() >= limit {
                    break;
                }
            }
        }
        _ => {}
    }
}

fn collect_request_markers(value: &Value) -> Vec<&'static str> {
    let mut fragments = Vec::new();
    if let Some(system) = value.get("system") {
        append_text_fragments(system, &mut fragments, 8);
    }
    if let Some(messages) = value.get("messages") {
        append_text_fragments(messages, &mut fragments, 8);
    }
    if let Some(input) = value.get("input") {
        append_text_fragments(input, &mut fragments, 8);
    }
    if let Some(prompt) = value.get("prompt") {
        append_text_fragments(prompt, &mut fragments, 8);
    }

    let haystack = fragments.join(" ").to_ascii_lowercase();
    let mut markers = Vec::new();
    for (needle, label) in [
        ("title", "title"),
        ("summary", "summary"),
        ("headline", "headline"),
        ("caption", "caption"),
        ("subject", "subject"),
        ("rename", "rename"),
        ("命名", "naming"),
        ("标题", "title_zh"),
        ("摘要", "summary_zh"),
    ] {
        if haystack.contains(needle) {
            markers.push(label);
        }
    }
    markers
}

fn inspect_request_diagnostics(
    route_kind: &ProbeRouteKind,
    request_path: &str,
    content_type: &str,
    body_bytes: &Bytes,
) -> ProxyRequestDiagnostics {
    let kind = classify_request_kind(route_kind, request_path);
    let mut signature_parts = vec![format!("content_type={}", summarize_content_type(content_type))];
    let mut flags = Vec::new();

    if body_bytes.is_empty() || !content_type.contains("application/json") {
        signature_parts.push(format!("body_bytes={}", body_bytes.len()));
        return ProxyRequestDiagnostics {
            kind,
            signature: Some(signature_parts.join("; ")),
            flags,
        };
    }

    let Ok(value) = serde_json::from_slice::<Value>(body_bytes) else {
        signature_parts.push("json=invalid".to_string());
        return ProxyRequestDiagnostics {
            kind,
            signature: Some(signature_parts.join("; ")),
            flags,
        };
    };

    let message_count = value
        .get("messages")
        .and_then(Value::as_array)
        .map(|items| items.len());
    if let Some(count) = message_count {
        signature_parts.push(format!("messages={count}"));
    }

    let input_count = value
        .get("input")
        .and_then(Value::as_array)
        .map(|items| items.len());
    if let Some(count) = input_count {
        signature_parts.push(format!("input={count}"));
    }

    let system_shape = value_shape(value.get("system"));
    if system_shape != "none" {
        signature_parts.push(format!("system={system_shape}"));
    }

    let tools_count = value
        .get("tools")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    signature_parts.push(format!("tools={tools_count}"));

    if let Some(stream) = value.get("stream").and_then(Value::as_bool) {
        signature_parts.push(format!("stream={stream}"));
    }

    let max_tokens = value
        .get("max_tokens")
        .and_then(Value::as_u64)
        .or_else(|| value.get("max_output_tokens").and_then(Value::as_u64));
    if let Some(max_tokens) = max_tokens {
        signature_parts.push(format!("max_tokens={max_tokens}"));
    }

    let markers = collect_request_markers(&value);
    if !markers.is_empty() {
        signature_parts.push(format!("markers={}", markers.join("|")));
    }

    let is_generation_endpoint = matches!(
        kind.as_str(),
        "anthropic.messages"
            | "openai.chat.completions"
            | "openai.responses"
            | "openai.completions"
    );
    let is_short_aux_call = max_tokens.map(|value| value <= 128).unwrap_or(false)
        && message_count.unwrap_or(input_count.unwrap_or(0)) <= 2
        && tools_count == 0;
    let has_title_marker = markers
        .iter()
        .any(|marker| matches!(*marker, "title" | "title_zh" | "summary" | "summary_zh" | "headline"));
    if is_generation_endpoint && (has_title_marker || is_short_aux_call) {
        flags.push("aux-title-candidate".to_string());
    }

    ProxyRequestDiagnostics {
        kind,
        signature: Some(signature_parts.join("; ")),
        flags,
    }
}

fn inspect_response_signature(
    headers: &reqwest::header::HeaderMap,
    response_bytes: &Bytes,
    protocol: &ProbeProtocol,
) -> Option<String> {
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let mut parts = vec![format!("content_type={}", summarize_content_type(content_type))];

    if response_bytes.is_empty() {
        parts.push("body=empty".to_string());
        return Some(parts.join("; "));
    }
    if !content_type.contains("application/json") {
        parts.push(format!("body_bytes={}", response_bytes.len()));
        return Some(parts.join("; "));
    }

    let Ok(value) = serde_json::from_slice::<Value>(response_bytes) else {
        parts.push("json=invalid".to_string());
        return Some(parts.join("; "));
    };

    match protocol {
        ProbeProtocol::Anthropic => {
            if let Some(message_type) = value.get("type").and_then(Value::as_str) {
                parts.push(format!("type={message_type}"));
            }
            if let Some(role) = value.get("role").and_then(Value::as_str) {
                parts.push(format!("role={role}"));
            }
            let content_shape = value_shape(value.get("content"));
            parts.push(format!("content={content_shape}"));
            if let Some(items) = value.get("content").and_then(Value::as_array) {
                parts.push(format!("content_items={}", items.len()));
                let mut kinds = Vec::new();
                for item in items.iter().take(3) {
                    if let Some(kind) = item.get("type").and_then(Value::as_str) {
                        let kind = kind.to_string();
                        if !kinds.iter().any(|existing| existing == &kind) {
                            kinds.push(kind);
                        }
                    }
                }
                if !kinds.is_empty() {
                    parts.push(format!("content_types={}", kinds.join("|")));
                }
            }
            if let Some(stop_reason) = value.get("stop_reason").and_then(Value::as_str) {
                parts.push(format!("stop_reason={stop_reason}"));
            } else if value.get("stop_reason").is_some() {
                parts.push("stop_reason=null".to_string());
            }
            let usage = value.get("usage").cloned().unwrap_or(Value::Null);
            let input_tokens = usage.get("input_tokens").and_then(Value::as_u64);
            let output_tokens = usage.get("output_tokens").and_then(Value::as_u64);
            if input_tokens.is_some() || output_tokens.is_some() {
                parts.push(format!(
                    "usage={}/{}",
                    input_tokens.map(|v| v.to_string()).unwrap_or_else(|| "-".to_string()),
                    output_tokens.map(|v| v.to_string()).unwrap_or_else(|| "-".to_string())
                ));
            }
        }
        _ => {
            if let Some(object) = value.get("object").and_then(Value::as_str) {
                parts.push(format!("object={object}"));
            }
            if let Some(items) = value.get("choices").and_then(Value::as_array) {
                parts.push(format!("choices={}", items.len()));
                if let Some(finish_reason) = items
                    .first()
                    .and_then(|item| item.get("finish_reason"))
                    .and_then(Value::as_str)
                {
                    parts.push(format!("finish_reason={finish_reason}"));
                }
            }
            if let Some(items) = value.get("output").and_then(Value::as_array) {
                parts.push(format!("output={}", items.len()));
            }
            if value.get("content").is_some() {
                parts.push(format!("content={}", value_shape(value.get("content"))));
            }
            let usage = value.get("usage").cloned().unwrap_or(Value::Null);
            let total_tokens = usage.get("total_tokens").and_then(Value::as_u64);
            if let Some(total_tokens) = total_tokens {
                parts.push(format!("usage_total={total_tokens}"));
            }
        }
    }

    Some(parts.join("; "))
}

fn prepare_request_body(
    route: &ProxyResolvedRoute,
    upstream_path: &str,
    content_type: &str,
    body_bytes: &Bytes,
) -> Result<(Vec<u8>, String), String> {
    if body_bytes.is_empty() || !content_type.contains("application/json") {
        let model = route.model.clone();
        return Ok((body_bytes.to_vec(), model));
    }

    let mut value: Value =
        serde_json::from_slice(body_bytes).map_err(|e| format!("Invalid JSON request body: {e}"))?;
    let is_openai_model_path = route.kind == ProbeRouteKind::OpenAi
        && (upstream_path.contains("/chat/completions")
            || upstream_path.contains("/responses")
            || upstream_path.contains("/embeddings")
            || upstream_path.contains("/completions"));
    let is_anthropic_model_path =
        route.kind == ProbeRouteKind::Anthropic && upstream_path.contains("/messages");
    let fallback_model = route.model.trim().to_string();

    let model = if is_openai_model_path || is_anthropic_model_path {
        let current = value
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let alias = route_model_alias(&route.kind);
        if (current.is_empty() || current == alias) && !fallback_model.is_empty() {
            value["model"] = Value::String(fallback_model.clone());
            fallback_model
        } else if current == alias {
            current
        } else {
            current
        }
    } else {
        fallback_model
    };

    if is_anthropic_model_path
        && value.get("max_tokens").and_then(Value::as_u64).is_none()
        && value
            .get("max_output_tokens")
            .and_then(Value::as_u64)
            .is_none()
    {
        value["max_tokens"] = Value::from(DEFAULT_ANTHROPIC_MAX_TOKENS);
    }

    Ok((
        serde_json::to_vec(&value).map_err(|e| format!("Failed to serialize request body: {e}"))?,
        model,
    ))
}

fn build_upstream_url(kind: &ProbeRouteKind, base_url: &str, incoming_path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if incoming_path.is_empty() || incoming_path == "/" {
        return base.to_string();
    }

    if *kind == ProbeRouteKind::OpenAi && incoming_path.starts_with("/v1") {
        let stripped = incoming_path.strip_prefix("/v1").unwrap_or(incoming_path);
        if stripped.is_empty() {
            return base.to_string();
        }
        return format!("{base}{stripped}");
    }

    format!("{base}{incoming_path}")
}

fn route_model_alias(kind: &ProbeRouteKind) -> &'static str {
    match kind {
        ProbeRouteKind::OpenAi => OPENAI_MODEL_ALIAS,
        ProbeRouteKind::Anthropic => ANTHROPIC_MODEL_ALIAS,
    }
}

fn should_log_proxy_activity(
    route_kind: &ProbeRouteKind,
    request_path: &str,
    status: reqwest::StatusCode,
) -> bool {
    !matches!(
        (route_kind, request_path, status),
        (ProbeRouteKind::OpenAi, "/v1/props", reqwest::StatusCode::NOT_FOUND)
            | (ProbeRouteKind::Anthropic, "/v1/props", reqwest::StatusCode::NOT_FOUND)
            | (ProbeRouteKind::Anthropic, "/props", reqwest::StatusCode::NOT_FOUND)
            | (ProbeRouteKind::Anthropic, "/version", reqwest::StatusCode::NOT_FOUND)
            | (ProbeRouteKind::Anthropic, "/api/tags", reqwest::StatusCode::NOT_FOUND)
            | (ProbeRouteKind::Anthropic, "/api/v1/models", reqwest::StatusCode::NOT_FOUND)
    )
}

fn detect_route_kind(
    normalized_path: &str,
    headers: &hyper::HeaderMap,
) -> Option<ProbeRouteKind> {
    let has_anthropic_header = headers.contains_key("anthropic-version");
    let has_x_api_key = headers.contains_key("x-api-key");
    let has_openai_auth = headers.contains_key(AUTHORIZATION);
    let anthropic_style_v1 = normalized_path == "/v1/messages"
        || normalized_path.starts_with("/v1/messages?")
        || normalized_path == "/v1/v1/messages"
        || normalized_path.starts_with("/v1/v1/messages?");

    if normalized_path == "/anthropic" || normalized_path.starts_with("/anthropic/") {
        Some(ProbeRouteKind::Anthropic)
    } else if anthropic_style_v1 && (has_anthropic_header || (has_x_api_key && !has_openai_auth)) {
        Some(ProbeRouteKind::Anthropic)
    } else if normalized_path == "/v1" || normalized_path.starts_with("/v1/") {
        Some(ProbeRouteKind::OpenAi)
    } else {
        None
    }
}

fn normalize_proxy_path(path_and_query: &str) -> String {
    if let Some(stripped) = path_and_query.strip_prefix("/v4/v1") {
        if stripped.is_empty() {
            "/v1".to_string()
        } else {
            format!("/v1{stripped}")
        }
    } else if let Some(stripped) = path_and_query.strip_prefix("/v1/v1") {
        if stripped.is_empty() {
            "/v1".to_string()
        } else {
            format!("/v1{stripped}")
        }
    } else if let Some(stripped) = path_and_query.strip_prefix("/v4/anthropic") {
        if stripped.is_empty() {
            "/anthropic".to_string()
        } else {
            format!("/anthropic{stripped}")
        }
    } else {
        path_and_query.to_string()
    }
}

fn resolve_lan_host_hint(listen_host: &str) -> Option<String> {
    let host = listen_host.trim();
    if host.is_empty() {
        return None;
    }
    if host == "0.0.0.0" {
        return primary_ipv4_hint();
    }
    if host == "127.0.0.1" || host.eq_ignore_ascii_case("localhost") {
        return None;
    }
    Some(host.to_string())
}

fn primary_ipv4_hint() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    let ip = addr.ip();
    if ip.is_ipv4() {
        Some(ip.to_string())
    } else {
        None
    }
}

fn is_local_models_request(route_kind: &ProbeRouteKind, path: &str) -> bool {
    match route_kind {
        ProbeRouteKind::OpenAi => path == "/v1/models",
        ProbeRouteKind::Anthropic => path == "/anthropic/v1/models" || path == "/anthropic/models",
    }
}

fn local_model_detail_request<'a>(route_kind: &ProbeRouteKind, path: &'a str) -> Option<&'a str> {
    match route_kind {
        ProbeRouteKind::OpenAi => path.strip_prefix("/v1/models/"),
        ProbeRouteKind::Anthropic => path
            .strip_prefix("/anthropic/v1/models/")
            .or_else(|| path.strip_prefix("/anthropic/models/")),
    }
}

fn local_models_response(route: &ProxyResolvedRoute) -> Response<ProxyBody> {
    let alias = route_model_alias(&route.kind);
    let current_model = route.model.trim();

    let mut data = vec![serde_json::json!({
        "id": alias,
        "object": "model",
        "owned_by": "flowprobe",
        "display_name": alias,
    })];

    if !current_model.is_empty() && current_model != alias {
        data.push(serde_json::json!({
            "id": current_model,
            "object": "model",
            "owned_by": route.credential.provider,
            "display_name": current_model,
        }));
    }

    json_response(
        StatusCode::OK,
        serde_json::json!({
            "object": "list",
            "data": data,
        }),
    )
}

fn local_model_detail_response(route: &ProxyResolvedRoute, model_id: &str) -> Response<ProxyBody> {
    let alias = route_model_alias(&route.kind);
    let current_model = route.model.trim();
    let requested = model_id.trim();
    let owned_by = if requested == alias {
        "flowprobe".to_string()
    } else if !current_model.is_empty() && requested == current_model {
        route.credential.provider.clone()
    } else {
        "flowprobe".to_string()
    };

    json_response(
        StatusCode::OK,
        serde_json::json!({
            "id": requested,
            "object": "model",
            "owned_by": owned_by,
            "display_name": requested,
        }),
    )
}

fn parse_usage(
    response_bytes: &Bytes,
    headers: &reqwest::header::HeaderMap,
    protocol: &ProbeProtocol,
) -> (Option<u64>, Option<u64>, Option<u64>) {
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type.contains("application/json") {
        return (None, None, None);
    }

    let Ok(value) = serde_json::from_slice::<Value>(response_bytes) else {
        return (None, None, None);
    };

    match protocol {
        ProbeProtocol::Anthropic => {
            let usage = value.get("usage").cloned().unwrap_or(Value::Null);
            let input = usage.get("input_tokens").and_then(Value::as_u64);
            let output = usage.get("output_tokens").and_then(Value::as_u64);
            let total = match (input, output) {
                (Some(input), Some(output)) => Some(input + output),
                _ => None,
            };
            (input, output, total)
        }
        _ => {
            let usage = value.get("usage").cloned().unwrap_or(Value::Null);
            let input = usage
                .get("prompt_tokens")
                .and_then(Value::as_u64)
                .or_else(|| usage.get("input_tokens").and_then(Value::as_u64));
            let output = usage
                .get("completion_tokens")
                .and_then(Value::as_u64)
                .or_else(|| usage.get("output_tokens").and_then(Value::as_u64));
            let total = usage.get("total_tokens").and_then(Value::as_u64).or_else(|| {
                match (input, output) {
                    (Some(input), Some(output)) => Some(input + output),
                    _ => None,
                }
            });
            (input, output, total)
        }
    }
}

fn estimate_cost(
    input_price_per_million: Option<f64>,
    output_price_per_million: Option<f64>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
) -> Option<f64> {
    let mut total = 0.0;
    let mut has_any = false;
    if let (Some(price), Some(tokens)) = (input_price_per_million, input_tokens) {
        total += price * tokens as f64 / 1_000_000.0;
        has_any = true;
    }
    if let (Some(price), Some(tokens)) = (output_price_per_million, output_tokens) {
        total += price * tokens as f64 / 1_000_000.0;
        has_any = true;
    }
    if has_any { Some(total) } else { None }
}

fn extract_error_message(
    response_bytes: &Bytes,
    headers: &reqwest::header::HeaderMap,
    request_path: &str,
) -> String {
    if let Ok(value) = serde_json::from_slice::<Value>(response_bytes) {
        if let Some(message) = value
            .get("error")
            .and_then(|error| error.get("message").or(Some(error)))
            .and_then(Value::as_str)
        {
            return format!("{request_path} -> {message}");
        }
        if let Some(message) = value.get("message").and_then(Value::as_str) {
            return format!("{request_path} -> {message}");
        }
    }

    let text = decode_error_text(response_bytes, headers)
        .unwrap_or_else(|| format!("[non-text response: {} bytes]", response_bytes.len()));
    let text = sanitize_error_text(&text);
    format!("{request_path} -> {text}")
}

fn decode_error_text(
    response_bytes: &Bytes,
    headers: &reqwest::header::HeaderMap,
) -> Option<String> {
    if response_bytes.is_empty() {
        return Some(String::new());
    }

    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let charset = content_type
        .split(';')
        .skip(1)
        .find_map(|segment| {
            let mut parts = segment.trim().splitn(2, '=');
            let key = parts.next()?.trim();
            let value = parts.next()?.trim().trim_matches('"').trim_matches('\'');
            if key.eq_ignore_ascii_case("charset") && !value.is_empty() {
                Some(value.to_string())
            } else {
                None
            }
        });

    if let Some(label) = charset {
        if let Some(encoding) = Encoding::for_label(label.as_bytes()) {
            let (decoded, _, _) = encoding.decode(response_bytes);
            return Some(decoded.into_owned());
        }
    }

    std::str::from_utf8(response_bytes)
        .map(|text| text.to_string())
        .ok()
        .or_else(|| {
            let (decoded, _, had_errors) = encoding_rs::UTF_8.decode(response_bytes);
            if had_errors {
                None
            } else {
                Some(decoded.into_owned())
            }
        })
}

fn sanitize_error_text(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let compact = compact.trim();
    if compact.is_empty() {
        "[empty response body]".to_string()
    } else {
        compact.chars().take(240).collect()
    }
}

fn next_log_id() -> Result<u64, String> {
    let mut runtime = runtime_lock()?;
    runtime.next_log_id += 1;
    Ok(runtime.next_log_id)
}

fn push_proxy_log(entry: ProxyLogEntry) -> Result<(), String> {
    let mut runtime = runtime_lock()?;
    runtime.logs.push_back(entry);
    while runtime.logs.len() > MAX_PROXY_LOGS {
        runtime.logs.pop_front();
    }
    Ok(())
}

fn update_proxy_log_diagnostics(
    log_id: u64,
    response_signature: Option<String>,
    extra_flags: &[String],
) -> Result<(), String> {
    let mut runtime = runtime_lock()?;
    let Some(entry) = runtime.logs.iter_mut().find(|entry| entry.id == log_id) else {
        return Ok(());
    };
    if let Some(signature) = response_signature {
        entry.response_signature = Some(signature);
    }
    for flag in extra_flags {
        if !entry.diagnostic_flags.iter().any(|existing| existing == flag) {
            entry.diagnostic_flags.push(flag.clone());
        }
    }
    Ok(())
}

fn push_limited_unique(values: &mut Vec<String>, candidate: &str, limit: usize) {
    if candidate.is_empty() || values.iter().any(|existing| existing == candidate) {
        return;
    }
    if values.len() < limit {
        values.push(candidate.to_string());
    }
}

impl AnthropicStreamDiagnostics {
    fn ingest_chunk(&mut self, chunk: &[u8]) {
        let text = String::from_utf8_lossy(chunk);
        self.buffer.push_str(&text.replace('\r', ""));

        while let Some(index) = self.buffer.find("\n\n") {
            let block = self.buffer[..index].to_string();
            self.buffer.drain(..index + 2);
            self.ingest_block(&block);
        }
    }

    fn ingest_block(&mut self, block: &str) {
        let mut event_name = String::new();
        let mut data_lines = Vec::new();
        for line in block.lines() {
            if let Some(value) = line.strip_prefix("event:") {
                event_name = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("data:") {
                data_lines.push(value.trim_start().to_string());
            }
        }

        if event_name.is_empty() {
            event_name = "message".to_string();
        }
        if event_name == "ping" {
            return;
        }
        push_limited_unique(&mut self.event_sequence, &event_name, 8);

        let data = data_lines.join("\n");
        if data.is_empty() || data == "[DONE]" {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            return;
        };

        match event_name.as_str() {
            "message_start" => {
                if let Some(role) = value
                    .get("message")
                    .and_then(|message| message.get("role"))
                    .and_then(Value::as_str)
                {
                    self.assistant_role = Some(role.to_string());
                }
                let content_shape = value_shape(
                    value
                        .get("message")
                        .and_then(|message| message.get("content")),
                );
                self.message_start_content_shape = Some(content_shape.to_string());
                self.input_tokens = value
                    .get("message")
                    .and_then(|message| message.get("usage"))
                    .and_then(|usage| usage.get("input_tokens"))
                    .and_then(Value::as_u64)
                    .or_else(|| {
                        value
                            .get("usage")
                            .and_then(|usage| usage.get("input_tokens"))
                            .and_then(Value::as_u64)
                    });
            }
            "content_block_start" => {
                if let Some(kind) = value
                    .get("content_block")
                    .and_then(|block| block.get("type"))
                    .and_then(Value::as_str)
                {
                    push_limited_unique(&mut self.content_block_types, kind, 4);
                }
            }
            "content_block_delta" => {
                if let Some(kind) = value
                    .get("delta")
                    .and_then(|delta| delta.get("type"))
                    .and_then(Value::as_str)
                {
                    push_limited_unique(&mut self.delta_types, kind, 4);
                }
            }
            "message_delta" => {
                if let Some(stop_reason) = value
                    .get("delta")
                    .and_then(|delta| delta.get("stop_reason"))
                    .and_then(Value::as_str)
                {
                    self.stop_reason = Some(stop_reason.to_string());
                } else if value
                    .get("delta")
                    .and_then(|delta| delta.get("stop_reason"))
                    .is_some()
                {
                    self.stop_reason = Some("null".to_string());
                }
                self.output_tokens = value
                    .get("usage")
                    .and_then(|usage| usage.get("output_tokens"))
                    .and_then(Value::as_u64)
                    .or(self.output_tokens);
            }
            _ => {}
        }
    }

    fn diagnostic_flags(&self) -> Vec<String> {
        let mut flags = Vec::new();
        if self.message_start_content_shape.as_deref() == Some("null") {
            flags.push("stream-content-null".to_string());
        }
        flags
    }

    fn response_signature(&self) -> String {
        let mut parts = vec!["content_type=text/event-stream".to_string(), "streaming=true".to_string()];
        if !self.event_sequence.is_empty() {
            parts.push(format!("events={}", self.event_sequence.join("|")));
        }
        if let Some(shape) = &self.message_start_content_shape {
            parts.push(format!("message_start.content={shape}"));
        }
        if let Some(role) = &self.assistant_role {
            parts.push(format!("role={role}"));
        }
        if !self.content_block_types.is_empty() {
            parts.push(format!("block_types={}", self.content_block_types.join("|")));
        }
        if !self.delta_types.is_empty() {
            parts.push(format!("delta_types={}", self.delta_types.join("|")));
        }
        if let Some(stop_reason) = &self.stop_reason {
            parts.push(format!("stop_reason={stop_reason}"));
        }
        if self.input_tokens.is_some() || self.output_tokens.is_some() {
            parts.push(format!(
                "usage={}/{}",
                self.input_tokens
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                self.output_tokens
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string())
            ));
        }
        parts.join("; ")
    }
}

fn summarize_logs<'a, I>(logs: I) -> ProbeStatsPayload
where
    I: IntoIterator<Item = &'a ProxyLogEntry>,
{
    let entries: Vec<&ProxyLogEntry> = logs.into_iter().collect();
    if entries.is_empty() {
        return ProbeStatsPayload::default();
    }

    let total_requests = entries.len() as u64;
    let success_count = entries.iter().filter(|entry| entry.success).count() as u64;
    let error_count = total_requests.saturating_sub(success_count);
    let total_latency: u64 = entries.iter().map(|entry| entry.latency_ms).sum();
    let input_tokens: u64 = entries.iter().filter_map(|entry| entry.input_tokens).sum();
    let output_tokens: u64 = entries.iter().filter_map(|entry| entry.output_tokens).sum();
    let total_tokens: u64 = entries.iter().filter_map(|entry| entry.total_tokens).sum();
    let estimated_cost_sum: f64 = entries.iter().filter_map(|entry| entry.estimated_cost).sum();
    let has_cost = entries.iter().any(|entry| entry.estimated_cost.is_some());

    ProbeStatsPayload {
        total_requests,
        success_count,
        error_count,
        average_latency_ms: Some(total_latency / total_requests.max(1)),
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost: if has_cost { Some(estimated_cost_sum) } else { None },
    }
}

fn route_sort_key(kind: &ProbeRouteKind) -> u8 {
    match kind {
        ProbeRouteKind::OpenAi => 0,
        ProbeRouteKind::Anthropic => 1,
    }
}

fn build_route_stats<'a, I>(logs: I) -> Vec<ProbeRouteStatsPayload>
where
    I: Clone + IntoIterator<Item = &'a ProxyLogEntry>,
{
    [ProbeRouteKind::OpenAi, ProbeRouteKind::Anthropic]
        .into_iter()
        .map(|route_kind| ProbeRouteStatsPayload {
            route_kind: route_kind.clone(),
            stats: summarize_logs(
                logs.clone()
                    .into_iter()
                    .filter(|entry| entry.route_kind == route_kind),
            ),
        })
        .collect()
}

fn build_target_stats<'a, I>(logs: I) -> Vec<ProbeTargetStatsPayload>
where
    I: Clone + IntoIterator<Item = &'a ProxyLogEntry>,
{
    let mut grouped: HashMap<(String, u8), ProbeTargetStatsPayload> = HashMap::new();
    let entries: Vec<&ProxyLogEntry> = logs.clone().into_iter().collect();
    for entry in &entries {
        let key = (entry.credential_id.clone(), route_sort_key(&entry.route_kind));
        grouped.entry(key).or_insert_with(|| ProbeTargetStatsPayload {
            route_kind: entry.route_kind.clone(),
            credential_id: entry.credential_id.clone(),
            credential_name: entry.credential_name.clone(),
            provider: entry.provider.clone(),
            protocol: entry.protocol.clone(),
            stats: ProbeStatsPayload::default(),
        });
    }

    let mut by_target: Vec<ProbeTargetStatsPayload> = grouped
        .into_values()
        .map(|target| {
            let stats = summarize_logs(entries.iter().copied().filter(|entry| {
                entry.route_kind == target.route_kind && entry.credential_id == target.credential_id
            }));
            ProbeTargetStatsPayload { stats, ..target }
        })
        .collect();

    by_target.sort_by(|a, b| {
        route_sort_key(&a.route_kind)
            .cmp(&route_sort_key(&b.route_kind))
            .then(b.stats.total_requests.cmp(&a.stats.total_requests))
            .then(a.credential_name.cmp(&b.credential_name))
    });

    by_target
}

fn build_stats(logs: &VecDeque<ProxyLogEntry>) -> ProbeDashboardStatsPayload {
    let now_ms = current_time_ms();
    let recent_cutoff = now_ms.saturating_sub(5 * 60 * 1000);
    let recent_entries: Vec<&ProxyLogEntry> = logs
        .iter()
        .filter(|entry| entry.timestamp_ms >= recent_cutoff)
        .collect();

    ProbeDashboardStatsPayload {
        current_session: summarize_logs(logs.iter()),
        recent_5m: summarize_logs(recent_entries.iter().copied()),
        by_route_current_session: build_route_stats(logs.iter()),
        by_route_recent_5m: build_route_stats(recent_entries.iter().copied()),
        by_target_current_session: build_target_stats(logs.iter()),
    }
}

fn set_runtime_error(error: Option<String>) -> Result<(), String> {
    let mut runtime = runtime_lock()?;
    runtime.last_error = error;
    Ok(())
}

fn resolve_route(kind: ProbeRouteKind) -> Result<ProxyResolvedRoute, String> {
    let cfg = GLOBAL_CONFIG.read().map_err(|e| e.to_string())?.clone();
    let secrets = load_probe_secrets().unwrap_or_default();
    let route = cfg
        .probe_tool
        .routes
        .iter()
        .find(|route| route.kind == kind)
        .cloned()
        .ok_or_else(|| "FlowProbe route is not configured.".to_string())?;
    if !route.enabled {
        return Err("The selected FlowProbe route is disabled.".to_string());
    }

    let credential = cfg
        .probe_tool
        .credentials
        .iter()
        .find(|credential| credential.id == route.credential_id)
        .cloned()
        .ok_or_else(|| "The selected FlowProbe credential no longer exists.".to_string())?;
    if !credential.enabled {
        return Err("The selected FlowProbe credential is disabled.".to_string());
    }
    if !protocol_is_compatible(&kind, &credential.protocol) {
        return Err("The selected upstream protocol is not compatible with this fixed FlowProbe route.".to_string());
    }

    Ok(ProxyResolvedRoute {
        kind,
        api_key: secrets
            .api_keys
            .get(&credential.id)
            .cloned()
            .unwrap_or_default(),
        model: if !route.model_override.trim().is_empty() {
            route.model_override.trim().to_string()
        } else {
            credential.default_model.trim().to_string()
        },
        credential,
    })
}

fn protocol_is_compatible(kind: &ProbeRouteKind, protocol: &ProbeProtocol) -> bool {
    match kind {
        ProbeRouteKind::OpenAi => matches!(
            protocol,
            ProbeProtocol::OpenAiCompatible
                | ProbeProtocol::GeminiOpenAiCompatible
                | ProbeProtocol::Custom
        ),
        ProbeRouteKind::Anthropic => matches!(protocol, ProbeProtocol::Anthropic | ProbeProtocol::Custom),
    }
}

async fn probe_credential(target: ProbeCredentialPayload) -> Result<ProbeResult, String> {
    let client = build_http_client(default_timeout_ms())?;
    let start = Instant::now();

    let result = match target.protocol {
        ProbeProtocol::Ollama => probe_ollama(&client, &target, start).await,
        ProbeProtocol::OpenAiCompatible => probe_openai_compatible(&client, &target, start).await,
        ProbeProtocol::GeminiOpenAiCompatible => probe_openai_compatible(&client, &target, start).await,
        ProbeProtocol::Anthropic => probe_anthropic(&client, &target, start).await,
        ProbeProtocol::Custom => probe_custom(&client, &target, start).await,
    };

    Ok(result)
}

async fn list_models_for_credential(target: ProbeCredentialPayload) -> Result<Vec<String>, String> {
    let client = build_http_client(default_timeout_ms())?;
    match target.protocol {
        ProbeProtocol::Ollama => fetch_ollama_models(&client, &target).await,
        ProbeProtocol::OpenAiCompatible | ProbeProtocol::GeminiOpenAiCompatible => {
            fetch_openai_models(&client, &target).await
        }
        ProbeProtocol::Anthropic => fetch_anthropic_models(&client, &target).await,
        ProbeProtocol::Custom => {
            if let Ok(models) = fetch_ollama_models(&client, &target).await {
                return Ok(models);
            }
            if let Ok(models) = fetch_anthropic_models(&client, &target).await {
                return Ok(models);
            }
            if let Ok(models) = fetch_openai_models(&client, &target).await {
                return Ok(models);
            }
            Err("No supported protocol matched this custom endpoint.".to_string())
        }
    }
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
    let api_keys = serde_json::from_str::<HashMap<String, String>>(&content)
        .or_else(|_| {
            serde_json::from_str::<Value>(&content).map(|value| {
                value
                    .get("api_keys")
                    .and_then(Value::as_object)
                    .map(|object| {
                        object
                            .iter()
                            .filter_map(|(key, value)| value.as_str().map(|v| (key.clone(), v.to_string())))
                            .collect::<HashMap<String, String>>()
                    })
                    .unwrap_or_default()
            })
        })
        .map_err(|e| format!("Failed to parse probe secrets: {e}"))?;
    Ok(ProbeSecretsFile { api_keys })
}

fn save_probe_secrets(secrets: &ProbeSecretsFile) -> Result<(), String> {
    let path = probe_secrets_path();
    let json = serde_json::to_string_pretty(&secrets.api_keys)
        .map_err(|e| format!("Failed to serialize probe secrets: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to save probe secrets: {e}"))
}

async fn probe_custom(client: &Client, target: &ProbeCredentialPayload, start: Instant) -> ProbeResult {
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

async fn probe_ollama(client: &Client, target: &ProbeCredentialPayload, start: Instant) -> ProbeResult {
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
        Ok(response) => http_failure_result(response.status(), start, Some("ollama"), "not_required"),
        Err(err) => network_failure_result(err.to_string(), start, Some("ollama")),
    }
}

async fn probe_openai_compatible(
    client: &Client,
    target: &ProbeCredentialPayload,
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
                model_count
                    .map(|count| if count > 0 { "OK_MODELS_FOUND" } else { "OK_CONNECTED" })
                    .unwrap_or("OK_CONNECTED"),
                "OpenAI-compatible endpoint is reachable",
                match model_count {
                    Some(count) if count > 0 => {
                        format!("Connected and found {count} model(s) via the /models endpoint.")
                    }
                    Some(_) => "Connected successfully, but the /models response was empty.".to_string(),
                    None => "Connected successfully. The /models response was reachable but could not be fully parsed.".to_string(),
                },
                start,
                Some("openai_compatible"),
                if target.api_key.trim().is_empty() {
                    "not_provided"
                } else {
                    "authorized"
                },
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
    target: &ProbeCredentialPayload,
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
                model_count
                    .map(|count| if count > 0 { "OK_MODELS_FOUND" } else { "OK_CONNECTED" })
                    .unwrap_or("OK_CONNECTED"),
                "Anthropic endpoint is reachable",
                match model_count {
                    Some(count) if count > 0 => {
                        format!("Connected and found {count} model(s) via GET /v1/models.")
                    }
                    Some(_) => "Connected successfully, but the Anthropic model list was empty.".to_string(),
                    None => "Connected successfully. The Anthropic response was reachable but could not be fully parsed.".to_string(),
                },
                start,
                Some("anthropic"),
                if target.api_key.trim().is_empty() {
                    "not_provided"
                } else {
                    "authorized"
                },
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
    target: &ProbeCredentialPayload,
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
    target: &ProbeCredentialPayload,
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
    target: &ProbeCredentialPayload,
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
    status: reqwest::StatusCode,
    start: Instant,
    detected_protocol: Option<&str>,
    auth_status: &str,
) -> ProbeResult {
    match status {
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => failure_result(
            "ERR_UNAUTHORIZED",
            "Authentication failed",
            "The server is reachable, but the credentials were rejected. Check the API key and required headers.",
            start,
            detected_protocol,
            "unauthorized",
            None,
        ),
        reqwest::StatusCode::NOT_FOUND => failure_result(
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

fn json_response(status: StatusCode, value: Value) -> Response<ProxyBody> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(body)).boxed())
        .unwrap()
}

fn proxy_error_response(status: StatusCode, message: &str) -> Response<ProxyBody> {
    json_response(
        status,
        serde_json::json!({
            "error": {
                "message": message
            }
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener as StdTcpListener;
    use std::sync::Mutex as StdMutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    lazy_static! {
        static ref TEST_GUARD: StdMutex<()> = StdMutex::new(());
    }

    fn free_port() -> u16 {
        let listener = StdTcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        port
    }

    async fn spawn_mock_http_server(
        route_kind: ProbeRouteKind,
        port: u16,
    ) -> tokio::task::JoinHandle<()> {
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let route_kind = route_kind.clone();
                tokio::spawn(async move {
                    let mut buffer = vec![0_u8; 8192];
                    let bytes_read = stream.read(&mut buffer).await.unwrap_or(0);
                    if bytes_read == 0 {
                        return;
                    }
                    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                    let body = match route_kind {
                        ProbeRouteKind::OpenAi => {
                            if request.contains("/models") {
                                if request.contains("purpose=test-query") {
                                    serde_json::json!({ "data": [{ "id": "query-ok-model" }] }).to_string()
                                } else {
                                    serde_json::json!({ "data": [{ "id": "mock-openai-model" }] }).to_string()
                                }
                            } else if request.contains("/responses") {
                                serde_json::json!({
                                    "id": "resp_mock",
                                    "object": "response",
                                    "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "ok-responses" }] }],
                                    "usage": { "input_tokens": 13, "output_tokens": 5, "total_tokens": 18 }
                                }).to_string()
                            } else if request.contains("stream\":true") {
                                "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n".to_string()
                            } else {
                                serde_json::json!({
                                    "id": "chatcmpl-mock",
                                    "object": "chat.completion",
                                    "choices": [{ "message": { "role": "assistant", "content": "ok-openai" } }],
                                    "usage": { "prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18 }
                                }).to_string()
                            }
                        }
                        ProbeRouteKind::Anthropic => {
                            if request.contains("/v1/models") {
                                serde_json::json!({ "data": [{ "id": "mock-claude" }] }).to_string()
                            } else if request.contains("stream\":true") {
                                "event: message_start\ndata: {\"type\":\"message_start\"}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n".to_string()
                            } else if !request.contains("\"max_tokens\"") {
                                serde_json::json!({
                                    "error": { "message": "missing max_tokens" }
                                }).to_string()
                            } else {
                                serde_json::json!({
                                    "id": "msg_mock",
                                    "type": "message",
                                    "content": [{ "type": "text", "text": "ok-anthropic" }],
                                    "usage": { "input_tokens": 9, "output_tokens": 6 }
                                }).to_string()
                            }
                        }
                    };
                    let content_type = if body.starts_with("data:") || body.starts_with("event:") {
                        "text/event-stream"
                    } else {
                        "application/json"
                    };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        content_type,
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        })
    }

    async fn with_test_probe_config<F, Fut>(route_kind: ProbeRouteKind, test_fn: F)
    where
        F: FnOnce(ProbeProxyStatusPayload) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let _guard = TEST_GUARD.lock().unwrap();
        let original = GLOBAL_CONFIG.read().unwrap().clone();
        let upstream_port = free_port();
        let proxy_port = free_port();
        let _server = spawn_mock_http_server(route_kind.clone(), upstream_port).await;

        let credential = ProbeCredential {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Test Upstream".to_string(),
            provider: "Mock".to_string(),
            protocol: if route_kind == ProbeRouteKind::OpenAi {
                ProbeProtocol::OpenAiCompatible
            } else {
                ProbeProtocol::Anthropic
            },
            base_url: format!("http://127.0.0.1:{upstream_port}"),
            default_model: if route_kind == ProbeRouteKind::OpenAi {
                "mock-openai-model".to_string()
            } else {
                "mock-claude".to_string()
            },
            discovered_models: Vec::new(),
            model_catalog_updated_at_ms: None,
            note: String::new(),
            tags: vec!["test".to_string()],
            enabled: true,
            sort_order: 1,
            input_price_per_million: Some(1.0),
            output_price_per_million: Some(2.0),
            price_unit: default_probe_price_unit(),
            price_currency: default_probe_price_currency(),
            last_test_latency_ms: None,
        };

        {
            let mut cfg = GLOBAL_CONFIG.write().unwrap();
            cfg.probe_tool.credentials = vec![credential.clone()];
            cfg.probe_tool.routes = vec![ProbeRoute {
                kind: route_kind.clone(),
                credential_id: credential.id.clone(),
                model_override: String::new(),
                enabled: true,
            }];
            cfg.probe_tool.proxy.listen_host = "127.0.0.1".to_string();
            cfg.probe_tool.proxy.listen_port = proxy_port;
            cfg.probe_tool.proxy.local_token = "yfp-test-token".to_string();
            cfg.probe_tool.timeout_ms = 3000;
        }

        let status = start_proxy().await.unwrap();
        test_fn(status).await;
        let _ = stop_proxy().await;
        {
            let mut cfg = GLOBAL_CONFIG.write().unwrap();
            *cfg = original;
        }
        let _ = clear_proxy_logs().await;
    }

    #[tokio::test]
    async fn proxy_routes_openai_requests_and_records_usage() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/chat/completions", status.openai_endpoint))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .json(&serde_json::json!({
                    "model": "ignored-by-proxy-when-empty",
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["choices"][0]["message"]["content"], "ok-openai");

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs.len(), 1);
            assert_eq!(dashboard.logs[0].route_kind, ProbeRouteKind::OpenAi);
            assert_eq!(dashboard.logs[0].total_tokens, Some(18));
            assert_eq!(dashboard.stats.current_session.total_requests, 1);
            assert_eq!(dashboard.stats.current_session.total_tokens, 18);
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_routes_anthropic_requests_and_records_usage() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/v1/messages", status.anthropic_endpoint))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&serde_json::json!({
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["content"][0]["text"], "ok-anthropic");

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs.len(), 1);
            assert_eq!(dashboard.logs[0].route_kind, ProbeRouteKind::Anthropic);
            assert_eq!(dashboard.logs[0].total_tokens, Some(15));
            assert_eq!(dashboard.stats.current_session.total_requests, 1);
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_rejects_missing_local_token() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/chat/completions", status.openai_endpoint))
                .json(&serde_json::json!({
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert_eq!(response.status(), reqwest::StatusCode::BAD_GATEWAY);
        })
        .await;
    }

    #[test]
    fn proxy_skips_hop_by_hop_and_auth_headers() {
        for header in [
            "host",
            "content-length",
            "authorization",
            "x-api-key",
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
            "http2-settings",
        ] {
            assert!(should_skip_upstream_header(&HeaderName::from_static(header)));
        }
        assert!(!should_skip_upstream_header(&HeaderName::from_static("accept")));
    }

    #[tokio::test]
    async fn proxy_logs_transport_errors_when_upstream_send_fails() {
        let _guard = TEST_GUARD.lock().unwrap();
        let original = GLOBAL_CONFIG.read().unwrap().clone();
        let upstream_port = free_port();
        let proxy_port = free_port();

        let credential = ProbeCredential {
            id: "unreachable-openai".to_string(),
            name: "Broken Upstream".to_string(),
            provider: "Mock".to_string(),
            protocol: ProbeProtocol::OpenAiCompatible,
            base_url: format!("http://127.0.0.1:{upstream_port}"),
            default_model: "mock-openai-model".to_string(),
            discovered_models: Vec::new(),
            model_catalog_updated_at_ms: None,
            note: String::new(),
            tags: vec!["test".to_string()],
            enabled: true,
            sort_order: 1,
            input_price_per_million: Some(1.0),
            output_price_per_million: Some(2.0),
            price_unit: default_probe_price_unit(),
            price_currency: default_probe_price_currency(),
            last_test_latency_ms: None,
        };

        {
            let mut cfg = GLOBAL_CONFIG.write().unwrap();
            cfg.probe_tool.credentials = vec![credential.clone()];
            cfg.probe_tool.routes = vec![ProbeRoute {
                kind: ProbeRouteKind::OpenAi,
                credential_id: credential.id.clone(),
                model_override: String::new(),
                enabled: true,
            }];
            cfg.probe_tool.proxy.listen_host = "127.0.0.1".to_string();
            cfg.probe_tool.proxy.listen_port = proxy_port;
            cfg.probe_tool.proxy.local_token = "yfp-test-token".to_string();
            cfg.probe_tool.timeout_ms = 1500;
        }

        let status = start_proxy().await.unwrap();
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/chat/completions", status.openai_endpoint))
            .header("Authorization", format!("Bearer {}", status.local_token))
            .json(&serde_json::json!({
                "messages": [{ "role": "user", "content": "hello" }]
            }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::BAD_GATEWAY);
        let body: Value = response.json().await.unwrap();
        assert!(
            body["error"]["message"]
                .as_str()
                .unwrap_or_default()
                .contains("FlowProbe upstream request failed")
        );

        let dashboard = probe_dashboard().await.unwrap();
        assert_eq!(dashboard.logs.len(), 1);
        assert!(!dashboard.logs[0].success);
        assert_eq!(dashboard.logs[0].status_code, 502);
        assert!(
            dashboard.logs[0]
                .error_message
                .as_deref()
                .unwrap_or_default()
                .contains("FlowProbe upstream request failed")
        );

        let _ = stop_proxy().await;
        {
            let mut cfg = GLOBAL_CONFIG.write().unwrap();
            *cfg = original;
        }
        let _ = clear_proxy_logs().await;
    }

    #[test]
    fn extract_error_message_decodes_declared_charset() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("text/plain; charset=utf-16le"),
        );
        let bytes = Bytes::from_static(&[
            0x60, 0x4f, 0x7d, 0x59, 0x20, 0x00, 0x34, 0x00, 0x30, 0x00, 0x34, 0x00,
        ]);

        let message = extract_error_message(&bytes, &headers, "/chat/completions");
        assert_eq!(message, "/chat/completions -> 你好 404");
    }

    #[test]
    fn extract_error_message_uses_clean_placeholder_for_binary_body() {
        let headers = reqwest::header::HeaderMap::new();
        let bytes = Bytes::from_static(&[0, 159, 146, 150, 0, 1, 2, 3]);

        let message = extract_error_message(&bytes, &headers, "/chat/completions");
        assert_eq!(
            message,
            "/chat/completions -> [non-text response: 8 bytes]"
        );
    }

    #[test]
    fn should_skip_logging_known_optional_props_probe_404() {
        assert!(!should_log_proxy_activity(
            &ProbeRouteKind::OpenAi,
            "/v1/props",
            reqwest::StatusCode::NOT_FOUND,
        ));
        assert!(!should_log_proxy_activity(
            &ProbeRouteKind::Anthropic,
            "/v1/props",
            reqwest::StatusCode::NOT_FOUND,
        ));
        assert!(!should_log_proxy_activity(
            &ProbeRouteKind::Anthropic,
            "/version",
            reqwest::StatusCode::NOT_FOUND,
        ));
        assert!(should_log_proxy_activity(
            &ProbeRouteKind::OpenAi,
            "/v1/chat/completions",
            reqwest::StatusCode::NOT_FOUND,
        ));
    }

    #[test]
    fn inspect_request_diagnostics_marks_auxiliary_title_candidates() {
        let body = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "system": "Generate a short session title.",
                "messages": [{ "role": "user", "content": "Summarize this conversation in 4 words." }],
                "max_tokens": 32
            }))
            .unwrap(),
        );

        let diagnostics = inspect_request_diagnostics(
            &ProbeRouteKind::Anthropic,
            "/v1/messages",
            "application/json",
            &body,
        );

        assert_eq!(diagnostics.kind, "anthropic.messages");
        assert!(
            diagnostics
                .signature
                .as_deref()
                .unwrap_or_default()
                .contains("markers=")
        );
        assert!(diagnostics
            .flags
            .iter()
            .any(|flag| flag == "aux-title-candidate"));
    }

    #[test]
    fn inspect_response_signature_surfaces_null_anthropic_content() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let body = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "id": "msg_123",
                "type": "message",
                "role": "assistant",
                "content": null,
                "stop_reason": null,
                "usage": {
                    "input_tokens": 12,
                    "output_tokens": 5
                }
            }))
            .unwrap(),
        );

        let signature = inspect_response_signature(&headers, &body, &ProbeProtocol::Anthropic)
            .unwrap_or_default();

        assert!(signature.contains("content=null"));
        assert!(signature.contains("stop_reason=null"));
        assert!(signature.contains("usage=12/5"));
    }

    #[test]
    fn anthropic_stream_diagnostics_summarize_sse_events() {
        let mut diagnostics = AnthropicStreamDiagnostics::default();
        diagnostics.ingest_chunk(
            br#"event: message_start
data: {"type":"message_start","message":{"role":"assistant","content":[],"usage":{"input_tokens":17}}}

event: content_block_start
data: {"type":"content_block_start","content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}

"#,
        );

        let signature = diagnostics.response_signature();
        assert!(signature.contains("events=message_start|content_block_start|content_block_delta|message_delta"));
        assert!(signature.contains("message_start.content=array"));
        assert!(signature.contains("role=assistant"));
        assert!(signature.contains("block_types=text"));
        assert!(signature.contains("delta_types=text_delta"));
        assert!(signature.contains("stop_reason=end_turn"));
        assert!(signature.contains("usage=17/9"));
        assert!(diagnostics.diagnostic_flags().is_empty());
    }

    #[tokio::test]
    async fn proxy_passes_through_openai_streaming_responses() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/chat/completions", status.openai_endpoint))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .json(&serde_json::json!({
                    "stream": true,
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            assert!(content_type.contains("text/event-stream"));
            let body = response.text().await.unwrap();
            assert!(body.contains("data: [DONE]"));

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs.len(), 1);
            assert_eq!(dashboard.logs[0].total_tokens, None);
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_passes_through_anthropic_streaming_responses() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/v1/messages", status.anthropic_endpoint))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&serde_json::json!({
                    "stream": true,
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            assert!(content_type.contains("text/event-stream"));
            let body = response.text().await.unwrap();
            assert!(body.contains("event: message_start"));

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs.len(), 1);
            assert_eq!(dashboard.logs[0].route_kind, ProbeRouteKind::Anthropic);
            assert_eq!(dashboard.logs[0].total_tokens, None);
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_injects_default_max_tokens_for_anthropic_messages() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/v1/messages", status.anthropic_endpoint))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&serde_json::json!({
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["content"][0]["text"], "ok-anthropic");
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_returns_local_openai_models_for_clients() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .get(format!("{}/models?purpose=test-query", status.openai_endpoint))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            let ids: Vec<String> = body["data"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|item| item["id"].as_str().map(str::to_string))
                .collect();
            assert!(ids.contains(&OPENAI_MODEL_ALIAS.to_string()));
            assert!(ids.contains(&"mock-openai-model".to_string()));

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs.len(), 1);
            assert_eq!(dashboard.logs[0].route_kind, ProbeRouteKind::OpenAi);
            assert_eq!(dashboard.logs[0].request_kind, "openai.models");
            assert!(dashboard.logs[0]
                .diagnostic_flags
                .iter()
                .any(|flag| flag == "local-response"));
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_injects_model_and_parses_usage_for_openai_responses() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/responses", status.openai_endpoint))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .json(&serde_json::json!({
                    "input": "hello"
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["output"][0]["content"][0]["text"], "ok-responses");

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs.len(), 1);
            assert_eq!(dashboard.logs[0].route_kind, ProbeRouteKind::OpenAi);
            assert_eq!(dashboard.logs[0].input_tokens, Some(13));
            assert_eq!(dashboard.logs[0].output_tokens, Some(5));
            assert_eq!(dashboard.logs[0].total_tokens, Some(18));
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_exposes_local_openai_model_aliases() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .get(format!("{}/models", status.openai_endpoint))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            let ids: Vec<String> = body["data"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|item| item["id"].as_str().map(str::to_string))
                .collect();
            assert!(ids.contains(&OPENAI_MODEL_ALIAS.to_string()));
            assert!(ids.contains(&"mock-openai-model".to_string()));
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_rewrites_openai_alias_to_current_upstream_model() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/chat/completions", status.openai_endpoint))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .json(&serde_json::json!({
                    "model": OPENAI_MODEL_ALIAS,
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs[0].model, "mock-openai-model");
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_exposes_local_anthropic_model_aliases() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .get(format!("{}/v1/models", status.anthropic_endpoint))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            let ids: Vec<String> = body["data"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|item| item["id"].as_str().map(str::to_string))
                .collect();
            assert!(ids.contains(&ANTHROPIC_MODEL_ALIAS.to_string()));
            assert!(ids.contains(&"mock-claude".to_string()));
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_exposes_local_anthropic_model_aliases_without_v1_prefix() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .get(format!("{}/models", status.anthropic_endpoint))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            let ids: Vec<String> = body["data"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|item| item["id"].as_str().map(str::to_string))
                .collect();
            assert!(ids.contains(&ANTHROPIC_MODEL_ALIAS.to_string()));
            assert!(ids.contains(&"mock-claude".to_string()));
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_rewrites_anthropic_alias_to_current_upstream_model() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{}/v1/messages", status.anthropic_endpoint))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&serde_json::json!({
                    "model": ANTHROPIC_MODEL_ALIAS,
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs[0].model, "mock-claude");
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_accepts_hermes_v4_prefixed_openai_requests() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let base = status.openai_endpoint.trim_end_matches("/v1");
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{base}/v4/v1/chat/completions"))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .json(&serde_json::json!({
                    "model": OPENAI_MODEL_ALIAS,
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["choices"][0]["message"]["content"], "ok-openai");

            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs[0].model, "mock-openai-model");
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_accepts_hermes_v4_prefixed_openai_models() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let base = status.openai_endpoint.trim_end_matches("/v1");
            let client = reqwest::Client::new();
            let response = client
                .get(format!("{base}/v4/v1/models"))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            let ids: Vec<String> = body["data"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|item| item["id"].as_str().map(str::to_string))
                .collect();
            assert!(ids.contains(&OPENAI_MODEL_ALIAS.to_string()));
        })
        .await;
    }

    #[test]
    fn detect_route_kind_treats_anthropic_v1_messages_as_anthropic() {
        let mut headers = hyper::HeaderMap::new();
        headers.insert("x-api-key", HeaderValue::from_static("test"));
        headers.insert("anthropic-version", HeaderValue::from_static(ANTHROPIC_VERSION));
        assert_eq!(
            detect_route_kind("/v1/messages", &headers),
            Some(ProbeRouteKind::Anthropic)
        );
        assert_eq!(
            detect_route_kind("/v1/v1/messages", &headers),
            Some(ProbeRouteKind::Anthropic)
        );
    }

    #[test]
    fn normalize_proxy_path_collapses_duplicate_v1_prefix() {
        assert_eq!(normalize_proxy_path("/v1/v1/messages"), "/v1/messages");
    }

    #[tokio::test]
    async fn proxy_accepts_hermes_anthropic_duplicate_v1_messages() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let base = status.anthropic_endpoint.trim_end_matches("/anthropic");
            let client = reqwest::Client::new();
            let response = client
                .post(format!("{base}/v1/v1/messages"))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&serde_json::json!({
                    "model": ANTHROPIC_MODEL_ALIAS,
                    "messages": [{ "role": "user", "content": "hello" }]
                }))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let dashboard = probe_dashboard().await.unwrap();
            assert_eq!(dashboard.logs[0].route_kind, ProbeRouteKind::Anthropic);
            assert_eq!(dashboard.logs[0].model, "mock-claude");
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_exposes_local_openai_model_detail_alias() {
        with_test_probe_config(ProbeRouteKind::OpenAi, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .get(format!("{}/models/{}", status.openai_endpoint, OPENAI_MODEL_ALIAS))
                .header("Authorization", format!("Bearer {}", status.local_token))
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["id"], OPENAI_MODEL_ALIAS);
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_exposes_local_anthropic_model_detail_alias_without_v1_prefix() {
        with_test_probe_config(ProbeRouteKind::Anthropic, |status| async move {
            let client = reqwest::Client::new();
            let response = client
                .get(format!("{}/models/{}", status.anthropic_endpoint, ANTHROPIC_MODEL_ALIAS))
                .header("x-api-key", status.local_token.clone())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .send()
                .await
                .unwrap();

            assert!(response.status().is_success());
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["id"], ANTHROPIC_MODEL_ALIAS);
        })
        .await;
    }

    #[tokio::test]
    async fn proxy_strips_local_v1_before_forwarding_to_v4_upstream() {
        let _guard = TEST_GUARD.lock().unwrap();
        let original = GLOBAL_CONFIG.read().unwrap().clone();

        let upstream_port = free_port();
        let proxy_port = free_port();
        let _server = spawn_mock_http_server(ProbeRouteKind::OpenAi, upstream_port).await;

        {
            let mut cfg = GLOBAL_CONFIG.write().unwrap();
            let credential = ProbeCredential {
                id: "openai-upstream-v4".to_string(),
                name: "Z AI".to_string(),
                provider: "Z.ai".to_string(),
                protocol: ProbeProtocol::OpenAiCompatible,
                base_url: format!("http://127.0.0.1:{upstream_port}/api/paas/v4"),
                default_model: "glm-5.1".to_string(),
                discovered_models: Vec::new(),
                model_catalog_updated_at_ms: None,
                note: String::new(),
                tags: vec!["cloud".to_string()],
                enabled: true,
                sort_order: 1,
                input_price_per_million: None,
                output_price_per_million: None,
                price_unit: default_probe_price_unit(),
                price_currency: default_probe_price_currency(),
                last_test_latency_ms: None,
            };
            cfg.probe_tool.credentials = vec![credential.clone()];
            cfg.probe_tool.routes = vec![ProbeRoute {
                kind: ProbeRouteKind::OpenAi,
                credential_id: credential.id.clone(),
                model_override: String::new(),
                enabled: true,
            }];
            cfg.probe_tool.proxy.listen_host = "127.0.0.1".to_string();
            cfg.probe_tool.proxy.listen_port = proxy_port;
            cfg.probe_tool.proxy.local_token = "yfp-test-token".to_string();
            cfg.probe_tool.timeout_ms = 3000;
        }

        start_proxy().await.unwrap();
        let status = proxy_status().await.unwrap();
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/chat/completions", status.openai_endpoint))
            .header("Authorization", format!("Bearer {}", status.local_token))
            .json(&serde_json::json!({
                "model": OPENAI_MODEL_ALIAS,
                "messages": [{ "role": "user", "content": "hello" }]
            }))
            .send()
            .await
            .unwrap();

        assert!(response.status().is_success());
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["choices"][0]["message"]["content"], "ok-openai");

        let dashboard = probe_dashboard().await.unwrap();
        assert_eq!(dashboard.logs[0].model, "glm-5.1");

        let _ = stop_proxy().await;
        {
            let mut cfg = GLOBAL_CONFIG.write().unwrap();
            *cfg = original;
        }
        let _ = clear_proxy_logs().await;
    }
}
