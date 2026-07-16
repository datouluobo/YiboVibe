export type AiWorkbenchProviderId = "codex" | "cursor" | "claude-code" | "custom";

export type AiWorkbenchStatus =
  | "notLoaded"
  | "idle"
  | "loading"
  | "running"
  | "waitingApproval"
  | "failed"
  | "offline";

export type AiWorkbenchMessageRole = "user" | "assistant" | "tool" | "system";

export type AiWorkbenchErrorCode =
  | "provider-offline"
  | "conversation-not-loaded"
  | "conversation-not-found"
  | "conversation-not-materialized"
  | "auth-required"
  | "invalid-request"
  | "transport-failed"
  | "unknown";

export type AiWorkbenchCapability =
  | "project-list"
  | "conversation-list"
  | "conversation-read"
  | "conversation-create"
  | "conversation-rename"
  | "conversation-archive"
  | "message-send"
  | "turn-cancel"
  | "model-list"
  | "config-read"
  | "config-write"
  | "event-stream";

export interface AiWorkbenchProvider {
  id: AiWorkbenchProviderId;
  name: string;
  transport: "app-server" | "desktop-ipc" | "stdio" | "http" | "custom";
  capabilities: AiWorkbenchCapability[];
}

export interface AiWorkbenchGitInfo {
  branch?: string | null;
  originUrl?: string | null;
  sha?: string | null;
}

export interface AiWorkbenchPendingApproval {
  requestId: string;
  approvalId: string;
  kind: "exec-approval" | "patch-approval" | "permissions-approval";
  title: string;
  summary?: string | null;
}

export interface AiWorkbenchProject {
  id: string;
  name: string;
  path: string;
  providerId: AiWorkbenchProviderId;
  conversationIds: string[];
  branches: string[];
  originUrl?: string | null;
  updatedAt?: number;
}

export interface AiWorkbenchConversation {
  id: string;
  providerId: AiWorkbenchProviderId;
  projectId?: string;
  title: string;
  preview?: string | null;
  cwd?: string | null;
  source?: string | null;
  cliVersion?: string | null;
  status: AiWorkbenchStatus;
  gitInfo?: AiWorkbenchGitInfo | null;
  pendingApproval?: AiWorkbenchPendingApproval | null;
  createdAt?: number;
  updatedAt?: number;
  raw?: unknown;
}

export interface AiWorkbenchMessage {
  id: string;
  conversationId?: string;
  providerId: AiWorkbenchProviderId;
  role: AiWorkbenchMessageRole;
  title: string;
  text: string;
  imageUrls?: string[];
  previewText?: string | null;
  isTruncated?: boolean;
  fullTextCharCount?: number | null;
  status?: string;
  createdAt?: string;
  rawType?: string;
  raw?: unknown;
}

export interface AiWorkbenchModel {
  id: string;
  providerId: AiWorkbenchProviderId;
  label: string;
  description?: string | null;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: string[];
  raw?: unknown;
}

export interface AiWorkbenchConfig {
  providerId: AiWorkbenchProviderId;
  model?: string;
  modelProvider?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  serviceTier?: string;
  cwd?: string;
  raw?: unknown;
}

export interface AiWorkbenchError {
  code: AiWorkbenchErrorCode;
  message: string;
  retryable: boolean;
  raw?: unknown;
}

export interface AiWorkbenchSendOptions {
  cwd?: string | null;
  model?: string | null;
  effort?: string | null;
  summary?: string | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
}

export interface AiWorkbenchSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  providers: AiWorkbenchProvider[];
  projects: AiWorkbenchProject[];
  conversations: AiWorkbenchConversation[];
  activeConversationId?: string | null;
  messagesByConversationId: Record<string, AiWorkbenchMessage[]>;
  modelsByProviderId: Partial<Record<AiWorkbenchProviderId, AiWorkbenchModel[]>>;
  configsByProviderId: Partial<Record<AiWorkbenchProviderId, AiWorkbenchConfig>>;
  errors?: AiWorkbenchError[];
}

export interface AiWorkbenchAdapter {
  provider: AiWorkbenchProvider;
  listConversations(params?: { archived?: boolean; limit?: number }): Promise<AiWorkbenchConversation[]>;
  readConversation(id: string): Promise<AiWorkbenchConversation>;
  createConversation(params: { cwd?: string | null; model?: string | null }): Promise<AiWorkbenchConversation>;
  renameConversation(id: string, name: string): Promise<void>;
  archiveConversation(id: string): Promise<void>;
  sendMessage(conversationId: string, text: string, options?: AiWorkbenchSendOptions): Promise<void>;
  cancelTurn(conversationId: string, turnId: string): Promise<void>;
  listModels(params?: { includeHidden?: boolean }): Promise<AiWorkbenchModel[]>;
  readConfig(params?: { cwd?: string | null }): Promise<AiWorkbenchConfig>;
  updateConfig(config: Partial<AiWorkbenchConfig>): Promise<void>;
}

export function stableProjectId(providerId: AiWorkbenchProviderId, path: string) {
  return `${providerId}:${path || "(unknown)"}`;
}

export function createEmptyWorkbenchSnapshot(provider: AiWorkbenchProvider): AiWorkbenchSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    providers: [provider],
    projects: [],
    conversations: [],
    activeConversationId: null,
    messagesByConversationId: {},
    modelsByProviderId: {},
    configsByProviderId: {},
    errors: [],
  };
}

export function normalizeWorkbenchError(raw: unknown): AiWorkbenchError {
  const message = raw instanceof Error ? raw.message : String(raw);
  const lower = message.toLowerCase();

  if (lower.includes("not materialized yet") || lower.includes("includeturns is unavailable")) {
    return { code: "conversation-not-materialized", message, retryable: true, raw };
  }
  if (lower.includes("thread not found") || lower.includes("conversation not found")) {
    return { code: "conversation-not-found", message, retryable: false, raw };
  }
  if (lower.includes("not initialized") || lower.includes("not loaded")) {
    return { code: "conversation-not-loaded", message, retryable: true, raw };
  }
  if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return { code: "auth-required", message, retryable: false, raw };
  }
  if (lower.includes("no-client-found") || lower.includes("ipc") || lower.includes("transport")) {
    return { code: "transport-failed", message, retryable: true, raw };
  }
  if (lower.includes("invalid") || lower.includes("-32600")) {
    return { code: "invalid-request", message, retryable: false, raw };
  }

  return { code: "unknown", message, retryable: false, raw };
}

export function workbenchErrorMessage(error: AiWorkbenchError) {
  switch (error.code) {
    case "provider-offline":
      return "AI 工具未在线，请确认桌面端工具正在运行。";
    case "conversation-not-loaded":
      return "对话尚未载入，可以稍后重试或先发送第一条消息。";
    case "conversation-not-found":
      return "对话不存在或已被移动/删除。";
    case "conversation-not-materialized":
      return "新对话尚未产生第一条消息，暂时没有正文可读取。";
    case "auth-required":
      return "AI 工具需要重新登录或授权。";
    case "invalid-request":
      return "请求参数不符合当前 AI 工具要求。";
    case "transport-failed":
      return "连接通道暂不可用，可重试或切换备用通道。";
    default:
      return error.message;
  }
}
