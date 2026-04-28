import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { AlertTriangle, Edit3, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { KeyMapping } from "./MappingModal";

interface MappingListProps {
    mappings: KeyMapping[];
    onToggle: (id: string) => void;
    onEdit: (mapping: KeyMapping) => void;
    onDelete: (id: string) => void;
    selectedMappingId?: string | null;
    conflictIds?: Set<string>;
    focusedKeyId?: string | null;
}

export default function MappingList({
    mappings,
    onToggle,
    onEdit,
    onDelete,
    selectedMappingId,
    conflictIds,
    focusedKeyId,
}: MappingListProps) {
    const { t } = useTranslation();
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!focusedKeyId || !listRef.current) return;
        const match = listRef.current.querySelector<HTMLElement>(`[data-focus-match="true"]`);
        match?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [focusedKeyId]);

    if (mappings.length === 0) {
        return (
            <div
                style={{
                    textAlign: "center",
                    padding: "48px 16px",
                    color: "var(--color-text-muted)",
                    fontSize: "13px",
                    border: "1px dashed var(--color-border)",
                    borderRadius: "16px",
                    background: "rgba(255,255,255,0.02)",
                }}
            >
                {t("flowkeys.empty")}
            </div>
        );
    }

    return (
        <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {mappings.map((mapping) => {
                const isSelected = mapping.id === selectedMappingId;
                const hasConflict = !!conflictIds?.has(mapping.id);
                const containsFocusedKey = !!focusedKeyId && (
                    mapping.source_key_id === focusedKeyId || mapping.target_key_id === focusedKeyId
                );
                return (
                    <div
                        key={mapping.id}
                        data-focus-match={containsFocusedKey ? "true" : "false"}
                        onClick={() => onEdit(mapping)}
                        style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "12px",
                            borderRadius: "18px",
                            border: hasConflict
                                ? "1px solid rgba(239, 68, 68, 0.34)"
                                : containsFocusedKey
                                    ? "1px solid rgba(59, 130, 246, 0.34)"
                                : isSelected
                                    ? "1px solid rgba(94, 106, 210, 0.34)"
                                    : "1px solid var(--color-border)",
                            background: isSelected
                                ? "linear-gradient(180deg, rgba(94,106,210,0.18), rgba(255,255,255,0.05))"
                                : containsFocusedKey
                                    ? "linear-gradient(180deg, rgba(59,130,246,0.14), rgba(255,255,255,0.05))"
                                : mapping.enabled
                                    ? "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))"
                                    : "linear-gradient(180deg, rgba(148,163,184,0.08), rgba(255,255,255,0.02))",
                            transition: "border-color 120ms ease, transform 120ms ease, background 120ms ease",
                            cursor: "pointer",
                            color: "inherit",
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onEdit(mapping);
                            }
                        }}
                        onMouseEnter={(event) => {
                            event.currentTarget.style.transform = "translateY(-1px)";
                        }}
                        onMouseLeave={(event) => {
                            event.currentTarget.style.transform = "translateY(0)";
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onToggle(mapping.id);
                                        }}
                                        style={{
                                            background: "none",
                                            border: "none",
                                            cursor: "pointer",
                                            color: mapping.enabled ? "#059669" : "#64748b",
                                            display: "flex",
                                            alignItems: "center",
                                            flexShrink: 0,
                                            padding: 0,
                                        }}
                                        title={mapping.enabled ? t("flowkeys.status_enabled") : t("flowkeys.status_disabled")}
                                    >
                                        {mapping.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                                    </button>

                                    <span
                                        style={{
                                            padding: "4px 10px",
                                            borderRadius: "999px",
                                            background: mapping.enabled ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.18)",
                                            color: mapping.enabled ? "#047857" : "#b45309",
                                            fontSize: "10px",
                                            fontWeight: 800,
                                            letterSpacing: "0.04em",
                                        }}
                                    >
                                        {mapping.enabled ? t("flowkeys.status_enabled") : t("flowkeys.status_disabled")}
                                    </span>

                                    {mapping.bidirectional && (
                                        <span
                                            style={{
                                                padding: "4px 10px",
                                                borderRadius: "999px",
                                                background: "rgba(99,102,241,0.16)",
                                                color: "#4f46e5",
                                                fontSize: "10px",
                                                fontWeight: 800,
                                                letterSpacing: "0.04em",
                                            }}
                                        >
                                            {t("flowkeys.bidirectional_short")}
                                        </span>
                                    )}

                                    {hasConflict && (
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "4px 10px",
                                                borderRadius: "999px",
                                                background: "rgba(239,68,68,0.16)",
                                                color: "#dc2626",
                                                fontSize: "10px",
                                                fontWeight: 800,
                                                letterSpacing: "0.04em",
                                            }}
                                        >
                                            <AlertTriangle size={12} />
                                            {t("flowkeys.legend_conflict")}
                                        </span>
                                    )}

                                    {containsFocusedKey && (
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "4px 10px",
                                                borderRadius: "999px",
                                                background: "rgba(59,130,246,0.16)",
                                                color: "#2563eb",
                                                fontSize: "10px",
                                                fontWeight: 800,
                                                letterSpacing: "0.04em",
                                            }}
                                        >
                                            {t("flowkeys.mapping_highlighted")}
                                        </span>
                                    )}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                    <div
                                        style={{
                                            padding: "7px 11px",
                                            borderRadius: "12px",
                                            background: "rgba(255,255,255,0.72)",
                                            border: "1px solid rgba(148,163,184,0.22)",
                                            fontFamily: "monospace",
                                            fontSize: "12px",
                                            fontWeight: 700,
                                            color: "#1e293b",
                                        }}
                                    >
                                        {mapping.source_key}
                                    </div>

                                    <span style={{ color: "var(--color-primary)", fontSize: "15px", fontWeight: 800 }}>
                                        {mapping.bidirectional ? "⇄" : "→"}
                                    </span>

                                    <div
                                        style={{
                                            padding: "7px 11px",
                                            borderRadius: "12px",
                                            background: "rgba(99,102,241,0.14)",
                                            border: "1px solid rgba(99,102,241,0.24)",
                                            fontFamily: "monospace",
                                            fontSize: "12px",
                                            fontWeight: 700,
                                            color: "#4338ca",
                                        }}
                                    >
                                        {mapping.target_key}
                                    </div>
                                </div>

                                {mapping.description && (
                                    <div style={{ color: "#64748b", fontSize: "11px", lineHeight: 1.4 }}>
                                        {mapping.description}
                                    </div>
                                )}
                            </div>

                            <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                <button
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onEdit(mapping);
                                    }}
                                    className="btn-ghost"
                                    style={{
                                        width: "34px",
                                        height: "34px",
                                        borderRadius: "10px",
                                        padding: 0,
                                        border: "1px solid var(--color-border)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                    title={t("flowkeys.btn_edit")}
                                >
                                    <Edit3 size={14} />
                                </button>

                                <button
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onDelete(mapping.id);
                                    }}
                                    style={{
                                        width: "34px",
                                        height: "34px",
                                        borderRadius: "10px",
                                        padding: 0,
                                        border: "1px solid rgba(239,68,68,0.22)",
                                        background: "rgba(239,68,68,0.08)",
                                        cursor: "pointer",
                                        color: "#f87171",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                    title={t("flowkeys.btn_delete")}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
