import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { PenTool, Keyboard, Trash2, Plus, Sparkles, Command, Wand2 } from "lucide-react";
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
    const [standardPrompts, setStandardPrompts] = useState<any>(null);

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
            const cfg: any = await invoke("get_app_config");
            if (cfg?.flowwriter) setConfig(cfg.flowwriter);
        } catch (e) {
            console.error(e);
        }
    };

    const loadPrompts = async () => {
        try {
            const data: any = await invoke("get_custom_prompts");
            if (data) {
                if (data.custom_prompts) setCustomPrompts(data.custom_prompts);
                if (data.standard_prompts) setStandardPrompts(data.standard_prompts);
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
            setNewPromptIcon("✨");
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

    const handleResetPrompts = async () => {
        if (!confirm("确定要恢复所有功能提示词为系统默认设置吗？")) return;
        try {
            await invoke("reset_standard_prompts");
            loadPrompts();
        } catch (e) {
            console.error("Reset failed", e);
        }
    };

    if (!config) return null;

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '60px', animation: 'fadeIn 0.4s ease-out' }}>
            {/* Header Area */}
            <div style={{
                marginBottom: '32px',
                background: 'linear-gradient(135deg, var(--color-glass-bg), transparent)',
                padding: '32px',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-glass-border)',
                backdropFilter: 'blur(10px)',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ position: 'absolute', top: -50, left: -20, width: 250, height: 250, background: 'var(--color-primary)', filter: 'blur(120px)', opacity: 0.1, borderRadius: '50%', pointerEvents: 'none' }} />
                
                <div style={{ position: 'relative', zIndex: 1 }}>
                    <h1 style={{ fontSize: '32px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '16px', margin: 0, color: 'var(--color-text-main)', letterSpacing: '-0.5px' }}>
                        <motion.div
                            animate={{ rotate: [0, 10, 0, -10, 0] }}
                            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                            style={{ display: 'flex', padding: '14px', background: 'var(--color-surface-elevated)', borderRadius: '18px', boxShadow: 'var(--shadow-glow)', border: '1px solid var(--color-glass-border)' }}
                        >
                            <PenTool size={32} color="var(--color-primary)" />
                        </motion.div>
                        {t('flowwriter.title', 'FlowWriter · 妙笔')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '15px', marginTop: '16px', lineHeight: 1.6, maxWidth: '600px' }}>
                        基于大语言模型的全场景生产力引擎。通过物理层监听与云端提示词矩阵，重塑跨应用的文本构建体验。
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '12px', zIndex: 1 }}>
                    <button 
                        onClick={() => setIsAdding(true)}
                        className="btn-primary"
                        style={{ padding: '12px 24px', borderRadius: '14px', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 8px 20px rgba(94, 106, 210, 0.3)' }}
                    >
                        <Plus size={18} /> 新增自定义指令
                    </button>
                    <button 
                        onClick={handleResetPrompts}
                        className="btn-ghost"
                        style={{ padding: '12px 20px', borderRadius: '14px', fontSize: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <Wand2 size={18} /> 恢复预设
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                {/* Trigger Matrix Row */}
                <div className="glass-panel" style={{ padding: '32px', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
                        <div style={{ padding: '10px', background: 'var(--color-primary-glow)', borderRadius: '12px', color: 'var(--color-primary)' }}>
                            <Keyboard size={24} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>物理层触发矩阵</h3>
                            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>管理妙笔在操作系统级的唤起策略与热键绑定。</p>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        {/* Hotkey Card */}
                        <div style={{
                            background: config.trigger_hotkey ? 'rgba(94, 106, 210, 0.05)' : 'var(--color-surface)',
                            border: config.trigger_hotkey ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                            padding: '24px', borderRadius: 'var(--radius-md)', transition: 'all 0.3s',
                            boxShadow: config.trigger_hotkey ? '0 10px 30px rgba(94, 106, 210, 0.1)' : 'none'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                <div style={{ display: 'flex', gap: '14px' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '6px', color: config.trigger_hotkey ? 'var(--color-primary)' : 'var(--color-text-main)' }}>快捷键组合执行</div>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                                            系统级热键劫持。选中文本后按下组合键即可调出指令矩阵。
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
                            background: config.trigger_copy ? 'rgba(16, 185, 129, 0.05)' : 'var(--color-surface)',
                            border: config.trigger_copy ? '1px solid #10b981' : '1px solid var(--color-border)',
                            padding: '24px', borderRadius: 'var(--radius-lg)', transition: 'all 0.3s',
                            boxShadow: config.trigger_copy ? '0 10px 30px rgba(16, 185, 129, 0.1)' : 'none'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ display: 'flex', gap: '14px' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '6px', color: config.trigger_copy ? '#10b981' : 'var(--color-text-main)' }}>剪贴板流式唤起</div>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                                            监听 `Ctrl+C` 信号。复制文本后自动在焦点处激活重构指令。
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

                {/* Intelligent Prompts Section */}
                <div className="glass-panel" style={{ padding: '32px', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ padding: '10px', background: 'var(--color-primary-glow)', borderRadius: '12px', color: 'var(--color-primary)' }}>
                            <Sparkles size={24} />
                        </div>
                        <h3 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>核心提示词指令矩阵</h3>
                    </div>
                    <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '32px', marginLeft: '46px' }}>
                        精调 AI 引擎的执行人格。支持变量注入: <code style={{ color: 'var(--color-primary)', background: 'var(--color-primary-glow)', padding: '2px 6px', borderRadius: '4px' }}>{`{ratio}`}</code> (比例), <code style={{ color: 'var(--color-primary)', background: 'var(--color-primary-glow)', padding: '2px 6px', borderRadius: '4px' }}>{`{style}`}</code> (文风), <code style={{ color: 'var(--color-primary)', background: 'var(--color-primary-glow)', padding: '2px 6px', borderRadius: '4px' }}>{`{target_lang}`}</code> (语言)。
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '24px' }}>
                        <AnimatePresence>
                            {/* Standard Prompts List */}
                            {standardPrompts && [
                                { id: 'polish', name: '文本润色 (Polish)', icon: '✨' },
                                { id: 'summarize', name: '核心总结 (Summarize)', icon: '📦' },
                                { id: 'explain', name: '深度解析 (Explain)', icon: '🧠' },
                                { id: 'expand', name: '内容扩写 (Expand)', icon: '➕' },
                                { id: 'condense', name: '精炼压缩 (Condense)', icon: '🗑️' },
                                { id: 'style', name: '文风改写 (Style)', icon: '🎭' },
                                { id: 'translate', name: '多语翻译 (Translate)', icon: '🌐' },
                            ].map(p => (
                                <motion.div
                                    key={p.id}
                                    layout
                                    style={{
                                        background: 'var(--color-surface-elevated)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '16px',
                                        padding: '20px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '16px',
                                        transition: 'border-color 0.2s'
                                    }}
                                    whileHover={{ borderColor: 'var(--color-primary-glow)', boxShadow: 'var(--shadow-glass)' }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ fontSize: '24px' }}>{p.icon}</span>
                                            <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--color-text-main)' }}>{p.name}</span>
                                        </div>
                                        <div style={{ fontSize: '10px', background: 'var(--color-primary)', color: '#fff', padding: '3px 8px', borderRadius: '6px', fontWeight: 800 }}>SYSTEM</div>
                                    </div>
                                    <textarea
                                        value={standardPrompts[p.id]}
                                        onChange={(e) => {
                                            const newVal = e.target.value;
                                            setStandardPrompts({...standardPrompts, [p.id]: newVal});
                                            invoke("update_standard_prompts", { prompts: {...standardPrompts, [p.id]: newVal} });
                                        }}
                                        style={{
                                            width: '100%', minHeight: '120px', padding: '12px', borderRadius: '10px',
                                            background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                            color: 'var(--color-text-main)', fontSize: '13px', lineHeight: 1.6,
                                            resize: 'vertical', fontFamily: 'var(--font-family)', outline: 'none'
                                        }}
                                        placeholder={`定义 ${p.name} 的 AI 行为...`}
                                    />
                                </motion.div>
                            ))}

                            {/* Custom Prompts */}
                            {customPrompts.map(p => (
                                <motion.div
                                    key={p.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    style={{
                                        background: 'var(--color-surface-elevated)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '16px',
                                        padding: '20px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '16px',
                                        position: 'relative'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <input 
                                                value={p.icon} 
                                                onChange={(e) => {
                                                    const updated = {...p, icon: e.target.value};
                                                    invoke("add_custom_prompt", { prompt: updated }).then(() => loadPrompts());
                                                }}
                                                style={{ width: '32px', border: 'none', background: 'transparent', fontSize: '24px', textAlign: 'center' }}
                                            />
                                            <input 
                                                value={p.name} 
                                                onChange={(e) => {
                                                    const updated = {...p, name: e.target.value};
                                                    invoke("add_custom_prompt", { prompt: updated }).then(() => loadPrompts());
                                                }}
                                                style={{ border: 'none', background: 'transparent', fontWeight: 700, fontSize: '15px', color: 'var(--color-text-main)', width: '100%' }}
                                            />
                                        </div>
                                        <button 
                                            onClick={() => handleRemovePrompt(p.id)}
                                            style={{ color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', opacity: 0.6 }}
                                            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                            onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <textarea
                                        value={p.system_message}
                                        onChange={(e) => {
                                            const updated = {...p, system_message: e.target.value};
                                            invoke("add_custom_prompt", { prompt: updated }).then(() => loadPrompts());
                                        }}
                                        style={{
                                            width: '100%', minHeight: '120px', padding: '12px', borderRadius: '10px',
                                            background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                            color: 'var(--color-text-main)', fontSize: '13px', lineHeight: 1.6,
                                            resize: 'vertical', fontFamily: 'var(--font-family)', outline: 'none'
                                        }}
                                        placeholder="定义 AI 行为..."
                                    />
                                </motion.div>
                            ))}

                            {isAdding && (
                                <motion.div
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    style={{
                                        background: 'var(--color-primary-glow)',
                                        border: '2px dashed var(--color-primary)',
                                        borderRadius: '16px',
                                        padding: '20px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '16px'
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <input 
                                            value={newPromptIcon} 
                                            onChange={e => setNewPromptIcon(e.target.value)}
                                            style={{ width: '40px', padding: '8px', borderRadius: '8px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', fontSize: '20px', textAlign: 'center' }}
                                        />
                                        <input 
                                            value={newPromptName} 
                                            onChange={e => setNewPromptName(e.target.value)}
                                            placeholder="预设名称..."
                                            style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontWeight: 600 }}
                                        />
                                    </div>
                                    <textarea 
                                        value={newPromptSysMsg} 
                                        onChange={e => setNewPromptSysMsg(e.target.value)}
                                        placeholder="请输入 System Prompt..."
                                        style={{ width: '100%', height: '100px', padding: '12px', borderRadius: '8px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '13px' }}
                                    />
                                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                        <button className="btn-ghost" onClick={() => setIsAdding(false)}>取消</button>
                                        <button className="btn-primary" onClick={handleAddPrompt}>构建指令</button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}
