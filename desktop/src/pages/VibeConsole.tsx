import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Activity,
  FolderTree,
  PanelsTopLeft,
  Plus,
  Shield,
  ShieldCheck,
  TerminalSquare,
  Waves,
} from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import "./VibeConsole.css";

interface SessionInfo {
  session_id: string;
  shell_kind: string;
  cwd: string;
  status: "Running" | { Exited: number } | { Error: string };
  started_at: number;
  last_output_at: number;
  exit_code?: number | null;
}

interface TerminalBundle {
  terminal: Terminal;
  fitAddon: FitAddon;
  dataDisposable: { dispose: () => void };
}

interface TerminalStartSize {
  cols: number;
  rows: number;
}

interface ConsoleAdminStatus {
  is_elevated: boolean;
}

const DEBUG_VIBE_CONSOLE = false;

function isRunningStatus(status: SessionInfo["status"]) {
  return status === "Running";
}

function formatSessionStatus(status: SessionInfo["status"]) {
  if (status === "Running") return "Running";
  if ("Exited" in status) return `Exited (${status.Exited})`;
  return `Error: ${status.Error}`;
}

function formatRelativeOutput(lastOutputAt: number) {
  if (!lastOutputAt) return "No output yet";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - lastOutputAt);
  if (diff < 2) return "Active now";
  if (diff < 60) return `Output ${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `Output ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `Output ${hours}h ago`;
}

function getShellVisual(shellKind: string | null | undefined) {
  switch (shellKind) {
    case "pwsh":
      return {
        accent: "#4cc2ff",
        accentSoft: "rgba(76,194,255,0.16)",
        border: "rgba(76,194,255,0.22)",
        outputBg:
          "radial-gradient(circle at top right, rgba(76,194,255,0.10), transparent 26%), linear-gradient(180deg, rgba(9,18,28,0.98), rgba(11,18,28,0.98))",
        icon: Waves,
      };
    case "wsl":
      return {
        accent: "#7ee787",
        accentSoft: "rgba(126,231,135,0.16)",
        border: "rgba(126,231,135,0.22)",
        outputBg:
          "radial-gradient(circle at top left, rgba(126,231,135,0.10), transparent 28%), linear-gradient(180deg, rgba(10,20,14,0.98), rgba(11,18,15,0.98))",
        icon: PanelsTopLeft,
      };
    default:
      return {
        accent: "#f2cc60",
        accentSoft: "rgba(242,204,96,0.16)",
        border: "rgba(242,204,96,0.22)",
        outputBg:
          "radial-gradient(circle at top left, rgba(242,204,96,0.10), transparent 28%), linear-gradient(180deg, rgba(25,19,12,0.98), rgba(18,14,10,0.98))",
        icon: TerminalSquare,
      };
  }
}

export default function VibeConsole() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [defaultShell, setDefaultShell] = useState("cmd");
  const [newTabShell, setNewTabShell] = useState("cmd");
  const [startingSessionIds, setStartingSessionIds] = useState<string[]>([]);
  const [adminStatus, setAdminStatus] = useState<ConsoleAdminStatus | null>(null);

  const mountedRef = useRef(true);
  const activeSessionRef = useRef<string | null>(null);
  const unlistenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());
  const attachingListenersRef = useRef<Set<string>>(new Set());
  const terminalBundlesRef = useRef<Map<string, TerminalBundle>>(new Map());
  const terminalHostsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const resizeObserversRef = useRef<Map<string, ResizeObserver>>(new Map());
  const lastResizeDimsRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
  const knownSessionIdsRef = useRef<Set<string>>(new Set());
  const closingSessionIdsRef = useRef<Set<string>>(new Set());
  const bufferHydrationRef = useRef<Set<string>>(new Set());
  const liveOutputSeenRef = useRef<Set<string>>(new Set());
  const hydratedSnapshotTailRef = useRef<Map<string, string>>(new Map());
  const initialSessionLoadDoneRef = useRef(false);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.started_at - b.started_at),
    [sessions]
  );
  const currentSessionInfo = sessions.find((item) => item.session_id === sessionId) || null;
  const displayShell = currentSessionInfo?.shell_kind ?? newTabShell;
  const shellVisual = getShellVisual(displayShell);
  const promptChar = displayShell === "pwsh" ? "❯" : displayShell === "wsl" ? "$" : ">";
  const ShellIcon = shellVisual.icon;
  const runningSessions = sessions.filter((item) => isRunningStatus(item.status)).length;
  const currentSessionIndex = currentSessionInfo
    ? sortedSessions.findIndex((item) => item.session_id === currentSessionInfo.session_id) + 1
    : 0;

  const traceDebug = useCallback((label: string, details?: unknown) => {
    if (!DEBUG_VIBE_CONSOLE) return;
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const payload = details === undefined
      ? ""
      : ` ${typeof details === "string" ? details : JSON.stringify(details)}`;
    const line = `${stamp} ${label}${payload}`;
    console.debug("[VibeConsole]", line);
  }, []);

  const markSessionStarting = useCallback((sid: string, starting: boolean) => {
    setStartingSessionIds((prev) => {
      if (starting) {
        return prev.includes(sid) ? prev : [...prev, sid];
      }
      return prev.filter((item) => item !== sid);
    });
  }, []);

  const fitSession = useCallback(async (sid: string) => {
    const bundle = terminalBundlesRef.current.get(sid);
    const host = terminalHostsRef.current.get(sid);
    if (!bundle || !host || host.offsetWidth === 0 || host.offsetHeight === 0) return;

    bundle.fitAddon.fit();
    const dims = bundle.fitAddon.proposeDimensions();
    if (dims) {
      const lastDims = lastResizeDimsRef.current.get(sid);
      if (lastDims && lastDims.cols === dims.cols && lastDims.rows === dims.rows) {
        return;
      }
      try {
        await invoke("resize_session", { sessionId: sid, cols: dims.cols, rows: dims.rows });
        lastResizeDimsRef.current.set(sid, { cols: dims.cols, rows: dims.rows });
      } catch {
        // ignore
      }
    }
  }, []);

  const getTerminalStartSize = useCallback(async (sid: string): Promise<TerminalStartSize | null> => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const bundle = terminalBundlesRef.current.get(sid);
    const host = terminalHostsRef.current.get(sid);
    if (!bundle || !host || host.offsetWidth === 0 || host.offsetHeight === 0) return null;
    bundle.fitAddon.fit();
    const dims = bundle.fitAddon.proposeDimensions();
    if (!dims || dims.cols <= 0 || dims.rows <= 0) return null;
    return { cols: dims.cols, rows: dims.rows };
  }, []);

  const disposeTerminalSession = useCallback((sid: string) => {
    const observer = resizeObserversRef.current.get(sid);
    if (observer) {
      observer.disconnect();
      resizeObserversRef.current.delete(sid);
    }
    const bundle = terminalBundlesRef.current.get(sid);
    if (bundle) {
      bundle.dataDisposable.dispose();
      bundle.terminal.dispose();
      terminalBundlesRef.current.delete(sid);
    }
    terminalHostsRef.current.delete(sid);
    lastResizeDimsRef.current.delete(sid);
  }, []);

  const appendOutput = useCallback((sid: string, text: string) => {
    const bundle = terminalBundlesRef.current.get(sid);
    if (!bundle) return;
    bundle.terminal.write(text);
  }, []);

  const appendSystem = useCallback((sid: string, text: string) => {
    const bundle = terminalBundlesRef.current.get(sid);
    if (!bundle) return;
    bundle.terminal.writeln(`\r\n[system] ${text}`);
  }, []);

  const hydrateTerminalBuffer = useCallback(async (sid: string, terminal: Terminal, resetBeforeWrite: boolean) => {
    if (!bufferHydrationRef.current.has(sid)) return;

    try {
      const snapshot = await invoke<string>("get_session_buffer", { sessionId: sid });
      if (!snapshot) {
        bufferHydrationRef.current.delete(sid);
        hydratedSnapshotTailRef.current.delete(sid);
        return;
      }
      if (liveOutputSeenRef.current.has(sid)) {
        bufferHydrationRef.current.delete(sid);
        hydratedSnapshotTailRef.current.delete(sid);
        return;
      }
      if (!terminalBundlesRef.current.has(sid)) return;
      if (liveOutputSeenRef.current.has(sid)) {
        bufferHydrationRef.current.delete(sid);
        hydratedSnapshotTailRef.current.delete(sid);
        return;
      }
      if (resetBeforeWrite) {
        terminal.reset();
      }
      terminal.write(snapshot);
      hydratedSnapshotTailRef.current.set(sid, snapshot.slice(-4096));
      bufferHydrationRef.current.delete(sid);
    } catch {
      // ignore
    }
  }, []);

  const ensureTerminalSession = useCallback((session: SessionInfo) => {
    if (terminalBundlesRef.current.has(session.session_id)) return;

    const visual = getShellVisual(session.shell_kind);
    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      fontSize: 13.5,
      lineHeight: 1.5,
      letterSpacing: 0,
      scrollback: 10000,
      allowProposedApi: true,
      // Preserve PTY cursor movement semantics for TUIs like hermes.
      convertEol: false,
      theme: {
        background: "#0d1117",
        foreground: "#d6dde8",
        cursor: visual.accent,
        cursorAccent: "#0d1117",
        selectionBackground: visual.accentSoft,
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type === "keydown" && e.ctrlKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) terminal.paste(text);
        }).catch(() => {
          try { (terminal as { paste?: (value: string) => void }).paste?.(""); } catch {}
        });
        return false;
      }
      return true;
    });

    const dataDisposable = terminal.onData((data) => {
      invoke("write_terminal", { sessionId: session.session_id, text: data }).catch((error) => {
        terminal.writeln(`\r\n[frontend] write failed: ${String(error)}`);
      });
    });

    terminalBundlesRef.current.set(session.session_id, { terminal, fitAddon, dataDisposable });

    const host = terminalHostsRef.current.get(session.session_id);
    if (host) {
      host.innerHTML = "";
      terminal.open(host);
      void hydrateTerminalBuffer(session.session_id, terminal, false);
      terminal.focus();
      terminal.element?.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) terminal.paste(text);
        }).catch(() => {});
      });
      void fitSession(session.session_id);
    }
  }, [fitSession, hydrateTerminalBuffer]);

  const chooseFallbackSession = useCallback((list: SessionInfo[]) => {
    const running = [...list].sort((a, b) => a.started_at - b.started_at).find((item) => isRunningStatus(item.status));
    return running?.session_id ?? (list.length > 0 ? list[list.length - 1].session_id : null);
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const previousIds = new Set(sessions.map((item) => item.session_id));
      const list = (await invoke<SessionInfo[]>("list_sessions")).filter(
        (item) => !closingSessionIdsRef.current.has(item.session_id)
      );
      if (!mountedRef.current) return;

      for (const session of list) {
        const alreadyKnown = knownSessionIdsRef.current.has(session.session_id);
        const alreadyBound = terminalBundlesRef.current.has(session.session_id);
        if (!alreadyKnown && !alreadyBound) {
          bufferHydrationRef.current.add(session.session_id);
        }
      }

      setSessions(list);
      const added = list.filter((item) => !previousIds.has(item.session_id));
      if (initialSessionLoadDoneRef.current && added.length > 0) {
        const newest = [...added].sort((a, b) => a.started_at - b.started_at)[added.length - 1];
        if (newest) {
          activeSessionRef.current = newest.session_id;
          setSessionId(newest.session_id);
        }
      }
      const active = activeSessionRef.current;
      if (!active || !list.some((item) => item.session_id === active)) {
        const fallback = chooseFallbackSession(list);
        traceDebug("refreshSessions:fallback", { active, fallback, sessionIds: list.map((item) => item.session_id) });
        activeSessionRef.current = fallback;
        setSessionId(fallback);
      }

      if (list.length > 0) {
        const known = new Set(list.map((item) => item.session_id));
        setStartingSessionIds((prev) => prev.filter((sid) => known.has(sid)));
      } else {
        setStartingSessionIds([]);
      }
    } catch {
      // ignore
    }
  }, [chooseFallbackSession, traceDebug]);

  const refreshAdminStatus = useCallback(async () => {
    try {
      const status = await invoke<ConsoleAdminStatus>("get_console_admin_status");
      if (mountedRef.current) {
        setAdminStatus(status);
      }
    } catch {
      if (mountedRef.current) {
        setAdminStatus({ is_elevated: false });
      }
    }
  }, []);

  const cleanupSessionListeners = useCallback((sid: string) => {
    const fns = unlistenersRef.current.get(sid);
    if (fns) {
      fns.forEach((fn) => fn());
      unlistenersRef.current.delete(sid);
    }
    attachingListenersRef.current.delete(sid);
  }, []);

  const attachSessionListeners = useCallback(async (sid: string) => {
    if (unlistenersRef.current.has(sid) || attachingListenersRef.current.has(sid)) return;
    attachingListenersRef.current.add(sid);

    try {
      const stdout = await listen<string>(`term:stdout:${sid}`, (event) => {
        if (!mountedRef.current) return;
        const hydratedTail = hydratedSnapshotTailRef.current.get(sid);
        if (hydratedTail) {
          hydratedSnapshotTailRef.current.delete(sid);
          liveOutputSeenRef.current.add(sid);
          if (hydratedTail.endsWith(event.payload) || hydratedTail.includes(event.payload)) {
            return;
          }
        }
        liveOutputSeenRef.current.add(sid);
        markSessionStarting(sid, false);
        appendOutput(sid, event.payload);
        void refreshSessions();
      });
      const stderr = await listen<string>(`term:stderr:${sid}`, (event) => {
        if (!mountedRef.current) return;
        const hydratedTail = hydratedSnapshotTailRef.current.get(sid);
        if (hydratedTail) {
          hydratedSnapshotTailRef.current.delete(sid);
          liveOutputSeenRef.current.add(sid);
          if (hydratedTail.endsWith(event.payload) || hydratedTail.includes(event.payload)) {
            return;
          }
        }
        liveOutputSeenRef.current.add(sid);
        markSessionStarting(sid, false);
        appendOutput(sid, event.payload);
        void refreshSessions();
      });
      const exit = await listen<number>(`term:exit:${sid}`, (event) => {
        if (!mountedRef.current) return;
        markSessionStarting(sid, false);
        appendSystem(sid, `Session exited with code ${event.payload}`);
        void refreshSessions();
      });

      unlistenersRef.current.set(sid, [stdout, stderr, exit]);
    } finally {
      attachingListenersRef.current.delete(sid);
    }
  }, [appendOutput, appendSystem, markSessionStarting, refreshSessions]);

  const syncSessionBindings = useCallback(async (list: SessionInfo[]) => {
    for (const session of list) {
      ensureTerminalSession(session);
      await attachSessionListeners(session.session_id);
    }
  }, [attachSessionListeners, ensureTerminalSession]);

  const focusTerminal = useCallback((sid: string | null) => {
    if (!sid) return;
    requestAnimationFrame(() => {
      const bundle = terminalBundlesRef.current.get(sid);
      if (!bundle) return;
      if (bundle.terminal.rows > 0) {
        bundle.terminal.refresh(0, bundle.terminal.rows - 1);
      }
      bundle.terminal.focus();
      void fitSession(sid);
    });
  }, [fitSession]);

  const switchSession = useCallback(async (sid: string) => {
    traceDebug("switchSession:start", { from: activeSessionRef.current, to: sid });
    activeSessionRef.current = sid;
    setSessionId(sid);
    ensureTerminalSession(
      sessions.find((item) => item.session_id === sid) ?? {
        session_id: sid,
        shell_kind: defaultShell,
        cwd: "",
        status: "Running",
        started_at: Date.now(),
        last_output_at: Date.now(),
      }
    );
    await attachSessionListeners(sid);
    focusTerminal(sid);
    traceDebug("switchSession:done", { active: sid });
  }, [attachSessionListeners, defaultShell, ensureTerminalSession, focusTerminal, sessions, traceDebug]);

  const createAndStartSession = useCallback(async (shellKind?: string) => {
    const sk = shellKind || newTabShell;
    try {
      traceDebug("createAndStartSession:start", { shell: sk });
      setDefaultShell(sk);
      try {
        await invoke("set_terminal_prefs", { prefs: { default_shell: sk } });
      } catch {
        // ignore
      }
      const sid = await invoke<string>("create_session", { shellKind: sk, cwd: null });
      knownSessionIdsRef.current.add(sid);
      bufferHydrationRef.current.delete(sid);
      liveOutputSeenRef.current.delete(sid);
      hydratedSnapshotTailRef.current.delete(sid);
      const tempSession: SessionInfo = {
        session_id: sid,
        shell_kind: sk,
        cwd: "",
        status: "Running",
        started_at: Date.now(),
        last_output_at: Date.now(),
      };
      setSessions((prev) => {
        const existing = prev.find((item) => item.session_id === sid);
        if (existing) {
          return prev.map((item) => item.session_id === sid ? tempSession : item);
        }
        return [...prev, tempSession];
      });
      ensureTerminalSession(tempSession);
      await attachSessionListeners(sid);
      markSessionStarting(sid, true);
      activeSessionRef.current = sid;
      setSessionId(sid);
      appendSystem(sid, `${sk.toUpperCase()} session starting...`);
      const initialSize = await getTerminalStartSize(sid);
      await invoke("start_session", {
        sessionId: sid,
        cols: initialSize?.cols ?? null,
        rows: initialSize?.rows ?? null,
      });
      await refreshSessions();
      focusTerminal(sid);
      traceDebug("createAndStartSession:done", { shell: sk, sessionId: sid });
    } catch (error) {
      const sid = activeSessionRef.current;
      if (sid) {
        appendSystem(sid, `Failed to start ${sk}: ${String(error)}`);
      }
      markSessionStarting(activeSessionRef.current ?? "", false);
      traceDebug("createAndStartSession:error", String(error));
    }
  }, [appendSystem, attachSessionListeners, ensureTerminalSession, focusTerminal, getTerminalStartSize, markSessionStarting, newTabShell, refreshSessions, traceDebug]);

  const closeSession = useCallback(async (sid: string) => {
    if (closingSessionIdsRef.current.has(sid)) return;
    closingSessionIdsRef.current.add(sid);

    knownSessionIdsRef.current.delete(sid);
    bufferHydrationRef.current.delete(sid);
    liveOutputSeenRef.current.delete(sid);
    hydratedSnapshotTailRef.current.delete(sid);
    cleanupSessionListeners(sid);
    disposeTerminalSession(sid);
    markSessionStarting(sid, false);

    const remaining = sessions.filter((item) => item.session_id !== sid);
    const fallback = chooseFallbackSession(remaining);
    activeSessionRef.current = fallback;
    setSessionId(fallback);
    setSessions(remaining);
    if (fallback) {
      focusTerminal(fallback);
    }

    void invoke("remove_session", { sessionId: sid })
      .catch(() => {
        // ignore and let a later refresh reconcile if needed
      })
      .finally(() => {
        window.setTimeout(() => {
          closingSessionIdsRef.current.delete(sid);
          void refreshSessions();
        }, 1200);
      });
  }, [chooseFallbackSession, cleanupSessionListeners, disposeTerminalSession, focusTerminal, markSessionStarting, refreshSessions, sessions]);

  const setPreferredShell = useCallback((shellKind: string) => {
    traceDebug("setPreferredShell", { shell: shellKind, currentTab: sessionId });
    setNewTabShell(shellKind);
  }, [sessionId, traceDebug]);

  const suppressToolbarMouse = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    traceDebug("sessionId:update", { sessionId });
  }, [sessionId, traceDebug]);

  useEffect(() => {
    knownSessionIdsRef.current = new Set(sessions.map((session) => session.session_id));
    const known = new Set(sessions.map((session) => session.session_id));
    liveOutputSeenRef.current.forEach((sid) => {
      if (!known.has(sid)) {
        liveOutputSeenRef.current.delete(sid);
      }
    });
    hydratedSnapshotTailRef.current.forEach((_value, sid) => {
      if (!known.has(sid)) {
        hydratedSnapshotTailRef.current.delete(sid);
      }
    });
  }, [sessions]);

  useEffect(() => {
    (async () => {
      try {
        const prefs = await invoke<{ default_shell: string }>("get_terminal_prefs");
        if (prefs && mountedRef.current) {
          setDefaultShell(prefs.default_shell || "cmd");
          setNewTabShell(prefs.default_shell || "cmd");
        }
      } catch {
        // ignore
      }
    })();
    void refreshAdminStatus();
  }, [refreshAdminStatus]);

  useEffect(() => {
    mountedRef.current = true;
    traceDebug("mount:init");
    (async () => {
      try {
        const existing = await invoke<SessionInfo[]>("list_sessions");
        if (!mountedRef.current) return;
        bufferHydrationRef.current = new Set(existing.map((session) => session.session_id));
        knownSessionIdsRef.current = new Set(existing.map((session) => session.session_id));
        liveOutputSeenRef.current.clear();
        hydratedSnapshotTailRef.current.clear();
        setSessions(existing);
        await syncSessionBindings(existing);
        const fallback = chooseFallbackSession(existing);
        if (fallback) {
          traceDebug("mount:fallback", { fallback, sessionIds: existing.map((item) => item.session_id) });
          activeSessionRef.current = fallback;
          setSessionId(fallback);
          initialSessionLoadDoneRef.current = true;
          focusTerminal(fallback);
          return;
        }
      } catch {
        // ignore
      }

      initialSessionLoadDoneRef.current = true;
      await createAndStartSession();
    })();

    return () => {
      mountedRef.current = false;
      traceDebug("mount:cleanup");
      unlistenersRef.current.forEach((fns) => fns.forEach((fn) => fn()));
      unlistenersRef.current.clear();
      resizeObserversRef.current.forEach((observer) => observer.disconnect());
      resizeObserversRef.current.clear();
      hydratedSnapshotTailRef.current.clear();
      terminalBundlesRef.current.forEach((bundle) => {
        bundle.dataDisposable.dispose();
        bundle.terminal.dispose();
      });
      terminalBundlesRef.current.clear();
      terminalHostsRef.current.clear();
      initialSessionLoadDoneRef.current = false;
    };
  }, [chooseFallbackSession, createAndStartSession, focusTerminal, syncSessionBindings, traceDebug]);

  useEffect(() => {
    void syncSessionBindings(sessions);
    const knownIds = new Set(sessions.map((session) => session.session_id));
    Array.from(terminalBundlesRef.current.keys()).forEach((sid) => {
      if (!knownIds.has(sid)) {
        disposeTerminalSession(sid);
        cleanupSessionListeners(sid);
      }
    });
  }, [cleanupSessionListeners, disposeTerminalSession, sessions, syncSessionBindings]);

  useEffect(() => {
    if (sessions.length === 0) return;
    const hasSelected = sessionId && sessions.some((item) => item.session_id === sessionId);
    if (hasSelected) return;
    const fallback = chooseFallbackSession(sessions);
    if (!fallback) return;
    activeSessionRef.current = fallback;
    setSessionId(fallback);
  }, [chooseFallbackSession, sessionId, sessions]);

  useEffect(() => {
    if (!sessionId) return;
    traceDebug("focusEffect", { sessionId });
    focusTerminal(sessionId);
  }, [focusTerminal, sessionId, traceDebug]);

  useEffect(() => {
    const onResize = () => {
      if (activeSessionRef.current) {
        void fitSession(activeSessionRef.current);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitSession]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshSessions();
      void refreshAdminStatus();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [refreshAdminStatus, refreshSessions]);

  const registerTerminalHost = useCallback((sid: string, node: HTMLDivElement | null) => {
    if (!node) {
      terminalHostsRef.current.delete(sid);
      return;
    }

    terminalHostsRef.current.set(sid, node);
    const oldObserver = resizeObserversRef.current.get(sid);
    if (oldObserver) {
      oldObserver.disconnect();
    }
    const observer = new ResizeObserver(() => {
      void fitSession(sid);
    });
    observer.observe(node);
    resizeObserversRef.current.set(sid, observer);

    const bundle = terminalBundlesRef.current.get(sid);
    if (bundle && node.childElementCount === 0) {
      bundle.terminal.open(node);
      void hydrateTerminalBuffer(sid, bundle.terminal, true);
      bundle.terminal.focus();
      if (bundle.terminal.rows > 0) {
        bundle.terminal.refresh(0, bundle.terminal.rows - 1);
      }
      bundle.terminal.element?.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) bundle.terminal.paste(text);
        }).catch(() => {});
      });
      void fitSession(sid);
    }
  }, [fitSession, hydrateTerminalBuffer]);

  const currentStatusLabel = currentSessionInfo
    ? startingSessionIds.includes(currentSessionInfo.session_id)
      ? "Starting"
      : formatSessionStatus(currentSessionInfo.status)
    : "No session";

  const currentStatusTone = currentSessionInfo
    ? startingSessionIds.includes(currentSessionInfo.session_id)
      ? "#f2cc60"
      : isRunningStatus(currentSessionInfo.status)
        ? "#3fb950"
        : "#8b949e"
    : "#8b949e";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
        borderRadius: "var(--radius-lg)",
        border: "1px solid #21262d",
        background: "linear-gradient(180deg, #11161f 0%, #0d1117 58%)",
      }}
    >
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${shellVisual.accent}, transparent 82%)`,
          flexShrink: 0,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "12px 14px",
          borderBottom: "1px solid #21262d",
          background: "rgba(13,17,23,0.84)",
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: `linear-gradient(135deg, ${shellVisual.accentSoft}, rgba(255,255,255,0.04))`,
                border: `1px solid ${shellVisual.border}`,
                flexShrink: 0,
              }}
            >
              <ShellIcon size={18} color={shellVisual.accent} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span
                style={{
                  color: "#dce7f7",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.7px",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: shellVisual.accent, marginRight: 6 }}>{promptChar}</span>
                Vibe Console
              </span>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: currentStatusTone,
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${shellVisual.border}`,
                whiteSpace: "nowrap",
              }}
            >
              <Activity size={13} />
              {currentStatusLabel}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {(["cmd", "pwsh", "wsl"] as const).map((shell) => {
              const visual = getShellVisual(shell);
              const isActive = newTabShell === shell;
              return (
                <button
                  key={shell}
                  type="button"
                  onMouseDown={suppressToolbarMouse}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setPreferredShell(shell);
                  }}
                  title={`Set ${shell} as default for new tabs`}
                  style={{
                    padding: "7px 12px",
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 600,
                    letterSpacing: "0.4px",
                    borderRadius: 8,
                    border: `1px solid ${isActive ? visual.border : "#30363d"}`,
                    cursor: "pointer",
                    background: isActive ? visual.accentSoft : "rgba(255,255,255,0.02)",
                    color: isActive ? visual.accent : "#9aa4b2",
                    whiteSpace: "nowrap",
                    lineHeight: "20px",
                    minWidth: 54,
                    textAlign: "center",
                    transition: "none",
                  }}
                >
                  {shell}
                </button>
              );
            })}
            <button
              type="button"
              onMouseDown={suppressToolbarMouse}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void createAndStartSession(newTabShell);
              }}
              title="New session"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid #30363d",
                color: "#dce7f7",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <Plus size={14} />
              New tab
            </button>
            <div style={{ width: 14, flexShrink: 0 }} />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                color: adminStatus?.is_elevated ? "#7ee787" : "#f2cc60",
                background: adminStatus?.is_elevated ? "rgba(126,231,135,0.12)" : "rgba(242,204,96,0.10)",
                border: adminStatus?.is_elevated
                  ? "1px solid rgba(126,231,135,0.24)"
                  : "1px solid rgba(242,204,96,0.22)",
              }}
            >
              {adminStatus?.is_elevated ? <ShieldCheck size={14} /> : <Shield size={14} />}
              {adminStatus?.is_elevated ? "Administrator" : "Standard user"}
            </span>
            {!adminStatus?.is_elevated && (
              <button
                type="button"
                onMouseDown={suppressToolbarMouse}
                disabled
                title="Launch YiboVibe as administrator from Windows to use admin-only shells."
                style={{
                  background: "rgba(76,194,255,0.14)",
                  border: "1px solid rgba(76,194,255,0.24)",
                  color: "#bfe7ff",
                  cursor: "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  marginLeft: 6,
                  opacity: 0.72,
                }}
              >
                <Shield size={14} />
                Admin needs restart
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
            overflowX: "auto",
            paddingBottom: 2,
          }}
        >
          {sortedSessions.length > 0 ? sortedSessions.map((session, index) => {
            const active = session.session_id === sessionId;
            const visual = getShellVisual(session.shell_kind);
            const isStarting = startingSessionIds.includes(session.session_id);
            const tabStatus = isStarting ? "Starting" : formatSessionStatus(session.status);
            const showTabStatus = tabStatus !== "Running";
            return (
              <div
                key={session.session_id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px 7px 10px",
                  borderRadius: 10,
                  border: `1px solid ${active ? visual.border : "rgba(255,255,255,0.08)"}`,
                  background: active ? visual.accentSoft : "rgba(255,255,255,0.03)",
                  color: active ? "#eef6ff" : "#a7b0bd",
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
                title={`${session.shell_kind} | ${tabStatus}`}
              >
                <button
                  type="button"
                  onClick={() => switchSession(session.session_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void switchSession(session.session_id);
                    }
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                    padding: 0,
                    margin: 0,
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                  title={`${session.shell_kind} | ${tabStatus}`}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: isStarting
                        ? "#f2cc60"
                        : isRunningStatus(session.status)
                          ? "#3fb950"
                          : "#6e7681",
                      flexShrink: 0,
                    }}
                  />
                  <span>{session.shell_kind} #{index + 1}</span>
                  {showTabStatus && (
                    <span style={{ color: active ? visual.accent : "#7f8896", fontSize: 11 }}>
                      {tabStatus}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void closeSession(session.session_id);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                    color: active ? "#eef6ff" : "#c2cad5",
                    fontSize: 16,
                    lineHeight: 1,
                    flexShrink: 0,
                    border: "none",
                    cursor: "pointer",
                  }}
                  title="Close session"
                >
                  ×
                </button>
              </div>
            );
          }) : (
            <span style={{ color: "#8b949e", fontSize: 12 }}>No active session</span>
          )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          margin: 12,
          marginBottom: 10,
          boxSizing: "border-box",
          overflow: "auto",
          background: shellVisual.outputBg,
          border: `1px solid ${shellVisual.border}`,
          borderRadius: 14,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          position: "relative",
        }}
      >
        {sortedSessions.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "#8b949e",
              fontSize: 13,
            }}
          >
            Click <strong style={{ color: "#dce7f7", marginLeft: 6 }}>New tab</strong> to start a shell.
          </div>
        )}

        {sortedSessions.map((session) => (
          <div
            key={session.session_id}
            style={{
              position: "absolute",
              inset: 0,
              display: session.session_id === sessionId ? "block" : "none",
              padding: 12,
              boxSizing: "border-box",
            }}
            onMouseDown={() => focusTerminal(session.session_id)}
          >
            <div
              ref={(node) => registerTerminalHost(session.session_id, node)}
              className="vibe-console-terminal"
              tabIndex={0}
              style={{
                width: "100%",
                height: "100%",
              }}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          minWidth: 0,
          padding: "0 14px 12px",
          fontSize: 12,
          color: "#a8b0bc",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: "1 1 420px", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: shellVisual.accent }}>
            <FolderTree size={13} />
            <span
              title={currentSessionInfo?.cwd || ""}
              style={{
                maxWidth: "100%",
                whiteSpace: "nowrap",
                overflowX: "auto",
                overflowY: "hidden",
                scrollbarWidth: "thin",
              }}
              dir="auto"
            >
              {currentSessionInfo?.cwd || "No path available yet"}
            </span>
          </span>
          <span>{currentSessionInfo ? `Session #${currentSessionIndex}` : "No session"}</span>
          <span>{currentSessionInfo ? formatRelativeOutput(currentSessionInfo.last_output_at) : "Idle"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>{runningSessions} running</span>
          <span>{adminStatus?.is_elevated ? "Admin ready" : "Admin not granted"}</span>
        </div>
      </div>
    </div>
  );
}
