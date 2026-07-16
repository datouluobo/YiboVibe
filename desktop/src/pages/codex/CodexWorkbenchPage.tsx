import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Loader2, RefreshCw } from "lucide-react";
import {
  CODEX_ENDPOINT,
  REASONING_EFFORTS,
  asStringArray,
  buildProjectSummaries,
  describeItem,
  formatJson,
  getGitBranchState,
  hasInProgressTurn,
  isChatVisibleItem,
  isUnmaterializedThreadError,
  latestInProgressTurnId,
  materializeCodexChatItems,
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
} from "../../services/codexBridge";
import { CodexProbePanel } from "../../components/CodexProbePanel";
import { normalizeWorkbenchError, workbenchErrorMessage } from "../../services/aiWorkbench";
import { WorkbenchPageShell } from "../workbench/WorkbenchPageShell";
import {
  CodexComposerPanel,
  CodexConversationPanel,
  CodexProjectSidebar,
} from "./CodexWorkbenchSections";

function isNearBottom(element: HTMLElement, threshold = 120) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function CodexWorkbenchPage() {
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

      const fallbackProjects = buildProjectSummaries(nextThreads);
      const fallbackProjectPath = fallbackProjects[0]?.cwd || "";
      const fallbackThreadId = fallbackProjects[0]?.threads[0]?.id || nextThreads[0]?.id || "";
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
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadWorkbench();
    }, 20000);
    return () => window.clearInterval(timer);
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

  const modelEfforts = asStringArray(
    models.find((model) => model.id === selectedModel)?.supportedReasoningEfforts ||
      models.find((model) => model.model === selectedModel)?.supportedReasoningEfforts,
    REASONING_EFFORTS,
  );
  return (
    <WorkbenchPageShell
      title="Codex"
      description="Dedicated Codex workbench. Future IDE integrations should live beside this page, not inside it."
      error={workbenchError}
      actions={
        <>
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
        </>
      }
    >
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
        <CodexProjectSidebar
          filteredProjects={filteredProjects}
          projects={projects}
          projectSearch={projectSearch}
          pinnedProjectPath={pinnedProjectPath}
          selectedProject={selectedProject}
          selectedThread={selectedThread}
          isMutatingThread={isMutatingThread}
          onSearchChange={setProjectSearch}
          onTogglePin={() => setPinnedProjectPath((current) => (current === selectedProject?.cwd ? "" : selectedProject?.cwd || ""))}
          onCreateThread={() => void createThread()}
          onSelectProject={(cwd, firstThreadId) => {
            setSelectedProjectPath(cwd);
            setSelectedThreadId(firstThreadId || "");
          }}
          onSelectThread={setSelectedThreadId}
        />

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <CodexConversationPanel
            selectedThread={selectedThread}
            threadDetail={threadDetail}
            conversationSummary={conversationSummary}
            isLoadingThread={isLoadingThread}
            isLoadingSummary={isLoadingSummary}
            isMutatingThread={isMutatingThread}
            activeTurnId={activeTurnId ?? ""}
            pendingApproval={pendingApproval}
            visibleConversationItems={visibleConversationItems}
            hiddenTechnicalEventCount={hiddenTechnicalEventCount}
            collapsedChatEventCount={collapsedChatEventCount}
            showTechnicalEvents={showTechnicalEvents}
            copiedMessageKey={copiedMessageKey}
            chatScrollRef={chatScrollRef}
            sendStatus={sendStatus}
            sendError={sendError}
            liveStatus={liveStatus}
            liveWarning={liveWarning}
            liveEventCount={liveEventCount}
            onRenameThread={() => void renameThread()}
            onArchiveThread={() => void archiveThread()}
            onInterruptTurn={() => void interruptTurn()}
            onRespondApproval={(approved) => void respondToApproval(approved)}
            onScrollChatToTop={scrollChatToTop}
            onScrollChatToBottom={() => scrollChatToBottom()}
            onCopyMessageText={(key, text) => void copyMessageText(key, text)}
            onChatScroll={(element) => {
              shouldStickToBottomRef.current = isNearBottom(element);
            }}
          />
          <CodexComposerPanel
            selectedThread={selectedThread}
            selectedProject={selectedProject}
            models={models}
            modelEfforts={modelEfforts}
            draftMessage={draftMessage}
            currentPath={currentPath}
            currentBranch={currentBranch}
            authStatus={authStatus}
            selectedModel={selectedModel}
            selectedServiceTier={selectedServiceTier}
            selectedEffort={selectedEffort}
            selectedSummary={selectedSummary}
            selectedApprovalPolicy={selectedApprovalPolicy}
            selectedSandboxMode={selectedSandboxMode}
            showTechnicalEvents={showTechnicalEvents}
            isSendingTurn={isSendingTurn}
            isMutatingThread={isMutatingThread}
            onDraftChange={setDraftMessage}
            onSend={() => void sendTurn()}
            onSwitchProjectBranch={(branch) => void switchProjectBranch(branch)}
            onSelectedModelChange={(nextModel) => {
              setSelectedModel(nextModel);
              const defaultEffort = models.find((model) => model.id === nextModel)?.defaultReasoningEffort;
              if (defaultEffort) setSelectedEffort(defaultEffort);
              void applyRealtimeCodexConfig({ model: nextModel });
            }}
            onSelectedServiceTierChange={(nextTier) => {
              setSelectedServiceTier(nextTier);
              void applyRealtimeCodexConfig({ serviceTier: nextTier });
            }}
            onSelectedEffortChange={setSelectedEffort}
            onSelectedSummaryChange={setSelectedSummary}
            onSelectedApprovalPolicyChange={setSelectedApprovalPolicy}
            onSelectedSandboxModeChange={setSelectedSandboxMode}
            onApplyProjectConfig={() => void applyProjectConfig()}
            onShowTechnicalEventsChange={setShowTechnicalEvents}
          />
        </div>
      </section>

    </WorkbenchPageShell>
  );
}

export default CodexWorkbenchPage;
