import { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { KEYBOARD_LAYOUTS, MODIFIER_KEYS, ModifierKey, KeyDef, KeyRow, KeySection } from "./keyData";

export interface KeyboardMappingPreview {
    id: string;
    source_key: string;
    source_key_id: string;
    target_key: string;
    target_key_id: string;
    enabled: boolean;
    bidirectional: boolean;
    description?: string;
}

interface VisualKeyboardProps {
    onSelectKey?: (keyId: string, label: string, modifiers: ModifierKey[]) => void;
    onSelectSourceKey?: (keyId: string, label: string) => void;
    onSelectTargetKey?: (keyId: string, label: string, modifiers: ModifierKey[]) => void;
    onInspectKey?: (keyId: string) => void;
    onDragCreateMapping?: (sourceKeyId: string, sourceLabel: string, targetKeyId: string, targetLabel: string) => void;
    selectedKeyId?: string;
    sourceKeyId?: string;
    targetKeyId?: string;
    mappedKeys?: Set<string>;
    conflictKeyIds?: Set<string>;
    mappings?: KeyboardMappingPreview[];
    activeModifiers?: ModifierKey[];
    onToggleModifier?: (mod: ModifierKey) => void;
    interactionMode?: "source" | "target";
    showLegend?: boolean;
}

type SourcePreview = {
    targetLabel: string;
    enabled: boolean;
    bidirectional: boolean;
    count: number;
};

type LayoutRows = KeySection[][];

function isEmptyRow(row: KeyRow): boolean {
    return row.keys.length === 0;
}

function trimDetachedSection(section: KeySection): KeySection {
    let start = 0;
    let end = section.rows.length;

    while (start < end && isEmptyRow(section.rows[start])) start += 1;
    while (end > start && isEmptyRow(section.rows[end - 1])) end -= 1;

    return {
        ...section,
        rows: section.rows.slice(start, end),
        marginLeft: 0,
    };
}

function rowWidthUnits(row: KeyRow): number {
    return row.keys.reduce((sum, key) => sum + (key.width || 1), 0);
}

function sectionWidthUnits(section: KeySection): number {
    return Math.max(...section.rows.map(rowWidthUnits)) + (section.marginLeft || 0);
}

export function layoutTotalWidth(sections: KeySection[]): number {
    const sectionGapUnits = 0.28;
    return sections.reduce((sum, section, index) => {
        return sum + sectionWidthUnits(section) + (index > 0 ? sectionGapUnits : 0);
    }, 0);
}

const MIN_U = 16;
const GAP = 4;
const SECTION_GAP = 12;
const ROW_GAP = 8;
const PADDING = 12;

function canRenderRows(width: number, rows: LayoutRows, minUnit: number) {
    const availableWidth = Math.max(240, width - PADDING);
    return rows.every((sectionRow) => {
        const rowUnits = sectionRow.reduce((sum, section) => sum + sectionWidthUnits(section), 0);
        const rowGapPixels = SECTION_GAP * Math.max(0, sectionRow.length - 1);
        return rowUnits * minUnit + rowGapPixels <= availableWidth;
    });
}

function buildSectionRows(layoutId: string, sections: KeySection[], width: number): LayoutRows {
    if (sections.length <= 1) return [sections];

    if (layoutId === "ansi") {
        const candidates: LayoutRows[] = [
            [sections],
            [[sections[0], sections[1]], [sections[2], sections[3]]],
            [[sections[0]], [sections[1], sections[2], sections[3]]],
            [[sections[0]], [sections[1], sections[2]], [sections[3]]],
        ];
        const minUnits = [21.5, 20, 18, 16];

        for (let index = 0; index < candidates.length; index += 1) {
            if (canRenderRows(width, candidates[index], minUnits[index])) {
                return candidates[index];
            }
        }

        return candidates[candidates.length - 1];
    }

    if (layoutId === "tkl") {
        const candidates: LayoutRows[] = [
            [sections],
            [[sections[0]], [sections[1], sections[2]]],
        ];
        const minUnits = [22, 17];

        for (let index = 0; index < candidates.length; index += 1) {
            if (canRenderRows(width, candidates[index], minUnits[index])) {
                return candidates[index];
            }
        }

        return candidates[candidates.length - 1];
    }

    return [sections];
}

function isAccessoryOnlyRow(sectionRow: KeySection[]) {
    return sectionRow.every((section) => section.id !== "main" && section.id !== "main_nof");
}

function shouldDistributeAccessoryRow(sectionRow: KeySection[], width: number) {
    return (
        sectionRow.length >= 3 &&
        width >= 980 &&
        sectionRow[0]?.id === "nav" &&
        sectionRow[1]?.id === "arrows"
    );
}

function effectiveSourceIds(mapping: KeyboardMappingPreview): string[] {
    if (!mapping.source_key_id) return [];
    if (mapping.bidirectional && mapping.target_key_id) {
        return [mapping.source_key_id, mapping.target_key_id];
    }
    return [mapping.source_key_id];
}

function createPreviewForSource(mapping: KeyboardMappingPreview, sourceId: string): SourcePreview {
    const reversed = mapping.bidirectional && sourceId === mapping.target_key_id;
    return {
        targetLabel: reversed ? mapping.source_key : mapping.target_key,
        enabled: mapping.enabled,
        bidirectional: mapping.bidirectional,
        count: 1,
    };
}

export default function VisualKeyboard({
    onSelectKey,
    onSelectSourceKey,
    onSelectTargetKey,
    onInspectKey,
    onDragCreateMapping,
    selectedKeyId,
    sourceKeyId,
    targetKeyId,
    mappedKeys,
    conflictKeyIds,
    mappings,
    activeModifiers = [],
    onToggleModifier,
    interactionMode = "target",
    showLegend = false,
}: VisualKeyboardProps) {
    const { t } = useTranslation();
    const [layoutIdx, setLayoutIdx] = useState(0);
    const layout = KEYBOARD_LAYOUTS[layoutIdx];
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [dragSourceId, setDragSourceId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragStarted, setDragStarted] = useState(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!dragSourceId) return;

        const handleWindowMouseUp = () => {
            setDragSourceId(null);
            setDragOverId(null);
            setDragStarted(false);
        };

        window.addEventListener("mouseup", handleWindowMouseUp);
        return () => window.removeEventListener("mouseup", handleWindowMouseUp);
    }, [dragSourceId]);

    const sectionRows = useMemo(
        () => buildSectionRows(layout.id, layout.sections, containerWidth),
        [containerWidth, layout.id, layout.sections]
    );

    const U = useMemo(() => {
        const availableWidth = Math.max(240, containerWidth - PADDING);
        const maxU =
            containerWidth >= 1680
                ? 52
                : containerWidth >= 1480
                    ? 48
                    : containerWidth >= 1240
                        ? 44
                        : containerWidth >= 980
                            ? 40
                            : containerWidth >= 760
                                ? 34
                                : 28;
        const widestRowUnits = Math.max(
            ...sectionRows.map((sectionRow) =>
                sectionRow.reduce((sum, section, index) => {
                    return sum + sectionWidthUnits(section) + (index > 0 ? SECTION_GAP / maxU : 0);
                }, 0)
            ),
            1
        );

        const sectionGapPixels = SECTION_GAP * Math.max(0, Math.max(...sectionRows.map((row) => row.length)) - 1);
        const idealU = (availableWidth - sectionGapPixels) / widestRowUnits;
        return Math.max(MIN_U, Math.min(maxU, idealU));
    }, [containerWidth, sectionRows]);

    const previewBySourceId = useMemo(() => {
        const previewMap = new Map<string, SourcePreview>();
        for (const mapping of mappings || []) {
            for (const keyId of effectiveSourceIds(mapping)) {
                const existing = previewMap.get(keyId);
                const next = createPreviewForSource(mapping, keyId);
                if (!existing) {
                    previewMap.set(keyId, next);
                    continue;
                }

                const preferred = existing.enabled ? existing : next;
                previewMap.set(keyId, {
                    ...preferred,
                    count: existing.count + 1,
                });
            }
        }
        return previewMap;
    }, [mappings]);

    const stateBySourceId = useMemo(() => {
        const enabled = new Set<string>();
        const disabled = new Set<string>();

        for (const mapping of mappings || []) {
            for (const keyId of effectiveSourceIds(mapping)) {
                if (mapping.enabled) {
                    enabled.add(keyId);
                    disabled.delete(keyId);
                } else if (!enabled.has(keyId)) {
                    disabled.add(keyId);
                }
            }
        }

        if (mappedKeys) {
            for (const keyId of mappedKeys) {
                if (!disabled.has(keyId)) enabled.add(keyId);
            }
        }

        return { enabled, disabled };
    }, [mappedKeys, mappings]);

    const layoutKeys = useMemo(
        () => layout.sections.flatMap((section) => section.rows.flatMap((row) => row.keys)),
        [layout.sections]
    );

    const visibleKeyIds = useMemo(() => {
        return new Set(
            layoutKeys
                .filter((key) => !key.id.startsWith("_blank_"))
                .map((key) => key.id)
        );
    }, [layoutKeys]);

    const summary = useMemo(() => {
        const enabledCount = Array.from(visibleKeyIds).filter((keyId) => stateBySourceId.enabled.has(keyId)).length;
        const disabledCount = Array.from(visibleKeyIds).filter((keyId) => stateBySourceId.disabled.has(keyId)).length;
        const conflictCount = Array.from(visibleKeyIds).filter((keyId) => conflictKeyIds?.has(keyId)).length;
        const defaultCount = visibleKeyIds.size - enabledCount - disabledCount;
        return { enabledCount, disabledCount, conflictCount, defaultCount };
    }, [conflictKeyIds, stateBySourceId.disabled, stateBySourceId.enabled, visibleKeyIds]);

    const handlePickKey = (key: KeyDef) => {
        onInspectKey?.(key.id);

        if (onSelectSourceKey && interactionMode === "source") {
            onSelectSourceKey(key.id, key.label);
            return;
        }

        const modifiers = [...activeModifiers];
        if (onSelectTargetKey) {
            onSelectTargetKey(key.id, key.label, modifiers);
            return;
        }

        onSelectKey?.(key.id, key.label, modifiers);
    };

    const renderKey = (key: KeyDef) => {
        const keyWidth = key.width || 1;
        const width = keyWidth * U + (keyWidth - 1) * GAP;

        if (key.id.startsWith("_blank_")) {
            return <div key={key.id} style={{ width, height: U * 1.06, flexShrink: 0 }} />;
        }

        const preview = previewBySourceId.get(key.id);
        const isEnabled = stateBySourceId.enabled.has(key.id);
        const isDisabled = stateBySourceId.disabled.has(key.id);
        const isConflict = !!conflictKeyIds?.has(key.id);
        const isSourceSelected = sourceKeyId === key.id;
        const isTargetSelected = (targetKeyId || selectedKeyId) === key.id;
        const isDragSource = dragSourceId === key.id;
        const isDragTarget = dragOverId === key.id && dragStarted && dragSourceId !== key.id;
        const labelLength = key.label.length;
        const labelSize = labelLength > 4 ? Math.max(8, U * 0.21) : Math.max(9, U * 0.28);
        const previewSize = Math.max(7, U * 0.18);

        const palette = isEnabled
            ? {
                bg: "linear-gradient(180deg, rgba(16, 185, 129, 0.22), rgba(16, 185, 129, 0.08))",
                border: "rgba(52, 211, 153, 0.48)",
                shadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(16,185,129,0.12)",
                text: "var(--color-text-main)",
            }
            : isDisabled
                ? {
                    bg: "linear-gradient(180deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.06))",
                    border: "rgba(251, 191, 36, 0.42)",
                    shadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 14px rgba(245,158,11,0.12)",
                    text: "var(--color-text-main)",
                }
                : {
                    bg: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
                    border: "var(--color-border)",
                    shadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
                    text: "var(--color-text-main)",
                };

        const selectionOutline = isDragSource
            ? "0 0 0 2px rgba(59,130,246,0.42)"
            : isDragTarget
                ? "0 0 0 2px rgba(16,185,129,0.42)"
                : isSourceSelected && isTargetSelected
            ? "0 0 0 2px rgba(59, 130, 246, 0.32), 0 0 0 4px rgba(249, 115, 22, 0.2)"
            : isSourceSelected
                ? "0 0 0 2px rgba(249, 115, 22, 0.45)"
                : isTargetSelected
                    ? "0 0 0 2px var(--color-primary-glow)"
                    : undefined;

        return (
            <button
                key={key.id}
                title={preview ? `${key.label} ${preview.bidirectional ? "⇄" : "→"} ${preview.targetLabel}` : key.label}
                style={{
                    width,
                    minWidth: width,
                    height: U * 1.1,
                    padding: preview ? "5px 5px 6px" : "5px",
                    borderRadius: Math.max(8, U * 0.18),
                    border: isConflict ? "1px solid rgba(248, 113, 113, 0.56)" : `1px solid ${palette.border}`,
                    background: palette.bg,
                    color: palette.text,
                    cursor: "pointer",
                    transition: "transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease, background 120ms ease",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    justifyContent: "space-between",
                    position: "relative",
                    flexShrink: 0,
                    boxShadow: `${palette.shadow}${selectionOutline ? `, ${selectionOutline}` : ""}${isConflict ? ", 0 0 0 1px rgba(239,68,68,0.18)" : ""}`,
                    overflow: "hidden",
                }}
                onMouseEnter={(event) => {
                    if ((event.buttons & 1) === 1 && dragSourceId && dragSourceId !== key.id) {
                        setDragStarted(true);
                        setDragOverId(key.id);
                    }
                    event.currentTarget.style.transform = "translateY(-1px)";
                    event.currentTarget.style.borderColor = isConflict
                        ? "rgba(248, 113, 113, 0.72)"
                        : (isSourceSelected || isTargetSelected)
                            ? "var(--color-primary)"
                            : "rgba(255,255,255,0.18)";
                }}
                onMouseLeave={(event) => {
                    event.currentTarget.style.transform = "translateY(0)";
                    event.currentTarget.style.borderColor = isConflict
                        ? "rgba(248, 113, 113, 0.56)"
                        : `${palette.border}`;
                }}
                onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    setDragSourceId(key.id);
                    setDragOverId(key.id);
                    setDragStarted(false);
                }}
                onMouseUp={() => {
                    if (dragSourceId) {
                        if (dragStarted && dragSourceId !== key.id) {
                            const sourceKey = layoutKeys.find((item) => item.id === dragSourceId);

                            if (sourceKey) {
                                onDragCreateMapping?.(sourceKey.id, sourceKey.label, key.id, key.label);
                            }
                            setDragSourceId(null);
                            setDragOverId(null);
                            setDragStarted(false);
                            return;
                        }

                        setDragSourceId(null);
                        setDragOverId(null);
                        setDragStarted(false);
                    }

                    handlePickKey(key);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handlePickKey(key);
                    }
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px" }}>
                    <span
                        style={{
                            fontSize: labelSize,
                            fontWeight: 700,
                            fontFamily: "monospace",
                            letterSpacing: labelLength <= 2 ? "0.02em" : "0",
                            lineHeight: 1.1,
                        }}
                    >
                        {key.label}
                    </span>
                    {isConflict && (
                        <span
                            style={{
                                minWidth: "16px",
                                height: "16px",
                                borderRadius: "999px",
                                padding: "0 5px",
                                background: "rgba(239, 68, 68, 0.18)",
                                color: "#fca5a5",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "10px",
                                fontWeight: 800,
                                flexShrink: 0,
                            }}
                        >
                            !
                        </span>
                    )}
                </div>

                {preview ? (
                    <div
                        style={{
                            fontSize: previewSize,
                            fontWeight: 600,
                            color: isEnabled ? "rgba(209, 250, 229, 0.96)" : "rgba(255, 237, 213, 0.92)",
                            opacity: 0.95,
                            lineHeight: 1.15,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontFamily: "var(--font-family)",
                        }}
                    >
                        {preview.bidirectional ? "⇄ " : "→ "}
                        {preview.targetLabel}
                        {preview.count > 1 ? ` +${preview.count - 1}` : ""}
                    </div>
                ) : (
                    <span style={{ fontSize: previewSize, opacity: 0.55, fontWeight: 600 }}>
                        {isSourceSelected ? t("flowkeys.kbd_source_selected") : isTargetSelected ? t("flowkeys.kbd_target_selected") : ""}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div ref={containerRef} style={{ width: "100%", minWidth: 0 }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "10px",
                    flexWrap: "wrap",
                    marginBottom: "10px",
                    alignItems: "flex-start",
                }}
            >
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {KEYBOARD_LAYOUTS.map((item, index) => (
                        <button
                            key={item.id}
                            onClick={() => setLayoutIdx(index)}
                            style={{
                                padding: "8px 14px",
                                borderRadius: "999px",
                                border: index === layoutIdx ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                                background: index === layoutIdx ? "linear-gradient(180deg, rgba(94,106,210,0.18), rgba(94,106,210,0.1))" : "rgba(255,255,255,0.04)",
                                color: index === layoutIdx ? "var(--color-primary)" : "var(--color-text-main)",
                                cursor: "pointer",
                                fontWeight: 800,
                                fontSize: "12px",
                                letterSpacing: "0.01em",
                                boxShadow: index === layoutIdx ? "0 8px 20px rgba(94,106,210,0.14)" : "inset 0 1px 0 rgba(255,255,255,0.05)",
                            }}
                        >
                            {item.name}
                        </button>
                    ))}
                </div>

                {showLegend && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {[
                            {
                                label: `${t("flowkeys.legend_enabled")} ${summary.enabledCount}`,
                                dot: "linear-gradient(180deg, rgba(16,185,129,0.88), rgba(5,150,105,0.76))",
                            },
                            {
                                label: `${t("flowkeys.legend_disabled")} ${summary.disabledCount}`,
                                dot: "linear-gradient(180deg, rgba(245,158,11,0.88), rgba(217,119,6,0.8))",
                            },
                            {
                                label: `${t("flowkeys.legend_default")} ${summary.defaultCount}`,
                                dot: "linear-gradient(180deg, rgba(148,163,184,0.82), rgba(100,116,139,0.72))",
                            },
                            {
                                label: `${t("flowkeys.legend_conflict")} ${summary.conflictCount}`,
                                dot: "linear-gradient(180deg, rgba(248,113,113,0.92), rgba(239,68,68,0.78))",
                            },
                        ].map((item) => (
                            <div
                                key={item.label}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 12px",
                                    borderRadius: "999px",
                                    border: "1px solid var(--color-border)",
                                    background: "rgba(255,255,255,0.04)",
                                    color: "var(--color-text-main)",
                                    fontSize: "11px",
                                    fontWeight: 800,
                                }}
                            >
                                <span
                                    style={{
                                        width: "10px",
                                        height: "10px",
                                        borderRadius: "999px",
                                        background: item.dot,
                                        flexShrink: 0,
                                    }}
                                />
                                {item.label}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                {MODIFIER_KEYS.map((modifier) => (
                    <button
                        key={modifier}
                        onClick={() => onToggleModifier?.(modifier)}
                        style={{
                            padding: "6px 12px",
                            fontSize: "12px",
                            borderRadius: "999px",
                            border: activeModifiers.includes(modifier) ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                            background: activeModifiers.includes(modifier)
                                ? "linear-gradient(180deg, rgba(94,106,210,0.18), rgba(94,106,210,0.1))"
                                : "rgba(255,255,255,0.04)",
                            color: activeModifiers.includes(modifier) ? "var(--color-primary)" : "var(--color-text-main)",
                            cursor: "pointer",
                            fontWeight: 800,
                            fontFamily: "monospace",
                            boxShadow: activeModifiers.includes(modifier)
                                ? "0 8px 20px rgba(94,106,210,0.12)"
                                : "inset 0 1px 0 rgba(255,255,255,0.05)",
                        }}
                    >
                        {modifier}
                    </button>
                ))}
            </div>

            <div
                style={{
                    padding: "12px",
                    borderRadius: "18px",
                    border: "1px solid var(--color-border)",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                    overflow: "hidden",
                }}
            >
                <div style={{ display: "flex", flexDirection: "column", gap: `${ROW_GAP}px` }}>
                    {sectionRows.map((sectionRow, rowIndex) => (
                        (() => {
                            const accessoryOnlyRow = isAccessoryOnlyRow(sectionRow);
                            const renderedSections = accessoryOnlyRow
                                ? sectionRow.map((section) => trimDetachedSection(section))
                                : sectionRow;
                            const distributeAccessoryRow = shouldDistributeAccessoryRow(sectionRow, containerWidth);
                            const accessoryGap = distributeAccessoryRow
                                ? (containerWidth >= 1280 ? SECTION_GAP + 14 : SECTION_GAP + 8)
                                : (containerWidth >= 1280 ? SECTION_GAP + 10 : SECTION_GAP + 6);

                            return (
                                <div
                                    key={`${layout.id}-row-${rowIndex}`}
                                    style={{
                                        display: "flex",
                                        gap: `${accessoryOnlyRow ? accessoryGap : SECTION_GAP}px`,
                                        flexWrap: "nowrap",
                                        alignItems: accessoryOnlyRow ? "flex-start" : "flex-start",
                                        justifyContent: accessoryOnlyRow && distributeAccessoryRow ? "space-between" : "flex-start",
                                        minWidth: 0,
                                        width: "100%",
                                    }}
                                >
                                    {renderedSections.map((section) => (
                                        <div
                                            key={section.id}
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: `${GAP}px`,
                                                flexShrink: accessoryOnlyRow ? 1 : 0,
                                                marginLeft: accessoryOnlyRow ? 0 : (section.marginLeft ? section.marginLeft * U : 0),
                                                marginTop: accessoryOnlyRow && section.id === "arrows" && distributeAccessoryRow ? U * 1.55 : 0,
                                            }}
                                        >
                                            {section.rows.map((row, keyRowIndex) => (
                                                <div key={`${section.id}-${keyRowIndex}`} style={{ display: "flex", gap: `${GAP}px`, minHeight: U }}>
                                                    {row.keys.map((key) => renderKey(key))}
                                                    {row.keys.length === 0 && <div style={{ height: U * 1.06 }} />}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            );
                        })()
                    ))}
                </div>
            </div>
        </div>
    );
}
