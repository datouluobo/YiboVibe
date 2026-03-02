import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardCopy, ArrowDownToLine, ArrowUpToLine, History } from "lucide-react";

interface ClipboardLog {
    id: number;
    timestamp: Date;
    status: string;
    preview: string;
}

export default function Cloudboard() {
    const { t } = useTranslation();
    const [clipboardLogs, setClipboardLogs] = useState<ClipboardLog[]>([]);

    useEffect(() => {
        // Fallback for browser testing
        if (!(window as any).__TAURI_INTERNALS__) {
            console.log("Not in Tauri environment, skipping clipboard event listener.");
            return;
        }

        const unlistenPromise = listen<any>("clipboard-event", (event) => {
            setClipboardLogs(prev => {
                const newLog = {
                    id: Date.now() + Math.random(),
                    timestamp: new Date(),
                    status: event.payload.status,
                    preview: event.payload.preview
                };

                // Aggressive deduplication: ignore exact same text + status if received within the last 1500ms
                const isDuplicate = prev.some(log =>
                    log.status === newLog.status &&
                    log.preview === newLog.preview &&
                    (newLog.timestamp.getTime() - log.timestamp.getTime() < 1500)
                );
                if (isDuplicate) return prev;

                return [newLog, ...prev].slice(0, 20); // Keep last 20 logs
            });
        }).catch(err => {
            console.error("Failed to listen to clipboard events:", err);
            return () => { }; // Return dummy unlisten function to avoid crashing
        });

        return () => {
            unlistenPromise.then(unlistenFn => {
                if (typeof unlistenFn === 'function') {
                    unlistenFn();
                }
            });
        };
    }, []);

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>
                        {t('nav.cloudboard')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                        {t('sync.subtitle')}
                    </p>
                </div>

                <div style={{
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border)',
                    padding: '8px 16px',
                    borderRadius: '100px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--color-text-main)',
                    fontWeight: 600,
                    fontSize: '14px'
                }}>
                    <History size={18} color="var(--color-primary)" />
                    {t('sync.activity_stream_live')}
                </div>
            </div>

            <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ClipboardCopy size={18} color="var(--color-text-muted)" />
                        {t('sync.activity_stream_title')}
                    </h3>
                </div>

                <div style={{ minHeight: '300px' }}>
                    {clipboardLogs.length === 0 ? (
                        <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            <ClipboardCopy size={48} style={{ opacity: 0.15, marginBottom: '16px', margin: '0 auto', display: 'block' }} />
                            <p>{t('sync.no_activity_message')}</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', padding: '16px', gap: '8px' }}>
                            <AnimatePresence>
                                {clipboardLogs.map(log => (
                                    <motion.div
                                        key={log.id}
                                        initial={{ opacity: 0, scale: 0.98, y: -10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.98 }}
                                        transition={{ duration: 0.2 }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '16px',
                                            background: 'var(--color-surface-elevated)',
                                            padding: '16px',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-glass-border)'
                                        }}
                                    >
                                        <div style={{
                                            padding: '8px',
                                            borderRadius: '8px',
                                            background: log.status === 'sent' ? 'var(--color-primary-glow)' : 'rgba(34, 197, 94, 0.15)',
                                            color: log.status === 'sent' ? 'var(--color-primary)' : '#22c55e'
                                        }}>
                                            {log.status === 'sent' ? <ArrowUpToLine size={24} /> : <ArrowDownToLine size={24} />}
                                        </div>

                                        <div style={{ flex: 1, overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                <span style={{
                                                    fontWeight: 600,
                                                    fontSize: '13px',
                                                    color: log.status === 'sent' ? 'var(--color-primary)' : '#22c55e',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px'
                                                }}>
                                                    {log.status === 'sent' ? t('sync.status_sent') : t('sync.status_received')}
                                                </span>
                                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                                    {log.timestamp.toLocaleTimeString()}
                                                </span>
                                            </div>

                                            <div style={{
                                                background: 'var(--color-surface)',
                                                padding: '12px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--color-border)'
                                            }}>
                                                {log.preview.startsWith('data:image/') ? (
                                                    <img src={log.preview} alt="Clipboard Content" style={{ maxHeight: '120px', borderRadius: '4px', maxWidth: '100%', objectFit: 'contain' }} />
                                                ) : (
                                                    <span style={{
                                                        color: 'var(--color-text-main)',
                                                        fontFamily: '"Fira Code", monospace, Consolas',
                                                        fontSize: '13px',
                                                        whiteSpace: 'pre-wrap',
                                                        wordBreak: 'break-word'
                                                    }}>
                                                        {log.preview}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
