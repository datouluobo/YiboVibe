import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
    ArrowRightLeft,
    Database,
    ListFilter,
    Loader2,
    Plus,
    RefreshCw,
    Save,
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
    OpenAiCompatible: "OpenAI Compatible",
    Ollama: "Ollama",
    GeminiOpenAiCompatible: "Gemini OpenAI",
    Anthropic: "Anthropic",
    Custom: "Custom",
};

const FILTERS = [
    { id: "all", label: "全部" },
    { id: "openai", label: "OpenAI兼容" },
    { id: "anthropic", label: "Anthropic" },
    { id: "ollama", label: "Ollama" },
    { id: "local", label: "本地" },
];

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
    };
}

function parseNonNegativeNumber(value: string) {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, parsed);
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

function routeLabel(kind: ProbeRouteKind) {
    return kind === "OpenAi" ? "OpenAI 目标" : "Anthropic 目标";
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
    const [modelsLoadState, setModelsLoadState] = useState<Record<string, string>>({});

    const loadData = async () => {
        setLoading(true);
        try {
            const probeConfig = await invoke<ProbeConfigPayload>("get_probe_config");
            const probeDashboard = await invoke<ProbeDashboardPayload>("get_probe_dashboard");
            setConfig(probeConfig);
            setDashboard(probeDashboard);
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
            const haystack = `${credential.name} ${credential.provider} ${credential.note} ${credential.default_model} ${credential.tags.join(" ")}`.toLowerCase();
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

    const updateSelectedCredential = (patch: Partial<ProbeCredentialPayload>) => {
        if (!config || !selectedCredential) return;
        const nextCredentials = config.credentials.map((credential) =>
            credential.id === selectedCredential.id ? { ...credential, ...patch } : credential
        );
        setConfig({ ...config, credentials: nextCredentials });
    };

    const saveSelectedCredential = async () => {
        if (!config) return;
        await persistConfig(
            {
                ...config,
                credentials: sortCredentials(config.credentials).map((credential, index) => ({
                    ...credential,
                    sort_order: index + 1,
                })),
            },
            "save-credential"
        );
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
        } catch (error) {
            setCredentialResult(createInvokeErrorResult(error));
        } finally {
            setBusyAction("");
        }
    };

    const fetchCredentialModels = async () => {
        if (!selectedCredential) return;
        setBusyAction("models-credential");
        setModelsLoadState((prev) => ({ ...prev, [selectedCredential.id]: "loading" }));
        try {
            const models = await invoke<string[]>("list_probe_credential_models", {
                credential: selectedCredential,
            });
            setModelsLoadState((prev) => ({ ...prev, [selectedCredential.id]: "ready" }));
            const nextConfig: ProbeConfigPayload = {
                ...config!,
                credentials: config!.credentials.map((credential) =>
                    credential.id === selectedCredential.id
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
            await persistConfig(nextConfig, "models-credential");
        } catch {
            setModelsLoadState((prev) => ({ ...prev, [selectedCredential.id]: "error" }));
        } finally {
            setBusyAction("");
        }
    };

    const assignRouteTarget = async (kind: ProbeRouteKind) => {
        if (!config || !selectedCredential) return;
        const nextConfig = {
            ...config,
            routes: config.routes.map((route) =>
                route.kind === kind ? { ...route, credential_id: selectedCredential.id } : route
            ),
        };
        await persistConfig(nextConfig, `switch-${kind}`);
    };

    const selectedModels = selectedCredential ? selectedCredential.discovered_models || [] : [];
    const modelsState = selectedCredential ? modelsLoadState[selectedCredential.id] || "" : "";

    if (loading || !config || !dashboard) {
        return (
            <div className="flowprobe-page flowprobe-page--loading">
                <Loader2 size={20} className="flowprobe-spin" />
                <span>FlowProbe 正在加载...</span>
            </div>
        );
    }

    return (
        <div className="flowprobe-page">
            <div className="flowprobe-header">
                <div className="flowprobe-title-group">
                    <h1 className="flowprobe-title">
                        <Database size={22} color="var(--color-primary)" />
                        {t("flowprobe_sources.title")}
                    </h1>
                    <p className="flowprobe-subtitle">{t("flowprobe_sources.subtitle")}</p>
                </div>
                <div className="flowprobe-header-actions">
                    <button className="flowprobe-button flowprobe-button--secondary" onClick={() => loadData()}>
                        <RefreshCw size={15} />
                        刷新
                    </button>
                    <button className="flowprobe-button flowprobe-button--primary" onClick={saveSelectedCredential} disabled={saving || !selectedCredential}>
                        {saving && busyAction === "save-credential" ? <Loader2 size={15} className="flowprobe-spin" /> : <Save size={15} />}
                        保存当前 API
                    </button>
                </div>
            </div>

            {dashboard.status.last_error && (
                <div className="flowprobe-banner flowprobe-banner--danger">{dashboard.status.last_error}</div>
            )}

            <div className="flowprobe-shell flowprobe-shell--sources">
                <section className="flowprobe-panel">
                    <div className="flowprobe-panel-header">
                        <div>
                            <h2>接入 API 列表</h2>
                            <p>记录所有可用上游 API、协议、默认模型和摘要标签。</p>
                        </div>
                        <button className="flowprobe-icon-button" onClick={addCredential}>
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="flowprobe-search">
                        <Search size={14} />
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="搜索名称 / 标签 / 备注 / 模型"
                        />
                    </div>

                    <div className="flowprobe-filter-row">
                        {FILTERS.map((filter) => (
                            <button
                                key={filter.id}
                                className={`flowprobe-chip ${filterId === filter.id ? "is-active" : ""}`}
                                onClick={() => setFilterId(filter.id)}
                            >
                                <ListFilter size={12} />
                                {filter.label}
                            </button>
                        ))}
                    </div>

                    <div className="flowprobe-credential-list">
                        {filteredCredentials.map((credential) => {
                            const usedBy = (["OpenAi", "Anthropic"] as ProbeRouteKind[]).filter(
                                (kind) => routeMap.get(kind)?.credential_id === credential.id
                            );
                            return (
                                <button
                                    key={credential.id}
                                    className={`flowprobe-credential-item ${selectedCredentialId === credential.id ? "is-active" : ""}`}
                                    onClick={() => {
                                        setSelectedCredentialId(credential.id);
                                        setCredentialResult(null);
                                    }}
                                >
                                    <div className="flowprobe-credential-top">
                                        <div className="flowprobe-credential-name">
                                            <span className={`flowprobe-dot ${credential.enabled ? "is-on" : "is-off"}`} />
                                            {credential.name}
                                        </div>
                                        <span className="flowprobe-protocol-badge">{formatProtocolBadge(credential.protocol)}</span>
                                    </div>
                                    <div className="flowprobe-credential-meta">
                                        <span>{credential.provider || "未填写服务商"}</span>
                                        <span>{credential.default_model || "未设默认模型"}</span>
                                    </div>
                                    <div className="flowprobe-credential-tags">
                                        {usedBy.map((kind) => (
                                            <span key={kind} className="flowprobe-tag flowprobe-tag--active">{routeLabel(kind)}</span>
                                        ))}
                                        {credential.tags.slice(0, 3).map((tag) => (
                                            <span key={tag} className="flowprobe-tag">{tag}</span>
                                        ))}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="flowprobe-panel flowprobe-panel--center">
                    {selectedCredential ? (
                        <div className="flowprobe-editor">
                            <div className="flowprobe-panel-header flowprobe-panel-header--tight">
                                <div>
                                    <h3>API 详情</h3>
                                    <p>点左侧列表项后，这里的配置会随之切换。</p>
                                </div>
                                <button className="flowprobe-icon-button flowprobe-icon-button--danger" onClick={() => deleteCredential(selectedCredential.id)}>
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            <div className="flowprobe-form-grid">
                                <label>
                                    <span>名称</span>
                                    <input value={selectedCredential.name} onChange={(event) => updateSelectedCredential({ name: event.target.value })} />
                                </label>
                                <label>
                                    <span>服务商</span>
                                    <input value={selectedCredential.provider} onChange={(event) => updateSelectedCredential({ provider: event.target.value })} />
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
                                    <input value={selectedCredential.default_model} onChange={(event) => updateSelectedCredential({ default_model: event.target.value })} />
                                </label>
                                <label className="is-wide">
                                    <span>Base URL</span>
                                    <input value={selectedCredential.base_url} onChange={(event) => updateSelectedCredential({ base_url: event.target.value })} />
                                </label>
                                <label className="is-wide">
                                    <span>API Key / Secret</span>
                                    <input value={selectedCredential.api_key} onChange={(event) => updateSelectedCredential({ api_key: event.target.value })} />
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
                                <label>
                                    <span>输入价格</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.000001"
                                        value={selectedCredential.input_price_per_million ?? ""}
                                        onChange={(event) =>
                                            updateSelectedCredential({
                                                input_price_per_million: parseNonNegativeNumber(event.target.value),
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    <span>输出价格</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.000001"
                                        value={selectedCredential.output_price_per_million ?? ""}
                                        onChange={(event) =>
                                            updateSelectedCredential({
                                                output_price_per_million: parseNonNegativeNumber(event.target.value),
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    <span>计价单位</span>
                                    <input
                                        value={selectedCredential.price_unit}
                                        placeholder="1M tokens"
                                        onChange={(event) => updateSelectedCredential({ price_unit: event.target.value })}
                                    />
                                </label>
                                <label>
                                    <span>计价币种</span>
                                    <input
                                        value={selectedCredential.price_currency}
                                        placeholder="USD"
                                        onChange={(event) => updateSelectedCredential({ price_currency: event.target.value.toUpperCase() })}
                                    />
                                </label>
                            </div>

                            <div className="flowprobe-editor-actions flowprobe-editor-actions--sources">
                                <button className="flowprobe-button flowprobe-button--secondary" onClick={runCredentialTest}>
                                    {busyAction === "test-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <RefreshCw size={14} />}
                                    测试 API
                                </button>
                                <button className="flowprobe-button flowprobe-button--secondary" onClick={fetchCredentialModels}>
                                    {busyAction === "models-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <ServerCog size={14} />}
                                    拉取模型
                                </button>
                                <button
                                    className="flowprobe-button flowprobe-button--secondary"
                                    disabled={!protocolSupportsRoute("OpenAi", selectedCredential.protocol)}
                                    onClick={() => assignRouteTarget("OpenAi")}
                                >
                                    <ArrowRightLeft size={14} />
                                    设为 OpenAI 目标
                                </button>
                                <button
                                    className="flowprobe-button flowprobe-button--secondary"
                                    disabled={!protocolSupportsRoute("Anthropic", selectedCredential.protocol)}
                                    onClick={() => assignRouteTarget("Anthropic")}
                                >
                                    <ArrowRightLeft size={14} />
                                    设为 Anthropic 目标
                                </button>
                                <button className="flowprobe-button flowprobe-button--primary" onClick={saveSelectedCredential}>
                                    {saving && busyAction === "save-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <Save size={14} />}
                                    保存
                                </button>
                            </div>

                        </div>
                    ) : (
                        <div className="flowprobe-empty-state">
                            <strong>暂无 API</strong>
                            <p>新增一个上游 API 后，这里会显示它的完整配置。</p>
                        </div>
                    )}
                </section>

                <section className="flowprobe-panel">
                    <div className="flowprobe-panel-header">
                        <div>
                            <h2>验证与模型</h2>
                            <p>这里始终展示当前选中 API 的验证结果和可用模型。</p>
                        </div>
                    </div>

                    {selectedCredential ? (
                        <>
                            <div className="flowprobe-metrics flowprobe-metrics--single">
                                <div className="flowprobe-metric-card">
                                    <span>来源</span>
                                    <strong>{selectedCredential.name}</strong>
                                </div>
                                <div className="flowprobe-metric-card">
                                    <span>服务商 / 协议</span>
                                    <strong>{selectedCredential.provider || "未填写"} / {formatProtocolBadge(selectedCredential.protocol)}</strong>
                                </div>
                                <div className="flowprobe-metric-card">
                                    <span>当前绑定</span>
                                    <strong>{selectedRouteKinds.length ? selectedRouteKinds.map(routeLabel).join(" · ") : "未用于转发"}</strong>
                                </div>
                                <div className="flowprobe-metric-card">
                                    <span>模型来源</span>
                                    <strong>{selectedModels.length ? `${selectedModels.length} 个模型来自当前 API` : "尚未拉取"}</strong>
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
                                            <div><span>代码 / 代号</span><strong>{credentialResult.code || "-"}</strong></div>
                                            <div><span>中文</span><strong>{resultSummaryZh(credentialResult)}</strong></div>
                                            <div><span>结论</span><strong>{resultConclusionZh(credentialResult)}</strong></div>
                                            <div><span>认证状态</span><strong>{credentialResult.auth_status || "-"}</strong></div>
                                            <div><span>识别协议</span><strong>{credentialResult.detected_protocol || "-"}</strong></div>
                                            <div><span>模型数量</span><strong>{credentialResult.model_count ?? "-"}</strong></div>
                                        </div>
                                        <div>{credentialResult.detail || credentialResult.summary}</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flowprobe-empty-state flowprobe-empty-state--inline">
                                    <strong>还没有测试结果</strong>
                                    <p>点击“测试 API”后，这里会显示连通状态、认证结果和响应摘要。</p>
                                </div>
                            )}

                            <div className="flowprobe-panel-header flowprobe-panel-header--tight">
                                <div>
                                    <h3>可用模型</h3>
                                    <p>当前列表只显示这个 API 拉回来的模型，不跨来源混排。</p>
                                </div>
                                <button className="flowprobe-icon-button" onClick={fetchCredentialModels}>
                                    {busyAction === "models-credential" ? <Loader2 size={14} className="flowprobe-spin" /> : <ServerCog size={14} />}
                                </button>
                            </div>

                            <div className="flowprobe-model-list">
                                {selectedModels.length > 0 ? (
                                    selectedModels.map((model) => (
                                        <button
                                            key={`${selectedCredential.id}:${model}`}
                                            className={`flowprobe-model-item ${selectedCredential.default_model === model ? "is-active" : ""}`}
                                            onClick={() => updateSelectedCredential({ default_model: model })}
                                        >
                                            <div className="flowprobe-model-name">{model}</div>
                                            <div className="flowprobe-model-meta">
                                                <span>{selectedCredential.name}</span>
                                                <span>{selectedCredential.provider || formatProtocolBadge(selectedCredential.protocol)}</span>
                                                {selectedCredential.default_model === model && <span className="flowprobe-tag flowprobe-tag--active">默认模型</span>}
                                            </div>
                                        </button>
                                    ))
                                ) : (
                                    <div className="flowprobe-empty-state flowprobe-empty-state--inline">
                                        <strong>{modelsState === "error" ? "模型拉取失败" : "还没有模型列表"}</strong>
                                        <p>
                                            {modelsState === "loading"
                                                ? "正在从当前 API 拉取模型列表。"
                                                : "点击“拉取模型”后，这里会显示当前 API 返回的模型。"}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flowprobe-empty-state">
                            <strong>没有选中的 API</strong>
                            <p>从左侧列表选择一个 API 后，这里会同步显示它的验证结果和模型。</p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
