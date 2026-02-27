import { useNavigate } from "react-router-dom";
import { Copy, Keyboard, Settings, LogOut, CheckCircle2, Laptop2, Smartphone, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import "./Dashboard.css";

export default function Dashboard() {
    const navigate = useNavigate();

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
                    <li className="active">
                        <Copy size={18} /> Sync Devices
                    </li>
                    <li>
                        <Keyboard size={18} /> Snippets
                    </li>
                    <li>
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

                <div className="glass-panel device-list">
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

                    <div className="device-item">
                        <div className="device-icon pc">
                            <Laptop2 size={24} />
                        </div>
                        <div className="device-info">
                            <h4>MacBook M2</h4>
                            <p>macOS Desktop</p>
                        </div>
                        <div className="device-status">Syncing...</div>
                    </div>
                </div>
            </main>
        </div>
    );
}
