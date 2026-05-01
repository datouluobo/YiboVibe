import React, { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface HintShowData {
    candidates: string[];
    selected_index: number;
    x: number;
    y: number;
}

interface HintEventShow {
    type: "Show";
    data: HintShowData;
}

interface HintEventUpdateSelection {
    type: "UpdateSelection";
    data: number;
}

interface HintEventHide {
    type: "Hide";
}

type HintEvent = HintEventShow | HintEventUpdateSelection | HintEventHide;

interface Theme {
    bg: string;
    bgHover: string;
    bgSelected: string;
    border: string;
    accent: string;
    text: string;
    textMuted: string;
    textDim: string;
    green: string;
    itemH: number;
    headerH: number;
    footerH: number;
    padX: number;
    padY: number;
    radius: number;
    fontSize: string;
    numSize: string;
    footerSize: string;
    badgeSize: string;
}

function buildTheme(s: number): Theme {
    return {
        bg: "#1C1C1E",
        bgHover: "#2C2C2E",
        bgSelected: "rgba(94, 106, 210, 0.18)",
        border: "rgba(255,255,255,0.08)",
        accent: "#5E6AD2",
        text: "#E5E5E7",
        textMuted: "#8E8E93",
        textDim: "rgba(255,255,255,0.3)",
        green: "#34C759",
        itemH: Math.round(32 * s),
        headerH: Math.round(20 * s),
        footerH: Math.round(22 * s),
        padX: Math.round(6 * s),
        padY: Math.round(5 * s),
        radius: Math.max(6, Math.round(10 * s)),
        fontSize: `${(12.5 * s).toFixed(1)}px`,
        numSize: `${(10 * s).toFixed(1)}px`,
        footerSize: `${(9 * s).toFixed(1)}px`,
        badgeSize: `${(8 * s).toFixed(1)}px`,
    };
}

interface CfgHintWindow {
    pos_type: number;
}

export default function HintWindow() {
    const [candidates, setCandidates] = useState<string[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [visible, setVisible] = useState(false);
    const [posType, setPosType] = useState(0);
    const [hoverIdx, setHoverIdx] = useState(-1);

    const scale = 1.0;
    const T = buildTheme(scale);

    const loadConfig = useCallback(() => {
        invoke<{ hint_window: CfgHintWindow }>("get_app_config")
            .then(cfg => {
                setPosType(cfg.hint_window.pos_type);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        loadConfig();

        const unlistenConfig = listen("config-updated", () => { loadConfig(); });
        const unlisten = listen<HintEvent>("hint-event", async (event) => {
            const data = event.payload;
            if (data.type === "Hide") {
                setVisible(false);
            } else if (data.type === "Show") {
                const showData = data.data;
                setCandidates(showData.candidates);
                setSelectedIndex(showData.selected_index);
                setHoverIdx(-1);
                setVisible(true);
                // Refresh config (posType, scale) on every show
                loadConfig();
            } else if (data.type === "UpdateSelection") {
                setSelectedIndex(data.data);
            }
        });

        if (window.location.hash.includes('hint')) {
            document.body.style.background = 'transparent';
            document.documentElement.style.background = 'transparent';
        }

        return () => {
            unlisten.then(f => f());
            unlistenConfig.then(f => f());
        };
    }, [loadConfig]);

    // ── Drag logic (move window) ──
    const dragState = useRef({
        active: false,
        startScreenX: 0,
        startScreenY: 0,
        winStartX: 0,
        winStartY: 0,
        rafId: 0 as number,
        nextX: 0,
        nextY: 0,
    });

    const triggerMove = useCallback(() => {
        invoke("move_hint_window", { x: dragState.current.nextX, y: dragState.current.nextY }).catch(() => { });
        dragState.current.rafId = 0;
    }, []);

    const onDragMove = useCallback((e: MouseEvent) => {
        if (!dragState.current.active) return;
        const dpr = window.devicePixelRatio || 1;
        const dx = (e.screenX - dragState.current.startScreenX) * dpr;
        const dy = (e.screenY - dragState.current.startScreenY) * dpr;
        dragState.current.nextX = dragState.current.winStartX + Math.round(dx);
        dragState.current.nextY = dragState.current.winStartY + Math.round(dy);
        if (!dragState.current.rafId) {
            dragState.current.rafId = requestAnimationFrame(triggerMove);
        }
    }, [triggerMove]);

    const onDragEnd = useCallback((e: MouseEvent) => {
        if (!dragState.current.active) return;
        dragState.current.active = false;
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        if (dragState.current.rafId) {
            cancelAnimationFrame(dragState.current.rafId);
            dragState.current.rafId = 0;
        }
        const dpr = window.devicePixelRatio || 1;
        const dx = (e.screenX - dragState.current.startScreenX) * dpr;
        const dy = (e.screenY - dragState.current.startScreenY) * dpr;
        const nx = dragState.current.winStartX + Math.round(dx);
        const ny = dragState.current.winStartY + Math.round(dy);
        invoke("move_hint_window", { x: nx, y: ny }).catch(() => { });
        invoke("update_hint_position", { x: nx, y: ny }).catch(() => { });
    }, [onDragMove]);

    const onHandleMouseDown = useCallback(async (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragState.current.startScreenX = e.screenX;
        dragState.current.startScreenY = e.screenY;
        try {
            const pos = await getCurrentWindow().outerPosition();
            dragState.current.winStartX = pos.x;
            dragState.current.winStartY = pos.y;
        } catch {
            dragState.current.winStartX = 0;
            dragState.current.winStartY = 0;
        }
        dragState.current.active = true;
        document.addEventListener("mousemove", onDragMove);
        document.addEventListener("mouseup", onDragEnd);
    }, [onDragMove, onDragEnd]);

    // ── Accept ──
    const handleAccept = async (index: number) => {
        if (!visible) return;
        setVisible(false);
        try {
            await invoke("accept_hint_candidate", { index });
        } catch (e) {
            console.error("Failed to accept hint candidate:", e);
        }
    };

    if (!visible) return null;

    const gripDotSize = Math.max(2, Math.round(3 * scale));

    return (
        <div style={{
            width: '100%',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
        }}>
            <div style={{
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: T.radius,
                padding: `${T.padY}px ${T.padX}px`,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                color: T.text,
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                userSelect: 'none',
                overflow: 'hidden',
                flexGrow: 1,
                boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                position: 'relative',
            }}>

                {/* Header: drag grip + mode badge */}
                <div
                    onMouseDown={onHandleMouseDown}
                    style={{
                        height: T.headerH,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'move',
                        flexShrink: 0,
                        paddingLeft: '2px',
                        paddingRight: '2px',
                    }}
                >
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(3, ${gripDotSize}px)`, gap: `${Math.max(1, gripDotSize - 1)}px`, opacity: 0.35 }}>
                        {[...Array(6)].map((_, i) => (
                            <div key={i} style={{ width: gripDotSize, height: gripDotSize, borderRadius: '50%', background: '#fff' }} />
                        ))}
                    </div>
                    <span style={{
                        fontSize: T.badgeSize,
                        padding: `${Math.max(1, Math.round(scale))}px ${Math.max(3, Math.round(6 * scale))}px`,
                        borderRadius: `${Math.max(2, Math.round(4 * scale))}px`,
                        background: posType === 0 ? 'rgba(94,106,210,0.15)' : 'rgba(52,199,89,0.15)',
                        color: posType === 0 ? T.accent : T.green,
                        fontWeight: 600,
                        letterSpacing: '0.3px',
                    }}>
                        {posType === 0 ? 'FOLLOW' : 'FIXED'}
                    </span>
                </div>

                {/* Candidate list */}
                <div style={{
                    overflowY: 'auto',
                    scrollbarWidth: 'none',
                    flex: '1 1 0',
                    minHeight: 0,
                }}>
                    {candidates.slice(0, 8).map((cand, idx) => {
                        const isSelected = idx === selectedIndex;
                        const isHovered = idx === hoverIdx;
                        return (
                            <div
                                key={idx}
                                onClick={() => handleAccept(idx)}
                                onMouseEnter={() => setHoverIdx(idx)}
                                onMouseLeave={() => setHoverIdx(-1)}
                                ref={el => {
                                    if (el && isSelected) {
                                        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                    }
                                }}
                                style={{
                                    height: T.itemH,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: `${Math.round(8 * scale)}px`,
                                    cursor: 'pointer',
                                    borderRadius: Math.max(4, Math.round(6 * scale)),
                                    padding: `0 ${Math.round(8 * scale)}px`,
                                    background: isSelected
                                        ? T.bgSelected
                                        : isHovered
                                            ? T.bgHover
                                            : 'transparent',
                                    borderLeft: `${Math.max(1, Math.round(2 * scale))}px solid ${isSelected ? T.accent : 'transparent'}`,
                                    transition: 'background 0.1s ease',
                                    flexShrink: 0,
                                }}
                            >
                                <span style={{
                                    fontSize: T.numSize,
                                    width: Math.round(14 * scale),
                                    textAlign: 'center',
                                    fontWeight: 600,
                                    color: isSelected ? T.accent : T.textDim,
                                    flexShrink: 0,
                                }}>{idx + 1}</span>
                                <span style={{
                                    flex: 1,
                                    fontSize: T.fontSize,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    color: isSelected ? '#fff' : T.textMuted,
                                    fontWeight: isSelected ? 500 : 400,
                                }}>{cand}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div style={{
                    height: T.footerH,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: T.footerSize,
                    color: T.textDim,
                    paddingLeft: `${Math.round(8 * scale)}px`,
                    paddingRight: `${Math.round(4 * scale)}px`,
                    flexShrink: 0,
                    marginTop: '2px',
                }}>
                    <div style={{ display: 'flex', gap: `${Math.round(8 * scale)}px`, alignItems: 'center' }}>
                        <span>↑↓ 切换</span>
                        <span style={{ color: T.accent, fontWeight: 600 }}>Tab 确认</span>
                    </div>
                    <div style={{ display: 'flex', gap: `${Math.round(4 * scale)}px`, alignItems: 'center' }}>
                        <span
                            onClick={() => invoke("reset_hint_position")}
                            style={{
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: Math.round(16 * scale),
                                height: Math.round(16 * scale),
                                borderRadius: Math.max(2, Math.round(3 * scale)),
                                color: T.textDim,
                                transition: 'all 0.12s',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#E8A03E';
                                e.currentTarget.style.background = 'rgba(232,160,62,0.12)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = T.textDim;
                                e.currentTarget.style.background = 'transparent';
                            }}
                            title="重置窗口位置"
                        >
                            <svg width={Math.round(11 * scale)} height={Math.round(11 * scale)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 4v5h5" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 9" />
                            </svg>
                        </span>
                        <span
                            onClick={(e) => { e.stopPropagation(); invoke("dismiss_hint_window"); }}
                            style={{
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: Math.round(16 * scale),
                                height: Math.round(16 * scale),
                                borderRadius: Math.max(2, Math.round(3 * scale)),
                                color: T.textDim,
                                transition: 'all 0.12s',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#E5534B';
                                e.currentTarget.style.background = 'rgba(229,83,75,0.12)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = T.textDim;
                                e.currentTarget.style.background = 'transparent';
                            }}
                            title="关闭 (ESC)"
                        >
                            <svg width={Math.round(10 * scale)} height={Math.round(10 * scale)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M4 4l8 8M12 4l-8 8" />
                            </svg>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
