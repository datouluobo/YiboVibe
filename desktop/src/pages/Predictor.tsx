import { useTranslation } from "react-i18next";

export default function Predictor() {
    const { t } = useTranslation();
    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>{t('nav.predictor')}</h1>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px' }}>AI-driven predictive ghost text completions based on local models.</p>

            <div className="glass-panel" style={{ padding: '40px', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
                <div style={{ padding: '8px 16px', background: 'var(--color-primary-glow)', color: 'var(--color-primary)', display: 'inline-block', borderRadius: '100px', fontWeight: 500, fontSize: '13px', marginBottom: '16px' }}>
                    Coming Soon (Phase V)
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 12px 0' }}>Ghost Predictor Model</h3>
                <p style={{ color: 'var(--color-text-muted)', maxWidth: '400px', margin: '0 auto' }}>This module will connect to local LLMs deployed on your NAS to provide intelligent text continuation.</p>
            </div>
        </div>
    );
}
