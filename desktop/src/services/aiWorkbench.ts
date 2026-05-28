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

export interface AiWorkbenchSendOptions {
  cwd?: string | null;
  model?: string | null;
  effort?: string | null;
  summary?: string | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
}

export interface AiWorkbenchAdapter {
  provider: AiWorkbenchProvider;
  listConversations(params?: { archived?: boolean; limit?: number }): Promise<AiWorkbenchConversation[]>;
  readConversation(id: string): Promise<AiWorkbenchConversation>;
  createConversation(params: { cwd?: string | null; model?: string | null }): Promise<AiWorkbenchConversation>;
  sendMessage(conversationId: string, text: string, options?: AiWorkbenchSendOptions): Promise<void>;
}

export function stableProjectId(providerId: AiWorkbenchProviderId, path: string) {
  return `${providerId}:${path || "(unknown)"}`;
}
