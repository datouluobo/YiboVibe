import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { UploadCloud, Smartphone, Laptop2, MonitorUp, Wifi, Zap, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";

export default function Drop() {
    const { t } = useTranslation();
    const [isTransferring, setIsTransferring] = useState(false);
    const [devices, setDevices] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDevices = async () => {
        const serverUrl = localStorage.getItem('yiboflow_server_url') || "";
        const username = localStorage.getItem('yiboflow_username') || "";
        const savedPwdB64 = localStorage.getItem('yiboflow_saved_pwd') || "";

        if (!serverUrl || serverUrl === 'local' || !username || !savedPwdB64) {
            setIsLoading(false);
            return;
        }

        try {
            const password = atob(savedPwdB64);
            const list: any = await invoke("get_cluster_devices", { serverUrl, username, password });
            setDevices(list);
        } catch (err) {
            console.error("Discovery error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        const timer = setInterval(fetchDevices, 10000); // Poll every 10s
        return () => clearInterval(timer);
    }, []);

    const handleSendFile = async (deviceName: string) => {
        try {
            const selected = await open({
                multiple: false,
                title: `Beam to ${deviceName}`
            });

            if (selected) {
                setIsTransferring(true);
                // In actual P2P implementation we use index or ID, targetDevice is dummy u32 in lib.rs for now.
                // We'll pass 0 as dummy to lib.rs since the real p2p uses the hub which routes by device name/sid anyway.
                // Wait, lib.rs sends target_device: u32. Let's send 0.
                await invoke("send_file_p2p", {
                    filePath: selected as string,
                    targetDevice: 0
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

    const onlineOtherDevices = devices.filter(d => !d.isLocal && d.isOnline);

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>{t('nav.drop')}</h1>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px' }}>P2P ultra-fast cross-device file transfer console.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) 340px', gap: '24px' }}>
                <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <MonitorUp size={20} color="var(--color-primary)" /> {t('sync.online_devices_title')}
                        </h3>
                        <span style={{ fontSize: '12px', background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', padding: '4px 10px', borderRadius: '100px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {isLoading ? <RefreshCw size={12} className="animate-spin" /> : <><Wifi size={12} /> {onlineOtherDevices.length} 个可见节点</>}
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {onlineOtherDevices.length === 0 ? (
                            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-dim)', background: 'var(--color-surface-elevated)', borderRadius: '12px', border: '1px solid var(--color-glass-border)' }}>
                                <Smartphone size={32} style={{ opacity: 0.2, marginBottom: '12px' }} />
                                <p style={{ margin: 0, fontSize: '14px' }}>暂未发现其他在线终端</p>
                                <p style={{ margin: '8px 0 0 0', fontSize: '12px', opacity: 0.6 }}>确保另一台电脑已登录且网络畅通</p>
                            </div>
                        ) : (
                            onlineOtherDevices.map(dev => (
                                <div key={dev.id} style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--color-surface-elevated)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-glass-border)', transition: 'all 0.2s' }}>
                                    <div style={{ 
                                        padding: '12px', 
                                        background: 'var(--color-primary-glow)', 
                                        color: 'var(--color-primary)', 
                                        borderRadius: '10px',
                                        boxShadow: '0 0 10px rgba(0, 255, 170, 0.1)'
                                    }}>
                                        {dev.deviceType === 'mobile' ? <Smartphone size={24} /> : <Laptop2 size={24} />}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', color: 'var(--color-text-main)', fontWeight: 600 }}>{dev.name}</h4>
                                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>P2P 端到端直连分发就绪</p>
                                    </div>
                                    <button
                                        onClick={() => handleSendFile(dev.name)}
                                        className="btn-primary"
                                        disabled={isTransferring}
                                        style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px' }}
                                    >
                                        <Zap size={15} fill="currentColor" /> {t('sync.send_file_btn')}
                                    </button>
                                </div>
                            ))
                        )}
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
                        onClick={() => handleSendFile("选定终端")}
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
