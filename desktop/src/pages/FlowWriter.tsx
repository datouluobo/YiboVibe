import { useTranslation } from "react-i18next";
import { PenTool, Wand2, Keyboard } from "lucide-react";

export default function FlowWriter() {
    const { t } = useTranslation();

    return (
        <div style={{ maxWidth: '860px' }}>
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <PenTool size={22} color="var(--color-primary)" />
                    {t('flowwriter.title')}
                </h1>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '13px', marginTop: '6px' }}>
                    {t('flowwriter.subtitle')}
                </p>
            </div>

            {/* WIP Hero */}
            <div className="glass-panel" style={{
                padding: '48px 32px', borderRadius: 'var(--radius-lg)',
                textAlign: 'center', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '20px'
            }}>
                <div style={{
                    width: '72px', height: '72px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, rgba(var(--color-primary-rgb, 99,102,241), 0.15), rgba(var(--color-primary-rgb, 99,102,241), 0.05))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <Wand2 size={32} color="var(--color-primary)" strokeWidth={1.5} />
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                    {t('flowwriter.wip_message')}
                </div>

                {/* Preview of planned features */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', width: '100%', maxWidth: '500px', marginTop: '12px' }}>
                    <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '6px' }}>
                            <Keyboard size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                            {t('flowwriter.hotkey_label')}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace', color: 'var(--color-primary)' }}>
                            Ctrl + Shift + R
                        </div>
                    </div>
                    <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '6px' }}>AI Provider</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                            未配置
                        </div>
                    </div>
                </div>

                {/* Flow diagram */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px',
                    fontSize: '12px', color: 'var(--color-text-dim)', flexWrap: 'wrap', justifyContent: 'center'
                }}>
                    <span style={{ padding: '4px 10px', background: 'var(--color-glass-bg)', borderRadius: '6px' }}>选中文本</span>
                    <span>→</span>
                    <span style={{ padding: '4px 10px', background: 'var(--color-glass-bg)', borderRadius: '6px' }}>快捷键触发</span>
                    <span>→</span>
                    <span style={{ padding: '4px 10px', background: 'var(--color-glass-bg)', borderRadius: '6px' }}>AI 润色</span>
                    <span>→</span>
                    <span style={{ padding: '4px 10px', background: 'rgba(34,139,230,0.15)', borderRadius: '6px', color: '#228be6' }}>写回原位</span>
                </div>
            </div>
        </div>
    );
}
