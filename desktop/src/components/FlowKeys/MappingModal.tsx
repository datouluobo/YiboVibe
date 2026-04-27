import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback } from "react";
import { X, Keyboard, List, ArrowLeftRight, Repeat } from "lucide-react";
import { ModifierKey, MODIFIER_KEY_MAP } from "./keyData";
import VisualKeyboard, { layoutTotalWidth } from "./VisualKeyboard";
import KeyCategoryList from "./KeyCategoryList";

export interface KeyMapping {
    id: string;
    source_key: string;
    source_key_id: string;
    target_key: string;
    target_key_id: string;
    target_modifiers: ModifierKey[];
    enabled: boolean;
    bidirectional: boolean;
    description: string;
}

interface MappingModalProps {
    open: boolean;
    mapping: KeyMapping | null;
    existingSources: Set<string>;
    onSave: (mapping: KeyMapping) => void;
    onClose: () => void;
}

type TargetMode = "keyboard" | "list";

export default function MappingModal({ open, mapping, existingSources, onSave, onClose }: MappingModalProps) {
    const { t } = useTranslation();
    const [sourceKey, setSourceKey] = useState("");
    const [sourceKeyId, setSourceKeyId] = useState("");
    const [capturingSource, setCapturingSource] = useState(false);
    const [sourceModifiers, setSourceModifiers] = useState<ModifierKey[]>([]);
    const [liveModifiers, setLiveModifiers] = useState<ModifierKey[]>([]);

    const [targetKey, setTargetKey] = useState("");
    const [targetKeyId, setTargetKeyId] = useState("");
    const [targetModifiers, setTargetModifiers] = useState<ModifierKey[]>([]);
    const [targetMode, setTargetMode] = useState<TargetMode>("keyboard");

    const [description, setDescription] = useState("");
    const [bidirectional, setBidirectional] = useState(false);

    const isEdit = !!mapping;

    useEffect(() => {
        if (open && mapping) {
            setSourceKey(mapping.source_key);
            setSourceKeyId(mapping.source_key_id);
            setTargetKey(mapping.target_key);
            setTargetKeyId(mapping.target_key_id);
            setTargetModifiers(mapping.target_modifiers);
            setDescription(mapping.description);
            setBidirectional(mapping.bidirectional ?? false);
        } else if (open) {
            setSourceKey("");
            setSourceKeyId("");
            setTargetKey("");
            setTargetKeyId("");
            setTargetModifiers([]);
            setDescription("");
            setBidirectional(false);
        }
        setCapturingSource(false);
        setSourceModifiers([]);
        setTargetMode("keyboard");
    }, [open, mapping]);

    const captureKeyDown = useCallback((e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const mods: ModifierKey[] = [];
        if (e.ctrlKey) mods.push("Ctrl");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        if (e.metaKey) mods.push("Win");
        setLiveModifiers(mods);

        if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

        if (e.key === "Escape") {
            setCapturingSource(false);
            setLiveModifiers([]);
            return;
        }

        const mod = MODIFIER_KEY_MAP[e.code];
        if (mod) return;

        const keyLabel = mods.length > 0 ? [...mods, e.key].join("+") : e.key;
        setSourceKey(keyLabel);
        setSourceKeyId(e.code);
        setSourceModifiers(mods);
        setCapturingSource(false);
        setLiveModifiers([]);
    }, []);

    useEffect(() => {
        if (capturingSource) {
            window.addEventListener("keydown", captureKeyDown);
            return () => window.removeEventListener("keydown", captureKeyDown);
        }
    }, [capturingSource, captureKeyDown]);

    const handleSelectTarget = (keyId: string, label: string, mods: ModifierKey[]) => {
        setTargetKeyId(keyId);
        setTargetModifiers(mods);
        const modStr = mods.length > 0 ? mods.join("+") + "+" : "";
        setTargetKey(modStr + label);
    };

    const handleSave = () => {
        if (!sourceKey || !targetKey) return;

        const result: KeyMapping = {
            id: mapping?.id || `km-${Date.now()}`,
            source_key: sourceKey,
            source_key_id: sourceKeyId,
            target_key: targetKey,
            target_key_id: targetKeyId,
            target_modifiers: targetModifiers,
            enabled: mapping?.enabled ?? true,
            bidirectional,
            description,
        };
        onSave(result);
        onClose();
    };

    if (!open) return null;

    const conflict = !isEdit && sourceKeyId && existingSources.has(sourceKeyId);

    return (
        <div
            style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 10000 }}
            onClick={onClose}
        >
            <div style={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
            }} />
            <div
                style={{
                    position: "absolute", top: "50%", left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "fit-content", minWidth: "840px", maxWidth: "95vw", maxHeight: "85vh",
                    background: "var(--color-surface-elevated)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "16px", padding: "24px",
                    overflowY: "auto",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                    <h2 style={{ fontSize: "17px", fontWeight: 700, margin: 0 }}>
                        {isEdit ? t("flowkeys.modal_edit") : t("flowkeys.modal_add")}
                    </h2>
                    <button onClick={onClose} style={{
                        background: "none", border: "none", color: "var(--color-text-muted)",
                        cursor: "pointer", display: "flex",
                    }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Source Key */}
                <div style={{ marginBottom: "20px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "6px", display: "block" }}>
                        {t("flowkeys.source_label")}
                    </label>
                    <button
                        onClick={() => setCapturingSource(true)}
                        style={{
                            width: "100%", padding: "12px 16px", borderRadius: "8px",
                            background: capturingSource ? "var(--color-primary-glow)" : "var(--color-bg-base)",
                            border: capturingSource ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                            color: sourceKey ? "var(--color-text-main)" : "var(--color-text-muted)",
                            fontSize: "14px", fontWeight: 600, cursor: "pointer",
                            fontFamily: "monospace", textAlign: "center",
                            transition: "all 0.15s",
                        }}
                    >
                        {capturingSource
                            ? (liveModifiers.length > 0
                                ? `${liveModifiers.join(" + ")} + ...`
                                : t("flowkeys.capturing"))
                            : (sourceKey || t("flowkeys.click_to_capture"))}
                    </button>
                    {conflict && (
                        <div style={{ fontSize: "11px", color: "#ef4444", marginTop: "4px" }}>
                            {t("flowkeys.conflict_warning")}
                        </div>
                    )}
                </div>

                {/* Swap + Bidirectional buttons between source and target */}
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                    <button
                        onClick={() => {
                            const tmpKey = sourceKey;
                            const tmpKeyId = sourceKeyId;
                            const tmpMods = sourceModifiers;
                            setSourceKey(targetKey);
                            setSourceKeyId(targetKeyId);
                            setSourceModifiers(targetModifiers);
                            setTargetKey(tmpKey);
                            setTargetKeyId(tmpKeyId);
                            setTargetModifiers(tmpMods);
                        }}
                        style={{
                            width: "32px", height: "32px", borderRadius: "50%",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-bg-base)",
                            color: "var(--color-text-muted)",
                            cursor: "pointer", display: "flex",
                            alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s",
                        }}
                        title={t("flowkeys.btn_swap")}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--color-primary-glow)";
                            e.currentTarget.style.color = "var(--color-primary)";
                            e.currentTarget.style.borderColor = "var(--color-primary)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = "var(--color-bg-base)";
                            e.currentTarget.style.color = "var(--color-text-muted)";
                            e.currentTarget.style.borderColor = "var(--color-border)";
                        }}
                    >
                        <ArrowLeftRight size={15} />
                    </button>
                    <button
                        onClick={() => setBidirectional(!bidirectional)}
                        style={{
                            display: "flex", alignItems: "center", gap: "6px",
                            padding: "6px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: 600,
                            border: bidirectional ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                            background: bidirectional ? "var(--color-primary-glow)" : "var(--color-bg-base)",
                            color: bidirectional ? "var(--color-primary)" : "var(--color-text-muted)",
                            cursor: "pointer", transition: "all 0.15s",
                        }}
                        title={t("flowkeys.btn_bidirectional")}
                    >
                        <Repeat size={14} />
                        {t("flowkeys.bidirectional")}
                    </button>
                </div>

                {/* Target Key */}
                <div style={{ marginBottom: "16px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "6px", display: "block" }}>
                        {t("flowkeys.target_label")}
                    </label>
                    <div style={{
                        padding: "8px 14px", borderRadius: "8px",
                        background: targetKey ? "var(--color-primary-glow)" : "var(--color-bg-base)",
                        border: targetKey ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                        fontFamily: "monospace", fontWeight: 600, fontSize: "14px",
                        color: targetKey ? "var(--color-primary)" : "var(--color-text-muted)",
                        textAlign: "center", marginBottom: "10px",
                    }}>
                        {targetKey || t("flowkeys.select_target")}
                    </div>

                    <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
                        {([
                            { mode: "keyboard" as TargetMode, icon: Keyboard, label: t("flowkeys.mode_keyboard") },
                            { mode: "list" as TargetMode, icon: List, label: t("flowkeys.mode_list") },
                        ]).map(({ mode, icon: Icon, label }) => (
                            <button
                                key={mode}
                                onClick={() => setTargetMode(mode)}
                                style={{
                                    padding: "4px 10px", fontSize: "11px", borderRadius: "6px",
                                    display: "flex", alignItems: "center", gap: "4px",
                                    border: targetMode === mode ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                                    background: targetMode === mode ? "var(--color-primary-glow)" : "transparent",
                                    color: targetMode === mode ? "var(--color-primary)" : "var(--color-text-muted)",
                                    cursor: "pointer", fontWeight: 600,
                                }}
                            >
                                <Icon size={13} /> {label}
                            </button>
                        ))}
                    </div>

                    {targetMode === "keyboard" ? (
                        <VisualKeyboard
                            onSelectKey={(keyId, label, mods) => {
                                handleSelectTarget(keyId, label, mods);
                            }}
                            selectedKeyId={targetKeyId}
                            activeModifiers={targetModifiers}
                            onToggleModifier={(mod) => {
                                setTargetModifiers((prev) =>
                                    prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
                                );
                            }}
                        />
                    ) : (
                        <KeyCategoryList
                            onSelectKey={handleSelectTarget}
                            activeModifiers={targetModifiers}
                            onToggleModifier={(mod) => {
                                setTargetModifiers((prev) =>
                                    prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
                                );
                            }}
                        />
                    )}
                </div>

                {/* Description */}
                <div style={{ marginBottom: "20px" }}>
                    <input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t("flowkeys.placeholder_desc")}
                        style={{
                            width: "100%", padding: "8px 12px", borderRadius: "8px",
                            border: "1px solid var(--color-border)", background: "var(--color-bg-base)",
                            color: "var(--color-text-main)", fontSize: "12px", outline: "none",
                            boxSizing: "border-box",
                        }}
                    />
                </div>

                {/* Actions */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button
                        onClick={onClose}
                        className="btn-ghost"
                        style={{
                            padding: "8px 16px", fontSize: "13px",
                            border: "1px solid var(--color-border)", borderRadius: "8px",
                            cursor: "pointer",
                        }}
                    >
                        {t("flowkeys.modal_cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!sourceKey || !targetKey}
                        style={{
                            padding: "8px 20px", fontSize: "13px", fontWeight: 600,
                            borderRadius: "8px", cursor: "pointer",
                            border: "none",
                            background: (!sourceKey || !targetKey) ? "var(--color-border)" : "var(--color-primary)",
                            color: (!sourceKey || !targetKey) ? "var(--color-text-muted)" : "#fff",
                            opacity: (!sourceKey || !targetKey) ? 0.5 : 1,
                        }}
                    >
                        {t("flowkeys.modal_save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
