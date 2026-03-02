import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { ShieldAlert, Plus, Trash2, Crosshair, AlertCircle } from "lucide-react";

export default function Exemptions() {
    const { t } = useTranslation();
    const [blockedApps, setBlockedApps] = useState<string[]>([]);
    const [showAppSelector, setShowAppSelector] = useState(false);
    const [isSpying, setIsSpying] = useState(false);

    const loadBlockedApps = async () => {
        try {
            const data: string[] = await invoke("get_blocked_apps");
            setBlockedApps(data);
        } catch (error) {
            console.error("Failed to load blocked apps", error);
        }
    };

    useEffect(() => {
        loadBlockedApps();
    }, []);

    useEffect(() => {
        let unlistenDrop: (() => void) | undefined;
        // Fallback for browser testing
        if (!(window as any).__TAURI_INTERNALS__) return;

        if (showAppSelector) {
            listen<any>('tauri://drop', (event) => {
                const paths = event.payload.paths || event.payload;
                if (Array.isArray(paths) && paths.length > 0) {
                    const path = paths[0] as string;
                    let exeName = path.split('\\').pop()?.toLowerCase() || "";
                    if (exeName.endsWith('.lnk')) {
                        exeName = exeName.replace(".lnk", ".exe");
                    }
                    if (exeName) {
                        invoke("add_blocked_app", { appName: exeName }).then(() => {
                            loadBlockedApps();
                            setShowAppSelector(false);
                        });
                    }
                }
            }).then(f => unlistenDrop = f).catch(console.error);
        }
        return () => {
            if (unlistenDrop) unlistenDrop();
        };
    }, [showAppSelector]);

    const handleAddBlockedAppFromDialog = async () => {
        try {
            const selected = await open({
                multiple: false,
                title: "Select Executable to Block",
                filters: [{ name: 'Executables', extensions: ['exe'] }]
            });
            if (selected) {
                let exeName = (selected as string).split('\\').pop()?.toLowerCase();
                if (exeName) {
                    await invoke("add_blocked_app", { appName: exeName });
                    await loadBlockedApps();
                    setShowAppSelector(false);
                }
            }
        } catch (err) {
            console.error("Failed to select exe", err);
        }
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsSpying(true);
    };

    const handlePointerUp = async (e: React.PointerEvent) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (!isSpying) return;
        setIsSpying(false);
        try {
            const exeName = await invoke<string>("get_window_under_cursor");
            if (exeName) {
                await invoke("add_blocked_app", { appName: exeName });
                await loadBlockedApps();
                setShowAppSelector(false);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleRemoveBlockedApp = async (appName: string) => {
        try {
            await invoke("remove_blocked_app", { appName });
            await loadBlockedApps();
        } catch (error) {
            console.error("Failed to remove blocked app", error);
        }
    };

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>
                        {t('settings.blacklist_title')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                        {t('settings.blacklist_desc')}
                    </p>
                </div>

                <button
                    onClick={() => setShowAppSelector(true)}
                    className="btn-primary"
                    style={{ padding: '10px 16px', borderRadius: '100px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                >
                    <Plus size={18} /> {t('settings.btn_add_exception')}
                </button>
            </div>

            {showAppSelector && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                    zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center'
                }} onClick={() => setShowAppSelector(false)}>
                    <div className="glass-panel scale-up" style={{
                        width: '450px', padding: '30px', borderRadius: 'var(--radius-lg)',
                        textAlign: 'center', border: '1px solid var(--color-primary-glow)'
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '20px' }}>Select Target Application</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <button className="btn-primary" onClick={handleAddBlockedAppFromDialog} style={{ padding: '12px', fontSize: '15px' }}>
                                Browse for .exe file...
                            </button>

                            <div style={{ position: 'relative', margin: '10px 0' }}>
                                <div style={{ borderBottom: '1px solid var(--color-glass-border)' }}></div>
                                <span style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-surface-elevated)', padding: '0 10px', color: 'var(--color-text-muted)', fontSize: '12px' }}>OR</span>
                            </div>

                            <div style={{
                                border: '2px dashed var(--color-glass-border)', padding: '30px 20px', borderRadius: 'var(--radius-md)',
                                color: 'var(--color-text-muted)', transition: 'all 0.2s', cursor: 'grab'
                            }}>
                                <p style={{ margin: '0 0 10px 0' }}>Drop a shortcut (.lnk) or .exe here</p>
                            </div>

                            <div style={{ position: 'relative', margin: '10px 0' }}>
                                <div style={{ borderBottom: '1px solid var(--color-glass-border)' }}></div>
                                <span style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-surface-elevated)', padding: '0 10px', color: 'var(--color-text-muted)', fontSize: '12px' }}>OR</span>
                            </div>

                            <button
                                className="btn-ghost"
                                onPointerDown={handlePointerDown}
                                onPointerUp={handlePointerUp}
                                style={{
                                    border: isSpying ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                    background: isSpying ? 'var(--color-primary-glow)' : 'var(--color-surface)',
                                    padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'crosshair', transition: 'all 0.2s'
                                }}
                            >
                                <Crosshair size={32} color={isSpying ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
                                <span style={{ color: isSpying ? 'var(--color-primary)' : 'var(--color-text-main)', fontWeight: 600 }}>
                                    {isSpying ? "Release over target window..." : "Drag me & Drop onto Target App Window"}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShieldAlert size={18} color="var(--color-text-muted)" />
                        Excluded Process List
                    </h3>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', background: 'var(--color-surface)', padding: '4px 10px', borderRadius: '100px', border: '1px solid var(--color-border)' }}>
                        {blockedApps.length} Apps
                    </span>
                </div>

                {blockedApps.length === 0 ? (
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <AlertCircle size={40} style={{ opacity: 0.2, marginBottom: '16px' }} />
                        <p>{t('settings.no_blocked_apps')}</p>
                    </div>
                ) : (
                    <div style={{ padding: '16px', display: 'grid', gap: '12px' }}>
                        {blockedApps.map(app => (
                            <div key={app} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: 'var(--color-surface-elevated)', padding: '16px 20px',
                                borderRadius: 'var(--radius-md)', border: '1px solid var(--color-glass-border)'
                            }}>
                                <div>
                                    <h4 style={{ color: 'var(--color-text-main)', fontFamily: '"Fira Code", monospace, Consolas', margin: 0, fontSize: '15px' }}>
                                        {app}
                                    </h4>
                                </div>
                                <button
                                    onClick={() => handleRemoveBlockedApp(app)}
                                    className="btn-ghost"
                                    style={{ color: '#ef4444', opacity: 0.7, padding: '8px' }}
                                    title="Remove exemption"
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
