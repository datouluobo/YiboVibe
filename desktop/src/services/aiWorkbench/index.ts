// index.ts — AI workbench barrel export
// Re-exports all public API from the aiWorkbench provider system

export * from "./types";
export { AiWorkbenchRegistry } from "./registry";
export { createCodexWorkbenchAdapter } from "./codex/adapter";
export type {
  CodexAppServerProbeRequest,
  CodexAppServerProbeResponse,
} from "./codex/adapter";
