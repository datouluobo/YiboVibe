use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

#[derive(Debug, Deserialize)]
pub struct CodexAppServerProbeRequest {
    pub endpoint: String,
    pub bearer_token: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct CodexAppServerProbeResponse {
    pub ok: bool,
    pub status: u16,
    pub elapsed_ms: u128,
    pub transport: String,
    pub request_body: Value,
    pub response_json: Option<Value>,
    pub response_text: String,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CodexAppServerRpcRequest {
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Deserialize)]
pub struct CodexDesktopIpcRequest {
    pub method: String,
    #[serde(default)]
    pub params: Value,
    pub version: Option<u32>,
}

struct CodexAppServerSession {
    stdin: Mutex<tokio::process::ChildStdin>,
    child: Mutex<Option<tokio::process::Child>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    codex_exe: String,
}

lazy_static::lazy_static! {
    static ref PERSISTENT_SESSION: Mutex<Option<Arc<CodexAppServerSession>>> = Mutex::new(None);
}

fn trimmed_non_empty(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

pub async fn persistent_request(
    app: AppHandle,
    request: CodexAppServerRpcRequest,
) -> Result<Value, String> {
    let method = trimmed_non_empty(&request.method, "JSON-RPC method")?;
    let session = ensure_persistent_session(app).await?;
    session
        .request(&method, request.params, Duration::from_secs(45))
        .await
}

pub async fn disconnect_persistent_session() -> Result<(), String> {
    let session = PERSISTENT_SESSION.lock().await.take();
    if let Some(session) = session {
        if let Some(mut child) = session.child.lock().await.take() {
            let _ = child.kill().await;
        }
    }
    Ok(())
}

pub async fn desktop_ipc_request(
    app: AppHandle,
    request: CodexDesktopIpcRequest,
) -> Result<Value, String> {
    let method = trimmed_non_empty(&request.method, "IPC method")?;
    desktop_ipc_request_platform(app, method, request.params, request.version.unwrap_or(0)).await
}

async fn ensure_persistent_session(app: AppHandle) -> Result<Arc<CodexAppServerSession>, String> {
    if let Some(session) = PERSISTENT_SESSION.lock().await.clone() {
        return Ok(session);
    }

    let session = start_persistent_session(app).await?;
    {
        let mut current = PERSISTENT_SESSION.lock().await;
        if let Some(existing) = current.clone() {
            return Ok(existing);
        }
        *current = Some(session.clone());
    }

    if let Err(err) = initialize_persistent_session(&session).await {
        let _ = disconnect_persistent_session().await;
        return Err(err);
    }

    Ok(session)
}

async fn start_persistent_session(app: AppHandle) -> Result<Arc<CodexAppServerSession>, String> {
    let codex_exe = resolve_codex_exe();
    let mut child = Command::new(&codex_exe)
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to spawn Codex app-server via {codex_exe}: {err}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or("Failed to open Codex app-server stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to open Codex app-server stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to open Codex app-server stderr")?;

    let session = Arc::new(CodexAppServerSession {
        stdin: Mutex::new(stdin),
        child: Mutex::new(Some(child)),
        pending: Mutex::new(HashMap::new()),
        codex_exe,
    });

    spawn_stdout_reader(app.clone(), session.clone(), stdout);
    spawn_stderr_reader(app, stderr);

    Ok(session)
}

async fn initialize_persistent_session(session: &Arc<CodexAppServerSession>) -> Result<(), String> {
    session
        .request(
            "initialize",
            serde_json::json!({
                "clientInfo": {
                    "name": "yibovibe-desktop",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {
                    "experimentalApi": true,
                }
            }),
            Duration::from_secs(8),
        )
        .await?;
    session.notify("initialized").await
}

fn spawn_stdout_reader(
    app: AppHandle,
    session: Arc<CodexAppServerSession>,
    stdout: tokio::process::ChildStdout,
) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let next_line = lines.next_line().await;
            let line = match next_line {
                Ok(Some(line)) => line,
                Ok(None) => break,
                Err(err) => {
                    let _ = app.emit(
                        "codex-app-server-event",
                        serde_json::json!({
                            "type": "transportError",
                            "message": format!("Failed to read Codex app-server stdout: {err}"),
                        }),
                    );
                    break;
                }
            };

            let parsed = match serde_json::from_str::<Value>(&line) {
                Ok(value) => value,
                Err(_) => {
                    let _ = app.emit(
                        "codex-app-server-event",
                        serde_json::json!({
                            "type": "raw",
                            "line": line,
                        }),
                    );
                    continue;
                }
            };

            let response_id = parsed
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            if let Some(id) = response_id {
                if let Some(sender) = session.pending.lock().await.remove(&id) {
                    let _ = sender.send(parsed);
                    continue;
                }
            }

            let _ = app.emit("codex-app-server-event", parsed);
        }

        let _ = app.emit(
            "codex-app-server-event",
            serde_json::json!({
                "type": "disconnected",
                "transport": "stdio",
                "codexExe": session.codex_exe,
            }),
        );
        let mut current = PERSISTENT_SESSION.lock().await;
        if current
            .as_ref()
            .map(|value| Arc::ptr_eq(value, &session))
            .unwrap_or(false)
        {
            *current = None;
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: tokio::process::ChildStderr) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let _ = app.emit(
                "codex-app-server-event",
                serde_json::json!({
                    "type": "stderr",
                    "line": trimmed,
                }),
            );
        }
    });
}

impl CodexAppServerSession {
    async fn request(
        &self,
        method: &str,
        params: Value,
        wait_for: Duration,
    ) -> Result<Value, String> {
        let id = format!("yibovibe-codex-rpc-{}", uuid::Uuid::new_v4());
        let body = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), sender);

        if let Err(err) = self.write_frame(&body).await {
            let _ = self.pending.lock().await.remove(&id);
            return Err(err);
        }

        let response = timeout(wait_for, receiver)
            .await
            .map_err(|_| format!("Timed out waiting for Codex app-server response to {method}"))?
            .map_err(|_| format!("Codex app-server response channel closed for {method}"))?;
        if let Some(error) = response.get("error") {
            return Err(error.to_string());
        }
        Ok(response)
    }

    async fn notify(&self, method: &str) -> Result<(), String> {
        let body = serde_json::json!({
            "method": method,
        });
        self.write_frame(&body).await
    }

    async fn write_frame(&self, body: &Value) -> Result<(), String> {
        let frame = format!("{body}\n");
        let mut stdin = self.stdin.lock().await;
        timeout(Duration::from_secs(3), stdin.write_all(frame.as_bytes()))
            .await
            .map_err(|_| "Timed out writing request to Codex app-server stdio".to_string())?
            .map_err(|err| format!("Failed to write request to Codex app-server stdio: {err}"))
    }
}

fn build_headers(token: Option<&str>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    if let Some(token) = token.map(str::trim).filter(|value| !value.is_empty()) {
        let value = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|err| format!("Invalid bearer token header: {err}"))?;
        headers.insert(AUTHORIZATION, value);
    }

    Ok(headers)
}

pub async fn probe(
    request: CodexAppServerProbeRequest,
) -> Result<CodexAppServerProbeResponse, String> {
    let endpoint = trimmed_non_empty(&request.endpoint, "Endpoint")?;
    let method = trimmed_non_empty(&request.method, "JSON-RPC method")?;
    let request_body = serde_json::json!({
        "id": format!("yibovibe-codex-probe-{}", uuid::Uuid::new_v4()),
        "method": method,
        "params": request.params,
    });

    if endpoint == "stdio://" {
        return probe_stdio(request_body).await;
    }

    if endpoint.starts_with(r"\\.\pipe\") {
        return probe_named_pipe(&endpoint, request_body).await;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))?;

    let started = Instant::now();
    let response = client
        .post(endpoint)
        .headers(build_headers(request.bearer_token.as_deref())?)
        .json(&request_body)
        .send()
        .await
        .map_err(|err| format!("Codex App Server request failed: {err}"))?;

    let status = response.status().as_u16();
    let response_text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read Codex App Server response: {err}"))?;
    let response_json = serde_json::from_str::<Value>(&response_text).ok();
    let rpc_error = response_json
        .as_ref()
        .and_then(|value| value.get("error"))
        .map(|value| value.to_string());

    Ok(CodexAppServerProbeResponse {
        ok: (200..300).contains(&status) && rpc_error.is_none(),
        status,
        elapsed_ms: started.elapsed().as_millis(),
        transport: "http".to_string(),
        request_body,
        response_json,
        response_text,
        error: rpc_error,
    })
}

fn resolve_codex_exe() -> String {
    if let Ok(path) = std::env::var("CODEX_EXE") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    #[cfg(windows)]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let bin_root = PathBuf::from(local_app_data)
                .join("OpenAI")
                .join("Codex")
                .join("bin");
            if let Ok(entries) = std::fs::read_dir(bin_root) {
                let mut candidates = entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path().join("codex.exe"))
                    .filter(|path| path.exists())
                    .collect::<Vec<_>>();
                candidates.sort();
                if let Some(path) = candidates.pop() {
                    return path.to_string_lossy().into_owned();
                }
            }
        }
    }

    "codex".to_string()
}

async fn probe_stdio(request_body: Value) -> Result<CodexAppServerProbeResponse, String> {
    let started = Instant::now();
    let codex_exe = resolve_codex_exe();
    let mut child = Command::new(&codex_exe)
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to spawn Codex app-server via {codex_exe}: {err}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or("Failed to open Codex app-server stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to open Codex app-server stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to open Codex app-server stderr")?;
    let request_id = request_body
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let needs_initialize = request_body
        .get("method")
        .and_then(Value::as_str)
        .map(|method| method != "initialize")
        .unwrap_or(true);

    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut response_lines = Vec::new();
    let mut response_json = None;

    if needs_initialize {
        let initialize_id = format!("yibovibe-codex-init-{}", uuid::Uuid::new_v4());
        let initialize_body = serde_json::json!({
            "id": initialize_id,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "yibovibe-desktop",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {
                    "experimentalApi": true,
                }
            }
        });
        write_stdio_frame(&mut stdin, &initialize_body).await?;
        read_stdio_response(
            &mut stdout_lines,
            &mut response_lines,
            initialize_id.as_str(),
            Duration::from_secs(8),
        )
        .await?;
        write_stdio_frame(
            &mut stdin,
            &serde_json::json!({
                "method": "initialized",
            }),
        )
        .await?;
    }

    write_stdio_frame(&mut stdin, &request_body).await?;
    let _ = stdin.shutdown().await;

    let read_result = timeout(Duration::from_secs(8), async {
        while let Some(line) = stdout_lines
            .next_line()
            .await
            .map_err(|err| format!("Failed to read Codex app-server stdout: {err}"))?
        {
            let parsed = serde_json::from_str::<Value>(&line).ok();
            response_lines.push(line);
            if parsed
                .as_ref()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                == Some(request_id.as_str())
            {
                response_json = parsed;
                break;
            }
        }
        Ok::<(), String>(())
    })
    .await;

    let mut stderr_reader = BufReader::new(stderr);
    let mut stderr_text = String::new();
    let _ = timeout(
        Duration::from_millis(300),
        stderr_reader.read_line(&mut stderr_text),
    )
    .await;
    let _ = child.kill().await;

    match read_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => return Err(err),
        Err(_) => return Err("Timed out waiting for Codex app-server stdio response".to_string()),
    }

    let response_text = response_lines.join("\n");
    let rpc_error = response_json
        .as_ref()
        .and_then(|value| value.get("error"))
        .map(|value| value.to_string());
    let has_result = response_json
        .as_ref()
        .and_then(|value| value.get("result"))
        .is_some();

    Ok(CodexAppServerProbeResponse {
        ok: has_result && rpc_error.is_none(),
        status: if response_json.is_some() { 200 } else { 204 },
        elapsed_ms: started.elapsed().as_millis(),
        transport: "stdio".to_string(),
        request_body,
        response_json,
        response_text: if stderr_text.trim().is_empty() {
            response_text
        } else {
            format!("{response_text}\n\n[stderr]\n{stderr_text}")
        },
        error: rpc_error,
    })
}

async fn write_stdio_frame(
    stdin: &mut tokio::process::ChildStdin,
    body: &Value,
) -> Result<(), String> {
    let frame = format!("{body}\n");
    timeout(Duration::from_secs(3), stdin.write_all(frame.as_bytes()))
        .await
        .map_err(|_| "Timed out writing request to Codex app-server stdio".to_string())?
        .map_err(|err| format!("Failed to write request to Codex app-server stdio: {err}"))
}

async fn read_stdio_response(
    stdout_lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    response_lines: &mut Vec<String>,
    request_id: &str,
    wait_for: Duration,
) -> Result<Value, String> {
    timeout(wait_for, async {
        while let Some(line) = stdout_lines
            .next_line()
            .await
            .map_err(|err| format!("Failed to read Codex app-server stdout: {err}"))?
        {
            let parsed = serde_json::from_str::<Value>(&line).ok();
            response_lines.push(line);
            if parsed
                .as_ref()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                == Some(request_id)
            {
                return parsed.ok_or("Codex app-server returned invalid JSON".to_string());
            }
        }
        Err("Codex app-server stdout closed before response".to_string())
    })
    .await
    .map_err(|_| "Timed out waiting for Codex app-server stdio response".to_string())?
}

#[cfg(windows)]
async fn probe_named_pipe(
    endpoint: &str,
    request_body: Value,
) -> Result<CodexAppServerProbeResponse, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::ClientOptions;

    let started = Instant::now();
    let mut client = ClientOptions::new()
        .open(endpoint)
        .map_err(|err| format!("Failed to open named pipe {endpoint}: {err}"))?;
    let frame = format!("{request_body}\n");

    timeout(Duration::from_secs(3), client.write_all(frame.as_bytes()))
        .await
        .map_err(|_| "Timed out writing JSON-RPC frame to named pipe".to_string())?
        .map_err(|err| format!("Failed to write JSON-RPC frame to named pipe: {err}"))?;

    let mut buffer = vec![0u8; 64 * 1024];
    let read = timeout(Duration::from_secs(5), client.read(&mut buffer))
        .await
        .map_err(|_| "Timed out waiting for named pipe response".to_string())?
        .map_err(|err| format!("Failed to read named pipe response: {err}"))?;
    let response_text = String::from_utf8_lossy(&buffer[..read]).to_string();
    let response_json = serde_json::from_str::<Value>(response_text.trim()).ok();
    let rpc_error = response_json
        .as_ref()
        .and_then(|value| value.get("error"))
        .map(|value| value.to_string());

    Ok(CodexAppServerProbeResponse {
        ok: read > 0 && rpc_error.is_none(),
        status: if read > 0 { 200 } else { 204 },
        elapsed_ms: started.elapsed().as_millis(),
        transport: "named_pipe".to_string(),
        request_body,
        response_json,
        response_text,
        error: rpc_error,
    })
}

#[cfg(windows)]
async fn desktop_ipc_request_platform(
    app: AppHandle,
    method: String,
    params: Value,
    version: u32,
) -> Result<Value, String> {
    use tokio::net::windows::named_pipe::ClientOptions;

    const CODEX_IPC_PIPE: &str = r"\\.\pipe\codex-ipc";
    const INITIALIZING_CLIENT: &str = "initializing-client";

    let mut client = ClientOptions::new()
        .open(CODEX_IPC_PIPE)
        .map_err(|err| format!("Failed to open Codex Desktop IPC pipe {CODEX_IPC_PIPE}: {err}"))?;

    let initialize_id = uuid::Uuid::new_v4().to_string();
    let initialize = serde_json::json!({
        "type": "request",
        "requestId": initialize_id,
        "sourceClientId": INITIALIZING_CLIENT,
        "method": "initialize",
        "params": {
            "clientType": "yibovibe-desktop"
        }
    });
    write_ipc_frame(&mut client, &initialize).await?;

    let initialize_response = read_ipc_response(
        &mut client,
        &app,
        initialize_id.as_str(),
        Duration::from_secs(5),
    )
    .await?;

    if initialize_response
        .get("resultType")
        .and_then(Value::as_str)
        != Some("success")
    {
        return Err(format!(
            "Codex Desktop IPC initialize failed: {}",
            format_json_compact(&initialize_response)
        ));
    }

    let client_id = initialize_response
        .get("result")
        .and_then(|value| value.get("clientId"))
        .and_then(Value::as_str)
        .ok_or("Codex Desktop IPC initialize did not return a clientId")?
        .to_string();

    let request_id = uuid::Uuid::new_v4().to_string();
    let body = serde_json::json!({
        "type": "request",
        "requestId": request_id,
        "sourceClientId": client_id,
        "version": version,
        "method": method,
        "params": params,
    });
    write_ipc_frame(&mut client, &body).await?;

    read_ipc_response(
        &mut client,
        &app,
        request_id.as_str(),
        Duration::from_secs(12),
    )
    .await
}

#[cfg(windows)]
async fn write_ipc_frame(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    body: &Value,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let payload =
        serde_json::to_vec(body).map_err(|err| format!("Failed to encode IPC JSON: {err}"))?;
    let len = u32::try_from(payload.len()).map_err(|_| "IPC payload is too large".to_string())?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&len.to_le_bytes());
    frame.extend_from_slice(&payload);
    timeout(Duration::from_secs(3), client.write_all(&frame))
        .await
        .map_err(|_| "Timed out writing Codex Desktop IPC frame".to_string())?
        .map_err(|err| format!("Failed to write Codex Desktop IPC frame: {err}"))
}

#[cfg(windows)]
async fn read_ipc_response(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    app: &AppHandle,
    request_id: &str,
    wait_for: Duration,
) -> Result<Value, String> {
    timeout(wait_for, async {
        loop {
            let message = read_ipc_frame(client).await?;
            let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");

            if message_type == "response"
                && message.get("requestId").and_then(Value::as_str) == Some(request_id)
            {
                if message.get("resultType").and_then(Value::as_str) == Some("error") {
                    return Err(message
                        .get("error")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .unwrap_or_else(|| format_json_compact(&message)));
                }
                return Ok(message);
            }

            if message_type == "client-discovery-request" {
                if let Some(discovery_id) = message.get("requestId").and_then(Value::as_str) {
                    let response = serde_json::json!({
                        "type": "client-discovery-response",
                        "requestId": discovery_id,
                        "response": {
                            "canHandle": false
                        }
                    });
                    write_ipc_frame(client, &response).await?;
                }
                continue;
            }

            let _ = app.emit("codex-desktop-ipc-event", message);
        }
    })
    .await
    .map_err(|_| format!("Timed out waiting for Codex Desktop IPC response to {request_id}"))?
}

#[cfg(windows)]
async fn read_ipc_frame(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
) -> Result<Value, String> {
    use tokio::io::AsyncReadExt;

    let mut len_bytes = [0u8; 4];
    client
        .read_exact(&mut len_bytes)
        .await
        .map_err(|err| format!("Failed to read Codex Desktop IPC frame length: {err}"))?;
    let len = u32::from_le_bytes(len_bytes) as usize;
    if len > 256 * 1024 * 1024 {
        return Err(format!("Codex Desktop IPC frame is too large: {len} bytes"));
    }

    let mut payload = vec![0u8; len];
    client
        .read_exact(&mut payload)
        .await
        .map_err(|err| format!("Failed to read Codex Desktop IPC frame payload: {err}"))?;
    serde_json::from_slice::<Value>(&payload)
        .map_err(|err| format!("Failed to parse Codex Desktop IPC JSON: {err}"))
}

fn format_json_compact(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
}

#[cfg(not(windows))]
async fn probe_named_pipe(
    endpoint: &str,
    _request_body: Value,
) -> Result<CodexAppServerProbeResponse, String> {
    Err(format!(
        "Named pipe endpoint {endpoint} can only be probed on Windows"
    ))
}

#[cfg(not(windows))]
async fn desktop_ipc_request_platform(
    _app: AppHandle,
    _method: String,
    _params: Value,
    _version: u32,
) -> Result<Value, String> {
    Err("Codex Desktop IPC is only available on Windows".to_string())
}
