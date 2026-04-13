import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Palette, Monitor, Laptop, Zap, CheckCircle2, Languages, Save, UploadCloud, DownloadCloud, ServerCog, AlertTriangle, AlertCircle, Box, ToggleRight, ToggleLeft, ShieldCheck, ShieldAlert, Activity, RefreshCw, GripVertical, BrainCircuit, Plus, Trash2, ChevronDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { Reorder, useDragControls } from "framer-motion";

const AI_PRESETS: { [key: string]: { url: string, models: string[] } } = {
    "Ollama (Local)": { url: "http://localhost:11434/v1", models: ["qwen2.5:0.5b", "gemma2:2b", "llama3.2:1b"] },
    "Ollama (LAN)": { url: "http://192.168.1.88:11434/v1", models: ["deepseek-r1:1.5b", "qwen2.5:7b"] },
    "DeepSeek": { url: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
    "Google Gemini": { url: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-3-pro-preview"] },
    "智谱 AI": { url: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4", "glm-4-flash", "glm-4-9b", "glm-3-turbo"] },
    "AIPM": { url: "https://emtf.aipm9527.online/v1", models: ["gpt-4o", "claude-3-5-sonnet", "gemini-1.5-pro"] },
    "Groq": { url: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"] },
    "OpenRouter": { url: "https://openrouter.ai/api/v1", models: ["google/gemini-pro-1.5", "deepseek/deepseek-chat", "anthropic/claude-3.5-sonnet"] },
};

function AiEndpointItem({ 
    ep, 
    idx, 
    handleUpdateEndpoint, 
    handleRemoveEndpoint, 
    handleTestEndpoint, 
    handleFetchModels, 
    verificationStatuses, 
    endpointModels, 
    openModelMenus, 
    setOpenModelMenus, 
    endpointProviderQuick, 
    setEndpointProviderQuick, 
    AI_PRESETS 
}: any) {
    const dragControls = useDragControls();
    return (
        <Reorder.Item 
            key={ep._id || idx} 
            value={ep} 
            dragListener={false}
            dragControls={dragControls}
            style={{
                background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', padding: '6px 12px', 
                display: 'grid', 
                gridTemplateColumns: 'min-content min-content 140px minmax(120px, 1fr) 220px 28px 140px 80px min-content',
                alignItems: 'center', 
                gap: '12px',
                opacity: ep.is_enabled ? 1 : 0.6,
                position: 'relative',
                zIndex: 1,
                minHeight: '48px'
            }}
        >
            {/* 1. Drag Handle */}
            <div 
                onPointerDown={(e) => dragControls.start(e)}
                style={{ cursor: 'grab', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', width: '20px' }}
                title="拖拽排序"
            >
                <GripVertical size={18} />
            </div>

            {/* 2. Enable/Disable Checkbox */}
            <input 
                type="checkbox" 
                checked={ep.is_enabled} 
                onChange={(e) => handleUpdateEndpoint(idx, 'is_enabled', e.target.checked)} 
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                title={ep.is_enabled ? "已启用" : "已禁用"}
            />

            {/* 3. Preset Select */}
            <select 
                value={endpointProviderQuick[idx] || ""}
                onChange={(e) => {
                    const provider = e.target.value;
                    setEndpointProviderQuick((prev: any) => ({ ...prev, [idx]: provider }));
                    if (AI_PRESETS[provider]) {
                        handleUpdateEndpoint(idx, 'base_url', AI_PRESETS[provider].url);
                        if (AI_PRESETS[provider].models.length > 0) {
                            handleUpdateEndpoint(idx, 'model', AI_PRESETS[provider].models[0]);
                        }
                    }
                }}
                style={{ width: '100%', padding: '6px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px' }}
            >
                <option value="">-- 自定义 --</option>
                {Object.keys(AI_PRESETS).map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            {/* 4. Base URL */}
            <input 
                value={ep.base_url} 
                onChange={(e) => {
                    handleUpdateEndpoint(idx, 'base_url', e.target.value);
                    const matched = Object.keys(AI_PRESETS).find(k => AI_PRESETS[k].url === e.target.value);
                    setEndpointProviderQuick((prev: any) => ({ ...prev, [idx]: matched || "" }));
                }} 
                onBlur={() => ep.base_url && handleFetchModels(idx)}
                style={{ padding: '6px 10px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px', width: '100%', boxSizing: 'border-box' }} 
                placeholder="接口地址 (http://...)" 
            />

            {/* 5. Model name */}
            <input 
                list={`preset_models_${idx}`}
                value={ep.model} 
                onChange={(e) => handleUpdateEndpoint(idx, 'model', e.target.value.replace(/^models\//, ""))} 
                style={{ padding: '6px 10px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px', width: '100%', fontWeight: 600, boxSizing: 'border-box' }} 
                placeholder="模型名称" 
            />

            {/* 5.2 Model Selector Arrow Button */}
            <div style={{ position: 'relative' }}>
                <button 
                    onClick={() => openModelMenus[idx] ? setOpenModelMenus((prev: any) => ({ ...prev, [idx]: false })) : handleFetchModels(idx)}
                    style={{
                        padding: '0 6px', height: '28px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                        borderRadius: '6px', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', width: '100%'
                    }}
                >
                    {endpointModels[idx]?.loading ? <RefreshCw size={12} className="animate-spin" /> : <ChevronDown size={14} style={{ transform: openModelMenus[idx] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
                </button>
                {openModelMenus[idx] && (
                    <>
                        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9998 }} onClick={() => setOpenModelMenus((prev: any) => ({ ...prev, [idx]: false }))} />
                        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', minWidth: '200px', maxHeight: '240px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: '8px', zIndex: 9999, overflowY: 'auto', padding: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                            {(() => {
                                const primitives = AI_PRESETS[endpointProviderQuick[idx]]?.models || [];
                                const fetched = endpointModels[idx]?.list || [];
                                const combined = Array.from(new Set([...primitives, ...fetched]));
                                if (endpointModels[idx]?.loading) return <div style={{ padding: '16px', textAlign: 'center' }}><RefreshCw size={14} className="animate-spin" /></div>;
                                return combined.map((m: any) => (
                                    <div key={m} onClick={() => { handleUpdateEndpoint(idx, 'model', m.replace(/^models\//, "")); setOpenModelMenus((prev: any) => ({ ...prev, [idx]: false })); }} style={{ padding: '6px 10px', fontSize: '12px', cursor: 'pointer', borderRadius: '4px', color: ep.model === m.replace(/^models\//, "") ? 'var(--color-primary)' : 'var(--color-text-main)', background: ep.model === m.replace(/^models\//, "") ? 'var(--color-primary-glow)' : 'transparent' }}>
                                        {m.replace(/^models\//, "")}
                                    </div>
                                ));
                            })()}
                        </div>
                    </>
                )}
                <datalist id={`preset_models_${idx}`}>
                    {(AI_PRESETS[endpointProviderQuick[idx]]?.models || []).map((m: any) => <option key={m} value={m.replace(/^models\//, "")} />)}
                    {(endpointModels[idx]?.list || []).map((m: any) => <option key={m} value={m.replace(/^models\//, "")} />)}
                </datalist>
            </div>

            {/* 6. API Key */}
            <input type="password" value={ep.api_key} onChange={(e) => handleUpdateEndpoint(idx, 'api_key', e.target.value)} style={{ padding: '6px 10px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px', width: '100%', boxSizing: 'border-box' }} placeholder="API Key" />

            {/* Status Indicator (Compact) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                {verificationStatuses[idx] && (
                    <div style={{ 
                        color: verificationStatuses[idx].status === 'success' ? '#22c55e' : '#ef4444',
                        display: 'flex', alignItems: 'center', gap: '4px'
                    }} title={verificationStatuses[idx].msg}>
                        {verificationStatuses[idx].status === 'success' ? (
                            <ShieldCheck size={16} />
                        ) : (verificationStatuses[idx].loading ? <Activity size={16} className="animate-spin" /> : <ShieldAlert size={16} />)}
                        {verificationStatuses[idx].status === 'success' && verificationStatuses[idx].latency_ms !== undefined && (
                            <span style={{ fontSize: '10px', opacity: 0.8 }}>{verificationStatuses[idx].latency_ms}ms</span>
                        )}
                    </div>
                )}
            </div>

            {/* 7. Action Buttons */}
            <div style={{ display: 'flex', gap: '6px' }}>
                <button 
                    onClick={() => handleTestEndpoint(idx)}
                    disabled={verificationStatuses[idx]?.loading}
                    className="btn-ghost"
                    style={{ height: '28px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '11px', fontWeight: 600, flexShrink: 0 }}
                >
                    测试
                </button>
                <button 
                    onClick={() => handleRemoveEndpoint(idx)} 
                    style={{ 
                        height: '28px', width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                        color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', 
                        borderRadius: '6px', cursor: 'pointer', flexShrink: 0
                    }}
                    title="删除节点"
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </Reorder.Item>
    );
}



export default function Settings() {
    const { t, i18n } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState("dark");
    const [currentLang, setCurrentLang] = useState(i18n.language || "zh");

    const [appConfig, setAppConfig] = useState<any>(null);
    const [endpoints, setEndpoints] = useState<any[]>([]);
    const [verificationStatuses, setVerificationStatuses] = useState<{ [key: number]: { loading: boolean, status: 'idle' | 'success' | 'auth_err' | 'net_err', msg: string, latency_ms?: number } }>({});
    const [endpointModels, setEndpointModels] = useState<{ [key: number]: { loading: boolean, list: string[] } }>({});
    const [openModelMenus, setOpenModelMenus] = useState<{ [key: number]: boolean }>({});
    const [endpointProviderQuick, setEndpointProviderQuick] = useState<{ [key: number]: string }>({});
    const [isAutostartEnabled, setIsAutostartEnabled] = useState(false);
    const [appVersion, setAppVersion] = useState("");


    const fetchConfig = () => {
        invoke("get_app_config").then((cfg: any) => {
            if (cfg) {
                setAppConfig(cfg);
                if (cfg.ai_engine?.endpoints) {
                    const eps = cfg.ai_engine.endpoints.map((e: any, i: number) => ({ ...e, _id: e._id || `ep-${Date.now()}-${i}` }));
                    setEndpoints(eps);
                    const quick: { [key: number]: string } = {};
                    eps.forEach((e: any, i: number) => {
                        const matched = Object.keys(AI_PRESETS).find(k => AI_PRESETS[k].url === e.base_url);
                        if (matched) quick[i] = matched;
                    });
                    setEndpointProviderQuick(quick);
                }
            }
        }).catch(console.error);

        // Check autostart status
        invoke("plugin:autostart|is_enabled").then((enabled: any) => {
            setIsAutostartEnabled(!!enabled);
        }).catch(e => console.error("Autostart check failed:", e));

        // Get app version
        import("@tauri-apps/api/app").then(({ getVersion }) => {
            getVersion().then(setAppVersion);
        });
    };

    useEffect(() => {
        const theme = localStorage.getItem('yiboflow_theme') || 'dark';
        setCurrentTheme(theme);
        fetchConfig();

        import("@tauri-apps/api/event").then(({ listen }) => {
            const unlisten = listen("config-updated", () => {
                fetchConfig();
            });
            return unlisten;
        }).then(un => {
            return () => { un(); };
        });
    }, []);


    const [syncLoading, setSyncLoading] = useState(false);

    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, message: string, onConfirm: () => void }>({ isOpen: false, message: "", onConfirm: () => { } });
    const [alertDialog, setAlertDialog] = useState<{ isOpen: boolean, message: string, type: 'info' | 'error' | 'success' }>({ isOpen: false, message: "", type: 'info' });

    const handleVaultAction = async (action: string) => {
        const serverUrl = localStorage.getItem('yiboflow_server_url');
        const username = localStorage.getItem('yiboflow_username');
        const savedPwdB64 = localStorage.getItem('yiboflow_saved_pwd');

        if (!serverUrl || serverUrl === 'local' || !username || !savedPwdB64) {
            setAlertDialog({ isOpen: true, message: "必须在已连接远程云端的账号下使用此高级同步库功能！(需开启记住密码)", type: 'error' });
            return;
        }

        const password = atob(savedPwdB64);

        setConfirmDialog({
            isOpen: true,
            message: "这将执行极端的底层数据库操作，是否确认？",
            onConfirm: async () => {
                setSyncLoading(true);
                try {
                    if (action === "compact") {
                        await invoke("manual_vault_compaction", { serverUrl, username, password });
                        setAlertDialog({ isOpen: true, message: "Vault 黑盒收缩整理成功！", type: 'success' });
                    } else if (action === "push") {
                        await invoke("resolve_sync_conflict", { action: "push_local", serverUrl, username, password });
                        setAlertDialog({ isOpen: true, message: "本地 Vault 成功强制覆盖云端！", type: 'success' });
                    } else if (action === "pull") {
                        await invoke("resolve_sync_conflict", { action: "pull_remote", serverUrl, username, password });
                        setAlertDialog({
                            isOpen: true,
                            message: "服务器 Vault 指令下载并在本地覆盖完成，即将刷新应用。",
                            type: 'success'
                        });
                        setTimeout(() => window.location.reload(), 2000);
                    }
                } catch (e) {
                    setAlertDialog({ isOpen: true, message: "操作失败：" + String(e), type: 'error' });
                } finally {
                    setSyncLoading(false);
                }
            }
        });
    };

    const handleExport = async () => {
        try {
            const destPath = await save({
                title: "导出 YiboFlow 配置",
                filters: [{ name: "YiboFlow Backup", extensions: ["ybflow"] }]
            });
            if (destPath) {
                await invoke("export_config", { destPath });
                setAlertDialog({ isOpen: true, message: "导出成功！", type: 'success' });
            }
        } catch (e) {
            console.error(e);
            setAlertDialog({ isOpen: true, message: "导出失败: " + String(e), type: 'error' });
        }
    };

    const handleImport = async () => {
        try {
            const srcPath = await open({
                title: "导入 YiboFlow 配置",
                multiple: false,
                filters: [{ name: "YiboFlow Backup", extensions: ["ybflow"] }]
            });
            if (srcPath && !Array.isArray(srcPath)) {
                setConfirmDialog({
                    isOpen: true,
                    message: "导入配置将完全覆盖现有本地设置，是否继续？",
                    onConfirm: async () => {
                        try {
                            await invoke("import_config", { srcPath });
                            setAlertDialog({ isOpen: true, message: "导入成功，即将刷新！", type: 'success' });
                            setTimeout(() => window.location.reload(), 1500);
                        } catch (err) {
                            setAlertDialog({ isOpen: true, message: "导入过程失败: " + String(err), type: 'error' });
                        }
                    }
                });
            }
        } catch (e) {
            console.error(e);
            setAlertDialog({ isOpen: true, message: "打开文件失败: " + String(e), type: 'error' });
        }
    };

    const handleThemeChange = (themeId: string) => {
        setCurrentTheme(themeId);
        localStorage.setItem('yiboflow_theme', themeId);
        document.documentElement.setAttribute('data-theme', themeId);
        // Sync to other windows
        import("@tauri-apps/api/event").then(({ emit }) => {
            emit("theme-changed", themeId);
        });
    };

    const handleLangChange = (langId: string) => {
        setCurrentLang(langId);
        i18n.changeLanguage(langId);
    };




    const handleTestEndpoint = async (idx: number) => {
        const ep = endpoints[idx];
        setVerificationStatuses(prev => ({ ...prev, [idx]: { loading: true, status: 'idle', msg: '正在并发验证...' } }));
        try {
            const result: any = await invoke("test_ai_endpoint", { endpoint: ep });
            setVerificationStatuses(prev => ({ 
                ...prev, 
                [idx]: { 
                    loading: false, 
                    status: result.success ? 'success' : (result.error_type === 'Unauthorized' ? 'auth_err' : 'net_err'), 
                    msg: result.message || (result.success ? '连接成功' : '失败'),
                    latency_ms: result.latency_ms 
                } 
            }));
        } catch (e) {
            setVerificationStatuses(prev => ({ ...prev, [idx]: { loading: false, status: 'net_err', msg: String(e) } }));
        }
    };

    const handleFetchModels = async (idx: number) => {
        const ep = endpoints[idx];
        setOpenModelMenus(prev => ({ ...prev, [idx]: true }));
        setEndpointModels(prev => ({ ...prev, [idx]: { loading: true, list: prev[idx]?.list || [] } }));
        try {
            const models: string[] = await invoke("list_endpoint_models", { endpoint: ep });
            setEndpointModels(prev => ({ ...prev, [idx]: { loading: false, list: models } }));
            if (!ep.model && models.length > 0) handleUpdateEndpoint(idx, 'model', models[0]);
        } catch (e) {
            setEndpointModels(prev => ({ ...prev, [idx]: { loading: false, list: [] } }));
        }
    };

    const handleSaveEndpoints = async (newEndpoints: any[]) => {
        setEndpoints(newEndpoints);
        try {
            await invoke("update_ai_endpoints", { endpoints: newEndpoints });
        } catch (e) {
            console.error("Save endpoints failed", e);
        }
    };

    const handleAddEndpoint = () => {
        const list = [...endpoints, {
            _id: `ep-new-${Date.now()}-${Math.random()}`,
            provider: "OllamaLAN",
            base_url: "http://localhost:11434/v1",
            api_key: "",
            model: "",
            is_enabled: true,
            priority: endpoints.length + 1
        }];
        handleSaveEndpoints(list);
    };

    const handleRemoveEndpoint = (idx: number) => {
        const list = [...endpoints];
        list.splice(idx, 1);
        handleSaveEndpoints(list);
    };

    const handleUpdateEndpoint = (idx: number, field: string, value: any) => {
        const list = [...endpoints];
        list[idx][field] = value;
        handleSaveEndpoints(list);
    };

    const themes = [
        { id: "dark", name: t('settings.theme_dark_name'), desc: t('settings.theme_dark_desc'), icon: Monitor },
        { id: "linear", name: t('settings.theme_linear_name'), desc: t('settings.theme_linear_desc'), icon: Laptop },
        { id: "macos", name: t('settings.theme_macos_name'), desc: t('settings.theme_macos_desc'), icon: Palette },
        { id: "neon", name: t('settings.theme_neon_name'), desc: t('settings.theme_neon_desc'), icon: Zap },
        { id: "light", name: t('settings.theme_light_name'), desc: t('settings.theme_light_desc'), icon: Monitor }
    ];

    const langs = [
        { id: "zh", name: t('settings.language_chinese') },
        { id: "en", name: t('settings.language_english') }
    ];

    const toggleAutostart = async () => {
        try {
            if (isAutostartEnabled) {
                await invoke("plugin:autostart|disable");
            } else {
                await invoke("plugin:autostart|enable");
            }
            setIsAutostartEnabled(!isAutostartEnabled);
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "设置自启失败: " + String(e), type: 'error' });
        }
    };


    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', width: '100%', maxWidth: '1600px', margin: '0 auto', paddingBottom: '40px', paddingLeft: '20px', paddingRight: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>{t('settings.title')}</h1>
                    <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>{t('settings.subtitle')}</p>
                </div>
                {appVersion && (
                    <div style={{ 
                        marginTop: '10px',
                        padding: '4px 12px', 
                        borderRadius: '100px', 
                        background: 'var(--color-surface-elevated)', 
                        border: '1px solid var(--color-glass-border)',
                        color: 'var(--color-text-dim)', 
                        fontSize: '12px', 
                        fontWeight: 600,
                        letterSpacing: '0.5px',
                        boxShadow: 'var(--shadow-glass)'
                    }}>
                        RELEASE v{appVersion}
                    </div>
                )}
            </div>

            {/* Language Selector */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginBottom: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Languages size={20} color="var(--color-primary)" /> {t('settings.language_title')}
                        </h3>
                        <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '14px' }}>{t('settings.language_desc')}</p>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        {langs.map((lang) => {
                            const isActive = currentLang === lang.id;
                            return (
                                <button
                                    key={lang.id}
                                    onClick={() => handleLangChange(lang.id)}
                                    style={{
                                        border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                        background: isActive ? 'var(--color-primary-glow)' : 'var(--color-surface-elevated)',
                                        color: isActive ? 'var(--color-primary)' : 'var(--color-text-main)',
                                        padding: '10px 24px',
                                        borderRadius: '100px',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                        fontSize: '14px',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    {isActive && <CheckCircle2 size={16} />}
                                    {lang.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Theme Selector */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Palette size={20} color="var(--color-primary)" /> {t('settings.theme_title')}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px', fontSize: '14px' }}>{t('settings.theme_desc')}</p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                    {themes.map((theme) => {
                        const isActive = currentTheme === theme.id;
                        return (
                            <div
                                key={theme.id}
                                onClick={() => handleThemeChange(theme.id)}
                                style={{
                                    border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                    background: isActive ? 'var(--color-primary-glow)' : 'var(--color-surface-elevated)',
                                    padding: '16px',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px',
                                    transition: 'all 0.2s',
                                    position: 'relative'
                                }}
                            >
                                <div style={{
                                    padding: '10px',
                                    borderRadius: '50%',
                                    background: isActive ? 'var(--color-primary)' : 'var(--color-border)',
                                    color: isActive ? '#fff' : 'var(--color-text-muted)'
                                }}>
                                    <theme.icon size={20} />
                                </div>
                                <div>
                                    <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', color: isActive ? 'var(--color-primary)' : 'var(--color-text-main)' }}>
                                        {theme.name}
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                                        {theme.desc}
                                    </p>
                                </div>
                                {isActive && (
                                    <div style={{ position: 'absolute', top: '16px', right: '16px', color: 'var(--color-primary)' }}>
                                        <CheckCircle2 size={18} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>


            {/* General System Settings */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ padding: '10px', background: 'rgba(94, 106, 210, 0.1)', borderRadius: '12px', color: 'var(--color-primary)' }}>
                            <Activity size={22} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>系统常规设置</h3>
                            <p style={{ color: 'var(--color-text-muted)', margin: '4px 0 0 0', fontSize: '14px' }}>配置系统级的运行状态与启动偏好。</p>
                        </div>
                    </div>

                    <button 
                        onClick={toggleAutostart}
                        style={{
                            background: isAutostartEnabled ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-surface-elevated)',
                            border: `1px solid ${isAutostartEnabled ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                            color: isAutostartEnabled ? '#22c55e' : 'var(--color-text-muted)',
                            padding: '10px 20px',
                            borderRadius: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            transition: 'all 0.2s'
                        }}
                    >
                        {isAutostartEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                        {isAutostartEnabled ? '开机自启: 已开启' : '开机自启: 已关闭'}
                    </button>
                </div>
            </div>

            {/* AI Engine Settings */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ padding: '10px', background: 'var(--color-primary-glow)', borderRadius: '12px', color: 'var(--color-primary)' }}>
                            <BrainCircuit size={24} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>AI 引擎节点路由</h3>
                            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>多节点动态链路管理。系统将按优先级匹配可用节点。</p>
                        </div>
                    </div>
                    <button onClick={handleAddEndpoint} className="btn-ghost" style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid var(--color-border)', borderRadius: '10px' }}>
                        <Plus size={16} /> 新增节点
                    </button>
                </div>

                <Reorder.Group axis="y" values={endpoints} onReorder={handleSaveEndpoints} style={{ display: 'flex', flexDirection: 'column', gap: '10px', listStyleType: 'none', padding: 0, margin: 0 }}>
                    {endpoints.map((ep, idx) => (
                        <AiEndpointItem 
                            key={ep._id} ep={ep} idx={idx}
                            handleUpdateEndpoint={handleUpdateEndpoint}
                            handleRemoveEndpoint={handleRemoveEndpoint}
                            handleTestEndpoint={handleTestEndpoint}
                            handleFetchModels={handleFetchModels}
                            verificationStatuses={verificationStatuses}
                            endpointModels={endpointModels}
                            openModelMenus={openModelMenus}
                            setOpenModelMenus={setOpenModelMenus}
                            endpointProviderQuick={endpointProviderQuick}
                            setEndpointProviderQuick={setEndpointProviderQuick}
                            AI_PRESETS={AI_PRESETS}
                        />
                    ))}
                </Reorder.Group>
            </div>

            {/* Backup & Restore */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <DownloadCloud size={20} color="var(--color-primary)" /> {t('settings.backup_title')}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px', fontSize: '14px' }}>{t('settings.backup_desc')}</p>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={handleExport}
                        className="btn-ghost"
                        style={{
                            padding: '10px 24px', borderRadius: 'var(--radius-md)', fontSize: '14px',
                            display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--color-border)'
                        }}
                    >
                        <Save size={16} />
                        {t('settings.btn_export')}
                    </button>
                    <button
                        onClick={handleImport}
                        className="btn-primary"
                        style={{
                            padding: '10px 24px', borderRadius: 'var(--radius-md)', fontSize: '14px',
                            display: 'flex', alignItems: 'center', gap: '8px', border: 'none',
                            background: 'var(--color-primary)', color: '#fff'
                        }}
                    >
                        <UploadCloud size={16} />
                        {t('settings.btn_import')}
                    </button>
                </div>
            </div>

            {/* Advanced Vault Sync Manager */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning)' }}>
                    <ServerCog size={20} /> Vault 深层同步管理 (高级)
                </h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px', fontSize: '14px', lineHeight: 1.5 }}>
                    此面板提供底层加密数据块（Segmented Vault）的强制干预入口。如非多端设备产生重大冲突、或云端空间急需碎片整理，请勿频繁调用。
                </p>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
                    <button
                        onClick={() => handleVaultAction('compact')}
                        disabled={syncLoading}
                        className="btn-outline"
                        style={{ padding: '10px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        {syncLoading ? "执行中..." : "🗜️ 整理碎片冗余 (Compact)"}
                    </button>
                    <button
                        onClick={() => handleVaultAction('push')}
                        disabled={syncLoading}
                        className="btn-danger-outline"
                        style={{ padding: '10px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}
                    >
                        {syncLoading ? "执行中..." : "⬆️ 强制上传覆盖 (Force Push)"}
                    </button>
                    <button
                        onClick={() => handleVaultAction('pull')}
                        disabled={syncLoading}
                        className="btn-danger-outline"
                        style={{ padding: '10px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid var(--color-warning)', color: 'var(--color-warning)', background: 'transparent' }}
                    >
                        {syncLoading ? "执行中..." : "⬇️ 强制下载覆盖 (Force Pull)"}
                    </button>
                </div>
            </div>

            {/* Device Identity & Collision Management */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px', border: '1px solid var(--color-glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ padding: '10px', background: 'rgba(94, 106, 210, 0.1)', borderRadius: '12px', color: 'var(--color-primary)' }}>
                            <ShieldCheck size={22} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>设备唯一性标识 (Identity)</h3>
                            <p style={{ color: 'var(--color-text-muted)', margin: '4px 0 0 0', fontSize: '14px' }}>
                                当前指纹: <code style={{ background: 'var(--color-bg-base)', padding: '2px 6px', borderRadius: '4px', color: 'var(--color-primary)', fontSize: '12px' }}>{appConfig?.device_fingerprint || '获取中...'}</code>
                            </p>
                        </div>
                    </div>

                    <button 
                        onClick={() => {
                            setConfirmDialog({
                                isOpen: true,
                                message: "重新生成识别码将导致云端将此电脑视为“新设备”，需重新登录。确认为解决同步冲突而重置？",
                                onConfirm: async () => {
                                    try {
                                        const newFp = await invoke<string>("regenerate_device_fingerprint");
                                        setAppConfig((prev: any) => ({ ...prev, device_fingerprint: newFp }));
                                        setAlertDialog({ isOpen: true, message: "识别码重置成功！请重新启动本程序以完全生效（新身份将在下次登录时激活）。", type: 'success' });
                                    } catch (e) {
                                        setAlertDialog({ isOpen: true, message: "重置失败: " + String(e), type: 'error' });
                                    }
                                }
                            });
                        }}
                        className="btn-ghost"
                        style={{
                            padding: '10px 20px',
                            borderRadius: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 600,
                            border: '1px solid var(--color-border)',
                            color: 'var(--color-danger)'
                        }}
                    >
                        <RefreshCw size={16} /> 重置唯一识别码
                    </button>
                </div>
                <p style={{ marginTop: '16px', fontSize: '12px', color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
                    💡 提示：如果您通过“直接复制配置文件夹”的方式在另一台电脑部署了 YiboFlow，可能导致两台电脑拥有相同的指纹，从而无法同时被云端识别。点击重置后，两台电脑即可在仪表盘中互相看见。
                </p>
            </div>

            {/* Custom Confirm Dialog */}
            {
                confirmDialog.isOpen && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1000,
                        animation: 'fadeIn 0.2s ease-out'
                    }}>
                        <div className="glass-panel" style={{
                            width: '360px',
                            background: 'var(--color-bg-base)',
                            padding: '24px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                            display: 'flex', flexDirection: 'column', gap: '20px',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', borderRadius: '100px', color: '#ef4444' }}>
                                    <AlertTriangle size={24} />
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>高危操作风险确认</h3>
                                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>{confirmDialog.message}</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })} className="btn-ghost" style={{ padding: '8px 16px', fontSize: '14px', borderRadius: 'var(--radius-md)' }}>取消</button>
                                <button onClick={() => {
                                    confirmDialog.onConfirm();
                                    setConfirmDialog({ ...confirmDialog, isOpen: false });
                                }} className="btn-primary" style={{ padding: '8px 16px', fontSize: '14px', background: '#ef4444', backgroundBlendMode: 'normal' }}>
                                    确认执行
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Custom Alert Dialog */}
            {
                alertDialog.isOpen && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1000,
                        animation: 'fadeIn 0.2s ease-out'
                    }}>
                        <div className="glass-panel" style={{
                            width: '360px',
                            background: 'var(--color-bg-base)',
                            padding: '24px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                            display: 'flex', flexDirection: 'column', gap: '20px',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    padding: '10px',
                                    background: alertDialog.type === 'error' ? 'rgba(239,68,68,0.1)'
                                        : (alertDialog.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,160,0,0.1)'),
                                    borderRadius: '100px',
                                    color: alertDialog.type === 'error' ? '#ef4444'
                                        : (alertDialog.type === 'success' ? '#22c55e' : '#f59e0b')
                                }}>
                                    {alertDialog.type === 'error' ? <AlertTriangle size={24} /> :
                                        (alertDialog.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />)}
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>提示</h3>
                                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{alertDialog.message}</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button onClick={() => setAlertDialog({ ...alertDialog, isOpen: false })} className="btn-primary" style={{ padding: '8px 20px', fontSize: '14px', borderRadius: 'var(--radius-md)' }}>确定</button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
}
