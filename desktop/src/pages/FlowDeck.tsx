import { useTranslation } from "react-i18next";
import { LayoutDashboard, Cpu, Globe, Monitor, BrainCircuit, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

function StatusBadge({ status, label }: { status: 'ok' | 'warn' | 'error'; label: string }) {
    const colors = {
        ok: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', icon: <CheckCircle size={13} /> },
        warn: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', icon: <AlertTriangle size={13} /> },
        error: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', icon: <XCircle size={13} /> },
    };
    const c = colors[status];
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px',
            background: c.bg, borderRadius: '6px', fontSize: '12px', color: c.color, fontWeight: 500
        }}>
            {c.icon}{label}
        </div>
    );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="glass-panel" style={{ padding: '18px', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-dim)' }}>
                {icon}{title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {children}
            </div>
        </div>
    );
}

export default function FlowDeck() {
    const { t } = useTranslation();

    return (
        <div style={{ maxWidth: '920px' }}>
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <LayoutDashboard size={22} color="var(--color-primary)" />
                    {t('flowdeck.title')}
                </h1>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '13px', marginTop: '6px' }}>
                    {t('flowdeck.subtitle')}
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {/* Engine Core */}
                <SectionCard title={t('flowdeck.section_engine')} icon={<Cpu size={15} />}>
                    <StatusBadge status="ok" label={t('flowdeck.core_running')} />
                    <StatusBadge status="ok" label={t('flowdeck.e2ee_ready')} />
                    <StatusBadge status="ok" label={t('flowdeck.hook_active')} />
                </SectionCard>

                {/* Sync Network */}
                <SectionCard title={t('flowdeck.section_network')} icon={<Globe size={15} />}>
                    <StatusBadge status="ok" label={t('flowdeck.nas_connected')} />
                    <StatusBadge status="ok" label={t('flowdeck.ws_active')} />
                    <StatusBadge status="ok" label={t('flowdeck.protocol_secure')} />
                </SectionCard>

                {/* Online Devices */}
                <SectionCard title={t('flowdeck.section_devices')} icon={<Monitor size={15} />}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
                        <div style={{
                            width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e',
                            boxShadow: '0 0 6px rgba(34,197,94,0.5)'
                        }} />
                        <div>
                            <div style={{ fontSize: '13px', fontWeight: 500 }}>本机 (Windows)</div>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-dim)' }}>引擎主控端 · 在线</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
                        <div style={{
                            width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-text-dim)',
                            opacity: 0.4
                        }} />
                        <div>
                            <div style={{ fontSize: '13px', fontWeight: 500, opacity: 0.6 }}>移动设备</div>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-dim)' }}>待连接</div>
                        </div>
                    </div>
                </SectionCard>

                {/* AI Engine */}
                <SectionCard title={t('flowdeck.section_ai')} icon={<BrainCircuit size={15} />}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                        <div style={{ fontSize: '12.5px' }}>☁️ DeepSeek</div>
                        <StatusBadge status="warn" label="未配置" />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                        <div style={{ fontSize: '12.5px' }}>🏠 本机 Ollama</div>
                        <StatusBadge status="error" label={t('flowdeck.ai_not_detected')} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                        <div style={{ fontSize: '12.5px' }}>🏢 NAS 自建</div>
                        <StatusBadge status="error" label={t('flowdeck.ai_offline')} />
                    </div>
                    <div style={{
                        marginTop: '6px', padding: '8px 10px', fontSize: '11px',
                        background: 'var(--color-glass-bg)', borderRadius: '6px', color: 'var(--color-text-dim)'
                    }}>
                        {t('flowdeck.ai_active_label')}：—（请在偏好中配置 AI 引擎）
                    </div>
                </SectionCard>
            </div>
        </div>
    );
}
