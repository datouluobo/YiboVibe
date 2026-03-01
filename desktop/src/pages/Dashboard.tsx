import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Keyboard, Settings, LogOut, CheckCircle2, Laptop2, Smartphone, ShieldCheck, Plus, Trash2, FileUp, Target, Upload, X, Moon, Sun, Globe } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./Dashboard.css";

export default function Dashboard() {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const [activeTab, setActiveTab] = useState("sync");

    const [theme, setTheme] = useState(localStorage.getItem('yiboflow_theme') || 'dark');

    // Connection details from Login
    const serverUrl = localStorage.getItem('yiboflow_server_url') || 'http://127.0.0.1:8080';
    const connectedUser = localStorage.getItem('yiboflow_username') || 'admin';
    const connectedAt = localStorage.getItem('yiboflow_connected_at') || '';

    // Parse server URL for display
    const getServerDisplay = () => {
        try {
            const url = new URL(serverUrl);
            return { host: url.hostname, port: url.port || '80', protocol: url.protocol.replace(':', '') };
        } catch {
            return { host: serverUrl, port: '', protocol: 'http' };
        }
    };
    const serverInfo = getServerDisplay();
    const isLocalhost = serverInfo.host === '127.0.0.1' || serverInfo.host === 'localhost';
    const isLAN = serverInfo.host.startsWith('192.168.') || serverInfo.host.startsWith('10.') || serverInfo.host.startsWith('172.');
    const networkLabel = isLocalhost ? t('sync.network_local') : isLAN ? t('sync.network_lan') : t('sync.network_wan');

    const toggleTheme = () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        localStorage.setItem('yiboflow_theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    };

    const toggleLang = () => {
        const newLang = i18n.language === 'zh' ? 'en' : 'zh';
        i18n.changeLanguage(newLang);
        localStorage.setItem('yiboflow_lang', newLang);
    };

    // Snippets State
    const [snippets, setSnippets] = useState<Record<string, string>>({});
    const [newTrigger, setNewTrigger] = useState("");
    const [newReplacement, setNewReplacement] = useState("");

    // Settings State
    const [blockedApps, setBlockedApps] = useState<string[]>([]);
    const [newBlockedApp, setNewBlockedApp] = useState("");
    const [showAppSelector, setShowAppSelector] = useState(false);
    const [isSpying, setIsSpying] = useState(false);

    interface ClipboardLog {
        id: number;
        timestamp: Date;
        status: string;
        preview: string;
    }
    const [clipboardLogs, setClipboardLogs] = useState<ClipboardLog[]>([]);

    // Settings State
    interface SettingsPayload {
        is_snippets_enabled: boolean;
        is_sync_enabled: boolean;
    }
    const [settings, setSettings] = useState<SettingsPayload>({
        is_snippets_enabled: true,
        is_sync_enabled: true,
    });

    useEffect(() => {
        if (activeTab === "snippets") {
            loadSnippets();
        } else if (activeTab === "settings") {
            loadSettings();
            loadBlockedApps();
        }
    }, [activeTab]);

    useEffect(() => {
        const unlistenPromise = listen<any>("clipboard-event", (event) => {
            setClipboardLogs(prev => {
                const newLog = {
                    id: Date.now() + Math.random(),
                    timestamp: new Date(),
                    status: event.payload.status,
                    preview: event.payload.preview
                };

                // Aggressive deduplication: ignore exact same text + status if received within the last 1500ms
                const isDuplicate = prev.some(log =>
                    log.status === newLog.status &&
                    log.preview === newLog.preview &&
                    (newLog.timestamp.getTime() - log.timestamp.getTime() < 1500)
                );
                if (isDuplicate) return prev;

                return [newLog, ...prev].slice(0, 10);
            });
        });

        return () => {
            unlistenPromise.then(unlistenFn => unlistenFn());
        };
    }, []);

    useEffect(() => {
        let unlistenDrop: (() => void) | undefined;
        if (showAppSelector) {
            listen<any>('tauri://drop', (event) => {
                const paths = event.payload.paths || event.payload;
                if (Array.isArray(paths) && paths.length > 0) {
                    const path = paths[0] as string;
                    let exeName = path.split('\\').pop()?.toLowerCase() || "";
                    if (exeName.endsWith('.lnk')) {
                        // Very rough fallback if they dragged a shortcut, we just store it or ideally resolve it
                        exeName = exeName.replace(".lnk", ".exe");
                    }
                    if (exeName) {
                        invoke("add_blocked_app", { appName: exeName }).then(() => {
                            loadBlockedApps();
                            setShowAppSelector(false);
                        });
                    }
                }
            }).then(f => unlistenDrop = f);
        }
        return () => {
            if (unlistenDrop) unlistenDrop();
        };
    }, [showAppSelector]);

    const loadSettings = async () => {
        try {
            const data: SettingsPayload = await invoke("get_settings");
            setSettings(data);
        } catch (error) {
            console.error("Failed to load settings", error);
        }
    };

    const handleToggleSetting = async (key: keyof SettingsPayload) => {
        const newSettings = { ...settings, [key]: !settings[key] };
        setSettings(newSettings);
        try {
            await invoke("update_settings", {
                isSnippetsEnabled: newSettings.is_snippets_enabled,
                isSyncEnabled: newSettings.is_sync_enabled
            });
        } catch (error) {
            console.error("Failed to save settings", error);
            // Revert state if api fails
            setSettings(settings);
        }
    };

    const loadBlockedApps = async () => {
        try {
            const data: string[] = await invoke("get_blocked_apps");
            setBlockedApps(data);
        } catch (error) {
            console.error("Failed to load blocked apps", error);
        }
    };

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

    const handleAddBlockedApp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newBlockedApp) return;
        try {
            let appName = newBlockedApp.toLowerCase();
            if (!appName.endsWith(".exe")) {
                appName += ".exe";
            }
            await invoke("add_blocked_app", { appName });
            setNewBlockedApp("");
            await loadBlockedApps();
            setShowAppSelector(false);
        } catch (error) {
            console.error("Failed to add component", error);
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

    const loadSnippets = async () => {
        try {
            const data: Record<string, string> = await invoke("get_snippets");
            setSnippets(data);
        } catch (error) {
            console.error("Failed to load snippets", error);
        }
    };

    const handleAddSnippet = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTrigger || !newReplacement) return;
        try {
            await invoke("add_snippet", { trigger: newTrigger, replacement: newReplacement });
            setNewTrigger("");
            setNewReplacement("");
            await loadSnippets();
        } catch (error) {
            console.error("Failed to add snippet", error);
        }
    };

    const handleRemoveSnippet = async (trigger: string) => {
        try {
            await invoke("remove_snippet", { trigger });
            await loadSnippets();
        } catch (error) {
            console.error("Failed to remove snippet", error);
        }
    };

    const handleSendFile = async (deviceId: number) => {
        try {
            const selected = await open({
                multiple: false,
                title: "Select File to Send"
            });
            if (selected) {
                await invoke("send_file_p2p", {
                    filePath: selected as string,
                    targetDevice: deviceId
                });
                alert("File transfer initiated!");
            }
        } catch (err) {
            console.error("File transfer error", err);
            alert("Transfer failed: " + err);
        }
    };

    return (
        <div className="dashboard-container">
            {/* Sidebar Navigation */}
            <nav className="glass-panel sidebar">
                <div className="sidebar-header">
                    <div className="status-indicator">
                        <span className="dot online"></span>
                        {t('dashboard.engine_connected')}
                    </div>
                </div>

                <nav className="sidebar-menu">
                    <button
                        className={`nav-btn ${activeTab === 'sync' ? 'active' : ''}`}
                        onClick={() => setActiveTab("sync")}
                    >
                        <Copy size={20} />
                        {t('dashboard.tab_sync')}
                    </button>
                    <button
                        className={`nav-btn ${activeTab === 'snippets' ? 'active' : ''}`}
                        onClick={() => setActiveTab("snippets")}
                    >
                        <Keyboard size={20} />
                        {t('dashboard.tab_snippets')}
                    </button>
                    <button
                        className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
                        onClick={() => setActiveTab("settings")}
                    >
                        <Settings size={20} />
                        {t('dashboard.tab_settings')}
                    </button>
                </nav>

                <div className="sidebar-footer">
                    <button className="logout-btn" onClick={() => navigate("/")}>
                        <LogOut size={18} />
                        {t('dashboard.logout')}
                    </button>
                </div>
            </nav>

            {/* Main Content Area */}
            <main className="dashboard-content">
                {activeTab === "sync" && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                        <header className="content-header">
                            <h2>{t('sync.title')}</h2>
                            <p>{t('sync.subtitle')}</p>
                        </header>

                        <div className="grid-cards">
                            <motion.div className="glass-panel stat-card" whileHover={{ y: -4 }}>
                                <div className="stat-header">
                                    <ShieldCheck className="text-primary" size={24} />
                                    <span className="badge">{t('sync.e2ee_status')}</span>
                                </div>
                                <h3>{t('sync.master_key_title')}</h3>
                                <p>{t('sync.master_key_desc')}</p>
                            </motion.div>

                            <motion.div className="glass-panel stat-card" whileHover={{ y: -4 }}>
                                <div className="stat-header">
                                    <CheckCircle2 className="text-success" size={24} />
                                    <span className="badge">{networkLabel}</span>
                                </div>
                                <h3>{t('sync.hub_connected_title')}</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('sync.detail_host')}</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--color-primary)', fontWeight: 600 }}>{serverInfo.host}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('sync.detail_port')}</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>{serverInfo.port}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('sync.detail_user')}</span>
                                        <span style={{ fontSize: '13px' }}>{connectedUser}</span>
                                    </div>
                                    {connectedAt && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('sync.detail_session')}</span>
                                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{new Date(connectedAt).toLocaleTimeString()}</span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        </div>

                        <div className="glass-panel device-list" style={{ marginTop: '20px' }}>
                            <div className="list-header">
                                <h3>{t('sync.online_devices_title')}</h3>
                                <span className="device-count">{t('sync.active_devices_count', { count: 3 })}</span>
                            </div>

                            <div className="device-item">
                                <div className="device-icon pc">
                                    <Laptop2 size={24} />
                                </div>
                                <div className="device-info">
                                    <h4>{t('sync.this_desktop_title')}</h4>
                                    <p>{t('sync.this_desktop_desc')}</p>
                                </div>
                                <div className="device-status">{t('sync.status_online')}</div>
                            </div>
                            <div className="device-item">
                                <div className="device-icon mobile">
                                    <Smartphone size={24} />
                                </div>
                                <div className="device-info">
                                    <h4>{t('sync.my_iphone_title')}</h4>
                                    <p>{t('sync.my_iphone_desc')}</p>
                                </div>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <button
                                        onClick={() => handleSendFile(0)}
                                        className="btn-ghost"
                                        style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85em', background: 'rgba(255,255,255,0.05)', borderRadius: '6px' }}
                                    >
                                        <FileUp size={14} /> {t('sync.send_file_btn')}
                                    </button>
                                    <div className="device-status">{t('sync.status_idle')}</div>
                                </div>
                            </div>
                        </div>

                        <div className="glass-panel device-list" style={{ marginTop: '20px' }}>
                            <div className="list-header">
                                <h3>{t('sync.activity_stream_title')}</h3>
                                <span className="device-count">{t('sync.activity_stream_live')}</span>
                            </div>

                            {clipboardLogs.length === 0 ? (
                                <p style={{ padding: '20px', color: '#888', textAlign: 'center' }}>{t('sync.no_activity_message')}</p>
                            ) : (
                                <div className="activity-feed" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 20px 20px' }}>
                                    <AnimatePresence>
                                        {clipboardLogs.map(log => (
                                            <motion.div
                                                key={log.id}
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="activity-item"
                                                style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(255,255,255,0.03)', padding: '12px 15px', borderRadius: '10px' }}
                                            >
                                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: log.status === 'sent' ? '#00e676' : '#2979ff', boxShadow: `0 0 10px ${log.status === 'sent' ? '#00e676' : '#2979ff'}` }} />
                                                <div style={{ flex: 1 }}>
                                                    <span style={{ color: log.status === 'sent' ? '#00e676' : '#2979ff', fontWeight: 'bold', marginRight: '10px', textTransform: 'uppercase', fontSize: '0.85em' }}>
                                                        {log.status === 'sent' ? t('sync.status_sent') : t('sync.status_received')}
                                                    </span>
                                                    {log.preview.startsWith('data:image/') ? (
                                                        <img src={log.preview} alt="Clipboard Image" style={{ maxHeight: '60px', borderRadius: '4px', verticalAlign: 'middle' }} />
                                                    ) : (
                                                        <span style={{ color: '#eee', fontFamily: 'monospace' }}>{log.preview}</span>
                                                    )}
                                                </div>
                                                <div style={{ color: '#666', fontSize: '0.85em' }}>
                                                    {log.timestamp.toLocaleTimeString()}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}

                {activeTab === "snippets" && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                        <header className="content-header">
                            <h2>{t('snippets.title')}</h2>
                            <p>{t('snippets.subtitle')}</p>
                        </header>

                        <form className="glass-panel snippet-form" onSubmit={handleAddSnippet} style={{ marginBottom: "20px", padding: "20px", display: "flex", gap: "10px", alignItems: "center" }}>
                            <input
                                className="modern-input"
                                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px' }}
                                placeholder={t('snippets.trigger_placeholder')}
                                value={newTrigger}
                                onChange={(e) => setNewTrigger(e.target.value)}
                                required
                            />
                            <input
                                className="modern-input"
                                style={{ flex: 2, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px' }}
                                placeholder={t('snippets.replacement_placeholder')}
                                value={newReplacement}
                                onChange={(e) => setNewReplacement(e.target.value)}
                                required
                            />
                            <button type="submit" className="btn-primary" style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <Plus size={18} /> {t('snippets.add_btn')}
                            </button>
                        </form>

                        <div className="glass-panel device-list">
                            <div className="list-header">
                                <h3>{t('snippets.active_snippets_title')}</h3>
                                <span className="device-count">{t('snippets.rules_count', { count: Object.keys(snippets).length })}</span>
                            </div>

                            {Object.entries(snippets).length === 0 ? (
                                <p style={{ padding: '20px', color: '#888' }}>{t('snippets.no_snippets_message')}</p>
                            ) : (
                                Object.entries(snippets).map(([trigger, replacement]) => (
                                    <div className="device-item" key={trigger} style={{ alignItems: 'center' }}>
                                        <div className="device-info" style={{ flex: 1 }}>
                                            <h4>
                                                <span style={{ color: 'var(--color-primary)', marginRight: '10px', fontFamily: 'monospace', background: 'var(--color-primary-glow)', padding: '3px 8px', borderRadius: '6px' }}>{trigger}</span>
                                            </h4>
                                            <p style={{ color: 'var(--color-text-muted)', marginTop: '5px' }}>{replacement}</p>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveSnippet(trigger)}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '10px' }}
                                        >
                                            <Trash2 size={20} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </motion.div>
                )}

                {activeTab === "settings" && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                        <header className="content-header">
                            <h2>{t('settings.title')}</h2>
                            <p>{t('settings.subtitle')}</p>
                        </header>

                        <div className="glass-panel" style={{ padding: '30px', color: 'var(--color-text-main)', display: 'flex', flexDirection: 'column', gap: '25px' }}>
                            {/* Personalization */}
                            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid var(--color-glass-border)' }}>
                                <div className="setting-info">
                                    <h4 style={{ margin: '0 0 5px 0', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <Moon size={18} className="text-primary" /> {t('settings.theme_title')}
                                    </h4>
                                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{t('settings.theme_desc')}</p>
                                </div>
                                <button className="btn-ghost" onClick={toggleTheme} style={{ display: 'flex', gap: '8px' }}>
                                    {theme === 'dark' ? <><Sun size={18} /> {t('settings.light_mode')}</> : <><Moon size={18} /> {t('settings.dark_mode')}</>}
                                </button>
                            </div>

                            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid var(--color-glass-border)' }}>
                                <div className="setting-info">
                                    <h4 style={{ margin: '0 0 5px 0', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <Globe size={18} className="text-success" /> {t('settings.language_title')}
                                    </h4>
                                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{t('settings.language_desc')}</p>
                                </div>
                                <button className="btn-ghost" onClick={toggleLang}>
                                    {i18n.language === 'zh' ? t('settings.language_english') : t('settings.language_chinese')}
                                </button>
                            </div>

                            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid var(--color-glass-border)' }}>
                                <div className="setting-info">
                                    <h4 style={{ margin: '0 0 5px 0', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <Keyboard size={18} className="text-primary" /> {t('settings.engine_title')}
                                    </h4>
                                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{t('settings.engine_desc')}</p>
                                </div>
                                <label className="custom-toggle">
                                    <input type="checkbox" checked={settings.is_snippets_enabled} onChange={() => handleToggleSetting('is_snippets_enabled')} />
                                    <span className="toggle-slider"></span>
                                </label>
                            </div>

                            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className="setting-info">
                                    <h4 style={{ margin: '0 0 5px 0', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <Copy size={18} className="text-success" /> {t('settings.sync_title')}
                                    </h4>
                                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{t('settings.sync_desc')}</p>
                                </div>
                                <label className="custom-toggle">
                                    <input type="checkbox" checked={settings.is_sync_enabled} onChange={() => handleToggleSetting('is_sync_enabled')} />
                                    <span className="toggle-slider success"></span>
                                </label>
                            </div>
                        </div>

                        <div className="glass-panel" style={{ padding: '30px', color: 'var(--color-text-main)', marginTop: '20px' }}>
                            <div className="list-header" style={{ marginBottom: '20px' }}>
                                <h3>{t('settings.blacklist_title')}</h3>
                                <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{t('settings.blacklist_desc')}</p>
                            </div>

                            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                                <button type="button" onClick={() => setShowAppSelector(true)} className="btn-primary" style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', display: 'flex', gap: '5px', alignItems: 'center' }}>
                                    <Plus size={18} /> {t('settings.btn_add_exception')}
                                </button>
                            </div>

                            <div className="device-list" style={{ background: 'transparent', padding: 0 }}>
                                {blockedApps.length === 0 ? (
                                    <p style={{ color: 'var(--color-text-muted)' }}>{t('settings.no_blocked_apps')}</p>
                                ) : (
                                    blockedApps.map(app => (
                                        <div key={app} style={{ display: 'flex', alignItems: 'center', background: 'var(--color-surface-elevated)', marginBottom: '12px', borderRadius: 'var(--radius-md)', padding: '16px 20px', border: '1px solid var(--color-border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                            <div style={{ flex: 1 }}>
                                                <h4 style={{ color: 'var(--color-text-main)', fontFamily: 'monospace', margin: 0, fontSize: '15px' }}>{app}</h4>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveBlockedApp(app)}
                                                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', transition: 'all 0.2s' }}
                                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(232, 17, 35, 0.1)'; e.currentTarget.style.color = '#E81123'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                                            >
                                                <Trash2 size={20} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </main>

            {showAppSelector && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(5px)' }} onClick={() => setShowAppSelector(false)}>
                    <div style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-glass-border)', borderRadius: '16px', width: '700px', maxWidth: '90%', padding: '30px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--color-glass-border)', paddingBottom: '15px' }}>
                            <h3 style={{ margin: 0, color: 'var(--color-text-main)' }}>Select Application to Exclude</h3>
                            <button onClick={() => setShowAppSelector(false)} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}><X size={24} /></button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                            <div style={{ background: 'var(--color-glass-bg)', padding: '20px', borderRadius: '12px', textAlign: 'center', border: '1px dashed var(--color-glass-border)' }}>
                                <Target size={40} color={isSpying ? "#00e676" : "#2979ff"} style={{ margin: '0 auto 15px', cursor: 'crosshair' }} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} />
                                <h4 style={{ color: 'var(--color-text-main)', fontSize: '1rem', marginBottom: '10px' }}>Target Window</h4>
                                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', margin: 0 }}>Drag the crosshair icon above and release it onto the target window.</p>
                            </div>

                            <div style={{ background: 'var(--color-glass-bg)', padding: '20px', borderRadius: '12px', textAlign: 'center', border: '1px dashed var(--color-glass-border)' }}>
                                <Upload size={40} color="#F77062" style={{ margin: '0 auto 15px' }} />
                                <h4 style={{ color: 'var(--color-text-main)', fontSize: '1rem', marginBottom: '10px' }}>Drag & Drop</h4>
                                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', margin: 0 }}>Drag and drop an .exe file or shortcut anywhere onto this window.</p>
                            </div>

                            <div onClick={handleAddBlockedAppFromDialog} style={{ background: 'var(--color-glass-bg)', padding: '20px', borderRadius: '12px', textAlign: 'center', border: '1px dashed var(--color-glass-border)', cursor: 'pointer' }}>
                                <FileUp size={40} color="#b388ff" style={{ margin: '0 auto 15px' }} />
                                <h4 style={{ color: 'var(--color-text-main)', fontSize: '1rem', marginBottom: '10px' }}>Browse Files</h4>
                                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', margin: 0 }}>Select .exe or shortcut from a dialog window.</p>
                            </div>
                        </div>

                        <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <form onSubmit={handleAddBlockedApp} style={{ display: 'flex', gap: '10px' }}>
                                <input
                                    className="modern-input"
                                    style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px' }}
                                    placeholder="Or manually enter exact exe name (e.g. wow.exe)"
                                    value={newBlockedApp}
                                    onChange={(e) => setNewBlockedApp(e.target.value)}
                                />
                                <button type="submit" className="btn-primary" style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', display: 'flex', gap: '5px', alignItems: 'center' }}>
                                    <Plus size={18} /> Add Manually
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
