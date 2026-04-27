import { useTranslation } from "react-i18next";
import { useState, useRef, useEffect } from "react";
import { Plus, MoreHorizontal, Copy, Trash2, Edit3, Download, ChevronDown, Power } from "lucide-react";

export interface Profile {
    id: string;
    name: string;
    active: boolean;
    mappings: any[];
}

interface ProfileBarProps {
    profiles: Profile[];
    activeProfileId: string | null;
    onSelect: (id: string) => void;
    onAdd: () => void;
    onRename: (id: string, name: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onToggleActive: (id: string) => void;
    compact?: boolean;
}

export default function ProfileBar({
    profiles, activeProfileId, onSelect, onAdd, onRename, onDuplicate, onDelete, onToggleActive,
    compact = false,
}: ProfileBarProps) {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const handleStartRename = (p: Profile) => {
        setRenaming(p.id);
        setRenameValue(p.name);
        setMenuOpen(null);
    };

    const handleFinishRename = (id: string) => {
        if (renameValue.trim()) {
            onRename(id, renameValue.trim());
        }
        setRenaming(null);
    };

    const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

    if (compact) {
        return (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                {/* Custom dropdown */}
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                    <button
                        onClick={() => setMenuOpen(menuOpen === "compact-select" ? null : "compact-select")}
                        style={{
                            width: "100%",
                            padding: "6px 32px 6px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-bg-base)",
                            color: "var(--color-text-main)",
                            fontSize: "12px",
                            fontWeight: 500,
                            cursor: "pointer",
                            outline: "none",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            position: "relative",
                            transition: "border-color 0.15s, box-shadow 0.15s",
                            boxShadow: menuOpen === "compact-select" ? "0 0 0 2px var(--color-primary-glow)" : "none",
                            borderColor: menuOpen === "compact-select" ? "var(--color-primary)" : "var(--color-border)",
                        }}
                    >
                        <span style={{
                            width: "6px", height: "6px", borderRadius: "50%",
                            background: activeProfile?.active ? "#22c55e" : "var(--color-text-muted)",
                            flexShrink: 0,
                        }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {activeProfile?.name || ""}
                        </span>
                        <ChevronDown
                            size={14}
                            style={{
                                position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
                                color: "var(--color-text-muted)",
                                transition: "transform 0.15s",
                                transform: menuOpen === "compact-select" ? "translateY(-50%) rotate(180deg)" : "translateY(-50%)",
                            }}
                        />
                    </button>

                    {menuOpen === "compact-select" && (
                        <>
                            <div
                                style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 9998 }}
                                onClick={() => setMenuOpen(null)}
                            />
                            <div style={{
                                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                                background: "var(--color-surface-elevated)",
                                border: "1px solid var(--color-border)", borderRadius: "8px",
                                zIndex: 9999, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                                maxHeight: "240px", overflowY: "auto",
                            }}>
                                {profiles.map((p) => {
                                    const isSelected = p.id === activeProfileId;
                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => { onSelect(p.id); setMenuOpen(null); }}
                                            style={{
                                                padding: "8px 12px", fontSize: "12px", cursor: "pointer",
                                                display: "flex", alignItems: "center", gap: "8px",
                                                color: "var(--color-text-main)",
                                                background: isSelected ? "var(--color-primary-glow)" : "transparent",
                                                fontWeight: isSelected ? 600 : 400,
                                                transition: "background 0.1s",
                                            }}
                                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--color-glass-bg)"; }}
                                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                                        >
                                            <span style={{
                                                width: "6px", height: "6px", borderRadius: "50%",
                                                background: p.active ? "#22c55e" : "var(--color-text-muted)",
                                                flexShrink: 0,
                                            }} />
                                            <span style={{ flex: 1 }}>{p.name}</span>
                                            <span style={{
                                                fontSize: "9px", fontWeight: 700,
                                                padding: "1px 5px", borderRadius: "4px",
                                                background: p.active ? "rgba(34,197,94,0.15)" : "transparent",
                                                color: p.active ? "#22c55e" : "var(--color-text-muted)",
                                            }}>
                                                {p.active ? "ON" : "OFF"}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>

                {/* Add profile */}
                <button
                    onClick={onAdd}
                    title={t("flowkeys.profile_add")}
                    style={{
                        width: "30px",
                        height: "30px",
                        borderRadius: "8px",
                        border: "1px dashed var(--color-border)",
                        background: "var(--color-bg-base)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--color-text-muted)",
                        flexShrink: 0,
                        transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-primary)";
                        e.currentTarget.style.color = "var(--color-primary)";
                        e.currentTarget.style.background = "var(--color-primary-glow)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-border)";
                        e.currentTarget.style.color = "var(--color-text-muted)";
                        e.currentTarget.style.background = "var(--color-bg-base)";
                    }}
                >
                    <Plus size={14} />
                </button>

                {/* Rename */}
                <button
                    onClick={() => {
                        if (!activeProfile) return;
                        const nextName = window.prompt(t("flowkeys.profile_rename"), activeProfile.name);
                        if (nextName && nextName.trim()) onRename(activeProfile.id, nextName.trim());
                    }}
                    title={t("flowkeys.profile_rename")}
                    style={{
                        width: "30px", height: "30px", borderRadius: "8px",
                        border: "1px solid var(--color-border)", background: "var(--color-bg-base)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        color: "var(--color-text-muted)", flexShrink: 0, transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-primary)";
                        e.currentTarget.style.color = "var(--color-primary)";
                        e.currentTarget.style.background = "var(--color-primary-glow)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-border)";
                        e.currentTarget.style.color = "var(--color-text-muted)";
                        e.currentTarget.style.background = "var(--color-bg-base)";
                    }}
                >
                    <Edit3 size={14} />
                </button>

                {/* Duplicate */}
                <button
                    onClick={() => { if (activeProfile) onDuplicate(activeProfile.id); }}
                    title={t("flowkeys.profile_duplicate")}
                    style={{
                        width: "30px", height: "30px", borderRadius: "8px",
                        border: "1px solid var(--color-border)", background: "var(--color-bg-base)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        color: "var(--color-text-muted)", flexShrink: 0, transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-primary)";
                        e.currentTarget.style.color = "var(--color-primary)";
                        e.currentTarget.style.background = "var(--color-primary-glow)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-border)";
                        e.currentTarget.style.color = "var(--color-text-muted)";
                        e.currentTarget.style.background = "var(--color-bg-base)";
                    }}
                >
                    <Copy size={14} />
                </button>

                {/* Toggle active */}
                <button
                    onClick={() => { if (activeProfile) onToggleActive(activeProfile.id); }}
                    title={activeProfile?.active ? t("flowkeys.profile_disable") : t("flowkeys.profile_enable")}
                    style={{
                        width: "30px", height: "30px", borderRadius: "8px",
                        border: "1px solid var(--color-border)", background: "var(--color-bg-base)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        color: activeProfile?.active ? "#22c55e" : "var(--color-text-muted)",
                        flexShrink: 0, transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-primary)";
                        e.currentTarget.style.background = "var(--color-primary-glow)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-border)";
                        e.currentTarget.style.background = "var(--color-bg-base)";
                    }}
                >
                    <Power size={14} />
                </button>

                {/* Delete */}
                <button
                    onClick={() => { if (activeProfile) onDelete(activeProfile.id); }}
                    title={t("flowkeys.profile_delete")}
                    style={{
                        width: "30px", height: "30px", borderRadius: "8px",
                        border: "1px solid var(--color-border)", background: "var(--color-bg-base)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        color: "var(--color-text-muted)", flexShrink: 0, transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#ef4444";
                        e.currentTarget.style.color = "#ef4444";
                        e.currentTarget.style.background = "rgba(239,68,68,0.1)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--color-border)";
                        e.currentTarget.style.color = "var(--color-text-muted)";
                        e.currentTarget.style.background = "var(--color-bg-base)";
                    }}
                >
                    <Trash2 size={14} />
                </button>
            </div>
        );
    }

    return (
        <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            marginBottom: compact ? 0 : "16px",
            flexWrap: compact ? "nowrap" : "wrap",
            minWidth: 0,
            overflowX: compact ? "auto" : "visible",
        }}>
            {profiles.map((p) => {
                const isActive = p.id === activeProfileId;
                const isRenaming = renaming === p.id;

                return (
                    <div key={p.id} style={{ position: "relative" }}>
                        {isRenaming ? (
                            <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => handleFinishRename(p.id)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleFinishRename(p.id);
                                    if (e.key === "Escape") setRenaming(null);
                                }}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: "8px",
                                    background: "var(--color-bg-base)",
                                    border: "2px solid var(--color-primary)",
                                    color: "var(--color-text-main)",
                                    fontSize: "12.5px",
                                    fontWeight: 600,
                                    outline: "none",
                                    width: "120px",
                                }}
                            />
                        ) : (
                            <button
                                onClick={() => onSelect(p.id)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setMenuOpen(menuOpen === p.id ? null : p.id);
                                }}
                                className="btn-ghost"
                                style={{
                                    padding: "6px 14px",
                                    fontSize: "12.5px",
                                    fontWeight: isActive ? 600 : 400,
                                    borderRadius: "8px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    border: isActive ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                                    background: isActive ? "var(--color-primary-glow)" : "transparent",
                                    color: isActive ? "var(--color-primary)" : "var(--color-text-main)",
                                    cursor: "pointer",
                                    transition: "all 0.15s",
                                }}
                            >
                                <span style={{
                                    width: "7px", height: "7px", borderRadius: "50%",
                                    background: p.active ? "#22c55e" : "var(--color-text-muted)",
                                    flexShrink: 0,
                                }} />
                                {p.name}
                                <span
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleActive(p.id);
                                    }}
                                    style={{
                                        marginLeft: "2px", cursor: "pointer", opacity: 0.5,
                                        fontSize: "10px",
                                    }}
                                    title={p.active ? t("flowkeys.profile_disable") : t("flowkeys.profile_enable")}
                                >
                                    {p.active ? "ON" : "OFF"}
                                </span>
                                <MoreHorizontal
                                    size={14}
                                    style={{ cursor: "pointer", opacity: 0.4 }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setMenuOpen(menuOpen === p.id ? null : p.id);
                                    }}
                                />
                            </button>
                        )}

                        {menuOpen === p.id && (
                            <>
                                <div
                                    style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 9998 }}
                                    onClick={() => setMenuOpen(null)}
                                />
                                <div style={{
                                    position: "absolute", top: "100%", left: 0, marginTop: "4px",
                                    minWidth: "160px", background: "var(--color-surface-elevated)",
                                    border: "1px solid var(--color-border)", borderRadius: "8px",
                                    zIndex: 9999, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                                }}>
                                    {[
                                        { icon: Edit3, label: t("flowkeys.profile_rename"), action: () => handleStartRename(p) },
                                        { icon: Copy, label: t("flowkeys.profile_duplicate"), action: () => { onDuplicate(p.id); setMenuOpen(null); } },
                                        { icon: Download, label: t("flowkeys.profile_export"), action: () => { setMenuOpen(null); } },
                                        { icon: Trash2, label: t("flowkeys.profile_delete"), action: () => { onDelete(p.id); setMenuOpen(null); }, danger: true },
                                    ].map((item) => (
                                        <div
                                            key={item.label}
                                            onClick={item.action}
                                            style={{
                                                padding: "8px 12px", fontSize: "12px", cursor: "pointer",
                                                display: "flex", alignItems: "center", gap: "8px",
                                                color: (item as any).danger ? "#ef4444" : "var(--color-text-main)",
                                                background: "transparent",
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-glass-bg)"; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                                        >
                                            <item.icon size={13} />
                                            {item.label}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                );
            })}

            <button
                onClick={onAdd}
                className="btn-ghost"
                style={{
                    padding: "6px 10px", fontSize: "12px",
                    border: "1px dashed var(--color-border)",
                    borderRadius: "8px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: "4px",
                    color: "var(--color-text-muted)",
                }}
            >
                <Plus size={14} />
                {t("flowkeys.profile_add")}
            </button>
        </div>
    );
}
