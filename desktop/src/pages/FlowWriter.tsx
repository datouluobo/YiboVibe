import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { PenTool, Keyboard, Copy, Trash2 } from "lucide-react";

function HotkeyCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [isCapturing, setIsCapturing] = useState(false);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Ignore lone modifier presses
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Win');

        // Map the main key
        let mainKey = e.key.toUpperCase();
        if (mainKey === ' ') mainKey = 'Space';
        else if (mainKey === 'ENTER') mainKey = 'Enter';
        else if (mainKey === 'ESCAPE') mainKey = 'Esc';
        else if (mainKey === 'TAB') mainKey = 'Tab';
        else if (mainKey === 'BACKSPACE') mainKey = 'Backspace';
        else if (mainKey === 'DELETE') mainKey = 'Delete';
        else if (mainKey.startsWith('ARROW')) mainKey = mainKey.replace('ARROW', '');
        else if (mainKey.length > 1 && mainKey.startsWith('F') && !isNaN(Number(mainKey.slice(1)))) {
            // F1-F12 keys, keep as is
        } else if (mainKey.length > 1) {
            // Other special keys, skip
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
                background: isCapturing ? 'rgba(99, 102, 241, 0.1)' : 'rgba(0,0,0,0.2)',
                border: isCapturing ? '2px solid var(--color-primary)' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '12px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '44px',
                transition: 'all 0.2s',
                outline: 'none',
                userSelect: 'none',
            }}
        >
            {isCapturing ? (
                <span style={{ fontSize: '13px', color: 'var(--color-primary)', animation: 'blink 1s ease-in-out infinite' }}>
                    ⌨️ 请按下组合键...
                </span>
            ) : (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {value.split('+').map((k, i) => (
                        <span key={i} style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '4px',
                            padding: '3px 10px',
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: 'var(--color-text-main)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                        }}>
                            {k}
                        </span>
                    ))}
                    <span style={{ fontSize: '11px', color: 'var(--color-text-dim)', alignSelf: 'center', marginLeft: '8px' }}>
                        点击修改
                    </span>
                </div>
            )}
        </div>
    );
}

export default function FlowWriter() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<any>(null);
    const [customPrompts, setCustomPrompts] = useState<any[]>([]);

    // New prompt state
    const [newPromptName, setNewPromptName] = useState("");
    const [newPromptIcon, setNewPromptIcon] = useState("⚡");
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

    if (!config) return <div>Loading...</div>;

    return (
        <div style={{ maxWidth: '860px' }}>
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <PenTool size={22} color="var(--color-primary)" />
                    {t('flowwriter.title', 'FlowWriter 妙笔')}
                </h1>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '13px', marginTop: '6px' }}>
                    通过快捷键或复制内容，直接唤起 AI 处理面板，提升文本处理效率。
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px' }}>

                {/* Trigger Configs */}
                <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                        触发设定
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* Hotkey Trigger */}
                        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '8px' }}>
                                    <Keyboard size={18} color="var(--color-primary)" />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: '14px' }}>快捷键触发</div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-dim)' }}>通过按下快捷键复制光标选中的文本</div>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                className="toggle-checkbox"
                                checked={config.trigger_hotkey}
                                onChange={(e) => updateConfig({ ...config, trigger_hotkey: e.target.checked })}
                            />
                        </label>

                        {config.trigger_hotkey && (
                            <div style={{ marginLeft: '46px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '8px' }}>
                                    点击下方区域，然后按下您想要的组合键
                                </div>
                                <HotkeyCapture
                                    value={config.hotkey}
                                    onChange={(v) => updateConfig({ ...config, hotkey: v })}
                                />
                            </div>
                        )}

                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }}></div>

                        {/* Copy Trigger */}
                        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '8px' }}>
                                    <Copy size={18} color="var(--color-success)" />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: '14px' }}>剪贴板触发</div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-dim)' }}>任何普通的复制动作即可拉起提示窗</div>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                className="toggle-checkbox"
                                checked={config.trigger_copy}
                                onChange={(e) => updateConfig({ ...config, trigger_copy: e.target.checked })}
                            />
                        </label>
                    </div>
                </div>

                {/* Prompt Configs */}
                <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        自定义处理模板
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '20px' }}>
                        您可以在此处预设高频使用的 AI 动作模板，如"小红书文风优化"或"翻译为德语"。
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
                        {customPrompts.length === 0 && (
                            <div style={{ fontSize: '13px', color: 'var(--color-text-dim)', textAlign: 'center', padding: '16px 0' }}>
                                暂无自定义模板
                            </div>
                        )}
                        {customPrompts.map(p => (
                            <div key={p.id} style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.05)',
                                borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between'
                            }}>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {p.icon} {p.name}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginTop: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                        {p.system_message}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRemovePrompt(p.id)}
                                    style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', opacity: 0.8, alignSelf: 'flex-start' }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div style={{ background: 'var(--color-panel-bg)', padding: '16px', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '12px' }}>新建模板</div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                            <input
                                type="text"
                                className="input-field"
                                style={{ width: '40px', fontSize: '14px', textAlign: 'center' }}
                                value={newPromptIcon}
                                onChange={e => setNewPromptIcon(e.target.value)}
                                title="Icon emoji"
                            />
                            <input
                                type="text"
                                className="input-field"
                                style={{ flex: 1, fontSize: '14px' }}
                                placeholder="动作名称 (如: 小红书文风)"
                                value={newPromptName}
                                onChange={e => setNewPromptName(e.target.value)}
                            />
                        </div>
                        <textarea
                            className="input-field"
                            style={{ width: '100%', height: '80px', fontSize: '13px', resize: 'none', marginBottom: '12px' }}
                            placeholder="System 设定词 (如: 把下列文字改写为活泼的小红书风格...)"
                            value={newPromptSysMsg}
                            onChange={e => setNewPromptSysMsg(e.target.value)}
                        />
                        <button
                            className="btn-primary"
                            style={{ width: '100%', padding: '8px' }}
                            onClick={handleAddPrompt}
                            disabled={!newPromptName || !newPromptSysMsg}
                        >
                            保存预设
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}

