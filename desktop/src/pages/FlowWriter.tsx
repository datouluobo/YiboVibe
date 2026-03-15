import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { PenTool, Keyboard, Trash2, Plus, Sparkles, Command, Check, Wand2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function HotkeyCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [isCapturing, setIsCapturing] = useState(false);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Win');

        let mainKey = e.key.toUpperCase();
        if (mainKey === ' ') mainKey = 'Space';
        else if (mainKey === 'ENTER') mainKey = 'Enter';
        else if (mainKey === 'ESCAPE') mainKey = 'Esc';
        else if (mainKey === 'TAB') mainKey = 'Tab';
        else if (mainKey === 'BACKSPACE') mainKey = 'Backspace';
        else if (mainKey === 'DELETE') mainKey = 'Delete';
        else if (mainKey.startsWith('ARROW')) mainKey = mainKey.replace('ARROW', '');
        else if (mainKey.length > 1 && mainKey.startsWith('F') && !isNaN(Number(mainKey.slice(1)))) {
        } else if (mainKey.length > 1) {
            return;
        }

        parts.push(mainKey);
        const combo = parts.join('+');
        onChange(combo);
        setIsCapturing(false);
    }, [onChange]);

    return (
        <div
            tabIndex={0}
            onClick={() => setIsCapturing(true)}
            onBlur={() => setIsCapturing(false)}
            onKeyDown={isCapturing ? handleKeyDown : undefined}
            style={{
                background: isCapturing ? 'var(--color-primary-glow)' : 'var(--color-bg-base)',
                border: isCapturing ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                boxShadow: isCapturing ? 'var(--shadow-glow)' : 'inset 0 2px 4px rgba(0,0,0,0.2)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '64px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                outline: 'none',
                userSelect: 'none',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {isCapturing && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)',
                    animation: 'shimmer 1.5s infinite',
                    pointerEvents: 'none'
                }} />
            )}

            {isCapturing ? (
                <motion.div
                    initial={{ opacity: 0.5, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ repeat: Infinity, duration: 0.8, repeatType: "reverse" }}
                    style={{ fontSize: '15px', color: 'var(--color-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <Command size={18} /> 正在监听组合键...
                </motion.div>
            ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
                    {value.split('+').map((k, i) => (
                        <motion.kbd key={i} whileHover={{ y: -2 }} style={{
                            background: 'linear-gradient(180deg, var(--color-surface-elevated) 0%, var(--color-surface) 100%)',
                            border: '1px solid var(--color-border)',
                            borderBottomWidth: '2px',
                            borderRadius: '6px',
                            padding: '6px 14px',
                            fontSize: '14px',
                            fontFamily: 'var(--font-family)',
                            fontWeight: 600,
                            color: 'var(--color-text-main)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                        }}>
                            {k}
                        </motion.kbd>
                    ))}
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        点击此处重新录入
                    </span>
                </div>
            )}
        </div>
    );
}

function ToggleSwitch({ checked, onChange, color = "var(--color-primary)" }: { checked: boolean, onChange: (c: boolean) => void, color?: string }) {
    return (
        <div
            onClick={() => onChange(!checked)}
            style={{
                width: '44px',
                height: '24px',
                background: checked ? color : 'var(--color-bg-base)',
                borderRadius: '100px',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.3s',
                border: checked ? `1px solid ${color}` : '1px solid var(--color-border)',
                boxShadow: checked ? `0 0 10px ${color}40` : 'inset 0 2px 4px rgba(0,0,0,0.2)'
            }}
        >
            <motion.div
                initial={false}
                animate={{ x: checked ? 20 : 2 }}
                style={{
                    width: '18px',
                    height: '18px',
                    background: '#fff',
                    borderRadius: '50%',
                    position: 'absolute',
                    top: '2px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
            />
        </div>
    )
}

export default function FlowWriter() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<any>(null);
    const [customPrompts, setCustomPrompts] = useState<any[]>([]);

    const [isAdding, setIsAdding] = useState(false);
    const [newPromptName, setNewPromptName] = useState("");
    const [newPromptIcon, setNewPromptIcon] = useState("✨");
    const [newPromptSysMsg, setNewPromptSysMsg] = useState("");

    useEffect(() => {
        loadConfig();
        loadPrompts();
    }, []);

    const loadConfig = async () => {
        try {
            const cfg = await invoke("get_flowwriter_config");
            setConfig(cfg);
        } catch (e) {
            console.error(e);
        }
    };

    const loadPrompts = async () => {
        try {
            const data: any = await invoke("get_custom_prompts");
            if (data && data.custom_prompts) {
                setCustomPrompts(data.custom_prompts);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const updateConfig = async (newCfg: any) => {
        try {
            await invoke("update_flowwriter_config", { config: newCfg });
            setConfig(newCfg);
        } catch (e) {
            console.error("Update config failed", e);
        }
    };

    const handleAddPrompt = async () => {
        if (!newPromptName || !newPromptSysMsg) return;

        const newPrompt = {
            id: 'cp_' + Date.now() + Math.random().toString(36).substr(2, 5),
            name: newPromptName,
            icon: newPromptIcon,
            system_message: newPromptSysMsg,
            created_at: new Date().toISOString()
        };

        try {
            await invoke("add_custom_prompt", { prompt: newPrompt });
            setNewPromptName("");
            setNewPromptSysMsg("");
            setIsAdding(false);
            loadPrompts();
        } catch (e) {
            console.error("Failed to add prompt", e);
        }
    };

    const handleRemovePrompt = async (id: string) => {
        try {
            await invoke("remove_custom_prompt", { id });
            loadPrompts();
        } catch (e) {
            console.error("Failed to remove prompt", e);
        }
    };

    if (!config) return null;

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '40px', animation: 'fadeIn 0.4s ease-out' }}>
            {/* Header Area */}
            <div style={{
                marginBottom: '32px',
                background: 'linear-gradient(135deg, var(--color-glass-bg), transparent)',
                padding: '28px',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-glass-border)',
                backdropFilter: 'blur(10px)',
                position: 'relative',
                overflow: 'hidden'
            }}>
                <div style={{ position: 'absolute', top: -50, right: -20, width: 200, height: 200, background: 'var(--color-primary)', filter: 'blur(100px)', opacity: 0.15, borderRadius: '50%', pointerEvents: 'none' }} />

                <h1 style={{ fontSize: '28px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '14px', margin: 0, color: 'var(--color-text-main)' }}>
                    <motion.div
                        animate={{ y: [0, -6, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ display: 'flex', padding: '12px', background: 'var(--color-surface-elevated)', borderRadius: '14px', boxShadow: 'var(--shadow-glow)', border: '1px solid var(--color-glass-border)' }}
                    >
                        <PenTool size={28} color="var(--color-primary)" />
                    </motion.div>
                    {t('flowwriter.title', 'FlowWriter 妙笔')}
                </h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '15px', marginTop: '16px', lineHeight: 1.6, maxWidth: '650px' }}>
                    全局无缝唤起的 AI 文本补全与重构引擎。通过预设指令流与硬件监听网络，在操作系统的任何角落重塑您的光标选中内容。
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '28px', alignItems: 'start' }}>
                {/* Trigger Section */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="glass-panel" style={{ padding: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                            <div style={{ padding: '8px', background: 'var(--color-bg-base)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                <Keyboard size={20} color="var(--color-primary)" />
                            </div>
                            <h3 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>物理层触发矩阵</h3>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Hotkey Card */}
                            <div style={{
                                background: config.trigger_hotkey ? 'var(--color-surface-elevated)' : 'transparent',
                                border: config.trigger_hotkey ? '1px solid var(--color-border-focus)' : '1px solid var(--color-border)',
                                padding: '20px', borderRadius: 'var(--radius-md)', transition: 'all 0.3s'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '6px', color: config.trigger_hotkey ? 'var(--color-primary)' : 'var(--color-text-main)' }}>快捷键组合</div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                                物理热键劫持。选中文本后执行指令组即可调出妙笔重构舱。
                                            </div>
                                        </div>
                                    </div>
                                    <ToggleSwitch
                                        checked={config.trigger_hotkey}
                                        onChange={(v) => updateConfig({ ...config, trigger_hotkey: v })}
                                    />
                                </div>
                                <AnimatePresence>
                                    {config.trigger_hotkey && (
                                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                                            <div style={{ paddingTop: '8px' }}>
                                                <HotkeyCapture
                                                    value={config.hotkey}
                                                    onChange={(v) => updateConfig({ ...config, hotkey: v })}
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Clipboard Card */}
                            <div style={{
                                background: config.trigger_copy ? 'var(--color-surface-elevated)' : 'transparent',
                                border: config.trigger_copy ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--color-border)',
                                padding: '20px', borderRadius: 'var(--radius-md)', transition: 'all 0.3s'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '6px', color: config.trigger_copy ? '#10b981' : 'var(--color-text-main)' }}>剪贴板嗅探</div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                                免去键位记忆，在系统底层自动监听基础 `Ctrl+C` 复制流进行唤起。
                                            </div>
                                        </div>
                                    </div>
                                    <ToggleSwitch
                                        checked={config.trigger_copy}
                                        onChange={(v) => updateConfig({ ...config, trigger_copy: v })}
                                        color="#10b981"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Intelligent Prompts Section */}
                <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ padding: '8px', background: 'var(--color-bg-base)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                <Sparkles size={20} color="var(--color-primary)" />
                            </div>
                            <h3 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>智能预设拓扑层</h3>
                        </div>
                        {!isAdding && (
                            <button className="btn-ghost" onClick={() => setIsAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px', border: '1px solid var(--color-border)', background: 'var(--color-surface-elevated)' }}>
                                <Plus size={16} /> 新建预设
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', alignContent: 'start' }}>
                        <AnimatePresence>
                            {customPrompts.map(p => (
                                <motion.div
                                    key={p.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    whileHover="hover"
                                    style={{
                                        background: 'linear-gradient(145deg, var(--color-surface) 0%, var(--color-surface-elevated) 100%)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '20px',
                                        position: 'relative',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        cursor: 'default'
                                    }}
                                    variants={{
                                        hover: { y: -4, boxShadow: 'var(--shadow-glass)', borderColor: 'var(--color-border-focus)' }
                                    }}
                                >
                                    <div style={{ fontSize: '28px', marginBottom: '14px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>{p.icon}</div>
                                    <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '10px', color: 'var(--color-text-main)' }}>
                                        {p.name}
                                    </div>
                                    <div style={{
                                        fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.5,
                                        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                                    }}>
                                        {p.system_message}
                                    </div>

                                    <motion.button
                                        variants={{
                                            hover: { opacity: 1, scale: 1 }
                                        }}
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        onClick={() => handleRemovePrompt(p.id)}
                                        style={{
                                            position: 'absolute', top: '16px', right: '16px',
                                            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444',
                                            width: '32px', height: '32px', borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                                            transition: 'background 0.2s',
                                            boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                                    >
                                        <Trash2 size={16} />
                                    </motion.button>
                                </motion.div>
                            ))}

                            {isAdding && (
                                <motion.div
                                    layout
                                    initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                                    animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
                                    exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                                    style={{
                                        gridColumn: '1 / -1',
                                        background: 'var(--color-surface-elevated)',
                                        padding: '28px',
                                        borderRadius: 'var(--radius-lg)',
                                        border: '1px solid var(--color-primary)',
                                        boxShadow: 'inset 0 0 20px var(--color-primary-glow)',
                                        position: 'relative'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', color: 'var(--color-primary)', fontWeight: 600, fontSize: '15px' }}>
                                        <Wand2 size={18} /> 构建全新动作流
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                                        <input
                                            type="text"
                                            className="modern-input"
                                            style={{ width: '70px', fontSize: '24px', textAlign: 'center', padding: '12px' }}
                                            value={newPromptIcon}
                                            onChange={e => setNewPromptIcon(e.target.value)}
                                            title="输入 Emoji 标签"
                                        />
                                        <input
                                            type="text"
                                            className="modern-input"
                                            style={{ flex: 1, fontSize: '15px' }}
                                            placeholder="指令名称 (例：小红书文风优化 / 资深码农解说)"
                                            value={newPromptName}
                                            onChange={e => setNewPromptName(e.target.value)}
                                            autoFocus
                                        />
                                    </div>
                                    <textarea
                                        className="modern-input"
                                        style={{ width: '100%', height: '120px', resize: 'none', marginBottom: '20px', lineHeight: 1.6, fontFamily: 'monospace' }}
                                        placeholder="System Prompt (系统级设定词)&#10;您是一个资深的公关人员，请帮我将以下文本润色得体，保持专业、严谨且具有说服力..."
                                        value={newPromptSysMsg}
                                        onChange={e => setNewPromptSysMsg(e.target.value)}
                                    />
                                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                        <button className="btn-ghost" onClick={() => setIsAdding(false)}>
                                            取消
                                        </button>
                                        <button
                                            className="btn-primary"
                                            onClick={handleAddPrompt}
                                            disabled={!newPromptName || !newPromptSysMsg}
                                        >
                                            <Check size={18} /> 存入引擎
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {!isAdding && customPrompts.length === 0 && (
                                <div style={{
                                    gridColumn: '1 / -1',
                                    padding: '60px 0',
                                    textAlign: 'center',
                                    color: 'var(--color-text-dim)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '16px',
                                    background: 'var(--color-surface)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px dashed var(--color-border)'
                                }}>
                                    <Wand2 size={40} style={{ opacity: 0.15 }} />
                                    <span style={{ fontSize: '14px' }}>未发现任何自定义的 AI 指令拓扑</span>
                                </div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}
