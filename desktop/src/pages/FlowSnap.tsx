import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookA, Plus, Trash2, AlertCircle, ToggleRight, ToggleLeft } from "lucide-react";

export default function Snippets() {
    const { t } = useTranslation();
    const [snippets, setSnippets] = useState<Record<string, string>>({});
    const [isEnabled, setIsEnabled] = useState(false);

    const [trigger, setTrigger] = useState("");
    const [replacement, setReplacement] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const loadData = async () => {
        try {
            const data: Record<string, string> = await invoke("get_snippets");
            setSnippets(data);

            const settings: any = await invoke("get_settings");
            setIsEnabled(settings.is_snippets_enabled);
        } catch (e) {
            console.error("Failed to load snippets data:", e);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const toggleEngine = async () => {
        try {
            const settings: any = await invoke("get_settings");
            await invoke("update_settings", {
                isSnippetsEnabled: !isEnabled,
                isSyncEnabled: settings.is_sync_enabled
            });
            setIsEnabled(!isEnabled);
        } catch (e) {
            console.error("Failed to toggle engine:", e);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!trigger.trim() || !replacement.trim()) return;

        setIsLoading(true);
        try {
            await invoke("add_snippet", { trigger: trigger.trim(), replacement: replacement.trim() });
            setTrigger("");
            setReplacement("");
            await loadData();
        } catch (err) {
            console.error("Failed to add snippet:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (delTrigger: string) => {
        try {
            await invoke("remove_snippet", { trigger: delTrigger });
            await loadData();
        } catch (err) {
            console.error("Failed to remove snippet:", err);
        }
    };

    const snippetCount = Object.keys(snippets).length;

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>
                        {t('settings.engine_title')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                        {t('settings.engine_desc')}
                    </p>
                </div>

                <button
                    onClick={toggleEngine}
                    style={{
                        background: isEnabled ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-surface-elevated)',
                        border: `1px solid ${isEnabled ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                        color: isEnabled ? '#22c55e' : 'var(--color-text-muted)',
                        padding: '10px 16px',
                        borderRadius: '100px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        transition: 'all var(--transition-fast)'
                    }}
                >
                    {isEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    {isEnabled ? t('snippets.status_active') : t('snippets.status_disabled')}
                </button>
            </div>

            {/* Add Snippet Form */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginBottom: '32px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Plus size={18} color="var(--color-primary)" /> {t('snippets.add_modal_title')}
                </h3>

                <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '16px', alignItems: 'start' }}>
                    <div>
                        <input
                            type="text"
                            className="modern-input"
                            placeholder={t('snippets.placeholder_trigger')}
                            value={trigger}
                            onChange={(e) => setTrigger(e.target.value)}
                            style={{ fontFamily: 'var(--font-family)', fontWeight: 500 }}
                        />
                    </div>
                    <div>
                        <textarea
                            className="modern-input"
                            placeholder={t('snippets.placeholder_replacement')}
                            value={replacement}
                            onChange={(e) => setReplacement(e.target.value)}
                            rows={1}
                            style={{ resize: 'vertical', minHeight: '45px', lineHeight: '1.5' }}
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={isLoading || !trigger.trim() || !replacement.trim()}
                        style={{ height: '45px', opacity: (isLoading || !trigger.trim() || !replacement.trim()) ? 0.5 : 1 }}
                    >
                        {t('snippets.add_modal_save')}
                    </button>
                </form>
            </div>

            {/* Snippets Dictionary List */}
            <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <BookA size={18} color="var(--color-text-muted)" />
                        {t('snippets.active_snippets_title')}
                    </h3>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', background: 'var(--color-surface)', padding: '4px 10px', borderRadius: '100px', border: '1px solid var(--color-border)' }}>
                        {t('snippets.rules_count', { count: snippetCount })}
                    </span>
                </div>

                {snippetCount === 0 ? (
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <AlertCircle size={40} style={{ opacity: 0.2, marginBottom: '16px' }} />
                        <p>{t('snippets.empty')}</p>
                    </div>
                ) : (
                    <div style={{ padding: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 3fr auto', gap: '16px', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <div>{t('snippets.trigger')}</div>
                            <div>{t('snippets.replacement')}</div>
                            <div style={{ width: '40px', textAlign: 'center' }}></div>
                        </div>

                        {Object.entries(snippets).map(([trig, rep], index) => (
                            <div
                                key={index}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(120px, 1fr) 3fr auto',
                                    gap: '16px',
                                    padding: '16px',
                                    alignItems: 'center',
                                    borderBottom: index < snippetCount - 1 ? '1px solid var(--color-glass-border)' : 'none',
                                    transition: 'background 0.2s',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-elevated)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                                <div style={{
                                    fontFamily: '"Fira Code", monospace, Consolas',
                                    color: 'var(--color-primary)',
                                    background: 'var(--color-primary-glow)',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    display: 'inline-block',
                                    width: 'fit-content',
                                    fontSize: '13px',
                                    fontWeight: 600
                                }}>
                                    {trig}
                                </div>
                                <div style={{
                                    color: 'var(--color-text-main)',
                                    lineHeight: '1.5',
                                    fontSize: '14px',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word'
                                }}>
                                    {rep}
                                </div>
                                <button
                                    onClick={() => handleDelete(trig)}
                                    className="btn-ghost"
                                    style={{ padding: '8px', color: '#ef4444', opacity: 0.7 }}
                                    title={t('snippets.delete')}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
