import { useTranslation } from "react-i18next";
import { useState, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import { Keyboard, ArrowLeftRight, Repeat, ToggleRight, ToggleLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import ProfileBar, { Profile } from "../components/FlowKeys/ProfileBar";
import MappingList from "../components/FlowKeys/MappingList";
import { KeyMapping } from "../components/FlowKeys/MappingModal";
import { ModifierKey, MODIFIER_KEY_MAP } from "../components/FlowKeys/keyData";
import VisualKeyboard from "../components/FlowKeys/VisualKeyboard";
import KeyCategoryList from "../components/FlowKeys/KeyCategoryList";

function genId() {
    return `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

type TargetMode = "keyboard" | "list";

export default function FlowKeys() {
    const { t } = useTranslation();

    const [profiles, setProfiles] = useState<Profile[]>(() => {
        const saved = loadProfiles();
        if (saved.length > 0) return saved;
        return [{ id: "default", name: "默认方案", active: true, mappings: [] }];
    });
    const [activeProfileId, setActiveProfileId] = useState<string>(() => {
        return loadActiveId() || "default";
    });
    const [editMapping, setEditMapping] = useState<KeyMapping | null>(null);

    // Editor state
    const [sourceKey, setSourceKey] = useState("");
    const [sourceKeyId, setSourceKeyId] = useState("");
    const [sourceModifiers, setSourceModifiers] = useState<ModifierKey[]>([]);
    const [capturingSource, setCapturingSource] = useState(false);
    const [liveModifiers, setLiveModifiers] = useState<ModifierKey[]>([]);
    const [targetKey, setTargetKey] = useState("");
    const [targetKeyId, setTargetKeyId] = useState("");
    const [targetModifiers, setTargetModifiers] = useState<ModifierKey[]>([]);
    const [targetMode, setTargetMode] = useState<TargetMode>("keyboard");
    const [description, setDescription] = useState("");
    const [bidirectional, setBidirectional] = useState(false);
    const [keysEnabled, setKeysEnabled] = useState(true);

    const isEdit = !!editMapping;

    const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

    // Layout measurement
    const contentRef = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState({ contentH: 400, listW: 380 });

    useLayoutEffect(() => {
        const el = contentRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const h = entry.contentRect.height;
                const totalW = entry.contentRect.width;
                const gap = 12;
                const minListW = 280;
                const minEditW = 360;
                let listW = Math.round(totalW * 0.36);
                const maxListW = Math.max(minListW, totalW - gap - minEditW);
                listW = Math.max(minListW, Math.min(listW, maxListW));
                setLayout({ contentH: Math.floor(h), listW });
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Persist on change
    useEffect(() => {
        saveProfiles(profiles);
    }, [profiles]);

    useEffect(() => {
        saveActiveId(activeProfileId);
    }, [activeProfileId]);

    // Load global feature toggle state
    useEffect(() => {
        invoke("get_flow_rules").then((rules: any) => {
            setKeysEnabled(rules.default.flowkeys);
        }).catch(e => console.error("Failed to load flowkeys feature state:", e));
    }, []);

    const toggleKeysEnabled = async () => {
        try {
            await invoke("toggle_default_feature", { feature: "flowkeys" });
            setKeysEnabled(!keysEnabled);
        } catch (e) {
            console.error("Failed to toggle flowkeys feature:", e);
        }
    };

    // Sync active mappings to backend hook
    useEffect(() => {
        const activeMappings = profiles
            .filter((p) => p.active)
            .flatMap((p) => p.mappings as KeyMapping[])
            .filter((m) => m.enabled);

        const expanded = activeMappings.flatMap((m) => {
            const forward = {
                source_key: m.source_key,
                source_key_id: m.source_key_id,
                target_key: m.target_key,
                target_key_id: m.target_key_id,
                target_modifiers: m.target_modifiers.map((mod: string) => mod),
                enabled: m.enabled,
            };
            if (m.bidirectional) {
                const reverse = {
                    source_key: m.target_key,
                    source_key_id: m.target_key_id,
                    target_key: m.source_key,
                    target_key_id: m.source_key_id,
                    target_modifiers: [],
                    enabled: m.enabled,
                };
                return [forward, reverse];
            }
            return [forward];
        });

        invoke("update_key_mappings", { mappings: expanded }).catch((e) => {
            console.warn("[FlowKeys] Failed to sync mappings to backend:", e);
        });
    }, [profiles]);

    // Source key capture
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

    // Target key selection
    const handleSelectTarget = (keyId: string, label: string, mods: ModifierKey[]) => {
        setTargetKeyId(keyId);
        setTargetModifiers(mods);
        const modStr = mods.length > 0 ? mods.join("+") + "+" : "";
        setTargetKey(modStr + label);
    };

    // Load editing mapping into state
    const loadEditState = (mapping: KeyMapping | null) => {
        if (mapping) {
            setSourceKey(mapping.source_key);
            setSourceKeyId(mapping.source_key_id);
            setTargetKey(mapping.target_key);
            setTargetKeyId(mapping.target_key_id);
            setTargetModifiers(mapping.target_modifiers);
            setDescription(mapping.description);
            setBidirectional(mapping.bidirectional ?? false);
        } else {
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
        setLiveModifiers([]);
        setTargetMode("keyboard");
    };

    const updateProfiles = useCallback((updater: (prev: Profile[]) => Profile[]) => {
        setProfiles((prev) => updater(prev));
    }, []);

    const handleSelectProfile = (id: string) => {
        setActiveProfileId(id);
    };

    const handleAddProfile = () => {
        const newProfile: Profile = {
            id: genId(),
            name: `${t("flowkeys.profile_new")} ${profiles.length + 1}`,
            active: true,
            mappings: [],
        };
        updateProfiles((prev) => [...prev, newProfile]);
        setActiveProfileId(newProfile.id);
    };

    const handleRenameProfile = (id: string, name: string) => {
        updateProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    };

    const handleDuplicateProfile = (id: string) => {
        const src = profiles.find((p) => p.id === id);
        if (!src) return;
        const dup: Profile = {
            id: genId(),
            name: `${src.name} (${t("flowkeys.profile_copy")})`,
            active: true,
            mappings: src.mappings.map((m: KeyMapping) => ({ ...m, id: `km-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
        };
        updateProfiles((prev) => [...prev, dup]);
        setActiveProfileId(dup.id);
    };

    const handleDeleteProfile = (id: string) => {
        if (profiles.length <= 1) return;
        const remaining = profiles.filter((p) => p.id !== id);
        updateProfiles(() => remaining);
        if (activeProfileId === id) {
            setActiveProfileId(remaining[0]?.id || "default");
        }
    };

    const handleToggleProfileActive = (id: string) => {
        updateProfiles((prev) =>
            prev.map((p) => (p.id === id ? { ...p, active: !p.active } : p))
        );
    };

    const updateProfileMappings = (profileId: string, mappings: KeyMapping[]) => {
        updateProfiles((prev) =>
            prev.map((p) => (p.id === profileId ? { ...p, mappings } : p))
        );
    };

    const handleToggleMapping = (mappingId: string) => {
        const newMappings = activeProfile.mappings.map((m: KeyMapping) =>
            m.id === mappingId ? { ...m, enabled: !m.enabled } : m
        );
        updateProfileMappings(activeProfileId, newMappings);
    };

    const handleDeleteMapping = (mappingId: string) => {
        const newMappings = activeProfile.mappings.filter((m: KeyMapping) => m.id !== mappingId);
        updateProfileMappings(activeProfileId, newMappings);
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

    const handleSaveMapping = () => {
        if (!sourceKey || !targetKey) return;

        const mapping: KeyMapping = {
            id: editMapping?.id || `km-${Date.now()}`,
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
            const newMappings = activeProfile.mappings.map((m: KeyMapping) =>
                m.id === mapping.id ? mapping : m
            );
            updateProfileMappings(activeProfileId, newMappings);
        } else {
            const without = activeProfile.mappings.filter(
                (m: KeyMapping) => m.source_key_id !== mapping.source_key_id
            );
            updateProfileMappings(activeProfileId, [...without, mapping]);
        }
        setEditMapping(null);
        loadEditState(null);
    };

    const existingSources = new Set(
        (activeProfile.mappings as KeyMapping[])
            .filter((m) => m.id !== editMapping?.id)
            .map((m) => m.source_key_id)
    );

    const conflict = !isEdit && sourceKeyId && existingSources.has(sourceKeyId);
    const canSave = !!(sourceKey && targetKey);

    return (
        <div style={{ width: "100%", flex: "1", minHeight: 0, paddingBottom: "0", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ marginBottom: "24px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <h1 style={{ fontSize: "22px", fontWeight: 700, display: "flex", alignItems: "center", gap: "10px", margin: 0 }}>
                        <Keyboard size={22} color="var(--color-primary)" />
                        {t("flowkeys.title")}
                    </h1>
                    <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginTop: "6px" }}>
                        {t("flowkeys.subtitle")}
                    </p>
                </div>
                <button
                    onClick={toggleKeysEnabled}
                    style={{
                        background: keysEnabled ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-surface-elevated)',
                        border: `1px solid ${keysEnabled ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                        color: keysEnabled ? '#22c55e' : 'var(--color-text-muted)',
                        padding: '8px 14px',
                        borderRadius: '100px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                        height: '36px',
                    }}
                >
                    {keysEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    {keysEnabled ? t('flowkeys.feature_on') : t('flowkeys.feature_off')}
                </button>
            </div>

            {/* Main Content: List + Editor */}
            <div ref={contentRef} style={{ display: "flex", gap: "12px", flex: 1, minHeight: 0, minWidth: 0 }}>
                {/* Left: Mapping List */}
                <div className="glass-panel" style={{
                    borderRadius: "var(--radius-lg)", display: "flex", flexDirection: "column", overflow: "hidden",
                    flex: `0 0 ${layout.listW}px`, minWidth: 0, maxWidth: "100%",
                }}>
                    <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 12px", borderBottom: "1px solid var(--color-border)",
                        gap: "10px",
                    }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
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
                        <span style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                            {t("flowkeys.mapping_count", { count: activeProfile.mappings.length })}
                        </span>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
                        <MappingList
                            mappings={activeProfile.mappings}
                            onToggle={handleToggleMapping}
                            onEdit={handleEditMapping}
                            onDelete={handleDeleteMapping}
                        />
                    </div>
                </div>

                {/* Right: Editor Panel */}
                <div className="glass-panel" style={{
                    borderRadius: "var(--radius-lg)", padding: "16px",
                    display: "flex", flexDirection: "column", overflow: "hidden",
                    flex: 1, minWidth: 0,
                }}>
                    {/* Editor Title */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600 }}>
                            {isEdit ? t("flowkeys.modal_edit") : t("flowkeys.modal_add")}
                        </span>
                        {isEdit && (
                            <button
                                onClick={handleStartNew}
                                style={{
                                    background: "none", border: "1px solid var(--color-border)",
                                    borderRadius: "6px", padding: "3px 8px", fontSize: "11px",
                                    cursor: "pointer", color: "var(--color-text-muted)",
                                }}
                            >
                                {t("flowkeys.modal_add")}
                            </button>
                        )}
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
                        {/* Source + Target keys in one row */}
                        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
                            {/* Source Key */}
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "4px", display: "block" }}>
                                    {t("flowkeys.source_label")}
                                </label>
                                <button
                                    onClick={() => setCapturingSource(true)}
                                    style={{
                                        width: "100%", padding: "8px 10px", borderRadius: "6px",
                                        background: capturingSource ? "var(--color-primary-glow)" : "var(--color-bg-base)",
                                        border: capturingSource ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                                        color: sourceKey ? "var(--color-text-main)" : "var(--color-text-muted)",
                                        fontSize: "12px", fontWeight: 600, cursor: "pointer",
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
                                    <div style={{ fontSize: "9px", color: "#ef4444", marginTop: "2px" }}>
                                        {t("flowkeys.conflict_warning")}
                                    </div>
                                )}
                            </div>

                            {/* Swap + Bidirectional buttons */}
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", paddingBottom: "2px" }}>
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
                                        width: "26px", height: "26px", borderRadius: "50%",
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
                                    <ArrowLeftRight size={12} />
                                </button>
                                <button
                                    onClick={() => setBidirectional(!bidirectional)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: "3px",
                                        padding: "2px 6px", borderRadius: "10px", fontSize: "9px", fontWeight: 700,
                                        border: bidirectional ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                                        background: bidirectional ? "var(--color-primary-glow)" : "var(--color-bg-base)",
                                        color: bidirectional ? "var(--color-primary)" : "var(--color-text-muted)",
                                        cursor: "pointer", transition: "all 0.15s",
                                        whiteSpace: "nowrap",
                                    }}
                                    title={t("flowkeys.btn_bidirectional")}
                                >
                                    <Repeat size={10} />
                                    {t("flowkeys.bidirectional")}
                                </button>
                            </div>

                            {/* Target Key display */}
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "4px", display: "block" }}>
                                    {t("flowkeys.target_label")}
                                </label>
                                <div style={{
                                    padding: "8px 10px", borderRadius: "6px",
                                    background: targetKey ? "var(--color-primary-glow)" : "var(--color-bg-base)",
                                    border: targetKey ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                                    fontFamily: "monospace", fontWeight: 600, fontSize: "12px",
                                    color: targetKey ? "var(--color-primary)" : "var(--color-text-muted)",
                                    textAlign: "center",
                                }}>
                                    {targetKey || t("flowkeys.select_target")}
                                </div>
                            </div>
                        </div>

                        {/* Target mode tabs */}
                        <div style={{ display: "flex", gap: "3px" }}>
                            {([
                                { mode: "keyboard" as TargetMode, label: t("flowkeys.mode_keyboard") },
                                { mode: "list" as TargetMode, label: t("flowkeys.mode_list") },
                            ]).map(({ mode, label }) => (
                                <button
                                    key={mode}
                                    onClick={() => setTargetMode(mode)}
                                    style={{
                                        padding: "3px 8px", fontSize: "10px", borderRadius: "5px",
                                        border: targetMode === mode ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                                        background: targetMode === mode ? "var(--color-primary-glow)" : "transparent",
                                        color: targetMode === mode ? "var(--color-primary)" : "var(--color-text-muted)",
                                        cursor: "pointer", fontWeight: 600,
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Target selection area */}
                        <div style={{ flex: 1, minHeight: "180px", overflow: "hidden" }}>
                            {targetMode === "keyboard" ? (
                                <VisualKeyboard
                                    onSelectKey={(keyId, label, mods) => handleSelectTarget(keyId, label, mods)}
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

                        {/* Description + Save */}
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <input
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t("flowkeys.placeholder_desc")}
                                style={{
                                    flex: 1, padding: "6px 10px", borderRadius: "6px",
                                    border: "1px solid var(--color-border)", background: "var(--color-bg-base)",
                                    color: "var(--color-text-main)", fontSize: "11px", outline: "none",
                                    boxSizing: "border-box",
                                }}
                            />
                            {isEdit && (
                                <button
                                    onClick={handleStartNew}
                                    style={{
                                        padding: "6px 12px", fontSize: "11px",
                                        border: "1px solid var(--color-border)", borderRadius: "6px",
                                        cursor: "pointer", background: "transparent",
                                        color: "var(--color-text-muted)",
                                    }}
                                >
                                    {t("flowkeys.modal_cancel")}
                                </button>
                            )}
                            <button
                                onClick={handleSaveMapping}
                                disabled={!canSave}
                                style={{
                                    padding: "6px 16px", fontSize: "11px", fontWeight: 600,
                                    borderRadius: "6px", cursor: "pointer",
                                    border: "none",
                                    background: !canSave ? "var(--color-border)" : "var(--color-primary)",
                                    color: !canSave ? "var(--color-text-muted)" : "#fff",
                                    opacity: !canSave ? 0.5 : 1,
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {t("flowkeys.modal_save")}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
