import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback, useRef, useMemo, memo, useLayoutEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
    ClipboardCopy, ArrowDownToLine, ArrowUpToLine,
    Copy, Trash2, Check, ChevronDown, ImageIcon, FileType, X, Search, Pin, PinOff, Download, Settings2
} from "lucide-react";

interface HistoryEntry {
    id: number;
    timestamp: number;
    type: "text" | "image";
    hash: string;
    size: number;
    preview: string | null;
    pinned: boolean;
    source: string;
}

type TimeFilter = "all" | "today" | "yesterday" | "week" | "month";
type TypeFilter = "all" | "text" | "image";

const ANIMATED_ITEMS = 8;
const PAGE_SIZE = 100;

function getDayStart(d: Date): Date {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}

const FilterChip = memo(function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: "3px 10px",
                borderRadius: "100px",
                fontSize: "11.5px",
                fontWeight: active ? 600 : 400,
                background: active ? "var(--color-primary)" : "transparent",
                color: active ? "#fff" : "var(--color-text-muted)",
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
            }}
        >
            {label}
        </button>
    );
});

const FilterGroup = memo(function FilterGroup({ title, options, value, onChange }: {
    title: string;
    options: { key: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)", marginRight: "2px", whiteSpace: "nowrap" }}>{title}</span>
            {options.map(o => (
                <FilterChip key={o.key} label={o.label} active={value === o.key} onClick={() => onChange(o.key)} />
            ))}
        </div>
    );
});

export default function FlowSync() {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<HistoryEntry[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [filterTime, setFilterTime] = useState<TimeFilter>("all");
    const [filterType, setFilterType] = useState<TypeFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchActive, setSearchActive] = useState(false);
    const [showClearMenu, setShowClearMenu] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [copiedPreview, setCopiedPreview] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const clearMenuRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [itemHeight, setItemHeight] = useState(() => {
        const h = Number(localStorage.getItem('yiboflow_item_height') || 56);
        return Number.isFinite(h) ? Math.max(48, h) : 56;
    });
    const [listWidthRatio, setListWidthRatio] = useState(() => {
        const r = Number(localStorage.getItem('yiboflow_list_width_ratio'));
        if (Number.isFinite(r) && r >= 0.25 && r <= 0.55) return r;
        return 0.36;
    });
    const [showAppearancePanel, setShowAppearancePanel] = useState(false);
    const appearanceRef = useRef<HTMLDivElement>(null);

    const selectedLog = useMemo(() => logs.find(l => l.id === selectedId) || null, [logs, selectedId]);

    useEffect(() => {
        invoke("init_clipboard_history").catch(e => console.error("init_clipboard_history failed:", e));
    }, []);

    const fetchHistory = useCallback(async () => {
        try {
            const now = Date.now();
            let timeFrom: number | null = null;
            let timeTo: number | null = null;
            const todayStart = getDayStart(new Date()).getTime();

            if (filterTime === "today") {
                timeFrom = todayStart;
            } else if (filterTime === "yesterday") {
                timeFrom = todayStart - 86400000;
                timeTo = todayStart;
            } else if (filterTime === "week") {
                timeFrom = now - 7 * 86400000;
            } else if (filterTime === "month") {
                timeFrom = now - 30 * 86400000;
            }

            const results = await invoke<HistoryEntry[]>("query_history", {
                typeFilter: filterType !== "all" ? filterType : null,
                timeFrom,
                timeTo,
                limit: PAGE_SIZE,
                offset: 0,
            });
            setLogs(results);
            setTotalCount(results.length);
        } catch (e) {
            console.error("Failed to fetch history:", e);
        }
    }, [filterTime, filterType]);

    const doSearch = useCallback(async () => {
        if (!searchQuery.trim()) {
            fetchHistory();
            return;
        }
        try {
            const results = await invoke<HistoryEntry[]>("search_history", {
                query: searchQuery,
                limit: 50,
            });
            setLogs(results);
            setTotalCount(results.length);
        } catch (e) {
            console.error("Search failed:", e);
        }
    }, [searchQuery, fetchHistory]);

    useEffect(() => {
        if (searchActive) {
            const timer = setTimeout(doSearch, 300);
            return () => clearTimeout(timer);
        } else {
            fetchHistory();
        }
    }, [searchActive, doSearch, fetchHistory]);

    useEffect(() => {
        if (!(window as any).__TAURI_INTERNALS__) return;
        let unlisten: (() => void) | null = null;
        listen<any>("clipboard-event", () => {
            if (!searchActive) {
                fetchHistory();
            }
        }).then(fn => { unlisten = fn; });
        return () => { if (unlisten) unlisten(); };
    }, [searchActive, fetchHistory]);

    useEffect(() => {
        if (!searchActive) {
            fetchHistory();
        }
    }, [filterTime, filterType, fetchHistory, searchActive]);

    useEffect(() => {
        if (selectedLog) {
            setPreviewLoading(true);
            invoke<{ type: string; content: string; width?: number; height?: number }>("get_history_content", { id: selectedLog.id })
                .then(result => {
                    setPreviewContent(result.content);
                })
                .catch(e => {
                    console.error("Failed to load preview:", e);
                    setPreviewContent(null);
                })
                .finally(() => setPreviewLoading(false));
        } else {
            setPreviewContent(null);
        }
    }, [selectedLog]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (clearMenuRef.current && !clearMenuRef.current.contains(e.target as Node)) setShowClearMenu(false);
            if (appearanceRef.current && !appearanceRef.current.contains(e.target as Node)) setShowAppearancePanel(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const handleCopy = useCallback(async (log: HistoryEntry, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            await invoke("copy_history_to_clipboard", { id: log.id });
            setCopiedId(log.id);
            setCopiedPreview(selectedId === log.id);
            setCopyFailed(false);
            setTimeout(() => { setCopiedId(null); setCopiedPreview(false); }, 1200);
            fetchHistory();
        } catch (err) {
            console.error("Copy failed:", err);
            setCopyFailed(true);
            setTimeout(() => setCopyFailed(false), 2000);
        }
    }, [selectedId, fetchHistory]);

    const handleDelete = useCallback(async (id: number, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            await invoke("delete_history", { ids: [id] });
            if (selectedId === id) setSelectedId(null);
            fetchHistory();
        } catch (e) {
            console.error("Delete failed:", e);
        }
    }, [selectedId, fetchHistory]);

    const handleTogglePin = useCallback(async (id: number, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            await invoke("toggle_history_pin", { id });
            fetchHistory();
        } catch (e) {
            console.error("Pin failed:", e);
        }
    }, [fetchHistory]);

    const handleClearDays = useCallback(async (days: number) => {
        try {
            await invoke("clear_history", { beforeDays: days });
            setSelectedId(null);
            setShowClearMenu(false);
            fetchHistory();
        } catch (e) {
            console.error("Clear failed:", e);
        }
    }, [fetchHistory]);

    const handleClearAll = useCallback(async () => {
        if (confirmClear) {
            try {
                await invoke("clear_history", {});
                setLogs([]);
                setSelectedId(null);
                setConfirmClear(false);
                setShowClearMenu(false);
            } catch (e) {
                console.error("Clear all failed:", e);
            }
        } else {
            setConfirmClear(true);
        }
    }, [confirmClear]);

    const [pulling, setPulling] = useState(false);
    const handlePull = useCallback(async () => {
        setPulling(true);
        try {
            await invoke("pull_today_history");
            await new Promise(r => setTimeout(r, 3000));
            fetchHistory();
        } catch (e) {
            console.error("Pull failed:", e);
        } finally {
            setPulling(false);
        }
    }, [fetchHistory]);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            setSearchActive(true);
        } else if (e.key === "Escape") {
            setSearchQuery("");
            setSearchActive(false);
        }
    }, []);

    // Layout: list column width from user ratio; preview panel fills the rest
    const contentRef = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState({ contentH: 400, listW: 400 });
    useLayoutEffect(() => {
        const el = contentRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const h = entry.contentRect.height;
                const totalW = entry.contentRect.width;
                const gap = 12;
                const minListW = 240;
                const minPreviewW = 260;
                let listW = Math.round(totalW * listWidthRatio);
                const maxListW = Math.max(minListW, totalW - gap - minPreviewW);
                listW = Math.max(minListW, Math.min(listW, maxListW));
                setLayout({ contentH: Math.floor(h), listW });
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [listWidthRatio]);

    return (
        <div style={{ width: "100%", flex: "1", minHeight: 0, paddingBottom: "0", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ marginBottom: "10px", flexShrink: 0 }}>
                <h1 style={{ fontSize: "18px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
                    <ClipboardCopy size={18} color="var(--color-primary)" />
                    {t("sync.title")}
                </h1>
            </div>

            {/* Filter Bar */}
            <div style={{
                display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "8px",
                padding: "8px 12px", background: "var(--color-surface-elevated)",
                borderRadius: "var(--radius-md)", border: "1px solid var(--color-glass-border)",
                flexShrink: 0, alignItems: "center",
            }}>
                <FilterGroup title={t("sync.filter_time_label")} value={filterTime} onChange={v => { setFilterTime(v as TimeFilter); setSearchActive(false); }} options={[
                    { key: "all", label: t("sync.filter_all") },
                    { key: "today", label: t("sync.filter_today") },
                    { key: "yesterday", label: t("sync.filter_yesterday") },
                    { key: "week", label: t("sync.filter_week") },
                    { key: "month", label: t("sync.filter_month") },
                ]} />
                <div style={{ width: "1px", background: "var(--color-border)", margin: "0 2px" }} />
                <FilterGroup title={t("sync.filter_type_label")} value={filterType} onChange={v => { setFilterType(v as TypeFilter); setSearchActive(false); }} options={[
                    { key: "all", label: t("sync.filter_all") },
                    { key: "text", label: t("sync.filter_text") },
                    { key: "image", label: t("sync.filter_image") },
                ]} />
                <div style={{ width: "1px", background: "var(--color-border)", margin: "0 2px" }} />
                <div style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1, minWidth: "160px" }}>
                    <Search size={13} color="var(--color-text-muted)" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setSearchActive(true); }}
                        onKeyDown={handleSearchKeyDown}
                        placeholder={t("sync.search_placeholder", "搜索文本内容...")}
                        style={{
                            flex: 1, background: "transparent", border: "none", outline: "none",
                            fontSize: "12px", color: "var(--color-text-main)",
                            fontFamily: "inherit",
                        }}
                    />
                    {searchQuery && (
                        <button onClick={() => { setSearchQuery(""); setSearchActive(false); }} style={{
                            background: "none", border: "none", cursor: "pointer", padding: "2px",
                            color: "var(--color-text-muted)", display: "flex",
                        }}>
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Main Content: List + Preview */}
            <div ref={contentRef} style={{ display: "flex", gap: "12px", flex: 1, minHeight: 0, minWidth: 0 }}>
                {/* Left: Activity List (width from settings) */}
                <div className="glass-panel" style={{ borderRadius: "var(--radius-lg)", display: "flex", flexDirection: "column", overflow: "hidden", flex: `0 0 ${layout.listW}px`, minWidth: 0, maxWidth: "100%" }}>
                    <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
                        {logs.length === 0 ? (
                            <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--color-text-muted)" }}>
                                <ClipboardCopy size={40} style={{ opacity: 0.15, marginBottom: "12px", margin: "0 auto", display: "block" }} />
                                <p style={{ fontSize: "13px" }}>{t("sync.no_activity_message")}</p>
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <AnimatePresence>
                                    {logs.map((log, index) => {
                                        const isSelected = selectedId === log.id;
                                        const isCopied = copiedId === log.id;
                                        const shouldAnimate = index < ANIMATED_ITEMS;
                                        const textLineClamp = Math.max(2, Math.min(12, Math.floor(itemHeight / 16)));
                                        const inner = (
                                            <div style={{ display: "flex", gap: "10px", alignItems: "stretch", minHeight: `${itemHeight}px`, height: `${itemHeight}px` }}>
                                                {/* Left: Info column */}
                                                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "5px", width: "120px", minHeight: 0 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                                        <div style={{
                                                            padding: "3px", borderRadius: "4px",
                                                            background: log.source === "local" ? "var(--color-primary-glow)" : "rgba(34, 197, 94, 0.15)",
                                                            color: log.source === "local" ? "var(--color-primary)" : "#22c55e",
                                                            display: "flex", flexShrink: 0,
                                                        }}>
                                                            {log.source === "local" ? <ArrowUpToLine size={14} /> : <ArrowDownToLine size={14} />}
                                                        </div>
                                                        {log.pinned && <Pin size={13} color="var(--color-primary)" />}
                                                        <span style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                                                            {new Date(log.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                                        {log.type === "image" ? (
                                                            <>
                                                                <ImageIcon size={13} style={{ marginRight: "3px", verticalAlign: "middle" }} />
                                                                {(log.size / 1024).toFixed(0)} KB
                                                            </>
                                                        ) : (
                                                            <>
                                                                <FileType size={13} style={{ marginRight: "3px", verticalAlign: "middle" }} />
                                                                {(log.size / 1024).toFixed(0)} KB
                                                            </>
                                                        )}
                                                    </span>
                                                    <div style={{ display: "flex", gap: "3px" }}>
                                                        <button onClick={(e) => handleTogglePin(log.id, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", borderRadius: "3px", display: "flex", color: log.pinned ? "var(--color-primary)" : "var(--color-text-muted)" }} title={log.pinned ? "Unpin" : "Pin"}>
                                                            {log.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                                                        </button>
                                                        <button onClick={(e) => handleCopy(log, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", borderRadius: "3px", display: "flex", color: isCopied ? "#22c55e" : "var(--color-text-muted)" }} title={t("sync.btn_copy")}>
                                                            {isCopied ? <Check size={15} /> : <Copy size={15} />}
                                                        </button>
                                                        <button onClick={(e) => handleDelete(log.id, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", borderRadius: "3px", display: "flex", color: "var(--color-text-muted)" }} onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={e => (e.currentTarget.style.color = "var(--color-text-muted)")} title={t("sync.btn_delete")}>
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>
                                                </div>
                                                {/* Right: Content area */}
                                                <div style={{
                                                    flex: 1, minWidth: 0, minHeight: 0, height: "100%", alignSelf: "stretch", borderRadius: "6px",
                                                    overflow: "hidden",
                                                    background: log.type === "image" ? "var(--color-surface)" : "var(--color-surface)",
                                                    display: "flex", alignItems: "center",
                                                    justifyContent: log.type === "image" ? "flex-end" : "flex-start",
                                                }}>
                                                    {log.type === "image" ? (
                                                        log.preview ? (
                                                            <img
                                                                src={log.preview}
                                                                alt=""
                                                                style={{ height: "100%", maxHeight: "100%", width: "auto", maxWidth: "100%", objectFit: "contain", display: "block" }}
                                                            />
                                                        ) : (
                                                            <ImageIcon size={24} color="var(--color-text-muted)" style={{ opacity: 0.4 }} />
                                                        )
                                                    ) : (
                                                        <div style={{
                                                            fontSize: "12.5px", color: "var(--color-text-main)",
                                                            lineHeight: "1.45",
                                                            display: "-webkit-box", WebkitLineClamp: textLineClamp,
                                                            WebkitBoxOrient: "vertical", overflow: "hidden",
                                                            fontFamily: '"Fira Code", monospace, Consolas',
                                                            wordBreak: "break-word",
                                                            width: "100%", maxHeight: "100%", alignSelf: "flex-start", padding: "0 2px", boxSizing: "border-box",
                                                        }}>
                                                            {log.preview || "..."}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );

                                        const cardStyle: React.CSSProperties = {
                                            padding: "8px 10px",
                                            background: isSelected ? "rgba(94, 106, 210, 0.12)" : "var(--color-surface-elevated)",
                                            border: isSelected
                                                ? "1px solid rgba(94, 106, 210, 0.35)"
                                                : "1px solid var(--color-glass-border)",
                                            borderLeft: isSelected ? "3px solid var(--color-primary)" : "1px solid var(--color-glass-border)",
                                            borderRadius: "var(--radius-sm)",
                                            boxShadow: isSelected ? "0 1px 3px rgba(0,0,0,0.12)" : "0 1px 2px rgba(0,0,0,0.06)",
                                            cursor: "pointer",
                                            transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
                                            position: "relative",
                                        };

                                        return shouldAnimate ? (
                                            <motion.div
                                                key={log.id}
                                                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.96 }}
                                                transition={{ duration: 0.18 }}
                                                onClick={() => setSelectedId(log.id)}
                                                style={cardStyle}
                                            >
                                                {inner}
                                            </motion.div>
                                        ) : (
                                            <div key={log.id} onClick={() => setSelectedId(log.id)} style={cardStyle}>
                                                {inner}
                                            </div>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Preview Panel — fills remaining width */}
                <div className="glass-panel" style={{
                    borderRadius: "var(--radius-lg)", padding: "20px",
                    display: "flex", flexDirection: "column", overflow: "hidden",
                    flex: 1, minWidth: 0,
                }}>
                    {selectedLog ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                                {previewLoading ? (
                                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)", fontSize: "13px" }}>
                                        Loading...
                                    </div>
                                ) : selectedLog.type === "image" && previewContent ? (
                                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: "8px" }}>
                                        <img
                                            src={previewContent}
                                            alt="Preview"
                                            style={{
                                                maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
                                                borderRadius: "var(--radius-md)",
                                            }}
                                        />
                                    </div>
                                ) : previewContent ? (
                                    <div style={{
                                        flex: 1, overflow: "auto", background: "var(--color-surface)",
                                        padding: "14px", borderRadius: "var(--radius-sm)",
                                        border: "1px solid var(--color-border)",
                                        userSelect: "text", WebkitUserSelect: "text",
                                    }}>
                                        <pre style={{
                                            color: "var(--color-text-main)", fontFamily: '"Fira Code", monospace, Consolas',
                                            fontSize: "13px", whiteSpace: "pre-wrap", wordBreak: "break-word",
                                            margin: 0, lineHeight: "1.5",
                                        }}>
                                            {previewContent}
                                        </pre>
                                    </div>
                                ) : null}
                            </div>

                            {/* Meta Info */}
                            <div style={{
                                marginTop: "14px", padding: "10px 14px",
                                background: "var(--color-surface-elevated)", borderRadius: "var(--radius-sm)",
                                display: "flex", flexWrap: "wrap", gap: "16px",
                                fontSize: "12px", color: "var(--color-text-muted)",
                            }}>
                                <span>{t("sync.meta_time")}：{new Date(selectedLog.timestamp).toLocaleString()}</span>
                                <span>
                                    {t("sync.meta_status")}：
                                    <span style={{ color: selectedLog.source === "local" ? "var(--color-primary)" : "#22c55e", fontWeight: 500 }}>
                                        {selectedLog.source === "local" ? t("sync.status_sent") : t("sync.status_received")}
                                    </span>
                                </span>
                                <span>
                                    {t("sync.meta_type")}：
                                    {selectedLog.type === "image" ? (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                            <ImageIcon size={12} /> {t("sync.type_image")}
                                        </span>
                                    ) : (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                            <FileType size={12} /> {t("sync.type_text")}
                                        </span>
                                    )}
                                </span>
                                <span>{(selectedLog.size / 1024).toFixed(1)} KB</span>
                            </div>

                            {/* Action Buttons */}
                            <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                                <button
                                    className="btn-primary"
                                    onClick={() => handleCopy(selectedLog)}
                                    style={{ padding: "7px 16px", fontSize: "12.5px", gap: "6px", background: copyFailed ? "#ef4444" : undefined }}
                                >
                                    {copyFailed ? <X size={14} /> : (copiedPreview ? <Check size={14} /> : <Copy size={14} />)}
                                    {copyFailed ? t("sync.copy_failed") : (copiedPreview ? t("sync.copy_success") : t("sync.btn_copy"))}
                                </button>
                                <button
                                    className="btn-ghost"
                                    onClick={(e) => handleTogglePin(selectedLog.id, e)}
                                    style={{ padding: "7px 16px", fontSize: "12.5px", gap: "6px", display: "flex", alignItems: "center" }}
                                >
                                    {selectedLog.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                                    {selectedLog.pinned ? "Unpin" : "Pin"}
                                </button>
                                <button
                                    className="btn-ghost"
                                    onClick={() => handleDelete(selectedLog.id)}
                                    style={{ padding: "7px 16px", fontSize: "12.5px", gap: "6px", color: "#ef4444", display: "flex", alignItems: "center" }}
                                >
                                    <Trash2 size={14} /> {t("sync.btn_delete")}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            flex: 1, display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            color: "var(--color-text-muted)",
                        }}>
                            <ClipboardCopy size={44} style={{ opacity: 0.12, marginBottom: "14px" }} />
                            <p style={{ fontSize: "14px" }}>{t("sync.preview_empty")}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Toolbar */}
            <div style={{
                marginTop: "6px", padding: "6px 12px", flexShrink: 0,
                background: "var(--color-surface-elevated)", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-glass-border)",
                display: "flex", alignItems: "center", gap: "16px",
                fontSize: "12px", color: "var(--color-text-muted)",
            }}>
                <div style={{ position: "relative" }} ref={appearanceRef}>
                    <button
                        className="btn-ghost"
                        onClick={() => setShowAppearancePanel(!showAppearancePanel)}
                        style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", color: showAppearancePanel ? "var(--color-primary)" : undefined }}
                    >
                        <Settings2 size={13} /> 外观
                    </button>
                    {showAppearancePanel && (
                        <div style={{
                            position: "absolute", bottom: "100%", left: 0, marginBottom: "4px",
                            background: "var(--color-bg-base)", border: "1px solid var(--color-glass-border)",
                            borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-glass)", zIndex: 100,
                            padding: "14px 16px", minWidth: "260px",
                        }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-main)", marginBottom: "10px" }}>
                                活动流设置
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)", whiteSpace: "nowrap", width: "70px" }}>条目高度</span>
                                    <input type="range" min={48} max={200} value={itemHeight} onChange={e => {
                                        const v = Math.max(48, Math.min(200, Number(e.target.value)));
                                        setItemHeight(v);
                                        localStorage.setItem('yiboflow_item_height', String(v));
                                    }} style={{ flex: 1, accentColor: "var(--color-primary)" }} />
                                    <span style={{ fontSize: "11px", color: "var(--color-text-main)", fontWeight: 600, minWidth: "36px", textAlign: "right" }}>{itemHeight}px</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)", whiteSpace: "nowrap", width: "70px" }}>条目宽度</span>
                                    <input
                                        type="range"
                                        min={25}
                                        max={55}
                                        value={Math.round(listWidthRatio * 100)}
                                        onChange={e => {
                                            const p = Math.max(25, Math.min(55, Number(e.target.value))) / 100;
                                            setListWidthRatio(p);
                                            localStorage.setItem('yiboflow_list_width_ratio', String(p));
                                        }}
                                        style={{ flex: 1, accentColor: "var(--color-primary)" }}
                                    />
                                    <span style={{ fontSize: "11px", color: "var(--color-text-main)", fontWeight: 600, minWidth: "44px", textAlign: "right" }}>
                                        {Math.round(listWidthRatio * 100)}% · {layout.listW}px
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <span>{t("sync.record_count", { count: totalCount })}</span>

                <button
                    className="btn-ghost"
                    onClick={handlePull}
                    disabled={pulling}
                    style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", opacity: pulling ? 0.5 : 1 }}
                >
                    <Download size={13} /> {pulling ? "拉取中..." : "拉取今天"}
                </button>

                <div style={{ position: "relative" }} ref={clearMenuRef}>
                    <button
                        className="btn-ghost"
                        onClick={() => { setShowClearMenu(!showClearMenu); setConfirmClear(false); }}
                        style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
                    >
                        <Trash2 size={13} /> {t("sync.clear_button")} <ChevronDown size={12} />
                    </button>
                    {showClearMenu && (
                        <div style={{
                            position: "absolute", bottom: "100%", left: 0, marginBottom: "4px",
                            background: "var(--color-surface-elevated)", border: "1px solid var(--color-glass-border)",
                            borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-glass)", zIndex: 100,
                            minWidth: "180px", overflow: "hidden",
                        }}>
                            {[3, 7, 30].map(d => (
                                <button key={d} onClick={() => handleClearDays(d)} style={{
                                    display: "block", width: "100%", textAlign: "left",
                                    padding: "8px 14px", background: "none", border: "none",
                                    color: "var(--color-text-main)", fontSize: "12px", cursor: "pointer",
                                }} onMouseEnter={e => e.currentTarget.style.background = "var(--color-surface)"}
                                   onMouseLeave={e => e.currentTarget.style.background = "none"}>
                                    {t(`sync.clear_${d}d`)}
                                </button>
                            ))}
                            <div style={{ borderTop: "1px solid var(--color-glass-border)" }} />
                            <button onClick={handleClearAll} style={{
                                display: "block", width: "100%", textAlign: "left",
                                padding: "8px 14px", background: confirmClear ? "rgba(239,68,68,0.1)" : "none",
                                border: "none", color: confirmClear ? "#ef4444" : "#ef4444",
                                fontSize: "12px", cursor: "pointer", fontWeight: 600,
                            }}>
                                {confirmClear ? "⚠ 确认？" : t("sync.clear_all")}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
