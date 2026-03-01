import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, User, Server, ChevronDown } from "lucide-react";
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
                    } else {
                        localStorage.removeItem('yiboflow_remember_pwd');
                        localStorage.removeItem('yiboflow_saved_pwd');
                    }
                    updateHistory(serverUrl);
                    navigate("/dashboard");
                } else {
                    setErrorMsg("Failed to authenticate with core engine.");
                }
            }
        } catch (error) {
            setErrorMsg(String(error));
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
                                type="url"
                                className="modern-input"
                                style={{ paddingLeft: 40, paddingRight: 40 }}
                                placeholder="e.g. http://127.0.0.1:8080"
                                value={serverUrl}
                                onChange={(e) => setServerUrl(e.target.value)}
                                onFocus={() => urlHistory.length > 0 && setShowHistory(true)}
                                required
                            />

                            <div
                                style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: "pointer", color: "#8E8E93" }}
                                onClick={() => urlHistory.length > 0 && setShowHistory(!showHistory)}
                            >
                                <ChevronDown size={18} style={{ transform: showHistory ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                            </div>

                            <AnimatePresence>
                                {showHistory && urlHistory.length > 0 && (
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
                                        {urlHistory.map(histUrl => (
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
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", marginBottom: "4px" }}>
                            <input
                                type="checkbox"
                                id="rememberPwd"
                                checked={rememberPwd}
                                onChange={(e) => setRememberPwd(e.target.checked)}
                                style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--color-primary)" }}
                            />
                            <label htmlFor="rememberPwd" style={{ fontSize: "13px", color: "var(--color-text-muted)", cursor: "pointer", userSelect: "none" }}>
                                {t('login.remember_pwd')}
                            </label>
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
        </div>
    );
}
