import { useState } from "react";
import { KEYBOARD_LAYOUTS, MODIFIER_KEYS, ModifierKey, KeyDef, KeyRow } from "./keyData";

interface VisualKeyboardProps {
    onSelectKey: (keyId: string, label: string, modifiers: ModifierKey[]) => void;
    selectedKeyId?: string;
    mappedKeys?: Set<string>;
    activeModifiers: ModifierKey[];
    onToggleModifier: (mod: ModifierKey) => void;
}

function rowWidthUnits(row: KeyRow): number {
    return row.keys.reduce((sum, k) => sum + (k.width || 1), 0);
}

function layoutTotalWidth(layoutIdx: number): number {
    const layout = KEYBOARD_LAYOUTS[layoutIdx];
    const U = 40;
    const GAP = 2;
    const SECTION_GAP = 10;
    let total = 0;
    layout.sections.forEach((section, si) => {
        const maxU = Math.max(...section.rows.map(rowWidthUnits));
        total += maxU * U + (maxU - 1) * GAP;
        if (section.marginLeft) total += section.marginLeft * U;
        if (si > 0) total += SECTION_GAP;
    });
    return total + 12;
}

export default function VisualKeyboard({
    onSelectKey, selectedKeyId, mappedKeys, activeModifiers, onToggleModifier,
}: VisualKeyboardProps) {
    const [layoutIdx, setLayoutIdx] = useState(0);
    const layout = KEYBOARD_LAYOUTS[layoutIdx];

    const U = 40;
    const GAP = 2;
    const SECTION_GAP = 10;

    const renderKey = (key: KeyDef) => {
        if (key.id.startsWith("_blank_")) {
            const w = (key.width || 1) * U + ((key.width || 1) - 1) * GAP;
            return <div key={key.id} style={{ width: w, height: U, flexShrink: 0 }} />;
        }

        const isSelected = selectedKeyId === key.id;
        const isMapped = mappedKeys?.has(key.id);
        const baseW = (key.width || 1) * U + ((key.width || 1) - 1) * GAP;
        const labelLen = key.label.length;
        const fontSize = labelLen > 6 ? "8px" : labelLen > 4 ? "9px" : labelLen > 2 ? "10px" : "11px";

        return (
            <button
                key={key.id}
                onClick={() => onSelectKey(key.id, key.label, [...activeModifiers])}
                style={{
                    width: baseW, height: U, minWidth: baseW,
                    fontSize,
                    fontWeight: isSelected ? 700 : 500,
                    fontFamily: "monospace",
                    borderRadius: "4px",
                    border: isSelected
                        ? "1.5px solid var(--color-primary)"
                        : isMapped
                            ? "1px solid rgba(34,197,94,0.4)"
                            : "1px solid var(--color-border)",
                    background: isSelected
                        ? "var(--color-primary-glow)"
                        : isMapped
                            ? "rgba(34,197,94,0.08)"
                            : "var(--color-surface-elevated)",
                    color: isSelected ? "var(--color-primary)" : "var(--color-text-main)",
                    cursor: "pointer", transition: "all 0.1s",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    position: "relative", flexShrink: 0, padding: "0 3px",
                    whiteSpace: "nowrap",
                    lineHeight: "1.1",
                }}
                onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "var(--color-glass-bg)";
                }}
                onMouseLeave={(e) => {
                    if (!isSelected) {
                        e.currentTarget.style.background = isMapped
                            ? "rgba(34,197,94,0.08)"
                            : "var(--color-surface-elevated)";
                    }
                }}
            >
                {key.label}
                {isMapped && !isSelected && (
                    <span style={{
                        position: "absolute", top: "1px", right: "2px",
                        width: "3px", height: "3px", borderRadius: "50%", background: "#22c55e",
                    }} />
                )}
            </button>
        );
    };

    return (
        <div style={{ width: "100%" }}>
            <div style={{
                display: "flex", gap: "4px", marginBottom: "6px",
                borderBottom: "1px solid var(--color-border)", paddingBottom: "6px",
            }}>
                {KEYBOARD_LAYOUTS.map((l, i) => (
                    <button
                        key={l.id}
                        onClick={() => setLayoutIdx(i)}
                        style={{
                            padding: "3px 8px", fontSize: "10px", borderRadius: "4px",
                            border: i === layoutIdx ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                            background: i === layoutIdx ? "var(--color-primary-glow)" : "transparent",
                            color: i === layoutIdx ? "var(--color-primary)" : "var(--color-text-muted)",
                            cursor: "pointer", fontWeight: i === layoutIdx ? 600 : 400,
                        }}
                    >
                        {l.name}
                    </button>
                ))}
            </div>

            <div style={{ display: "flex", gap: "3px", marginBottom: "6px", flexWrap: "wrap" }}>
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
                display: "flex", gap: SECTION_GAP,
                padding: "6px", background: "var(--color-bg-base)",
                borderRadius: "6px", border: "1px solid var(--color-border)",
            }}>
                {layout.sections.map((section) => (
                    <div
                        key={section.id}
                        style={{
                            display: "flex", flexDirection: "column", gap: GAP,
                            flexShrink: 0,
                        }}
                    >
                        {section.rows.map((row, rowIdx) => (
                            <div key={rowIdx} style={{ display: "flex", gap: GAP, minHeight: U }}>
                                {row.keys.map((key) => renderKey(key))}
                                {row.keys.length === 0 && <div style={{ height: U }} />}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export { layoutTotalWidth };
