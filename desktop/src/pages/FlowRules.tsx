import { useTranslation } from "react-i18next";
import { ShieldCheck, Plus, Trash2, Settings2 } from "lucide-react";
import { useState } from "react";

interface AppRule {
    process: string;
    displayName: string;
    flowsnap: boolean;
    flowhint: boolean | "config";
    flowwriter: boolean;
    flowpredict: boolean;
    flowsync: boolean;
}

const DEMO_DEFAULTS = {
    flowsnap: true, flowhint: false, flowwriter: true, flowpredict: true, flowsync: true
};

const DEMO_RULES: AppRule[] = [
    { process: "cmd.exe", displayName: "命令提示符", flowsnap: false, flowhint: "config", flowwriter: false, flowpredict: false, flowsync: true },
    { process: "code.exe", displayName: "VS Code", flowsnap: true, flowhint: "config", flowwriter: true, flowpredict: true, flowsync: true },
    { process: "LeagueOfLegends.exe", displayName: "英雄联盟", flowsnap: false, flowhint: false, flowwriter: false, flowpredict: false, flowsync: false },
];

const FEATURE_COLS = ["flowsnap", "flowhint", "flowwriter", "flowpredict", "flowsync"] as const;

function StatusCell({ value, isHint, onToggle, onConfig }: {
    value: boolean | "config"; isHint?: boolean;
    onToggle: () => void; onConfig?: () => void;
}) {
    if (isHint && value === "config") {
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
    const on = value === true || value === "config";
    return (
        <button onClick={onToggle} style={{
            width: '28px', height: '28px', borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: on ? 'rgba(34,197,94,0.15)' : 'rgba(150,150,150,0.1)',
            color: on ? '#22c55e' : 'var(--color-text-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', transition: 'all 0.15s'
        }}>
            {on ? '✓' : '○'}
        </button>
    );
}

export default function FlowRules() {
    const { t } = useTranslation();
    const [defaults, setDefaults] = useState(DEMO_DEFAULTS);
    const [rules, setRules] = useState(DEMO_RULES);

    const toggleDefault = (key: keyof typeof DEMO_DEFAULTS) => {
        setDefaults(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleRule = (idx: number, key: string) => {
        setRules(prev => prev.map((r, i) => {
            if (i !== idx) return r;
            const cur = (r as any)[key];
            if (key === "flowhint") {
                if (cur === false) return { ...r, [key]: true };
                if (cur === true) return { ...r, [key]: "config" };
                return { ...r, [key]: false };
            }
            return { ...r, [key]: !cur };
        }));
    };

    const removeRule = (idx: number) => {
        setRules(prev => prev.filter((_, i) => i !== idx));
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
                                            onToggle={() => toggleDefault(col as any)}
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
                                    <div style={{ fontWeight: 500 }}>{rule.displayName}</div>
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
                                                onConfig={() => {/* open dict selector */ }}
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
                    </tbody>
                </table>

                {/* Add app button */}
                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
                    <button className="btn-ghost" style={{
                        padding: '8px 20px', fontSize: '12px', display: 'flex',
                        alignItems: 'center', gap: '6px', borderRadius: 'var(--radius-md)',
                        border: '1px dashed var(--color-glass-border)'
                    }}>
                        <Plus size={14} />
                        {t('flowrules.btn_add_app')}
                    </button>
                </div>
            </div>
        </div>
    );
}
