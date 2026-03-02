import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, Type, Zap, ClipboardCopy, Navigation, ShieldAlert, Cpu, Settings, LogOut } from "lucide-react";

export default function Layout() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        localStorage.removeItem('yiboflow_server_url');
        localStorage.removeItem('yiboflow_username');
        localStorage.removeItem('yiboflow_connected_at');
        navigate("/");
    };

    const navItems = [
        { id: "hub", path: "/app/hub", icon: Activity, label: t('nav.hub') },
        { id: "snippets", path: "/app/snippets", icon: Type, label: t('nav.snippets') },
        { id: "autofill", path: "/app/autofill", icon: Zap, label: t('nav.autofill') },
        { id: "cloudboard", path: "/app/cloudboard", icon: ClipboardCopy, label: t('nav.cloudboard') },
        { id: "drop", path: "/app/drop", icon: Navigation, label: t('nav.drop') },
        { id: "exemptions", path: "/app/exemptions", icon: ShieldAlert, label: t('nav.exemptions') },
        { id: "predictor", path: "/app/predictor", icon: Cpu, label: t('nav.predictor'), disabled: true },
        { id: "settings", path: "/app/settings", icon: Settings, label: t('nav.settings') }
    ];

    return (
        <div className="layout-container" style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            <aside className="glass-panel sidebar" style={{ display: 'flex', flexDirection: 'column', padding: '20px 0', borderRight: '1px solid var(--color-glass-border)', background: 'var(--color-surface-elevated)', borderTopLeftRadius: '0', borderBottomLeftRadius: '0', borderTopRightRadius: '0', borderBottomRightRadius: '0' }}>
                <div style={{ padding: '0 20px', marginBottom: '24px', fontWeight: 600, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={20} color="var(--color-primary)" />
                    YiboFlow
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 12px' }}>
                    {navItems.map((item) => (
                        <div
                            key={item.id}
                            style={{
                                padding: '10px 16px',
                                borderRadius: 'var(--radius-md)',
                                cursor: item.disabled ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                fontSize: '14px',
                                opacity: item.disabled ? 0.5 : 1,
                                background: location.pathname === item.path ? 'var(--color-primary-glow)' : 'transparent',
                                color: location.pathname === item.path ? 'var(--color-primary)' : 'var(--color-text-main)',
                                transition: 'background 0.2s',
                            }}
                            onClick={() => {
                                if (!item.disabled) {
                                    navigate(item.path);
                                }
                            }}
                            onMouseEnter={(e) => {
                                if (!item.disabled && location.pathname !== item.path) {
                                    e.currentTarget.style.background = 'var(--color-glass-bg)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!item.disabled && location.pathname !== item.path) {
                                    e.currentTarget.style.background = 'transparent';
                                }
                            }}
                        >
                            <item.icon size={18} />
                            {item.label}
                            {item.disabled && <span style={{ fontSize: '10px', background: 'var(--color-border)', padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto' }}>WIP</span>}
                        </div>
                    ))}
                </div>
                <div style={{ padding: '0 12px' }}>
                    <button
                        className="btn-ghost"
                        onClick={handleLogout}
                        style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', padding: '10px 16px', color: '#ff4d4f' }}
                    >
                        <LogOut size={18} style={{ marginRight: '8px' }} />
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
