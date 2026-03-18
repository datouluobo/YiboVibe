import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
    LayoutDashboard, Sparkles, PenTool, BrainCircuit,
    Flame, Truck, ShieldCheck, Settings, LogOut
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

export default function Layout() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        localStorage.removeItem('yiboflow_server_url');
        localStorage.removeItem('yiboflow_username');
        localStorage.removeItem('yiboflow_connected_at');
        localStorage.removeItem('yiboflow_auto_login'); // Disable auto-login on explicit logout
        navigate("/");
    };

    const navGroups: { id: string; items: NavItem[] }[] = [
        {
            id: "overview",
            items: [
                { id: "flowdeck", path: "/app/flowdeck", icon: LayoutDashboard, labelKey: "nav.flowdeck", tooltipKey: "nav.tooltip_flowdeck" },
            ]
        },
        {
            id: "input",
            items: [
                { id: "flowmind", path: "/app/flowmind", icon: Sparkles, labelKey: "nav.flowmind", tooltipKey: "nav.tooltip_flowmind" },
                { id: "flowwriter", path: "/app/flowwriter", icon: PenTool, labelKey: "nav.flowwriter", tooltipKey: "nav.tooltip_flowwriter" },
                { id: "flowpredict", path: "/app/flowpredict", icon: BrainCircuit, labelKey: "nav.flowpredict", tooltipKey: "nav.tooltip_flowpredict", disabled: true },
            ]
        },
        {
            id: "transfer",
            items: [
                { id: "flowsync", path: "/app/flowsync", icon: Flame, labelKey: "nav.flowsync", tooltipKey: "nav.tooltip_flowsync" },
                { id: "flowdrop", path: "/app/flowdrop", icon: Truck, labelKey: "nav.flowdrop", tooltipKey: "nav.tooltip_flowdrop" },
            ]
        },
        {
            id: "system",
            items: [
                { id: "flowrules", path: "/app/flowrules", icon: ShieldCheck, labelKey: "nav.flowrules", tooltipKey: "nav.tooltip_flowrules" },
                { id: "settings", path: "/app/settings", icon: Settings, labelKey: "nav.settings", tooltipKey: "nav.tooltip_settings" },
            ]
        }
    ];

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

                {/* Nav Groups */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0', padding: '0 12px', overflowY: 'auto' }}>
                    {navGroups.map((group, groupIdx) => (
                        <div key={group.id}>
                            {groupIdx > 0 && (
                                <div style={{
                                    height: '1px',
                                    background: 'var(--color-glass-border)',
                                    margin: '8px 8px',
                                    opacity: 0.6
                                }} />
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {group.items.map((item) => {
                                    const isActive = location.pathname === item.path;
                                    return (
                                        <div
                                            key={item.id}
                                            title={t(item.tooltipKey)}
                                            style={{
                                                padding: '9px 14px',
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
                                                position: 'relative',
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
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Logout */}
                <div style={{ padding: '0 12px', marginTop: '8px' }}>
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
            <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
                <Outlet />
            </main>
        </div>
    );
}
