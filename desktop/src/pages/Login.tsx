import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, User, Server, ChevronDown, RefreshCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

export default function Login() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [serverUrl, setServerUrl] = useState(() => {
        const hist = localStorage.getItem('yiboflow_server_url_history');
        if (hist) {
            try {
                const parsed = JSON.parse(hist);
                if (parsed.length > 0) return parsed[0];
            } catch { }
        }
        return localStorage.getItem('yiboflow_server_url') || "http://127.0.0.1:8080";
    });

    // History dropdown state
    const [urlHistory, setUrlHistory] = useState<string[]>(() => {
        const hist = localStorage.getItem('yiboflow_server_url_history');
        if (hist) {
            try { return JSON.parse(hist); } catch { }
        }
        return ["http://127.0.0.1:8080"];
    });
    const [showHistory, setShowHistory] = useState(false);
    const historyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
                setShowHistory(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const [username, setUsername] = useState(() => localStorage.getItem('yiboflow_username') || "admin");
    const [rememberPwd, setRememberPwd] = useState(() => localStorage.getItem('yiboflow_remember_pwd') === 'true');
    const [autoLogin, setAutoLogin] = useState(() => localStorage.getItem('yiboflow_auto_login') === 'true');
    const [password, setPassword] = useState(() => {
        if (localStorage.getItem('yiboflow_remember_pwd') === 'true') {
            try { return atob(localStorage.getItem('yiboflow_saved_pwd') || ""); } catch { return ""; }
        }
        return "";
    });
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);
    const [successMsg, setSuccessMsg] = useState("");
    const [showConflictModal, setShowConflictModal] = useState(false);
    const [showSyncConflictModal, setShowSyncConflictModal] = useState<{ isOpen: boolean, files: string[] }>({ isOpen: false, files: [] });
    const [conflictResolutions, setConflictResolutions] = useState<Record<string, 'keep_local' | 'take_remote'>>({});
    const [renameValue, setRenameValue] = useState("");

    useEffect(() => {
        // Auto-login on mount if enabled
        const shouldAuto = localStorage.getItem('yiboflow_auto_login') === 'true';
        if (shouldAuto && username && password && !isRegistering) {
            // Briefly wait to ensure translations/context are ready if needed
            const timer = setTimeout(() => {
                const fakeEvent = { preventDefault: () => { } } as React.FormEvent;
                handleAuth(fakeEvent);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, []); // Only run once on mount

    const updateHistory = (url: string) => {
        const updated = [url, ...urlHistory.filter(h => h !== url)].slice(0, 5);
        setUrlHistory(updated);
        localStorage.setItem('yiboflow_server_url_history', JSON.stringify(updated));
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setErrorMsg("");
        setSuccessMsg("");

        try {
            if (isRegistering) {
                const result: boolean = await invoke("register_engine", {
                    serverUrl,
                    username,
                    password,
                });

                if (result) {
                    setSuccessMsg("Registration successful! You may now log in.");
                    setIsRegistering(false); // Switch to login view
                } else {
                    setErrorMsg("Failed to register user.");
                }
            } else {
                const result: boolean = await invoke("connect_engine", {
                    serverUrl,
                    username,
                    password,
                });

                if (result) {
                    localStorage.setItem('yiboflow_server_url', serverUrl);
                    localStorage.setItem('yiboflow_username', username);
                    localStorage.setItem('yiboflow_connected_at', new Date().toISOString());
                    if (rememberPwd) {
                        localStorage.setItem('yiboflow_remember_pwd', 'true');
                        localStorage.setItem('yiboflow_saved_pwd', btoa(password));
                        if (autoLogin) {
                            localStorage.setItem('yiboflow_auto_login', 'true');
                        } else {
                            localStorage.removeItem('yiboflow_auto_login');
                        }
                    } else {
                        localStorage.removeItem('yiboflow_remember_pwd');
                        localStorage.removeItem('yiboflow_saved_pwd');
                        localStorage.removeItem('yiboflow_auto_login');
                    }
                    updateHistory(serverUrl);
                    navigate("/app");
                } else {
                    setErrorMsg("Failed to authenticate with core engine.");
                }
            }
        } catch (error) {
            const errStr = String(error);
            if (isRegistering && (errStr.includes("err") || errStr.toLowerCase().includes("exist") || errStr.includes("409"))) {
                setShowConflictModal(true);
            } else if (!isRegistering && errStr.includes("SYNC_CONFLICT_DIVERGED:")) {
                try {
                    const jsonPart = errStr.split("SYNC_CONFLICT_DIVERGED:")[1];
                    const files = JSON.parse(jsonPart);
                    const initialResolutions: Record<string, 'keep_local' | 'take_remote'> = {};
                    files.forEach((f: string) => initialResolutions[f] = 'keep_local');
                    setConflictResolutions(initialResolutions);
                    setShowSyncConflictModal({ isOpen: true, files });
                } catch {
                    setErrorMsg("Failed to parse conflict metadata: " + errStr);
                }
            } else {
                setErrorMsg(errStr);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <motion.div
                className="glass-panel auth-card"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
            >
                <div className="auth-header">
                    <motion.div
                        className="auth-logo"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <Lock size={26} strokeWidth={2.5} />
                    </motion.div>
                    <h1 className="auth-title">{isRegistering ? t('login.title_register') : t('login.title_login')}</h1>
                    <p className="auth-subtitle">{isRegistering ? t('login.subtitle_register') : t('login.subtitle_login')}</p>
                </div>

                <form className="auth-form" onSubmit={handleAuth}>
                    {errorMsg && (
                        <div style={{ color: "#E81123", fontSize: 13, textAlign: "center", background: "rgba(232,17,35,0.1)", padding: "8px", borderRadius: "8px" }}>
                            {errorMsg}
                        </div>
                    )}
                    {successMsg && (
                        <div style={{ color: "#30d158", fontSize: 13, textAlign: "center", background: "rgba(48, 209, 88, 0.1)", padding: "8px", borderRadius: "8px" }}>
                            {successMsg}
                        </div>
                    )}

                    <div className="input-group">
                        <label htmlFor="serverUrl">{t('login.server_url')}</label>
                        <div style={{ position: "relative" }} ref={historyRef}>
                            <Server size={18} style={{ position: "absolute", left: 14, top: 12, color: "#8E8E93", zIndex: 2 }} />
                            <input
                                id="serverUrl"
                                type="text"
                                className="modern-input"
                                style={{ paddingLeft: 40, paddingRight: 40 }}
                                placeholder="e.g. http://127.0.0.1:8080"
                                value={serverUrl === 'local' ? t('login.local_mode_label') : serverUrl}
                                onChange={(e) => {
                                    if (e.target.value !== t('login.local_mode_label')) {
                                        setServerUrl(e.target.value);
                                    }
                                }}
                                onFocus={() => setShowHistory(true)}
                                required
                            />

                            <div
                                style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: "pointer", color: "#8E8E93" }}
                                onClick={() => setShowHistory(!showHistory)}
                            >
                                <ChevronDown size={18} style={{ transform: showHistory ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                            </div>

                            <AnimatePresence>
                                {showHistory && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                                        style={{
                                            position: "absolute",
                                            top: "100%",
                                            left: 0,
                                            right: 0,
                                            background: "var(--color-surface-elevated)",
                                            border: "1px solid var(--color-glass-border)",
                                            borderRadius: "8px",
                                            marginTop: "4px",
                                            zIndex: 10,
                                            boxShadow: "var(--shadow-glass)",
                                            overflow: "hidden"
                                        }}>
                                        <div
                                            style={{
                                                padding: "12px 14px",
                                                cursor: "pointer",
                                                color: "var(--color-text-main)",
                                                borderBottom: "1px solid var(--color-glass-border)",
                                                fontSize: "13px",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                fontWeight: 500
                                            }}
                                            onMouseEnter={(e) => Object.assign(e.currentTarget.style, { background: "var(--color-glass-bg)" })}
                                            onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: "transparent" })}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                setServerUrl('local');
                                                setShowHistory(false);
                                            }}
                                        >
                                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#30d158" }}></div>
                                            {t('login.local_mode_label')}
                                        </div>
                                        {urlHistory.filter(h => h !== 'local').map(histUrl => (
                                            <div
                                                key={histUrl}
                                                style={{
                                                    padding: "12px 14px",
                                                    cursor: "pointer",
                                                    color: "var(--color-text-main)",
                                                    borderBottom: "1px solid var(--color-glass-border)",
                                                    fontSize: "13px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "8px"
                                                }}
                                                onMouseEnter={(e) => Object.assign(e.currentTarget.style, { background: "var(--color-glass-bg)" })}
                                                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: "transparent" })}
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => {
                                                    setServerUrl(histUrl);
                                                    setShowHistory(false);
                                                }}
                                            >
                                                <Server size={14} style={{ color: "var(--color-primary)" }} />
                                                {histUrl}
                                            </div>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    <div className="input-group">
                        <label htmlFor="username">{t('login.username')}</label>
                        <div style={{ position: "relative" }}>
                            <User size={18} style={{ position: "absolute", left: 14, top: 12, color: "#8E8E93" }} />
                            <input
                                id="username"
                                type="text"
                                className="modern-input"
                                style={{ paddingLeft: 40 }}
                                placeholder={t('login.placeholder_username')}
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label htmlFor="password">{t('login.master_password')}</label>
                        <div style={{ position: "relative" }}>
                            <Lock size={18} style={{ position: "absolute", left: 14, top: 12, color: "#8E8E93" }} />
                            <input
                                id="password"
                                type="password"
                                className="modern-input"
                                style={{ paddingLeft: 40 }}
                                placeholder={t('login.placeholder_password')}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    {!isRegistering && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px", marginBottom: "4px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input
                                    type="checkbox"
                                    id="rememberPwd"
                                    checked={rememberPwd}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setRememberPwd(checked);
                                        if (!checked) setAutoLogin(false); // Constraint: No remember -> No auto
                                    }}
                                    style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--color-primary)" }}
                                />
                                <label htmlFor="rememberPwd" style={{ fontSize: "13px", color: "var(--color-text-muted)", cursor: "pointer", userSelect: "none" }}>
                                    {t('login.remember_pwd')}
                                </label>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input
                                    type="checkbox"
                                    id="autoLogin"
                                    checked={autoLogin}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setAutoLogin(checked);
                                        if (checked) setRememberPwd(true); // Constraint: Auto login implies Remember pwd
                                    }}
                                    style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--color-primary)" }}
                                />
                                <label htmlFor="autoLogin" style={{ fontSize: "13px", color: "var(--color-text-muted)", cursor: "pointer", userSelect: "none" }}>
                                    {t('login.auto_login')}
                                </label>
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={`btn-primary ${loading ? "loading" : ""}`}
                        style={{ marginTop: "16px", height: "48px" }}
                    >
                        {loading ? (isRegistering ? t('login.msg_connecting') : t('login.msg_logging_in')) : (isRegistering ? t('login.btn_register') : t('login.btn_login'))}
                    </button>

                    <div style={{ textAlign: "center", marginTop: "12px" }}>
                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                                setIsRegistering(!isRegistering);
                                setErrorMsg("");
                                setSuccessMsg("");
                            }}
                            style={{ fontSize: "14px", color: "var(--color-primary)" }}
                        >
                            {isRegistering ? t('login.toggle_login') : t('login.toggle_register')}
                        </button>
                    </div>
                </form>
            </motion.div>

            {/* Conflict Resolution Modal */}
            <AnimatePresence>
                {showConflictModal && (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            style={{ background: "var(--color-surface-elevated)", padding: 24, borderRadius: 12, width: 440, boxShadow: "var(--shadow-glass)" }}
                        >
                            <h3 style={{ marginTop: 0, color: "var(--color-text-main)" }}>⚠️ {t('login.conflict_title')}</h3>
                            <p style={{ color: "var(--color-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
                                {t('login.conflict_desc')}
                            </p>

                            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
                                <button className="btn-primary" onClick={() => {
                                    setIsRegistering(false); // Switch to login
                                    setShowConflictModal(false);
                                }}>{t('login.conflict_merge')}</button>

                                <div style={{ display: "flex", gap: 8 }}>
                                    <input
                                        type="text"
                                        className="modern-input"
                                        placeholder={t('login.rename_placeholder')}
                                        value={renameValue}
                                        onChange={e => setRenameValue(e.target.value)}
                                        style={{ flex: 1 }}
                                    />
                                    <button className="btn-outline" disabled={!renameValue || renameValue === username} onClick={async () => {
                                        try {
                                            const success = await invoke<boolean>("rename_local_account", {
                                                oldUsername: username,
                                                newUsername: renameValue
                                            });
                                            if (success) {
                                                setUsername(renameValue);
                                                setShowConflictModal(false);
                                                setSuccessMsg("Local account renamed successfully! Try initializing again.");
                                                localStorage.setItem('yiboflow_username', renameValue);
                                            }
                                        } catch (e) {
                                            setErrorMsg("Rename failed: " + String(e));
                                            setShowConflictModal(false);
                                        }
                                    }}>{t('login.conflict_rename')}</button>
                                </div>

                                <button className="btn-outline" style={{ color: "#E81123", borderColor: "rgba(232,17,35,0.2)" }} onClick={async () => {
                                    try {
                                        await invoke("force_override_remote", {
                                            serverUrl,
                                            username
                                        });
                                    } catch (e) {
                                        setErrorMsg("Override failed: " + String(e));
                                        setShowConflictModal(false);
                                    }
                                }}>{t('login.conflict_override')}</button>
                            </div>

                            <button className="btn-ghost" style={{ marginTop: 16, width: "100%", fontSize: 13, color: "var(--color-text-muted)" }} onClick={() => setShowConflictModal(false)}>
                                {t('login.conflict_cancel')}
                            </button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Sync Conflict Modal */}
            {/* Sync Conflict Modal */}
            <AnimatePresence>
                {showSyncConflictModal.isOpen && (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            style={{ background: "var(--color-surface-elevated)", padding: 24, borderRadius: 12, width: 480, boxShadow: "var(--shadow-glass)" }}
                        >
                            <h3 style={{ marginTop: 0, color: "var(--color-text-main)", display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <RefreshCcw size={20} color="var(--color-danger)" />
                                数据同步冲突
                            </h3>
                            <p style={{ color: "var(--color-text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: '20px' }}>
                                您的本机数据与云端数据发生了部分文件级别冲突（核心文件双端均被修改过）。请逐一选择保留哪个版本的数据：
                            </p>

                            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 300, overflowY: 'auto', marginBottom: 20 }}>
                                {showSyncConflictModal.files.map(file => (
                                    <div key={file} style={{ background: "var(--color-bg-base)", padding: '12px', borderRadius: '8px', border: '1px solid var(--color-glass-border)' }}>
                                        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>📄 {file}</div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button
                                                className={conflictResolutions[file] === 'keep_local' ? 'btn-primary' : 'btn-outline'}
                                                style={{ flex: 1, padding: '6px', fontSize: 13 }}
                                                onClick={() => setConflictResolutions(prev => ({ ...prev, [file]: 'keep_local' }))}
                                            >
                                                保留本机数据
                                            </button>
                                            <button
                                                className={conflictResolutions[file] === 'take_remote' ? 'btn-primary' : 'btn-outline'}
                                                style={{ flex: 1, padding: '6px', fontSize: 13 }}
                                                onClick={() => setConflictResolutions(prev => ({ ...prev, [file]: 'take_remote' }))}
                                            >
                                                使用云端数据
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button className="btn-primary" style={{ width: "100%", background: "var(--color-danger)", border: "none" }} onClick={async () => {
                                setLoading(true);
                                setShowSyncConflictModal({ isOpen: false, files: [] });
                                try {
                                    await invoke("resolve_file_conflicts", {
                                        resolutions: conflictResolutions,
                                        serverUrl,
                                        username,
                                        password
                                    });
                                    // Once resolved successfully, navigate through
                                    localStorage.setItem('yiboflow_server_url', serverUrl);
                                    localStorage.setItem('yiboflow_username', username);
                                    localStorage.setItem('yiboflow_connected_at', new Date().toISOString());
                                    if (rememberPwd) {
                                        localStorage.setItem('yiboflow_remember_pwd', 'true');
                                        localStorage.setItem('yiboflow_saved_pwd', btoa(password));
                                    }
                                    updateHistory(serverUrl);
                                    setLoading(false);
                                    navigate("/app");
                                } catch (e) {
                                    setErrorMsg("合并冲突执行失败: " + String(e));
                                    setLoading(false);
                                }
                            }}>
                                🚀 确认合并计划并覆盖
                            </button>

                            <button className="btn-ghost" style={{ marginTop: 12, width: "100%", fontSize: 13, color: "var(--color-text-muted)" }} onClick={() => setShowSyncConflictModal({ isOpen: false, files: [] })}>
                                取消登录
                            </button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
