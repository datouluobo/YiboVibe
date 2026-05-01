import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    LayoutDashboard,
    Monitor,
    RefreshCw,
    Server,
    ShieldAlert,
    ShieldCheck,
    UserCircle2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { resolveSyncError } from "../utils/errorDisplay";

type Tone = "ok" | "warn" | "error" | "neutral";

interface SyncStatusView {
    code: string;
    summary: string;
    detail: string;
    tone: Tone;
}

interface FeatureItem {
    id: string;
    label: string;
    description: string;
    status: "ENABLED" | "DISABLED" | "NOT_CONFIGURED";
    meta: string;
}

interface DeviceItem {
    id?: string;
    name?: string;
    deviceType?: string;
    isOnline?: boolean;
    isLocal?: boolean;
    lastSeenAt?: string | number | null;
}

const TONE_STYLES: Record<Tone, { color: string; bg: string; border: string }> = {
    ok: {
        color: "#22c55e",
        bg: "rgba(34,197,94,0.12)",
        border: "rgba(34,197,94,0.28)",
    },
    warn: {
        color: "#f59e0b",
        bg: "rgba(245,158,11,0.12)",
        border: "rgba(245,158,11,0.28)",
    },
    error: {
        color: "#ef4444",
        bg: "rgba(239,68,68,0.12)",
        border: "rgba(239,68,68,0.28)",
    },
    neutral: {
        color: "var(--color-text-muted)",
        bg: "var(--color-surface-elevated)",
        border: "var(--color-border)",
    },
};

function toneIcon(tone: Tone) {
    if (tone === "ok") return <CheckCircle2 size={15} />;
    if (tone === "warn") return <AlertTriangle size={15} />;
    if (tone === "error") return <ShieldAlert size={15} />;
    return <Clock3 size={15} />;
}

function statusTone(status: FeatureItem["status"]): Tone {
    if (status === "ENABLED") return "ok";
    if (status === "DISABLED") return "warn";
    return "neutral";
}

function formatTimestamp(value?: string | number | null) {
    if (!value) return null;
    const date =
        typeof value === "number"
            ? new Date(value * 1000)
            : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
}

const INFO_TILE_STYLE: CSSProperties = {
    padding: "12px 14px",
    borderRadius: "12px",
    background: "var(--color-surface-elevated)",
    border: "1px solid var(--color-border)",
};

const MAXIMIZED_BOTTOM_EXTENSION = 10;

const appWindow = (() => {
    try {
        return getCurrentWindow();
    } catch {
        return null;
    }
})();

function SummaryCard({
    icon,
    label,
    value,
    note,
    tone = "neutral",
}: {
    icon: ReactNode;
    label: string;
    value: ReactNode;
    note: string;
    tone?: Tone;
}) {
    const style = TONE_STYLES[tone];

    return (
        <div
            className="glass-panel"
            style={{
                padding: "16px 18px",
                borderRadius: "var(--radius-lg)",
                border: `1px solid ${style.border}`,
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                minHeight: "104px",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: style.color }}>
                {icon}
                <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em" }}>{label}</span>
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-main)" }}>{value}</div>
            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.45 }}>{note}</div>
        </div>
    );
}

function SectionCard({
    title,
    children,
    action,
    style,
}: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
    style?: CSSProperties;
}) {
    return (
        <div
            className="glass-panel"
            style={{
                padding: "20px",
                borderRadius: "var(--radius-lg)",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                ...style,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>{title}</h2>
                {action}
            </div>
            {children}
        </div>
    );
}

export default function FlowDeck() {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const summaryRef = useRef<HTMLDivElement | null>(null);
    const [viewport, setViewport] = useState(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }));
    const [isMaximized, setIsMaximized] = useState(false);
    const [overviewCardHeight, setOverviewCardHeight] = useState<number | null>(null);
    const [vaultStatus, setVaultStatus] = useState<any>(null);
    const [devices, setDevices] = useState<DeviceItem[]>([]);
    const [isSyncLoading, setIsSyncLoading] = useState(true);
    const [isDevicesLoading, setIsDevicesLoading] = useState(true);
    const [checkedAt, setCheckedAt] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const [featureRules, setFeatureRules] = useState<any>(null);
    const [dictionaryCount, setDictionaryCount] = useState(0);

    const serverUrl = localStorage.getItem("yiboflow_server_url") || "";
    const username = localStorage.getItem("yiboflow_username") || "";
    const savedPwdB64 = localStorage.getItem("yiboflow_saved_pwd") || "";
    const currentDeviceName = localStorage.getItem("yiboflow_device_name") || t("flowdeck.unknown_device");
    const connectedAt = localStorage.getItem("yiboflow_connected_at");
    const userRole = localStorage.getItem("yiboflow_user_role") || "user";
    const isRemote = !!serverUrl && serverUrl !== "local";
    const rememberPassword = !!savedPwdB64;

    useEffect(() => {
        const handleResize = () => {
            setViewport({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };

        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    useEffect(() => {
        if (!appWindow) return;

        appWindow.isMaximized().then(setIsMaximized).catch(() => {});
        const unlisten = appWindow.onResized(() => {
            appWindow.isMaximized().then(setIsMaximized).catch(() => {});
        });

        return () => {
            unlisten.then((cleanup) => cleanup()).catch(() => {});
        };
    }, []);

    useEffect(() => {
        const loadRemoteStatus = async () => {
            setIsSyncLoading(true);
            setIsDevicesLoading(true);
            setVaultStatus(null);
            setDevices([]);
            setCheckedAt(null);

            if (!isRemote) {
                setIsSyncLoading(false);
                setIsDevicesLoading(false);
                return;
            }

            if (!username || !savedPwdB64) {
                setVaultStatus({ error: "MASTER_PWD_UNSAVED" });
                setIsSyncLoading(false);
                setIsDevicesLoading(false);
                setCheckedAt(new Date().toISOString());
                return;
            }

            try {
                const password = atob(savedPwdB64);
                const info: any = await invoke("get_vault_sync_status", { serverUrl, username, password });
                setVaultStatus(info);
                setCheckedAt(new Date().toISOString());
            } catch (error) {
                setVaultStatus({ error: String(error) });
                setCheckedAt(new Date().toISOString());
            } finally {
                setIsSyncLoading(false);
            }

            try {
                const password = atob(savedPwdB64);
                const list: any = await invoke("get_cluster_devices", { serverUrl, username, password });
                setDevices(Array.isArray(list) ? list : []);
            } catch (error) {
                console.error("Failed to load cluster devices:", error);
            } finally {
                setIsDevicesLoading(false);
            }
        };

        loadRemoteStatus();
    }, [isRemote, retryCount, savedPwdB64, serverUrl, username]);

    useEffect(() => {
        const loadFeatureState = async () => {
            try {
                const rules: any = await invoke("get_flow_rules");
                setFeatureRules(rules);
            } catch (error) {
                console.error("Failed to load feature rules:", error);
            }

            try {
                const dictionaries: any = await invoke("get_all_dictionaries");
                setDictionaryCount(Array.isArray(dictionaries) ? dictionaries.length : 0);
            } catch (error) {
                console.error("Failed to load dictionaries:", error);
            }
        };

        loadFeatureState();
    }, []);

    const keyProfiles = useMemo(() => {
        try {
            const raw = localStorage.getItem("yiboflow_key_profiles");
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }, []);

    const keyMappingSummary = useMemo(() => {
        const activeProfiles = keyProfiles.filter((profile: any) => profile?.active);
        const mappings = activeProfiles.flatMap((profile: any) =>
            Array.isArray(profile?.mappings) ? profile.mappings : [],
        );
        const enabledMappings = mappings.filter((mapping: any) => mapping?.enabled).length;
        return {
            activeProfiles: activeProfiles.length,
            enabledMappings,
        };
    }, [keyProfiles]);

    const sortedDevices = useMemo(() => {
        return [...devices].sort((left, right) => {
            if (!!left.isLocal !== !!right.isLocal) return left.isLocal ? -1 : 1;
            if (!!left.isOnline !== !!right.isOnline) return left.isOnline ? -1 : 1;
            return (left.name || "").localeCompare(right.name || "");
        });
    }, [devices]);

    const onlineDeviceCount = devices.filter((device) => device.isOnline).length;
    const otherOnlineDeviceCount = devices.filter((device) => !device.isLocal && device.isOnline).length;

    const syncStatus = useMemo<SyncStatusView>(() => {
        if (!isRemote) {
            return {
                code: "SYNC_LOCAL_MODE",
                summary: t("flowdeck.summary_local_mode"),
                detail: t("flowdeck.detail_local_mode"),
                tone: "warn",
            };
        }

        if (!serverUrl || !username) {
            return {
                code: "SERVER_UNCONFIGURED",
                summary: t("flowdeck.summary_server_unconfigured"),
                detail: t("flowdeck.detail_server_unconfigured"),
                tone: "warn",
            };
        }

        if (isSyncLoading) {
            return {
                code: "SYNC_UNKNOWN",
                summary: t("flowdeck.summary_checking"),
                detail: t("flowdeck.detail_checking"),
                tone: "neutral",
            };
        }

        if (!rememberPassword || vaultStatus?.error === "MASTER_PWD_UNSAVED") {
            return {
                code: "SYNC_AUTH_REQUIRED",
                summary: t("flowdeck.summary_auth_required"),
                detail: t("flowdeck.detail_auth_required"),
                tone: "warn",
            };
        }

        if (vaultStatus?.error) {
            const resolved = resolveSyncError(String(vaultStatus.error), t);
            return {
                code: resolved.code,
                summary: resolved.code === "SYNC_SERVER_UNREACHABLE"
                    ? t("flowdeck.summary_server_unreachable")
                    : resolved.code === "SYNC_AUTH_INVALID_CREDENTIALS"
                        ? t("flowdeck.summary_auth_invalid_credentials")
                    : t("flowdeck.summary_api_error"),
                detail: resolved.detail,
                tone: resolved.tone,
            };
        }

        return {
            code: "SYNC_OK",
            summary: t("flowdeck.summary_sync_ok"),
            detail: t("flowdeck.detail_sync_ok", {
                blocks: vaultStatus?.remote_manifest_size ?? 0,
                updatedAt: formatTimestamp(vaultStatus?.remote_updated_at) || t("flowdeck.none"),
            }),
            tone: "ok",
        };
    }, [isRemote, isSyncLoading, rememberPassword, serverUrl, t, username, vaultStatus]);

    const featureItems = useMemo<FeatureItem[]>(() => {
        const rules = featureRules?.default || {};
        const flowsnapOn = typeof rules.flowsnap === "boolean" ? rules.flowsnap : null;
        const flowhintOn = typeof rules.flowhint === "boolean" ? rules.flowhint : null;
        const flowkeysOn = typeof rules.flowkeys === "boolean" ? rules.flowkeys : null;
        const flowsyncOn = typeof rules.flowsync === "boolean" ? rules.flowsync : null;

        return [
            {
                id: "flowsnap",
                label: "FlowSnap",
                description: t("flowdeck.feature_flowsnap_desc"),
                status: flowsnapOn === null ? "NOT_CONFIGURED" : flowsnapOn ? "ENABLED" : "DISABLED",
                meta: flowsnapOn === null
                    ? t("flowdeck.meta_not_loaded")
                    : flowsnapOn
                        ? t("flowdeck.meta_rule_enabled")
                        : t("flowdeck.meta_rule_disabled"),
            },
            {
                id: "flowhint",
                label: "FlowHint",
                description: t("flowdeck.feature_flowhint_desc"),
                status: flowhintOn === null ? "NOT_CONFIGURED" : flowhintOn ? "ENABLED" : "DISABLED",
                meta: dictionaryCount > 0
                    ? t("flowdeck.meta_dictionary_count", { count: dictionaryCount })
                    : t("flowdeck.meta_no_dictionary"),
            },
            {
                id: "flowkeys",
                label: "FlowKeys",
                description: t("flowdeck.feature_flowkeys_desc"),
                status: flowkeysOn === null ? "NOT_CONFIGURED" : flowkeysOn ? "ENABLED" : "DISABLED",
                meta: keyMappingSummary.enabledMappings > 0
                    ? t("flowdeck.meta_key_mapping_count", { count: keyMappingSummary.enabledMappings })
                    : t("flowdeck.meta_no_key_mapping"),
            },
            {
                id: "flowsync",
                label: "FlowSync",
                description: t("flowdeck.feature_flowsync_desc"),
                status: flowsyncOn === null ? "NOT_CONFIGURED" : flowsyncOn ? "ENABLED" : "DISABLED",
                meta: isRemote
                    ? t("flowdeck.meta_remote_mode")
                    : t("flowdeck.meta_local_mode"),
            },
            {
                id: "flowdrop",
                label: "FlowDrop",
                description: t("flowdeck.feature_flowdrop_desc"),
                status: !isRemote ? "NOT_CONFIGURED" : otherOnlineDeviceCount > 0 ? "ENABLED" : "DISABLED",
                meta: !isRemote
                    ? t("flowdeck.meta_remote_required")
                    : otherOnlineDeviceCount > 0
                        ? t("flowdeck.meta_online_targets", { count: otherOnlineDeviceCount })
                        : t("flowdeck.meta_no_online_targets"),
            },
        ];
    }, [dictionaryCount, featureRules, isRemote, keyMappingSummary.enabledMappings, otherOnlineDeviceCount, t]);

    const serverSummaryTone: Tone = !isRemote
        ? "neutral"
        : syncStatus.tone === "ok"
            ? "ok"
            : syncStatus.code === "SYNC_AUTH_REQUIRED"
                ? "warn"
                : syncStatus.tone;

    const isWideLayout = viewport.width >= 1800;
    const isMediumLayout = viewport.width >= 1320;
    const summaryColumns = isWideLayout ? 4 : isMediumLayout ? 2 : 1;
    const overviewColumns = isWideLayout ? 3 : isMediumLayout ? 2 : 1;
    const shouldUseEqualHeightCards = isMaximized && overviewColumns > 1;
    const deviceMetricColumns = viewport.width >= 1520 ? 4 : viewport.width >= 960 ? 2 : 1;
    const infoPairColumns = viewport.width >= 900 ? 2 : 1;
    const featureColumns = isWideLayout ? 1 : viewport.width >= 900 ? 2 : 1;

    useEffect(() => {
        if (!shouldUseEqualHeightCards) {
            setOverviewCardHeight(null);
            return;
        }

        const recalcOverviewHeight = () => {
            const root = rootRef.current;
            const header = headerRef.current;
            const summary = summaryRef.current;
            if (!root || !header || !summary) return;

            const rootHeight = root.clientHeight;
            const headerHeight = header.offsetHeight;
            const summaryHeight = summary.offsetHeight;
            const reservedHeight = headerHeight + 22 + summaryHeight + 16;
            const nextHeight = Math.max(320, rootHeight - reservedHeight);

            setOverviewCardHeight((current) =>
                current !== null && Math.abs(current - nextHeight) < 1 ? current : nextHeight,
            );
        };

        recalcOverviewHeight();

        const observer = new ResizeObserver(() => {
            recalcOverviewHeight();
        });

        if (rootRef.current) observer.observe(rootRef.current);
        if (headerRef.current) observer.observe(headerRef.current);
        if (summaryRef.current) observer.observe(summaryRef.current);
        window.addEventListener("resize", recalcOverviewHeight);

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", recalcOverviewHeight);
        };
    }, [shouldUseEqualHeightCards, viewport.width, viewport.height]);

    return (
        <div
            ref={rootRef}
            style={{
                width: "100%",
                height: shouldUseEqualHeightCards ? `calc(100% + ${MAXIMIZED_BOTTOM_EXTENSION}px)` : "100%",
                overflowY: shouldUseEqualHeightCards ? "hidden" : "auto",
                paddingRight: "6px",
                paddingBottom: shouldUseEqualHeightCards ? "0px" : "20px",
                marginBottom: shouldUseEqualHeightCards ? `-${MAXIMIZED_BOTTOM_EXTENSION}px` : 0,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
            }}
        >
            <div ref={headerRef} style={{ marginBottom: "22px", flexShrink: 0 }}>
                <h1 style={{ fontSize: "22px", fontWeight: 700, display: "flex", alignItems: "center", gap: "10px", margin: 0 }}>
                    <LayoutDashboard size={22} color="var(--color-primary)" />
                    {t("flowdeck.title")}
                </h1>
                <p style={{ color: "var(--color-text-dim)", fontSize: "13px", marginTop: "6px" }}>
                    {t("flowdeck.subtitle")}
                </p>
            </div>

            <div
                ref={summaryRef}
                style={{ display: "grid", gridTemplateColumns: `repeat(${summaryColumns}, minmax(0, 1fr))`, gap: "14px", marginBottom: "16px", flexShrink: 0 }}
            >
                <SummaryCard
                    icon={<ShieldCheck size={15} />}
                    label={t("flowdeck.summary_mode_label")}
                    value={isRemote ? t("flowdeck.mode_remote") : t("flowdeck.mode_local")}
                    note={isRemote ? t("flowdeck.summary_mode_remote_note") : t("flowdeck.summary_mode_local_note")}
                    tone={isRemote ? "ok" : "warn"}
                />
                <SummaryCard
                    icon={<UserCircle2 size={15} />}
                    label={t("flowdeck.summary_account_label")}
                    value={username ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <span>{username}</span>
                            {userRole === "admin" && (
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        padding: "3px 8px",
                                        borderRadius: "999px",
                                        fontSize: "11px",
                                        fontWeight: 700,
                                        letterSpacing: "0.04em",
                                        color: "var(--color-primary)",
                                        background: "rgba(99, 102, 241, 0.15)",
                                        border: "1px solid rgba(99, 102, 241, 0.3)",
                                    }}
                                >
                                    管理员
                                </span>
                            )}
                        </span>
                    ) : t("flowdeck.unknown_user")}
                    note={connectedAt ? t("flowdeck.summary_connected_at", { time: formatTimestamp(connectedAt) || connectedAt }) : t("flowdeck.summary_no_login_time")}
                    tone={username ? "ok" : "warn"}
                />
                <SummaryCard
                    icon={<Server size={15} />}
                    label={t("flowdeck.summary_server_label")}
                    value={!isRemote ? t("flowdeck.server_unused") : syncStatus.code}
                    note={!isRemote ? t("flowdeck.summary_server_unused_note") : serverUrl}
                    tone={serverSummaryTone}
                />
                <SummaryCard
                    icon={<Monitor size={15} />}
                    label={t("flowdeck.summary_devices_label")}
                    value={`${onlineDeviceCount}/${devices.length || 0}`}
                    note={t("flowdeck.summary_devices_note", { device: currentDeviceName })}
                    tone={devices.length > 0 ? "ok" : "neutral"}
                />
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${overviewColumns}, minmax(0, 1fr))`,
                    gap: "16px",
                    alignItems: shouldUseEqualHeightCards ? "stretch" : "start",
                    minHeight: 0,
                    flex: shouldUseEqualHeightCards ? 1 : undefined,
                    height: shouldUseEqualHeightCards && overviewCardHeight ? `${overviewCardHeight}px` : undefined,
                }}
            >
                <SectionCard
                    title={t("flowdeck.sync_title")}
                    style={{
                        ...PRIMARY_SECTION_STYLE,
                        minHeight: shouldUseEqualHeightCards ? 0 : undefined,
                        height: shouldUseEqualHeightCards && overviewCardHeight ? `${overviewCardHeight}px` : undefined,
                    }}
                    action={
                        <button
                            className="btn-ghost"
                            onClick={() => setRetryCount((count) => count + 1)}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "6px 10px",
                                borderRadius: "999px",
                                border: "1px solid var(--color-border)",
                                fontSize: "12px",
                            }}
                        >
                            <RefreshCw size={13} />
                            {t("flowdeck.retry")}
                        </button>
                    }
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "12px",
                            padding: "14px 16px",
                            borderRadius: "12px",
                            border: `1px solid ${TONE_STYLES[syncStatus.tone].border}`,
                            background: TONE_STYLES[syncStatus.tone].bg,
                        }}
                    >
                        <div style={{ color: TONE_STYLES[syncStatus.tone].color, display: "flex", paddingTop: "2px" }}>
                            {toneIcon(syncStatus.tone)}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                <span style={{ fontSize: "12px", fontWeight: 700, color: TONE_STYLES[syncStatus.tone].color }}>
                                    {syncStatus.code}
                                </span>
                                <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-main)" }}>
                                    {syncStatus.summary}
                                </span>
                            </div>
                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {syncStatus.detail}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${infoPairColumns}, minmax(0, 1fr))`, gap: "12px" }}>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_mode")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{isRemote ? t("flowdeck.mode_remote") : t("flowdeck.mode_local")}</div>
                        </div>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_server")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600, wordBreak: "break-all" }}>
                                {serverUrl || t("flowdeck.server_unused")}
                            </div>
                        </div>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_password")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>
                                {rememberPassword ? t("flowdeck.password_saved") : t("flowdeck.password_missing")}
                            </div>
                        </div>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_checked_at")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>
                                {checkedAt ? formatTimestamp(checkedAt) || checkedAt : t("flowdeck.not_checked")}
                            </div>
                        </div>
                    </div>
                </SectionCard>

                <SectionCard title={t("flowdeck.devices_title")} style={{
                    ...PRIMARY_SECTION_STYLE,
                    minHeight: shouldUseEqualHeightCards ? 0 : undefined,
                    height: shouldUseEqualHeightCards && overviewCardHeight ? `${overviewCardHeight}px` : undefined,
                }}>
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${deviceMetricColumns}, minmax(0, 1fr))`, gap: "12px" }}>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_current_device")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{currentDeviceName}</div>
                        </div>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_total_devices")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{devices.length}</div>
                        </div>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_online_devices")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{onlineDeviceCount}</div>
                        </div>
                        <div style={INFO_TILE_STYLE}>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "6px" }}>{t("flowdeck.field_visible_drop_targets")}</div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{otherOnlineDeviceCount}</div>
                        </div>
                    </div>

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px",
                            minHeight: 0,
                            flex: shouldUseEqualHeightCards ? 1 : undefined,
                            overflowY: shouldUseEqualHeightCards ? "auto" : "visible",
                            paddingRight: shouldUseEqualHeightCards ? "4px" : undefined,
                        }}
                    >
                        {isDevicesLoading ? (
                            <div style={{ ...INFO_TILE_STYLE, padding: "18px 16px", color: "var(--color-text-muted)", fontSize: "13px" }}>
                                {t("flowdeck.loading_devices")}
                            </div>
                        ) : sortedDevices.length === 0 ? (
                            <div style={{ ...INFO_TILE_STYLE, padding: "18px 16px", color: "var(--color-text-muted)", fontSize: "13px" }}>
                                {t("flowdeck.no_devices")}
                            </div>
                        ) : (
                            sortedDevices.map((device) => {
                                const online = !!device.isOnline;
                                const lastSeen = formatTimestamp(device.lastSeenAt);

                                return (
                                    <div
                                        key={device.id || `${device.name}-${device.deviceType}`}
                                        style={{
                                            ...INFO_TILE_STYLE,
                                            padding: "14px 16px",
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: "12px",
                                            opacity: online ? 1 : 0.72,
                                        }}
                                    >
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                <span style={{ fontSize: "13px", fontWeight: 700 }}>{device.name || t("flowdeck.unknown_device")}</span>
                                                {device.isLocal && (
                                                    <span style={{ fontSize: "11px", padding: "4px 8px", borderRadius: "999px", background: "var(--color-primary-glow)", color: "var(--color-primary)" }}>
                                                        {t("flowdeck.current_device_badge")}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "5px" }}>
                                                {device.deviceType || t("flowdeck.unknown_device_type")}
                                                {lastSeen ? ` · ${t("flowdeck.last_seen", { time: lastSeen })}` : ""}
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                padding: "6px 10px",
                                                borderRadius: "999px",
                                                fontSize: "11px",
                                                fontWeight: 700,
                                                background: online ? TONE_STYLES.ok.bg : TONE_STYLES.neutral.bg,
                                                color: online ? TONE_STYLES.ok.color : TONE_STYLES.neutral.color,
                                                border: `1px solid ${online ? TONE_STYLES.ok.border : TONE_STYLES.neutral.border}`,
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {online ? t("flowdeck.device_online") : t("flowdeck.device_offline")}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </SectionCard>

                <SectionCard title={t("flowdeck.features_title")} style={{
                    ...PRIMARY_SECTION_STYLE,
                    minHeight: shouldUseEqualHeightCards ? 0 : undefined,
                    height: shouldUseEqualHeightCards && overviewCardHeight ? `${overviewCardHeight}px` : undefined,
                }}>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${featureColumns}, minmax(0, 1fr))`,
                            gap: "10px",
                            minHeight: 0,
                            flex: shouldUseEqualHeightCards ? 1 : undefined,
                            overflowY: shouldUseEqualHeightCards ? "auto" : "visible",
                            paddingRight: shouldUseEqualHeightCards ? "4px" : undefined,
                        }}
                    >
                        {featureItems.map((item) => {
                            const tone = statusTone(item.status);
                            return (
                                <div
                                    key={item.id}
                                    style={{
                                        ...INFO_TILE_STYLE,
                                        padding: "14px 16px",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: "12px",
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "4px" }}>{item.label}</div>
                                        <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.45 }}>{item.description}</div>
                                        <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "6px" }}>{item.meta}</div>
                                    </div>
                                    <div
                                        style={{
                                            alignSelf: "flex-start",
                                            padding: "6px 10px",
                                            borderRadius: "999px",
                                            background: TONE_STYLES[tone].bg,
                                            color: TONE_STYLES[tone].color,
                                            border: `1px solid ${TONE_STYLES[tone].border}`,
                                            fontSize: "11px",
                                            fontWeight: 700,
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {t(`flowdeck.status_${item.status.toLowerCase()}`)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </SectionCard>
            </div>
        </div>
    );
}

const PRIMARY_SECTION_STYLE: CSSProperties = {
    background: "var(--color-surface)",
    boxShadow: "none",
    border: "1px solid var(--color-border)",
};
