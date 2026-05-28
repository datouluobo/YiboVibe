import { invoke } from "@tauri-apps/api/core";
import {
  stableProjectId,
  type AiWorkbenchConfig,
  type AiWorkbenchConversation,
  type AiWorkbenchMessage,
  type AiWorkbenchModel,
  type AiWorkbenchProject,
  type AiWorkbenchProvider,
  type AiWorkbenchStatus,
} from "./aiWorkbench";

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

export interface RpcEnvelope<T> {
  id?: string;
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
}

export interface ThreadListResult {
  data?: CodexThread[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

export interface CodexThread {
  id: string;
  sessionId?: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
  path?: string | null;
  cliVersion?: string | null;
  source?: string | null;
  createdAt?: number;
  updatedAt?: number;
  gitInfo?: {
    branch?: string | null;
    originUrl?: string | null;
    sha?: string | null;
  } | null;
  status?: {
    type?: string;
    [key: string]: unknown;
  };
  turns?: CodexTurn[];
}

export interface DesktopConversationState {
  id?: string;
  title?: string | null;
  cwd?: string | null;
  source?: string | null;
  modelProvider?: string | null;
  gitInfo?: CodexThread["gitInfo"];
  turns?: CodexTurn[];
}

export interface ThreadReadResult {
  thread?: CodexThread;
}

export interface CodexTurn {
  id?: string;
  turnId?: string;
  input?: string;
  params?: {
    input?: unknown;
    cwd?: string | null;
    model?: string | null;
    effort?: string | null;
    [key: string]: unknown;
  };
  items?: CodexThreadItem[];
  startedAt?: string;
  completedAt?: string;
  status?: string;
}

export interface CodexThreadItem {
  type?: string;
  text?: string;
  content?: unknown;
  summary?: unknown;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string;
  exitCode?: number | null;
  status?: string;
  changes?: unknown;
  name?: string;
  arguments?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

export interface ModelListResult {
  data?: CodexModel[];
}

export interface CodexModel {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string | null;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: string[];
}

export interface ConfigReadResult {
  config?: {
    model?: string;
    model_provider?: string;
    approval_policy?: string;
    sandbox_mode?: string;
    service_tier?: string;
    cwd?: string;
    [key: string]: unknown;
  };
}

export interface AuthStatusResult {
  authMethod?: string | null;
  requiresOpenaiAuth?: boolean;
}

export interface ConversationSummaryResult {
  summary?: ConversationSummary;
}

export interface ConversationSummary {
  conversationId?: string;
  path?: string;
  preview?: string;
  timestamp?: string | null;
  updatedAt?: string | null;
  modelProvider?: string;
  cwd?: string;
  cliVersion?: string;
  source?: string;
  gitInfo?: {
    branch?: string | null;
    originUrl?: string | null;
    sha?: string | null;
  } | null;
}

export interface TurnStartResult {
  turn?: CodexTurn;
}

export interface DesktopIpcResponse<T> {
  type?: string;
  resultType?: string;
  method?: string;
  handledByClientId?: string;
  result?: T;
  error?: string;
}

export interface ThreadResumeResult {
  thread?: CodexThread;
}

export interface ThreadStartResult {
  thread?: CodexThread;
}

export interface ThreadLoadedListResult {
  data?: string[];
  nextCursor?: string | null;
}

export interface ProjectSummary {
  cwd: string;
  name: string;
  threads: CodexThread[];
  latestThread: CodexThread;
  branches: string[];
  originUrl?: string | null;
  updatedAt?: number;
}

export type CodexConversationStatus = AiWorkbenchStatus;

export const CODEX_ENDPOINT = "stdio://";
export const CODEX_CLIENT_VERSION = "0.9.7-r27";
export const CODEX_PROVIDER: AiWorkbenchProvider = {
  id: "codex",
  name: "Codex",
  transport: "app-server",
  capabilities: [
    "project-list",
    "conversation-list",
    "conversation-read",
    "conversation-create",
    "conversation-rename",
    "conversation-archive",
    "message-send",
    "turn-cancel",
    "model-list",
    "config-read",
    "config-write",
    "event-stream",
  ],
};
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];
export const REASONING_SUMMARIES = ["auto", "concise", "detailed", "none"];
export const APPROVAL_POLICIES = ["on-request", "untrusted", "on-failure", "never"];
export const SANDBOX_MODES = ["workspace-write", "read-only", "danger-full-access"];
export const CHAT_VISIBLE_TYPES = new Set(["userMessage", "agentMessage"]);

export const SAMPLE_METHODS = [
  "initialize",
  "thread/list",
  "thread/start",
  "thread/read",
  "thread/loaded/list",
  "thread/name/set",
  "thread/archive",
  "turn/interrupt",
  "model/list",
  "config/read",
  "config/batchWrite",
  "account/read",
  "getAuthStatus",
];

export const DEFAULT_PARAMS_BY_METHOD: Record<string, string> = {
  initialize:
    `{\n  "clientInfo": {\n    "name": "yibovibe-desktop",\n    "version": "${CODEX_CLIENT_VERSION}"\n  },\n  "capabilities": {\n    "experimentalApi": true\n  }\n}`,
  "thread/list": "{\n  \"limit\": 50,\n  \"archived\": false\n}",
  "thread/start": "{\n  \"cwd\": \"\",\n  \"model\": null\n}",
  "thread/read": "{\n  \"threadId\": \"\",\n  \"includeTurns\": true\n}",
  "thread/loaded/list": "{}",
  "thread/name/set": "{\n  \"threadId\": \"\",\n  \"name\": \"\"\n}",
  "thread/archive": "{\n  \"threadId\": \"\"\n}",
  "turn/interrupt": "{\n  \"threadId\": \"\",\n  \"turnId\": \"\"\n}",
  "model/list": "{\n  \"includeHidden\": false\n}",
  "config/read": "{\n  \"includeLayers\": true\n}",
  "config/batchWrite": "{\n  \"edits\": [],\n  \"reloadUserConfig\": true\n}",
  "account/read": "{}",
  getAuthStatus: "{\n  \"includeToken\": false,\n  \"refreshToken\": false\n}",
};

export function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getResult<T>(response: CodexAppServerProbeResponse): T {
  const envelope = response.response_json as RpcEnvelope<T> | undefined | null;
  if (!response.ok || envelope?.error) {
    throw new Error(envelope?.error?.message || response.error || "Codex App Server request failed");
  }
  return (envelope?.result ?? {}) as T;
}

export function getRpcResult<T>(value: unknown): T {
  const envelope = value as RpcEnvelope<T> | undefined | null;
  if (envelope?.error) {
    throw new Error(envelope.error.message || formatJson(envelope.error));
  }
  return (envelope?.result ?? {}) as T;
}

export function getIpcResult<T>(value: unknown): T {
  const envelope = value as DesktopIpcResponse<T> | undefined | null;
  if (envelope?.resultType === "error" || envelope?.error) {
    throw new Error(envelope?.error || "Codex Desktop IPC request failed");
  }
  return (envelope?.result ?? {}) as T;
}

export async function probeCodexAppServer<T>(
  endpoint: string,
  rpcMethod: string,
  params: unknown,
  bearerToken = "",
) {
  const payload: CodexAppServerProbeRequest = {
    endpoint,
    bearer_token: bearerToken.trim() ? bearerToken.trim() : null,
    method: rpcMethod,
    params,
  };
  const response = await invoke<CodexAppServerProbeResponse>("codex_app_server_probe", {
    request: payload,
  });
  return { response, result: getResult<T>(response) };
}

export async function requestCodexAppServer<T>(rpcMethod: string, params: unknown) {
  const response = await invoke<unknown>("codex_app_server_request", {
    request: {
      method: rpcMethod,
      params,
    },
  });
  return getRpcResult<T>(response);
}

export async function requestCodexDesktopIpc<T>(ipcMethod: string, params: unknown, version = 0) {
  const response = await invoke<unknown>("codex_desktop_ipc_request", {
    request: {
      method: ipcMethod,
      params,
      version,
    },
  });
  return getIpcResult<T>(response);
}

export function projectNameFromPath(path: string) {
  const clean = path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

export function formatTime(value?: number | string) {
  if (!value) return "未知";
  const date =
    typeof value === "number"
      ? new Date(value > 20_000_000_000 ? value : value * 1000)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString();
}

export function formatRelativeAge(value?: number | string) {
  if (!value) return "";
  const date =
    typeof value === "number"
      ? new Date(value > 20_000_000_000 ? value : value * 1000)
      : new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))} 分`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} 小时`;
  if (diffMs < week) return `${Math.round(diffMs / day)} 天`;
  return `${Math.round(diffMs / week)} 周`;
}

export function summarizeThread(thread: CodexThread) {
  return thread.name || thread.preview || thread.id;
}

export function buildProjectSummaries(threads: CodexThread[]): ProjectSummary[] {
  const groups = new Map<string, CodexThread[]>();
  for (const thread of threads) {
    const cwd = thread.cwd || "(unknown)";
    groups.set(cwd, [...(groups.get(cwd) ?? []), thread]);
  }

  return Array.from(groups.entries())
    .map(([cwd, groupedThreads]) => {
      const sorted = [...groupedThreads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      const latestThread = sorted[0];
      const branches = Array.from(
        new Set(sorted.map((thread) => thread.gitInfo?.branch).filter(Boolean) as string[]),
      );
      return {
        cwd,
        name: cwd === "(unknown)" ? "未知项目" : projectNameFromPath(cwd),
        threads: sorted,
        latestThread,
        branches,
        originUrl: latestThread.gitInfo?.originUrl,
        updatedAt: latestThread.updatedAt,
      };
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function toWorkbenchProject(project: ProjectSummary): AiWorkbenchProject {
  return {
    id: stableProjectId(CODEX_PROVIDER.id, project.cwd),
    providerId: CODEX_PROVIDER.id,
    name: project.name,
    path: project.cwd,
    conversationIds: project.threads.map((thread) => thread.id),
    branches: project.branches,
    originUrl: project.originUrl,
    updatedAt: project.updatedAt,
  };
}

export function toWorkbenchConversation(thread: CodexThread): AiWorkbenchConversation {
  return {
    id: thread.id,
    providerId: CODEX_PROVIDER.id,
    projectId: stableProjectId(CODEX_PROVIDER.id, thread.cwd || "(unknown)"),
    title: summarizeThread(thread),
    preview: thread.preview,
    cwd: thread.cwd,
    source: thread.source,
    cliVersion: thread.cliVersion,
    status: normalizeThreadStatus(thread),
    gitInfo: thread.gitInfo,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    raw: thread,
  };
}

export function normalizeThreadStatus(thread?: CodexThread | null): CodexConversationStatus {
  if (!thread) return "notLoaded";
  const rawStatus = thread.status?.type;
  if (hasInProgressTurn(thread)) return "running";
  if (rawStatus === "notLoaded") return "notLoaded";
  if (rawStatus === "loading") return "loading";
  if (rawStatus === "loaded") return "idle";
  if (rawStatus === "running" || rawStatus === "waitingApproval" || rawStatus === "failed" || rawStatus === "offline") {
    return rawStatus;
  }
  return "idle";
}

export function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text?: unknown }).text ?? "");
  }
  return "";
}

export function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  const collected = collectText(value);
  if (collected) return collected;
  if (value === null || value === undefined) return "";
  return formatJson(value);
}

export function asStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return values.length ? values : fallback;
}

export function describeItem(item: CodexThreadItem) {
  const type = item.type || "item";

  if (type === "userMessage") {
    return { role: "user", title: "用户", text: collectText(item.content) || toDisplayText(item.text) };
  }

  if (type === "agentMessage") {
    return { role: "assistant", title: "Codex", text: toDisplayText(item.text) || collectText(item.content) };
  }

  if (type === "reasoning") {
    return { role: "system", title: "推理摘要", text: collectText(item.summary) || collectText(item.content) };
  }

  if (type === "commandExecution") {
    const details = [
      item.command ? `$ ${item.command}` : "",
      item.cwd ? `cwd: ${item.cwd}` : "",
      item.status ? `status: ${item.status}` : "",
      item.exitCode !== undefined && item.exitCode !== null ? `exit: ${item.exitCode}` : "",
      item.aggregatedOutput || "",
    ].filter(Boolean);
    return { role: "tool", title: "命令执行", text: details.join("\n") };
  }

  if (type === "fileChange") {
    return { role: "tool", title: "文件变更", text: formatJson(item.changes ?? item) };
  }

  if (type === "mcpToolCall") {
    return {
      role: "tool",
      title: item.name ? `工具调用: ${item.name}` : "工具调用",
      text: formatJson({ arguments: item.arguments, result: item.result }),
    };
  }

  return { role: "system", title: type, text: formatJson(item) };
}

export function toWorkbenchMessage(
  item: CodexThreadItem,
  index: number,
  conversationId?: string,
): AiWorkbenchMessage {
  const described = describeItem(item);
  return {
    id: `${conversationId || "codex"}:${item.type || "item"}:${index}`,
    providerId: CODEX_PROVIDER.id,
    conversationId,
    role: described.role as AiWorkbenchMessage["role"],
    title: described.title,
    text: described.text,
    status: item.status,
    rawType: item.type,
    raw: item,
  };
}

export function toWorkbenchMessages(thread?: CodexThread | null, includeTechnical = false): AiWorkbenchMessage[] {
  const items = (thread?.turns ?? []).flatMap((turn) => turn.items ?? []);
  return items
    .filter((item) => includeTechnical || isChatVisibleItem(item))
    .map((item, index) => toWorkbenchMessage(item, index, thread?.id));
}

export function toWorkbenchModel(model: CodexModel): AiWorkbenchModel {
  const id = model.id || model.model || "";
  return {
    id,
    providerId: CODEX_PROVIDER.id,
    label: model.displayName || model.model || model.id || "Unknown model",
    description: model.description,
    hidden: model.hidden,
    isDefault: model.isDefault,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    raw: model,
  };
}

export function toWorkbenchConfig(config?: ConfigReadResult["config"] | null): AiWorkbenchConfig {
  return {
    providerId: CODEX_PROVIDER.id,
    model: config?.model,
    modelProvider: config?.model_provider,
    approvalPolicy: config?.approval_policy,
    sandboxMode: config?.sandbox_mode,
    serviceTier: config?.service_tier,
    cwd: config?.cwd,
    raw: config,
  };
}

export function isChatVisibleItem(item: CodexThreadItem) {
  return CHAT_VISIBLE_TYPES.has(item.type || "");
}

export function threadFromDesktopState(
  state: DesktopConversationState,
  fallback: CodexThread | undefined,
  threadId: string,
): CodexThread {
  return {
    ...(fallback ?? { id: threadId }),
    id: state.id || threadId,
    name: state.title ?? fallback?.name,
    cwd: state.cwd ?? fallback?.cwd,
    source: state.source ?? fallback?.source,
    gitInfo: state.gitInfo ?? fallback?.gitInfo,
    updatedAt: Date.now(),
    turns: state.turns ?? fallback?.turns ?? [],
  };
}

export function threadAssistantSignature(thread?: CodexThread | null) {
  const turns = thread?.turns ?? [];
  return turns
    .flatMap((turn) => turn.items ?? [])
    .filter((item) => item.type === "agentMessage")
    .map((item, index) => {
      const text = toDisplayText(item.text) || collectText(item.content);
      return `${index}:${item.status ?? ""}:${text.length}:${text.slice(-32)}`;
    })
    .join("|");
}

export function hasInProgressTurn(thread?: CodexThread | null) {
  return Boolean(thread?.turns?.some((turn) => turn.status === "inProgress"));
}

export function isUnmaterializedThreadError(value: unknown) {
  const message = String(value);
  return message.includes("not materialized yet") || message.includes("includeTurns is unavailable before first user message");
}

export function latestInProgressTurnId(thread?: CodexThread | null) {
  const turns = thread?.turns ?? [];
  return [...turns].reverse().find((turn) => turn.status === "inProgress")?.id;
}

export function sandboxPolicyFromMode(mode: string, cwd: string | null) {
  if (mode === "read-only") {
    return { type: "readOnly", networkAccess: true };
  }
  if (mode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  return {
    type: "workspaceWrite",
    writableRoots: cwd ? [cwd] : [],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

export function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
