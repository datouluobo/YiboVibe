import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Keyboard, Settings, LogOut, CheckCircle2, Laptop2, Smartphone, ShieldCheck, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./Dashboard.css";

export default function Dashboard() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState("sync");

    // Snippets State
    const [snippets, setSnippets] = useState<Record<string, string>>({});
    const [newTrigger, setNewTrigger] = useState("");
    const [newReplacement, setNewReplacement] = useState("");

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

    return (
        <div className="dashboard-container">
            {/* Sidebar Navigation */}
            <nav className="glass-panel sidebar">
                <div className="sidebar-header">
                    <div className="status-indicator">
                        <span className="dot online"></span>
                        Engine Connected
                    </div>
                </div>

                <ul className="sidebar-menu">
                    <li className={activeTab === "sync" ? "active" : ""} onClick={() => setActiveTab("sync")}>
                        <Copy size={18} /> Sync Devices
                    </li>
                    <li className={activeTab === "snippets" ? "active" : ""} onClick={() => setActiveTab("snippets")}>
                        <Keyboard size={18} /> Snippets
                    </li>
                    <li className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
                        <Settings size={18} /> Settings
                    </li>
                </ul>

                <div className="sidebar-footer">
                    <button className="btn-ghost" onClick={() => navigate("/")} style={{ width: "100%", justifyContent: "flex-start", display: "flex", gap: "10px" }}>
                        <LogOut size={16} /> Disconnect
                    </button>
                </div>
            </nav>

            {/* Main Content Area */}
            <main className="dashboard-content">
                {activeTab === "sync" && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                        <header className="content-header">
                            <h2>Device Synchronization</h2>
                            <p>End-to-end encrypted clipboard bridge</p>
                        </header>

                        <div className="grid-cards">
                            <motion.div className="glass-panel stat-card" whileHover={{ y: -4 }}>
                                <div className="stat-header">
                                    <ShieldCheck className="text-primary" size={24} />
                                    <span className="badge">E2EE Active</span>
                                </div>
                                <h3>Master Key Loaded</h3>
                                <p>AES-256-GCM / Argon2id</p>
                            </motion.div>

                            <motion.div className="glass-panel stat-card" whileHover={{ y: -4 }}>
                                <div className="stat-header">
                                    <CheckCircle2 className="text-success" size={24} />
                                    <span className="badge">WebSocket</span>
                                </div>
                                <h3>NAS Hub Connected</h3>
                                <p>Ping: 12ms</p>
                            </motion.div>
                        </div>

                        <div className="glass-panel device-list" style={{ marginTop: '20px' }}>
                            <div className="list-header">
                                <h3>Online Devices</h3>
                                <span className="device-count">3 Active</span>
                            </div>

                            <div className="device-item">
                                <div className="device-icon pc">
                                    <Laptop2 size={24} />
                                </div>
                                <div className="device-info">
                                    <h4>This Desktop (Master)</h4>
                                    <p>Windows 11 Engine</p>
                                </div>
                                <div className="device-status">Online</div>
                            </div>
                            <div className="device-item">
                                <div className="device-icon mobile">
                                    <Smartphone size={24} />
                                </div>
                                <div className="device-info">
                                    <h4>My iPhone 15 Pro</h4>
                                    <p>iOS App</p>
                                </div>
                                <div className="device-status">Idle</div>
                            </div>
                        </div>

                        <div className="glass-panel device-list" style={{ marginTop: '20px' }}>
                            <div className="list-header">
                                <h3>Activity Stream</h3>
                                <span className="device-count">Live</span>
                            </div>

                            {clipboardLogs.length === 0 ? (
                                <p style={{ padding: '20px', color: '#888', textAlign: 'center' }}>No sync activity yet. Try copying something!</p>
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
                                                        {log.status === 'sent' ? 'Encrypted & Sent' : 'Received & Decrypted'}
                                                    </span>
                                                    <span style={{ color: '#eee', fontFamily: 'monospace' }}>{log.preview}</span>
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
                            <h2>Magic Snippets</h2>
                            <p>Global keyboard hooks auto-expand your shorthands.</p>
                        </header>

                        <form className="glass-panel snippet-form" onSubmit={handleAddSnippet} style={{ marginBottom: "20px", padding: "20px", display: "flex", gap: "10px", alignItems: "center" }}>
                            <input
                                className="modern-input"
                                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px' }}
                                placeholder="Trigger (e.g. /mail)"
                                value={newTrigger}
                                onChange={(e) => setNewTrigger(e.target.value)}
                                required
                            />
                            <input
                                className="modern-input"
                                style={{ flex: 2, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px' }}
                                placeholder="Expansion text (e.g. hello@yiboflow.com)"
                                value={newReplacement}
                                onChange={(e) => setNewReplacement(e.target.value)}
                                required
                            />
                            <button type="submit" className="btn-primary" style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <Plus size={18} /> Add
                            </button>
                        </form>

                        <div className="glass-panel device-list">
                            <div className="list-header">
                                <h3>Active Snippets</h3>
                                <span className="device-count">{Object.keys(snippets).length} Rules</span>
                            </div>

                            {Object.entries(snippets).length === 0 ? (
                                <p style={{ padding: '20px', color: '#888' }}>No snippets configured yet. Add one above!</p>
                            ) : (
                                Object.entries(snippets).map(([trigger, replacement]) => (
                                    <div className="device-item" key={trigger} style={{ alignItems: 'center' }}>
                                        <div className="device-info" style={{ flex: 1 }}>
                                            <h4>
                                                <span style={{ color: '#F77062', marginRight: '10px', fontFamily: 'monospace', background: 'rgba(247,112,98,0.1)', padding: '3px 8px', borderRadius: '6px' }}>{trigger}</span>
                                            </h4>
                                            <p style={{ color: '#DDD', marginTop: '5px' }}>{replacement}</p>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveSnippet(trigger)}
                                            style={{ background: 'transparent', border: 'none', color: '#8E8E93', cursor: 'pointer', padding: '10px' }}
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
                            <h2>Settings</h2>
                            <p>System configuration & preferences.</p>
                        </header>
                        <div className="glass-panel" style={{ padding: '30px', color: '#eee', display: 'flex', flexDirection: 'column', gap: '25px' }}>
                            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <div className="setting-info">
                                    <h4 style={{ margin: '0 0 5px 0', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <Keyboard size={18} className="text-primary" /> Magic Snippets Engine
                                    </h4>
                                    <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>Enable global keyboard hooks for automatic text expansion.</p>
                                </div>
                                <label className="flex items-center cursor-pointer">
                                    <div className="relative">
                                        <input type="checkbox" className="sr-only" checked={settings.is_snippets_enabled} onChange={() => handleToggleSetting('is_snippets_enabled')} />
                                        <div className={`block w-14 h-8 rounded-full ${settings.is_snippets_enabled ? 'bg-primary' : 'bg-gray-600'}`} style={{ transition: 'background-color 0.3s' }}></div>
                                        <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${settings.is_snippets_enabled ? 'transform translate-x-6' : ''}`}></div>
                                    </div>
                                </label>
                            </div>

                            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className="setting-info">
                                    <h4 style={{ margin: '0 0 5px 0', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <Copy size={18} className="text-success" /> E2EE Clipboard Sync
                                    </h4>
                                    <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>Securely synchronize clipboard across your connected devices.</p>
                                </div>
                                <label className="flex items-center cursor-pointer">
                                    <div className="relative">
                                        <input type="checkbox" className="sr-only" checked={settings.is_sync_enabled} onChange={() => handleToggleSetting('is_sync_enabled')} />
                                        <div className={`block w-14 h-8 rounded-full ${settings.is_sync_enabled ? 'bg-success' : 'bg-gray-600'}`} style={{ transition: 'background-color 0.3s' }}></div>
                                        <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${settings.is_sync_enabled ? 'transform translate-x-6' : ''}`}></div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </motion.div>
                )}
            </main>
        </div>
    );
}
