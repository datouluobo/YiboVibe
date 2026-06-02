import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Edit3,
  FileText,
  Folder,
  GitBranch,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
} from "lucide-react";
import {
  APPROVAL_POLICIES,
  CODEX_ENDPOINT,
  REASONING_EFFORTS,
  REASONING_SUMMARIES,
  SANDBOX_MODES,
  asStringArray,
  buildProjectSummaries,
  describeItem,
  formatJson,
  formatRelativeAge,
  formatTime,
  getGitBranchState,
  hasInProgressTurn,
  isChatVisibleItem,
  isUnmaterializedThreadError,
  latestInProgressTurnId,
  materializeCodexChatItems,
  normalizeThreadStatus,
  probeCodexAppServer,
  requestCodexAppServer,
  requestCodexDesktopIpc,
  extractPendingApproval,
  sandboxPolicyFromMode,
  summarizeThread,
  switchGitBranch,
  mergeCodexThreadSnapshots,
  pendingApprovalFromServerRequest,
  threadAssistantSignature,
  threadFromDesktopState,
  wait,
  type AuthStatusResult,
  type CodexModel,
  type CodexThread,
  type ConfigReadResult,
  type ConversationSummary,
  type ConversationSummaryResult,
  type DesktopConversationState,
  type ModelListResult,
  type ThreadListResult,
  type ThreadLoadedListResult,
  type ThreadReadResult,
  type ThreadResumeResult,
  type ThreadStartResult,
  type TurnStartResult,
} from "../services/codexBridge";
import { CodexProbePanel } from "../components/CodexProbePanel";
import { normalizeWorkbenchError, workbenchErrorMessage } from "../services/aiWorkbench";

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

const SERVICE_TIER_OPTIONS = ["default", "priority"];

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

function Agents() {
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const selectedThreadRef = useRef<CodexThread | undefined>(undefined);
  const threadDetailRef = useRef<CodexThread | null>(null);
  const refreshGenerationRef = useRef(0);
  const [showTechnicalEvents, setShowTechnicalEvents] = useState(false);

  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatusResult | null>(null);
  const [conversationSummary, setConversationSummary] = useState<ConversationSummary | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedServiceTier, setSelectedServiceTier] = useState("default");
  const [selectedEffort, setSelectedEffort] = useState("medium");
  const [selectedSummary, setSelectedSummary] = useState("auto");
  const [selectedApprovalPolicy, setSelectedApprovalPolicy] = useState("on-request");
  const [selectedSandboxMode, setSelectedSandboxMode] = useState("workspace-write");
  const [gitBranchStateByCwd, setGitBranchStateByCwd] = useState<Record<string, { branch: string; branches: string[] }>>({});
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

  const showWorkbenchError = useCallback((err: unknown) => {
    const normalized = normalizeWorkbenchError(err);
    setWorkbenchError(workbenchErrorMessage(normalized));
    if (showTechnicalEvents) {
      setLiveWarning(normalized.message);
    }
  }, [showTechnicalEvents]);

  const showSendError = useCallback((err: unknown) => {
    const normalized = normalizeWorkbenchError(err);
    setSendError(workbenchErrorMessage(normalized));
    if (showTechnicalEvents) {
      setLiveWarning(normalized.message);
    }
  }, [showTechnicalEvents]);

  const callRpc = useCallback(
    async <T,>(rpcMethod: string, params: unknown) => {
      return probeCodexAppServer<T>(CODEX_ENDPOINT, rpcMethod, params, "");
    },
    [],
  );

  const callPersistentRpc = useCallback(async <T,>(rpcMethod: string, params: unknown) => {
    return requestCodexAppServer<T>(rpcMethod, params);
  }, []);

  const callBridgeRpc = useCallback(
    async <T,>(rpcMethod: string, params: unknown) => {
      try {
        return await callPersistentRpc<T>(rpcMethod, params);
      } catch (persistentErr) {
        try {
          const { result } = await callRpc<T>(rpcMethod, params);
          return result;
        } catch {
          throw persistentErr;
        }
      }
    },
    [callPersistentRpc, callRpc],
  );

  const callDesktopIpc = useCallback(
    async <T,>(ipcMethod: string, params: unknown, version = 0, routeThreadId?: string | null) => {
      return requestCodexDesktopIpc<T>(ipcMethod, params, version, routeThreadId);
    },
    [],
  );

  const projects = useMemo(
    () =>
      buildProjectSummaries(threads).map((project) => {
        const live = gitBranchStateByCwd[project.cwd];
        if (!live) return project;
        return {
          ...project,
          branches: live.branches.length ? live.branches : project.branches,
          threads: project.threads.map((thread) =>
            thread.cwd === project.cwd
              ? {
                  ...thread,
                  gitInfo: {
                    ...thread.gitInfo,
                    branch: live.branch,
                  },
                }
              : thread,
          ),
          latestThread:
            project.latestThread && project.latestThread.cwd === project.cwd
              ? {
                  ...project.latestThread,
                  gitInfo: {
                    ...project.latestThread.gitInfo,
                    branch: live.branch,
                  },
                }
              : project.latestThread,
        };
      }),
    [gitBranchStateByCwd, threads],
  );

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

  useEffect(() => {
    const uniqueCwds = Array.from(new Set(threads.map((thread) => thread.cwd).filter(Boolean) as string[]));
    if (!uniqueCwds.length) return;
    let cancelled = false;
    void Promise.all(
      uniqueCwds.map(async (cwd) => {
        try {
          const state = await getGitBranchState(cwd);
          return [cwd, state] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setGitBranchStateByCwd((current) => {
        const next = { ...current };
        for (const item of results) {
          if (!item) continue;
          next[item[0]] = { branch: item[1].branch, branches: item[1].branches };
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [threads]);

  const conversationItems = useMemo(() => {
    const turns = threadDetail?.turns ?? selectedThread?.turns ?? [];
    return turns.flatMap((turn) => turn.items ?? []);
  }, [selectedThread?.turns, threadDetail?.turns]);

  const materializedConversationItems = useMemo(
    () => materializeCodexChatItems(threadDetail ?? selectedThread, false),
    [selectedThread, threadDetail],
  );

  const visibleConversationItems = useMemo(
    () =>
      showTechnicalEvents
        ? conversationItems
        : materializedConversationItems,
    [conversationItems, materializedConversationItems, showTechnicalEvents],
  );

  const hiddenTechnicalEventCount = useMemo(
    () => conversationItems.filter((item) => !isChatVisibleItem(item)).length,
    [conversationItems],
  );

  const collapsedChatEventCount = useMemo(() => {
    const rawChatCount = conversationItems.filter((item) => isChatVisibleItem(item)).length;
    return Math.max(0, rawChatCount - materializedConversationItems.length);
  }, [conversationItems, materializedConversationItems]);

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
        callBridgeRpc<ThreadListResult>("thread/list", { limit: 50, archived: false }),
        callBridgeRpc<ModelListResult>("model/list", { includeHidden: false }),
        callBridgeRpc<ConfigReadResult>("config/read", { includeLayers: true }),
        callBridgeRpc<AuthStatusResult>("getAuthStatus", { includeToken: false, refreshToken: false }),
      ]);

      const nextThreads = threadList.data ?? [];
      const nextModels = modelList.data ?? [];
      const defaultModel =
        nextModels.find((model) => model.isDefault)?.id ||
        configRead.config?.model ||
        nextModels[0]?.id ||
        "";
      const defaultEffort =
        nextModels.find((model) => model.id === defaultModel)?.defaultReasoningEffort ||
        nextModels.find((model) => model.isDefault)?.defaultReasoningEffort ||
        "medium";

      setThreads((current) => {
        const merged = new Map<string, CodexThread>();
        for (const thread of current) {
          merged.set(thread.id, thread);
        }
        for (const nextThread of nextThreads) {
          const existing = merged.get(nextThread.id);
          merged.set(nextThread.id, mergeCodexThreadSnapshots(nextThread, existing));
        }
        return Array.from(merged.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      });
      setModels(nextModels);
      setAuthStatus(authRead);
      setSelectedModel((current) => current || defaultModel);
      setSelectedServiceTier((current) => current || configRead.config?.service_tier || "default");
      setSelectedEffort((current) => current || defaultEffort);
      setSelectedApprovalPolicy((current) => current || configRead.config?.approval_policy || "on-request");
      setSelectedSandboxMode((current) => current || configRead.config?.sandbox_mode || "workspace-write");
      setLastRefreshAt(new Date());

      const fallbackProjectPath = nextThreads[0]?.cwd || "";
      const fallbackThreadId = nextThreads.find((thread) => thread.cwd === fallbackProjectPath)?.id || nextThreads[0]?.id || "";
      setSelectedProjectPath((current) => current || fallbackProjectPath);
      setSelectedThreadId((current) => current || fallbackThreadId);
    } catch (err) {
      showWorkbenchError(err);
    } finally {
      setIsLoadingWorkbench(false);
    }
  }, [callBridgeRpc]);

  const loadThreadDetail = useCallback(
    async (threadId: string, options?: { silent?: boolean }) => {
      if (!threadId) return null;
      if (!options?.silent) {
        setIsLoadingThread(true);
        setWorkbenchError("");
      }
      try {
        const detail = await callBridgeRpc<ThreadReadResult>("thread/read", {
          threadId,
          includeTurns: true,
        });
        const nextThread = detail.thread ?? null;
        setThreadDetail(nextThread);
        if (nextThread) {
          setThreads((current) => {
            const existing = current.find((thread) => thread.id === nextThread.id);
            const mergedThread = mergeCodexThreadSnapshots(nextThread, existing);
            const rest = current.filter((thread) => thread.id !== nextThread.id);
            return [mergedThread, ...rest].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
          });
        }
        return nextThread;
      } catch (err) {
        if (isUnmaterializedThreadError(err)) {
          const fallbackThread = selectedThreadRef.current?.id === threadId ? selectedThreadRef.current : undefined;
          const emptyThread = {
            ...(fallbackThread ?? { id: threadId }),
            id: threadId,
            turns: [],
          } as CodexThread;
          setThreadDetail(emptyThread);
          setThreads((current) =>
            current.map((thread) => (thread.id === threadId ? { ...thread, ...emptyThread } : thread)),
          );
          if (!options?.silent) {
            setWorkbenchError("");
          }
          return emptyThread;
        }
        if (!options?.silent) {
          setThreadDetail(null);
        showWorkbenchError(err);
        }
        return null;
      } finally {
        if (!options?.silent) {
          setIsLoadingThread(false);
        }
      }
    },
    [callBridgeRpc, showWorkbenchError],
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

    void callBridgeRpc<ConfigReadResult>("config/read", {
      includeLayers: true,
      cwd: selectedProjectPath,
    })
      .then((nextConfig) => {
        setSelectedModel((current) => current || nextConfig.config?.model || "");
        if (nextConfig.config?.service_tier) {
          setSelectedServiceTier(nextConfig.config.service_tier);
        }
        if (nextConfig.config?.approval_policy) {
          setSelectedApprovalPolicy(nextConfig.config.approval_policy);
        }
        if (nextConfig.config?.sandbox_mode) {
          setSelectedSandboxMode(nextConfig.config.sandbox_mode);
        }
      })
      .catch((err) => showWorkbenchError(err));
  }, [callBridgeRpc, selectedProjectPath, showWorkbenchError]);

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
          reason?: string;
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

      if (methodName === "workbench:changed") {
        const syncParams =
          payload?.params && typeof payload.params === "object" && "params" in payload.params
            ? (payload.params.params as { threadId?: string; reason?: string })
            : payload?.params;
        const changedThreadId = syncParams?.threadId;
        const reason = syncParams?.reason;
        if (reason === "thread/archive" && changedThreadId && changedThreadId === currentThreadId) {
          setThreadDetail(null);
          setSelectedThreadId("");
        }
        window.setTimeout(() => {
          void loadWorkbench();
        }, reason === "thread/archive" ? 80 : 220);
        return;
      }

      if (methodName === "warning" || methodName === "configWarning") {
        setLiveWarning(payload?.params?.message || payload?.message || formatJson(payload));
      }

      const eventThreadId = payload?.params?.threadId || payload?.params?.conversationId;
      const belongsToCurrentThread = !eventThreadId || eventThreadId === currentThreadId;
      const livePendingApproval = pendingApprovalFromServerRequest({
        id: typeof (payload as { id?: unknown })?.id === "string" ? (payload as { id: string }).id : undefined,
        method: payload?.method,
        params: payload?.params as Record<string, unknown> | undefined,
      });

      if (livePendingApproval && eventThreadId) {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === eventThreadId
              ? {
                  ...thread,
                  status: {
                    type: "active",
                    activeFlags: ["waitingOnApproval"],
                  },
                  pendingApproval: livePendingApproval,
                  raw: {
                    ...(thread.raw && typeof thread.raw === "object" ? (thread.raw as Record<string, unknown>) : {}),
                    pendingApproval: livePendingApproval,
                    status: {
                      type: "active",
                      activeFlags: ["waitingOnApproval"],
                    },
                  },
                }
              : thread,
          ),
        );
        if (eventThreadId === currentThreadId) {
          setThreadDetail((current) =>
            current
              ? {
                  ...current,
                  pendingApproval: livePendingApproval,
                  status: {
                    type: "active",
                    activeFlags: ["waitingOnApproval"],
                  },
                }
              : current,
          );
          setSendStatus("等待确认...");
        }
        return;
      }

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
        setThreads((current) => {
          const existing = current.find((thread) => thread.id === liveThread.id);
          const mergedThread = mergeCodexThreadSnapshots(liveThread, existing);
          const rest = current.filter((thread) => thread.id !== liveThread.id);
          return [mergedThread, ...rest].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        });
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
    void listen<unknown>("codex-workbench-sync-event", (event) => handleEvent(event.payload)).then((cleanup) => {
      unlisteners.push(cleanup);
    });

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [loadWorkbench, refreshThreadUntilSettled, selectedThread?.id]);

  const currentBranch = selectedThread?.gitInfo?.branch || selectedProject?.branches[0] || "unknown";
  const currentPath = selectedThread?.cwd || selectedProject?.cwd || "unknown";
  const currentThreadStatus = normalizeThreadStatus(threadDetail ?? selectedThread);
  const activeTurnId = latestInProgressTurnId(threadDetail ?? selectedThread);
  const pendingApproval = useMemo(
    () => extractPendingApproval(threadDetail ?? selectedThread),
    [selectedThread, threadDetail],
  );

  const createThread = useCallback(async () => {
    const cwd = currentPath && currentPath !== "unknown" ? currentPath : null;
    setIsMutatingThread(true);
    setSendError("");
    setSendStatus("正在新建对话...");
    try {
      const response = await callPersistentRpc<ThreadStartResult>("thread/start", {
        cwd,
        model: selectedModel || null,
        serviceTier: selectedServiceTier || null,
        approvalPolicy: selectedApprovalPolicy || null,
        sandbox: selectedSandboxMode || null,
      });
      const nextThread = response.thread;
      if (nextThread) {
        const emptyThread = { ...nextThread, turns: [] };
        setThreads((current) => {
          const rest = current.filter((thread) => thread.id !== nextThread.id);
          return [emptyThread, ...rest];
        });
        setThreadDetail(emptyThread);
      }
      if (nextThread?.cwd) setSelectedProjectPath(nextThread.cwd);
      if (nextThread?.id) {
        setSelectedThreadId(nextThread.id);
      }
      setSendStatus("已新建对话");
      void loadWorkbench();
    } catch (err) {
      showSendError(err);
      setSendStatus("");
    } finally {
      setIsMutatingThread(false);
    }
  }, [
    callPersistentRpc,
    selectedServiceTier,
    currentPath,
    loadThreadDetail,
    loadWorkbench,
    selectedApprovalPolicy,
    selectedModel,
    selectedSandboxMode,
    showSendError,
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
      showSendError(err);
    } finally {
      setIsMutatingThread(false);
    }
  }, [callPersistentRpc, loadThreadDetail, loadWorkbench, selectedThread, showSendError]);

  const archiveThread = useCallback(async () => {
    if (!selectedThread?.id) return;
    setIsMutatingThread(true);
    try {
      await callPersistentRpc("thread/archive", {
        threadId: selectedThread.id,
        conversationId: selectedThread.id,
      });
      setThreadDetail(null);
      setSelectedThreadId("");
      await loadWorkbench();
    } catch (err) {
      showSendError(err);
    } finally {
      setIsMutatingThread(false);
    }
  }, [callPersistentRpc, loadWorkbench, selectedThread?.id, showSendError]);

  const interruptTurn = useCallback(async () => {
    if (!selectedThread?.id || !activeTurnId) return;
    setIsMutatingThread(true);
    setSendStatus("正在中断回复...");
    try {
      await callPersistentRpc("turn/interrupt", { threadId: selectedThread.id, turnId: activeTurnId });
      await loadThreadDetail(selectedThread.id, { silent: true });
      setSendStatus("已请求中断");
    } catch (err) {
      showSendError(err);
      setSendStatus("");
    } finally {
      setIsMutatingThread(false);
    }
  }, [activeTurnId, callPersistentRpc, loadThreadDetail, selectedThread?.id, showSendError]);

  const applyProjectConfig = useCallback(async () => {
    setIsMutatingThread(true);
    setSendStatus("正在写入 Codex 配置...");
    try {
      await callPersistentRpc("config/batchWrite", {
        edits: [
          { keyPath: "model", value: selectedModel || null, mergeStrategy: "upsert" },
          { keyPath: "service_tier", value: selectedServiceTier || null, mergeStrategy: "upsert" },
          { keyPath: "approval_policy", value: selectedApprovalPolicy, mergeStrategy: "upsert" },
          { keyPath: "sandbox_mode", value: selectedSandboxMode, mergeStrategy: "upsert" },
        ],
        reloadUserConfig: true,
      });
      await loadWorkbench();
      setSendStatus("配置已写入并热加载");
    } catch (err) {
      showSendError(err);
      setSendStatus("");
    } finally {
      setIsMutatingThread(false);
    }
  }, [callPersistentRpc, loadWorkbench, selectedApprovalPolicy, selectedModel, selectedSandboxMode, selectedServiceTier, showSendError]);

  const applyRealtimeCodexConfig = useCallback(
    async (next: { model?: string; serviceTier?: string }) => {
      setIsMutatingThread(true);
      setSendStatus("正在同步 Codex 配置...");
      try {
        await callPersistentRpc("config/batchWrite", {
          edits: [
            next.model !== undefined
              ? { keyPath: "model", value: next.model || null, mergeStrategy: "upsert" }
              : null,
            next.serviceTier !== undefined
              ? { keyPath: "service_tier", value: next.serviceTier || null, mergeStrategy: "upsert" }
              : null,
          ].filter(Boolean),
          reloadUserConfig: true,
        });
        await loadWorkbench();
        setSendStatus("Codex 配置已同步");
      } catch (err) {
        showSendError(err);
        setSendStatus("");
      } finally {
        setIsMutatingThread(false);
      }
    },
    [callPersistentRpc, loadWorkbench, showSendError],
  );

  const switchProjectBranch = useCallback(
    async (branch: string) => {
      if (!selectedProject?.cwd || !branch || branch === currentBranch) return;
      setIsMutatingThread(true);
      setSendStatus(`正在切换到 ${branch}...`);
      try {
        const nextState = await switchGitBranch(selectedProject.cwd, branch);
        setGitBranchStateByCwd((current) => ({
          ...current,
          [selectedProject.cwd]: {
            branch: nextState.branch,
            branches: nextState.branches,
          },
        }));
        await loadWorkbench();
        if (selectedThread?.id) {
          await loadThreadDetail(selectedThread.id, { silent: true });
        }
        setSendStatus(`已切换到 ${branch}`);
      } catch (err) {
        showSendError(err);
        setSendStatus("");
      } finally {
        setIsMutatingThread(false);
      }
    },
    [currentBranch, loadThreadDetail, loadWorkbench, selectedProject?.cwd, selectedThread?.id, showSendError],
  );

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
          selectedThread.id,
        );
        setDraftMessage("");
        setSendStatus("已提交到 Codex Desktop，等待回复...");
        void refreshThreadUntilSettled(selectedThread.id, previousAssistantSignature);
        return;
      } catch (ipcErr) {
        if (showTechnicalEvents) {
          setLiveWarning(`Codex Desktop IPC 不可用，已回退 stdio：${String(ipcErr)}`);
        }
        setSendStatus("Codex Desktop IPC 未接管，改用 stdio 发送...");
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
              serviceTier: selectedServiceTier || null,
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
        serviceTier: selectedServiceTier || null,
      };
      await callPersistentRpc<TurnStartResult>("turn/start", params);
      setDraftMessage("");
      setSendStatus("已提交，等待 Codex 回复...");
      void refreshThreadUntilSettled(selectedThread.id, previousAssistantSignature);
    } catch (err) {
      showSendError(err);
      setSendStatus("");
    } finally {
      setIsSendingTurn(false);
    }
  }, [
    callDesktopIpc,
    callPersistentRpc,
    selectedServiceTier,
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
    showSendError,
    showTechnicalEvents,
  ]);

  const respondToApproval = useCallback(async (approved: boolean) => {
    if (!selectedThread?.id || !pendingApproval || isMutatingThread) return;

    setSendError("");
    setLiveWarning("");
    setSendStatus(approved ? "正在确认并继续..." : "正在拒绝待确认动作...");
    setIsMutatingThread(true);

    try {
      const previousAssistantSignature = threadAssistantSignature(threadDetailRef.current ?? selectedThreadRef.current);
      const cwd = currentPath && currentPath !== "unknown" ? currentPath : null;

      if (pendingApproval.requestId) {
        await callRpc("codex_app_server_respond_pending_approval", {
          requestId: pendingApproval.requestId,
          approved,
        });
        setSendStatus(approved ? "已确认，等待 Codex 继续..." : "已拒绝，等待状态同步...");
        void refreshThreadUntilSettled(selectedThread.id, previousAssistantSignature);
        return;
      }

      const approvalInput = [
        approved
          ? {
              type: pendingApproval.kind,
              approval_id: pendingApproval.approvalId,
              approved: true,
            }
          : {
              type: pendingApproval.kind,
              approval_id: pendingApproval.approvalId,
              denied: true,
            },
      ];

      try {
        await callDesktopIpc<{ result?: TurnStartResult }>(
          "thread-follower-start-turn",
          {
            conversationId: selectedThread.id,
            turnStartParams: {
              input: approvalInput,
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
          selectedThread.id,
        );
        setSendStatus(approved ? "已确认，等待 Codex 继续..." : "已拒绝，等待状态同步...");
        void refreshThreadUntilSettled(selectedThread.id, previousAssistantSignature);
        return;
      } catch (ipcErr) {
        if (showTechnicalEvents) {
          setLiveWarning(`Codex Desktop IPC 确认不可用，已回退 stdio：${String(ipcErr)}`);
        }
      }

      const loaded = await callPersistentRpc<ThreadLoadedListResult>("thread/loaded/list", {});
      if (!loaded.data?.includes(selectedThread.id)) {
        await callPersistentRpc<ThreadResumeResult>("thread/resume", {
          threadId: selectedThread.id,
          cwd,
          model: selectedModel || null,
          approvalPolicy: selectedApprovalPolicy || null,
          sandbox: selectedSandboxMode || null,
          serviceTier: selectedServiceTier || null,
        });
      }

      await callPersistentRpc<TurnStartResult>("turn/start", {
        threadId: selectedThread.id,
        input: approvalInput,
        cwd,
        model: selectedModel || null,
        approvalPolicy: selectedApprovalPolicy || null,
        sandboxPolicy: sandboxPolicyFromMode(selectedSandboxMode, cwd),
        effort: selectedEffort || null,
        summary: selectedSummary || null,
        serviceTier: selectedServiceTier || null,
      });
      setSendStatus(approved ? "已确认，等待 Codex 继续..." : "已拒绝，等待状态同步...");
      void refreshThreadUntilSettled(selectedThread.id, previousAssistantSignature);
    } catch (err) {
      showSendError(err);
      setSendStatus("");
    } finally {
      setIsMutatingThread(false);
    }
  }, [
    callDesktopIpc,
    callPersistentRpc,
    callRpc,
    selectedServiceTier,
    currentPath,
    isMutatingThread,
    pendingApproval,
    refreshThreadUntilSettled,
    selectedApprovalPolicy,
    selectedEffort,
    selectedModel,
    selectedSandboxMode,
    selectedSummary,
    selectedThread?.id,
    showSendError,
    showTechnicalEvents,
  ]);

  const approvalAcceptLabel = pendingApproval?.kind === "permissions-approval" ? "授权并继续" : "确认并继续";
  const approvalRejectLabel = pendingApproval?.kind === "permissions-approval" ? "不授权" : "拒绝";
  const modelEfforts = asStringArray(
    models.find((model) => model.id === selectedModel)?.supportedReasoningEfforts ||
      models.find((model) => model.model === selectedModel)?.supportedReasoningEfforts,
    REASONING_EFFORTS,
  );
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
          <CodexProbePanel />
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
                  ? `${visibleConversationItems.length} 条聊天消息`
                  : `${visibleConversationItems.length} 条 · 折叠 ${collapsedChatEventCount} · 隐藏 ${hiddenTechnicalEventCount}`
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
            {pendingApproval && (
              <div
                style={{
                  alignSelf: "stretch",
                  border: "1px solid rgba(250, 204, 21, 0.5)",
                  background: "rgba(250, 204, 21, 0.08)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ color: "#d29922", fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>
                    待确认操作
                  </div>
                  <div style={{ color: "var(--color-text-main)", fontSize: 14, fontWeight: 700 }}>
                    {pendingApproval.title}
                  </div>
                  {pendingApproval.summary && (
                    <div
                      style={{
                        color: "var(--color-text-muted)",
                        fontSize: 12,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {pendingApproval.summary}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isMutatingThread}
                    onClick={() => void respondToApproval(false)}
                    style={{
                      minHeight: 36,
                      borderRadius: 10,
                      borderColor: "rgba(239,68,68,0.5)",
                      color: "#ef4444",
                    }}
                  >
                    {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                    {approvalRejectLabel}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isMutatingThread}
                    onClick={() => void respondToApproval(true)}
                    style={{
                      minHeight: 36,
                      borderRadius: 10,
                      borderColor: "rgba(34,197,94,0.55)",
                      color: "#22c55e",
                    }}
                  >
                    {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {approvalAcceptLabel}
                  </button>
                </div>
              </div>
            )}
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
            {(sendError || sendStatus || (showTechnicalEvents && (liveStatus || liveWarning))) && (
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
                {!sendError && showTechnicalEvents && liveStatus && (
                  <div style={{ color: "var(--color-text-muted)" }}>
                    {`连接事件：${liveStatus}${liveEventCount ? ` · ${liveEventCount}` : ""}`}
                  </div>
                )}
                {showTechnicalEvents && liveWarning && (
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
                display: "flex",
                flexDirection: "column",
                gap: 10,
                border: "1px solid var(--color-border)",
                borderRadius: 16,
                background: "var(--color-surface-elevated)",
                padding: "10px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 10,
                  alignItems: "end",
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
                    minHeight: 40,
                    maxHeight: 140,
                    resize: "vertical",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "var(--color-text-main)",
                    font: "inherit",
                    fontSize: 15,
                    lineHeight: 1.6,
                    padding: "8px 6px",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void sendTurn()}
                  disabled={!draftMessage.trim() || !selectedThread || isSendingTurn}
                  title="发送"
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 13,
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
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(160px, 1fr) minmax(100px, 0.8fr) minmax(150px, 1fr) 104px 96px 86px 120px 132px auto auto",
                  gap: 8,
                  alignItems: "center",
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
                  <select
                    className="modern-input custom-select"
                    value={currentBranch}
                    onChange={(event) => void switchProjectBranch(event.target.value)}
                    disabled={!selectedProject?.branches.length || isMutatingThread}
                    style={{ fontSize: 12, border: "none", background: "transparent", padding: 0, minWidth: 0 }}
                  >
                    {(selectedProject?.branches.length ? selectedProject.branches : [currentBranch]).map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={toolbarMetricStyle}>
                  {authStatus?.requiresOpenaiAuth ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {authStatus?.authMethod || (authStatus ? "authenticated" : "auth unknown")}
                  </span>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
                  <select
                    className="modern-input custom-select"
                    value={selectedModel}
                    onChange={(event) => {
                      const nextModel = event.target.value;
                      setSelectedModel(nextModel);
                      const defaultEffort = models.find((model) => model.id === nextModel)?.defaultReasoningEffort;
                      if (defaultEffort) setSelectedEffort(defaultEffort);
                      void applyRealtimeCodexConfig({ model: nextModel });
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
                  <select
                    className="modern-input custom-select"
                    value={selectedServiceTier}
                    onChange={(event) => {
                      const nextTier = event.target.value;
                      setSelectedServiceTier(nextTier);
                      void applyRealtimeCodexConfig({ serviceTier: nextTier });
                    }}
                    style={{ fontSize: 12 }}
                  >
                    {SERVICE_TIER_OPTIONS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
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
                  title="写回确认与沙箱配置"
                  style={{ minHeight: 35, borderRadius: 8, whiteSpace: "nowrap", fontSize: 12 }}
                >
                  {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  确认/沙箱
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
