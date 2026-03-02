import { useTranslation } from "react-i18next";
import { Sparkles, Plus, Upload, Eye, Edit3, Trash2, Copy } from "lucide-react";
import { useState } from "react";

// Demo data for UI skeleton
const DEMO_DICTS = [
    { id: "cmd", name: "CMD 命令词库", type: "builtin", entries: 82, bound: ["cmd.exe", "powershell.exe"], enabled: true },
    { id: "git", name: "Git 命令词库", type: "builtin", entries: 96, bound: [], enabled: true },
    { id: "general_zh", name: "中文通用词库", type: "builtin", entries: 200, bound: [], enabled: false },
];

export default function FlowHint() {
    const { t } = useTranslation();
    const [engineOn, setEngineOn] = useState(false);
    const [dicts] = useState(DEMO_DICTS);

    return (
        <div style={{ maxWidth: '860px' }}>
            {/* Header */}
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <Sparkles size={22} color="var(--color-primary)" />
                    {t('flowhint.title')}
                </h1>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '13px', marginTop: '6px' }}>
                    {t('flowhint.subtitle')}
                </p>
            </div>

            {/* Engine Status & Global Params */}
            <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{t('flowhint.engine_status')}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginTop: '2px' }}>
                            {engineOn ? t('flowhint.status_active') : t('flowhint.status_disabled')}
                        </div>
                    </div>
                    <button
                        className={engineOn ? "btn-primary" : "btn-ghost"}
                        onClick={() => setEngineOn(!engineOn)}
                        style={{ padding: '6px 18px', fontSize: '12px', borderRadius: 'var(--radius-md)' }}
                    >
                        {engineOn ? "● ON" : "○ OFF"}
                    </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                    <div className="glass-panel" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginBottom: '4px' }}>{t('flowhint.min_trigger')}</div>
                        <select style={{ width: '100%', background: 'transparent', border: '1px solid var(--color-glass-border)', borderRadius: '6px', padding: '4px 8px', color: 'var(--color-text-main)', fontSize: '13px' }}>
                            <option value="1">1</option>
                            <option value="2" selected>2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                        </select>
                    </div>
                    <div className="glass-panel" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginBottom: '4px' }}>{t('flowhint.max_candidates')}</div>
                        <select style={{ width: '100%', background: 'transparent', border: '1px solid var(--color-glass-border)', borderRadius: '6px', padding: '4px 8px', color: 'var(--color-text-main)', fontSize: '13px' }}>
                            <option value="3">3</option>
                            <option value="5" selected>5</option>
                            <option value="8">8</option>
                        </select>
                    </div>
                    <div className="glass-panel" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginBottom: '4px' }}>{t('flowhint.accept_key')}</div>
                        <select style={{ width: '100%', background: 'transparent', border: '1px solid var(--color-glass-border)', borderRadius: '6px', padding: '4px 8px', color: 'var(--color-text-main)', fontSize: '13px' }}>
                            <option value="Tab" selected>Tab</option>
                            <option value="Enter">Enter</option>
                            <option value="Right">→ Right</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Dictionary Manager */}
            <div className="glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{t('flowhint.dict_title')}</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Upload size={13} />{t('flowhint.btn_import_dict')}
                        </button>
                        <button className="btn-primary" style={{ padding: '5px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Plus size={13} />{t('flowhint.btn_create_dict')}
                        </button>
                    </div>
                </div>

                {/* Dict List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {dicts.map(d => (
                        <div key={d.id} className="glass-panel" style={{
                            padding: '14px 16px', borderRadius: 'var(--radius-md)',
                            display: 'flex', alignItems: 'center', gap: '12px',
                            opacity: d.enabled ? 1 : 0.55,
                            transition: 'opacity 0.2s'
                        }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {d.name}
                                    <span style={{
                                        fontSize: '10px', padding: '1px 7px', borderRadius: '4px',
                                        background: d.type === 'builtin' ? 'rgba(34,139,230,0.15)' : 'rgba(130,201,30,0.15)',
                                        color: d.type === 'builtin' ? '#228be6' : '#82c91e',
                                        fontWeight: 500
                                    }}>
                                        {d.type === 'builtin' ? t('flowhint.dict_builtin') : t('flowhint.dict_custom')}
                                    </span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginTop: '3px' }}>
                                    {t('flowhint.dict_entries', { count: d.entries })}
                                    {d.bound.length > 0
                                        ? ` · ${t('flowhint.dict_bound')}: ${d.bound.join(', ')}`
                                        : ` · ${t('flowhint.dict_global')}`
                                    }
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <button className="btn-ghost" style={{ padding: '5px 8px' }} title={t('flowhint.btn_view')}>
                                    <Eye size={14} />
                                </button>
                                {d.type === 'custom' && (
                                    <button className="btn-ghost" style={{ padding: '5px 8px' }} title={t('flowhint.btn_edit')}>
                                        <Edit3 size={14} />
                                    </button>
                                )}
                                {d.type === 'builtin' && (
                                    <button className="btn-ghost" style={{ padding: '5px 8px' }} title={t('flowhint.btn_save_as')}>
                                        <Copy size={14} />
                                    </button>
                                )}
                                {d.type === 'custom' && (
                                    <button className="btn-ghost" style={{ padding: '5px 8px', color: '#ff4d4f' }} title={t('flowhint.btn_delete')}>
                                        <Trash2 size={14} />
                                    </button>
                                )}
                                <button
                                    className={d.enabled ? "btn-primary" : "btn-ghost"}
                                    style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px' }}
                                >
                                    {d.enabled ? t('flowhint.btn_disable') : t('flowhint.btn_enable')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
