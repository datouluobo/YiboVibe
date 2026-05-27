import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    LayoutDashboard, Flame, ShieldCheck, Settings, LogOut, BookOpen, Keyboard, Shield, Database,
    ArrowRightLeft, Monitor, Sparkles, Bot
} from "lucide-react";

interface NavItem {
    id: string;
    path: string;
    icon: any;
    labelKey: string;
    tooltipKey: string;
    disabled?: boolean;
    group?: string;
}

const BASE_NAV: NavItem[] = [
    // Group 1: Vibe Coding Console
    { id: "console", path: "/app/console", icon: Monitor, labelKey: "nav.console", tooltipKey: "nav.tooltip_console" },
    { id: "agents", path: "/app/agents", icon: Bot, labelKey: "nav.agents", tooltipKey: "nav.tooltip_agents" },

    // Group 2: Dashboard
    { id: "flowdeck", path: "/app/flowdeck", icon: LayoutDashboard, labelKey: "nav.flowdeck", tooltipKey: "nav.tooltip_flowdeck" },
    { id: "flowmind", path: "/app/flowmind", icon: Sparkles, labelKey: "nav.flowmind", tooltipKey: "nav.tooltip_flowmind" },

    // Group 3: Capability Layer
    { id: "flowprobe-sources", path: "/app/flowprobe-sources", icon: Database, labelKey: "nav.flowprobe_sources", tooltipKey: "nav.tooltip_flowprobe_sources" },
    { id: "flowprobe-relay", path: "/app/flowprobe-relay", icon: ArrowRightLeft, labelKey: "nav.flowprobe_relay", tooltipKey: "nav.tooltip_flowprobe_relay" },
    { id: "flowsync", path: "/app/flowsync", icon: Flame, labelKey: "nav.flowsync", tooltipKey: "nav.tooltip_flowsync" },
    { id: "flowkeys", path: "/app/flowkeys", icon: Keyboard, labelKey: "nav.flowkeys", tooltipKey: "nav.tooltip_flowkeys" },
    { id: "flowrules", path: "/app/flowrules", icon: ShieldCheck, labelKey: "nav.flowrules", tooltipKey: "nav.tooltip_flowrules" },

    // Group 4: System
    { id: "settings", path: "/app/settings", icon: Settings, labelKey: "nav.settings", tooltipKey: "nav.tooltip_settings" },
];

const ADMIN_ITEM: NavItem = {
    id: "admin", path: "/app/admin", icon: Shield, labelKey: "nav.admin", tooltipKey: "nav.tooltip_admin"
};

const FLOWINFO_ITEM: NavItem = {
    id: "flowinfo", path: "/app/flowinfo", icon: BookOpen, labelKey: "nav.flowinfo", tooltipKey: "nav.tooltip_flowinfo"
};

export default function Layout() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [userRole, setUserRole] = useState(() => localStorage.getItem('yibovibe_user_role') || 'user');
    const isAdmin = userRole === 'admin';

    useEffect(() => {
        let mounted = true;

        const syncRole = async () => {
            try {
                const role = await invoke<string>("get_user_role");
                if (!mounted) return;
                const normalizedRole = role || "user";
                setUserRole(normalizedRole);
                localStorage.setItem('yibovibe_user_role', normalizedRole);
            } catch {
                if (!mounted) return;
                const fallbackRole = localStorage.getItem('yibovibe_user_role') || 'user';
                setUserRole(fallbackRole);
            }
        };

        syncRole();
        return () => {
            mounted = false;
        };
    }, []);

    const navItems = useMemo(() => {
        if (!isAdmin) return [...BASE_NAV, FLOWINFO_ITEM];
        return [...BASE_NAV, ADMIN_ITEM, FLOWINFO_ITEM];
    }, [isAdmin]);

    const handleLogout = useCallback(async () => {
        try {
            await invoke("logout_engine");
        } catch {
            // Keep client logout resilient even if native state reset fails.
        }

        localStorage.removeItem('yibovibe_server_url');
        localStorage.removeItem('yibovibe_username');
        localStorage.removeItem('yibovibe_connected_at');
        localStorage.removeItem('yibovibe_auto_login');
        localStorage.removeItem('yibovibe_user_role');
        setUserRole('user');
        navigate("/");
    }, [navigate]);

    return (
        <div className="layout-container" style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            <aside className="glass-panel sidebar" style={{
                display: 'flex', flexDirection: 'column', padding: '20px 0',
                borderRight: '1px solid var(--color-glass-border)',
                background: 'var(--color-surface-elevated)',
                minWidth: '220px', maxWidth: '220px'
            }}>
                {/* Logo */}
                <div style={{
                    padding: '0 20px', marginBottom: '20px', fontWeight: 700, fontSize: '17px',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    letterSpacing: '0.5px'
                }}>
                    <LayoutDashboard size={20} color="var(--color-primary)" />
                    YiboVibe
                </div>

                {/* Nav Items */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 12px', overflowY: 'auto' }}>
                    {navItems.map((item, idx) => {
                        const isActive = location.pathname === item.path;
                        // groupDividers 基于 BASE_NAV 末尾索引
                        const groupDividers = [2, 9]; // before these indices
                        const showDivider = groupDividers.includes(idx);
                        return (
                            <div key={item.id}>
                                {showDivider && <div style={{ height: '1px', background: 'var(--color-border)', margin: '8px 14px', opacity: 0.5 }} />}
                                <div
                                    title={t(item.tooltipKey)}
                                    style={{
                                        padding: '8px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: item.disabled ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '11px',
                                        fontSize: '13.5px',
                                        opacity: item.disabled ? 0.45 : 1,
                                        background: isActive ? 'var(--color-primary-glow)' : 'transparent',
                                        color: isActive ? 'var(--color-primary)' : 'var(--color-text-main)',
                                        transition: 'background 0.2s, color 0.15s',
                                    }}
                                    onClick={() => {
                                        if (!item.disabled) navigate(item.path);
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!item.disabled && !isActive) {
                                            e.currentTarget.style.background = 'var(--color-glass-bg)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!item.disabled && !isActive) {
                                            e.currentTarget.style.background = 'transparent';
                                        }
                                    }}
                                >
                                    <item.icon size={17} />
                                    <span style={{ flex: 1 }}>{t(item.labelKey)}</span>
                                    {item.disabled && (
                                        <span style={{
                                            fontSize: '9px', fontWeight: 600,
                                            background: 'var(--color-border)',
                                            padding: '2px 6px', borderRadius: '4px',
                                            letterSpacing: '0.5px', textTransform: 'uppercase'
                                        }}>
                                            WIP
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Logout */}
                <div style={{ padding: '0 12px', marginTop: '10px' }}>
                    <button
                        className="btn-ghost"
                        onClick={handleLogout}
                        style={{
                            width: '100%', display: 'flex', justifyContent: 'flex-start',
                            padding: '9px 14px', color: '#ff4d4f', fontSize: '13.5px',
                            gap: '11px', alignItems: 'center'
                        }}
                    >
                        <LogOut size={17} />
                        {t('dashboard.logout')}
                    </button>
                </div>
            </aside>
            <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Outlet />
            </main>
        </div>
    );
}
