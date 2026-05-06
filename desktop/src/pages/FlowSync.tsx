import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback, useRef, useMemo, memo, useLayoutEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
    ClipboardCopy,
    Copy, Trash2, Check, ChevronDown, ImageIcon, FileType, X, Search, Pin, PinOff, Download, Settings2, ToggleRight, ToggleLeft, FolderOpen, Plus, Send, Upload, Link2, ArrowUpRight
} from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";

interface HistoryEntry {
    id: number;
    timestamp: number;
    type: "text" | "image" | "file" | "bundle";
    hash: string;
    size: number;
    preview: string | null;
    pinned: boolean;
    source: string;
}

interface FlowSyncDiagnostics {
    build_id: string;
    build_git_commit: string;
    build_git_dirty: boolean;
    build_unix_ts: string;
    build_profile: string;
    build_target_dir: string;
    exe_path: string;
    global_dir: string;
    active_user_dir: string;
    active_user: string | null;
    is_connected: boolean;
    receive_only_mode: boolean;
    server_url: string | null;
    username: string | null;
    device_name: string | null;
    remote_device_id: number | null;
    persistent_device_fingerprint: string;
    runtime_device_fingerprint: string;
    activity_total_entries: number | null;
    activity_sample_query_count: number | null;
    activity_query_error: string | null;
}

interface ClusterDevice {
    id: string;
    name: string;
    is_online: boolean;
    is_local: boolean;
    device_type: string;
}

interface FlowTransferRecord {
    transfer_id: string;
    entry_id: number;
    object_id: string;
    status: string;
    direction: string;
    source_device_name: string | null;
    target_device_name: string | null;
    bytes_total: number;
    bytes_done: number;
    created_at: number;
    updated_at: number;
}

interface FlowEntryTransferState {
    entry_id: number;
    has_local_content: boolean;
    transfer_status: string;
    availability: string;
    source_device_name: string | null;
    source_device_id: string | null;
    stage_object_id: string | null;
    stage_expires_at: number | null;
    latest_transfer: FlowTransferRecord | null;
}

interface FlowSyncStagedObjectInfo {
    id: string;
    uid: number;
    kind: string;
    root_hash: string;
    title: string;
    manifest_json: string;
    size_bytes: number;
    chunk_count: number;
    ttl_seconds: number;
    status: string;
    storage_path: string;
    expires_at: string;
    completed_at: string | null;
    created_at: string | null;
    updated_at: string | null;
}

interface FlowSyncStagingPreference {
    default_ttl_seconds: number;
}

interface FlowSyncStagingPolicy {
    id: number;
    staging_enabled: boolean;
    default_ttl_seconds: number;
    max_ttl_seconds: number;
    max_object_size_bytes: number;
    user_quota_bytes: number;
    external_links_enabled: boolean;
    external_link_max_ttl_seconds: number;
    gc_interval_seconds: number;
}

interface FlowSyncShareLinkInfo {
    id: number;
    uid: number;
    stage_object_id: string;
    token_preview: string;
    status: string;
    ttl_seconds: number;
    max_downloads: number;
    download_count: number;
    last_downloaded_at: string | null;
    disabled_at: string | null;
    expires_at: string;
    created_at: string | null;
    updated_at: string | null;
    share_url: string;
}

type TimeFilter = "all" | "today" | "yesterday" | "week" | "month";
type TypeFilter = "all" | "text" | "image" | "file" | "bundle";
type StageFilter = "all" | "staged" | "shared";

const ANIMATED_ITEMS = 8;
const PAGE_SIZE = 100;
const DURATION_OPTIONS = [
    { value: "0", label: "跟随服务器默认" },
    { value: String(60 * 60), label: "1 小时" },
    { value: String(6 * 60 * 60), label: "6 小时" },
    { value: String(24 * 60 * 60), label: "1 天" },
    { value: String(3 * 24 * 60 * 60), label: "3 天" },
    { value: String(7 * 24 * 60 * 60), label: "7 天" },
] as const;
const SERVER_DEFAULT_DURATION_OPTIONS = DURATION_OPTIONS.filter((option) => option.value !== "0");
const DOWNLOAD_LIMIT_OPTIONS = [
    { value: "1", label: "仅 1 次" },
    { value: "3", label: "最多 3 次" },
    { value: "10", label: "最多 10 次" },
    { value: "0", label: "不限制次数" },
] as const;

function getDayStart(d: Date): Date {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}

function describeSource(source: string, t: (key: string, options?: any) => string) {
    if (source === "local") {
        return t("sync.source_local", "本机");
    }
    if (source.startsWith("sync:")) {
        return t("sync.source_sync_device", { device: source.slice(5) || t("sync.source_other_device", "其他设备") });
    }
    if (source.startsWith("pull:")) {
        return t("sync.source_pull_device", { device: source.slice(5) || t("sync.source_other_device", "其他设备") });
    }
    return source;
}

function describeDuration(seconds?: number | null) {
    if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return "跟随服务器默认";
    const value = Number(seconds);
    if (value % (24 * 60 * 60) === 0) return `${value / (24 * 60 * 60)} 天`;
    if (value % (60 * 60) === 0) return `${value / (60 * 60)} 小时`;
    if (value % 60 === 0) return `${value / 60} 分钟`;
    return `${value} 秒`;
}

function normalizeNasError(error: unknown) {
    const raw = typeof error === "string"
        ? error
        : error instanceof Error
            ? error.message
            : String(error ?? "");
    const lower = raw.toLowerCase();
    if (
        lower.includes("token is expired") ||
        lower.includes("invalid or expired access token") ||
        lower.includes("authorization header is missing")
    ) {
        return "当前登录已过期，请重新登录后再使用 NAS 暂存和分享。";
    }
    if (lower.includes("external share links are currently disabled by administrator policy")) {
        return "当前服务器已关闭外部分享链接，请先在管理员设置里开启外链分享。";
    }
    if (lower.includes("not authenticated")) {
        return "当前还没有登录远端账号，请先登录后再使用 NAS 暂存和分享。";
    }
    return raw;
}

function isRetryableServerAuthError(message: string, includeAdmin = false) {
    return message.includes("Not authenticated") ||
        message.includes("Invalid or expired access token") ||
        message.includes("Authorization header is missing") ||
        message.includes("token is expired") ||
        (includeAdmin && message.includes("Admin access required"));
}

function canCopyHistory(entry: HistoryEntry) {
    return entry.type === "text" || entry.type === "image";
}

function isTransferActive(status?: string | null) {
    return status === "created" || status === "offered" || status === "accepted" || status === "transferring" || status === "verifying";
}

function describeTransferStatus(status?: string | null) {
    switch (status) {
        case "created": return "已创建";
        case "offered": return "已发起";
        case "accepted": return "已接受";
        case "transferring": return "传输中";
        case "paused": return "已暂停";
        case "verifying": return "校验中";
        case "completed": return "已完成";
        case "failed": return "失败";
        case "expired": return "已过期";
        case "metadata_only": return "仅元数据";
        default: return status || "-";
    }
}

function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const FilterChip = memo(function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: "3px 10px",
                borderRadius: "100px",
                fontSize: "11.5px",
                fontWeight: active ? 600 : 400,
                background: active ? "var(--color-primary)" : "transparent",
                color: active ? "#fff" : "var(--color-text-muted)",
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
            }}
        >
            {label}
        </button>
    );
});

const ChoiceButtonGroup = memo(function ChoiceButtonGroup({
    value,
    onChange,
    options,
}: {
    value: string;
    onChange: (value: string) => void;
    options: readonly { value: string; label: string }[];
}) {
    return (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {options.map((option) => (
                <button
                    key={option.value}
                    onClick={() => onChange(option.value)}
                    style={{
                        minHeight: "38px",
                        padding: "0 14px",
                        borderRadius: "14px",
                        border: `1px solid ${value === option.value ? "rgba(94, 106, 210, 0.35)" : "transparent"}`,
                        background: value === option.value ? "var(--color-primary)" : "transparent",
                        color: value === option.value ? "#fff" : "var(--color-text-muted)",
                        fontSize: "12px",
                        fontWeight: 600,
                        lineHeight: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        whiteSpace: "nowrap",
                        boxSizing: "border-box",
                        cursor: "pointer",
                        transition: "background 0.15s, color 0.15s, border-color 0.15s",
                    }}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
});

const ToolbarDivider = memo(function ToolbarDivider() {
    return (
        <div
            aria-hidden="true"
            style={{
                width: "1px",
                height: "18px",
                background: "rgba(148, 163, 184, 0.42)",
                borderRadius: "999px",
                flexShrink: 0,
            }}
        />
    );
});

const FilterGroup = memo(function FilterGroup({ title, options, value, onChange }: {
    title: string;
    options: { key: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {title ? <span style={{ fontSize: "11px", color: "var(--color-text-muted)", marginRight: "2px", whiteSpace: "nowrap" }}>{title}</span> : null}
            {options.map(o => (
                <FilterChip key={o.key} label={o.label} active={value === o.key} onClick={() => onChange(o.key)} />
            ))}
        </div>
    );
});

export default function FlowSync() {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<HistoryEntry[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [filterTime, setFilterTime] = useState<TimeFilter>("all");
    const [filterType, setFilterType] = useState<TypeFilter>("all");
    const [filterStage, setFilterStage] = useState<StageFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchActive, setSearchActive] = useState(false);
    const [showClearMenu, setShowClearMenu] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [creatingEntry, setCreatingEntry] = useState<"file" | "bundle" | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [copiedPreview, setCopiedPreview] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
    const [syncEnabled, setSyncEnabled] = useState(true);
    const [debugMode, setDebugMode] = useState(false);
    const [receiveOnlyMode, setReceiveOnlyMode] = useState(false);
    const [diagnostics, setDiagnostics] = useState<FlowSyncDiagnostics | null>(null);
    const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [currentUserRole, setCurrentUserRole] = useState(() => localStorage.getItem("yiboflow_user_role") || "");
    const clearMenuRef = useRef<HTMLDivElement>(null);
    const createMenuRef = useRef<HTMLDivElement>(null);
    const pushMenuRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [transferState, setTransferState] = useState<FlowEntryTransferState | null>(null);
    const [transferStateLoading, setTransferStateLoading] = useState(false);
    const [showPushMenu, setShowPushMenu] = useState(false);
    const [pushDevices, setPushDevices] = useState<ClusterDevice[]>([]);
    const [pushDevicesLoading, setPushDevicesLoading] = useState(false);
    const [downloadingEntry, setDownloadingEntry] = useState(false);
    const [pushingDeviceId, setPushingDeviceId] = useState<string | null>(null);
    const [stagingEntry, setStagingEntry] = useState(false);
    const [stageActionMessage, setStageActionMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
    const [stagedObjects, setStagedObjects] = useState<FlowSyncStagedObjectInfo[]>([]);
    const [, setStagedObjectsLoading] = useState(false);
    const [deletingStageId, setDeletingStageId] = useState<string | null>(null);
    const [stagingPrefs, setStagingPrefs] = useState<FlowSyncStagingPreference | null>(null);
    const [stagingPolicy, setStagingPolicy] = useState<FlowSyncStagingPolicy | null>(null);
    const [stagingPolicyLoading, setStagingPolicyLoading] = useState(false);
    const [savingSharePolicy, setSavingSharePolicy] = useState(false);
    const [stageDefaultTtlInput, setStageDefaultTtlInput] = useState<string>(DURATION_OPTIONS[0].value);
    const [stageCurrentTtlInput, setStageCurrentTtlInput] = useState<string>(DURATION_OPTIONS[0].value);
    const [savingStagePrefs, setSavingStagePrefs] = useState(false);
    const [shareLinks, setShareLinks] = useState<FlowSyncShareLinkInfo[]>([]);
    const [shareLinkTtlInput, setShareLinkTtlInput] = useState<string>(String(24 * 60 * 60));
    const [shareLinkLimitInput, setShareLinkLimitInput] = useState<string>(DOWNLOAD_LIMIT_OPTIONS[0].value);
    const [creatingShareForStageId, setCreatingShareForStageId] = useState<string | null>(null);
    const [disablingShareLinkId, setDisablingShareLinkId] = useState<number | null>(null);
    const [copiedShareLinkId, setCopiedShareLinkId] = useState<number | null>(null);

    const [itemHeight, setItemHeight] = useState(() => {
        const h = Number(localStorage.getItem('yiboflow_item_height') || 56);
        return Number.isFinite(h) ? Math.max(48, h) : 56;
    });
    const [listWidthRatio, setListWidthRatio] = useState(() => {
        const r = Number(localStorage.getItem('yiboflow_list_width_ratio'));
        if (Number.isFinite(r) && r >= 0.25 && r <= 0.55) return r;
        return 0.36;
    });
    const [showAppearancePanel, setShowAppearancePanel] = useState(false);
    const appearanceRef = useRef<HTMLDivElement>(null);
    const [hoveredListId, setHoveredListId] = useState<number | null>(null);

    const selectedLog = useMemo(() => logs.find(l => l.id === selectedId) || null, [logs, selectedId]);
    const stagedHashSet = useMemo(
        () => new Set(stagedObjects.map((item) => item.root_hash).filter(Boolean)),
        [stagedObjects]
    );
    const sharedHashSet = useMemo(() => {
        const sharedStageIds = new Set(
            shareLinks
                .filter((link) => link.status === "active")
                .map((link) => link.stage_object_id)
        );
        return new Set(
            stagedObjects
                .filter((item) => sharedStageIds.has(item.id))
                .map((item) => item.root_hash)
                .filter(Boolean)
        );
    }, [shareLinks, stagedObjects]);
    const visibleLogs = useMemo(() => {
        if (filterStage === "staged") {
            return logs.filter((log) => ["file", "bundle"].includes(log.type) && stagedHashSet.has(log.hash));
        }
        if (filterStage === "shared") {
            return logs.filter((log) => ["file", "bundle"].includes(log.type) && sharedHashSet.has(log.hash));
        }
        if (filterStage !== "all") {
            return logs;
        }
        return logs;
    }, [filterStage, logs, sharedHashSet, stagedHashSet]);

    const tryRestoreServerSession = useCallback(async () => {
        const serverUrl = localStorage.getItem("yiboflow_server_url") || "";
        const username = localStorage.getItem("yiboflow_username") || "";
        const savedPwdB64 = localStorage.getItem("yiboflow_saved_pwd") || "";
        const deviceName = localStorage.getItem("yiboflow_device_name") || "Sim-PC-1";

        if (!serverUrl || !username || !savedPwdB64) {
            return false;
        }

        try {
            const password = atob(savedPwdB64);
            const result: { success: boolean; role: string } = await invoke("connect_engine", {
                serverUrl,
                username,
                password,
                deviceName,
            });
            if (result.success) {
                localStorage.setItem("yiboflow_user_role", result.role);
                setCurrentUserRole(result.role);
                return true;
            }
        } catch (error) {
            console.error("Failed to restore FlowSync server session:", error);
        }

        return false;
    }, []);

    const invokeServerAction = useCallback(async <T,>(
        command: string,
        args?: Record<string, unknown>,
        allowRetry = true,
        includeAdmin = false,
    ) => {
        try {
            return await invoke<T>(command, args);
        } catch (error) {
            const message = String(error);
            if (allowRetry && isRetryableServerAuthError(message, includeAdmin) && (await tryRestoreServerSession())) {
                return invokeServerAction<T>(command, args, false, includeAdmin);
            }
            throw error;
        }
    }, [tryRestoreServerSession]);

    useEffect(() => {
        invoke("init_clipboard_history").catch(e => console.error("init_clipboard_history failed:", e));
    }, []);

    useEffect(() => {
        invoke("get_flow_rules").then((rules: any) => {
            setSyncEnabled(rules.default.flowsync);
        }).catch(e => console.error("Failed to load sync feature state:", e));
    }, []);

    useEffect(() => {
        invoke<any>("get_settings")
            .then((settings) => {
                const enabled = !!settings?.debug_mode;
                setDebugMode(enabled);
                if (!enabled) {
                    setDiagnostics(null);
                    return;
                }
                invoke<{ receive_only_mode: boolean }>("get_flowsync_runtime_state")
                    .then((state) => setReceiveOnlyMode(!!state.receive_only_mode))
                    .catch(e => console.error("Failed to load FlowSync runtime state:", e));
            })
            .catch(e => console.error("Failed to load debug mode:", e));
    }, []);

    const loadDiagnostics = useCallback(async () => {
        setDiagnosticsLoading(true);
        try {
            const data = await invoke<FlowSyncDiagnostics>("get_flowsync_diagnostics");
            setDiagnostics(data);
            setReceiveOnlyMode(!!data.receive_only_mode);
        } catch (e) {
            console.error("Failed to load FlowSync diagnostics:", e);
        } finally {
            setDiagnosticsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (debugMode) {
            loadDiagnostics();
        }
    }, [debugMode, loadDiagnostics]);

    const toggleSyncEnabled = async () => {
        try {
            await invoke("toggle_default_feature", { feature: "flowsync" });
            setSyncEnabled(!syncEnabled);
        } catch (e) {
            console.error("Failed to toggle sync feature:", e);
        }
    };

    const toggleReceiveOnlyMode = useCallback(async () => {
        const next = !receiveOnlyMode;
        try {
            await invoke("set_flowsync_receive_only_mode", { enabled: next });
            setReceiveOnlyMode(next);
            loadDiagnostics();
        } catch (e) {
            console.error("Failed to toggle receive-only mode:", e);
        }
    }, [loadDiagnostics, receiveOnlyMode]);

    const fetchHistory = useCallback(async () => {
        try {
            const now = Date.now();
            let timeFrom: number | null = null;
            let timeTo: number | null = null;
            const todayStart = getDayStart(new Date()).getTime();

            if (filterTime === "today") {
                timeFrom = todayStart;
            } else if (filterTime === "yesterday") {
                timeFrom = todayStart - 86400000;
                timeTo = todayStart;
            } else if (filterTime === "week") {
                timeFrom = now - 7 * 86400000;
            } else if (filterTime === "month") {
                timeFrom = now - 30 * 86400000;
            }

            const results = await invoke<HistoryEntry[]>("query_history", {
                typeFilter: filterType !== "all" ? filterType : null,
                timeFrom,
                timeTo,
                limit: PAGE_SIZE,
                offset: 0,
            });
            setLogs(results);
            setTotalCount(results.length);
            setHistoryLoadError(null);
        } catch (e) {
            console.error("Failed to fetch history:", e);
            setHistoryLoadError(typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? "活动流读取失败"));
        }
    }, [filterTime, filterType]);

    const loadTransferState = useCallback(async (entryId: number, options?: { silent?: boolean }) => {
        if (!options?.silent) {
            setTransferStateLoading(true);
        }
        try {
            const state = await invoke<FlowEntryTransferState | null>("get_flowsync_entry_transfer_state", {
                entryId,
            });
            setTransferState(state);
        } catch (e) {
            console.error("Failed to load FlowSync transfer state:", e);
            if (!options?.silent) {
                setTransferState(null);
            }
        } finally {
            if (!options?.silent) {
                setTransferStateLoading(false);
            }
        }
    }, []);

    const loadPushDevices = useCallback(async () => {
        setPushDevicesLoading(true);
        try {
            const devices = await invoke<ClusterDevice[]>("list_flowsync_online_devices");
            setPushDevices(devices.filter((device) => device.is_online && !device.is_local));
        } catch (e) {
            console.error("Failed to load FlowSync online devices:", e);
            setPushDevices([]);
        } finally {
            setPushDevicesLoading(false);
        }
    }, []);

    const loadStagingPreferences = useCallback(async () => {
        try {
            const prefs = await invokeServerAction<FlowSyncStagingPreference>("get_flowsync_staging_preferences");
            setStagingPrefs(prefs);
            setStageDefaultTtlInput(String(prefs.default_ttl_seconds ?? 0));
            setStageActionMessage((prev) => prev?.kind === "error" ? null : prev);
        } catch (e) {
            console.error("Failed to load FlowSync staging preferences:", e);
        }
    }, [invokeServerAction]);

    useEffect(() => {
        if (!stagingPrefs) return;
        setStageCurrentTtlInput(String(stagingPrefs.default_ttl_seconds ?? 0));
    }, [selectedId, stagingPrefs]);

    const loadMyStagedObjects = useCallback(async () => {
        setStagedObjectsLoading(true);
        try {
            const objects = await invokeServerAction<FlowSyncStagedObjectInfo[]>("list_my_flowsync_staged_objects");
            setStagedObjects(objects);
            setStageActionMessage((prev) => prev?.kind === "error" ? null : prev);
        } catch (e) {
            console.error("Failed to load FlowSync staged objects:", e);
            setStagedObjects([]);
        } finally {
            setStagedObjectsLoading(false);
        }
    }, [invokeServerAction]);

    useEffect(() => {
        void loadMyStagedObjects();
    }, [loadMyStagedObjects]);

    const loadMyShareLinks = useCallback(async () => {
        try {
            const links = await invokeServerAction<FlowSyncShareLinkInfo[]>("list_my_flowsync_share_links");
            setShareLinks(links);
            setStageActionMessage((prev) => prev?.kind === "error" ? null : prev);
        } catch (e) {
            console.error("Failed to load FlowSync share links:", e);
            setShareLinks([]);
        }
    }, [invokeServerAction]);

    useEffect(() => {
        void loadMyShareLinks();
    }, [loadMyShareLinks]);

    const loadStagingPolicy = useCallback(async () => {
        if (currentUserRole !== "admin") {
            setStagingPolicy(null);
            return;
        }
        setStagingPolicyLoading(true);
        try {
            const policy = await invokeServerAction<FlowSyncStagingPolicy>("admin_get_flowsync_staging_policy", undefined, true, true);
            setStagingPolicy(policy);
            setStageActionMessage((prev) => prev?.kind === "error" ? null : prev);
        } catch (e) {
            console.error("Failed to load FlowSync staging policy:", e);
            setStagingPolicy(null);
        } finally {
            setStagingPolicyLoading(false);
        }
    }, [currentUserRole, invokeServerAction]);

    useEffect(() => {
        if (!selectedLog || !["file", "bundle"].includes(selectedLog.type)) {
            setTransferState(null);
            setShowPushMenu(false);
            return;
        }
        void Promise.all([
            loadTransferState(selectedLog.id),
            loadStagingPreferences(),
            loadMyStagedObjects(),
            loadMyShareLinks(),
            loadStagingPolicy(),
        ]);
    }, [loadMyShareLinks, loadMyStagedObjects, loadStagingPolicy, loadStagingPreferences, loadTransferState, selectedLog]);

    useEffect(() => {
        if (!selectedLog || !["file", "bundle"].includes(selectedLog.type)) return;
        const currentStatus = transferState?.latest_transfer?.status || transferState?.transfer_status;
        if (!isTransferActive(currentStatus)) return;
        const timer = window.setInterval(() => {
            void loadTransferState(selectedLog.id, { silent: true });
        }, 1500);
        return () => window.clearInterval(timer);
    }, [loadTransferState, selectedLog, transferState?.latest_transfer?.status, transferState?.transfer_status]);

    const doSearch = useCallback(async () => {
        if (!searchQuery.trim()) {
            fetchHistory();
            return;
        }
        try {
            const results = await invoke<HistoryEntry[]>("search_history", {
                query: searchQuery,
                limit: 50,
            });
            setLogs(results);
            setTotalCount(results.length);
            setHistoryLoadError(null);
        } catch (e) {
            console.error("Search failed:", e);
            setHistoryLoadError(typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? "活动流搜索失败"));
        }
    }, [searchQuery, fetchHistory]);

    useEffect(() => {
        if (searchActive) {
            const timer = setTimeout(doSearch, 300);
            return () => clearTimeout(timer);
        } else {
            fetchHistory();
        }
    }, [searchActive, doSearch, fetchHistory]);

    useEffect(() => {
        if (!(window as any).__TAURI_INTERNALS__) return;
        let unlisten: (() => void) | null = null;
        listen<any>("clipboard-event", () => {
            if (!searchActive) {
                fetchHistory();
            }
        }).then(fn => { unlisten = fn; });
        return () => { if (unlisten) unlisten(); };
    }, [searchActive, fetchHistory]);

    useEffect(() => {
        if (!searchActive) {
            fetchHistory();
        }
    }, [filterTime, filterType, fetchHistory, searchActive]);

    useEffect(() => {
        if (selectedLog) {
            setPreviewLoading(true);
            invoke<{ type: string; content: string; width?: number; height?: number }>("get_history_content", { id: selectedLog.id })
                .then(result => {
                    setPreviewContent(result.content);
                })
                .catch(e => {
                    console.error("Failed to load preview:", e);
                    setPreviewContent(null);
                })
                .finally(() => setPreviewLoading(false));
        } else {
            setPreviewContent(null);
        }
    }, [selectedLog]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (clearMenuRef.current && !clearMenuRef.current.contains(e.target as Node)) setShowClearMenu(false);
            if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) setShowCreateMenu(false);
            if (pushMenuRef.current && !pushMenuRef.current.contains(e.target as Node)) setShowPushMenu(false);
            if (appearanceRef.current && !appearanceRef.current.contains(e.target as Node)) setShowAppearancePanel(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const handleCopy = useCallback(async (log: HistoryEntry, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            await invoke("copy_history_to_clipboard", { id: log.id });
            setCopiedId(log.id);
            setCopiedPreview(selectedId === log.id);
            setCopyFailed(false);
            setTimeout(() => { setCopiedId(null); setCopiedPreview(false); }, 1200);
            fetchHistory();
        } catch (err) {
            console.error("Copy failed:", err);
            setCopyFailed(true);
            setTimeout(() => setCopyFailed(false), 2000);
        }
    }, [selectedId, fetchHistory]);

    const handleDelete = useCallback(async (id: number, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            await invoke("delete_history", { ids: [id] });
            if (selectedId === id) setSelectedId(null);
            fetchHistory();
        } catch (e) {
            console.error("Delete failed:", e);
        }
    }, [selectedId, fetchHistory]);

    const handleTogglePin = useCallback(async (id: number, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            await invoke("toggle_history_pin", { id });
            fetchHistory();
        } catch (e) {
            console.error("Pin failed:", e);
        }
    }, [fetchHistory]);

    const handleClearDays = useCallback(async (days: number) => {
        try {
            await invoke("clear_history", { beforeDays: days });
            setSelectedId(null);
            setShowClearMenu(false);
            fetchHistory();
        } catch (e) {
            console.error("Clear failed:", e);
        }
    }, [fetchHistory]);

    const handleClearAll = useCallback(async () => {
        if (confirmClear) {
            try {
                await invoke("clear_history", {});
                setLogs([]);
                setSelectedId(null);
                setConfirmClear(false);
                setShowClearMenu(false);
            } catch (e) {
                console.error("Clear all failed:", e);
            }
        } else {
            setConfirmClear(true);
        }
    }, [confirmClear]);

    const [pulling, setPulling] = useState(false);
    const handlePull = useCallback(async () => {
        setPulling(true);
        try {
            await invoke("pull_today_history");
            await new Promise(r => setTimeout(r, 3000));
            fetchHistory();
        } catch (e) {
            console.error("Pull failed:", e);
        } finally {
            setPulling(false);
        }
    }, [fetchHistory]);

    const handleCreateEntry = useCallback(async (kind: "file" | "bundle") => {
        setCreatingEntry(kind);
        try {
            const selected = await open({
                multiple: false,
                directory: kind === "bundle",
                title: kind === "bundle" ? "选择文件夹条目" : "选择文件条目",
            });
            const selectedPath = Array.isArray(selected) ? selected[0] : selected;
            if (!selectedPath || typeof selectedPath !== "string") {
                return;
            }
            await invoke("create_flowsync_entry_from_path", { path: selectedPath });
            setShowCreateMenu(false);
            setSearchActive(false);
            await fetchHistory();
        } catch (e) {
            console.error("Create FlowSync entry failed:", e);
        } finally {
            setCreatingEntry(null);
        }
    }, [fetchHistory]);

    const handleDownloadEntry = useCallback(async () => {
        if (!selectedLog || !["file", "bundle"].includes(selectedLog.type)) return;
        setDownloadingEntry(true);
        try {
            await invoke("download_flowsync_entry", { entryId: selectedLog.id });
            await Promise.all([fetchHistory(), loadTransferState(selectedLog.id)]);
        } catch (e) {
            console.error("FlowSync download failed:", e);
        } finally {
            setDownloadingEntry(false);
        }
    }, [fetchHistory, loadTransferState, selectedLog]);

    const handleTogglePushMenu = useCallback(async () => {
        const next = !showPushMenu;
        setShowPushMenu(next);
        if (next && pushDevices.length === 0 && !pushDevicesLoading) {
            await loadPushDevices();
        }
    }, [loadPushDevices, pushDevices.length, pushDevicesLoading, showPushMenu]);

    const handlePushToDevice = useCallback(async (device: ClusterDevice) => {
        if (!selectedLog || !["file", "bundle"].includes(selectedLog.type)) return;
        setPushingDeviceId(device.id);
        try {
            await invoke("push_flowsync_entry_to_device", {
                entryId: selectedLog.id,
                targetDevice: Number(device.id),
                targetDeviceName: device.name,
            });
            setShowPushMenu(false);
            await loadTransferState(selectedLog.id);
        } catch (e) {
            console.error("FlowSync push failed:", e);
        } finally {
            setPushingDeviceId(null);
        }
    }, [loadTransferState, selectedLog]);

    const handleUploadToNas = useCallback(async () => {
        if (!selectedLog) return;
        setStagingEntry(true);
        setStageActionMessage(null);
        try {
            await invokeServerAction("upload_flowsync_entry_to_nas", {
                entryId: selectedLog.id,
                ttlSeconds: Math.floor(Number(stageCurrentTtlInput) || 0),
            });
            await Promise.all([loadTransferState(selectedLog.id), loadMyStagedObjects(), loadMyShareLinks(), loadStagingPolicy()]);
        } catch (e) {
            console.error("FlowSync NAS staging failed:", e);
            setStageActionMessage({ kind: "error", text: normalizeNasError(e) || "上传到 NAS 失败，请检查当前登录状态、服务端连接和 NAS 暂存策略。" });
        } finally {
            setStagingEntry(false);
        }
    }, [invokeServerAction, loadMyShareLinks, loadMyStagedObjects, loadStagingPolicy, loadTransferState, selectedLog, stageCurrentTtlInput]);

    const handleDeleteStageObject = useCallback(async (stageObjectId: string) => {
        setDeletingStageId(stageObjectId);
        try {
            await invokeServerAction("delete_my_flowsync_staged_object", { stageObjectId });
            await Promise.all([
                selectedLog ? loadTransferState(selectedLog.id) : Promise.resolve(),
                loadMyStagedObjects(),
                loadMyShareLinks(),
            ]);
        } catch (e) {
            console.error("Failed to delete FlowSync staged object:", e);
            setStageActionMessage({ kind: "error", text: normalizeNasError(e) });
        } finally {
            setDeletingStageId(null);
        }
    }, [invokeServerAction, loadMyShareLinks, loadMyStagedObjects, loadTransferState, selectedLog]);

    const handleSaveStageDefaultTtl = useCallback(async (nextValue: string) => {
        const next = Number(nextValue);
        if (!Number.isFinite(next) || next < 0) return;
        setStageDefaultTtlInput(nextValue);
        setSavingStagePrefs(true);
        try {
            const prefs = await invokeServerAction<FlowSyncStagingPreference>("set_flowsync_staging_preferences", {
                defaultTtlSeconds: Math.floor(next),
            });
            setStagingPrefs(prefs);
            setStageDefaultTtlInput(String(prefs.default_ttl_seconds));
        } catch (e) {
            console.error("Failed to save FlowSync staging preferences:", e);
            setStageActionMessage({ kind: "error", text: normalizeNasError(e) });
        } finally {
            setSavingStagePrefs(false);
        }
    }, [invokeServerAction]);

    const handleCreateShareLink = useCallback(async (stageObjectId: string) => {
        const ttl = Number(shareLinkTtlInput);
        const limit = Number(shareLinkLimitInput);
        if (!Number.isFinite(ttl) || ttl < 0 || !Number.isFinite(limit) || limit < 0) return;
        setCreatingShareForStageId(stageObjectId);
        try {
            await invokeServerAction<FlowSyncShareLinkInfo>("create_flowsync_share_link", {
                stageObjectId,
                ttlSeconds: Math.floor(ttl),
                maxDownloads: Math.floor(limit),
            });
            await loadMyShareLinks();
        } catch (e) {
            console.error("Failed to create FlowSync share link:", e);
            setStageActionMessage({ kind: "error", text: normalizeNasError(e) });
        } finally {
            setCreatingShareForStageId(null);
        }
    }, [invokeServerAction, loadMyShareLinks, shareLinkLimitInput, shareLinkTtlInput]);

    const handleDisableShareLink = useCallback(async (shareLinkId: number) => {
        setDisablingShareLinkId(shareLinkId);
        try {
            await invokeServerAction("disable_my_flowsync_share_link", { shareLinkId });
            await loadMyShareLinks();
        } catch (e) {
            console.error("Failed to disable FlowSync share link:", e);
            setStageActionMessage({ kind: "error", text: normalizeNasError(e) });
        } finally {
            setDisablingShareLinkId(null);
        }
    }, [invokeServerAction, loadMyShareLinks]);

    const handleEnableExternalLinks = useCallback(async () => {
        if (!stagingPolicy) return;
        setSavingSharePolicy(true);
        setStageActionMessage(null);
        try {
            const nextPolicy = await invokeServerAction<FlowSyncStagingPolicy>(
                "admin_update_flowsync_staging_policy",
                { policy: { ...stagingPolicy, external_links_enabled: true } },
                true,
                true,
            );
            setStagingPolicy(nextPolicy);
            setStageActionMessage({ kind: "success", text: "已开启外部分享链接，现在可以重新生成分享链接。" });
        } catch (e) {
            console.error("Failed to enable external share links:", e);
            setStageActionMessage({ kind: "error", text: normalizeNasError(e) });
        } finally {
            setSavingSharePolicy(false);
        }
    }, [invokeServerAction, stagingPolicy]);

    const handleCopyShareLink = useCallback(async (link: FlowSyncShareLinkInfo) => {
        try {
            await navigator.clipboard.writeText(link.share_url);
            setCopiedShareLinkId(link.id);
            window.setTimeout(() => setCopiedShareLinkId(null), 1200);
        } catch (e) {
            console.error("Failed to copy FlowSync share link:", e);
        }
    }, []);

    const handleOpenShareLink = useCallback((link: FlowSyncShareLinkInfo) => {
        window.open(link.share_url, "_blank", "noopener,noreferrer");
    }, []);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            setSearchActive(true);
        } else if (e.key === "Escape") {
            setSearchQuery("");
            setSearchActive(false);
        }
    }, []);

    // Layout: list column width from user ratio; preview panel fills the rest
    const contentRef = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState({ contentH: 400, listW: 400 });
    useLayoutEffect(() => {
        const el = contentRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const h = entry.contentRect.height;
                const totalW = entry.contentRect.width;
                const gap = 12;
                const minListW = 240;
                const minPreviewW = 260;
                let listW = Math.round(totalW * listWidthRatio);
                const maxListW = Math.max(minListW, totalW - gap - minPreviewW);
                listW = Math.max(minListW, Math.min(listW, maxListW));
                setLayout({ contentH: Math.floor(h), listW });
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [listWidthRatio]);

    const currentTransferStatus = transferState?.latest_transfer?.status || transferState?.transfer_status;
    const currentTransferActive = isTransferActive(currentTransferStatus);
    const selectedStageObject = transferState?.stage_object_id
        ? stagedObjects.find((item) => item.id === transferState.stage_object_id) ?? null
        : null;
    const selectedStageShareLinks = selectedStageObject
        ? shareLinks.filter((link) => link.stage_object_id === selectedStageObject.id && link.status === "active")
        : [];
    const fileLikeSelected = Boolean(selectedLog && ["file", "bundle"].includes(selectedLog.type));
    const shareableDeviceCount = pushDevices.length;
    const selectedFileTypeLabel = selectedLog?.type === "bundle" ? "文件夹" : selectedLog?.type === "file" ? "文件" : "";
    const selectedAvailabilityStatus = transferStateLoading && !transferState
        ? "读取中..."
        : transferState?.has_local_content
            ? "已有本地副本"
            : "当前仅远端可用";
    const shareLinksDisabledByPolicy = currentUserRole === "admin" && stagingPolicy?.external_links_enabled === false;
    const stageStatusTone = stageActionMessage?.kind === "error"
        ? "error"
        : selectedStageObject
            ? "success"
            : transferState?.stage_object_id
                ? "info"
                : "neutral";
    const stageStatusText = stageActionMessage?.kind === "error"
        ? stageActionMessage.text
        : selectedStageObject
            ? `当前条目已上传到 NAS 暂存，可直接生成或管理分享链接。到期时间 ${new Date(selectedStageObject.expires_at).toLocaleString()}。`
            : transferState?.stage_object_id
                ? `当前条目已关联 NAS 暂存对象 ${transferState.stage_object_id}。`
                : "先把当前文件上传到 NAS 暂存，再为它生成分享链接。";

    return (
        <div style={{ width: "100%", height: "100%", flex: "1", minHeight: 0, paddingBottom: "0", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ marginBottom: "24px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <h1 style={{ fontSize: "22px", fontWeight: 700, display: "flex", alignItems: "center", gap: "10px", margin: 0 }}>
                        <ClipboardCopy size={22} color="var(--color-primary)" />
                        {t("sync.title")}
                    </h1>
                    <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginTop: "6px" }}>
                        {t("sync.subtitle")}
                    </p>
                    <div style={{
                        marginTop: "10px",
                        display: "inline-flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        padding: "8px 12px",
                        borderRadius: "12px",
                        background: receiveOnlyMode ? "rgba(245, 158, 11, 0.12)" : "var(--color-surface-elevated)",
                        border: `1px solid ${receiveOnlyMode ? "rgba(245, 158, 11, 0.28)" : "var(--color-border)"}`,
                        color: receiveOnlyMode ? "#f59e0b" : "var(--color-text-muted)",
                        maxWidth: "780px",
                    }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap", paddingTop: "1px" }}>
                            {receiveOnlyMode ? t("sync.test_mode_badge_on") : t("sync.test_mode_badge_off")}
                        </span>
                        <span style={{ fontSize: "12px", lineHeight: 1.5 }}>
                            {receiveOnlyMode ? t("sync.test_mode_desc_on") : t("sync.test_mode_desc_off")}
                        </span>
                    </div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {debugMode && (
                        <button
                            onClick={() => setShowDiagnostics((v) => !v)}
                            style={{
                                background: showDiagnostics ? "var(--color-primary-glow)" : "var(--color-surface-elevated)",
                                border: `1px solid ${showDiagnostics ? "rgba(94, 106, 210, 0.4)" : "var(--color-border)"}`,
                                color: showDiagnostics ? "var(--color-primary)" : "var(--color-text-muted)",
                                padding: "8px 14px",
                                borderRadius: "100px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "5px",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: "12px",
                                whiteSpace: "nowrap",
                                transition: "all 0.15s",
                                height: "36px",
                            }}
                        >
                            {showDiagnostics ? <ChevronDown size={16} /> : <ChevronDown size={16} style={{ transform: "rotate(-90deg)" }} />}
                            {showDiagnostics ? t("sync.diagnostics_hide") : t("sync.diagnostics_show")}
                        </button>
                    )}
                    <button
                        onClick={toggleSyncEnabled}
                        style={{
                            background: syncEnabled ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-surface-elevated)',
                            border: `1px solid ${syncEnabled ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                            color: syncEnabled ? '#22c55e' : 'var(--color-text-muted)',
                            padding: '8px 14px',
                            borderRadius: '100px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '12px',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s',
                            height: '36px',
                        }}
                    >
                        {syncEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        {syncEnabled ? t('sync.feature_on') : t('sync.feature_off')}
                    </button>
                </div>
            </div>

            {debugMode && showDiagnostics && (
              <div style={{
                  marginBottom: "12px",
                  padding: "12px 14px",
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-glass-border)",
                borderRadius: "var(--radius-md)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                      <div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-main)" }}>
                              {t("sync.diagnostics_title", "同步诊断")}
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "3px" }}>
                              {t("sync.diagnostics_desc", "用于确认当前窗口是否真的是新版本，以及它实际使用的设备身份和数据目录。")}
                          </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                              onClick={toggleReceiveOnlyMode}
                              style={{
                                  background: receiveOnlyMode ? "rgba(245, 158, 11, 0.12)" : "var(--color-surface-elevated)",
                                  border: `1px solid ${receiveOnlyMode ? "rgba(245, 158, 11, 0.3)" : "var(--color-border)"}`,
                                  color: receiveOnlyMode ? "#f59e0b" : "var(--color-text-muted)",
                                  padding: "8px 14px",
                                  borderRadius: "100px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                  fontSize: "12px",
                                  whiteSpace: "nowrap",
                                  transition: "all 0.15s",
                                  height: "36px",
                              }}
                          >
                              {receiveOnlyMode ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                              {receiveOnlyMode ? t("sync.test_mode_on") : t("sync.test_mode_off")}
                          </button>
                          <button
                              onClick={loadDiagnostics}
                              disabled={diagnosticsLoading}
                              style={{
                                  padding: "6px 10px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--color-border)",
                                  background: "var(--color-surface)",
                                  color: "var(--color-text-main)",
                                  cursor: diagnosticsLoading ? "default" : "pointer",
                                  opacity: diagnosticsLoading ? 0.6 : 1,
                                  fontSize: "12px",
                                  fontWeight: 600,
                              }}
                          >
                            {diagnosticsLoading ? t("sync.diagnostics_refreshing", "刷新中...") : t("sync.diagnostics_refresh", "刷新诊断")}
                          </button>
                      </div>
                  </div>

                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: "8px 14px",
                    fontSize: "12px",
                }}>
                    {[
                        [t("sync.diag_connected", "同步连接"), diagnostics?.is_connected ? t("sync.diag_yes", "是") : t("sync.diag_no", "否")],
                        [t("sync.diag_receive_only", "同机接收测试"), diagnostics?.receive_only_mode ? t("sync.diag_yes", "是") : t("sync.diag_no", "否")],
                        [t("sync.diag_active_user", "活动账号"), diagnostics?.active_user || "-"],
                        [t("sync.diag_runtime_user", "远端登录账号"), diagnostics?.username || "-"],
                        [t("sync.diag_device_name", "设备名"), diagnostics?.device_name || "-"],
                        [t("sync.diag_remote_device_id", "远端 device_id"), diagnostics?.remote_device_id != null ? String(diagnostics.remote_device_id) : "-"],
                        [t("sync.diag_server_url", "服务端"), diagnostics?.server_url || "-"],
                        [t("sync.diag_build_id", "构建标识"), diagnostics?.build_id || "-"],
                        [t("sync.diag_build_commit", "构建提交"), diagnostics?.build_git_commit || "-"],
                        [t("sync.diag_build_dirty", "工作区脏状态"), diagnostics == null ? "-" : diagnostics.build_git_dirty ? t("sync.diag_yes", "是") : t("sync.diag_no", "否")],
                        [t("sync.diag_build_ts", "编译时间戳"), diagnostics?.build_unix_ts || "-"],
                        [t("sync.diag_build_profile", "构建 profile"), diagnostics?.build_profile || "-"],
                        [t("sync.diag_build_target_dir", "编译 target 目录"), diagnostics?.build_target_dir || "-"],
                        [t("sync.diag_exe_path", "当前 exe"), diagnostics?.exe_path || "-"],
                        [t("sync.diag_global_dir", "实例数据根目录"), diagnostics?.global_dir || "-"],
                        [t("sync.diag_active_user_dir", "当前用户目录"), diagnostics?.active_user_dir || "-"],
                        [t("sync.diag_persistent_fp", "持久化指纹"), diagnostics?.persistent_device_fingerprint || "-"],
                        [t("sync.diag_runtime_fp", "运行时指纹"), diagnostics?.runtime_device_fingerprint || "-"],
                        [t("sync.diag_activity_total", "活动流总条数"), diagnostics?.activity_total_entries != null ? String(diagnostics.activity_total_entries) : "-"],
                        [t("sync.diag_activity_sample", "活动流抽样查询条数"), diagnostics?.activity_sample_query_count != null ? String(diagnostics.activity_sample_query_count) : "-"],
                        [t("sync.diag_activity_error", "活动流查询错误"), diagnostics?.activity_query_error || "-"],
                    ].map(([label, value]) => (
                        <div key={String(label)} style={{ minWidth: 0 }}>
                            <div style={{ color: "var(--color-text-dim)", marginBottom: "3px" }}>{label}</div>
                            <div style={{
                                color: "var(--color-text-main)",
                                fontFamily: '"Fira Code", monospace, Consolas',
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-border)",
                                borderRadius: "8px",
                                padding: "7px 9px",
                                lineHeight: 1.45,
                                wordBreak: "break-all",
                            }}>
                                {value}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            )}

            {/* Filter Bar */}
            <div style={{
                display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "8px",
                padding: "8px 12px", background: "var(--color-surface-elevated)",
                borderRadius: "var(--radius-md)", border: "1px solid var(--color-glass-border)",
                flexShrink: 0, alignItems: "center",
            }}>
                <FilterGroup title="" value={filterStage} onChange={v => setFilterStage(v as StageFilter)} options={[
                    { key: "all", label: "所有" },
                    { key: "staged", label: "暂存" },
                    { key: "shared", label: "外链" },
                ]} />
                <ToolbarDivider />
                <FilterGroup title={t("sync.filter_time_label")} value={filterTime} onChange={v => { setFilterTime(v as TimeFilter); setSearchActive(false); }} options={[
                    { key: "all", label: t("sync.filter_all") },
                    { key: "today", label: t("sync.filter_today") },
                    { key: "yesterday", label: t("sync.filter_yesterday") },
                    { key: "week", label: t("sync.filter_week") },
                    { key: "month", label: t("sync.filter_month") },
                ]} />
                <ToolbarDivider />
                <FilterGroup title={t("sync.filter_type_label")} value={filterType} onChange={v => { setFilterType(v as TypeFilter); setSearchActive(false); }} options={[
                    { key: "all", label: t("sync.filter_all") },
                    { key: "text", label: t("sync.filter_text") },
                    { key: "image", label: t("sync.filter_image") },
                    { key: "file", label: "文件" },
                    { key: "bundle", label: "文件夹" },
                ]} />
                <ToolbarDivider />
                <div style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1, minWidth: "160px" }}>
                    <Search size={13} color="var(--color-text-muted)" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setSearchActive(true); }}
                        onKeyDown={handleSearchKeyDown}
                        placeholder={t("sync.search_placeholder", "搜索条目内容...")}
                        style={{
                            flex: 1, background: "transparent", border: "none", outline: "none",
                            fontSize: "12px", color: "var(--color-text-main)",
                            fontFamily: "inherit",
                        }}
                    />
                    {searchQuery && (
                        <button onClick={() => { setSearchQuery(""); setSearchActive(false); }} style={{
                            background: "none", border: "none", cursor: "pointer", padding: "2px",
                            color: "var(--color-text-muted)", display: "flex",
                        }}>
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Main Content: List + Preview */}
            <div ref={contentRef} style={{ display: "flex", gap: "12px", flex: 1, minHeight: 0, minWidth: 0 }}>
                {/* Left: Activity List (width from settings) */}
                <div className="glass-panel" style={{ borderRadius: "var(--radius-lg)", display: "flex", flexDirection: "column", overflow: "hidden", flex: `0 0 ${layout.listW}px`, minWidth: 0, maxWidth: "100%" }}>
                    <div style={{ flex: 1, overflowY: "auto", padding: "10px", background: "var(--color-bg-base)", borderRadius: "8px" }}>
                        {historyLoadError && (
                            <div style={{
                                marginBottom: "10px",
                                padding: "10px 12px",
                                borderRadius: "10px",
                                border: "1px solid rgba(239, 68, 68, 0.22)",
                                background: "rgba(239, 68, 68, 0.08)",
                                color: "#b91c1c",
                                fontSize: "12px",
                                lineHeight: 1.6,
                            }}>
                                活动流读取失败：{historyLoadError}
                            </div>
                        )}
                        {visibleLogs.length === 0 ? (
                            <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--color-text-muted)" }}>
                                <ClipboardCopy size={40} style={{ opacity: 0.15, marginBottom: "12px", margin: "0 auto", display: "block" }} />
                                <p style={{ fontSize: "13px" }}>
                                    {filterStage === "staged"
                                        ? "当前筛选下没有已暂存条目"
                                        : filterStage === "shared"
                                            ? "当前筛选下没有带外链的条目"
                                            : t("sync.no_activity_message")}
                                </p>
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                <AnimatePresence>
                                    {visibleLogs.map((log, index) => {
                                        const isSelected = selectedId === log.id;
                                        const isCopied = copiedId === log.id;
                                        const supportsCopy = canCopyHistory(log);
                                        const shouldAnimate = index < ANIMATED_ITEMS;
                                        const textLineClamp = Math.max(2, Math.min(12, Math.floor(itemHeight / 16)));
                                        const isStagedEntry = ["file", "bundle"].includes(log.type) && stagedHashSet.has(log.hash);
                                        const inner = (
                                            <div style={{ display: "flex", gap: "10px", alignItems: "stretch", minHeight: `${itemHeight}px`, height: `${itemHeight}px` }}>
                                                {/* Left: Info column */}
                                                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "6px", width: "128px", minHeight: 0 }}>
                                                    <div style={{ minWidth: 0 }}>
                                                        <span style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                                                            {new Date(log.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: "11px", color: "var(--color-text-dim)", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {describeSource(log.source, t)}
                                                    </div>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                                                        {log.type === "image" ? <ImageIcon size={13} style={{ flexShrink: 0, opacity: 0.9 }} /> : log.type === "bundle" ? <FolderOpen size={13} style={{ flexShrink: 0, opacity: 0.9 }} /> : <FileType size={13} style={{ flexShrink: 0, opacity: 0.9 }} />}
                                                        <span style={{ minWidth: 0 }}>{(log.size / 1024).toFixed(0)} KB</span>
                                                    </div>
                                                    {isStagedEntry && (
                                                        <div>
                                                            <span style={{
                                                                display: "inline-flex",
                                                                alignItems: "center",
                                                                padding: "3px 8px",
                                                                borderRadius: "999px",
                                                                fontSize: "11px",
                                                                fontWeight: 700,
                                                                color: "#059669",
                                                                background: "rgba(16, 185, 129, 0.14)",
                                                                border: "1px solid rgba(16, 185, 129, 0.22)",
                                                            }}>
                                                                已暂存
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                        <button
                                                            onClick={(e) => handleTogglePin(log.id, e)}
                                                            title={log.pinned ? "取消固定" : "固定"}
                                                            style={{
                                                                border: "none", cursor: "pointer", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center",
                                                                padding: "4px 6px",
                                                                background: log.pinned ? "var(--color-primary-glow)" : "transparent",
                                                                color: log.pinned ? "var(--color-primary)" : "var(--color-text-muted)",
                                                                boxShadow: log.pinned ? "inset 0 0 0 1px rgba(94, 106, 210, 0.35)" : "none",
                                                                transition: "background 0.12s, color 0.12s, box-shadow 0.12s",
                                                            }}
                                                        >
                                                            <Pin size={15} style={{ flexShrink: 0 }} fill={log.pinned ? "currentColor" : "none"} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => supportsCopy && handleCopy(log, e)}
                                                            disabled={!supportsCopy}
                                                            style={{ background: "none", border: "none", cursor: supportsCopy ? "pointer" : "not-allowed", padding: "3px", borderRadius: "3px", display: "flex", color: supportsCopy ? (isCopied ? "#22c55e" : "var(--color-text-muted)") : "var(--color-text-dim)", opacity: supportsCopy ? 1 : 0.5 }}
                                                            title={supportsCopy ? t("sync.btn_copy") : "文件和文件夹条目暂不支持回写剪贴板"}
                                                        >
                                                            {isCopied ? <Check size={15} /> : <Copy size={15} />}
                                                        </button>
                                                        <button onClick={(e) => handleDelete(log.id, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", borderRadius: "3px", display: "flex", color: "var(--color-text-muted)" }} onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={e => (e.currentTarget.style.color = "var(--color-text-muted)")} title={t("sync.btn_delete")}>
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>
                                                </div>
                                                {/* Right: Content area */}
                                                <div style={{
                                                    flex: 1, minWidth: 0, minHeight: 0, height: "100%", alignSelf: "stretch", borderRadius: "6px",
                                                    overflow: "hidden",
                                                    background: log.type === "image" ? "var(--color-surface)" : "var(--color-surface)",
                                                    display: "flex", alignItems: "center",
                                                    justifyContent: log.type === "image" ? "flex-end" : "flex-start",
                                                }}>
                                                    {log.type === "image" ? (
                                                        log.preview ? (
                                                            <img
                                                                src={log.preview}
                                                                alt=""
                                                                style={{ height: "100%", maxHeight: "100%", width: "auto", maxWidth: "100%", objectFit: "contain", display: "block" }}
                                                            />
                                                        ) : (
                                                            <ImageIcon size={24} color="var(--color-text-muted)" style={{ opacity: 0.4 }} />
                                                        )
                                                    ) : log.type === "bundle" ? (
                                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: "0 2px", boxSizing: "border-box" }}>
                                                            <FolderOpen size={22} color="var(--color-primary)" style={{ flexShrink: 0, opacity: 0.9 }} />
                                                            <div style={{
                                                                fontSize: "12.5px", color: "var(--color-text-main)", lineHeight: "1.45",
                                                                display: "-webkit-box", WebkitLineClamp: textLineClamp, WebkitBoxOrient: "vertical",
                                                                overflow: "hidden", wordBreak: "break-word", minWidth: 0,
                                                            }}>
                                                                {log.preview || "文件夹条目"}
                                                            </div>
                                                        </div>
                                                    ) : log.type === "file" ? (
                                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: "0 2px", boxSizing: "border-box" }}>
                                                            <FileType size={22} color="var(--color-primary)" style={{ flexShrink: 0, opacity: 0.9 }} />
                                                            <div style={{
                                                                fontSize: "12.5px", color: "var(--color-text-main)", lineHeight: "1.45",
                                                                display: "-webkit-box", WebkitLineClamp: textLineClamp, WebkitBoxOrient: "vertical",
                                                                overflow: "hidden", wordBreak: "break-word", minWidth: 0,
                                                            }}>
                                                                {log.preview || "文件条目"}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div style={{
                                                            fontSize: "12.5px", color: "var(--color-text-main)",
                                                            lineHeight: "1.45",
                                                            display: "-webkit-box", WebkitLineClamp: textLineClamp,
                                                            WebkitBoxOrient: "vertical", overflow: "hidden",
                                                            fontFamily: '"Fira Code", monospace, Consolas',
                                                            wordBreak: "break-word",
                                                            width: "100%", maxHeight: "100%", alignSelf: "flex-start", padding: "0 2px", boxSizing: "border-box",
                                                        }}>
                                                            {log.preview || "..."}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );

                                        const isHover = hoveredListId === log.id;
                                        const cardStyle: React.CSSProperties = (() => {
                                            const baseShadow = isHover && !isSelected
                                                ? "0 3px 10px rgba(0,0,0,0.12), 0 6px 20px rgba(0,0,0,0.1)"
                                                : "0 2px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.1)";
                                            if (isSelected) {
                                                return {
                                                    padding: "10px 12px",
                                                    background: "rgba(94, 106, 210, 0.14)",
                                                    border: "1px solid rgba(94, 106, 210, 0.45)",
                                                    borderLeft: "3px solid var(--color-primary)",
                                                    borderRadius: "var(--radius-md)",
                                                    boxShadow: "0 2px 6px rgba(94,106,210,0.2), 0 6px 18px rgba(0,0,0,0.12)",
                                                    cursor: "pointer",
                                                    transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.12s",
                                                    position: "relative",
                                                };
                                            }
                                            const zebra = index % 2 === 1
                                                ? "var(--color-surface-elevated)"
                                                : "var(--color-surface)";
                                            return {
                                                padding: "10px 12px",
                                                background: zebra,
                                                border: isHover
                                                    ? "1px solid var(--color-border-focus)"
                                                    : "1px solid var(--color-border)",
                                                borderLeft: isHover
                                                    ? "3px solid var(--color-primary)"
                                                    : "3px solid var(--color-border)",
                                                borderRadius: "var(--radius-md)",
                                                boxShadow: baseShadow,
                                                cursor: "pointer",
                                                transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.12s",
                                                position: "relative",
                                            };
                                        })();

                                        const cardEvents = {
                                            onClick: () => setSelectedId(log.id),
                                            onMouseEnter: () => setHoveredListId(log.id),
                                            onMouseLeave: () => setHoveredListId((id) => (id === log.id ? null : id)),
                                        };

                                        return shouldAnimate ? (
                                            <motion.div
                                                key={log.id}
                                                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.96 }}
                                                transition={{ duration: 0.18 }}
                                                whileHover={!isSelected ? { y: -1 } : undefined}
                                                {...cardEvents}
                                                style={cardStyle}
                                            >
                                                {inner}
                                            </motion.div>
                                        ) : (
                                            <div key={log.id} {...cardEvents} style={cardStyle}>
                                                {inner}
                                            </div>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Preview Panel — fills remaining width */}
                <div className="glass-panel" style={{
                    borderRadius: "var(--radius-lg)", padding: "20px",
                    display: "flex", flexDirection: "column", overflow: "hidden",
                    flex: 1, minWidth: 0,
                }}>
                    {selectedLog ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                            {fileLikeSelected ? (
                                <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: "18px", paddingRight: "2px" }}>
                                    <div style={{ padding: "14px", borderRadius: "16px", border: "1px solid rgba(148, 163, 184, 0.34)", background: "linear-gradient(180deg, rgba(248, 250, 255, 0.96), rgba(255,255,255,0.92))", boxShadow: "0 10px 26px rgba(15, 23, 42, 0.04)", display: "flex", flexDirection: "column", gap: "10px" }}>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px" }}>
                                            {[
                                                ["类型", selectedFileTypeLabel],
                                                [t("sync.meta_time"), new Date(selectedLog.timestamp).toLocaleString()],
                                                [t("sync.meta_source", "来源"), describeSource(selectedLog.source, t)],
                                                ["可用状态", selectedAvailabilityStatus],
                                                ["传输状态", transferStateLoading && !transferState ? "读取中..." : describeTransferStatus(currentTransferStatus)],
                                            ].map(([label, value]) => (
                                                <div key={String(label)} style={{ padding: "8px 10px", borderRadius: "10px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                                                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{label}</div>
                                                    <div style={{ marginTop: "4px", fontSize: "12.5px", color: "var(--color-text-main)", fontWeight: 600, lineHeight: 1.55, wordBreak: "break-word" }}>{value}</div>
                                                </div>
                                            ))}
                                        </div>
                                        {transferState?.latest_transfer && (
                                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>
                                                最近一次传输：{describeTransferStatus(transferState.latest_transfer.status)}
                                                {transferState.latest_transfer.target_device_name ? ` · ${transferState.latest_transfer.target_device_name}` : ""}
                                                {transferState.latest_transfer.bytes_total > 0 ? ` · ${formatBytes(transferState.latest_transfer.bytes_done)} / ${formatBytes(transferState.latest_transfer.bytes_total)}` : ""}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", alignItems: "start" }}>
                                    <div style={{ padding: "14px", borderRadius: "18px", border: "1px solid rgba(34, 197, 94, 0.22)", background: "linear-gradient(180deg, rgba(240, 253, 244, 0.9), rgba(255,255,255,0.96))", boxShadow: "0 12px 28px rgba(34, 197, 94, 0.07)", display: "flex", flexDirection: "column", gap: "12px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>NAS 暂存</div>
                                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                                {transferState?.has_local_content ? (
                                                    <button className="btn-ghost" onClick={handleUploadToNas} disabled={stagingEntry} style={{ padding: "6px 12px", fontSize: "12px", opacity: stagingEntry ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                        <Upload size={14} /> {stagingEntry ? "上传中..." : "上传到 NAS"}
                                                    </button>
                                                ) : (
                                                    <button className="btn-primary" onClick={handleDownloadEntry} disabled={downloadingEntry || currentTransferActive} style={{ padding: "6px 12px", fontSize: "12px", opacity: downloadingEntry ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                        <Download size={14} /> {downloadingEntry ? "请求下载中..." : "下载到本机"}
                                                    </button>
                                                )}
                                                <button className="btn-ghost" onClick={() => void Promise.all([loadStagingPreferences(), loadMyStagedObjects(), loadMyShareLinks(), loadStagingPolicy()])} style={{ padding: "6px 12px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                    刷新 NAS 暂存
                                                </button>
                                                {selectedStageObject && (
                                                    <button className="btn-ghost" onClick={() => handleDeleteStageObject(selectedStageObject.id)} disabled={deletingStageId !== null} style={{ padding: "6px 12px", fontSize: "12px", color: "#ef4444", borderColor: "rgba(239,68,68,0.24)", opacity: deletingStageId && deletingStageId !== selectedStageObject.id ? 0.6 : 1 }}>
                                                        {deletingStageId === selectedStageObject.id ? "删除中..." : "删除暂存对象"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div style={{ padding: "11px 12px", borderRadius: "12px", border: stageStatusTone === "error" ? "1px solid rgba(239, 68, 68, 0.22)" : stageStatusTone === "success" ? "1px solid rgba(34, 197, 94, 0.28)" : stageStatusTone === "info" ? "1px solid rgba(59, 130, 246, 0.2)" : "1px solid rgba(34, 197, 94, 0.18)", background: stageStatusTone === "error" ? "rgba(239, 68, 68, 0.08)" : stageStatusTone === "success" ? "rgba(34, 197, 94, 0.12)" : stageStatusTone === "info" ? "rgba(59, 130, 246, 0.07)" : "rgba(255,255,255,0.78)", color: stageStatusTone === "error" ? "#b91c1c" : stageStatusTone === "success" ? "#15803d" : "var(--color-text-main)", fontSize: "12px", lineHeight: 1.7 }}>
                                            {stageStatusText}
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px" }}>
                                            {[
                                                ["暂存状态", selectedStageObject ? describeTransferStatus(selectedStageObject.status) : transferState?.stage_object_id ? "已关联对象" : "未暂存"],
                                                ["服务器默认保留时长", stagingPrefs ? describeDuration(stagingPrefs.default_ttl_seconds) : "读取中..."],
                                            ].map(([label, value]) => (
                                                <div key={String(label)} style={{ padding: "8px 10px", borderRadius: "12px", background: "rgba(255,255,255,0.86)", border: "1px solid rgba(34, 197, 94, 0.16)" }}>
                                                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{label}</div>
                                                    <div style={{ marginTop: "4px", fontSize: "12.5px", color: "var(--color-text-main)", fontWeight: 600, lineHeight: 1.55, wordBreak: "break-word" }}>{value}</div>
                                                </div>
                                            ))}
                                            {selectedStageObject && (
                                                <>
                                                    <div style={{ padding: "8px 10px", borderRadius: "12px", background: "rgba(255,255,255,0.86)", border: "1px solid rgba(34, 197, 94, 0.16)" }}>
                                                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>保留到</div>
                                                        <div style={{ marginTop: "4px", fontSize: "12.5px", color: "var(--color-text-main)", fontWeight: 600 }}>{new Date(selectedStageObject.expires_at).toLocaleString()}</div>
                                                    </div>
                                                    <div style={{ gridColumn: "1 / -1", padding: "8px 10px", borderRadius: "12px", background: "rgba(255,255,255,0.86)", border: "1px solid rgba(34, 197, 94, 0.16)" }}>
                                                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>对象 ID</div>
                                                        <div style={{ marginTop: "4px", fontSize: "12.5px", color: "var(--color-text-main)", fontWeight: 600, wordBreak: "break-all" }}>{selectedStageObject.id}</div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                            <label style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>当前文件保留时长</label>
                                            <ChoiceButtonGroup
                                                value={stageCurrentTtlInput}
                                                onChange={setStageCurrentTtlInput}
                                                options={DURATION_OPTIONS}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ padding: "14px", borderRadius: "18px", border: "1px solid rgba(94, 106, 210, 0.28)", background: "linear-gradient(180deg, rgba(238, 242, 255, 0.96), rgba(255,255,255,0.96))", boxShadow: "0 14px 32px rgba(94, 106, 210, 0.08)", display: "flex", flexDirection: "column", gap: "12px" }}>
                                        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                                            <div style={{ padding: "12px 14px", borderRadius: "14px", background: "rgba(255,255,255,0.96)", border: "1px solid rgba(148, 163, 184, 0.42)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)", display: "flex", flexDirection: "column", gap: "10px" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--color-text-main)", fontSize: "12.5px", fontWeight: 700 }}><Send size={14} />传给本账户其它设备</div>
                                                <span style={{ display: "inline-flex", alignItems: "center", width: "fit-content", padding: "4px 10px", borderRadius: "999px", background: "var(--color-surface-elevated)", fontSize: "11.5px", color: "var(--color-text-muted)" }}>在线设备 {shareableDeviceCount} 台</span>
                                                {transferState?.has_local_content && syncEnabled ? (
                                                    <div style={{ position: "relative" }} ref={pushMenuRef}>
                                                        <button className="btn-ghost" onClick={handleTogglePushMenu} style={{ padding: "7px 14px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                            <Send size={14} /> 推送到设备 <ChevronDown size={12} />
                                                        </button>
                                                        {showPushMenu && (
                                                            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "6px", background: "var(--color-surface-elevated)", border: "1px solid var(--color-glass-border)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-glass)", zIndex: 100, minWidth: "220px", overflow: "hidden" }}>
                                                                {pushDevicesLoading ? (
                                                                    <div style={{ padding: "10px 14px", fontSize: "12px", color: "var(--color-text-muted)" }}>正在加载在线设备...</div>
                                                                ) : pushDevices.length === 0 ? (
                                                                    <div style={{ padding: "10px 14px", fontSize: "12px", color: "var(--color-text-muted)" }}>当前没有可推送的在线设备</div>
                                                                ) : pushDevices.map((device) => (
                                                                    <button key={device.id} onClick={() => handlePushToDevice(device)} disabled={pushingDeviceId !== null} style={{ display: "flex", width: "100%", textAlign: "left", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "9px 14px", background: "none", border: "none", color: "var(--color-text-main)", fontSize: "12px", cursor: pushingDeviceId ? "default" : "pointer", opacity: pushingDeviceId && pushingDeviceId !== device.id ? 0.6 : 1 }}>
                                                                        <span>{device.name}</span>
                                                                        <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>{pushingDeviceId === device.id ? "推送中..." : "在线"}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                                        {syncEnabled ? "当前条目还没有本地副本，先在上方下载到本机后再推送。" : "同步功能当前未启用，暂时不能推送到设备。"}
                                                    </div>
                                                )}
                                            </div>

                                            <div style={{ padding: "12px 14px", borderRadius: "14px", background: "rgba(255,255,255,0.98)", border: "1px solid rgba(94, 106, 210, 0.34)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)", display: "flex", flexDirection: "column", gap: "10px" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--color-text-main)", fontSize: "12.5px", fontWeight: 700 }}><Link2 size={14} />传给所有用户</div>
                                                <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                                                    <label style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>链接有效期</label>
                                                    <ChoiceButtonGroup
                                                        value={shareLinkTtlInput}
                                                        onChange={setShareLinkTtlInput}
                                                        options={DURATION_OPTIONS}
                                                    />
                                                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                                                        <label style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>允许下载次数</label>
                                                        <select value={shareLinkLimitInput} onChange={(e) => setShareLinkLimitInput(e.target.value)} style={{ minWidth: "140px", padding: "7px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--color-surface-elevated)", color: "var(--color-text-main)" }}>
                                                            {DOWNLOAD_LIMIT_OPTIONS.map((option) => (
                                                                <option key={option.value} value={option.value}>{option.label}</option>
                                                            ))}
                                                        </select>
                                                        {selectedStageObject && (
                                                            <button className="btn-primary" onClick={() => handleCreateShareLink(selectedStageObject.id)} disabled={creatingShareForStageId !== null || shareLinksDisabledByPolicy} style={{ padding: "7px 14px", fontSize: "12px", opacity: shareLinksDisabledByPolicy ? 0.5 : creatingShareForStageId && creatingShareForStageId !== selectedStageObject.id ? 0.6 : 1 }}>
                                                                {creatingShareForStageId === selectedStageObject.id ? "生成中..." : "生成分享链接"}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                {shareLinksDisabledByPolicy && (
                                                    <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center", padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(239, 68, 68, 0.18)", background: "rgba(239, 68, 68, 0.06)", color: "#b91c1c", fontSize: "12px", lineHeight: 1.6 }}>
                                                        <span>当前服务器已关闭外部分享链接，开启后才能生成分享链接。</span>
                                                        <button className="btn-primary" onClick={handleEnableExternalLinks} disabled={savingSharePolicy || stagingPolicyLoading} style={{ padding: "6px 12px", fontSize: "12px", opacity: savingSharePolicy ? 0.7 : 1 }}>
                                                            {savingSharePolicy ? "开启中..." : "开启外链分享"}
                                                        </button>
                                                    </div>
                                                )}
                                                {!selectedStageObject ? (
                                                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>先在“暂存相关”里上传到 NAS，当前对象准备好后才能生成公开分享链接。</div>
                                                ) : selectedStageShareLinks.length === 0 ? (
                                                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>当前暂存对象还没有分享链接。确认有效期和下载次数后，点击“生成分享链接”即可。</div>
                                                ) : (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                                        {selectedStageShareLinks.map((link) => (
                                                            <div key={link.id} style={{ padding: "10px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--color-surface-elevated)", display: "flex", flexDirection: "column", gap: "8px" }}>
                                                                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                                                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                                        <div style={{ fontSize: "12px", fontWeight: 700, color: link.status === "active" ? "var(--color-primary)" : "var(--color-text-main)" }}>分享链接 #{link.id}</div>
                                                                        <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 8px", borderRadius: "999px", background: link.status === "active" ? "rgba(94, 106, 210, 0.12)" : "var(--color-surface)", color: link.status === "active" ? "var(--color-primary)" : "var(--color-text-muted)", fontSize: "11px", fontWeight: 700 }}>{link.status === "active" ? "可下载" : describeTransferStatus(link.status)}</span>
                                                                    </div>
                                                                    <div style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>已下载 {link.download_count}{link.max_downloads > 0 ? ` / ${link.max_downloads}` : ""} · 到期 {new Date(link.expires_at).toLocaleString()}</div>
                                                                </div>
                                                                <div style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: "11.5px", color: "var(--color-text-main)", fontFamily: '"Fira Code", monospace, Consolas', wordBreak: "break-all" }}>{link.share_url}</div>
                                                                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                                                                    <button className="btn-ghost" onClick={() => handleCopyShareLink(link)} style={{ padding: "5px 10px", fontSize: "11.5px", display: "inline-flex", alignItems: "center", gap: "6px" }}><Copy size={13} />{copiedShareLinkId === link.id ? "已复制" : "复制链接"}</button>
                                                                    <button className="btn-ghost" onClick={() => handleOpenShareLink(link)} style={{ padding: "5px 10px", fontSize: "11.5px", display: "inline-flex", alignItems: "center", gap: "6px" }}><ArrowUpRight size={13} />打开链接</button>
                                                                    <button className="btn-ghost" onClick={() => handleDisableShareLink(link.id)} disabled={disablingShareLinkId !== null} style={{ padding: "5px 10px", fontSize: "11.5px", color: "#ef4444", borderColor: "rgba(239,68,68,0.24)", opacity: disablingShareLinkId && disablingShareLinkId !== link.id ? 0.6 : 1 }}>
                                                                        {disablingShareLinkId === link.id ? "关闭外链中..." : "关闭外链"}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <div style={{ padding: "12px 14px", borderRadius: "12px", background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.28)", color: "#b45309", fontSize: "12px", lineHeight: 1.7 }}>
                                                    任何拿到链接的人都可以直接下载该对象。不要把分享链接用于敏感文件，也不要把长期有效链接发到不可控渠道。
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                                    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                                        {previewLoading ? (
                                            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)", fontSize: "13px" }}>
                                                Loading...
                                            </div>
                                        ) : selectedLog.type === "image" && previewContent ? (
                                            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: "8px" }}>
                                                <img src={previewContent} alt="Preview" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "var(--radius-md)" }} />
                                            </div>
                                        ) : previewContent ? (
                                            <div style={{ flex: 1, overflow: "auto", background: "var(--color-surface)", padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", userSelect: "text", WebkitUserSelect: "text" }}>
                                                <pre style={{ color: "var(--color-text-main)", fontFamily: '"Fira Code", monospace, Consolas', fontSize: "13px", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, lineHeight: "1.5" }}>
                                                    {previewContent}
                                                </pre>
                                            </div>
                                        ) : null}
                                    </div>
                                    <div style={{ marginTop: "14px", padding: "10px 14px", background: "var(--color-surface-elevated)", borderRadius: "var(--radius-sm)", display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                                        <span>{t("sync.meta_time")}：{new Date(selectedLog.timestamp).toLocaleString()}</span>
                                        <span>{t("sync.meta_source", "来源")}：{describeSource(selectedLog.source, t)}</span>
                                        <span>{(selectedLog.size / 1024).toFixed(1)} KB</span>
                                    </div>
                                    <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        <button className="btn-primary" onClick={() => canCopyHistory(selectedLog) && handleCopy(selectedLog)} disabled={!canCopyHistory(selectedLog)} style={{ padding: "7px 16px", fontSize: "12.5px", gap: "6px", background: copyFailed ? "#ef4444" : undefined, opacity: canCopyHistory(selectedLog) ? 1 : 0.55, cursor: canCopyHistory(selectedLog) ? "pointer" : "not-allowed" }}>
                                            {copyFailed ? <X size={14} /> : (copiedPreview ? <Check size={14} /> : <Copy size={14} />)}
                                            {canCopyHistory(selectedLog) ? (copyFailed ? t("sync.copy_failed") : (copiedPreview ? t("sync.copy_success") : t("sync.btn_copy"))) : "暂不支持回写剪贴板"}
                                        </button>
                                        <button className="btn-ghost" onClick={(e) => handleTogglePin(selectedLog.id, e)} style={{ padding: "7px 16px", fontSize: "12.5px", gap: "6px", display: "flex", alignItems: "center" }}>
                                            {selectedLog.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                                            {selectedLog.pinned ? "Unpin" : "Pin"}
                                        </button>
                                        <button className="btn-ghost" onClick={() => handleDelete(selectedLog.id)} style={{ padding: "7px 16px", fontSize: "12.5px", gap: "6px", color: "#ef4444", display: "flex", alignItems: "center" }}>
                                            <Trash2 size={14} /> {t("sync.btn_delete")}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{
                            flex: 1, display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            color: "var(--color-text-muted)",
                        }}>
                            <ClipboardCopy size={44} style={{ opacity: 0.12, marginBottom: "14px" }} />
                            <p style={{ fontSize: "14px" }}>{t("sync.preview_empty")}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Toolbar */}
            <div style={{
                marginTop: "auto", padding: "6px 12px", flexShrink: 0,
                background: "var(--color-surface-elevated)", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-glass-border)",
                display: "flex", alignItems: "center", gap: "16px",
                fontSize: "12px", color: "var(--color-text-muted)",
            }}>
                <div style={{ position: "relative" }} ref={createMenuRef}>
                    <button
                        className="btn-ghost"
                        onClick={() => { setShowCreateMenu(!showCreateMenu); setShowClearMenu(false); }}
                        style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", color: showCreateMenu ? "var(--color-primary)" : undefined }}
                    >
                        <Plus size={13} /> 新建条目 <ChevronDown size={12} />
                    </button>
                    {showCreateMenu && (
                        <div style={{
                            position: "absolute", bottom: "100%", left: 0, marginBottom: "4px",
                            background: "var(--color-surface-elevated)", border: "1px solid var(--color-glass-border)",
                            borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-glass)", zIndex: 100,
                            minWidth: "180px", overflow: "hidden",
                        }}>
                            <button
                                onClick={() => handleCreateEntry("file")}
                                disabled={creatingEntry !== null}
                                style={{
                                    display: "flex", width: "100%", textAlign: "left", alignItems: "center", gap: "8px",
                                    padding: "8px 14px", background: "none", border: "none",
                                    color: "var(--color-text-main)", fontSize: "12px", cursor: creatingEntry ? "default" : "pointer",
                                    opacity: creatingEntry ? 0.6 : 1,
                                }}
                            >
                                <FileType size={13} /> {creatingEntry === "file" ? "选择中..." : "文件"}
                            </button>
                            <button
                                onClick={() => handleCreateEntry("bundle")}
                                disabled={creatingEntry !== null}
                                style={{
                                    display: "flex", width: "100%", textAlign: "left", alignItems: "center", gap: "8px",
                                    padding: "8px 14px", background: "none", border: "none",
                                    color: "var(--color-text-main)", fontSize: "12px", cursor: creatingEntry ? "default" : "pointer",
                                    opacity: creatingEntry ? 0.6 : 1,
                                }}
                            >
                                <FolderOpen size={13} /> {creatingEntry === "bundle" ? "选择中..." : "文件夹"}
                            </button>
                        </div>
                    )}
                </div>

                <div style={{ position: "relative" }} ref={appearanceRef}>
                    <button
                        className="btn-ghost"
                        onClick={() => setShowAppearancePanel(!showAppearancePanel)}
                        style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", color: showAppearancePanel ? "var(--color-primary)" : undefined }}
                    >
                        <Settings2 size={13} /> 外观
                    </button>
                    {showAppearancePanel && (
                        <div style={{
                            position: "absolute", bottom: "100%", left: 0, marginBottom: "4px",
                            background: "var(--color-bg-base)", border: "1px solid var(--color-glass-border)",
                            borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-glass)", zIndex: 100,
                            padding: "14px 16px", minWidth: "260px",
                        }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-main)", marginBottom: "10px" }}>
                                活动流设置
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)", whiteSpace: "nowrap", width: "70px" }}>条目高度</span>
                                    <input type="range" min={48} max={200} value={itemHeight} onChange={e => {
                                        const v = Math.max(48, Math.min(200, Number(e.target.value)));
                                        setItemHeight(v);
                                        localStorage.setItem('yiboflow_item_height', String(v));
                                    }} style={{ flex: 1, accentColor: "var(--color-primary)" }} />
                                    <span style={{ fontSize: "11px", color: "var(--color-text-main)", fontWeight: 600, minWidth: "36px", textAlign: "right" }}>{itemHeight}px</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)", whiteSpace: "nowrap", width: "70px" }}>条目宽度</span>
                                    <input
                                        type="range"
                                        min={25}
                                        max={55}
                                        value={Math.round(listWidthRatio * 100)}
                                        onChange={e => {
                                            const p = Math.max(25, Math.min(55, Number(e.target.value))) / 100;
                                            setListWidthRatio(p);
                                            localStorage.setItem('yiboflow_list_width_ratio', String(p));
                                        }}
                                        style={{ flex: 1, accentColor: "var(--color-primary)" }}
                                    />
                                    <span style={{ fontSize: "11px", color: "var(--color-text-main)", fontWeight: 600, minWidth: "44px", textAlign: "right" }}>
                                        {Math.round(listWidthRatio * 100)}% · {layout.listW}px
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <ToolbarDivider />
                <span>{t("sync.record_count", { count: totalCount })}</span>

                <ToolbarDivider />
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <span style={{ whiteSpace: "nowrap" }}>服务器默认保留时长</span>
                    <div style={{ minWidth: "180px", pointerEvents: savingStagePrefs ? "none" : "auto", opacity: savingStagePrefs ? 0.7 : 1 }}>
                        <CustomSelect
                            value={stageDefaultTtlInput}
                            onChange={(value) => {
                                void handleSaveStageDefaultTtl(String(value));
                            }}
                            options={SERVER_DEFAULT_DURATION_OPTIONS.map(option => ({ val: option.value, label: option.label }))}
                            triggerStyle={{ padding: "8px 12px", fontSize: "12px", minHeight: "36px" }}
                        />
                    </div>
                    {savingStagePrefs ? <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>保存中...</span> : null}
                </div>

                <ToolbarDivider />
                <button
                    className="btn-ghost"
                    onClick={handlePull}
                    disabled={pulling}
                    style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", opacity: pulling ? 0.5 : 1 }}
                >
                    <Download size={13} /> {pulling ? "拉取中..." : "拉取最近5条"}
                </button>

                <ToolbarDivider />
                <div style={{ position: "relative" }} ref={clearMenuRef}>
                    <button
                        className="btn-ghost"
                        onClick={() => { setShowClearMenu(!showClearMenu); setConfirmClear(false); }}
                        style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
                    >
                        <Trash2 size={13} /> {t("sync.clear_button")} <ChevronDown size={12} />
                    </button>
                    {showClearMenu && (
                        <div style={{
                            position: "absolute", bottom: "100%", left: 0, marginBottom: "4px",
                            background: "var(--color-surface-elevated)", border: "1px solid var(--color-glass-border)",
                            borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-glass)", zIndex: 100,
                            minWidth: "180px", overflow: "hidden",
                        }}>
                            {[3, 7, 30].map(d => (
                                <button key={d} onClick={() => handleClearDays(d)} style={{
                                    display: "block", width: "100%", textAlign: "left",
                                    padding: "8px 14px", background: "none", border: "none",
                                    color: "var(--color-text-main)", fontSize: "12px", cursor: "pointer",
                                }} onMouseEnter={e => e.currentTarget.style.background = "var(--color-surface)"}
                                   onMouseLeave={e => e.currentTarget.style.background = "none"}>
                                    {t(`sync.clear_${d}d`)}
                                </button>
                            ))}
                            <div style={{ borderTop: "1px solid var(--color-glass-border)" }} />
                            <button onClick={handleClearAll} style={{
                                display: "block", width: "100%", textAlign: "left",
                                padding: "8px 14px", background: confirmClear ? "rgba(239,68,68,0.1)" : "none",
                                border: "none", color: confirmClear ? "#ef4444" : "#ef4444",
                                fontSize: "12px", cursor: "pointer", fontWeight: 600,
                            }}>
                                {confirmClear ? "⚠ 确认？" : t("sync.clear_all")}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
