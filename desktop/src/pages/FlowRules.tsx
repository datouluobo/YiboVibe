import { useTranslation } from "react-i18next";
import { ShieldCheck, Plus, Trash2, Settings2, Crosshair } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types — mirror Rust rules::AppRule / DefaultRules
// ---------------------------------------------------------------------------

interface DefaultRules {
    flowsnap: boolean;
    flowhint: boolean;
    flowwriter: boolean;
    flowpredict: boolean;
    flowsync: boolean;
}

interface AppRule {
    process: string;
    display_name: string;
    flowsnap: boolean;
    flowhint: boolean;
    flowhint_dicts: string[];
    flowwriter: boolean;
    flowpredict: boolean;
    flowsync: boolean;
}

interface FlowRulesPayload {
    default: DefaultRules;
    app_overrides: AppRule[];
}

const FEATURE_COLS = ["flowsnap", "flowhint", "flowwriter", "flowpredict", "flowsync"] as const;
type FeatureKey = typeof FEATURE_COLS[number];

// ---------------------------------------------------------------------------
// StatusCell — individual toggle button in the matrix
// ---------------------------------------------------------------------------

function StatusCell({ value, isHint, onToggle, onConfig }: {
    value: boolean; isHint?: boolean;
    onToggle: () => void; onConfig?: () => void;
}) {
    if (isHint && value) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button onClick={onToggle} style={{
                    width: '28px', height: '28px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: 'rgba(34,139,230,0.15)', color: '#228be6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                }}>✓</button>
                <button onClick={onConfig} style={{
                    width: '24px', height: '24px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                    background: 'transparent', color: 'var(--color-text-dim)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }} title="配置词库">
                    <Settings2 size={13} />
                </button>
            </div>
        );
    }
    return (
        <button onClick={onToggle} style={{
            width: '28px', height: '28px', borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: value ? 'rgba(34,197,94,0.15)' : 'rgba(150,150,150,0.1)',
            color: value ? '#22c55e' : 'var(--color-text-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', transition: 'all 0.15s'
        }}>
            {value ? '✓' : '○'}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Add-App Modal
// ---------------------------------------------------------------------------

function AddAppModal({ onClose, onAdd }: {
    onClose: () => void;
    onAdd: (process: string, displayName: string) => void;
}) {
    const { t } = useTranslation();
    const [process, setProcess] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [picking, setPicking] = useState(false);

    const pickFromCursor = async () => {
        setPicking(true);
        try {
            const exe: string = await invoke("get_window_under_cursor");
            setProcess(exe);
            if (!displayName) setDisplayName(exe.replace(/\.exe$/i, ""));
        } catch { /* ignore */ }
        setPicking(false);
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={onClose}>
            <div className="glass-panel" style={{
                padding: '28px', borderRadius: 'var(--radius-lg)', minWidth: '380px',
                maxWidth: '460px',
            }} onClick={e => e.stopPropagation()}>
                <h3 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: 600 }}>
                    {t('flowrules.btn_add_app')}
                </h3>

                <div style={{ marginBottom: '14px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '4px', display: 'block' }}>
                        进程名
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            value={process} onChange={e => setProcess(e.target.value)}
                            placeholder="例如: notepad.exe"
                            style={{
                                flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-glass-border)',
                                background: 'var(--color-glass-bg)', color: 'var(--color-text)',
                                fontSize: '13px', fontFamily: 'monospace',
                            }}
                        />
                        <button
                            onClick={pickFromCursor}
                            className="btn-ghost"
                            title="拾取光标下的窗口进程"
                            style={{
                                padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px',
                                borderRadius: 'var(--radius-md)', fontSize: '12px',
                                border: '1px solid var(--color-glass-border)',
                                opacity: picking ? 0.5 : 1,
                            }}
                        >
                            <Crosshair size={14} />
                        </button>
                    </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '4px', display: 'block' }}>
                        显示名称
                    </label>
                    <input
                        value={displayName} onChange={e => setDisplayName(e.target.value)}
                        placeholder="例如: 记事本"
                        style={{
                            width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-glass-border)',
                            background: 'var(--color-glass-bg)', color: 'var(--color-text)',
                            fontSize: '13px', boxSizing: 'border-box',
                        }}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button className="btn-ghost" onClick={onClose} style={{
                        padding: '8px 16px', fontSize: '12px', borderRadius: 'var(--radius-md)'
                    }}>
                        取消
                    </button>
                    <button
                        disabled={!process.trim()}
                        onClick={() => { onAdd(process.trim().toLowerCase(), displayName.trim() || process.trim()); onClose(); }}
                        style={{
                            padding: '8px 20px', fontSize: '12px', borderRadius: 'var(--radius-md)',
                            background: 'var(--color-primary)', color: '#fff', border: 'none',
                            cursor: process.trim() ? 'pointer' : 'not-allowed',
                            opacity: process.trim() ? 1 : 0.5,
                        }}
                    >
                        添加
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// FlowRules Page
// ---------------------------------------------------------------------------

export default function FlowRules() {
    const { t } = useTranslation();
    const [defaults, setDefaults] = useState<DefaultRules>({
        flowsnap: true, flowhint: false, flowwriter: true, flowpredict: true, flowsync: true,
    });
    const [rules, setRules] = useState<AppRule[]>([]);
    const [showAddModal, setShowAddModal] = useState(false);
    const [loading, setLoading] = useState(true);

    // ------- Load Rules from Backend -------
    const loadRules = useCallback(async () => {
        try {
            const data: FlowRulesPayload = await invoke("get_flow_rules");
            setDefaults(data.default);
            setRules(data.app_overrides);
        } catch (e) {
            console.error("Failed to load flow rules:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadRules(); }, [loadRules]);

    // ------- Default Row Toggle -------
    const toggleDefault = async (key: FeatureKey) => {
        // Optimistic UI update
        setDefaults(prev => ({ ...prev, [key]: !prev[key] }));
        try {
            await invoke("toggle_default_feature", { feature: key });
        } catch (e) {
            console.error("toggle_default_feature failed:", e);
            loadRules(); // rollback on failure
        }
    };

    // ------- App Rule Toggle -------
    const toggleRule = async (idx: number, key: FeatureKey) => {
        const rule = rules[idx];
        // Optimistic UI update
        setRules(prev => prev.map((r, i) => {
            if (i !== idx) return r;
            return { ...r, [key]: !(r as any)[key] };
        }));
        try {
            await invoke("toggle_app_feature", { process: rule.process, feature: key });
        } catch (e) {
            console.error("toggle_app_feature failed:", e);
            loadRules();
        }
    };

    // ------- Remove App Rule -------
    const removeRule = async (idx: number) => {
        const rule = rules[idx];
        setRules(prev => prev.filter((_, i) => i !== idx));
        try {
            await invoke("remove_app_rule", { process: rule.process });
        } catch (e) {
            console.error("remove_app_rule failed:", e);
            loadRules();
        }
    };

    // ------- Add App Rule -------
    const addRule = async (process: string, displayName: string) => {
        // Default: inherit from defaults, all features on
        const newRule: AppRule = {
            process,
            display_name: displayName,
            flowsnap: defaults.flowsnap,
            flowhint: defaults.flowhint,
            flowhint_dicts: [],
            flowwriter: defaults.flowwriter,
            flowpredict: defaults.flowpredict,
            flowsync: defaults.flowsync,
        };
        setRules(prev => [...prev, newRule]);
        try {
            await invoke("upsert_app_rule", {
                process: newRule.process,
                displayName: newRule.display_name,
                flowsnap: newRule.flowsnap,
                flowhint: newRule.flowhint,
                flowhintDicts: newRule.flowhint_dicts,
                flowwriter: newRule.flowwriter,
                flowpredict: newRule.flowpredict,
                flowsync: newRule.flowsync,
            });
        } catch (e) {
            console.error("upsert_app_rule failed:", e);
            loadRules();
        }
    };

    const colLabels: Record<string, string> = {
        flowsnap: t('flowrules.col_flowsnap'),
        flowhint: t('flowrules.col_flowhint'),
        flowwriter: t('flowrules.col_flowwriter'),
        flowpredict: t('flowrules.col_flowpredict'),
        flowsync: t('flowrules.col_flowsync'),
    };

    return (
        <div style={{ maxWidth: '960px' }}>
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <ShieldCheck size={22} color="var(--color-primary)" />
                    {t('flowrules.title')}
                </h1>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '13px', marginTop: '6px' }}>
                    {t('flowrules.subtitle')}
                </p>
            </div>

            <div className="glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-dim)', fontSize: '13px' }}>
                        加载中…
                    </div>
                ) : (
                    <>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-glass-border)' }}>
                                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--color-text-dim)', fontSize: '12px', minWidth: '180px' }}>
                                        {t('flowrules.col_app')}
                                    </th>
                                    {FEATURE_COLS.map(col => (
                                        <th key={col} style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600, color: 'var(--color-text-dim)', fontSize: '12px', minWidth: '70px' }}>
                                            {colLabels[col]}
                                        </th>
                                    ))}
                                    <th style={{ width: '50px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Default row */}
                                <tr style={{ borderBottom: '1px solid var(--color-glass-border)', background: 'rgba(var(--color-primary-rgb, 99,102,241), 0.04)' }}>
                                    <td style={{ padding: '12px', fontWeight: 600, fontSize: '13px' }}>
                                        <span style={{ opacity: 0.7, fontSize: '12px' }}>⊘</span>{' '}
                                        {t('flowrules.default_row')}
                                    </td>
                                    {FEATURE_COLS.map(col => (
                                        <td key={col} style={{ textAlign: 'center', padding: '8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                <StatusCell
                                                    value={(defaults as any)[col]}
                                                    isHint={col === 'flowhint'}
                                                    onToggle={() => toggleDefault(col)}
                                                />
                                            </div>
                                        </td>
                                    ))}
                                    <td></td>
                                </tr>

                                {/* App rules */}
                                {rules.map((rule, idx) => (
                                    <tr key={rule.process} style={{
                                        borderBottom: '1px solid var(--color-glass-border)',
                                        transition: 'background 0.15s'
                                    }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-glass-bg)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <td style={{ padding: '12px' }}>
                                            <div style={{ fontWeight: 500 }}>{rule.display_name}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', fontFamily: 'monospace' }}>
                                                {rule.process}
                                            </div>
                                        </td>
                                        {FEATURE_COLS.map(col => (
                                            <td key={col} style={{ textAlign: 'center', padding: '8px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                    <StatusCell
                                                        value={(rule as any)[col]}
                                                        isHint={col === 'flowhint'}
                                                        onToggle={() => toggleRule(idx, col)}
                                                        onConfig={() => {/* TODO: open dict selector panel */ }}
                                                    />
                                                </div>
                                            </td>
                                        ))}
                                        <td style={{ textAlign: 'center' }}>
                                            <button onClick={() => removeRule(idx)} className="btn-ghost" style={{ padding: '4px', color: '#ff4d4f' }}>
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}

                                {/* Empty state */}
                                {rules.length === 0 && (
                                    <tr>
                                        <td colSpan={FEATURE_COLS.length + 2} style={{
                                            textAlign: 'center', padding: '30px', color: 'var(--color-text-dim)',
                                            fontSize: '13px', fontStyle: 'italic',
                                        }}>
                                            {t('flowrules.no_rules')}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        {/* Add app button */}
                        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
                            <button
                                className="btn-ghost"
                                onClick={() => setShowAddModal(true)}
                                style={{
                                    padding: '8px 20px', fontSize: '12px', display: 'flex',
                                    alignItems: 'center', gap: '6px', borderRadius: 'var(--radius-md)',
                                    border: '1px dashed var(--color-glass-border)'
                                }}
                            >
                                <Plus size={14} />
                                {t('flowrules.btn_add_app')}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {showAddModal && (
                <AddAppModal
                    onClose={() => setShowAddModal(false)}
                    onAdd={addRule}
                />
            )}
        </div>
    );
}
