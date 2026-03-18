import { useEffect, useState, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import ReactMarkdown from 'react-markdown';
import "./WriterWindow.css";

interface WriterEvent {
    type: string;
    data?: any;
}

export default function WriterWindow() {
    const { t } = useTranslation();
    const [payloadText, setPayloadText] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [output, setOutput] = useState("");
    const [error, setError] = useState("");
    const [customPrompts, setCustomPrompts] = useState<any[]>([]);

    const handleDismiss = useCallback(async () => {
        try {
            await invoke("dismiss_writer_window");
        } catch (e) {
            console.error(e);
        }
    }, []);

    // ---------------------------------------------------------------
    // Drag Logic — mirrors HintWindow.tsx
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
        invoke("move_writer_window", { x: dragState.current.nextX, y: dragState.current.nextY }).catch(() => { });
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

        invoke("move_writer_window", { x: nx, y: ny }).catch(() => { });
        invoke("update_writer_position", { x: nx, y: ny }).catch(() => { });
    }, [onDragMove]);

    const onHandleMouseDown = useCallback(async (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
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

    // ---------------------------------------------------------------

    useEffect(() => {
        let isMounted = true;
        let unlisteners: UnlistenFn[] = [];

        const setupListeners = async () => {
            const unlisten1 = await listen<string>("writer-stream-chunk", (event) => {
                setOutput(prev => prev + event.payload);
            });

            const unlisten2 = await listen<string>("writer-stream-error", (event) => {
                setError(event.payload);
                setIsProcessing(false);
            });

            const unlisten3 = await listen("writer-stream-end", () => {
                setIsProcessing(false);
            });

            if (isMounted) {
                unlisteners.push(unlisten1, unlisten2, unlisten3);
            } else {
                unlisten1();
                unlisten2();
                unlisten3();
            }
        };

        setupListeners();

        return () => {
            isMounted = false;
            unlisteners.forEach(unlisten => unlisten());
        };
    }, []);

    useEffect(() => {
        const fetchCustomPrompts = async () => {
            try {
                const config: any = await invoke("get_custom_prompts");
                if (config && config.custom_prompts) {
                    setCustomPrompts(config.custom_prompts);
                }
            } catch (e) {
                console.error("Failed to fetch custom prompts:", e);
            }
        };

        fetchCustomPrompts();

        const setupMsgListener = async () => {
            const unlistenMsg = await listen<WriterEvent>("writer-event", (event) => {
                const ev = event.payload;
                console.log("Writer Event RX:", ev);
                if (ev.type === "TextSelected" || ev.type === "TextCopied") {
                    setPayloadText(ev.data?.text || "");
                    setOutput("");
                    setError("");
                    setIsProcessing(false);
                }
            });
            return unlistenMsg;
        };

        let ul: any;
        setupMsgListener().then(res => ul = res);
        return () => {
            if (ul) ul();
        }
    }, []);

    const handleAction = async (action: string, payload?: string) => {
        setIsProcessing(true);
        setOutput("");
        setError("");
        try {
            await invoke("stream_ai_writer", {
                action,
                actionPayload: payload || null,
                userInput: payloadText,
            });
        } catch (e: any) {
            setError(e.toString());
            setIsProcessing(false);
        }
    };

    const handleApply = async () => {
        try {
            await invoke("paste_writer_text", { text: output });
        } catch (e) {
            console.error(e);
        }
    };

    const handleBack = () => {
        setOutput("");
        setError("");
        setIsProcessing(false);
    };

    return (
        <div className="writer-overlay">
            <div className="writer-container">
                <div
                    className="writer-drag-handle"
                    onMouseDown={onHandleMouseDown}
                >
                    <div className="writer-drag-pill" />
                    <button
                        className="writer-close-btn"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={handleDismiss}
                        title="关闭 (Esc)"
                    >✕</button>
                </div>

                <div className="writer-body">
                    <div className={`writer-input-snippet ${isProcessing || output || error ? 'compact' : ''}`}>
                        {payloadText || t('flowwriter.waiting_for_text', '等待文本输入...')}
                    </div>

                    {!isProcessing && output === "" && !error && (
                        <div className="writer-actions-container">
                            <div className="writer-actions">
                                <button onClick={() => handleAction("Polish")}>✨ 润色</button>
                                <button onClick={() => handleAction("Expand", "1.5")}>📝 扩写</button>
                                <button onClick={() => handleAction("Condense", "50%")}>✂️ 缩写</button>
                                <button onClick={() => handleAction("Summarize")}>📌 总结</button>
                                <button onClick={() => handleAction("Translate", "English")}>🌐 译为英文</button>
                                <button onClick={() => handleAction("Explain")}>💡 解释</button>

                                {customPrompts.map(p => (
                                    <button key={p.id} onClick={() => handleAction("Custom", p.id)}>
                                        {p.icon} {p.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {(isProcessing || output || error) && (
                        <div className="writer-output-section">
                            <div className="writer-result-header">
                                <button className="writer-back-btn" onClick={handleBack}>← 返回</button>
                                {isProcessing && <span className="writer-status-tag">生成中...</span>}
                            </div>
                            {error && <div className="writer-error">{error}</div>}
                            <div className="writer-result">
                                <ReactMarkdown>{output}</ReactMarkdown>
                                {isProcessing && <span className="writer-cursor"></span>}
                            </div>
                            {!isProcessing && !error && output && (
                                <div className="writer-output-footer">
                                    <button className="writer-btn-secondary" onClick={handleBack}>放弃</button>
                                    <button className="writer-btn-primary" onClick={handleApply}>替换/插入</button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="writer-footer">
                    <span>Esc 关闭 / ← 返回</span>
                    <span style={{ color: 'var(--color-primary, #5E6AD2)', fontWeight: 600 }}>妙笔 FlowWriter</span>
                </div>
            </div>
        </div>
    );
}
