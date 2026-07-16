// types.ts — Shared types for AI workbench provider system
// Re-exports from the main aiWorkbench module

export type {
  AiWorkbenchProviderId,
  AiWorkbenchAdapter,
  AiWorkbenchProvider,
  AiWorkbenchConversation,
  AiWorkbenchMessage,
  AiWorkbenchModel,
  AiWorkbenchConfig,
  AiWorkbenchProject,
  AiWorkbenchSnapshot,
  AiWorkbenchStatus,
  AiWorkbenchMessageRole,
  AiWorkbenchCapability,
  AiWorkbenchPendingApproval,
  AiWorkbenchSendOptions,
  AiWorkbenchError,
  AiWorkbenchErrorCode,
  AiWorkbenchGitInfo,
} from "../aiWorkbench";

export {
  stableProjectId,
  createEmptyWorkbenchSnapshot,
  normalizeWorkbenchError,
  workbenchErrorMessage,
} from "../aiWorkbench";
