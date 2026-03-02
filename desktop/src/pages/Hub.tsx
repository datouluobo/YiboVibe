import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Server, User, Network, Activity, Zap, Shield, ShieldAlert } from "lucide-react";

export default function Hub() {
    const { t } = useTranslation();
    const [, setServerUrl] = useState("");
    const [username, setUsername] = useState("");
    const [connectedAt, setConnectedAt] = useState("");
    const [, setNetworkType] = useState("");
    const [networkLabel, setNetworkLabel] = useState("");
    const [protocol, setProtocol] = useState("");
    const [hostAndPort, setHostAndPort] = useState("");

    useEffect(() => {
        const url = localStorage.getItem('yiboflow_server_url') || "";
        const user = localStorage.getItem('yiboflow_username') || "";
        const time = localStorage.getItem('yiboflow_connected_at') || "";

        setServerUrl(url);
        setUsername(user);

        if (time) {
            try {
                const date = new Date(time);
                setConnectedAt(date.toLocaleTimeString());
            } catch {
                setConnectedAt(time);
            }
        }

        if (url) {
            try {
                const urlObj = new URL(url);
                setProtocol(urlObj.protocol);
                setHostAndPort(urlObj.host);

                if (urlObj.hostname === '127.0.0.1' || urlObj.hostname === 'localhost') {
                    setNetworkType('local');
                    setNetworkLabel(t('sync.network_local') || 'Local');
                } else if (urlObj.hostname.startsWith('192.168.') || urlObj.hostname.startsWith('10.') || urlObj.hostname.startsWith('172.')) {
                    setNetworkType('lan');
                    setNetworkLabel(t('sync.network_lan') || 'LAN');
                } else {
                    setNetworkType('wan');
                    setNetworkLabel(t('sync.network_wan') || 'WAN');
                }
            } catch { }
        }
    }, [t]);

    const isSecure = protocol === "https:";

    return (
        <div className="hub-page" style={{ maxWidth: '900px', margin: '0 auto', animation: 'fadeIn 0.4s ease-out' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>
                {t('dashboard.engine_connected')}
            </h1>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px' }}>
                All security protocols and E2EE agents are actively operating.
            </p>

            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', borderBottom: '1px solid var(--color-glass-border)', paddingBottom: '16px' }}>
                    <div style={{ padding: '10px', borderRadius: '50%', background: isSecure ? 'rgba(48, 209, 88, 0.15)' : 'rgba(255, 159, 10, 0.15)', color: isSecure ? '#30d158' : '#ff9f0a' }}>
                        {isSecure ? <Shield size={24} /> : <ShieldAlert size={24} />}
                    </div>
                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>
                            Core Network Link
                        </h3>
                        <p style={{ fontSize: '13px', color: isSecure ? '#30d158' : '#ff9f0a', margin: '4px 0 0 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isSecure ? t('dashboard.proto_https') : t('dashboard.proto_http')}
                        </p>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: 'var(--color-primary-glow)', color: 'var(--color-primary)', borderRadius: '100px', fontSize: '13px', fontWeight: 500 }}>
                        <Activity size={14} />
                        Active
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ color: 'var(--color-text-muted)' }}><Server size={20} /></div>
                        <div>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Access Endpoint</div>
                            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--color-text-main)', marginTop: '2px' }}>{hostAndPort || 'Unknown'}</div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ color: 'var(--color-text-muted)' }}><Network size={20} /></div>
                        <div>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Network Mode</div>
                            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--color-text-main)', marginTop: '2px' }}>{networkLabel}</div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ color: 'var(--color-text-muted)' }}><User size={20} /></div>
                        <div>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Identity</div>
                            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--color-text-main)', marginTop: '2px' }}>{username || 'Anonymous'}</div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ color: 'var(--color-text-muted)' }}><Zap size={20} /></div>
                        <div>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Session Started</div>
                            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--color-text-main)', marginTop: '2px' }}>{connectedAt}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: '32px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '16px' }}>Dashboard Overview modules will be placed here...</h2>
            </div>
        </div>
    );
}
