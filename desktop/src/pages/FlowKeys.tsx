import { useTranslation } from "react-i18next";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
    AlertTriangle,
    ArrowLeftRight,
    Keyboard,
    PencilRuler,
    Repeat,
    Sparkles,
    ToggleLeft,
    ToggleRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import ProfileBar, { Profile } from "../components/FlowKeys/ProfileBar";
import MappingList from "../components/FlowKeys/MappingList";
import { KeyMapping } from "../components/FlowKeys/MappingModal";
import { ModifierKey, MODIFIER_KEY_MAP, getKeyLabelById } from "../components/FlowKeys/keyData";
import VisualKeyboard from "../components/FlowKeys/VisualKeyboard";
import "./FlowKeys.css";

function genId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const STORAGE_KEY = "yiboflow_key_profiles";
const ACTIVE_KEY = "yiboflow_key_active_profile";

function loadProfiles(): Profile[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return [];
}

function saveProfiles(profiles: Profile[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch {}
}

function loadActiveId(): string | null {
    return localStorage.getItem(ACTIVE_KEY);
}

function saveActiveId(id: string) {
    try {
        localStorage.setItem(ACTIVE_KEY, id);
    } catch {}
}

function effectiveSourceIds(mapping: KeyMapping): string[] {
    if (!mapping.source_key_id) return [];
    if (mapping.bidirectional && mapping.target_key_id) {
        return [mapping.source_key_id, mapping.target_key_id];
    }
    return [mapping.source_key_id];
}

function parseModifiers(label: string): ModifierKey[] {
    const parts = label.split("+");
    if (parts.length <= 1) return [];

    const known = new Set<ModifierKey>(["Ctrl", "Alt", "Shift", "Win"]);
    return parts.slice(0, -1).filter((part): part is ModifierKey => known.has(part as ModifierKey));
}

function buildComboLabel(baseLabel: string, modifiers: ModifierKey[]) {
    return modifiers.length > 0 ? `${modifiers.join("+")}+${baseLabel}` : baseLabel;
}

type KeyboardPickMode = "source" | "target";

export default function FlowKeys() {
    const { t } = useTranslation();

    const [profiles, setProfiles] = useState<Profile[]>(() => {
        const saved = loadProfiles();
        if (saved.length > 0) return saved;
        return [{ id: "default", name: "默认方案", active: true, mappings: [] }];
    });
    const [activeProfileId, setActiveProfileId] = useState<string>(() => loadActiveId() || "default");
    const [editMapping, setEditMapping] = useState<KeyMapping | null>(null);

    const [sourceKey, setSourceKey] = useState("");
    const [sourceKeyId, setSourceKeyId] = useState("");
    const [sourceModifiers, setSourceModifiers] = useState<ModifierKey[]>([]);
    const [capturingSource, setCapturingSource] = useState(false);
    const [liveModifiers, setLiveModifiers] = useState<ModifierKey[]>([]);

    const [targetKey, setTargetKey] = useState("");
    const [targetKeyId, setTargetKeyId] = useState("");
    const [targetModifiers, setTargetModifiers] = useState<ModifierKey[]>([]);
    const [keyboardPickMode, setKeyboardPickMode] = useState<KeyboardPickMode>("target");
    const [description, setDescription] = useState("");
    const [bidirectional, setBidirectional] = useState(false);
    const [keysEnabled, setKeysEnabled] = useState(true);
    const [focusedKeyId, setFocusedKeyId] = useState<string | null>(null);

    const pageRef = useRef<HTMLDivElement>(null);
    const [pageWidth, setPageWidth] = useState(1600);

    const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || profiles[0];
    const mappings = (activeProfile?.mappings || []) as KeyMapping[];
    const isEdit = !!editMapping;

    useEffect(() => {
        const el = pageRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setPageWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const stacked = pageWidth < 1700;
    const compactSelection = pageWidth < 1120;

    useEffect(() => {
        saveProfiles(profiles);
    }, [profiles]);

    useEffect(() => {
        saveActiveId(activeProfileId);
    }, [activeProfileId]);

    useEffect(() => {
        invoke("get_flow_rules").then((rules: any) => {
            setKeysEnabled(rules.default.flowkeys);
        }).catch((error) => console.error("Failed to load flowkeys feature state:", error));
    }, []);

    const toggleKeysEnabled = async () => {
        try {
            await invoke("toggle_default_feature", { feature: "flowkeys" });
            setKeysEnabled((prev) => !prev);
        } catch (error) {
            console.error("Failed to toggle flowkeys feature:", error);
        }
    };

    useEffect(() => {
        const activeMappings = profiles
            .filter((profile) => profile.active)
            .flatMap((profile) => profile.mappings as KeyMapping[])
            .filter((mapping) => mapping.enabled);

        const expanded = activeMappings.flatMap((mapping) => {
            const forward = {
                source_key: mapping.source_key,
                source_key_id: mapping.source_key_id,
                target_key: mapping.target_key,
                target_key_id: mapping.target_key_id,
                target_modifiers: mapping.target_modifiers.map((modifier: string) => modifier),
                enabled: mapping.enabled,
            };

            if (mapping.bidirectional) {
                const reverse = {
                    source_key: mapping.target_key,
                    source_key_id: mapping.target_key_id,
                    target_key: mapping.source_key,
                    target_key_id: mapping.source_key_id,
                    target_modifiers: [],
                    enabled: mapping.enabled,
                };
                return [forward, reverse];
            }

            return [forward];
        });

        invoke("update_key_mappings", { mappings: expanded }).catch((error) => {
            console.warn("[FlowKeys] Failed to sync mappings to backend:", error);
        });
    }, [profiles]);

    const captureKeyDown = useCallback((event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const modifiers: ModifierKey[] = [];
        if (event.ctrlKey) modifiers.push("Ctrl");
        if (event.altKey) modifiers.push("Alt");
        if (event.shiftKey) modifiers.push("Shift");
        if (event.metaKey) modifiers.push("Win");
        setLiveModifiers(modifiers);

        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;

        if (event.key === "Escape") {
            setCapturingSource(false);
            setLiveModifiers([]);
            return;
        }

        const modifierOnly = MODIFIER_KEY_MAP[event.code];
        if (modifierOnly) return;

        const keyLabel = modifiers.length > 0 ? [...modifiers, event.key].join("+") : event.key;
        setSourceKey(keyLabel);
        setSourceKeyId(event.code);
        setSourceModifiers(modifiers);
        setKeyboardPickMode("target");
        setCapturingSource(false);
        setLiveModifiers([]);
    }, []);

    useEffect(() => {
        if (!capturingSource) return;
        window.addEventListener("keydown", captureKeyDown);
        return () => window.removeEventListener("keydown", captureKeyDown);
    }, [capturingSource, captureKeyDown]);

    const loadEditState = useCallback((mapping: KeyMapping | null) => {
        if (mapping) {
            setSourceKey(mapping.source_key);
            setSourceKeyId(mapping.source_key_id);
            setSourceModifiers(parseModifiers(mapping.source_key));
            setTargetKey(mapping.target_key);
            setTargetKeyId(mapping.target_key_id);
            setTargetModifiers(mapping.target_modifiers);
            setDescription(mapping.description);
            setBidirectional(mapping.bidirectional ?? false);
            setKeyboardPickMode("target");
        } else {
            setSourceKey("");
            setSourceKeyId("");
            setSourceModifiers([]);
            setTargetKey("");
            setTargetKeyId("");
            setTargetModifiers([]);
            setDescription("");
            setBidirectional(false);
            setKeyboardPickMode("source");
        }
        setCapturingSource(false);
        setLiveModifiers([]);
    }, []);

    const updateProfiles = useCallback((updater: (prev: Profile[]) => Profile[]) => {
        setProfiles((prev) => updater(prev));
    }, []);

    const handleSelectProfile = (id: string) => {
        setActiveProfileId(id);
    };

    const handleAddProfile = () => {
        const newProfile: Profile = {
            id: genId("profile"),
            name: `${t("flowkeys.profile_new")} ${profiles.length + 1}`,
            active: true,
            mappings: [],
        };
        updateProfiles((prev) => [...prev, newProfile]);
        setActiveProfileId(newProfile.id);
    };

    const handleRenameProfile = (id: string, name: string) => {
        updateProfiles((prev) => prev.map((profile) => (profile.id === id ? { ...profile, name } : profile)));
    };

    const handleDuplicateProfile = (id: string) => {
        const source = profiles.find((profile) => profile.id === id);
        if (!source) return;

        const copy: Profile = {
            id: genId("profile"),
            name: `${source.name} (${t("flowkeys.profile_copy")})`,
            active: true,
            mappings: source.mappings.map((mapping: KeyMapping) => ({ ...mapping, id: genId("mapping") })),
        };
        updateProfiles((prev) => [...prev, copy]);
        setActiveProfileId(copy.id);
    };

    const handleDeleteProfile = (id: string) => {
        if (profiles.length <= 1) return;
        const remaining = profiles.filter((profile) => profile.id !== id);
        updateProfiles(() => remaining);
        if (activeProfileId === id) {
            setActiveProfileId(remaining[0]?.id || "default");
        }
    };

    const handleToggleProfileActive = (id: string) => {
        updateProfiles((prev) =>
            prev.map((profile) => (profile.id === id ? { ...profile, active: !profile.active } : profile))
        );
    };

    const updateProfileMappings = (profileId: string, nextMappings: KeyMapping[]) => {
        updateProfiles((prev) =>
            prev.map((profile) => (profile.id === profileId ? { ...profile, mappings: nextMappings } : profile))
        );
    };

    const handleToggleMapping = (mappingId: string) => {
        updateProfileMappings(
            activeProfileId,
            mappings.map((mapping) => (mapping.id === mappingId ? { ...mapping, enabled: !mapping.enabled } : mapping))
        );
    };

    const handleDeleteMapping = (mappingId: string) => {
        updateProfileMappings(activeProfileId, mappings.filter((mapping) => mapping.id !== mappingId));
        if (editMapping?.id === mappingId) {
            setEditMapping(null);
            loadEditState(null);
        }
    };

    const handleEditMapping = (mapping: KeyMapping) => {
        setEditMapping(mapping);
        loadEditState(mapping);
    };

    const handleStartNew = () => {
        setEditMapping(null);
        loadEditState(null);
    };

    const handleSelectSourceFromKeyboard = (keyId: string, label: string) => {
        setCapturingSource(false);
        setLiveModifiers([]);
        setSourceKey(label);
        setSourceKeyId(keyId);
        setSourceModifiers([]);
        setKeyboardPickMode("target");
        setFocusedKeyId(keyId);
    };

    const handleSelectTarget = (keyId: string, label: string, modifiers: ModifierKey[]) => {
        setTargetKeyId(keyId);
        setTargetModifiers(modifiers);
        setTargetKey(buildComboLabel(label, modifiers));
        setFocusedKeyId(keyId);
    };

    const handleCreateMappingFromDrag = (nextSourceKeyId: string, nextSourceLabel: string, nextTargetKeyId: string, nextTargetLabel: string) => {
        setEditMapping(null);
        setSourceKey(nextSourceLabel);
        setSourceKeyId(nextSourceKeyId);
        setSourceModifiers([]);
        setTargetKey(nextTargetLabel);
        setTargetKeyId(nextTargetKeyId);
        setTargetModifiers([]);
        setDescription("");
        setBidirectional(false);
        setKeyboardPickMode("target");
        setFocusedKeyId(nextSourceKeyId);
    };

    const swapSourceAndTarget = () => {
        const nextSourceKey = targetKey;
        const nextSourceKeyId = targetKeyId;
        const nextSourceModifiers = [...targetModifiers];

        setSourceKey(nextSourceKey);
        setSourceKeyId(nextSourceKeyId);
        setSourceModifiers(nextSourceModifiers);
        setTargetKey(sourceKey);
        setTargetKeyId(sourceKeyId);
        setTargetModifiers(sourceModifiers);
    };

    const otherMappings = useMemo(
        () => mappings.filter((mapping) => mapping.id !== editMapping?.id),
        [editMapping?.id, mappings]
    );

    const sourceCollision = !!(sourceKeyId && otherMappings.some((mapping) => effectiveSourceIds(mapping).includes(sourceKeyId)));
    const reverseCollision = !!(
        bidirectional &&
        targetKeyId &&
        otherMappings.some((mapping) => effectiveSourceIds(mapping).includes(targetKeyId))
    );
    const targetSourceWarning = !!(
        targetKeyId &&
        otherMappings.some((mapping) => mapping.enabled && effectiveSourceIds(mapping).includes(targetKeyId))
    );
    const noopMapping = !!(sourceKeyId && sourceKeyId === targetKeyId && targetModifiers.length === 0);
    const bidirectionalModifierWarning = bidirectional && targetModifiers.length > 0;

    const editorIssues = useMemo(() => {
        const issues: Array<{ level: "danger" | "warning"; message: string }> = [];

        if (sourceCollision) {
            issues.push({ level: "danger", message: t("flowkeys.conflict_source_duplicate") });
        }
        if (reverseCollision) {
            issues.push({ level: "danger", message: t("flowkeys.conflict_reverse_duplicate") });
        }
        if (targetSourceWarning && !reverseCollision) {
            issues.push({ level: "warning", message: t("flowkeys.conflict_target_source") });
        }
        if (noopMapping) {
            issues.push({ level: "warning", message: t("flowkeys.conflict_noop") });
        }
        if (bidirectionalModifierWarning) {
            issues.push({ level: "warning", message: t("flowkeys.conflict_bidirectional_modifiers") });
        }

        return issues;
    }, [bidirectionalModifierWarning, noopMapping, reverseCollision, sourceCollision, t, targetSourceWarning]);

    const { conflictSourceIds, conflictMappingIds } = useMemo(() => {
        const groups = new Map<string, string[]>();

        for (const mapping of mappings) {
            for (const keyId of effectiveSourceIds(mapping)) {
                if (!keyId) continue;
                const list = groups.get(keyId) || [];
                list.push(mapping.id);
                groups.set(keyId, list);
            }
        }

        const sourceIds = new Set<string>();
        const mappingIds = new Set<string>();

        groups.forEach((mappingIdsForKey, keyId) => {
            if (mappingIdsForKey.length > 1) {
                sourceIds.add(keyId);
                mappingIdsForKey.forEach((mappingId) => mappingIds.add(mappingId));
            }
        });

        return { conflictSourceIds: sourceIds, conflictMappingIds: mappingIds };
    }, [mappings]);

    const canSave = !!(sourceKey && targetKey) && !sourceCollision && !reverseCollision;

    const handleSaveMapping = () => {
        if (!canSave) return;

        const mapping: KeyMapping = {
            id: editMapping?.id || genId("mapping"),
            source_key: sourceKey,
            source_key_id: sourceKeyId,
            target_key: targetKey,
            target_key_id: targetKeyId,
            target_modifiers: targetModifiers,
            enabled: editMapping?.enabled ?? true,
            bidirectional,
            description,
        };

        if (editMapping) {
            updateProfileMappings(
                activeProfileId,
                mappings.map((item) => (item.id === mapping.id ? mapping : item))
            );
        } else {
            updateProfileMappings(activeProfileId, [...mappings, mapping]);
        }

        setEditMapping(null);
        loadEditState(null);
    };

    const totalMappings = mappings.length;
    const enabledMappings = mappings.filter((mapping) => mapping.enabled).length;
    const disabledMappings = totalMappings - enabledMappings;
    const summaryItems = [
        {
            label: t("flowkeys.summary_profile"),
            value: activeProfile?.name || t("flowkeys.profile_default"),
            note: activeProfile?.active ? t("flowkeys.summary_profile_on") : t("flowkeys.summary_profile_off"),
        },
        {
            label: t("flowkeys.summary_total"),
            value: `${totalMappings}`,
            note: t("flowkeys.mapping_count", { count: totalMappings }),
        },
        {
            label: t("flowkeys.summary_enabled"),
            value: `${enabledMappings}`,
            note: disabledMappings > 0
                ? t("flowkeys.summary_disabled_note", { count: disabledMappings })
                : t("flowkeys.summary_clean"),
        },
        {
            label: t("flowkeys.legend_conflict"),
            value: `${conflictMappingIds.size}`,
            note: conflictMappingIds.size > 0 ? t("flowkeys.summary_conflict_note") : t("flowkeys.summary_clean"),
        },
    ];

    return (
        <div ref={pageRef} className="flowkeys-page">
            <div className="flowkeys-header">
                <div className="flowkeys-title-group">
                    <h1 className="flowkeys-title">
                        <Keyboard size={26} color="var(--color-primary)" />
                        {t("flowkeys.title")}
                    </h1>
                    <p className="flowkeys-subtitle">
                        {t("flowkeys.subtitle")}
                        {" "}
                        {t("flowkeys.subtitle_extended")}
                    </p>
                </div>

                <button
                    onClick={toggleKeysEnabled}
                    style={{
                        background: keysEnabled ? "rgba(34, 197, 94, 0.12)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${keysEnabled ? "rgba(34, 197, 94, 0.34)" : "var(--color-border)"}`,
                        color: keysEnabled ? "#22c55e" : "var(--color-text-muted)",
                        padding: "10px 16px",
                        borderRadius: "999px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "12px",
                        whiteSpace: "nowrap",
                        transition: "all 0.15s",
                        minHeight: "40px",
                    }}
                >
                    {keysEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    {keysEnabled ? t("flowkeys.feature_on") : t("flowkeys.feature_off")}
                </button>
            </div>

            <div className={`flowkeys-shell${stacked ? " is-stacked" : ""}`}>
                <aside className="flowkeys-sidebar">
                    <section className="flowkeys-card flowkeys-card--profiles">
                        <div className="flowkeys-card-header">
                            <div>
                                <h2 className="flowkeys-card-title">{t("flowkeys.profile_section_title")}</h2>
                                <p className="flowkeys-card-subtitle">{t("flowkeys.profile_section_subtitle")}</p>
                            </div>
                            <span className="flowkeys-pill">{t("flowkeys.mapping_count", { count: totalMappings })}</span>
                        </div>
                        <div className="flowkeys-card-body">
                            <ProfileBar
                                profiles={profiles}
                                activeProfileId={activeProfileId}
                                onSelect={handleSelectProfile}
                                onAdd={handleAddProfile}
                                onRename={handleRenameProfile}
                                onDuplicate={handleDuplicateProfile}
                                onDelete={handleDeleteProfile}
                                onToggleActive={handleToggleProfileActive}
                                compact
                            />
                        </div>
                    </section>

                    <section className="flowkeys-card">
                        <div className="flowkeys-card-header">
                            <div>
                                <h2 className="flowkeys-card-title">{t("flowkeys.mapping_section_title")}</h2>
                                <p className="flowkeys-card-subtitle">{t("flowkeys.mapping_section_subtitle")}</p>
                            </div>
                            <button className="flowkeys-button is-secondary" onClick={handleStartNew}>
                                {isEdit ? t("flowkeys.modal_add") : t("flowkeys.btn_add_mapping")}
                            </button>
                        </div>
                        <div className="flowkeys-card-body" style={{ maxHeight: stacked ? "none" : "calc(100vh - 280px)", overflowY: "auto" }}>
                            <MappingList
                                mappings={mappings}
                                onToggle={handleToggleMapping}
                                onEdit={handleEditMapping}
                                onDelete={handleDeleteMapping}
                                selectedMappingId={editMapping?.id || null}
                                conflictIds={conflictMappingIds}
                                focusedKeyId={focusedKeyId}
                            />
                        </div>
                    </section>
                </aside>

                <section className="flowkeys-workspace">
                    <div className="flowkeys-card">
                        <div className="flowkeys-card-header">
                            <div>
                                <h2 className="flowkeys-card-title">
                                    {isEdit ? t("flowkeys.modal_edit") : t("flowkeys.editor_title")}
                                </h2>
                                <p className="flowkeys-card-subtitle">{t("flowkeys.editor_subtitle")}</p>
                            </div>
                            {focusedKeyId && (
                                <span className="flowkeys-pill">
                                    {t("flowkeys.mapping_focus_label")} {getKeyLabelById(focusedKeyId)}
                                </span>
                            )}
                        </div>

                        <div className="flowkeys-card-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            <div className="flowkeys-summary-grid">
                                {summaryItems.map((item) => (
                                    <div key={item.label} className="flowkeys-summary-card">
                                        <span className="flowkeys-summary-label">{item.label}</span>
                                        <span className="flowkeys-summary-value">{item.value}</span>
                                        <span className="flowkeys-summary-note">{item.note}</span>
                                    </div>
                                ))}
                            </div>

                            <div className={`flowkeys-selection-grid${compactSelection ? " is-compact" : ""}`}>
                                <button
                                    className={`flowkeys-selection-card${keyboardPickMode === "source" ? " is-active" : ""}`}
                                    onClick={() => {
                                        setKeyboardPickMode("source");
                                        setCapturingSource(true);
                                    }}
                                    style={{ cursor: "pointer" }}
                                >
                                    <div className="flowkeys-selection-top">
                                        <span className="flowkeys-selection-title">
                                            <PencilRuler size={14} />
                                            {t("flowkeys.source_label")}
                                        </span>
                                    </div>

                                    <div className="flowkeys-selection-value">
                                        <div className="flowkeys-selection-main">
                                            {capturingSource
                                                ? (liveModifiers.length > 0
                                                    ? `${liveModifiers.join(" + ")} + ...`
                                                    : t("flowkeys.capturing"))
                                                : ([...sourceModifiers, sourceKey].filter(Boolean).join(" + ") || t("flowkeys.click_to_capture"))}
                                        </div>
                                        <div className="flowkeys-selection-hint">{t("flowkeys.source_card_hint")}</div>
                                    </div>
                                </button>

                                <div className={`flowkeys-action-stack${compactSelection ? " is-row" : ""}`}>
                                    <button className="flowkeys-icon-button" onClick={swapSourceAndTarget} title={t("flowkeys.btn_swap")}>
                                        <ArrowLeftRight size={16} />
                                    </button>
                                    <button
                                        className={`flowkeys-switch${bidirectional ? " is-on" : ""}`}
                                        onClick={() => setBidirectional((prev) => !prev)}
                                        title={t("flowkeys.btn_bidirectional")}
                                    >
                                        <Repeat size={14} />
                                        {t("flowkeys.bidirectional")}
                                    </button>
                                </div>

                                <button
                                    className={`flowkeys-selection-card${keyboardPickMode === "target" ? " is-active" : ""}`}
                                    onClick={() => {
                                        setCapturingSource(false);
                                        setLiveModifiers([]);
                                        setKeyboardPickMode("target");
                                    }}
                                    style={{ cursor: "pointer" }}
                                >
                                    <div className="flowkeys-selection-top">
                                        <span className="flowkeys-selection-title">
                                            <Sparkles size={14} />
                                            {t("flowkeys.target_label")}
                                        </span>
                                    </div>

                                    <div className="flowkeys-selection-value">
                                        <div className="flowkeys-selection-main">
                                            {[...targetModifiers, targetKey].filter(Boolean).join(" + ") || t("flowkeys.select_target")}
                                        </div>
                                        <div className="flowkeys-selection-hint">{t("flowkeys.target_card_hint")}</div>
                                    </div>
                                </button>
                            </div>

                            {editorIssues.map((issue) => (
                                <div
                                    key={issue.message}
                                    className={`flowkeys-banner ${issue.level === "danger" ? "is-danger" : "is-warning"}`}
                                >
                                    <div className="flowkeys-banner-title">
                                        <AlertTriangle size={14} />
                                        {issue.level === "danger" ? t("flowkeys.conflict_title") : t("flowkeys.warning_title")}
                                    </div>
                                    <div className="flowkeys-banner-body">{issue.message}</div>
                                </div>
                            ))}

                            <VisualKeyboard
                                mappings={mappings}
                                sourceKeyId={sourceKeyId}
                                targetKeyId={targetKeyId}
                                onInspectKey={setFocusedKeyId}
                                onDragCreateMapping={handleCreateMappingFromDrag}
                                activeModifiers={targetModifiers}
                                onToggleModifier={(modifier) => {
                                    setTargetModifiers((prev) =>
                                        prev.includes(modifier)
                                            ? prev.filter((item) => item !== modifier)
                                            : [...prev, modifier]
                                    );
                                }}
                                interactionMode={keyboardPickMode}
                                onSelectSourceKey={handleSelectSourceFromKeyboard}
                                onSelectTargetKey={handleSelectTarget}
                                conflictKeyIds={conflictSourceIds}
                                showLegend
                            />

                            <div className="flowkeys-editor-footer">
                                <div className="flowkeys-description-group">
                                    <label className="flowkeys-label">{t("flowkeys.description_label")}</label>
                                    <input
                                        className="flowkeys-input"
                                        value={description}
                                        onChange={(event) => setDescription(event.target.value)}
                                        placeholder={t("flowkeys.placeholder_desc")}
                                    />
                                </div>

                                <div className="flowkeys-footer-actions">
                                    {isEdit && (
                                        <button className="flowkeys-button is-secondary" onClick={handleStartNew}>
                                            {t("flowkeys.modal_cancel")}
                                        </button>
                                    )}
                                    <button
                                        className="flowkeys-button is-primary"
                                        onClick={handleSaveMapping}
                                        disabled={!canSave}
                                    >
                                        {t("flowkeys.modal_save")}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
