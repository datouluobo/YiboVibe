import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
    ClipboardCopy, ArrowDownToLine, ArrowUpToLine,
    Copy, Trash2, Check, ChevronDown, Settings2, ImageIcon, FileType
} from "lucide-react";

interface ClipboardLog {
    id: number;
    timestamp: Date;
    status: 'sent' | 'received';
    type: 'text' | 'image';
    preview: string;
    imageWidth?: number;
    imageHeight?: number;
}

type TimeFilter = 'all' | 'today' | 'yesterday' | 'week' | 'month';
type TypeFilter = 'all' | 'text' | 'image';
type DirFilter = 'all' | 'sent' | 'received';

const STORAGE_KEY = 'yiboflow_sync_logs';
const CLEANUP_KEY = 'yiboflow_sync_auto_cleanup_days';
const MAX_RECORDS = 50;

function loadLogs(): ClipboardLog[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return parsed.map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) }));
    } catch { return []; }
}

function saveLogs(logs: ClipboardLog[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_RECORDS)));
    } catch { /* storage full, ignore */ }
}

function getDayStart(d: Date): Date {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '3px 10px',
                borderRadius: '100px',
                fontSize: '11.5px',
                fontWeight: active ? 600 : 400,
                background: active ? 'var(--color-primary)' : 'transparent',
                color: active ? '#fff' : 'var(--color-text-muted)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
            }}
        >
            {label}
        </button>
    );
}

function FilterGroup({ title, options, value, onChange }: {
    title: string;
    options: { key: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginRight: '2px', whiteSpace: 'nowrap' }}>{title}</span>
            {options.map(o => (
                <FilterChip key={o.key} label={o.label} active={value === o.key} onClick={() => onChange(o.key)} />
            ))}
        </div>
    );
}

export default function FlowSync() {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<ClipboardLog[]>(loadLogs);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [filterTime, setFilterTime] = useState<TimeFilter>('all');
    const [filterType, setFilterType] = useState<TypeFilter>('all');
    const [filterDir, setFilterDir] = useState<DirFilter>('all');
    const [showClearMenu, setShowClearMenu] = useState(false);
    const [showCleanupPicker, setShowCleanupPicker] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [copiedPreview, setCopiedPreview] = useState(false);
    const clearMenuRef = useRef<HTMLDivElement>(null);
    const cleanupRef = useRef<HTMLDivElement>(null);
    const lastPolledRef = useRef<string>('');

    const autoCleanupDays = parseInt(localStorage.getItem(CLEANUP_KEY) || '7');
    const [cleanupDays, setCleanupDays] = useState(autoCleanupDays);

    const selectedLog = logs.find(l => l.id === selectedId) || null;

    // Persist logs on change
    useEffect(() => { saveLogs(logs); }, [logs]);

    // Auto cleanup on mount
    useEffect(() => {
        if (cleanupDays > 0) {
            const cutoff = Date.now() - cleanupDays * 86400000;
            setLogs(prev => prev.filter(l => l.timestamp.getTime() > cutoff));
        }
    }, []);

    // Listen to clipboard events
    useEffect(() => {
        if (!(window as any).__TAURI_INTERNALS__) return;

        const unlistenPromise = listen<any>("clipboard-event", (event) => {
            const isImage = event.payload.preview?.startsWith('data:image/');
            const newLog: ClipboardLog = {
                id: Date.now() + Math.random(),
                timestamp: new Date(),
                status: event.payload.status,
                type: isImage ? 'image' : 'text',
                preview: event.payload.preview,
            };

            setLogs(prev => {
                const existingIdx = prev.findIndex(log => log.preview === newLog.preview);
                if (existingIdx !== -1) {
                    const updated = [...prev];
                    updated.splice(existingIdx, 1);
                    return [{ ...prev[existingIdx], timestamp: newLog.timestamp, status: newLog.status }, ...updated];
                }
                return [newLog, ...prev].slice(0, MAX_RECORDS);
            });
        }).catch(() => () => {});

        // Polling fallback
        const poll = setInterval(async () => {
            try {
                const result: any = await invoke("read_clipboard_content");
                if (result.type === 'empty') return;
                const content = result.content as string;
                if (!content || content === lastPolledRef.current) return;
                lastPolledRef.current = content;

                const isImage = result.type === 'image';
                const newLog: ClipboardLog = {
                    id: Date.now() + Math.random(),
                    timestamp: new Date(),
                    status: 'sent',
                    type: isImage ? 'image' : 'text',
                    preview: content,
                    imageWidth: result.width,
                    imageHeight: result.height,
                };

                setLogs(prev => {
                    const existingIdx = prev.findIndex(log => log.preview === content);
                    if (existingIdx !== -1) {
                        const updated = [...prev];
                        updated.splice(existingIdx, 1);
                        return [{ ...prev[existingIdx], timestamp: newLog.timestamp }, ...updated];
                    }
                    return [newLog, ...prev].slice(0, MAX_RECORDS);
                });
            } catch { /* ignore */ }
        }, 2000);

        return () => {
            unlistenPromise.then(fn => { if (typeof fn === 'function') fn(); });
            clearInterval(poll);
        };
    }, []);

    // Close dropdowns on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (clearMenuRef.current && !clearMenuRef.current.contains(e.target as Node)) setShowClearMenu(false);
            if (cleanupRef.current && !cleanupRef.current.contains(e.target as Node)) setShowCleanupPicker(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Filtering
    const filteredLogs = logs.filter(log => {
        const now = new Date();
        const todayStart = getDayStart(now);
        if (filterTime === 'today' && log.timestamp < todayStart) return false;
        if (filterTime === 'yesterday') {
            const yStart = new Date(todayStart.getTime() - 86400000);
            if (log.timestamp < yStart || log.timestamp >= todayStart) return false;
        }
        if (filterTime === 'week' && log.timestamp.getTime() < Date.now() - 7 * 86400000) return false;
        if (filterTime === 'month' && log.timestamp.getTime() < Date.now() - 30 * 86400000) return false;
        if (filterType === 'text' && log.type !== 'text') return false;
        if (filterType === 'image' && log.type !== 'image') return false;
        if (filterDir === 'sent' && log.status !== 'sent') return false;
        if (filterDir === 'received' && log.status !== 'received') return false;
        return true;
    });

    const handleCopy = useCallback(async (log: ClipboardLog, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            if (log.type === 'image') {
                await invoke("write_image_to_clipboard", { imageBase64: log.preview });
            } else {
                await invoke("write_to_clipboard", { content: log.preview });
            }
            setCopiedId(log.id);
            setCopiedPreview(selectedId === log.id);
            setTimeout(() => { setCopiedId(null); setCopiedPreview(false); }, 1200);
        } catch { /* ignore */ }
    }, [selectedId]);

    const handleDelete = useCallback((id: number, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setLogs(prev => prev.filter(l => l.id !== id));
        if (selectedId === id) setSelectedId(null);
    }, [selectedId]);

    const handleClearDays = (days: number) => {
        const cutoff = Date.now() - days * 86400000;
        setLogs(prev => prev.filter(l => l.timestamp.getTime() > cutoff));
        setShowClearMenu(false);
    };

    const handleClearAll = () => {
        if (confirmClear) {
            setLogs([]);
            setSelectedId(null);
            setConfirmClear(false);
            setShowClearMenu(false);
        } else {
            setConfirmClear(true);
        }
    };

    const handleSetCleanup = (days: number) => {
        setCleanupDays(days);
        localStorage.setItem(CLEANUP_KEY, String(days));
        setShowCleanupPicker(false);
        if (days > 0) {
            const cutoff = Date.now() - days * 86400000;
            setLogs(prev => prev.filter(l => l.timestamp.getTime() > cutoff));
        }
    };

    return (
        <div style={{ width: '100%', paddingBottom: '0', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 42px)' }}>
            {/* Header */}
            <div style={{ marginBottom: '16px', flexShrink: 0 }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <ClipboardCopy size={22} color="var(--color-primary)" />
                    {t('sync.title')}
                </h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '6px' }}>
                    {t('sync.subtitle')}
                </p>
            </div>

            {/* Filter Bar */}
            <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px',
                padding: '10px 14px', background: 'var(--color-surface-elevated)',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--color-glass-border)',
                flexShrink: 0,
            }}>
                <FilterGroup title={t('sync.filter_time_label')} value={filterTime} onChange={v => setFilterTime(v as TimeFilter)} options={[
                    { key: 'all', label: t('sync.filter_all') },
                    { key: 'today', label: t('sync.filter_today') },
                    { key: 'yesterday', label: t('sync.filter_yesterday') },
                    { key: 'week', label: t('sync.filter_week') },
                    { key: 'month', label: t('sync.filter_month') },
                ]} />
                <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 2px' }} />
                <FilterGroup title={t('sync.filter_type_label')} value={filterType} onChange={v => setFilterType(v as TypeFilter)} options={[
                    { key: 'all', label: t('sync.filter_all') },
                    { key: 'text', label: t('sync.filter_text') },
                    { key: 'image', label: t('sync.filter_image') },
                ]} />
                <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 2px' }} />
                <FilterGroup title={t('sync.filter_direction_label')} value={filterDir} onChange={v => setFilterDir(v as DirFilter)} options={[
                    { key: 'all', label: t('sync.filter_all') },
                    { key: 'sent', label: t('sync.filter_sent') },
                    { key: 'received', label: t('sync.filter_received') },
                ]} />
            </div>

            {/* Main Content: List + Preview */}
            <div style={{ display: 'grid', gridTemplateColumns: '45% 55%', gap: '12px', flex: 1, minHeight: 0 }}>
                {/* Left: Activity List */}
                <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                        {filteredLogs.length === 0 ? (
                            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                <ClipboardCopy size={40} style={{ opacity: 0.15, marginBottom: '12px', margin: '0 auto', display: 'block' }} />
                                <p style={{ fontSize: '13px' }}>{t('sync.no_activity_message')}</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <AnimatePresence>
                                    {filteredLogs.map(log => {
                                        const isSelected = selectedId === log.id;
                                        const isCopied = copiedId === log.id;
                                        return (
                                            <motion.div
                                                key={log.id}
                                                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.96 }}
                                                transition={{ duration: 0.18 }}
                                                onClick={() => setSelectedId(log.id)}
                                                style={{
                                                    display: 'flex', flexDirection: 'column', gap: '6px',
                                                    padding: '10px 12px',
                                                    background: isSelected ? 'rgba(94, 106, 210, 0.08)' : 'var(--color-surface-elevated)',
                                                    borderLeft: isSelected ? '3px solid var(--color-primary)' : '3px solid transparent',
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: isSelected ? undefined : '1px solid var(--color-glass-border)',
                                                    borderLeftWidth: isSelected ? '3px' : undefined,
                                                    borderLeftColor: isSelected ? 'var(--color-primary)' : undefined,
                                                    cursor: 'pointer',
                                                    transition: 'background 0.15s',
                                                    position: 'relative',
                                                }}
                                            >
                                                {/* Top row: status + time */}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <div style={{
                                                            padding: '3px', borderRadius: '5px',
                                                            background: log.status === 'sent' ? 'var(--color-primary-glow)' : 'rgba(34, 197, 94, 0.15)',
                                                            color: log.status === 'sent' ? 'var(--color-primary)' : '#22c55e',
                                                            display: 'flex',
                                                        }}>
                                                            {log.status === 'sent' ? <ArrowUpToLine size={13} /> : <ArrowDownToLine size={13} />}
                                                        </div>
                                                        <span style={{
                                                            fontSize: '11.5px', fontWeight: 600,
                                                            color: log.status === 'sent' ? 'var(--color-primary)' : '#22c55e',
                                                            letterSpacing: '0.3px',
                                                        }}>
                                                            {log.status === 'sent' ? t('sync.status_sent') : t('sync.status_received')}
                                                        </span>
                                                    </div>
                                                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                                        {log.timestamp.toLocaleTimeString()}
                                                    </span>
                                                </div>

                                                {/* Content preview */}
                                                {log.type === 'image' ? (
                                                    <img src={log.preview} alt="" style={{
                                                        height: '80px', width: '100%', objectFit: 'cover',
                                                        borderRadius: '6px',
                                                    }} />
                                                ) : (
                                                    <div style={{
                                                        fontSize: '12px', color: 'var(--color-text-main)',
                                                        lineHeight: '1.4',
                                                        display: '-webkit-box', WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                        fontFamily: '"Fira Code", monospace, Consolas',
                                                        wordBreak: 'break-word',
                                                    }}>
                                                        {log.preview}
                                                    </div>
                                                )}

                                                {/* Bottom right action buttons */}
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '-2px' }}>
                                                    <button
                                                        onClick={(e) => handleCopy(log, e)}
                                                        style={{
                                                            background: 'none', border: 'none', cursor: 'pointer',
                                                            padding: '3px', borderRadius: '4px', display: 'flex',
                                                            color: isCopied ? '#22c55e' : 'var(--color-text-muted)',
                                                            transition: 'color 0.15s',
                                                        }}
                                                        title={t('sync.btn_copy')}
                                                    >
                                                        {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDelete(log.id, e)}
                                                        style={{
                                                            background: 'none', border: 'none', cursor: 'pointer',
                                                            padding: '3px', borderRadius: '4px', display: 'flex',
                                                            color: 'var(--color-text-muted)', transition: 'color 0.15s',
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                                                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                                                        title={t('sync.btn_delete')}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Preview Panel */}
                <div className="glass-panel" style={{
                    borderRadius: 'var(--radius-lg)', padding: '20px',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}>
                    {selectedLog ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            {/* Content Area */}
                            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                {selectedLog.type === 'image' ? (
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '8px' }}>
                                        <img
                                            src={selectedLog.preview}
                                            alt="Preview"
                                            style={{
                                                maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                                                borderRadius: 'var(--radius-md)',
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <div style={{
                                        flex: 1, overflow: 'auto', background: 'var(--color-surface)',
                                        padding: '14px', borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--color-border)',
                                        userSelect: 'text', WebkitUserSelect: 'text',
                                    }}>
                                        <pre style={{
                                            color: 'var(--color-text-main)', fontFamily: '"Fira Code", monospace, Consolas',
                                            fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                            margin: 0, lineHeight: '1.5',
                                        }}>
                                            {selectedLog.preview}
                                        </pre>
                                    </div>
                                )}
                            </div>

                            {/* Meta Info */}
                            <div style={{
                                marginTop: '14px', padding: '10px 14px',
                                background: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-sm)',
                                display: 'flex', flexWrap: 'wrap', gap: '16px',
                                fontSize: '12px', color: 'var(--color-text-muted)',
                            }}>
                                <span>{t('sync.meta_time')}：{selectedLog.timestamp.toLocaleString()}</span>
                                <span>
                                    {t('sync.meta_status')}：
                                    <span style={{ color: selectedLog.status === 'sent' ? 'var(--color-primary)' : '#22c55e', fontWeight: 500 }}>
                                        {selectedLog.status === 'sent' ? t('sync.status_sent') : t('sync.status_received')}
                                    </span>
                                </span>
                                <span>
                                    {t('sync.meta_type')}：
                                    {selectedLog.type === 'image' ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                            <ImageIcon size={12} /> {t('sync.type_image')}
                                            {selectedLog.imageWidth ? ` (${selectedLog.imageWidth}×${selectedLog.imageHeight})` : ''}
                                        </span>
                                    ) : (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                            <FileType size={12} /> {t('sync.type_text')}
                                        </span>
                                    )}
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                                <button
                                    className="btn-primary"
                                    onClick={() => handleCopy(selectedLog)}
                                    style={{ padding: '7px 16px', fontSize: '12.5px', gap: '6px' }}
                                >
                                    {copiedPreview ? <Check size={14} /> : <Copy size={14} />}
                                    {copiedPreview ? t('sync.copy_success') : (selectedLog.type === 'image' ? t('sync.btn_copy_image') : t('sync.btn_copy'))}
                                </button>
                                <button
                                    className="btn-ghost"
                                    onClick={() => handleDelete(selectedLog.id)}
                                    style={{ padding: '7px 16px', fontSize: '12.5px', gap: '6px', color: '#ef4444', display: 'flex', alignItems: 'center' }}
                                >
                                    <Trash2 size={14} /> {t('sync.btn_delete')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            color: 'var(--color-text-muted)',
                        }}>
                            <ClipboardCopy size={44} style={{ opacity: 0.12, marginBottom: '14px' }} />
                            <p style={{ fontSize: '14px' }}>{t('sync.preview_empty')}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Toolbar */}
            <div style={{
                marginTop: '10px', padding: '8px 14px', flexShrink: 0,
                background: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-glass-border)',
                display: 'flex', alignItems: 'center', gap: '16px',
                fontSize: '12px', color: 'var(--color-text-muted)',
            }}>
                <span>{t('sync.record_count', { count: filteredLogs.length })}</span>

                <div style={{ position: 'relative' }} ref={clearMenuRef}>
                    <button
                        className="btn-ghost"
                        onClick={() => { setShowClearMenu(!showClearMenu); setConfirmClear(false); }}
                        style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                        <Trash2 size={13} /> {t('sync.clear_button')} <ChevronDown size={12} />
                    </button>
                    {showClearMenu && (
                        <div style={{
                            position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
                            background: 'var(--color-surface-elevated)', border: '1px solid var(--color-glass-border)',
                            borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-glass)', zIndex: 100,
                            minWidth: '180px', overflow: 'hidden',
                        }}>
                            {[3, 7, 30].map(d => (
                                <button key={d} onClick={() => handleClearDays(d)} style={{
                                    display: 'block', width: '100%', textAlign: 'left',
                                    padding: '8px 14px', background: 'none', border: 'none',
                                    color: 'var(--color-text-main)', fontSize: '12px', cursor: 'pointer',
                                }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface)'}
                                   onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                    {t(`sync.clear_${d}d`)}
                                </button>
                            ))}
                            <div style={{ borderTop: '1px solid var(--color-glass-border)' }} />
                            <button onClick={handleClearAll} style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '8px 14px', background: confirmClear ? 'rgba(239,68,68,0.1)' : 'none',
                                border: 'none', color: confirmClear ? '#ef4444' : '#ef4444',
                                fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                            }}>
                                {confirmClear ? '⚠ 确认？' : t('sync.clear_all')}
                            </button>
                        </div>
                    )}
                </div>

                <div style={{ flex: 1 }} />

                <div style={{ position: 'relative' }} ref={cleanupRef}>
                    <span style={{ marginRight: '4px' }}>{t('sync.auto_cleanup_label')}：</span>
                    <button
                        onClick={() => setShowCleanupPicker(!showCleanupPicker)}
                        style={{
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                            borderRadius: '4px', padding: '2px 8px', color: 'var(--color-text-main)',
                            fontSize: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px',
                        }}
                    >
                        {cleanupDays > 0 ? `${cleanupDays}天` : t('sync.auto_cleanup_off')}
                        <Settings2 size={11} />
                    </button>
                    {showCleanupPicker && (
                        <div style={{
                            position: 'absolute', bottom: '100%', right: 0, marginBottom: '4px',
                            background: 'var(--color-surface-elevated)', border: '1px solid var(--color-glass-border)',
                            borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-glass)', zIndex: 100,
                            overflow: 'hidden',
                        }}>
                            {[0, 1, 3, 7, 14, 30].map(d => (
                                <button key={d} onClick={() => handleSetCleanup(d)} style={{
                                    display: 'block', width: '100%', textAlign: 'left',
                                    padding: '6px 14px', background: cleanupDays === d ? 'var(--color-primary-glow)' : 'none',
                                    border: 'none', color: 'var(--color-text-main)', fontSize: '12px', cursor: 'pointer',
                                    fontWeight: cleanupDays === d ? 600 : 400,
                                }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface)'}
                                   onMouseLeave={e => e.currentTarget.style.background = cleanupDays === d ? 'var(--color-primary-glow)' : 'none'}>
                                    {d === 0 ? t('sync.auto_cleanup_off') : `${d}天`}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
