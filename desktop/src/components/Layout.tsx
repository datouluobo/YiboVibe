import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    LayoutDashboard, Sparkles,
    Flame, Activity, ShieldCheck, Settings, LogOut, BookOpen, Keyboard, Shield
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

const NAV_ITEMS: NavItem[] = [
    // Group 1: Dashboard
    { id: "flowdeck", path: "/app/flowdeck", icon: LayoutDashboard, labelKey: "nav.flowdeck", tooltipKey: "nav.tooltip_flowdeck" },

    // Group 2: Core Features
    { id: "flowmind", path: "/app/flowmind", icon: Sparkles, labelKey: "nav.flowmind", tooltipKey: "nav.tooltip_flowmind" },
    { id: "flowsync", path: "/app/flowsync", icon: Flame, labelKey: "nav.flowsync", tooltipKey: "nav.tooltip_flowsync" },
    { id: "flowkeys", path: "/app/flowkeys", icon: Keyboard, labelKey: "nav.flowkeys", tooltipKey: "nav.tooltip_flowkeys" },

    // Group 3: Tools
    { id: "flowprobe", path: "/app/flowprobe", icon: Activity, labelKey: "nav.flowprobe", tooltipKey: "nav.tooltip_flowprobe" },

    // Group 4: System
    { id: "flowrules", path: "/app/flowrules", icon: ShieldCheck, labelKey: "nav.flowrules", tooltipKey: "nav.tooltip_flowrules" },
    { id: "settings", path: "/app/settings", icon: Settings, labelKey: "nav.settings", tooltipKey: "nav.tooltip_settings" },
];

const ADMIN_NAV_ITEM: NavItem = {
    id: "admin", path: "/app/admin", icon: Shield, labelKey: "nav.admin", tooltipKey: "nav.tooltip_admin"
};

const FLOWINFO_NAV_ITEM: NavItem = {
    id: "flowinfo", path: "/app/flowinfo", icon: BookOpen, labelKey: "nav.flowinfo", tooltipKey: "nav.tooltip_flowinfo"
};

export default function Layout() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [userRole, setUserRole] = useState(() => localStorage.getItem('yiboflow_user_role') || 'user');
    const isAdmin = userRole === 'admin';

    useEffect(() => {
        let mounted = true;

        const syncRole = async () => {
            try {
                const role = await invoke<string>("get_user_role");
                if (!mounted) return;
                const normalizedRole = role || "user";
                setUserRole(normalizedRole);
                localStorage.setItem('yiboflow_user_role', normalizedRole);
            } catch {
                if (!mounted) return;
                const fallbackRole = localStorage.getItem('yiboflow_user_role') || 'user';
                setUserRole(fallbackRole);
            }
        };

        syncRole();
        return () => {
            mounted = false;
        };
    }, []);

    const navItems = useMemo(() => {
        if (!isAdmin) return [...NAV_ITEMS, FLOWINFO_NAV_ITEM];
        return [...NAV_ITEMS, ADMIN_NAV_ITEM, FLOWINFO_NAV_ITEM];
    }, [isAdmin]);

    const handleLogout = useCallback(async () => {
        try {
            await invoke("logout_engine");
        } catch {
            // Keep client logout resilient even if native state reset fails.
        }

        localStorage.removeItem('yiboflow_server_url');
        localStorage.removeItem('yiboflow_username');
        localStorage.removeItem('yiboflow_connected_at');
        localStorage.removeItem('yiboflow_auto_login');
        localStorage.removeItem('yiboflow_user_role');
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
                    YiboFlow
                </div>

                {/* Nav Items */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 12px', overflowY: 'auto' }}>
                    {navItems.map((item, idx) => {
                        const isActive = location.pathname === item.path;
                        // Insert divider between groups
                        const groupDividers = [1, 4, 6]; // before these indices
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
