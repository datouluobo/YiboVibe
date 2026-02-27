import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, User, Server } from "lucide-react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";

export default function Login() {
    const navigate = useNavigate();
    const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8080");
    const [username, setUsername] = useState("admin");
    const [password, setPassword] = useState("my_strong_password");
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setErrorMsg("");

        try {
            const result: boolean = await invoke("connect_engine", {
                serverUrl,
                username,
                password,
            });

            if (result) {
                navigate("/dashboard");
            } else {
                setErrorMsg("Failed to authenticate with core engine.");
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
                    <h1 className="auth-title">YiboFlow Core</h1>
                    <p className="auth-subtitle">E2EE Clipboard & Snippets Engine</p>
                </div>

                <form className="auth-form" onSubmit={handleLogin}>
                    {errorMsg && (
                        <div style={{ color: "#E81123", fontSize: 13, textAlign: "center", background: "rgba(232,17,35,0.1)", padding: "8px", borderRadius: "8px" }}>
                            {errorMsg}
                        </div>
                    )}

                    <div className="input-group">
                        <label htmlFor="serverUrl">NAS Hub / Server URL</label>
                        <div style={{ position: "relative" }}>
                            <Server size={18} style={{ position: "absolute", left: 14, top: 12, color: "#8E8E93" }} />
                            <input
                                id="serverUrl"
                                type="url"
                                className="modern-input"
                                style={{ paddingLeft: 40 }}
                                placeholder="e.g. http://127.0.0.1:8080"
                                value={serverUrl}
                                onChange={(e) => setServerUrl(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label htmlFor="username">Username</label>
                        <div style={{ position: "relative" }}>
                            <User size={18} style={{ position: "absolute", left: 14, top: 12, color: "#8E8E93" }} />
                            <input
                                id="username"
                                type="text"
                                className="modern-input"
                                style={{ paddingLeft: 40 }}
                                placeholder="Enter your username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label htmlFor="password">Master Password</label>
                        <div style={{ position: "relative" }}>
                            <Lock size={18} style={{ position: "absolute", left: 14, top: 12, color: "#8E8E93" }} />
                            <input
                                id="password"
                                type="password"
                                className="modern-input"
                                style={{ paddingLeft: 40 }}
                                placeholder="Used to derive Master Key (MK)"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="auth-footer">
                        <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={loading}>
                            {loading ? "Authenticating..." : "Connect to Device"}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
}
