import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
    ArrowRightLeft,
    Copy,
    Database,
    Eye,
    EyeOff,
    Loader2,
    Plus,
    RefreshCw,
    Search,
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
    last_test_latency_ms?: number | null;
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

interface ProbeDashboardPayload {
    status: ProbeProxyStatusPayload;
}

const PROTOCOL_LABELS: Record<ProbeProtocol, string> = {
    OpenAiCompatible: "OpenAI",
    Ollama: "Ollama",
    GeminiOpenAiCompatible: "Gemini OpenAI",
    Anthropic: "Anthropic",
    Custom: "Custom",
};

const FILTER_OPTIONS = [
    { id: "all", label: "全部" },
    { id: "openai", label: "OpenAI兼容" },
    { id: "anthropic", label: "Anthropic" },
    { id: "ollama", label: "Ollama" },
    { id: "local", label: "本地" },
] as const;

function emptyCredential(sortOrder: number): ProbeCredentialPayload {
    return {
        id: crypto.randomUUID(),
        name: "新 API",
        provider: "Custom",
        protocol: "OpenAiCompatible",
        base_url: "",
        default_model: "",
        discovered_models: [],
        model_catalog_updated_at_ms: null,
        note: "",
        tags: [],
        enabled: true,
        sort_order: sortOrder,
        api_key: "",
        input_price_per_million: null,
        output_price_per_million: null,
        price_unit: "1M tokens",
        price_currency: "USD",
        last_test_latency_ms: null,
    };
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
            return "可继续使用当前协议和地址。";
        case "OK_CONNECTED":
            return "接口基本可用，建议再检查默认模型或模型列表配置。";
        case "ERR_UNAUTHORIZED":
            return "优先检查 API Key、鉴权头和服务商要求。";
        case "ERR_NOT_FOUND":
            return "优先检查 Base URL 末尾路径和所选协议类型是否一致。";
        case "ERR_TIMEOUT":
            return "优先检查网络、超时设置或上游服务状态。";
        case "ERR_NETWORK":
            return "优先检查地址是否可达、DNS、代理和防火墙。";
        case "ERR_PROTOCOL_MISMATCH":
            return "优先核对协议类型、目标地址和服务商兼容性。";
        case "ERR_INVOKE_FAILED":
            return "前端调用没有拿到测试结果，请先检查本地命令执行错误。";
        default:
            return result.detail || "请结合返回详情继续检查。";
    }
}

function sortCredentials(credentials: ProbeCredentialPayload[]) {
    return [...credentials].sort((a, b) => a.sort_order - b.sort_order);
}

function formatProtocolBadge(protocol: ProbeProtocol) {
    return PROTOCOL_LABELS[protocol] || protocol;
}

function protocolSupportsRoute(kind: ProbeRouteKind, protocol: ProbeProtocol) {
    if (kind === "OpenAi") {
        return ["OpenAiCompatible", "GeminiOpenAiCompatible", "Custom"].includes(protocol);
    }
    return ["Anthropic", "Custom"].includes(protocol);
}

function latencyTone(latencyMs?: number | null, isFailure?: boolean) {
    if (isFailure) return "is-fail";
    if (typeof latencyMs !== "number") return "";
    if (latencyMs <= 120) return "is-fast";
    if (latencyMs <= 450) return "is-warn";
    return "is-fail";
}

export default function FlowProbeSources() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<ProbeConfigPayload | null>(null);
    const [dashboard, setDashboard] = useState<ProbeDashboardPayload | null>(null);
    const [selectedCredentialId, setSelectedCredentialId] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [filterId, setFilterId] = useState("all");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busyAction, setBusyAction] = useState("");
    const [credentialResult, setCredentialResult] = useState<ProbeResult | null>(null);
    const [credentialHealth, setCredentialHealth] = useState<Record<string, ProbeResult>>({});
    const [modelsLoadState, setModelsLoadState] = useState<Record<string, string>>({});
    const [showSecret, setShowSecret] = useState(false);
    const [modelSearchQuery, setModelSearchQuery] = useState("");
    const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [autoSaveError, setAutoSaveError] = useState("");
    const hasHydratedRef = useRef(false);
    const lastSavedSnapshotRef = useRef("");

    const loadData = async () => {
        setLoading(true);
        try {
            const probeConfig = await invoke<ProbeConfigPayload>("get_probe_config");
            const probeDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
            setConfig(probeConfig);
            setDashboard(probeDashboard);
            lastSavedSnapshotRef.current = JSON.stringify(probeConfig);
            hasHydratedRef.current = true;
            setAutoSaveState("saved");
            setAutoSaveError("");
            const fallbackId =
                selectedCredentialId && probeConfig.credentials.some((item) => item.id === selectedCredentialId)
                    ? selectedCredentialId
                    : sortCredentials(probeConfig.credentials)[0]?.id || "";
            setSelectedCredentialId(fallbackId);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData().catch(console.error);
    }, []);

    const credentials = useMemo(() => sortCredentials(config?.credentials || []), [config]);

    const selectedCredential = useMemo(
        () => credentials.find((credential) => credential.id === selectedCredentialId) || null,
        [credentials, selectedCredentialId]
    );

    const routeMap = useMemo(() => {
        const map = new Map<ProbeRouteKind, ProbeRoutePayload>();
        (config?.routes || []).forEach((route) => map.set(route.kind, route));
        return map;
    }, [config]);

    const selectedRouteKinds = useMemo(() => {
        if (!selectedCredential) return [];
        return (["OpenAi", "Anthropic"] as ProbeRouteKind[]).filter(
            (kind) => routeMap.get(kind)?.credential_id === selectedCredential.id
        );
    }, [routeMap, selectedCredential]);

    const filteredCredentials = useMemo(() => {
        return credentials.filter((credential) => {
            const haystack = `${credential.name} ${credential.provider} ${credential.default_model} ${credential.tags.join(" ")}`.toLowerCase();
            if (searchQuery && !haystack.includes(searchQuery.toLowerCase())) {
                return false;
            }
            if (filterId === "all") return true;
            if (filterId === "openai") {
                return ["OpenAiCompatible", "GeminiOpenAiCompatible", "Custom"].includes(credential.protocol);
            }
            if (filterId === "anthropic") {
                return credential.protocol === "Anthropic";
            }
            if (filterId === "ollama") {
                return credential.protocol === "Ollama";
            }
            if (filterId === "local") {
                return credential.protocol === "Ollama" || credential.tags.includes("local") || credential.tags.includes("private");
            }
            return true;
        });
    }, [credentials, filterId, searchQuery]);

    const persistConfig = async (
        next: ProbeConfigPayload,
        actionLabel = "save",
        options?: { background?: boolean; refreshDashboard?: boolean }
    ) => {
        const background = options?.background ?? false;
        const refreshDashboard = options?.refreshDashboard ?? true;
        if (background) {
            setAutoSaveState("saving");
            setAutoSaveError("");
        } else {
            setSaving(true);
            setBusyAction(actionLabel);
        }
        try {
            await invoke("save_probe_config", { payload: next });
            lastSavedSnapshotRef.current = JSON.stringify(next);
            if (refreshDashboard) {
                const probeDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
                setDashboard(probeDashboard);
            }
            if (background) {
                setAutoSaveState("saved");
            }
        } finally {
            if (!background) {
                setSaving(false);
                setBusyAction("");
            }
        }
    };

    useEffect(() => {
        if (!config || !hasHydratedRef.current) return;
        const snapshot = JSON.stringify(config);
        if (snapshot === lastSavedSnapshotRef.current) return;
        setAutoSaveState("saving");
        setAutoSaveError("");
        const timer = window.setTimeout(() => {
            persistConfig(config, "autosave", { background: true, refreshDashboard: false }).catch((error) => {
                setAutoSaveState("error");
                setAutoSaveError(error instanceof Error ? error.message : String(error || "自动保存失败"));
            });
        }, 500);
        return () => window.clearTimeout(timer);
    }, [config]);

    const copyText = async (value: string) => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // Ignore clipboard failures on unsupported contexts.
        }
    };

    const updateSelectedCredential = (patch: Partial<ProbeCredentialPayload>) => {
        if (!config || !selectedCredential) return;
        const nextCredentials = config.credentials.map((credential) =>
            credential.id === selectedCredential.id ? { ...credential, ...patch } : credential
        );
        setConfig({ ...config, credentials: nextCredentials });
    };

    const addCredential = () => {
        if (!config) return;
        const next = emptyCredential(config.credentials.length + 1);
        setConfig({
            ...config,
            credentials: [...config.credentials, next],
        });
        setSelectedCredentialId(next.id);
        setCredentialResult(null);
        setModelSearchQuery("");
        setShowSecret(false);
    };

    const deleteCredential = async (credentialId: string) => {
        if (!config) return;
        const nextRoutes = config.routes.map((route) =>
            route.credential_id === credentialId ? { ...route, credential_id: "" } : route
        );
        const nextCredentials = config.credentials
            .filter((credential) => credential.id !== credentialId)
            .map((credential, index) => ({ ...credential, sort_order: index + 1 }));
        const nextConfig = {
            ...config,
            credentials: nextCredentials,
            routes: nextRoutes,
        };
        setSelectedCredentialId(nextCredentials[0]?.id || "");
        setCredentialResult(null);
        setConfig(nextConfig);
        await persistConfig(nextConfig, "delete-credential");
    };

    const runCredentialTest = async () => {
        if (!selectedCredential) return;
        setBusyAction("test-credential");
        try {
            const result = await invoke<ProbeResult>("test_probe_credential", {
                credential: selectedCredential,
            });
            setCredentialResult(result);
            setCredentialHealth((prev) => ({ ...prev, [selectedCredential.id]: result }));
            if (config) {
                setConfig({
                    ...config,
                    credentials: config.credentials.map((credential) =>
                        credential.id === selectedCredential.id
                            ? { ...credential, last_test_latency_ms: result.latency_ms ?? null }
                            : credential
                    ),
                });
            }
        } catch (error) {
            const result = createInvokeErrorResult(error);
            setCredentialResult(result);
            setCredentialHealth((prev) => ({ ...prev, [selectedCredential.id]: result }));
            if (config) {
                setConfig({
                    ...config,
                    credentials: config.credentials.map((credential) =>
                        credential.id === selectedCredential.id
                            ? { ...credential, last_test_latency_ms: null }
                            : credential
                    ),
                });
            }
        } finally {
            setBusyAction("");
        }
    };

    const fetchCredentialModels = async () => {
        if (!selectedCredential || !config) return;
        setBusyAction("models-credential");
        setModelsLoadState((prev) => ({ ...prev, [selectedCredential.id]: "loading" }));
        try {
            const models = await invoke<string[]>("list_probe_credential_models", {
                credential: selectedCredential,
            });
            setModelsLoadState((prev) => ({ ...prev, [selectedCredential.id]: "ready" }));
            setConfig({
                ...config,
                credentials: config.credentials.map((credential) =>
                    credential.id === selectedCredential.id
                        ? {
                            ...credential,
                            discovered_models: models,
                            model_catalog_updated_at_ms: Date.now(),
                            default_model: credential.default_model || models[0] || "",
                        }
                        : credential
                ),
            });
        } catch {
            setModelsLoadState((prev) => ({ ...prev, [selectedCredential.id]: "error" }));
        } finally {
            setBusyAction("");
        }
    };

    const assignRouteTarget = (kind: ProbeRouteKind) => {
        if (!config || !selectedCredential) return;
        setConfig({
            ...config,
            routes: config.routes.map((route) =>
                route.kind === kind ? { ...route, credential_id: selectedCredential.id } : route
            ),
        });
    };

    const selectedModels = selectedCredential ? selectedCredential.discovered_models || [] : [];
    const modelsState = selectedCredential ? modelsLoadState[selectedCredential.id] || "" : "";
    const filteredModels = useMemo(() => {
        if (!modelSearchQuery.trim()) return selectedModels;
        const needle = modelSearchQuery.trim().toLowerCase();
        return selectedModels.filter((model) => model.toLowerCase().includes(needle));
    }, [modelSearchQuery, selectedModels]);

    const diagnosticLines = useMemo(() => {
        if (!selectedCredential) return [];
        if (!credentialResult) {
            return [
                `等待测试 ${selectedCredential.name}`,
                "点击“测试 API”后，这里会显示连通性、鉴权和协议诊断。",
            ];
        }
        const lines = [
            `probe credential="${selectedCredential.name}" protocol="${formatProtocolBadge(selectedCredential.protocol)}"`,
            `base_url ${selectedCredential.base_url || "(empty)"}`,
            `result ${credentialResult.code} auth=${credentialResult.auth_status || "unknown"} protocol=${credentialResult.detected_protocol || "unknown"}`,
        ];
        if (typeof credentialResult.latency_ms === "number") {
            lines.push(`latency ${credentialResult.latency_ms}ms models=${credentialResult.model_count ?? "-"}`);
        }
        if (credentialResult.detail || credentialResult.summary) {
            lines.push(credentialResult.detail || credentialResult.summary);
        }
        return lines;
    }, [credentialResult, selectedCredential]);

    if (loading || !config || !dashboard) {
        return (
            <div className="flowprobe-page flowprobe-page--loading">
                <Loader2 size={20} className="flowprobe-spin" />
                <span>FlowProbe 正在加载...</span>
            </div>
        );
    }

    return (
        <div className="flowprobe-page flowprobe-page--sources">
            <div className="flowprobe-header">
                <div className="flowprobe-title-group">
                    <h1 className="flowprobe-title">
                        <Database size={22} color="var(--color-primary)" />
                        {t("flowprobe_sources.title")}
                    </h1>
                    <p className="flowprobe-subtitle">{t("flowprobe_sources.subtitle")}</p>
                </div>
                <div className="flowprobe-header-actions">
                    <span className={`flowprobe-save-indicator is-${autoSaveState}`}>
                        {autoSaveState === "saving" ? "自动保存中" : autoSaveState === "error" ? "自动保存失败" : "已自动保存"}
                    </span>
                    <button className="flowprobe-button flowprobe-button--secondary" onClick={() => loadData()}>
                        <RefreshCw size={15} />
                        重新读取
                    </button>
                </div>
            </div>

            {autoSaveError && (
                <div className="flowprobe-banner flowprobe-banner--danger">{autoSaveError}</div>
            )}

            {dashboard.status.last_error && (
                <div className="flowprobe-banner flowprobe-banner--danger">{dashboard.status.last_error}</div>
            )}

            <div className="flowprobe-shell flowprobe-shell--sources">
                <section className="flowprobe-panel flowprobe-panel--sources-list">
                    <div className="flowprobe-panel-header">
                        <div>
                            <h2>接入 API 列表</h2>
                        </div>
                        <button className="flowprobe-button flowprobe-button--primary" onClick={addCredential}>
                            <Plus size={14} />
                            新增 API
                        </button>
                    </div>

                    <div className="flowprobe-list-toolbar">
                        <div className="flowprobe-search">
                            <Search size={14} />
                            <input
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="搜索名称 / 标签 / 模型"
                            />
                        </div>
                        <div className="flowprobe-filter-select">
                            <select value={filterId} onChange={(event) => setFilterId(event.target.value)}>
                                {FILTER_OPTIONS.map((filter) => (
                                    <option key={filter.id} value={filter.id}>{filter.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flowprobe-credential-list">
                        {filteredCredentials.map((credential) => {
                            const usedBy = (["OpenAi", "Anthropic"] as ProbeRouteKind[]).filter(
                                (kind) => routeMap.get(kind)?.credential_id === credential.id
                            );
                            const displayTag = credential.tags.find((tag) => tag.trim().length > 0) || "";
                            return (
                                <button
                                    key={credential.id}
                                    className={`flowprobe-credential-item ${selectedCredentialId === credential.id ? "is-active" : ""}`}
                                    onClick={() => {
                                        setSelectedCredentialId(credential.id);
                                        setCredentialResult(null);
                                        setModelSearchQuery("");
                                        setShowSecret(false);
                                    }}
                                >
                                    <div className="flowprobe-credential-row">
                                        <div className="flowprobe-credential-name">
                                            <span
                                                className={`flowprobe-dot ${
                                                    credentialHealth[credential.id]
                                                        ? credentialHealth[credential.id].success ? "is-on" : "is-off"
                                                        : credential.enabled ? "is-on" : "is-off"
                                                }`}
                                            />
                                            <span className="flowprobe-credential-row__title">{credential.name}</span>
                                        </div>
                                        <span className={`flowprobe-credential-row__latency flowprobe-latency-value ${latencyTone(credential.last_test_latency_ms, credentialHealth[credential.id] ? !credentialHealth[credential.id].success : false)}`}>
                                            {typeof credential.last_test_latency_ms === "number"
                                                ? `${credential.last_test_latency_ms} ms`
                                                : "未探测"}
                                        </span>
                                        <span className={`flowprobe-protocol-badge ${usedBy.length > 0 ? "is-active" : ""}`}>
                                            {formatProtocolBadge(credential.protocol)}
                                        </span>
                                    </div>
                                    <div className="flowprobe-credential-row flowprobe-credential-row--meta">
                                        <span>{credential.provider || "未填写服务商"}</span>
                                        <span className="flowprobe-credential-row__model">{credential.default_model || "未设默认模型"}</span>
                                        <span className="flowprobe-credential-row__routes">
                                            {displayTag}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="flowprobe-panel flowprobe-panel--center flowprobe-panel--sources-workspace">
                    {selectedCredential ? (
                        <div className="flowprobe-sources-workspace">
                            <div className="flowprobe-sources-top-row">
                                <div className="flowprobe-editor flowprobe-editor--sources">
                                    <div className="flowprobe-panel-header flowprobe-panel-header--tight">
                                        <div>
                                            <h3>API 详情</h3>
                                        </div>
                                        <div className="flowprobe-route-actions flowprobe-route-actions--inline">
                                            <span className={`flowprobe-chip flowprobe-chip--status ${selectedCredential.enabled ? "is-active" : ""}`}>
                                                {selectedCredential.enabled ? "已启用" : "未启用"}
                                            </span>
                                            <button className="flowprobe-icon-button flowprobe-icon-button--danger" onClick={() => deleteCredential(selectedCredential.id)}>
                                                {saving && busyAction === "delete-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <Trash2 size={14} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flowprobe-form-grid flowprobe-form-grid--sources">
                                        <label>
                                            <span>名称</span>
                                            <input value={selectedCredential.name} onChange={(event) => updateSelectedCredential({ name: event.target.value })} />
                                        </label>
                                        <label>
                                            <span>服务商</span>
                                            <input value={selectedCredential.provider} onChange={(event) => updateSelectedCredential({ provider: event.target.value })} />
                                        </label>
                                        <label className="is-wide">
                                            <span>Base URL</span>
                                            <div className="flowprobe-inline-input-row flowprobe-inline-input-row--boxed">
                                                <input value={selectedCredential.base_url} onChange={(event) => updateSelectedCredential({ base_url: event.target.value })} />
                                                <button className="flowprobe-icon-button" onClick={() => copyText(selectedCredential.base_url)} title="复制 Base URL">
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                        </label>
                                        <label>
                                            <span>协议</span>
                                            <select value={selectedCredential.protocol} onChange={(event) => updateSelectedCredential({ protocol: event.target.value as ProbeProtocol })}>
                                                {Object.entries(PROTOCOL_LABELS).map(([value, label]) => (
                                                    <option key={value} value={value}>{label}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label>
                                            <span>默认模型</span>
                                            <div className="flowprobe-inline-input-row flowprobe-inline-input-row--boxed">
                                                <input value={selectedCredential.default_model} onChange={(event) => updateSelectedCredential({ default_model: event.target.value })} />
                                                <button className="flowprobe-icon-button" onClick={() => copyText(selectedCredential.default_model)} title="复制默认模型">
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                        </label>
                                        <label className="is-wide">
                                            <span>API Key / Secret</span>
                                            <div className="flowprobe-inline-input-row flowprobe-inline-input-row--boxed">
                                                <input
                                                    type={showSecret ? "text" : "password"}
                                                    value={selectedCredential.api_key}
                                                    onChange={(event) => updateSelectedCredential({ api_key: event.target.value })}
                                                    placeholder="sk-..."
                                                />
                                                <button className="flowprobe-icon-button" onClick={() => setShowSecret((prev) => !prev)} title={showSecret ? "隐藏密钥" : "显示密钥"}>
                                                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                                <button className="flowprobe-icon-button" onClick={() => copyText(selectedCredential.api_key)} title="复制密钥">
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                        </label>
                                        <label className="is-wide">
                                            <span>备注</span>
                                            <input value={selectedCredential.note} onChange={(event) => updateSelectedCredential({ note: event.target.value })} />
                                        </label>
                                        <label className="is-wide">
                                            <span>标签（逗号分隔）</span>
                                            <input
                                                value={selectedCredential.tags.join(", ")}
                                                onChange={(event) =>
                                                    updateSelectedCredential({
                                                        tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>

                                    <div className="flowprobe-sources-route-row">
                                        <button
                                            className={`flowprobe-chip ${selectedRouteKinds.includes("OpenAi") ? "is-active" : ""}`}
                                            disabled={!protocolSupportsRoute("OpenAi", selectedCredential.protocol)}
                                            onClick={() => assignRouteTarget("OpenAi")}
                                        >
                                            <ArrowRightLeft size={12} />
                                            设为 OpenAI 目标
                                        </button>
                                        <button
                                            className={`flowprobe-chip ${selectedRouteKinds.includes("Anthropic") ? "is-active" : ""}`}
                                            disabled={!protocolSupportsRoute("Anthropic", selectedCredential.protocol)}
                                            onClick={() => assignRouteTarget("Anthropic")}
                                        >
                                            <ArrowRightLeft size={12} />
                                            设为 Anthropic 目标
                                        </button>
                                        <button className="flowprobe-button flowprobe-button--secondary" onClick={runCredentialTest}>
                                            {busyAction === "test-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <RefreshCw size={14} />}
                                            测试 API
                                        </button>
                                        <button className="flowprobe-button flowprobe-button--secondary" onClick={fetchCredentialModels}>
                                            {busyAction === "models-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <ServerCog size={14} />}
                                            拉取模型
                                        </button>
                                    </div>

                                </div>

                                <section className="flowprobe-panel flowprobe-panel--subsection flowprobe-panel--sources-models">
                                    <div className="flowprobe-panel-header flowprobe-panel-header--tight">
                                        <div>
                                            <h3>模型池</h3>
                                        </div>
                                        <button className="flowprobe-icon-button" onClick={fetchCredentialModels}>
                                            {busyAction === "models-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <ServerCog size={14} />}
                                        </button>
                                    </div>

                                    <div className="flowprobe-search flowprobe-search--compact">
                                        <Search size={14} />
                                        <input
                                            value={modelSearchQuery}
                                            onChange={(event) => setModelSearchQuery(event.target.value)}
                                            placeholder="搜索模型名"
                                        />
                                    </div>

                                    <div className="flowprobe-model-chip-list">
                                        {filteredModels.length > 0 ? (
                                            filteredModels.map((model) => (
                                                <button
                                                    key={`${selectedCredential.id}:${model}`}
                                                    className={`flowprobe-model-chip ${selectedCredential.default_model === model ? "is-active" : ""}`}
                                                    onClick={() => updateSelectedCredential({ default_model: model })}
                                                    title={model}
                                                >
                                                    {model}
                                                </button>
                                            ))
                                        ) : (
                                            <div className="flowprobe-empty-state flowprobe-empty-state--inline">
                                                <strong>{modelsState === "error" ? "模型拉取失败" : selectedModels.length > 0 ? "没有匹配模型" : "还没有模型列表"}</strong>
                                                <p>
                                                    {modelsState === "loading"
                                                        ? "正在从当前 API 拉取模型列表。"
                                                        : selectedModels.length > 0
                                                            ? "换个关键词，或者直接从列表中点击一个模型。"
                                                            : "点击“拉取模型”后，这里会出现当前 API 返回的模型池。"}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>

                            <div className="flowprobe-sources-bottom-row">
                                <section className="flowprobe-panel flowprobe-panel--subsection flowprobe-panel--sources-logs">
                                    <div className="flowprobe-panel-header flowprobe-panel-header--tight">
                                        <div>
                                            <h3>诊断日志</h3>
                                        </div>
                                    </div>

                                    {credentialResult ? (
                                        <div className={`flowprobe-result ${credentialResult.success ? "is-success" : "is-error"}`}>
                                            <div className="flowprobe-result-head">
                                                <strong>{credentialResult.code}</strong>
                                                <span>{resultSummaryZh(credentialResult)}</span>
                                                {typeof credentialResult.latency_ms === "number" && <em>{credentialResult.latency_ms} ms</em>}
                                            </div>
                                            <div className="flowprobe-result-body">
                                                <div className="flowprobe-detail-list">
                                                    <div><span>中文</span><strong>{resultSummaryZh(credentialResult)}</strong></div>
                                                    <div><span>结论</span><strong>{resultConclusionZh(credentialResult)}</strong></div>
                                                    <div><span>认证状态</span><strong>{credentialResult.auth_status || "-"}</strong></div>
                                                    <div><span>识别协议</span><strong>{credentialResult.detected_protocol || "-"}</strong></div>
                                                    <div><span>模型数量</span><strong>{credentialResult.model_count ?? "-"}</strong></div>
                                                    <div><span>状态码</span><strong>{credentialResult.code || "-"}</strong></div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flowprobe-empty-state flowprobe-empty-state--inline">
                                            <strong>{typeof selectedCredential.last_test_latency_ms === "number" ? `最近一次探测：${selectedCredential.last_test_latency_ms} ms` : "还没有测试结果"}</strong>
                                            <p>{typeof selectedCredential.last_test_latency_ms === "number" ? "当前会话还没有新的测试结果。" : "先测试，再决定是改地址、改协议还是改密钥。"}</p>
                                        </div>
                                    )}

                                    <div className="flowprobe-source-log-stream">
                                        {diagnosticLines.map((line, index) => (
                                            <div key={`${selectedCredential.id}-diag-${index}`} className="flowprobe-source-log-line">
                                                <span>$</span>
                                                <code>{line}</code>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        </div>
                    ) : (
                        <div className="flowprobe-empty-state">
                            <strong>暂无 API</strong>
                            <p>新增一个上游 API 后，这里会显示它的完整配置。</p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
