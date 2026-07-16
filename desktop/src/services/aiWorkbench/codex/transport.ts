// transport.ts — Codex IPC transport layer
// Encapsulates the three transport mechanisms for Codex app-server communication

import { invoke } from "@tauri-apps/api/core";

export interface CodexAppServerProbeRequest {
  endpoint: string;
  bearer_token?: string | null;
  method: string;
  params: unknown;
}

export interface CodexAppServerProbeResponse {
  ok: boolean;
  status: number;
  elapsed_ms: number;
  transport: string;
  request_body: unknown;
  response_json?: unknown | null;
  response_text: string;
  error?: string | null;
}

export interface CodexAppServerRpcRequest {
  method: string;
  params: Record<string, unknown>;
  id?: string;
}

export interface CodexDesktopIpcRequest {
  command: string;
  payload?: unknown;
}

export interface RpcEnvelope<T> {
  id?: string;
  result?: T;
  error?: { code?: number; message?: string };
}

/**
 * Probe a Codex app-server endpoint (direct stdio-based check)
 */
export async function probeCodexAppServer(
  request: CodexAppServerProbeRequest
): Promise<CodexAppServerProbeResponse> {
  return invoke<CodexAppServerProbeResponse>("codex_app_server_probe", { request });
}

/**
 * Send an RPC request to the Codex app-server (persistent connection)
 */
export async function requestCodexAppServer<T = unknown>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const response = await invoke<RpcEnvelope<T>>("codex_app_server_request", {
    request: { method, params } as CodexAppServerRpcRequest,
  });
  return getResult(response);
}

/**
 * Send a desktop IPC request
 */
export async function requestCodexDesktopIpc<T = unknown>(
  request: CodexDesktopIpcRequest
): Promise<T> {
  const response = await invoke<RpcEnvelope<T>>("codex_desktop_ipc_request", { request });
  return getResult(response);
}

function getResult<T>(envelope: RpcEnvelope<T>): T {
  if (envelope.error) {
    throw new Error(envelope.error.message || `RPC error: ${envelope.error.code}`);
  }
  if (envelope.result === undefined) {
    throw new Error("RPC returned no result");
  }
  return envelope.result;
}
