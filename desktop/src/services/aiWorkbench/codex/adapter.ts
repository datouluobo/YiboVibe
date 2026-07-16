import {
  createCodexWorkbenchAdapter as createBridgeCodexWorkbenchAdapter,
  type CodexAppServerProbeRequest,
  type CodexAppServerProbeResponse,
  type CodexModel,
  type CodexThread,
  type CodexThreadItem,
  type CodexTurn,
  type ConfigReadResult,
} from "../../codexBridge";

export function createCodexWorkbenchAdapter() {
  return createBridgeCodexWorkbenchAdapter();
}

export type {
  CodexAppServerProbeRequest,
  CodexAppServerProbeResponse,
  CodexModel,
  CodexThread,
  CodexThreadItem,
  CodexTurn,
  ConfigReadResult,
};
