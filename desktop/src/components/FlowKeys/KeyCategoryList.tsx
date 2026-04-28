import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { KEY_CATEGORIES, MODIFIER_KEYS, ModifierKey } from "./keyData";

interface KeyCategoryListProps {
    onSelectKey: (keyId: string, label: string, modifiers: ModifierKey[]) => void;
    activeModifiers: ModifierKey[];
    onToggleModifier: (mod: ModifierKey) => void;
    selectedKeyId?: string;
}

export default function KeyCategoryList({
    onSelectKey,
    activeModifiers,
    onToggleModifier,
    selectedKeyId,
}: KeyCategoryListProps) {
    const { t } = useTranslation();
    const [activeCat, setActiveCat] = useState(KEY_CATEGORIES[0].id);
    const [search, setSearch] = useState("");

    const category = KEY_CATEGORIES.find((c) => c.id === activeCat)!;

    const filteredKeys = useMemo(() => {
        if (!search.trim()) return category.keys;
        const q = search.toLowerCase();
        return category.keys.filter((k) => k.label.toLowerCase().includes(q) || k.id.toLowerCase().includes(q));
    }, [category.keys, search]);

    return (
        <div
            style={{
                display: "flex",
                gap: "0",
                minHeight: "260px",
                maxHeight: "340px",
                borderRadius: "16px",
                border: "1px solid var(--color-border)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
                overflow: "hidden",
            }}
        >
            <div style={{
                width: "124px", flexShrink: 0,
                borderRight: "1px solid var(--color-border)",
                overflowY: "auto", padding: "10px 6px 10px 10px",
            }}>
                {KEY_CATEGORIES.map((cat) => (
                    <div
                        key={cat.id}
                        onClick={() => { setActiveCat(cat.id); setSearch(""); }}
                        style={{
                            padding: "8px 10px", fontSize: "11.5px", cursor: "pointer",
                            borderRadius: "10px", marginBottom: "4px",
                            background: cat.id === activeCat ? "var(--color-primary-glow)" : "transparent",
                            color: cat.id === activeCat ? "var(--color-primary)" : "var(--color-text-muted)",
                            fontWeight: cat.id === activeCat ? 700 : 500,
                            transition: "all 0.1s",
                        }}
                        onMouseEnter={(e) => {
                            if (cat.id !== activeCat) e.currentTarget.style.background = "var(--color-glass-bg)";
                        }}
                        onMouseLeave={(e) => {
                            if (cat.id !== activeCat) e.currentTarget.style.background = "transparent";
                        }}
                    >
                        {t(cat.labelKey)}
                    </div>
                ))}
            </div>

            <div style={{ flex: 1, padding: "12px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ position: "relative", marginBottom: "10px" }}>
                    <Search size={13} style={{
                        position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)",
                        color: "var(--color-text-muted)",
                    }} />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("flowkeys.search_placeholder")}
                        style={{
                            width: "100%", padding: "8px 10px 8px 30px", fontSize: "11px",
                            borderRadius: "10px", border: "1px solid var(--color-border)",
                            background: "rgba(255,255,255,0.02)", color: "var(--color-text-main)",
                            outline: "none", boxSizing: "border-box",
                        }}
                    />
                </div>

                <div style={{
                    display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap",
                }}>
                    {MODIFIER_KEYS.map((mod) => (
                        <button
                            key={mod}
                            onClick={() => onToggleModifier(mod)}
                            style={{
                                padding: "5px 10px", fontSize: "10px", borderRadius: "999px",
                                border: activeModifiers.includes(mod) ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                                background: activeModifiers.includes(mod) ? "var(--color-primary-glow)" : "rgba(255,255,255,0.02)",
                                color: activeModifiers.includes(mod) ? "var(--color-primary)" : "var(--color-text-muted)",
                                cursor: "pointer", fontWeight: 700, fontFamily: "monospace",
                            }}
                        >
                            {mod}
                        </button>
                    ))}
                </div>

                <div style={{
                    flex: 1, overflowY: "auto",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    alignContent: "flex-start",
                }}>
                    {filteredKeys.map((key) => {
                        const isSelected = selectedKeyId === key.id;
                        return (
                            <button
                                key={key.id}
                                onClick={() => onSelectKey(key.id, key.label, [...activeModifiers])}
                                style={{
                                    padding: "10px 14px", fontSize: "13px", borderRadius: "12px",
                                    border: isSelected ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                                    background: isSelected ? "var(--color-primary-glow)" : "var(--color-surface-elevated)",
                                    color: isSelected ? "var(--color-primary)" : "var(--color-text-main)", cursor: "pointer",
                                    fontWeight: isSelected ? 700 : 600,
                                    transition: "all 0.1s",
                                    whiteSpace: "normal",
                                    wordBreak: "break-word",
                                    lineHeight: "1.2",
                                    flexShrink: 0,
                                }}
                                onMouseEnter={(e) => {
                                    if (!isSelected) {
                                        e.currentTarget.style.background = "var(--color-primary-glow)";
                                        e.currentTarget.style.color = "var(--color-primary)";
                                        e.currentTarget.style.borderColor = "var(--color-primary)";
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isSelected) {
                                        e.currentTarget.style.background = "var(--color-surface-elevated)";
                                        e.currentTarget.style.color = "var(--color-text-main)";
                                        e.currentTarget.style.borderColor = "var(--color-border)";
                                    }
                                }}
                            >
                                {key.label}
                            </button>
                        );
                    })}
                    {filteredKeys.length === 0 && (
                        <span style={{ color: "var(--color-text-muted)", fontSize: "11px", padding: "8px" }}>
                            {t("flowkeys.no_keys_found")}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
