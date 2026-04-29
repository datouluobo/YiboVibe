import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Reorder, useDragControls } from "framer-motion";
import {
    Activity,
    ChevronDown,
    GripVertical,
    Plus,
    RefreshCw,
    Trash2,
} from "lucide-react";

type ProbeProtocol =
    | "OpenAiCompatible"
    | "Ollama"
    | "GeminiOpenAiCompatible"
    | "Anthropic"
    | "Custom";

interface ProbeTargetPayload {
    id: string;
    name: string;
    protocol: ProbeProtocol;
    base_url: string;
    model: string;
    is_enabled: boolean;
    order: number;
    api_key: string;
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

const PROTOCOL_OPTIONS: { value: ProbeProtocol; label: string }[] = [
    { value: "OpenAiCompatible", label: "OpenAI Compatible" },
    { value: "Ollama", label: "Ollama" },
    { value: "GeminiOpenAiCompatible", label: "Gemini (OpenAI Compatible)" },
    { value: "Anthropic", label: "Anthropic" },
    { value: "Custom", label: "Custom / Auto Detect" },
];

const PRESETS: Array<{
    key: string;
    name: string;
    protocol: ProbeProtocol;
    base_url: string;
    model: string;
}> = [
    {
        key: "ollama-local",
        name: "Local Ollama",
        protocol: "Ollama",
        base_url: "http://127.0.0.1:11434",
        model: "",
    },
    {
        key: "ollama-nas",
        name: "NAS Ollama",
        protocol: "Ollama",
        base_url: "http://192.168.1.88:11434",
        model: "",
    },
    {
        key: "deepseek",
        name: "DeepSeek API",
        protocol: "OpenAiCompatible",
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
    },
    {
        key: "gemini-openai",
        name: "Gemini OpenAI Gateway",
        protocol: "GeminiOpenAiCompatible",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-2.5-flash",
    },
    {
        key: "anthropic",
        name: "Anthropic API",
        protocol: "Anthropic",
        base_url: "https://api.anthropic.com",
        model: "claude-sonnet-4-20250514",
    },
];

function defaultTarget(): ProbeTargetPayload {
    return {
        id: crypto.randomUUID(),
        name: "New Target",
        protocol: "OpenAiCompatible",
        base_url: "",
        model: "",
        is_enabled: true,
        order: Date.now(),
        api_key: "",
    };
}

function badgeColor(result?: ProbeResult | null) {
    if (!result) return { color: "var(--color-text-muted)", bg: "var(--color-surface)" };
    return result.success
        ? { color: "#22c55e", bg: "rgba(34,197,94,0.12)" }
        : { color: "#ef4444", bg: "rgba(239,68,68,0.12)" };
}

function ProbeTargetCard({
    target,
    result,
    models,
    loadingModels,
    openModelMenu,
    onUpdate,
    onDelete,
    onTest,
    onFetchModels,
    onToggleModelMenu,
}: {
    target: ProbeTargetPayload;
    result?: ProbeResult | null;
    models: string[];
    loadingModels: boolean;
    openModelMenu: boolean;
    onUpdate: (field: keyof ProbeTargetPayload, value: string | boolean | number) => void;
    onDelete: () => void;
    onTest: () => void;
    onFetchModels: () => void;
    onToggleModelMenu: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const dragControls = useDragControls();

    const inputStyle: React.CSSProperties = {
        padding: "7px 10px",
        borderRadius: "8px",
        background: "var(--color-bg-base)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-main)",
        fontSize: "12px",
        width: "100%",
        boxSizing: "border-box",
    };

    const resultTone = badgeColor(result);
    const mergedModels = useMemo(() => Array.from(new Set(models.filter(Boolean))), [models]);

    return (
        <Reorder.Item
            key={target.id}
            value={target}
            dragListener={false}
            dragControls={dragControls}
            style={{
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                opacity: target.is_enabled ? 1 : 0.65,
            }}
        >
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div
                    onPointerDown={(event) => dragControls.start(event)}
                    title={t("flowprobe.drag_sort")}
                    style={{
                        cursor: "grab",
                        color: "var(--color-text-muted)",
                        display: "flex",
                        alignItems: "center",
                        flexShrink: 0,
                    }}
                >
                    <GripVertical size={18} />
                </div>

                <input
                    type="checkbox"
                    checked={target.is_enabled}
                    onChange={(event) => onUpdate("is_enabled", event.target.checked)}
                    title={target.is_enabled ? t("flowprobe.status_enabled") : t("flowprobe.status_disabled")}
                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />

                <input
                    value={target.name}
                    onChange={(event) => onUpdate("name", event.target.value)}
                    placeholder={t("flowprobe.placeholder_name")}
                    style={{ ...inputStyle, width: "170px", flexShrink: 0 }}
                />

                <select
                    value={target.protocol}
                    onChange={(event) => onUpdate("protocol", event.target.value)}
                    style={{ ...inputStyle, width: "200px", flexShrink: 0 }}
                >
                    {PROTOCOL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>

                <input
                    value={target.base_url}
                    onChange={(event) => onUpdate("base_url", event.target.value)}
                    placeholder={t("flowprobe.placeholder_url")}
                    style={{ ...inputStyle, flex: "1 1 0", minWidth: "180px" }}
                />
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center", paddingLeft: "34px" }}>
                <input
                    value={target.model}
                    onChange={(event) => onUpdate("model", event.target.value)}
                    placeholder={t("flowprobe.placeholder_model")}
                    style={{ ...inputStyle, width: "220px", flexShrink: 0 }}
                    list={`probe-models-${target.id}`}
                />

                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                    <button
                        onClick={() => {
                            if (openModelMenu) {
                                onToggleModelMenu(false);
                            } else {
                                onFetchModels();
                            }
                        }}
                        className="btn-ghost"
                        style={{
                            height: "32px",
                            width: "32px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                        title={t("flowprobe.btn_fetch_models")}
                    >
                        {loadingModels ? <RefreshCw size={13} className="animate-spin" /> : <ChevronDown size={14} />}
                    </button>

                    {openModelMenu && (
                        <>
                            <div
                                style={{ position: "fixed", inset: 0, zIndex: 9998 }}
                                onClick={() => onToggleModelMenu(false)}
                            />
                            <div
                                style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    marginTop: "6px",
                                    minWidth: "260px",
                                    maxHeight: "260px",
                                    overflowY: "auto",
                                    background: "var(--color-surface-elevated)",
                                    border: "1px solid var(--color-border)",
                                    borderRadius: "10px",
                                    padding: "6px",
                                    zIndex: 10000,
                                    boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
                                }}
                            >
                                {loadingModels ? (
                                    <div style={{ padding: "16px", textAlign: "center" }}>
                                        <RefreshCw size={14} className="animate-spin" />
                                    </div>
                                ) : mergedModels.length > 0 ? (
                                    mergedModels.map((model) => (
                                        <div
                                            key={model}
                                            onClick={() => {
                                                onUpdate("model", model);
                                                onToggleModelMenu(false);
                                            }}
                                            style={{
                                                padding: "7px 10px",
                                                borderRadius: "6px",
                                                cursor: "pointer",
                                                fontSize: "12px",
                                                color: target.model === model ? "var(--color-primary)" : "var(--color-text-main)",
                                                background: target.model === model ? "var(--color-primary-glow)" : "transparent",
                                            }}
                                        >
                                            {model}
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ padding: "12px 10px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                                        {t("flowprobe.no_models")}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <input
                    type="password"
                    value={target.api_key}
                    onChange={(event) => onUpdate("api_key", event.target.value)}
                    placeholder={t("flowprobe.placeholder_api_key")}
                    style={{ ...inputStyle, flex: "1 1 0", minWidth: "160px" }}
                />

                <button
                    onClick={onTest}
                    className="btn-ghost"
                    style={{
                        height: "32px",
                        padding: "0 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        fontSize: "12px",
                        fontWeight: 600,
                        flexShrink: 0,
                    }}
                >
                    {t("flowprobe.btn_test")}
                </button>

                <button
                    onClick={onDelete}
                    title={t("flowprobe.btn_delete")}
                    style={{
                        height: "32px",
                        width: "32px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#ef4444",
                        background: "rgba(239,68,68,0.1)",
                        border: "1px solid rgba(239,68,68,0.2)",
                        borderRadius: "8px",
                        cursor: "pointer",
                        flexShrink: 0,
                    }}
                >
                    <Trash2 size={14} />
                </button>
            </div>

            <datalist id={`probe-models-${target.id}`}>
                {mergedModels.map((model) => (
                    <option key={model} value={model} />
                ))}
            </datalist>

            {result && (
                <div
                    style={{
                        marginLeft: "34px",
                        background: "var(--color-bg-base)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "10px",
                        padding: "12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                    }}
                >
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <div
                            style={{
                                background: resultTone.bg,
                                color: resultTone.color,
                                borderRadius: "100px",
                                padding: "4px 10px",
                                fontSize: "11px",
                                fontWeight: 700,
                            }}
                        >
                            {result.code}
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-main)" }}>
                            {result.summary}
                        </div>
                        {typeof result.latency_ms === "number" && (
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                                {result.latency_ms} ms
                            </div>
                        )}
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--color-text-main)", lineHeight: 1.5 }}>
                        {result.detail}
                    </div>

                    <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "11px", color: "var(--color-text-muted)" }}>
                        <span>{t("flowprobe.result_protocol")}: {result.detected_protocol || "-"}</span>
                        <span>{t("flowprobe.result_auth")}: {result.auth_status}</span>
                        <span>{t("flowprobe.result_models")}: {typeof result.model_count === "number" ? result.model_count : "-"}</span>
                    </div>
                </div>
            )}
        </Reorder.Item>
    );
}

export default function FlowProbe() {
    const { t } = useTranslation();
    const [targets, setTargets] = useState<ProbeTargetPayload[]>([]);
    const [results, setResults] = useState<Record<string, ProbeResult | null>>({});
    const [modelLists, setModelLists] = useState<Record<string, string[]>>({});
    const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
    const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});

    const loadTargets = async () => {
        const loaded = await invoke<ProbeTargetPayload[]>("get_probe_targets");
        setTargets(loaded.sort((a, b) => a.order - b.order));
    };

    useEffect(() => {
        loadTargets().catch(console.error);
    }, []);

    const persistTargets = async (nextTargets: ProbeTargetPayload[]) => {
        const ordered = nextTargets.map((target, index) => ({ ...target, order: index + 1 }));
        setTargets(ordered);
        try {
            await invoke("save_probe_targets", { targets: ordered });
        } catch (error) {
            console.error("Failed to save FlowProbe targets:", error);
        }
    };

    const updateTarget = (id: string, field: keyof ProbeTargetPayload, value: string | boolean | number) => {
        const nextTargets = targets.map((target) => (target.id === id ? { ...target, [field]: value } : target));
        persistTargets(nextTargets);
    };

    const addTarget = () => {
        persistTargets([...targets, defaultTarget()]);
    };

    const applyPreset = (presetKey: string) => {
        const preset = PRESETS.find((item) => item.key === presetKey);
        if (!preset) return;
        persistTargets([
            ...targets,
            {
                ...defaultTarget(),
                name: preset.name,
                protocol: preset.protocol,
                base_url: preset.base_url,
                model: preset.model,
            },
        ]);
    };

    const deleteTarget = (id: string) => {
        const nextTargets = targets.filter((target) => target.id !== id);
        persistTargets(nextTargets);
        setResults((prev) => {
            const clone = { ...prev };
            delete clone[id];
            return clone;
        });
    };

    const testTarget = async (target: ProbeTargetPayload) => {
        const result = await invoke<ProbeResult>("probe_ai_target", { target });
        setResults((prev) => ({ ...prev, [target.id]: result }));
    };

    const fetchModels = async (target: ProbeTargetPayload) => {
        setOpenMenus((prev) => ({ ...prev, [target.id]: true }));
        setLoadingModels((prev) => ({ ...prev, [target.id]: true }));
        try {
            const models = await invoke<string[]>("list_probe_target_models", { target });
            setModelLists((prev) => ({ ...prev, [target.id]: models }));
            setLoadingModels((prev) => ({ ...prev, [target.id]: false }));
            if (!target.model && models.length > 0) {
                updateTarget(target.id, "model", models[0]);
            }
        } catch (error) {
            console.error("Failed to fetch models:", error);
            setModelLists((prev) => ({ ...prev, [target.id]: [] }));
            setLoadingModels((prev) => ({ ...prev, [target.id]: false }));
        }
    };

    return (
        <div style={{ width: "100%", paddingBottom: "40px" }}>
            <div style={{ marginBottom: "28px" }}>
                <h1 style={{ fontSize: "22px", fontWeight: 700, display: "flex", alignItems: "center", gap: "10px", margin: 0 }}>
                    <Activity size={22} color="var(--color-primary)" />
                    {t("flowprobe.title")}
                </h1>
                <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginTop: "6px" }}>
                    {t("flowprobe.subtitle")}
                </p>
            </div>

            <div
                className="glass-panel"
                style={{
                    marginBottom: "18px",
                    padding: "14px 18px",
                    borderRadius: "var(--radius-lg)",
                    color: "var(--color-text-muted)",
                    fontSize: "12.5px",
                    lineHeight: 1.6,
                }}
            >
                {t("flowprobe.direct_notice")}
            </div>

            <div className="glass-panel" style={{ padding: "18px", borderRadius: "var(--radius-lg)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "12px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                        {t("flowprobe.local_secrets_notice")}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <select
                            defaultValue=""
                            onChange={(event) => {
                                applyPreset(event.target.value);
                                event.currentTarget.value = "";
                            }}
                            style={{
                                padding: "8px 10px",
                                borderRadius: "10px",
                                border: "1px solid var(--color-border)",
                                background: "var(--color-bg-base)",
                                color: "var(--color-text-main)",
                                fontSize: "12px",
                            }}
                        >
                            <option value="">{t("flowprobe.add_preset")}</option>
                            {PRESETS.map((preset) => (
                                <option key={preset.key} value={preset.key}>
                                    {preset.name}
                                </option>
                            ))}
                        </select>
                        <button
                            onClick={addTarget}
                            className="btn-ghost"
                            style={{
                                padding: "8px 14px",
                                fontSize: "13px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                border: "1px solid var(--color-border)",
                                borderRadius: "10px",
                            }}
                        >
                            <Plus size={16} /> {t("flowprobe.btn_add_target")}
                        </button>
                    </div>
                </div>

                <Reorder.Group
                    axis="y"
                    values={targets}
                    onReorder={persistTargets}
                    style={{ display: "flex", flexDirection: "column", gap: "10px", listStyleType: "none", padding: 0, margin: 0 }}
                >
                    {targets.map((target) => (
                        <ProbeTargetCard
                            key={target.id}
                            target={target}
                            result={results[target.id]}
                            models={modelLists[target.id] || []}
                            loadingModels={!!loadingModels[target.id]}
                            openModelMenu={!!openMenus[target.id]}
                            onUpdate={(field, value) => updateTarget(target.id, field, value)}
                            onDelete={() => deleteTarget(target.id)}
                            onTest={() => testTarget(target)}
                            onFetchModels={() => fetchModels(target)}
                            onToggleModelMenu={(open) => setOpenMenus((prev) => ({ ...prev, [target.id]: open }))}
                        />
                    ))}
                </Reorder.Group>
            </div>
        </div>
    );
}
