// transcript.ts — Data transformers between Codex types and AiWorkbench types
// Converts Codex thread/turn/item models to the generic AiWorkbench model

import type {
  AiWorkbenchConversation,
  AiWorkbenchModel,
  AiWorkbenchConfig,
  AiWorkbenchStatus,
} from "../../aiWorkbench";

// These types mirror what the Codex app-server returns
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
    activeFlags?: string[];
    [key: string]: unknown;
  };
  pendingApproval?: unknown | null;
  raw?: unknown;
  turns?: CodexTurn[];
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
}

export interface CodexThreadItem {
  type?: string;
  role?: string;
  text?: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface CodexModel {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string;
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

export function codexStatusToWorkbenchStatus(thread: CodexThread): AiWorkbenchStatus {
  if (thread.pendingApproval && thread.pendingApproval !== null) return "waitingApproval";
  if (thread.status?.type === "running" || thread.status?.type === "loading") return "running";
  if (thread.status?.type === "error" || thread.status?.type === "failed") return "failed";
  if (thread.status?.type === "offline") return "offline";
  if (thread.status?.type === "notLoaded") return "notLoaded";
  return "idle";
}

export function toWorkbenchConversation(thread: CodexThread): AiWorkbenchConversation {
  return {
    id: thread.id,
    providerId: "codex",
    projectId: thread.path ? `codex:${thread.path}` : undefined,
    title: thread.name || thread.id.slice(0, 8),
    preview: thread.preview,
    cwd: thread.cwd,
    source: thread.source,
    cliVersion: thread.cliVersion,
    status: codexStatusToWorkbenchStatus(thread),
    gitInfo: thread.gitInfo ? {
      branch: thread.gitInfo.branch,
      originUrl: thread.gitInfo.originUrl,
      sha: thread.gitInfo.sha,
    } : null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    raw: thread,
  };
}

export function toWorkbenchModel(model: CodexModel): AiWorkbenchModel {
  return {
    id: model.id || model.model || "",
    providerId: "codex",
    label: model.displayName || model.model || model.id || "Unknown",
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
    providerId: "codex",
    model: config?.model,
    modelProvider: config?.model_provider,
    approvalPolicy: config?.approval_policy,
    sandboxMode: config?.sandbox_mode,
    serviceTier: config?.service_tier,
    cwd: config?.cwd,
    raw: config,
  };
}
