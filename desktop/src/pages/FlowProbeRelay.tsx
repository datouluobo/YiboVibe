import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
    Activity,
    ArrowRightLeft,
    CheckCircle2,
    Copy,
    Loader2,
    PauseCircle,
    PlayCircle,
    RefreshCw,
    Save,
    ServerCog,
    Trash2,
} from "lucide-react";
import "./FlowProbe.css";

type ProbeProtocol =
    | "OpenAiCompatible"
    | "Ollama"
    | "GeminiOpenAiCompatible"
    | "Anthropic"
    | "Custom";

type ProbeRouteKind = "OpenAi" | "Anthropic";

interface ProbeCredentialPayload {
    id: string;
    name: string;
    provider: string;
    protocol: ProbeProtocol;
    base_url: string;
    default_model: string;
    discovered_models: string[];
    model_catalog_updated_at_ms?: number | null;
    note: string;
    tags: string[];
    enabled: boolean;
    sort_order: number;
    api_key: string;
    input_price_per_million?: number | null;
    output_price_per_million?: number | null;
    price_unit: string;
    price_currency: string;
}

interface ProbeRoutePayload {
    kind: ProbeRouteKind;
    credential_id: string;
    model_override: string;
    enabled: boolean;
}

interface ProbeProxyConfig {
    listen_host: string;
    listen_port: number;
    local_token: string;
    is_enabled: boolean;
    collect_usage: boolean;
}

interface ProbeConfigPayload {
    credentials: ProbeCredentialPayload[];
    routes: ProbeRoutePayload[];
    proxy: ProbeProxyConfig;
    timeout_ms: number;
}

interface ProbeProxyStatusPayload {
    is_running: boolean;
    last_error?: string | null;
    listen_host: string;
    listen_port: number;
    local_token: string;
    openai_endpoint: string;
    anthropic_endpoint: string;
    openai_model_alias: string;
    anthropic_model_alias: string;
    lan_host_hint?: string | null;
}

interface ProbeResult {
    success: boolean;
    code: string;
    summary: string;
    detail: string;
    latency_ms?: number | null;
    detected_protocol?: string | null;
    auth_status: string;
    model_count?: number | null;
}

function createInvokeErrorResult(error: unknown): ProbeResult {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    return {
        success: false,
        code: "ERR_INVOKE_FAILED",
        summary: "Test invocation failed",
        detail: message,
        latency_ms: null,
        detected_protocol: null,
        auth_status: "unknown",
        model_count: null,
    };
}

function resultSummaryZh(result: ProbeResult) {
    switch (result.code) {
        case "OK_MODELS_FOUND":
            return "接口可用，并成功返回模型列表";
        case "OK_CONNECTED":
            return "接口可用，基础连通正常";
        case "ERR_UNAUTHORIZED":
            return "接口可达，但鉴权失败";
        case "ERR_NOT_FOUND":
            return "接口可达，但测试路径不存在";
        case "ERR_TIMEOUT":
            return "接口请求超时";
        case "ERR_NETWORK":
            return "接口网络连接失败";
        case "ERR_PROTOCOL_MISMATCH":
            return "接口协议不匹配或返回不符合预期";
        case "ERR_INVOKE_FAILED":
            return "客户端测试调用失败";
        default:
            return result.success ? "接口测试通过" : "接口测试失败";
    }
}

function resultConclusionZh(result: ProbeResult) {
    switch (result.code) {
        case "OK_MODELS_FOUND":
            return "当前路由可继续使用。";
        case "OK_CONNECTED":
            return "当前路由基本可用，建议再核对模型覆盖配置。";
        case "ERR_UNAUTHORIZED":
            return "优先检查上游 API Key 和服务商鉴权要求。";
        case "ERR_NOT_FOUND":
            return "优先检查目标地址和固定协议路由是否匹配。";
        case "ERR_TIMEOUT":
            return "优先检查网络、上游状态和超时设置。";
        case "ERR_NETWORK":
            return "优先检查本机到上游的网络可达性。";
        case "ERR_PROTOCOL_MISMATCH":
            return "优先核对上游协议类型和当前固定路由。";
        case "ERR_INVOKE_FAILED":
            return "前端没有拿到测试结果，请先检查本地命令执行错误。";
        default:
            return result.detail || "请结合返回详情继续检查。";
    }
}

interface ProbeLogEntryPayload {
    id: number;
    timestamp_ms: number;
    route_kind: ProbeRouteKind;
    credential_id: string;
    credential_name: string;
    provider: string;
    protocol: ProbeProtocol;
    model: string;
    request_path: string;
    status_code: number;
    success: boolean;
    latency_ms: number;
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    estimated_cost?: number | null;
    error_message?: string | null;
    request_kind: string;
    request_signature?: string | null;
    response_signature?: string | null;
    diagnostic_flags: string[];
}

interface ProbeStatsPayload {
    total_requests: number;
    success_count: number;
    error_count: number;
    average_latency_ms?: number | null;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost?: number | null;
}

interface ProbeRouteStatsPayload {
    route_kind: ProbeRouteKind;
    stats: ProbeStatsPayload;
}

interface ProbeTargetStatsPayload {
    route_kind: ProbeRouteKind;
    credential_id: string;
    credential_name: string;
    provider: string;
    protocol: ProbeProtocol;
    stats: ProbeStatsPayload;
}

interface ProbeDashboardStatsPayload {
    current_session: ProbeStatsPayload;
    recent_5m: ProbeStatsPayload;
    by_route_current_session: ProbeRouteStatsPayload[];
    by_route_recent_5m: ProbeRouteStatsPayload[];
    by_target_current_session: ProbeTargetStatsPayload[];
}

interface ProbeDashboardPayload {
    status: ProbeProxyStatusPayload;
    logs: ProbeLogEntryPayload[];
    stats: ProbeDashboardStatsPayload;
}

const PROTOCOL_LABELS: Record<ProbeProtocol, string> = {
    OpenAiCompatible: "OpenAI Compatible",
    Ollama: "Ollama",
    GeminiOpenAiCompatible: "Gemini OpenAI",
    Anthropic: "Anthropic",
    Custom: "Custom",
};

function sortCredentials(credentials: ProbeCredentialPayload[]) {
    return [...credentials].sort((a, b) => a.sort_order - b.sort_order);
}

function formatProtocolBadge(protocol: ProbeProtocol) {
    return PROTOCOL_LABELS[protocol] || protocol;
}

function formatDate(timestampMs: number) {
    return new Date(timestampMs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function maskToken(value: string) {
    if (!value) return "未设置";
    if (value.length <= 8) return value;
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isLoopbackHost(host: string) {
    const value = host.trim().toLowerCase();
    return value === "127.0.0.1" || value === "localhost";
}

function protocolSupportsRoute(kind: ProbeRouteKind, protocol: ProbeProtocol) {
    if (kind === "OpenAi") {
        return ["OpenAiCompatible", "GeminiOpenAiCompatible", "Custom"].includes(protocol);
    }
    return ["Anthropic", "Custom"].includes(protocol);
}

export default function FlowProbeRelay() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<ProbeConfigPayload | null>(null);
    const [dashboard, setDashboard] = useState<ProbeDashboardPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busyAction, setBusyAction] = useState("");
    const [proxyMode, setProxyMode] = useState<"loopback" | "wildcard" | "custom">("loopback");
    const [routePickerKind, setRoutePickerKind] = useState<ProbeRouteKind | null>(null);
    const [routeResults, setRouteResults] = useState<Partial<Record<ProbeRouteKind, ProbeResult>>>({});

    const loadData = async (ensureProxy = false) => {
        setLoading(true);
        try {
            const probeConfig = await invoke<ProbeConfigPayload>("get_probe_config");
            if (ensureProxy) {
                try {
                    await invoke("start_probe_proxy");
                } catch {
                    // Runtime state is surfaced through dashboard status.
                }
            }
            const probeDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
            setConfig(probeConfig);
            setDashboard(probeDashboard);
            const host = probeConfig.proxy.listen_host.trim().toLowerCase();
            setProxyMode(host === "127.0.0.1" || host === "localhost" ? "loopback" : host === "0.0.0.0" ? "wildcard" : "custom");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData(true).catch(console.error);
        const timer = window.setInterval(() => {
            invoke<ProbeDashboardPayload>("get_probe_dashboard")
                .then(setDashboard)
                .catch(console.error);
        }, 5000);
        return () => window.clearInterval(timer);
    }, []);

    const credentials = useMemo(() => sortCredentials(config?.credentials || []), [config]);

    const credentialMap = useMemo(() => {
        const map = new Map<string, ProbeCredentialPayload>();
        credentials.forEach((credential) => map.set(credential.id, credential));
        return map;
    }, [credentials]);

    const routeMap = useMemo(() => {
        const map = new Map<ProbeRouteKind, ProbeRoutePayload>();
        (config?.routes || []).forEach((route) => map.set(route.kind, route));
        return map;
    }, [config]);

    const persistConfig = async (next: ProbeConfigPayload, actionLabel = "save") => {
        setSaving(true);
        setBusyAction(actionLabel);
        try {
            await invoke("save_probe_config", { payload: next });
            setConfig(next);
            const probeDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
            setDashboard(probeDashboard);
        } finally {
            setSaving(false);
            setBusyAction("");
        }
    };

    const saveProxySettings = async () => {
        if (!config) return;
        const normalizedHost = config.proxy.listen_host.trim() || "127.0.0.1";
        const nextProxy = {
            ...config.proxy,
            listen_host: normalizedHost,
            listen_port: Math.max(1, Number(config.proxy.listen_port) || 17861),
        };
        await persistConfig({ ...config, proxy: nextProxy }, "save-proxy");
    };

    const applyProxyMode = (mode: "loopback" | "wildcard" | "custom") => {
        if (!config) return;
        setProxyMode(mode);
        if (mode === "custom") {
            if (isLoopbackHost(config.proxy.listen_host) || config.proxy.listen_host.trim() === "0.0.0.0") {
                setConfig({ ...config, proxy: { ...config.proxy, listen_host: "" } });
            }
            return;
        }
        setConfig({
            ...config,
            proxy: {
                ...config.proxy,
                listen_host: mode === "loopback" ? "127.0.0.1" : "0.0.0.0",
            },
        });
    };

    const copyText = async (value: string) => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // Ignore clipboard failures on unsupported contexts.
        }
    };

    const handleRouteSwitch = async (kind: ProbeRouteKind, credentialId: string) => {
        if (!config) return;
        const nextConfig = {
            ...config,
            routes: config.routes.map((route) =>
                route.kind === kind ? { ...route, credential_id: credentialId } : route
            ),
        };
        setRoutePickerKind(null);
        await persistConfig(nextConfig, `switch-${kind}`);
    };

    const handleRouteModelOverride = async (kind: ProbeRouteKind, modelOverride: string) => {
        if (!config) return;
        const nextConfig = {
            ...config,
            routes: config.routes.map((route) =>
                route.kind === kind ? { ...route, model_override: modelOverride } : route
            ),
        };
        setConfig(nextConfig);
        await persistConfig(nextConfig, `model-${kind}`);
    };

    const runRouteTest = async (kind: ProbeRouteKind) => {
        setBusyAction(`test-${kind}`);
        try {
            const result = await invoke<ProbeResult>("test_probe_route", { kind });
            setRouteResults((prev) => ({ ...prev, [kind]: result }));
            const freshDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
            setDashboard(freshDashboard);
        } catch (error) {
            setRouteResults((prev) => ({ ...prev, [kind]: createInvokeErrorResult(error) }));
        } finally {
            setBusyAction("");
        }
    };

    const fetchRouteModels = async (kind: ProbeRouteKind) => {
        setBusyAction(`models-${kind}`);
        try {
            const models = await invoke<string[]>("list_probe_route_models", { kind });
            if (!config) return;
            const route = routeMap.get(kind);
            if (!route?.credential_id) return;
            const nextConfig = {
                ...config,
                credentials: config.credentials.map((credential) =>
                    credential.id === route.credential_id
                        ? {
                            ...credential,
                            discovered_models: models,
                            model_catalog_updated_at_ms: Date.now(),
                            default_model: credential.default_model || models[0] || "",
                        }
                        : credential
                ),
            };
            setConfig(nextConfig);
            await persistConfig(nextConfig, `models-${kind}`);
            if (models.length && !route.model_override) {
                await handleRouteModelOverride(kind, models[0]);
            }
        } finally {
            setBusyAction("");
        }
    };

    const toggleProxy = async () => {
        setBusyAction("toggle-proxy");
        try {
            if (dashboard?.status.is_running) {
                const status = await invoke<ProbeProxyStatusPayload>("stop_probe_proxy");
                setDashboard((prev) => (prev ? { ...prev, status } : prev));
            } else {
                const status = await invoke<ProbeProxyStatusPayload>("start_probe_proxy");
                setDashboard((prev) => (prev ? { ...prev, status } : prev));
            }
            const freshDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
            setDashboard(freshDashboard);
        } finally {
            setBusyAction("");
        }
    };

    const clearLogs = async () => {
        setBusyAction("clear-logs");
        try {
            await invoke("clear_probe_logs");
            const freshDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
            setDashboard(freshDashboard);
        } finally {
            setBusyAction("");
        }
    };

    if (loading || !config || !dashboard) {
        return (
            <div className="flowprobe-page flowprobe-page--loading">
                <Loader2 size={20} className="flowprobe-spin" />
                <span>FlowProbe 正在加载...</span>
            </div>
        );
    }

    const relayStats = dashboard.stats;

    const getRouteRecentStats = (kind: ProbeRouteKind) =>
        relayStats.by_route_recent_5m.find((entry) => entry.route_kind === kind)?.stats || {
            total_requests: 0,
            success_count: 0,
            error_count: 0,
            average_latency_ms: null,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            estimated_cost: null,
        };

    const getCurrentTargetStats = (kind: ProbeRouteKind, credentialId?: string) => {
        if (!credentialId) return null;
        return (
            relayStats.by_target_current_session.find(
                (entry) => entry.route_kind === kind && entry.credential_id === credentialId
            ) || null
        );
    };

    const routeCards: Array<{ kind: ProbeRouteKind; title: string; endpoint?: string; alias: string }> = [
        {
            kind: "OpenAi",
            title: "OpenAI 兼容接口",
            endpoint: dashboard.status.openai_endpoint,
            alias: dashboard.status.openai_model_alias,
        },
        {
            kind: "Anthropic",
            title: "Anthropic 兼容接口",
            endpoint: dashboard.status.anthropic_endpoint,
            alias: dashboard.status.anthropic_model_alias,
        },
    ];

    const openaiLocalEndpoint = `http://127.0.0.1:${dashboard.status.listen_port}/v1`;
    const anthropicLocalEndpoint = `http://127.0.0.1:${dashboard.status.listen_port}/anthropic`;
    const openaiLanEndpoint = dashboard.status.lan_host_hint
        ? `http://${dashboard.status.lan_host_hint}:${dashboard.status.listen_port}/v1`
        : "";
    const anthropicLanEndpoint = dashboard.status.lan_host_hint
        ? `http://${dashboard.status.lan_host_hint}:${dashboard.status.listen_port}/anthropic`
        : "";
    const showCrossEnvHint = !isLoopbackHost(config.proxy.listen_host);

    return (
        <div className="flowprobe-page">
            <div className="flowprobe-header">
                <div className="flowprobe-title-group">
                    <h1 className="flowprobe-title">
                        <Activity size={22} color="var(--color-primary)" />
                        {t("flowprobe_relay.title")}
                    </h1>
                    <p className="flowprobe-subtitle">{t("flowprobe_relay.subtitle")}</p>
                </div>
                <div className="flowprobe-header-actions">
                    <button className="flowprobe-button flowprobe-button--secondary" onClick={() => loadData(false)}>
                        <RefreshCw size={15} />
                        刷新
                    </button>
                    <button className="flowprobe-button flowprobe-button--primary" onClick={saveProxySettings} disabled={saving}>
                        {saving && busyAction === "save-proxy" ? <Loader2 size={15} className="flowprobe-spin" /> : <Save size={15} />}
                        保存配置
                    </button>
                </div>
            </div>

            <section className="flowprobe-panel flowprobe-panel--relay-strip">
                <div className="flowprobe-relay-strip">
                    <div className="flowprobe-status-card">
                        <div className="flowprobe-status-line">
                            <span className={`flowprobe-dot ${dashboard.status.is_running ? "is-on" : "is-off"}`} />
                            <span>{dashboard.status.is_running ? "运行中" : "已停止"}</span>
                        </div>
                        <div className="flowprobe-status-line">
                            <span>代理开关</span>
                            <strong>{config.proxy.is_enabled ? "已启用" : "已禁用"}</strong>
                        </div>
                        <div className="flowprobe-status-line">
                            <span>统计采集</span>
                            <strong>{config.proxy.collect_usage ? "已开启" : "已关闭"}</strong>
                        </div>
                        <div className="flowprobe-status-line">
                            <span>监听地址</span>
                            <code>{config.proxy.listen_host}:{config.proxy.listen_port}</code>
                        </div>
                        <div className="flowprobe-proxy-mode-row">
                            <button className={`flowprobe-chip ${proxyMode === "loopback" ? "is-active" : ""}`} onClick={() => applyProxyMode("loopback")}>
                                仅本机
                            </button>
                            <button className={`flowprobe-chip ${proxyMode === "wildcard" ? "is-active" : ""}`} onClick={() => applyProxyMode("wildcard")}>
                                WSL / 局域网
                            </button>
                            <button className={`flowprobe-chip ${proxyMode === "custom" ? "is-active" : ""}`} onClick={() => applyProxyMode("custom")}>
                                自定义
                            </button>
                        </div>
                    </div>

                    <div className="flowprobe-status-card">
                        <div className="flowprobe-proxy-config">
                            <label>
                                <span>Host</span>
                                <input
                                    value={config.proxy.listen_host}
                                    placeholder={proxyMode === "custom" ? "例如 192.168.1.92" : ""}
                                    onChange={(event) =>
                                        setConfig({
                                            ...config,
                                            proxy: { ...config.proxy, listen_host: event.target.value },
                                        })
                                    }
                                />
                            </label>
                            <label>
                                <span>Port</span>
                                <input
                                    type="number"
                                    value={config.proxy.listen_port}
                                    onChange={(event) =>
                                        setConfig({
                                            ...config,
                                            proxy: { ...config.proxy, listen_port: Number(event.target.value) || 0 },
                                        })
                                    }
                                />
                            </label>
                        </div>
                        <div className="flowprobe-status-line">
                            <span>本地 Token</span>
                            <code>{maskToken(dashboard.status.local_token)}</code>
                            <button className="flowprobe-icon-button" onClick={() => copyText(dashboard.status.local_token)}>
                                <Copy size={14} />
                            </button>
                        </div>
                        <div className="flowprobe-proxy-mode-row">
                            <button
                                className={`flowprobe-chip ${config.proxy.is_enabled ? "is-active" : ""}`}
                                onClick={() =>
                                    setConfig({
                                        ...config,
                                        proxy: { ...config.proxy, is_enabled: !config.proxy.is_enabled },
                                    })
                                }
                            >
                                {config.proxy.is_enabled ? "代理已启用" : "代理已禁用"}
                            </button>
                            <button
                                className={`flowprobe-chip ${config.proxy.collect_usage ? "is-active" : ""}`}
                                onClick={() =>
                                    setConfig({
                                        ...config,
                                        proxy: { ...config.proxy, collect_usage: !config.proxy.collect_usage },
                                    })
                                }
                            >
                                {config.proxy.collect_usage ? "统计采集中" : "统计采集关闭"}
                            </button>
                        </div>
                        {isLoopbackHost(config.proxy.listen_host) && (
                            <div className="flowprobe-status-warning">
                                WSL / 容器 / 虚拟机客户端不能使用 127.0.0.1。改为 <code>0.0.0.0</code> 或 Windows 主机 IP。
                            </div>
                        )}
                    </div>

                    <div className="flowprobe-status-card">
                        <div className="flowprobe-status-line">
                            <span>接入示例</span>
                            <code>{showCrossEnvHint ? openaiLanEndpoint || openaiLocalEndpoint : openaiLocalEndpoint}</code>
                            <button className="flowprobe-icon-button" onClick={() => copyText(showCrossEnvHint ? openaiLanEndpoint || openaiLocalEndpoint : openaiLocalEndpoint)}>
                                <Copy size={14} />
                            </button>
                        </div>
                        <div className="flowprobe-status-line">
                            <span>Anthropic</span>
                            <code>{showCrossEnvHint ? anthropicLanEndpoint || anthropicLocalEndpoint : anthropicLocalEndpoint}</code>
                            <button className="flowprobe-icon-button" onClick={() => copyText(showCrossEnvHint ? anthropicLanEndpoint || anthropicLocalEndpoint : anthropicLocalEndpoint)}>
                                <Copy size={14} />
                            </button>
                        </div>
                        <div className="flowprobe-relay-actions">
                            <button className="flowprobe-button flowprobe-button--secondary" onClick={saveProxySettings} disabled={saving}>
                                {saving && busyAction === "save-proxy" ? <Loader2 size={15} className="flowprobe-spin" /> : <Save size={15} />}
                                保存网络
                            </button>
                            <button className="flowprobe-button flowprobe-button--secondary" onClick={toggleProxy} disabled={!config.proxy.is_enabled}>
                                {busyAction === "toggle-proxy" ? <Loader2 size={15} className="flowprobe-spin" /> : dashboard.status.is_running ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                                {!config.proxy.is_enabled ? "Probe 已禁用" : dashboard.status.is_running ? "停止 Probe" : "启动 Probe"}
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {dashboard.status.last_error && (
                <div className="flowprobe-banner flowprobe-banner--danger">{dashboard.status.last_error}</div>
            )}

            <div className="flowprobe-relay-grid">
                {routeCards.map((item) => {
                    const route = routeMap.get(item.kind);
                    const credential = route ? credentialMap.get(route.credential_id) : null;
                    const stats = getRouteRecentStats(item.kind);
                    const targetStats = getCurrentTargetStats(item.kind, route?.credential_id);
                    const result = routeResults[item.kind];
                    return (
                        <section key={item.kind} className="flowprobe-panel">
                            <div className="flowprobe-route-card">
                                <div className="flowprobe-route-head">
                                    <div>
                                        <h3>{item.title}</h3>
                                        <p>{item.endpoint}</p>
                                    </div>
                                    <span className={`flowprobe-chip flowprobe-chip--status ${route?.enabled ? "is-active" : ""}`}>
                                        {route?.enabled ? "已启用" : "未启用"}
                                    </span>
                                </div>

                                <div className="flowprobe-endpoint-meta flowprobe-endpoint-meta--relay">
                                    <span>固定别名</span>
                                    <code>{item.alias}</code>
                                    <button className="flowprobe-icon-button" onClick={() => copyText(item.alias)}>
                                        <Copy size={14} />
                                    </button>
                                </div>

                                <div className="flowprobe-route-body">
                                    <div className="flowprobe-route-field">
                                        <span>接入 API</span>
                                        <strong>{credential?.name || "未选择"}</strong>
                                    </div>
                                    <div className="flowprobe-route-field">
                                        <span>服务商</span>
                                        <strong>{credential?.provider || "未选择"}</strong>
                                    </div>
                                    <div className="flowprobe-route-field is-wide">
                                        <span>上游地址</span>
                                        <code title={credential?.base_url || ""}>{credential?.base_url || "未配置"}</code>
                                    </div>
                                    <div className="flowprobe-route-field">
                                        <span>模型</span>
                                        <input
                                            value={route?.model_override || ""}
                                            placeholder={credential?.default_model || "沿用 API 默认模型"}
                                            onChange={(event) => {
                                                if (!config || !route) return;
                                                const nextConfig = {
                                                    ...config,
                                                    routes: config.routes.map((candidate) =>
                                                        candidate.kind === item.kind
                                                            ? { ...candidate, model_override: event.target.value }
                                                            : candidate
                                                    ),
                                                };
                                                setConfig(nextConfig);
                                            }}
                                            onBlur={(event) => handleRouteModelOverride(item.kind, event.target.value)}
                                        />
                                    </div>
                                    <div className="flowprobe-route-field">
                                        <span>最近 5 分钟</span>
                                        <strong>{stats.total_requests} 次 / 成功 {stats.success_count} 次 / 平均 {stats.average_latency_ms ?? "-"} ms</strong>
                                    </div>
                                </div>

                                <div className="flowprobe-metrics flowprobe-metrics--route">
                                    <div className="flowprobe-metric-card">
                                        <span>请求数</span>
                                        <strong>{stats.total_requests}</strong>
                                    </div>
                                    <div className="flowprobe-metric-card">
                                        <span>输入 / 输出 Token</span>
                                        <strong>{stats.input_tokens} / {stats.output_tokens}</strong>
                                    </div>
                                    <div className="flowprobe-metric-card">
                                        <span>估算费用</span>
                                        <strong>{stats.estimated_cost != null ? `$${stats.estimated_cost.toFixed(4)}` : "-"}</strong>
                                    </div>
                                </div>

                                <div className="flowprobe-target-summary">
                                    <span>当前目标 API 统计</span>
                                    <strong>
                                        {targetStats
                                            ? `${targetStats.credential_name} · ${targetStats.stats.total_requests} 次 / Token ${targetStats.stats.total_tokens}`
                                            : "当前路由还没有目标 API 级统计"}
                                    </strong>
                                </div>

                                <div className="flowprobe-route-actions">
                                    <button className="flowprobe-button flowprobe-button--secondary" onClick={() => setRoutePickerKind(item.kind)}>
                                        <ArrowRightLeft size={14} />
                                        切换目标
                                    </button>
                                    <button className="flowprobe-button flowprobe-button--secondary" onClick={() => runRouteTest(item.kind)}>
                                        {busyAction === `test-${item.kind}` ? <Loader2 size={14} className="flowprobe-spin" /> : <RefreshCw size={14} />}
                                        测试当前
                                    </button>
                                    <button className="flowprobe-button flowprobe-button--secondary" onClick={() => fetchRouteModels(item.kind)}>
                                        {busyAction === `models-${item.kind}` ? <Loader2 size={14} className="flowprobe-spin" /> : <ServerCog size={14} />}
                                        拉取模型
                                    </button>
                                </div>

                                {result && (
                                    <div className={`flowprobe-result ${result.success ? "is-success" : "is-error"}`}>
                                        <div className="flowprobe-result-head">
                                            <strong>{result.code}</strong>
                                            <span>{resultSummaryZh(result)}</span>
                                            {typeof result.latency_ms === "number" && <em>{result.latency_ms} ms</em>}
                                        </div>
                                        <div className="flowprobe-result-body">
                                            <div className="flowprobe-detail-list">
                                                <div><span>代码 / 代号</span><strong>{result.code || "-"}</strong></div>
                                                <div><span>中文</span><strong>{resultSummaryZh(result)}</strong></div>
                                                <div><span>结论</span><strong>{resultConclusionZh(result)}</strong></div>
                                                <div><span>认证状态</span><strong>{result.auth_status || "-"}</strong></div>
                                                <div><span>识别协议</span><strong>{result.detected_protocol || "-"}</strong></div>
                                                <div><span>模型数量</span><strong>{result.model_count ?? "-"}</strong></div>
                                            </div>
                                            <div>{result.detail || result.summary}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>

            <div className="flowprobe-shell flowprobe-shell--relay-bottom">
                <section className="flowprobe-panel">
                    <div className="flowprobe-panel-header">
                        <div>
                            <h2>汇总统计</h2>
                            <p>默认先看全局，再结合每个兼容接口卡片观察拆分数据。</p>
                        </div>
                    </div>
                    <div className="flowprobe-metrics">
                        <div className="flowprobe-metric-card">
                            <span>当前会话请求</span>
                            <strong>{relayStats.current_session.total_requests}</strong>
                        </div>
                        <div className="flowprobe-metric-card">
                            <span>成功 / 错误</span>
                            <strong>{relayStats.current_session.success_count} / {relayStats.current_session.error_count}</strong>
                        </div>
                        <div className="flowprobe-metric-card">
                            <span>输入 / 输出 Token</span>
                            <strong>{relayStats.current_session.input_tokens} / {relayStats.current_session.output_tokens}</strong>
                        </div>
                        <div className="flowprobe-metric-card">
                            <span>估算费用</span>
                            <strong>{relayStats.current_session.estimated_cost != null ? `$${relayStats.current_session.estimated_cost.toFixed(4)}` : "-"}</strong>
                        </div>
                    </div>

                    <div className="flowprobe-target-list">
                        {relayStats.by_target_current_session.map((target) => (
                            <div key={`${target.route_kind}:${target.credential_id}`} className="flowprobe-target-item">
                                <div className="flowprobe-target-head">
                                    <strong>{target.credential_name}</strong>
                                    <span className="flowprobe-tag">{target.route_kind === "OpenAi" ? "OpenAI" : "Anthropic"}</span>
                                </div>
                                <div className="flowprobe-target-meta">
                                    <span>{target.provider}</span>
                                    <span>{formatProtocolBadge(target.protocol)}</span>
                                    <span>{target.stats.total_requests} 次</span>
                                    <span>Token {target.stats.total_tokens}</span>
                                    <span>{target.stats.estimated_cost != null ? `$${target.stats.estimated_cost.toFixed(4)}` : "-"}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="flowprobe-panel">
                    <div className="flowprobe-panel-header">
                        <div>
                            <h2>近期活动</h2>
                            <p>保留一张活动表，不再拆成多组“查看全部”的折叠块。</p>
                        </div>
                        <button className="flowprobe-icon-button" onClick={clearLogs}>
                            {busyAction === "clear-logs" ? <Loader2 size={14} className="flowprobe-spin" /> : <Trash2 size={14} />}
                        </button>
                    </div>

                    <div className="flowprobe-log-list">
                        {(dashboard.logs || []).slice(0, 12).map((entry) => (
                            <div key={entry.id} className="flowprobe-log-item">
                                <div className="flowprobe-log-top">
                                    <div className="flowprobe-log-title">
                                        <span className={`flowprobe-dot ${entry.success ? "is-on" : "is-off"}`} />
                                        {entry.route_kind === "OpenAi" ? "OpenAI 接口" : "Anthropic 接口"}
                                    </div>
                                    <div className="flowprobe-log-time">{formatDate(entry.timestamp_ms)}</div>
                                </div>
                                <div className="flowprobe-log-grid">
                                    <span>{entry.credential_name}</span>
                                    <span>{entry.model || "-"}</span>
                                    <span>{entry.status_code}</span>
                                    <span>{entry.latency_ms} ms</span>
                                    <span>{entry.request_path || "-"}</span>
                                    <span>{entry.estimated_cost != null ? `$${entry.estimated_cost.toFixed(4)}` : "-"}</span>
                                </div>
                                {(entry.request_kind || entry.request_signature || entry.response_signature || (entry.diagnostic_flags || []).length > 0) && (
                                    <div className="flowprobe-log-diagnostics">
                                        {(entry.diagnostic_flags || []).length > 0 && (
                                            <div className="flowprobe-log-flags">{entry.diagnostic_flags.join(" / ")}</div>
                                        )}
                                        {entry.request_kind && (
                                            <div>
                                                <strong>{entry.request_kind}</strong>
                                                {entry.request_signature ? ` · ${entry.request_signature}` : ""}
                                            </div>
                                        )}
                                        {entry.response_signature && <div>{entry.response_signature}</div>}
                                    </div>
                                )}
                                {entry.error_message && <div className="flowprobe-log-error">{entry.error_message}</div>}
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {routePickerKind && (
                <div className="flowprobe-modal-backdrop" onClick={() => setRoutePickerKind(null)}>
                    <div className="flowprobe-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="flowprobe-panel-header">
                            <div>
                                <h3>切换转发目标</h3>
                                <p>只会修改 FlowProbe 当前对外接口的实际转发对象。</p>
                            </div>
                            <button className="flowprobe-icon-button" onClick={() => setRoutePickerKind(null)}>
                                <CheckCircle2 size={14} />
                            </button>
                        </div>
                        <div className="flowprobe-picker-list">
                            {credentials
                                .filter((credential) => protocolSupportsRoute(routePickerKind, credential.protocol))
                                .map((credential) => (
                                    <button
                                        key={credential.id}
                                        className="flowprobe-picker-item"
                                        onClick={() => handleRouteSwitch(routePickerKind, credential.id)}
                                    >
                                        <div className="flowprobe-picker-name">{credential.name}</div>
                                        <div className="flowprobe-picker-meta">
                                            <span>{credential.provider}</span>
                                            <span>{formatProtocolBadge(credential.protocol)}</span>
                                            <span>{credential.default_model || "无默认模型"}</span>
                                        </div>
                                    </button>
                                ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
