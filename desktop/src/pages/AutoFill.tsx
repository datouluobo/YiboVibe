import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, Plus, Trash2, Power, PowerOff, KeyboardMusic } from "lucide-react";

export default function AutoFill() {
    const { t } = useTranslation();
    const [autofills, setAutofills] = useState<Record<string, string>>({});
    const [newTrigger, setNewTrigger] = useState("");
    const [newCandidate, setNewCandidate] = useState("");
    const [isAutofillEnabled, setIsAutofillEnabled] = useState(true);

    const loadData = async () => {
        try {
            const data: Record<string, string> = await invoke("get_autofills");
            setAutofills(data);

            interface SettingsPayload {
                is_snippets_enabled: boolean;
                is_sync_enabled: boolean;
                is_autofill_enabled: boolean;
            }
            const settings: SettingsPayload = await invoke("get_settings");
            setIsAutofillEnabled(settings.is_autofill_enabled);
        } catch (error) {
            console.error("Failed to load autofill data", error);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const toggleEngine = async () => {
        try {
            interface SettingsPayload {
                is_snippets_enabled: boolean;
                is_sync_enabled: boolean;
                is_autofill_enabled: boolean;
            }
            const settings: SettingsPayload = await invoke("get_settings");
            const newStatus = !isAutofillEnabled;

            await invoke("update_settings", {
                isSnippetsEnabled: settings.is_snippets_enabled,
                isSyncEnabled: settings.is_sync_enabled,
                isAutofillEnabled: newStatus
            });
            setIsAutofillEnabled(newStatus);
        } catch (error) {
            console.error("Failed to toggle autofill engine", error);
        }
    };

    const handleAddAutofill = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTrigger || !newCandidate) return;
        try {
            await invoke("add_autofill", { trigger: newTrigger, candidate: newCandidate });
            setNewTrigger("");
            setNewCandidate("");
            await loadData();
        } catch (error) {
            console.error("Failed to add autofill word", error);
        }
    };

    const handleRemoveAutofill = async (trigger: string) => {
        try {
            await invoke("remove_autofill", { trigger });
            await loadData();
        } catch (error) {
            console.error("Failed to remove autofill word", error);
        }
    };

    const count = Object.keys(autofills).length;

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            {/* Header Area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>
                        {t('autofill.title')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                        {t('autofill.subtitle')}
                    </p>
                </div>

                <button
                    onClick={toggleEngine}
                    className={isAutofillEnabled ? "btn-primary scale-up" : "btn-ghost scale-up"}
                    style={{
                        padding: '10px 20px',
                        borderRadius: '100px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: isAutofillEnabled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.05)',
                        color: isAutofillEnabled ? '#22c55e' : 'var(--color-text-muted)',
                        border: isAutofillEnabled ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255,255,255,0.1)',
                        fontWeight: 600,
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                >
                    {isAutofillEnabled ? <Power size={18} /> : <PowerOff size={18} />}
                    {isAutofillEnabled ? t('autofill.status_active') : t('autofill.status_disabled')}
                </button>
            </div>

            {/* Input Form */}
            <div className="glass-panel scale-up" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginBottom: '32px' }}>
                <form onSubmit={handleAddAutofill} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {t('autofill.trigger')}
                        </label>
                        <input
                            type="text"
                            placeholder={t('autofill.placeholder_trigger')}
                            value={newTrigger}
                            onChange={(e) => setNewTrigger(e.target.value)}
                            required
                            style={{
                                width: '100%',
                                background: 'var(--color-surface-elevated)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text-main)',
                                padding: '12px 16px',
                                borderRadius: 'var(--radius-md)',
                                fontSize: '15px',
                                outline: 'none',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                                fontFamily: '"Fira Code", monospace, Consolas'
                            }}
                            onFocus={(e) => {
                                e.currentTarget.style.borderColor = 'var(--color-primary)';
                                e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-primary-glow)';
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'var(--color-border)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        />
                    </div>

                    <div style={{ flex: 2 }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {t('autofill.candidate')}
                        </label>
                        <input
                            type="text"
                            placeholder={t('autofill.placeholder_candidate')}
                            value={newCandidate}
                            onChange={(e) => setNewCandidate(e.target.value)}
                            required
                            style={{
                                width: '100%',
                                background: 'var(--color-surface-elevated)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text-main)',
                                padding: '12px 16px',
                                borderRadius: 'var(--radius-md)',
                                fontSize: '15px',
                                outline: 'none',
                                transition: 'border-color 0.2s, box-shadow 0.2s'
                            }}
                            onFocus={(e) => {
                                e.currentTarget.style.borderColor = 'var(--color-primary)';
                                e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-primary-glow)';
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'var(--color-border)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn-primary"
                        style={{
                            padding: '12px 24px',
                            height: '46px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-md)'
                        }}
                    >
                        <Plus size={18} />
                        {t('autofill.add_btn')}
                    </button>
                </form>
            </div>

            {/* Dictionary List */}
            <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={18} color="var(--color-text-muted)" />
                        {t('autofill.title')}
                    </h3>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', background: 'var(--color-surface)', padding: '4px 10px', borderRadius: '100px', border: '1px solid var(--color-border)' }}>
                        {count} Entries
                    </span>
                </div>

                {count === 0 ? (
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <KeyboardMusic size={40} style={{ opacity: 0.2, marginBottom: '16px', display: 'block', margin: '0 auto 16px auto' }} />
                        <p>{t('autofill.empty')}</p>
                    </div>
                ) : (
                    <div style={{ padding: '16px', display: 'grid', gap: '8px' }}>
                        {Object.entries(autofills).map(([trigger, candidate]) => (
                            <div
                                key={trigger}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    background: 'var(--color-surface-elevated)',
                                    padding: '12px 16px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-glass-border)',
                                    transition: 'transform 0.2s',
                                }}
                            >
                                <div style={{ minWidth: '150px' }}>
                                    <span style={{
                                        color: 'var(--color-primary)',
                                        fontFamily: '"Fira Code", monospace, Consolas',
                                        background: 'var(--color-primary-glow)',
                                        padding: '4px 8px',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        fontWeight: 600
                                    }}>
                                        {trigger}
                                    </span>
                                </div>
                                <div style={{ flex: 1, paddingLeft: '16px', borderLeft: '1px solid var(--color-glass-border)', marginLeft: '16px' }}>
                                    <span style={{ color: 'var(--color-text-main)', fontSize: '15px' }}>
                                        {candidate}
                                    </span>
                                </div>
                                <div style={{ marginLeft: '16px' }}>
                                    <button
                                        onClick={() => handleRemoveAutofill(trigger)}
                                        className="btn-ghost"
                                        style={{ color: '#ef4444', opacity: 0.8, padding: '8px' }}
                                        title={t('snippets.delete')}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
