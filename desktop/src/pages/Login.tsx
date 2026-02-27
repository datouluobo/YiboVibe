import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, User } from "lucide-react";
import { motion } from "framer-motion";

export default function Login() {
    const navigate = useNavigate();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        // Mock login delay
        await new Promise((res) => setTimeout(res, 800));
        setLoading(false);

        // Navigate to Dashboard
        navigate("/dashboard");
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
