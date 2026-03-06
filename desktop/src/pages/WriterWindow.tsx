import { useEffect, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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

    useEffect(() => {
        let unlistenStreamChunk: UnlistenFn;
        let unlistenStreamError: UnlistenFn;
        let unlistenStreamEnd: UnlistenFn;

        const setupListeners = async () => {
            unlistenStreamChunk = await listen<string>("writer-stream-chunk", (event) => {
                setOutput(prev => prev + event.payload);
            });

            unlistenStreamError = await listen<string>("writer-stream-error", (event) => {
                setError(event.payload);
                setIsProcessing(false);
            });

            unlistenStreamEnd = await listen("writer-stream-end", () => {
                setIsProcessing(false);
            });
        };

        setupListeners();

        return () => {
            if (unlistenStreamChunk) unlistenStreamChunk();
            if (unlistenStreamError) unlistenStreamError();
            if (unlistenStreamEnd) unlistenStreamEnd();
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

    const handleDismiss = async () => {
        try {
            await invoke("dismiss_writer_window");
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="writer-overlay">
            <div className="writer-container">
                <div className="writer-header drag-region" data-tauri-drag-region>
                    <span>YiboFlow Midas</span>
                    <button className="writer-close-btn" onClick={handleDismiss}>✕</button>
                </div>

                <div className="writer-input-section">
                    <div className="writer-input-snippet">
                        {payloadText.length > 100
                            ? payloadText.substring(0, 100) + "..."
                            : payloadText || t('flowwriter.waiting_for_text')}
                    </div>
                </div>

                {!isProcessing && output === "" && (
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
                )}

                {(isProcessing || output || error) && (
                    <div className="writer-output-section">
                        {error && <div className="writer-error">{error}</div>}

                        <div className="writer-result markdown-body">
                            <ReactMarkdown>{output}</ReactMarkdown>
                            {isProcessing && <span className="writer-cursor"></span>}
                        </div>

                        {!isProcessing && !error && output && (
                            <div className="writer-output-footer">
                                <button className="writer-btn-secondary" onClick={() => setOutput("")}>放弃</button>
                                <button className="writer-btn-primary" onClick={handleApply}>替换/插入</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
