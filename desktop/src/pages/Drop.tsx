import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { UploadCloud, Smartphone, Laptop2, FileUp, MonitorUp } from "lucide-react";
import { useState } from "react";

export default function Drop() {
    const { t } = useTranslation();
    const [isTransferring, setIsTransferring] = useState(false);

    const handleSendFile = async (deviceId: number) => {
        try {
            const selected = await open({
                multiple: false,
                title: "Select File to Send"
            });

            if (selected) {
                setIsTransferring(true);
                await invoke("send_file_p2p", {
                    filePath: selected as string,
                    targetDevice: deviceId
                });
                alert("File transfer initiated!");
            }
        } catch (err) {
            console.error("File transfer error", err);
            alert("Transfer failed: " + err);
        } finally {
            setIsTransferring(false);
        }
    };

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>{t('nav.drop')}</h1>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px' }}>P2P ultra-fast cross-device file transfer console.</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <MonitorUp size={20} color="var(--color-primary)" /> {t('sync.online_devices_title')}
                        </h3>
                        <span style={{ fontSize: '12px', background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', padding: '4px 8px', borderRadius: '100px', fontWeight: 600 }}>
                            {t('sync.active_devices_count', { count: 3 })}
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* Device 1 - Local */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--color-surface-elevated)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                            <div style={{ padding: '12px', background: 'var(--color-primary-glow)', color: 'var(--color-primary)', borderRadius: '10px' }}>
                                <Laptop2 size={24} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <h4 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>{t('sync.this_desktop_title')}</h4>
                                <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>{t('sync.this_desktop_desc')}</p>
                            </div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e' }}>{t('sync.status_online')}</div>
                        </div>

                        {/* Device 2 - Mobile */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--color-surface-elevated)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-glass-border)' }}>
                            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-main)', borderRadius: '10px' }}>
                                <Smartphone size={24} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <h4 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>{t('sync.my_iphone_title')}</h4>
                                <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>{t('sync.my_iphone_desc')}</p>
                            </div>
                            <button
                                onClick={() => handleSendFile(0)}
                                className="btn-primary"
                                disabled={isTransferring}
                                style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                                <FileUp size={16} /> {t('sync.send_file_btn')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <UploadCloud size={20} color="var(--color-primary)" /> Transfer Console
                    </h3>

                    <div style={{
                        border: '2px dashed var(--color-primary)',
                        background: 'var(--color-primary-glow)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        minHeight: '260px',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--color-text-muted)',
                        gap: '16px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 255, 170, 0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-primary-glow)'}
                        onClick={() => handleSendFile(0)}
                    >
                        <UploadCloud size={48} color="var(--color-primary)" style={{ opacity: 0.8 }} />
                        <div style={{ textAlign: 'center' }}>
                            <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: 'var(--color-text-main)', fontSize: '16px' }}>
                                Click to Browse
                            </p>
                            <p style={{ margin: 0, fontSize: '13px' }}>or drag & drop files here to beam</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
