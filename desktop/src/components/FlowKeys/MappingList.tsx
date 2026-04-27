import { useTranslation } from "react-i18next";
import { Trash2, Edit3, ToggleLeft, ToggleRight } from "lucide-react";
import { KeyMapping } from "./MappingModal";

interface MappingListProps {
    mappings: KeyMapping[];
    onToggle: (id: string) => void;
    onEdit: (mapping: KeyMapping) => void;
    onDelete: (id: string) => void;
}

export default function MappingList({ mappings, onToggle, onEdit, onDelete }: MappingListProps) {
    const { t } = useTranslation();

    if (mappings.length === 0) {
        return (
            <div style={{
                textAlign: "center", padding: "48px 0",
                color: "var(--color-text-muted)", fontSize: "13px",
            }}>
                {t("flowkeys.empty")}
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {mappings.map((m) => (
                <div
                    key={m.id}
                    style={{
                        background: "var(--color-surface-elevated)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        padding: "10px 14px",
                        opacity: m.enabled ? 1 : 0.5,
                        transition: "opacity 0.15s",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <button
                            onClick={() => onToggle(m.id)}
                            style={{
                                background: "none", border: "none", cursor: "pointer",
                                color: m.enabled ? "#22c55e" : "var(--color-text-muted)",
                                display: "flex", alignItems: "center", flexShrink: 0,
                            }}
                            title={m.enabled ? t("flowkeys.status_enabled") : t("flowkeys.status_disabled")}
                        >
                            {m.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        </button>

                        <div style={{
                            padding: "3px 10px", borderRadius: "5px",
                            background: "var(--color-bg-base)", border: "1px solid var(--color-border)",
                            fontFamily: "monospace", fontSize: "12px", fontWeight: 600,
                            color: "var(--color-text-main)", textAlign: "center",
                        }}>
                            {m.source_key}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                            <span style={{ color: "var(--color-primary)", fontSize: "14px" }}>
                                {m.bidirectional ? "⇄" : "→"}
                            </span>
                            {m.bidirectional && (
                                <span style={{
                                    fontSize: "9px", fontWeight: 700,
                                    padding: "1px 5px", borderRadius: "4px",
                                    background: "var(--color-primary-glow)",
                                    color: "var(--color-primary)",
                                    border: "1px solid rgba(var(--color-primary-rgb, 99,102,241), 0.3)",
                                    letterSpacing: "0.5px",
                                }}>
                                    {t("flowkeys.bidirectional_short")}
                                </span>
                            )}
                        </div>

                        <div style={{
                            padding: "3px 10px", borderRadius: "5px",
                            background: "var(--color-primary-glow)", border: "1px solid rgba(var(--color-primary-rgb, 99,102,241), 0.3)",
                            fontFamily: "monospace", fontSize: "12px", fontWeight: 600,
                            color: "var(--color-primary)", textAlign: "center",
                        }}>
                            {m.target_key}
                        </div>

                        {m.description && (
                            <span style={{
                                fontSize: "11.5px", color: "var(--color-text-muted)",
                            }}>
                                {m.description}
                            </span>
                        )}

                        <div style={{ flex: "1 1 0", minWidth: "4px" }} />

                        <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
                            <button
                                onClick={() => onEdit(m)}
                                className="btn-ghost"
                                style={{
                                    padding: "4px", border: "none", cursor: "pointer",
                                    color: "var(--color-text-muted)", display: "flex",
                                }}
                                title={t("flowkeys.btn_edit")}
                            >
                                <Edit3 size={14} />
                            </button>

                            <button
                                onClick={() => onDelete(m.id)}
                                style={{
                                    padding: "4px", border: "none", cursor: "pointer",
                                    color: "#ef4444", background: "transparent",
                                    display: "flex",
                                }}
                                title={t("flowkeys.btn_delete")}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
