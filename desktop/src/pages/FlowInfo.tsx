import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { BookOpen, ExternalLink, Heart, Code2, Shield, Zap } from "lucide-react";

export default function FlowInfo() {
    const { t } = useTranslation();
    const [appVersion, setAppVersion] = useState("");

    useEffect(() => {
        import("@tauri-apps/api/app").then(({ getVersion }) => {
            getVersion().then(setAppVersion);
        });
    }, []);

    return (
        <div style={{ width: '100%', paddingBottom: '40px' }}>
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <BookOpen size={22} color="var(--color-primary)" />
                    {t('flowinfo.title')}
                </h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '6px' }}>
                    {t('flowinfo.subtitle')}
                </p>
            </div>

            {/* Hero Card */}
            <div className="glass-panel" style={{
                padding: '32px',
                borderRadius: 'var(--radius-lg)',
                textAlign: 'center',
                marginBottom: '24px',
                position: 'relative',
                overflow: 'hidden'
            }}>
                <div style={{
                    width: '64px', height: '64px', borderRadius: '16px',
                    background: 'var(--color-primary-glow)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 16px',
                    border: '1px solid var(--color-primary)',
                }}>
                    <Zap size={32} color="var(--color-primary)" />
                </div>
                <h2 style={{ margin: '0 0 4px', fontSize: '24px', fontWeight: 700, letterSpacing: '0.5px' }}>
                    YiboVibe
                </h2>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: '0 0 16px' }}>
                    {t('flowinfo.hero_desc')}
                </p>
                {appVersion && (
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '4px 14px', borderRadius: '100px',
                        background: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-glass-border)',
                        color: 'var(--color-text-dim)',
                        fontSize: '12px', fontWeight: 600, letterSpacing: '0.5px'
                    }}>
                        v{appVersion}
                    </div>
                )}
            </div>

            {/* Feature Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                marginBottom: '24px'
            }}>
                {[
                    { icon: Shield, label: t('flowinfo.feat_e2ee'), color: '#22c55e' },
                    { icon: Zap, label: t('flowinfo.feat_speed'), color: '#f59e0b' },
                    { icon: Code2, label: t('flowinfo.feat_p2p'), color: 'var(--color-primary)' },
                ].map((feat, i) => (
                    <div key={i} className="glass-panel" style={{
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex', alignItems: 'center', gap: '12px'
                    }}>
                        <div style={{
                            padding: '8px', borderRadius: '8px',
                            background: `${feat.color}15`, color: feat.color
                        }}>
                            <feat.icon size={18} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>{feat.label}</span>
                    </div>
                ))}
            </div>

            {/* Tech Stack */}
            <div className="glass-panel" style={{ padding: '20px 24px', borderRadius: 'var(--radius-lg)', marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Code2 size={16} color="var(--color-primary)" />
                    {t('flowinfo.tech_title')}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {['Rust', 'Tauri v2', 'TypeScript', 'React', 'Go', 'WebSocket', 'AES-256-GCM', 'Argon2id'].map(tech => (
                        <span key={tech} style={{
                            padding: '4px 12px', borderRadius: '100px', fontSize: '12px', fontWeight: 500,
                            background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)',
                            color: 'var(--color-text-muted)'
                        }}>
                            {tech}
                        </span>
                    ))}
                </div>
            </div>

            {/* Links */}
            <div className="glass-panel" style={{ padding: '20px 24px', borderRadius: 'var(--radius-lg)', marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ExternalLink size={16} color="var(--color-primary)" />
                    {t('flowinfo.links_title')}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                        { label: 'GitHub', url: 'https://github.com/datouluobo/YiboVibe' },
                        { label: t('flowinfo.link_docs'), url: '#' },
                        { label: t('flowinfo.link_feedback'), url: '#' },
                    ].map((link, i) => (
                        <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 12px', borderRadius: 'var(--radius-md)',
                            color: 'var(--color-text-main)', textDecoration: 'none', fontSize: '13px',
                            transition: 'background 0.2s'
                        }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-elevated)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <ExternalLink size={14} color="var(--color-text-muted)" />
                            {link.label}
                        </a>
                    ))}
                </div>
            </div>

            {/* Footer */}
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    color: 'var(--color-text-dim)', fontSize: '12px', margin: 0
                }}>
                    {t('flowinfo.made_with')} <Heart size={12} color="#ef4444" fill="#ef4444" /> YiboVibe Team
                </p>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '11px', marginTop: '6px', opacity: 0.6 }}>
                    &copy; {new Date().getFullYear()} YiboVibe. {t('flowinfo.copyright')}
                </p>
            </div>
        </div>
    );
}
