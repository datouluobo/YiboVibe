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

export default function HintWindow() {
    const [candidates, setCandidates] = useState<string[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const unlisten = listen<HintEvent>("hint-event", async (event) => {
            const data = event.payload;
            if (data.type === "Hide") {
                setVisible(false);
            } else if (data.type === "Show") {
                const showData = data.data;
                setCandidates(showData.candidates);
                setSelectedIndex(showData.selected_index);
                setVisible(true);
            } else if (data.type === "UpdateSelection") {
                setSelectedIndex(data.data);
            }
        });

        // Ensure transparent global body background so our drop-shadow looks natural
        if (window.location.hash.includes('hint')) {
            document.body.style.background = 'transparent';
            document.documentElement.style.background = 'transparent';
        }

        return () => { unlisten.then(f => f()); };
    }, []);

    // ---------------------------------------------------------------
    // Drag Logic: Native smooth dragging via requestAnimationFrame
    // Uses invoke to immediately command Rust to MoveWindow
    // ---------------------------------------------------------------
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
        // screenX/Y are CSS logical pixels; outerPosition returns physical pixels.
        // Multiply delta by devicePixelRatio to align coordinate spaces.
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

    const handleAccept = async (index: number) => {
        try {
            await invoke("accept_hint_candidate", { index });
        } catch (e) {
            console.error("Failed to accept hint candidate:", e);
        }
    };

    if (!visible) return null;

    return (
        // OUTER WRAPPER: Provides structural padding so that the drop-shadow
        // of the inner window doesn't get clipped into right-angle corners by the OS Window bounds!
        <div style={{
            width: '100%',
            height: '100vh',
            padding: '0px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
        }}>
            {/* INNER CARD: Actual UI bounds */}
            <div style={{
                background: 'rgba(25, 25, 30, 0.92)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                color: '#fff',
                fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
                userSelect: 'none',
                overflow: 'hidden',
                flexGrow: 1, // dynamically fills the padded area
            }}>

                {/* Drag handle bar */}
                <div
                    onMouseDown={onHandleMouseDown}
                    style={{
                        height: '18px',
                        minHeight: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'move',
                        flexShrink: 0,
                    }}
                >
                    <div style={{
                        width: '36px',
                        height: '4px',
                        background: 'rgba(255, 255, 255, 0.18)',
                        borderRadius: '2px'
                    }} />
                </div>

                {/* Candidate list - scrollable */}
                <div style={{
                    overflowY: 'auto',
                    maxHeight: `${8 * 35}px`, // max 8 visible items
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255,255,255,0.15) transparent',
                }}>
                    {candidates.map((cand, idx) => (
                        <div
                            key={idx}
                            onClick={() => handleAccept(idx)}
                            ref={el => {
                                if (el && idx === selectedIndex) {
                                    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                }
                            }}
                            style={{
                                padding: '7px 10px',
                                borderRadius: '6px',
                                background: idx === selectedIndex ? 'rgba(94, 106, 210, 0.25)' : 'transparent',
                                borderLeft: idx === selectedIndex ? '3px solid #5E6AD2' : '3px solid transparent',
                                color: idx === selectedIndex ? '#fff' : 'rgba(255, 255, 255, 0.7)',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                transition: 'all 0.08s ease',
                                flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = idx === selectedIndex
                                    ? 'rgba(94, 106, 210, 0.35)'
                                    : 'rgba(255, 255, 255, 0.06)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = idx === selectedIndex
                                    ? 'rgba(94, 106, 210, 0.25)'
                                    : 'transparent';
                            }}
                        >
                            <span style={{
                                fontSize: '10px',
                                color: idx === selectedIndex ? '#5E6AD2' : 'rgba(255, 255, 255, 0.25)',
                                width: '14px',
                                textAlign: 'right',
                                fontWeight: 600,
                            }}>{idx + 1}</span>
                            <span style={{
                                flex: 1,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>{cand}</span>
                        </div>
                    ))}
                </div>

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Footer */}
                <div style={{
                    marginTop: '4px',
                    paddingTop: '5px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '10px',
                    color: 'rgba(255, 255, 255, 0.25)',
                    paddingLeft: '6px',
                    paddingRight: '6px',
                    paddingBottom: '2px',
                    flexShrink: 0,
                }}>
                    <span>↑↓ 切换</span>
                    <span style={{ color: '#5E6AD2' }}>Tab 确认</span>
                    <span
                        onClick={() => invoke("reset_hint_position")}
                        style={{ color: '#E53E3E', cursor: 'pointer' }}
                        title="重置窗口位置"
                    >🔴 重置</span>
                </div>
            </div>
        </div>
    );
}
