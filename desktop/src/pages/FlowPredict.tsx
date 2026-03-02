import { useTranslation } from "react-i18next";
import { BrainCircuit, Keyboard, Sparkles } from "lucide-react";

export default function FlowPredict() {
    const { t } = useTranslation();

    return (
        <div style={{ maxWidth: '860px' }}>
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <BrainCircuit size={22} color="var(--color-primary)" />
                    {t('flowpredict.title')}
                </h1>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '13px', marginTop: '6px' }}>
                    {t('flowpredict.subtitle')}
                </p>
            </div>

            <div className="glass-panel" style={{
                padding: '48px 32px', borderRadius: 'var(--radius-lg)',
                textAlign: 'center', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '20px'
            }}>
                <div style={{
                    width: '72px', height: '72px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(168,85,247,0.05))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <Sparkles size={32} color="#a855f7" strokeWidth={1.5} />
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                    {t('flowpredict.wip_message')}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', width: '100%', maxWidth: '500px', marginTop: '12px' }}>
                    <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '6px' }}>
                            <Keyboard size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                            {t('flowpredict.hotkey_label')}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace', color: '#a855f7' }}>
                            Ctrl + Shift + P
                        </div>
                    </div>
                    <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '6px' }}>AI Provider</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                            未配置
                        </div>
                    </div>
                </div>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px',
                    fontSize: '12px', color: 'var(--color-text-dim)', flexWrap: 'wrap', justifyContent: 'center'
                }}>
                    <span style={{ padding: '4px 10px', background: 'var(--color-glass-bg)', borderRadius: '6px' }}>用户打字</span>
                    <span>→</span>
                    <span style={{ padding: '4px 10px', background: 'var(--color-glass-bg)', borderRadius: '6px' }}>上下文分析</span>
                    <span>→</span>
                    <span style={{ padding: '4px 10px', background: 'var(--color-glass-bg)', borderRadius: '6px' }}>AI 预测</span>
                    <span>→</span>
                    <span style={{ padding: '4px 10px', background: 'rgba(168,85,247,0.15)', borderRadius: '6px', color: '#a855f7' }}>候选上屏</span>
                </div>
            </div>
        </div>
    );
}
