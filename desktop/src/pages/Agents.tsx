import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Activity,
  AlertCircle,
  Archive,
  ArrowDownToLine,
  ArrowUpToLine,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Edit3,
  FileText,
  Folder,
  GitBranch,
  Loader2,
  Pin,
  Plus,
  Play,
  RefreshCw,
  Search,
  Send,
  Square,
  WandSparkles,
} from "lucide-react";

interface CodexAppServerProbeRequest {
  endpoint: string;
  bearer_token?: string | null;
  method: string;
  params: unknown;
}

interface CodexAppServerProbeResponse {
  ok: boolean;
  status: number;
  elapsed_ms: number;
  transport: string;
  request_body: unknown;
  response_json?: unknown | null;
  response_text: string;
  error?: string | null;
}

interface RpcEnvelope<T> {
  id?: string;
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
}

interface ThreadListResult {
  data?: CodexThread[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

interface CodexThread {
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

interface DesktopConversationState {
  id?: string;
  title?: string | null;
  cwd?: string | null;
  source?: string | null;
  modelProvider?: string | null;
  gitInfo?: CodexThread["gitInfo"];
  turns?: CodexTurn[];
}

interface ThreadReadResult {
  thread?: CodexThread;
}

interface CodexTurn {
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

interface CodexThreadItem {
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

interface ModelListResult {
  data?: CodexModel[];
}

interface CodexModel {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string | null;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: string[];
}

interface ConfigReadResult {
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

interface AuthStatusResult {
  authMethod?: string | null;
  requiresOpenaiAuth?: boolean;
}

interface ConversationSummaryResult {
  summary?: ConversationSummary;
}

interface ConversationSummary {
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

interface TurnStartResult {
  turn?: CodexTurn;
}

interface DesktopIpcResponse<T> {
  type?: string;
  resultType?: string;
  method?: string;
  handledByClientId?: string;
  result?: T;
  error?: string;
}

interface ThreadResumeResult {
  thread?: CodexThread;
}

interface ThreadStartResult {
  thread?: CodexThread;
}

interface ThreadLoadedListResult {
  data?: string[];
  nextCursor?: string | null;
}

interface ProjectSummary {
  cwd: string;
  name: string;
  threads: CodexThread[];
  latestThread: CodexThread;
  branches: string[];
  originUrl?: string | null;
  updatedAt?: number;
}

const ENDPOINT = "stdio://";
const CLIENT_VERSION = "0.9.7-r21";

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];
const REASONING_SUMMARIES = ["auto", "concise", "detailed", "none"];
const APPROVAL_POLICIES = ["on-request", "untrusted", "on-failure", "never"];
const SANDBOX_MODES = ["workspace-write", "read-only", "danger-full-access"];
const CHAT_VISIBLE_TYPES = new Set(["userMessage", "agentMessage"]);

const SAMPLE_METHODS = [
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

const DEFAULT_PARAMS_BY_METHOD: Record<string, string> = {
  initialize:
    `{\n  "clientInfo": {\n    "name": "yibovibe-desktop",\n    "version": "${CLIENT_VERSION}"\n  },\n  "capabilities": {\n    "experimentalApi": true\n  }\n}`,
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

const panelStyle: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-surface)",
  minWidth: 0,
};

const toolbarMetricStyle: CSSProperties = {
  minHeight: 34,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--color-text-muted)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 10px",
  fontSize: 12,
  minWidth: 0,
};

const codexSidebarPanelStyle: CSSProperties = {
  background: "#f3f6fa",
  borderRight: "1px solid #d9e0ea",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const codexSectionTitleStyle: CSSProperties = {
  color: "#8b949e",
  fontSize: 20,
  fontWeight: 500,
  padding: "16px 14px 10px",
};

const codexProjectGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const scrollJumpButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "rgba(255,255,255,0.92)",
  color: "var(--color-text-muted)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  pointerEvents: "auto",
  boxShadow: "0 4px 16px rgba(15,23,42,0.12)",
};

const messageCopyButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "rgba(255,255,255,0.84)",
  color: "var(--color-text-muted)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getResult<T>(response: CodexAppServerProbeResponse): T {
  const envelope = response.response_json as RpcEnvelope<T> | undefined | null;
  if (!response.ok || envelope?.error) {
    throw new Error(envelope?.error?.message || response.error || "Codex App Server request failed");
  }
  return (envelope?.result ?? {}) as T;
}

function getRpcResult<T>(value: unknown): T {
  const envelope = value as RpcEnvelope<T> | undefined | null;
  if (envelope?.error) {
    throw new Error(envelope.error.message || formatJson(envelope.error));
  }
  return (envelope?.result ?? {}) as T;
}

function getIpcResult<T>(value: unknown): T {
  const envelope = value as DesktopIpcResponse<T> | undefined | null;
  if (envelope?.resultType === "error" || envelope?.error) {
    throw new Error(envelope?.error || "Codex Desktop IPC request failed");
  }
  return (envelope?.result ?? {}) as T;
}

function projectNameFromPath(path: string) {
  const clean = path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

function formatTime(value?: number | string) {
  if (!value) return "未知";
  const date =
    typeof value === "number"
      ? new Date(value > 20_000_000_000 ? value : value * 1000)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString();
}

function formatRelativeAge(value?: number | string) {
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

function summarizeThread(thread: CodexThread) {
  return thread.name || thread.preview || thread.id;
}

function collectText(value: unknown): string {
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

function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  const collected = collectText(value);
  if (collected) return collected;
  if (value === null || value === undefined) return "";
  return formatJson(value);
}

function asStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return values.length ? values : fallback;
}

function describeItem(item: CodexThreadItem) {
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

function isChatVisibleItem(item: CodexThreadItem) {
  return CHAT_VISIBLE_TYPES.has(item.type || "");
}

function roleColor(role: string) {
  if (role === "user") return "#8ab4ff";
  if (role === "assistant") return "#7ee787";
  if (role === "tool") return "#f2cc60";
  return "var(--color-text-muted)";
}

function chatMessageStyle(role: string): CSSProperties {
  if (role === "user") {
    return {
      alignSelf: "flex-end",
      maxWidth: "70%",
      borderRadius: 18,
      background: "var(--color-surface-elevated)",
      color: "var(--color-text-main)",
      padding: "10px 14px",
      boxShadow: "0 1px 0 rgba(0,0,0,0.05)",
      userSelect: "text",
      WebkitUserSelect: "text",
    };
  }

  if (role === "assistant") {
    return {
      alignSelf: "stretch",
      maxWidth: "860px",
      borderLeft: "3px solid #52d66b",
      color: "var(--color-text-main)",
      padding: "6px 0 6px 12px",
      userSelect: "text",
      WebkitUserSelect: "text",
    };
  }

  return {
    alignSelf: "stretch",
    borderRadius: 8,
    background: "rgba(255,255,255,0.025)",
    border: "1px dashed var(--color-border)",
    color: "var(--color-text-muted)",
    padding: 10,
    userSelect: "text",
    WebkitUserSelect: "text",
  };
}

function chatTitle(role: string, title: string) {
  if (role === "user") return "";
  if (role === "assistant") return "Codex";
  return title;
}

function isNearBottom(element: HTMLElement, threshold = 120) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function threadFromDesktopState(
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

function threadAssistantSignature(thread?: CodexThread | null) {
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

function hasInProgressTurn(thread?: CodexThread | null) {
  return Boolean(thread?.turns?.some((turn) => turn.status === "inProgress"));
}

function latestInProgressTurnId(thread?: CodexThread | null) {
  const turns = thread?.turns ?? [];
  return [...turns].reverse().find((turn) => turn.status === "inProgress")?.id;
}

function sandboxPolicyFromMode(mode: string, cwd: string | null) {
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

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function Agents() {
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const selectedThreadRef = useRef<CodexThread | undefined>(undefined);
  const threadDetailRef = useRef<CodexThread | null>(null);
  const refreshGenerationRef = useRef(0);
  const [endpoint, setEndpoint] = useState(ENDPOINT);
  const bearerToken = "";
  const [method, setMethod] = useState("thread/list");
  const [paramsText, setParamsText] = useState(DEFAULT_PARAMS_BY_METHOD["thread/list"]);
  const [result, setResult] = useState<CodexAppServerProbeResponse | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [showProbePanel, setShowProbePanel] = useState(false);
  const [showTechnicalEvents, setShowTechnicalEvents] = useState(false);

  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [config, setConfig] = useState<ConfigReadResult["config"] | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatusResult | null>(null);
  const [conversationSummary, setConversationSummary] = useState<ConversationSummary | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState("medium");
  const [selectedSummary, setSelectedSummary] = useState("auto");
  const [selectedApprovalPolicy, setSelectedApprovalPolicy] = useState("on-request");
  const [selectedSandboxMode, setSelectedSandboxMode] = useState("workspace-write");
  const [projectSearch, setProjectSearch] = useState("");
  const [pinnedProjectPath, setPinnedProjectPath] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [sendError, setSendError] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [liveStatus, setLiveStatus] = useState("");
  const [liveWarning, setLiveWarning] = useState("");
  const [liveEventCount, setLiveEventCount] = useState(0);
  const [copiedMessageKey, setCopiedMessageKey] = useState("");
  const [threadDetail, setThreadDetail] = useState<CodexThread | null>(null);
  const [workbenchError, setWorkbenchError] = useState("");
  const [isLoadingWorkbench, setIsLoadingWorkbench] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isSendingTurn, setIsSendingTurn] = useState(false);
  const [isMutatingThread, setIsMutatingThread] = useState(false);
  const [, setLastRefreshAt] = useState<Date | null>(null);

  const parsedParams = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(paramsText || "{}") };
    } catch (err) {
      return { ok: false as const, message: String(err) };
    }
  }, [paramsText]);

  const callRpc = useCallback(
    async <T,>(rpcMethod: string, params: unknown) => {
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
    },
    [bearerToken, endpoint],
  );

  const callPersistentRpc = useCallback(async <T,>(rpcMethod: string, params: unknown) => {
    const response = await invoke<unknown>("codex_app_server_request", {
      request: {
        method: rpcMethod,
        params,
      },
    });
    return getRpcResult<T>(response);
  }, []);

  const callDesktopIpc = useCallback(async <T,>(ipcMethod: string, params: unknown, version = 0) => {
    const response = await invoke<unknown>("codex_desktop_ipc_request", {
      request: {
        method: ipcMethod,
        params,
        version,
      },
    });
    return getIpcResult<T>(response);
  }, []);

  const projects = useMemo<ProjectSummary[]>(() => {
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
  }, [threads]);

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    const visible = !query
      ? projects
      : projects.filter((project) => {
          const haystack = [
            project.name,
            project.cwd,
            project.branches.join(" "),
            ...project.threads.map((thread) => summarizeThread(thread)),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        });
    return [...visible].sort((a, b) => {
      if (a.cwd === pinnedProjectPath) return -1;
      if (b.cwd === pinnedProjectPath) return 1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }, [pinnedProjectPath, projectSearch, projects]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.cwd === selectedProjectPath) ?? filteredProjects[0] ?? projects[0],
    [filteredProjects, projects, selectedProjectPath],
  );

  const visibleThreads = selectedProject?.threads ?? [];

  const selectedThread = useMemo(
    () => visibleThreads.find((thread) => thread.id === selectedThreadId) ?? visibleThreads[0],
    [selectedThreadId, visibleThreads],
  );

  const conversationItems = useMemo(() => {
    const turns = threadDetail?.turns ?? selectedThread?.turns ?? [];
    return turns.flatMap((turn) => turn.items ?? []);
  }, [selectedThread?.turns, threadDetail?.turns]);

  const visibleConversationItems = useMemo(
    () => conversationItems.filter((item) => showTechnicalEvents || isChatVisibleItem(item)),
    [conversationItems, showTechnicalEvents],
  );

  const hiddenTechnicalEventCount = useMemo(
    () => conversationItems.filter((item) => !isChatVisibleItem(item)).length,
    [conversationItems],
  );

  const conversationScrollKey = useMemo(
    () =>
      visibleConversationItems
        .map((item, index) => {
          const described = describeItem(item);
          return `${index}:${item.type ?? ""}:${described.text.length}:${item.status ?? ""}`;
        })
        .join("|"),
    [visibleConversationItems],
  );

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    shouldStickToBottomRef.current = true;
  }, []);

  const scrollChatToTop = useCallback(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: 0, behavior: "smooth" });
    shouldStickToBottomRef.current = false;
  }, []);

  const copyMessageText = useCallback(async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageKey(key);
      window.setTimeout(() => {
        setCopiedMessageKey((current) => (current === key ? "" : current));
      }, 1400);
    } catch (err) {
      setLiveWarning(`复制失败：${String(err)}`);
    }
  }, []);

  useEffect(() => {
    selectedThreadRef.current = selectedThread;
  }, [selectedThread]);

  useEffect(() => {
    threadDetailRef.current = threadDetail;
  }, [threadDetail]);

  useLayoutEffect(() => {
    if (!chatScrollRef.current) return;
    if (shouldStickToBottomRef.current || isSendingTurn) {
      scrollChatToBottom("auto");
    }
  }, [conversationScrollKey, isSendingTurn, scrollChatToBottom, selectedThread?.id]);

  const loadWorkbench = useCallback(async () => {
    setWorkbenchError("");
    setIsLoadingWorkbench(true);

    try {
      const [threadList, modelList, configRead, authRead] = await Promise.all([
        callRpc<ThreadListResult>("thread/list", { limit: 50, archived: false }),
        callRpc<ModelListResult>("model/list", { includeHidden: false }),
        callRpc<ConfigReadResult>("config/read", { includeLayers: true }),
        callRpc<AuthStatusResult>("getAuthStatus", { includeToken: false, refreshToken: false }),
      ]);

      const nextThreads = threadList.result.data ?? [];
      const nextModels = modelList.result.data ?? [];
      const defaultModel =
        nextModels.find((model) => model.isDefault)?.id ||
        configRead.result.config?.model ||
        nextModels[0]?.id ||
        "";
      const defaultEffort =
        nextModels.find((model) => model.id === defaultModel)?.defaultReasoningEffort ||
        nextModels.find((model) => model.isDefault)?.defaultReasoningEffort ||
        "medium";

      setThreads(nextThreads);
      setModels(nextModels);
      setConfig(configRead.result.config ?? null);
      setAuthStatus(authRead.result);
      setSelectedModel((current) => current || defaultModel);
      setSelectedEffort((current) => current || defaultEffort);
      setSelectedApprovalPolicy((current) => current || configRead.result.config?.approval_policy || "on-request");
      setSelectedSandboxMode((current) => current || configRead.result.config?.sandbox_mode || "workspace-write");
      setLastRefreshAt(new Date());

      const fallbackProjectPath = nextThreads[0]?.cwd || "";
      const fallbackThreadId = nextThreads.find((thread) => thread.cwd === fallbackProjectPath)?.id || nextThreads[0]?.id || "";
      setSelectedProjectPath((current) => current || fallbackProjectPath);
      setSelectedThreadId((current) => current || fallbackThreadId);
    } catch (err) {
      setWorkbenchError(String(err));
    } finally {
      setIsLoadingWorkbench(false);
    }
  }, [callRpc]);

  const loadThreadDetail = useCallback(
    async (threadId: string, options?: { silent?: boolean }) => {
      if (!threadId) return null;
      if (!options?.silent) {
        setIsLoadingThread(true);
        setWorkbenchError("");
      }
      try {
        const { result: detail } = await callRpc<ThreadReadResult>("thread/read", {
          threadId,
          includeTurns: true,
        });
        const nextThread = detail.thread ?? null;
        setThreadDetail(nextThread);
        if (nextThread) {
          setThreads((current) =>
            current.map((thread) => (thread.id === nextThread.id ? { ...thread, ...nextThread } : thread)),
          );
        }
        return nextThread;
      } catch (err) {
        if (!options?.silent) {
          setThreadDetail(null);
          setWorkbenchError(String(err));
        }
        return null;
      } finally {
        if (!options?.silent) {
          setIsLoadingThread(false);
        }
      }
    },
    [callRpc],
  );

  const refreshThreadUntilSettled = useCallback(
    async (threadId: string, previousAssistantSignature?: string) => {
      if (!threadId) return;
      const generation = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = generation;
      const delays = [250, 500, 800, 1200, 1600, 2200, 3000, 4000];
      let sawAssistantChange = false;

      for (const delay of delays) {
        await wait(delay);
        if (refreshGenerationRef.current !== generation) return;

        const detail = await loadThreadDetail(threadId, { silent: true });
        const nextAssistantSignature = threadAssistantSignature(detail);
        sawAssistantChange =
          sawAssistantChange || Boolean(nextAssistantSignature && nextAssistantSignature !== previousAssistantSignature);

        if (detail && sawAssistantChange && !hasInProgressTurn(detail)) {
          setSendStatus("");
          void loadWorkbench();
          return;
        }
      }

      setSendStatus("");
      void loadWorkbench();
    },
    [loadThreadDetail, loadWorkbench],
  );

  const loadConversationSummary = useCallback(
    async (threadId: string) => {
      if (!threadId) {
        setConversationSummary(null);
        return;
      }

      setIsLoadingSummary(true);
      try {
        const { result: summaryResult } = await callRpc<ConversationSummaryResult>("getConversationSummary", {
          conversationId: threadId,
        });
        setConversationSummary(summaryResult.summary ?? null);
      } catch {
        setConversationSummary(null);
      } finally {
        setIsLoadingSummary(false);
      }
    },
    [callRpc],
  );

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  useEffect(() => {
    if (selectedThread?.id) {
      void loadThreadDetail(selectedThread.id);
      void loadConversationSummary(selectedThread.id);
    } else {
      setThreadDetail(null);
      setConversationSummary(null);
    }
  }, [loadConversationSummary, loadThreadDetail, selectedThread?.id]);

  useEffect(() => {
    if (!selectedProjectPath || selectedProjectPath === "(unknown)") return;

    void callRpc<ConfigReadResult>("config/read", {
      includeLayers: true,
      cwd: selectedProjectPath,
    })
      .then(({ result: nextConfig }) => {
        setConfig(nextConfig.config ?? null);
        setSelectedModel((current) => current || nextConfig.config?.model || "");
        if (nextConfig.config?.approval_policy) {
          setSelectedApprovalPolicy(nextConfig.config.approval_policy);
        }
        if (nextConfig.config?.sandbox_mode) {
          setSelectedSandboxMode(nextConfig.config.sandbox_mode);
        }
      })
      .catch((err) => setWorkbenchError(String(err)));
  }, [callRpc, selectedProjectPath]);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let refreshTimer: number | undefined;
    const currentThreadId = selectedThread?.id;

    const handleEvent = (rawPayload: unknown) => {
      const payload = rawPayload as {
        method?: string;
        type?: string;
        line?: string;
        message?: string;
        params?: {
          threadId?: string;
          turnId?: string;
          conversationId?: string;
          status?: string;
          message?: string;
          change?: {
            type?: string;
            conversationState?: DesktopConversationState;
          };
        };
      };
      const methodName = payload?.method || payload?.type || "event";
      setLiveEventCount((count) => count + 1);
      setLiveStatus(methodName);

      if (payload?.type === "stderr") {
        setLiveWarning(payload.line || "Codex app-server stderr");
        return;
      }

      if (methodName === "warning" || methodName === "configWarning") {
        setLiveWarning(payload?.params?.message || payload?.message || formatJson(payload));
      }

      const eventThreadId = payload?.params?.threadId || payload?.params?.conversationId;
      const belongsToCurrentThread = !eventThreadId || eventThreadId === currentThreadId;

      if (
        methodName === "thread-stream-state-changed" &&
        belongsToCurrentThread &&
        currentThreadId &&
        payload?.params?.change?.conversationState?.turns
      ) {
        const liveThread = threadFromDesktopState(
          payload.params.change.conversationState,
          threadDetailRef.current ?? selectedThreadRef.current,
          currentThreadId,
        );
        setThreadDetail(liveThread);
        setThreads((current) =>
          current.map((thread) => (thread.id === liveThread.id ? { ...thread, ...liveThread } : thread)),
        );
        if (liveThread.turns?.some((turn) => turn.status === "inProgress")) {
          setSendStatus("Codex 正在回复...");
        } else {
          setSendStatus("");
        }
        return;
      }

      const shouldRefresh =
        belongsToCurrentThread &&
        (methodName === "turn/started" ||
          methodName === "turn/completed" ||
          methodName === "turn/failed" ||
          methodName === "turn/cancelled" ||
          methodName === "item/started" ||
          methodName === "item/updated" ||
          methodName === "item/completed" ||
          methodName === "item/agentMessage/delta");

      if (shouldRefresh && currentThreadId) {
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          void refreshThreadUntilSettled(
            currentThreadId,
            threadAssistantSignature(threadDetailRef.current ?? selectedThreadRef.current),
          );
        }, methodName === "turn/completed" ? 250 : 900);
      }
    };

    void listen<unknown>("codex-app-server-event", (event) => handleEvent(event.payload)).then((cleanup) => {
      unlisteners.push(cleanup);
    });
    void listen<unknown>("codex-desktop-ipc-event", (event) => handleEvent(event.payload)).then((cleanup) => {
      unlisteners.push(cleanup);
    });

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [refreshThreadUntilSettled, selectedThread?.id]);

  const runProbe = useCallback(async () => {
    setError("");
    setResult(null);

    if (!parsedParams.ok) {
      setError(`Params JSON is invalid: ${parsedParams.message}`);
      return;
    }

    setIsRunning(true);
    try {
      const payload: CodexAppServerProbeRequest = {
        endpoint,
        bearer_token: bearerToken.trim() ? bearerToken.trim() : null,
        method,
        params: parsedParams.value,
      };
      const response = await invoke<CodexAppServerProbeResponse>("codex_app_server_probe", {
        request: payload,
      });
      setResult(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRunning(false);
    }
  }, [bearerToken, endpoint, method, parsedParams]);

  const currentBranch = selectedThread?.gitInfo?.branch || selectedProject?.branches[0] || "unknown";
  const currentPath = selectedThread?.cwd || selectedProject?.cwd || "unknown";
  const currentThreadStatus = threadDetail?.status?.type || selectedThread?.status?.type || "notLoaded";
  const activeTurnId = latestInProgressTurnId(threadDetail ?? selectedThread);

  const createThread = useCallback(async () => {
    const cwd = currentPath && currentPath !== "unknown" ? currentPath : null;
    setIsMutatingThread(true);
    setSendError("");
    setSendStatus("正在新建对话...");
    try {
      const response = await callPersistentRpc<ThreadStartResult>("thread/start", {
        cwd,
        model: selectedModel || null,
        serviceTier: config?.service_tier || null,
        approvalPolicy: selectedApprovalPolicy || null,
        sandbox: selectedSandboxMode || null,
      });
      const nextThread = response.thread;
      await loadWorkbench();
      if (nextThread?.cwd) setSelectedProjectPath(nextThread.cwd);
      if (nextThread?.id) {
        setSelectedThreadId(nextThread.id);
        await loadThreadDetail(nextThread.id);
      }
      setSendStatus("已新建对话");
    } catch (err) {
      setSendError(String(err));
      setSendStatus("");
    } finally {
      setIsMutatingThread(false);
    }
  }, [
    callPersistentRpc,
    config?.service_tier,
    currentPath,
    loadThreadDetail,
    loadWorkbench,
    selectedApprovalPolicy,
    selectedModel,
    selectedSandboxMode,
  ]);

  const renameThread = useCallback(async () => {
    if (!selectedThread?.id) return;
    const nextName = window.prompt("重命名对话", summarizeThread(selectedThread));
    if (!nextName?.trim()) return;
    setIsMutatingThread(true);
    try {
      await callPersistentRpc("thread/name/set", { threadId: selectedThread.id, name: nextName.trim() });
      await loadWorkbench();
      await loadThreadDetail(selectedThread.id);
    } catch (err) {
      setSendError(String(err));
    } finally {
      setIsMutatingThread(false);
    }
  }, [callPersistentRpc, loadThreadDetail, loadWorkbench, selectedThread]);

  const archiveThread = useCallback(async () => {
    if (!selectedThread?.id) return;
    setIsMutatingThread(true);
    try {
      await callPersistentRpc("thread/archive", { threadId: selectedThread.id });
      setThreadDetail(null);
      setSelectedThreadId("");
      await loadWorkbench();
    } catch (err) {
      setSendError(String(err));
    } finally {
      setIsMutatingThread(false);
    }
  }, [callPersistentRpc, loadWorkbench, selectedThread?.id]);

  const interruptTurn = useCallback(async () => {
    if (!selectedThread?.id || !activeTurnId) return;
    setIsMutatingThread(true);
    setSendStatus("正在中断回复...");
    try {
      await callPersistentRpc("turn/interrupt", { threadId: selectedThread.id, turnId: activeTurnId });
      await loadThreadDetail(selectedThread.id, { silent: true });
      setSendStatus("已请求中断");
    } catch (err) {
      setSendError(String(err));
      setSendStatus("");
    } finally {
      setIsMutatingThread(false);
    }
  }, [activeTurnId, callPersistentRpc, loadThreadDetail, selectedThread?.id]);

  const applyProjectConfig = useCallback(async () => {
    setIsMutatingThread(true);
    setSendStatus("正在写入 Codex 配置...");
    try {
      await callPersistentRpc("config/batchWrite", {
        edits: [
          { keyPath: "model", value: selectedModel || null, mergeStrategy: "upsert" },
          { keyPath: "approval_policy", value: selectedApprovalPolicy, mergeStrategy: "upsert" },
          { keyPath: "sandbox_mode", value: selectedSandboxMode, mergeStrategy: "upsert" },
        ],
        reloadUserConfig: true,
      });
      await loadWorkbench();
      setSendStatus("配置已写入并热加载");
    } catch (err) {
      setSendError(String(err));
      setSendStatus("");
    } finally {
      setIsMutatingThread(false);
    }
  }, [callPersistentRpc, loadWorkbench, selectedApprovalPolicy, selectedModel, selectedSandboxMode]);

  const sendTurn = useCallback(async () => {
    const text = draftMessage.trim();
    if (!text || !selectedThread?.id || isSendingTurn) return;

    setSendError("");
    setLiveWarning("");
    setSendStatus("准备对话...");
    setIsSendingTurn(true);

    try {
      const previousAssistantSignature = threadAssistantSignature(threadDetailRef.current ?? selectedThreadRef.current);
      const turnInput = [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ];
      const cwd = currentPath && currentPath !== "unknown" ? currentPath : null;

      try {
        setSendStatus("通过 Codex Desktop 发送...");
        await callDesktopIpc<{ result?: TurnStartResult }>(
          "thread-follower-start-turn",
          {
            conversationId: selectedThread.id,
            turnStartParams: {
              input: turnInput,
              cwd,
              model: selectedModel || null,
              effort: selectedEffort || null,
              summary: selectedSummary || null,
              approvalPolicy: selectedApprovalPolicy || null,
              sandboxPolicy: sandboxPolicyFromMode(selectedSandboxMode, cwd),
              collaborationMode: null,
            },
          },
          1,
        );
        setDraftMessage("");
        setSendStatus("已提交到 Codex Desktop，等待回复...");
        void refreshThreadUntilSettled(selectedThread.id, previousAssistantSignature);
        return;
      } catch (ipcErr) {
        setLiveWarning(`Codex Desktop IPC 不可用，已回退 stdio：${String(ipcErr)}`);
      }

      const loaded = await callPersistentRpc<ThreadLoadedListResult>("thread/loaded/list", {});
      if (!loaded.data?.includes(selectedThread.id)) {
        setSendStatus("正在载入对话...");
        await callPersistentRpc<ThreadResumeResult>("thread/resume", {
          threadId: selectedThread.id,
          cwd: currentPath && currentPath !== "unknown" ? currentPath : null,
        model: selectedModel || null,
        approvalPolicy: selectedApprovalPolicy || null,
        sandbox: selectedSandboxMode || null,
        serviceTier: config?.service_tier || null,
      });
      }

      setSendStatus("发送中...");
      const params = {
        threadId: selectedThread.id,
        input: turnInput,
        cwd,
        model: selectedModel || null,
        approvalPolicy: selectedApprovalPolicy || null,
        sandboxPolicy: sandboxPolicyFromMode(selectedSandboxMode, cwd),
        effort: selectedEffort || null,
        summary: selectedSummary || null,
        serviceTier: config?.service_tier || null,
      };
      await callPersistentRpc<TurnStartResult>("turn/start", params);
      setDraftMessage("");
      setSendStatus("已提交，等待 Codex 回复...");
      void refreshThreadUntilSettled(selectedThread.id, previousAssistantSignature);
    } catch (err) {
      setSendError(String(err));
      setSendStatus("");
    } finally {
      setIsSendingTurn(false);
    }
  }, [
    callDesktopIpc,
    callPersistentRpc,
    config?.service_tier,
    currentPath,
    draftMessage,
    isSendingTurn,
    refreshThreadUntilSettled,
    selectedApprovalPolicy,
    selectedEffort,
    selectedModel,
    selectedSummary,
    selectedSandboxMode,
    selectedThread?.id,
  ]);

  const resultTone = result?.ok ? "#7ee787" : result ? "#f2cc60" : "#8b949e";
  const selectedModelLabel =
    models.find((model) => model.id === selectedModel)?.displayName ||
    models.find((model) => model.id === selectedModel)?.model ||
    config?.model ||
    selectedModel ||
    "未选择";
  const modelEfforts = asStringArray(
    models.find((model) => model.id === selectedModel)?.supportedReasoningEfforts ||
      models.find((model) => model.model === selectedModel)?.supportedReasoningEfforts,
    REASONING_EFFORTS,
  );
  const probeLabel = result ? `${result.transport} ${result.status}` : "测试连接";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h2 style={{ marginBottom: 8, fontSize: 18, fontWeight: 600 }}>Agents</h2>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            Codex App Server structured access workbench.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowProbePanel((value) => !value)}
            style={{
              borderRadius: 8,
              minHeight: 34,
              borderColor: result ? resultTone : undefined,
              color: result ? resultTone : undefined,
            }}
          >
            <WandSparkles size={15} />
            {probeLabel}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={isLoadingWorkbench}
            onClick={() => void loadWorkbench()}
            style={{ borderRadius: 8, minHeight: 34 }}
          >
            {isLoadingWorkbench ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            刷新
          </button>
        </div>
      </div>

      {showProbePanel && (
        <section
          style={{
            ...panelStyle,
            display: "grid",
            gridTemplateColumns: "minmax(220px, 300px) minmax(160px, 220px) minmax(0, 1fr) auto",
            gap: 10,
            padding: 12,
            alignItems: "end",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            Endpoint
            <input
              className="modern-input"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              spellCheck={false}
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            Method
            <select
              className="modern-input custom-select"
              value={method}
              onChange={(event) => {
                const nextMethod = event.target.value;
                setMethod(nextMethod);
                setParamsText(DEFAULT_PARAMS_BY_METHOD[nextMethod] ?? "{}");
              }}
              style={{ fontSize: 12 }}
            >
              {SAMPLE_METHODS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            Params
            <input
              className="modern-input"
              value={paramsText.replace(/\s+/g, " ").trim()}
              onChange={(event) => setParamsText(event.target.value)}
              spellCheck={false}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                borderColor: parsedParams.ok ? undefined : "#ff7b72",
              }}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={isRunning}
            onClick={runProbe}
            style={{ minHeight: 38, borderRadius: 8, opacity: isRunning ? 0.72 : 1, whiteSpace: "nowrap" }}
          >
            <Play size={15} />
            {isRunning ? "Testing" : "测试连接"}
          </button>
          {(error || result) && (
            <pre
              style={{
                gridColumn: "1 / -1",
                maxHeight: 190,
                overflow: "auto",
                borderRadius: 8,
                border: "1px solid #30363d",
                background: "#0d1117",
                color: error ? "#ffb4ad" : "#d6dde8",
                padding: 12,
                margin: 0,
                fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error ||
                formatJson({
                  ok: result?.ok,
                  status: result?.status,
                  elapsed_ms: result?.elapsed_ms,
                  transport: result?.transport,
                  error: result?.error,
                  response_json: result?.response_json,
                })}
            </pre>
          )}
        </section>
      )}

      {workbenchError && (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            color: "#ffb4ad",
            background: "rgba(255,123,114,0.12)",
            border: "1px solid rgba(255,123,114,0.24)",
            fontSize: 12,
          }}
        >
          {workbenchError}
        </div>
      )}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "340px minmax(0, 1fr)",
          gap: 0,
          minHeight: 520,
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          background: "var(--color-surface)",
        }}
      >
        <div style={codexSidebarPanelStyle}>
          <div style={{ ...codexSectionTitleStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>项目</span>
            <button
              type="button"
              title="新建对话"
              onClick={() => void createThread()}
              disabled={isMutatingThread}
              style={messageCopyButtonStyle}
            >
              {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            </button>
          </div>
          <div style={{ padding: "0 10px 10px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 8,
                border: "1px solid #d9e0ea",
                background: "#fff",
                borderRadius: 8,
                padding: "7px 9px",
              }}
            >
              <Search size={15} style={{ color: "#8b949e" }} />
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="搜索项目或对话"
                style={{
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--color-text-main)",
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                title={selectedProject?.cwd === pinnedProjectPath ? "取消置顶" : "置顶当前项目"}
                onClick={() =>
                  setPinnedProjectPath((current) => (current === selectedProject?.cwd ? "" : selectedProject?.cwd || ""))
                }
                style={{ ...messageCopyButtonStyle, width: 26, height: 26, background: "transparent", boxShadow: "none" }}
              >
                <Pin size={13} />
              </button>
            </div>
          </div>
          <div style={{ overflow: "auto", padding: "0 10px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
            {filteredProjects.map((project) => {
              const projectActive = project.cwd === selectedProject?.cwd;
              return (
                <div key={project.cwd} style={codexProjectGroupStyle}>
                <button
                  key={project.cwd}
                  type="button"
                  onClick={() => {
                    setSelectedProjectPath(project.cwd);
                    setSelectedThreadId(project.threads[0]?.id || "");
                  }}
                  style={codexProjectButtonStyle(projectActive)}
                >
                  <Folder size={17} style={{ flexShrink: 0, opacity: 0.82 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 20,
                        fontWeight: projectActive ? 650 : 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {project.name}
                    </span>
                  </div>
                </button>
                {projectActive &&
                  project.threads.map((thread) => {
                    const threadActive = thread.id === selectedThread?.id;
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setSelectedThreadId(thread.id)}
                        style={codexThreadButtonStyle(threadActive)}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {summarizeThread(thread)}
                        </span>
                        <span style={{ color: "#8b949e", flexShrink: 0 }}>{formatRelativeAge(thread.updatedAt)}</span>
                      </button>
                    );
                  })}
                {projectActive && !project.threads.length && (
                  <div style={{ color: "#b7bdc7", fontSize: 18, padding: "8px 10px 8px 40px" }}>暂无对话</div>
                )}
                </div>
              );
            })}
            {!filteredProjects.length && (
              <EmptyState
                icon={<Folder size={18} />}
                text={projects.length ? "没有匹配的项目或对话。" : "还没有读取到项目。先确认 Codex Desktop 有历史线程。"}
              />
            )}
          </div>
        </div>

        <div style={{ ...panelStyle, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <PanelHeader
            icon={<Bot size={15} />}
            title="对话"
            meta={
              activeTurnId
                ? "运行中"
                : isLoadingThread
                ? "读取中"
                : showTechnicalEvents
                  ? `${visibleConversationItems.length} 项`
                  : `${visibleConversationItems.length} 条 · 隐藏 ${hiddenTechnicalEventCount}`
            }
          />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "10px 12px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedThread ? summarizeThread(selectedThread) : "未选择"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    title="重命名"
                    onClick={() => void renameThread()}
                    disabled={!selectedThread || isMutatingThread}
                    style={messageCopyButtonStyle}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    type="button"
                    title="归档"
                    onClick={() => void archiveThread()}
                    disabled={!selectedThread || isMutatingThread}
                    style={messageCopyButtonStyle}
                  >
                    <Archive size={14} />
                  </button>
                  <button
                    type="button"
                    title="中断回复"
                    onClick={() => void interruptTurn()}
                    disabled={!activeTurnId || isMutatingThread}
                    style={{
                      ...messageCopyButtonStyle,
                      color: activeTurnId ? "#ef4444" : "var(--color-text-muted)",
                    }}
                  >
                    {isMutatingThread && activeTurnId ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />}
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 6,
                  color: "var(--color-text-muted)",
                  fontSize: 11,
                }}
              >
                <span>来源: {conversationSummary?.source || selectedThread?.source || "unknown"}</span>
                <span>CLI: {conversationSummary?.cliVersion || selectedThread?.cliVersion || "unknown"}</span>
                <span>状态: {currentThreadStatus}{activeTurnId ? ` / ${activeTurnId.slice(0, 8)}` : ""}</span>
                <span>{isLoadingSummary ? "摘要读取中" : `更新: ${formatTime(conversationSummary?.updatedAt || selectedThread?.updatedAt)}`}</span>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              <div style={toolbarMetricStyle}>
                <Folder size={14} />
                <span
                  title={currentPath}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {currentPath}
                </span>
              </div>
              <div style={toolbarMetricStyle}>
                <GitBranch size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {currentBranch}
                </span>
              </div>
              <div style={toolbarMetricStyle}>
                <Cpu size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedModelLabel}
                </span>
              </div>
              <div style={toolbarMetricStyle}>
                {authStatus?.requiresOpenaiAuth ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {authStatus?.authMethod || (authStatus ? "authenticated" : "auth unknown")}
                </span>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(180px, 1fr) 92px 92px 128px 142px auto auto",
                gap: 8,
                alignItems: "end",
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
                模型选择
                <select
                  className="modern-input custom-select"
                  value={selectedModel}
                  onChange={(event) => {
                    const nextModel = event.target.value;
                    setSelectedModel(nextModel);
                    const defaultEffort = models.find((model) => model.id === nextModel)?.defaultReasoningEffort;
                    if (defaultEffort) setSelectedEffort(defaultEffort);
                  }}
                  style={{ fontSize: 12 }}
                >
                  {models.map((model) => {
                    const value = model.id || model.model || "";
                    return (
                      <option key={value} value={value}>
                        {model.displayName || model.model || value}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
                推理
                <select
                  className="modern-input custom-select"
                  value={selectedEffort}
                  onChange={(event) => setSelectedEffort(event.target.value)}
                  style={{ fontSize: 12 }}
                >
                  {modelEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
                摘要
                <select
                  className="modern-input custom-select"
                  value={selectedSummary}
                  onChange={(event) => setSelectedSummary(event.target.value)}
                  style={{ fontSize: 12 }}
                >
                  {REASONING_SUMMARIES.map((summary) => (
                    <option key={summary} value={summary}>
                      {summary}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
                审批
                <select
                  className="modern-input custom-select"
                  value={selectedApprovalPolicy}
                  onChange={(event) => setSelectedApprovalPolicy(event.target.value)}
                  style={{ fontSize: 12 }}
                >
                  {APPROVAL_POLICIES.map((policy) => (
                    <option key={policy} value={policy}>
                      {policy}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
                沙箱
                <select
                  className="modern-input custom-select"
                  value={selectedSandboxMode}
                  onChange={(event) => setSelectedSandboxMode(event.target.value)}
                  style={{ fontSize: 12 }}
                >
                  {SANDBOX_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void applyProjectConfig()}
                disabled={isMutatingThread}
                style={{ minHeight: 35, borderRadius: 8, whiteSpace: "nowrap", fontSize: 12 }}
              >
                {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                应用
              </button>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  paddingBottom: 9,
                  whiteSpace: "nowrap",
                }}
              >
                <input
                  type="checkbox"
                  checked={showTechnicalEvents}
                  onChange={(event) => setShowTechnicalEvents(event.target.checked)}
                />
                技术事件
              </label>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            onScroll={(event) => {
              shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
            }}
            style={{
              overflow: "auto",
              padding: "18px 24px",
              minHeight: 0,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              scrollBehavior: "smooth",
              scrollbarGutter: "stable",
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
                height: 0,
                pointerEvents: "none",
              }}
            >
              <button
                type="button"
                title="到顶部"
                onClick={scrollChatToTop}
                style={scrollJumpButtonStyle}
              >
                <ArrowUpToLine size={14} />
              </button>
              <button
                type="button"
                title="到底部"
                onClick={() => scrollChatToBottom()}
                style={scrollJumpButtonStyle}
              >
                <ArrowDownToLine size={14} />
              </button>
            </div>
            {isLoadingThread && <EmptyState icon={<Loader2 size={18} />} text="正在读取 thread/read..." />}
            {!isLoadingThread &&
              !showTechnicalEvents &&
              hiddenTechnicalEventCount > 0 && (
                <div
                  style={{
                    color: "var(--color-text-muted)",
                    background: "rgba(255,255,255,0.025)",
                    border: "1px dashed var(--color-border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 12,
                    alignSelf: "stretch",
                  }}
                >
                  已按聊天视图隐藏 {hiddenTechnicalEventCount} 个推理、命令、文件变更或工具事件。
                </div>
              )}
            {!isLoadingThread &&
              visibleConversationItems.map((item, index) => {
                const described = describeItem(item);
                const color = roleColor(described.role);
                const title = chatTitle(described.role, described.title);
                const messageKey = `${item.type ?? "item"}-${index}-${described.text.length}`;
                return (
                  <div
                    key={messageKey}
                    style={{
                      ...chatMessageStyle(described.role),
                      position: "relative",
                      paddingRight: described.role === "user" ? 42 : 36,
                    }}
                  >
                    <button
                      type="button"
                      title={copiedMessageKey === messageKey ? "已复制" : "复制消息"}
                      onClick={() => void copyMessageText(messageKey, described.text)}
                      style={{
                        ...messageCopyButtonStyle,
                        position: "absolute",
                        top: described.role === "user" ? 6 : 2,
                        right: described.role === "user" ? 8 : 0,
                      }}
                    >
                      {copiedMessageKey === messageKey ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    {title && <div style={{ color, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>}
                    <pre
                      style={{
                        margin: 0,
                        color: "var(--color-text-main)",
                        fontFamily:
                          described.role === "tool" || described.text.includes("{\n")
                            ? "'JetBrains Mono', 'Cascadia Code', monospace"
                            : "inherit",
                        fontSize: 13,
                        lineHeight: 1.75,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        userSelect: "text",
                        WebkitUserSelect: "text",
                      }}
                    >
                      {described.text || "(empty)"}
                    </pre>
                  </div>
                );
              })}
            {!isLoadingThread && !visibleConversationItems.length && (
              <EmptyState icon={<FileText size={18} />} text="已选对话没有返回 turns，或该线程尚未加载正文。" />
            )}
          </div>

          <div
            style={{
              borderTop: "1px solid var(--color-border)",
              padding: "12px 18px 16px",
              background: "var(--color-surface)",
            }}
          >
            {(sendError || sendStatus || liveStatus || liveWarning) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8, fontSize: 12 }}>
                {sendError && (
                  <pre
                    style={{
                      margin: 0,
                      color: "#ff7b72",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 120,
                      overflow: "auto",
                    }}
                  >
                    {`发送失败：${sendError}`}
                  </pre>
                )}
                {!sendError && sendStatus && <div style={{ color: "var(--color-text-muted)" }}>{sendStatus}</div>}
                {!sendError && liveStatus && (
                  <div style={{ color: "var(--color-text-muted)" }}>
                    {`连接事件：${liveStatus}${liveEventCount ? ` · ${liveEventCount}` : ""}`}
                  </div>
                )}
                {liveWarning && (
                  <pre
                    style={{
                      margin: 0,
                      color: "#d29922",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 96,
                      overflow: "auto",
                    }}
                  >
                    {`Codex 警告：${liveWarning}`}
                  </pre>
                )}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 10,
                alignItems: "end",
                border: "1px solid var(--color-border)",
                borderRadius: 16,
                background: "var(--color-surface-elevated)",
                padding: "8px 8px 8px 12px",
              }}
            >
              <textarea
                value={draftMessage}
                onChange={(event) => setDraftMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendTurn();
                  }
                }}
                disabled={!selectedThread || isSendingTurn}
                placeholder={selectedThread ? "给 Codex 发送消息" : "请选择一个对话"}
                rows={1}
                style={{
                  minHeight: 36,
                  maxHeight: 140,
                  resize: "vertical",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--color-text-main)",
                  font: "inherit",
                  fontSize: 14,
                  lineHeight: 1.6,
                  padding: "7px 4px",
                }}
              />
              <button
                type="button"
                onClick={() => void sendTurn()}
                disabled={!draftMessage.trim() || !selectedThread || isSendingTurn}
                title="发送"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  border: "none",
                  display: "grid",
                  placeItems: "center",
                  background:
                    draftMessage.trim() && selectedThread && !isSendingTurn
                      ? "var(--color-primary)"
                      : "rgba(148,163,184,0.35)",
                  color: "#fff",
                  cursor: draftMessage.trim() && selectedThread && !isSendingTurn ? "pointer" : "default",
                }}
              >
                {isSendingTurn ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

function PanelHeader({
  icon,
  title,
  meta,
  metaColor = "var(--color-text-muted)",
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  metaColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        {icon}
        {title}
      </div>
      {meta && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: metaColor, fontSize: 12 }}>
          <Activity size={13} />
          {meta}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div
      style={{
        minHeight: 120,
        display: "grid",
        placeItems: "center",
        gap: 8,
        color: "var(--color-text-muted)",
        fontSize: 12,
        textAlign: "center",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );
}

function codexProjectButtonStyle(active: boolean): CSSProperties {
  return {
    width: "100%",
    border: "none",
    background: active ? "#e4e9f1" : "transparent",
    color: active ? "#20242a" : "#5f6873",
    borderRadius: 10,
    padding: "8px 10px",
    textAlign: "left",
    cursor: "pointer",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 42,
  };
}

function codexThreadButtonStyle(active: boolean): CSSProperties {
  return {
    width: "100%",
    border: "none",
    background: active ? "#e4e9f1" : "transparent",
    color: active ? "#20242a" : "#2f343b",
    borderRadius: 10,
    padding: "8px 10px",
    textAlign: "left",
    cursor: "pointer",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 42,
    fontSize: 18,
  };
}

export default Agents;
