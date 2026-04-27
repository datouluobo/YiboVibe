import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { KEY_CATEGORIES, MODIFIER_KEYS, ModifierKey } from "./keyData";

interface KeyCategoryListProps {
    onSelectKey: (keyId: string, label: string, modifiers: ModifierKey[]) => void;
    activeModifiers: ModifierKey[];
    onToggleModifier: (mod: ModifierKey) => void;
}

export default function KeyCategoryList({ onSelectKey, activeModifiers, onToggleModifier }: KeyCategoryListProps) {
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
        <div style={{ display: "flex", gap: "0", height: "240px" }}>
            <div style={{
                width: "110px", flexShrink: 0,
                borderRight: "1px solid var(--color-border)",
                overflowY: "auto", paddingRight: "4px",
            }}>
                {KEY_CATEGORIES.map((cat) => (
                    <div
                        key={cat.id}
                        onClick={() => { setActiveCat(cat.id); setSearch(""); }}
                        style={{
                            padding: "6px 8px", fontSize: "11.5px", cursor: "pointer",
                            borderRadius: "6px", marginBottom: "2px",
                            background: cat.id === activeCat ? "var(--color-primary-glow)" : "transparent",
                            color: cat.id === activeCat ? "var(--color-primary)" : "var(--color-text-muted)",
                            fontWeight: cat.id === activeCat ? 600 : 400,
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

            <div style={{ flex: 1, padding: "0 8px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ position: "relative", marginBottom: "8px" }}>
                    <Search size={13} style={{
                        position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)",
                        color: "var(--color-text-muted)",
                    }} />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("flowkeys.search_placeholder")}
                        style={{
                            width: "100%", padding: "5px 8px 5px 28px", fontSize: "11px",
                            borderRadius: "6px", border: "1px solid var(--color-border)",
                            background: "var(--color-bg-base)", color: "var(--color-text-main)",
                            outline: "none", boxSizing: "border-box",
                        }}
                    />
                </div>

                <div style={{
                    display: "flex", gap: "4px", marginBottom: "8px", flexWrap: "wrap",
                }}>
                    {MODIFIER_KEYS.map((mod) => (
                        <button
                            key={mod}
                            onClick={() => onToggleModifier(mod)}
                            style={{
                                padding: "2px 8px", fontSize: "10px", borderRadius: "4px",
                                border: activeModifiers.includes(mod) ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                                background: activeModifiers.includes(mod) ? "var(--color-primary-glow)" : "transparent",
                                color: activeModifiers.includes(mod) ? "var(--color-primary)" : "var(--color-text-muted)",
                                cursor: "pointer", fontWeight: 600, fontFamily: "monospace",
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
                    gap: "6px",
                    alignContent: "flex-start",
                }}>
                    {filteredKeys.map((key) => (
                        <button
                            key={key.id}
                            onClick={() => onSelectKey(key.id, key.label, [...activeModifiers])}
                            style={{
                                padding: "10px 14px", fontSize: "13px", borderRadius: "6px",
                                border: "1px solid var(--color-border)",
                                background: "var(--color-surface-elevated)",
                                color: "var(--color-text-main)", cursor: "pointer",
                                fontWeight: 500,
                                transition: "all 0.1s",
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                                lineHeight: "1.2",
                                flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = "var(--color-primary-glow)";
                                e.currentTarget.style.color = "var(--color-primary)";
                                e.currentTarget.style.borderColor = "var(--color-primary)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = "var(--color-surface-elevated)";
                                e.currentTarget.style.color = "var(--color-text-main)";
                                e.currentTarget.style.borderColor = "var(--color-border)";
                            }}
                        >
                            {key.label}
                        </button>
                    ))}
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
