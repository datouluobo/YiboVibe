import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Palette, Monitor, Laptop, Zap, CheckCircle2, Languages, Save, UploadCloud, DownloadCloud, ServerCog, AlertTriangle, AlertCircle, BrainCircuit, Plus, Trash2, Key, Link2, Box, ToggleRight, ToggleLeft, ShieldCheck, ShieldAlert, Activity, ChevronDown, RefreshCw, GripVertical } from "lucide-react";
import { Reorder } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

export default function Settings() {
    const { t, i18n } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState("dark");
    const [currentLang, setCurrentLang] = useState(i18n.language || "zh");

    const [endpoints, setEndpoints] = useState<any[]>([]);
    const [verificationStatuses, setVerificationStatuses] = useState<{ [key: number]: { loading: boolean, status: 'idle' | 'success' | 'auth_err' | 'net_err', msg: string } }>({});
    const [endpointModels, setEndpointModels] = useState<{ [key: number]: { loading: boolean, list: string[] } }>({});
    const [openModelMenus, setOpenModelMenus] = useState<{ [key: number]: boolean }>({});
    const [appConfig, setAppConfig] = useState<any>(null);

    const fetchConfig = () => {
        invoke("get_app_config").then((cfg: any) => {
            if (cfg) {
                setAppConfig(cfg);
                if (cfg.ai_engine && cfg.ai_engine.endpoints) {
                    setEndpoints(cfg.ai_engine.endpoints);
                }
            }
        }).catch(console.error);
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

    const handleTestEndpoint = async (idx: number) => {
        const ep = endpoints[idx];
        setVerificationStatuses(prev => ({ ...prev, [idx]: { loading: true, status: 'idle', msg: '正在并发验证...' } }));
        
        try {
            // This command will be implemented in the Next Step in Rust
            const result: any = await invoke("test_ai_endpoint", { endpoint: ep });
            if (result.success) {
                setVerificationStatuses(prev => ({ ...prev, [idx]: { loading: false, status: 'success', msg: result.message || '连接成功' } }));
            } else {
                const isAuth = result.error_type === 'Unauthorized';
                setVerificationStatuses(prev => ({ ...prev, [idx]: { loading: false, status: isAuth ? 'auth_err' : 'net_err', msg: result.message } }));
            }
        } catch (e) {
            setVerificationStatuses(prev => ({ ...prev, [idx]: { loading: false, status: 'net_err', msg: String(e) } }));
        }
    };

    const handleFetchModels = async (idx: number) => {
        const ep = endpoints[idx];
        // 立即开启菜单并设置加载状态，提供即时反馈
        setOpenModelMenus(prev => ({ ...prev, [idx]: true }));
        setEndpointModels(prev => ({ ...prev, [idx]: { loading: true, list: prev[idx]?.list || [] } }));
        
        try {
            const models: string[] = await invoke("list_endpoint_models", { endpoint: ep });
            setEndpointModels(prev => ({ ...prev, [idx]: { loading: false, list: models } }));
            
            // 如果当前没有设置模型，自动帮你选中拉取到的第一个
            if (!ep.model && models.length > 0) {
                handleUpdateEndpoint(idx, 'model', models[0]);
            }
        } catch (e) {
            setEndpointModels(prev => ({ ...prev, [idx]: { loading: false, list: [] } }));
            console.error("Fetch models failed:", e);
        }
    };

    const handleSaveEndpoints = async (newEndpoints: any[]) => {
        setEndpoints(newEndpoints);
        try {
            await invoke("update_ai_endpoints", { endpoints: newEndpoints });
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "保存AI配置失败: " + e, type: "error" });
        }
    };

    const handleAddEndpoint = () => {
        const list = [...endpoints, {
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


    const handleUpdateWindowValue = async (type: 'hint' | 'writer', field: string, value: any) => {
        if (!appConfig) return;
        const newConfig = { ...appConfig };
        const windowKey = type === 'hint' ? 'hint_window' : 'writer_window';
        newConfig[windowKey][field] = value;
        
        // Handle Unified Logic
        if (newConfig.is_window_config_unified) {
            const otherKey = type === 'hint' ? 'writer_window' : 'hint_window';
            newConfig[otherKey][field] = value;
        }

        setAppConfig(newConfig);
        try {
            await invoke("update_settings", {
                isSyncEnabled: newConfig.is_sync_enabled,
                flowhintMinChars: newConfig.flowhint_min_chars,
                flowhintAcceptKey: newConfig.flowhint_accept_key,
                hintWindow: newConfig.hint_window,
                writerWindow: newConfig.writer_window,
                isWindowConfigUnified: newConfig.is_window_config_unified
            });
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "更新失败: " + e, type: "error" });
        }
    };

    const handleToggleUnified = async (checked: boolean) => {
        if (!appConfig) return;
        const newConfig = { ...appConfig, is_window_config_unified: checked };
        
        // If enabling, sync hint to writer (or vice versa, let's pick writer as source of truth for now or just current state)
        if (checked) {
            newConfig.hint_window = { ...newConfig.writer_window };
        }
        
        setAppConfig(newConfig);
        try {
            await invoke("update_settings", {
                isSyncEnabled: newConfig.is_sync_enabled,
                flowhintMinChars: newConfig.flowhint_min_chars,
                flowhintAcceptKey: newConfig.flowhint_accept_key,
                hintWindow: newConfig.hint_window,
                writerWindow: newConfig.writer_window,
                isWindowConfigUnified: checked
            });
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "更新失败: " + e, type: "error" });
        }
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

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>{t('settings.title')}</h1>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px' }}>{t('settings.subtitle')}</p>

            {/* Language Selector */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginBottom: '32px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Languages size={20} color="var(--color-primary)" /> {t('settings.language_title')}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px', fontSize: '14px' }}>{t('settings.language_desc')}</p>

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

            {/* Theme Selector */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Palette size={20} color="var(--color-primary)" /> {t('settings.theme_title')}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px', fontSize: '14px' }}>{t('settings.theme_desc')}</p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
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

            {/* AI Engine Settings */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <BrainCircuit size={20} color="var(--color-primary)" /> AI 引擎节点路由
                        </h3>
                        <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '14px' }}>动态路由多个模型节点。系统将按列表顺序优先调用最上方的节点。</p>
                    </div>
                    <button onClick={handleAddEndpoint} className="btn-ghost" style={{ padding: '6px 12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                        <Plus size={16} /> 新增节点
                    </button>
                </div>

                <datalist id="preset_base_urls">
                    <option value="http://localhost:11434/v1">本地 Ollama (默认)</option>
                    <option value="http://192.168.1.88:11434/v1">局域网 NAS (Ollama)</option>
                    <option value="https://lisibo.top:98/v1">广域网 NAS (外网穿透)</option>
                    <option value="https://api.deepseek.com/v1">DeepSeek 官方</option>
                </datalist>
                <datalist id="preset_models">
                    <option value="qwen2.5:0.5b">qwen2.5:0.5b (本地极速)</option>
                    <option value="gemma2:2b">gemma2:2b (推荐极速)</option>
                    <option value="deepseek-chat">deepseek-chat</option>
                    <option value="deepseek-reasoner">deepseek-reasoner</option>
                </datalist>

                <Reorder.Group axis="y" values={endpoints} onReorder={handleSaveEndpoints} style={{ display: 'flex', flexDirection: 'column', gap: '16px', listStyleType: 'none', padding: 0, margin: 0 }}>
                    {endpoints.map((ep, idx) => (
                        <Reorder.Item key={idx} value={ep} style={{
                            background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px',
                            opacity: ep.is_enabled ? 1 : 0.6
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ cursor: 'grab', color: 'var(--color-text-muted)', padding: '0 4px' }}>
                                        <GripVertical size={16} />
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                                        <input type="checkbox" checked={ep.is_enabled} onChange={(e) => handleUpdateEndpoint(idx, 'is_enabled', e.target.checked)} />
                                        节点 {idx + 1}
                                    </label>
                                </div>
                                <button onClick={() => handleRemoveEndpoint(idx)} className="btn-ghost" style={{ padding: '4px', color: 'var(--color-danger)', opacity: 0.8 }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.5fr auto', gap: '12px', alignItems: 'end' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Link2 size={12} /> 接口地址</span>
                                    <input 
                                        list="preset_base_urls" 
                                        value={ep.base_url} 
                                        onChange={(e) => handleUpdateEndpoint(idx, 'base_url', e.target.value)} 
                                        onBlur={() => ep.base_url && handleFetchModels(idx)}
                                        style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px', width: '100%' }} 
                                        placeholder="http://..." 
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Box size={12} /> 模型名称</span>
                                    <div style={{ position: 'relative', display: 'flex', gap: '4px' }}>
                                        <input 
                                            value={ep.model} 
                                            onChange={(e) => handleUpdateEndpoint(idx, 'model', e.target.value)} 
                                            style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px', width: '100%' }} 
                                            placeholder="如 qwen3" 
                                        />
                                        <button 
                                            onClick={() => openModelMenus[idx] ? setOpenModelMenus(prev => ({ ...prev, [idx]: false })) : handleFetchModels(idx)}
                                            style={{
                                                padding: '0 6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                                borderRadius: '6px', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center'
                                            }}
                                            title="刷新远程模型列表"
                                        >
                                            {endpointModels[idx]?.loading ? <RefreshCw size={14} className="animate-spin" /> : <ChevronDown size={14} style={{ transform: openModelMenus[idx] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
                                        </button>

                                        {openModelMenus[idx] && (
                                            <>
                                                <div 
                                                    style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9998 }} 
                                                    onClick={(e) => { e.stopPropagation(); setOpenModelMenus(prev => ({ ...prev, [idx]: false })); }} 
                                                />
                                                <div style={{
                                                    position: 'absolute', top: '100%', right: 0, marginTop: '4px', minWidth: '200px', maxHeight: '240px', 
                                                    background: '#1a1a1a', border: '1px solid #444', borderRadius: '8px',
                                                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)', zIndex: 9999, overflowY: 'auto',
                                                    padding: '4px'
                                                }}>
                                                    {endpointModels[idx]?.loading ? (
                                                        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--color-text-dim)' }}>
                                                            <RefreshCw size={16} className="animate-spin" />
                                                            <span style={{ fontSize: '11px' }}>正在请求模型列表...</span>
                                                        </div>
                                                    ) : (endpointModels[idx]?.list || []).length > 0 ? (
                                                        endpointModels[idx].list.map(m => (
                                                            <div 
                                                                key={m} 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleUpdateEndpoint(idx, 'model', m);
                                                                    setOpenModelMenus(prev => ({ ...prev, [idx]: false }));
                                                                }}
                                                                style={{ padding: '8px 12px', fontSize: '12px', cursor: 'pointer', borderRadius: '4px', color: ep.model === m ? '#3b82f6' : '#ccc', background: 'transparent' }}
                                                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                                            >
                                                                {m}
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div style={{ padding: '20px 12px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>未拉取到模型或地址无效</div>
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); handleFetchModels(idx); }}
                                                                style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#aaa', cursor: 'pointer' }}
                                                            >
                                                                重试一次
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Key size={12} /> API Key {!ep.base_url.includes('localhost') && !ep.base_url.includes('127.0.0.1') && !ep.api_key && <span style={{ color: 'var(--color-warning)', fontWeight: 'bold', fontSize: '10px' }}>[建议NAS必填]</span>}
                                    </span>
                                    <input type="password" value={ep.api_key} onChange={(e) => handleUpdateEndpoint(idx, 'api_key', e.target.value)} style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px', width: '100%' }} placeholder="鉴权密钥" />
                                </div>
                                <button 
                                    onClick={() => handleTestEndpoint(idx)}
                                    disabled={verificationStatuses[idx]?.loading}
                                    style={{
                                        height: '34px', padding: '0 12px', borderRadius: '6px', border: '1px solid var(--color-border)', 
                                        background: 'var(--color-bg-base)', color: 'var(--color-text-main)', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', whiteSpace: 'nowrap'
                                    }}
                                >
                                    {verificationStatuses[idx]?.loading ? <Activity size={14} className="animate-spin" /> : <ShieldCheck size={14} color={verificationStatuses[idx]?.status === 'success' ? '#22c55e' : 'currentColor'} />}
                                    测试
                                </button>
                            </div>
                            {verificationStatuses[idx] && (
                                <div style={{ 
                                    fontSize: '11px', 
                                    padding: '6px 12px', 
                                    borderRadius: '4px',
                                    marginTop: '4px',
                                    background: verificationStatuses[idx].status === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                                    color: verificationStatuses[idx].status === 'success' ? '#22c55e' : '#ef4444',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    border: `1px solid ${verificationStatuses[idx].status === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`
                                }}>
                                    {verificationStatuses[idx].status === 'success' ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                                    {verificationStatuses[idx].msg}
                                </div>
                            )}
                        </Reorder.Item>
                    ))}
                    {endpoints.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-dim)', fontSize: '13.5px', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                            尚无任何 AI 节点配置，请手动新增
                        </div>
                    )}
                </Reorder.Group>
            </div>

            {/* Window Positioning Settings */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Monitor size={20} color="var(--color-primary)" /> 窗口展位与交互
                        </h3>
                        <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '14px' }}>统一管理灵思补全窗与妙笔助手窗的显示模式。</p>
                    </div>
                    <button 
                        onClick={() => handleToggleUnified(!appConfig?.is_window_config_unified)}
                        style={{
                            background: appConfig?.is_window_config_unified ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-surface-elevated)',
                            border: `1px solid ${appConfig?.is_window_config_unified ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                            color: appConfig?.is_window_config_unified ? '#22c55e' : 'var(--color-text-muted)',
                            padding: '10px 16px',
                            borderRadius: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            transition: 'all 0.2s'
                        }}
                    >
                        {appConfig?.is_window_config_unified ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                        {appConfig?.is_window_config_unified ? '配置统一管理: 已开启' : '配置统一管理: 已关闭'}
                    </button>
                </div>

                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr', 
                    gap: '20px', 
                    minHeight: '260px', // Fixed height for the content area to prevent layout shift
                }}>
                    {appConfig?.is_window_config_unified ? (
                        /* Unified Panel */
                        <div style={{ 
                            background: 'var(--color-surface-elevated)', 
                            padding: '24px', 
                            borderRadius: '12px', 
                            border: '1px solid var(--color-primary)', 
                            boxShadow: '0 4px 20px rgba(94, 106, 210, 0.1)',
                            height: '260px', // Lock height
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            boxSizing: 'border-box'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                                <div style={{ padding: '10px', background: 'rgba(94, 106, 210, 0.1)', borderRadius: '10px', color: 'var(--color-primary)' }}>
                                    <Box size={20} />
                                </div>
                                <div>
                                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>窗口统一配置 (灵思 + 妙笔)</h4>
                                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>所有窗口将共享相同的显示策略与偏移位置。</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg-base)', padding: '4px', borderRadius: '10px', border: '1px solid var(--color-border)', marginBottom: '20px' }}>
                                <button
                                    onClick={() => handleUpdateWindowValue('writer', 'pos_type', 0)}
                                    style={{
                                        flex: 1, padding: '10px', fontSize: '14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                        background: appConfig?.writer_window?.pos_type === 0 ? 'var(--color-primary)' : 'transparent',
                                        color: appConfig?.writer_window?.pos_type === 0 ? '#fff' : 'var(--color-text-muted)',
                                        transition: 'all 0.2s', fontWeight: 500
                                    }}
                                >
                                    自动跟随
                                </button>
                                <button
                                    onClick={() => handleUpdateWindowValue('writer', 'pos_type', 1)}
                                    style={{
                                        flex: 1, padding: '10px', fontSize: '14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                        background: appConfig?.writer_window?.pos_type === 1 ? 'var(--color-primary)' : 'transparent',
                                        color: appConfig?.writer_window?.pos_type === 1 ? '#fff' : 'var(--color-text-muted)',
                                        transition: 'all 0.2s', fontWeight: 500
                                    }}
                                >
                                    固定位置
                                </button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '6px', display: 'block' }}>全局水平偏移</label>
                                    <input
                                        type="number"
                                        value={appConfig?.writer_window?.offset_x || 0}
                                        onChange={(e) => handleUpdateWindowValue('writer', 'offset_x', parseInt(e.target.value) || 0)}
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '13px' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '6px', display: 'block' }}>全局垂直偏移</label>
                                    <input
                                        type="number"
                                        value={appConfig?.writer_window?.offset_y || 0}
                                        onChange={(e) => handleUpdateWindowValue('writer', 'offset_y', parseInt(e.target.value) || 0)}
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '13px' }}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
                            gap: '20px',
                            height: '260px' // Lock container height
                        }}>
                            {/* Hint Window */}
                            <div style={{ 
                                background: 'var(--color-surface-elevated)', 
                                padding: '24px', 
                                borderRadius: '12px', 
                                border: '1px solid var(--color-border)',
                                height: '100%', // Fill the 260px container
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                boxSizing: 'border-box',
                                transition: 'all 0.3s'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                    <div style={{ padding: '8px', background: 'rgba(94, 106, 210, 0.1)', borderRadius: '8px', color: 'var(--color-primary)' }}>
                                        <AlertCircle size={18} />
                                    </div>
                                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>灵思补全 (FlowMind)</h4>
                                </div>
                                <div>
                                    <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg-base)', padding: '4px', borderRadius: '10px', border: '1px solid var(--color-border)', marginBottom: '12px' }}>
                                        <button
                                            onClick={() => handleUpdateWindowValue('hint', 'pos_type', 0)}
                                            style={{
                                                flex: 1, padding: '8px', fontSize: '13px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                                background: appConfig?.hint_window?.pos_type === 0 ? 'var(--color-primary)' : 'transparent',
                                                color: appConfig?.hint_window?.pos_type === 0 ? '#fff' : 'var(--color-text-muted)',
                                                transition: 'all 0.2s', fontWeight: 500
                                            }}
                                        >
                                            自动跟随
                                        </button>
                                        <button
                                            onClick={() => handleUpdateWindowValue('hint', 'pos_type', 1)}
                                            style={{
                                                flex: 1, padding: '8px', fontSize: '13px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                                background: appConfig?.hint_window?.pos_type === 1 ? 'var(--color-primary)' : 'transparent',
                                                color: appConfig?.hint_window?.pos_type === 1 ? '#fff' : 'var(--color-text-muted)',
                                                transition: 'all 0.2s', fontWeight: 500
                                            }}
                                        >
                                            固定位置
                                        </button>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                        <div>
                                            <label style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'block' }}>水平偏移</label>
                                            <input
                                                type="number"
                                                value={appConfig?.hint_window?.offset_x || 0}
                                                onChange={(e) => handleUpdateWindowValue('hint', 'offset_x', parseInt(e.target.value) || 0)}
                                                style={{ width: '100%', padding: '6px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'block' }}>垂直偏移</label>
                                            <input
                                                type="number"
                                                value={appConfig?.hint_window?.offset_y || 0}
                                                onChange={(e) => handleUpdateWindowValue('hint', 'offset_y', parseInt(e.target.value) || 0)}
                                                style={{ width: '100%', padding: '6px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Writer Window */}
                            <div style={{ 
                                background: 'var(--color-surface-elevated)', 
                                padding: '24px', 
                                borderRadius: '12px', 
                                border: '1px solid var(--color-border)',
                                height: '100%', // Fill the 260px container
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                boxSizing: 'border-box',
                                transition: 'all 0.3s'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                    <div style={{ padding: '8px', background: 'rgba(94, 106, 210, 0.1)', borderRadius: '8px', color: 'var(--color-primary)' }}>
                                        <Monitor size={18} />
                                    </div>
                                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>妙笔助手 (FlowWriter)</h4>
                                </div>
                                <div>
                                    <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg-base)', padding: '4px', borderRadius: '10px', border: '1px solid var(--color-border)', marginBottom: '12px' }}>
                                        <button
                                            onClick={() => handleUpdateWindowValue('writer', 'pos_type', 0)}
                                            style={{
                                                flex: 1, padding: '8px', fontSize: '13px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                                background: appConfig?.writer_window?.pos_type === 0 ? 'var(--color-primary)' : 'transparent',
                                                color: appConfig?.writer_window?.pos_type === 0 ? '#fff' : 'var(--color-text-muted)',
                                                transition: 'all 0.2s', fontWeight: 500
                                            }}
                                        >
                                            自动跟随
                                        </button>
                                        <button
                                            onClick={() => handleUpdateWindowValue('writer', 'pos_type', 1)}
                                            style={{
                                                flex: 1, padding: '8px', fontSize: '13px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                                background: appConfig?.writer_window?.pos_type === 1 ? 'var(--color-primary)' : 'transparent',
                                                color: appConfig?.writer_window?.pos_type === 1 ? '#fff' : 'var(--color-text-muted)',
                                                transition: 'all 0.2s', fontWeight: 500
                                            }}
                                        >
                                            固定位置
                                        </button>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                        <div>
                                            <label style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'block' }}>水平偏移</label>
                                            <input
                                                type="number"
                                                value={appConfig?.writer_window?.offset_x || 0}
                                                onChange={(e) => handleUpdateWindowValue('writer', 'offset_x', parseInt(e.target.value) || 0)}
                                                style={{ width: '100%', padding: '6px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'block' }}>垂直偏移</label>
                                            <input
                                                type="number"
                                                value={appConfig?.writer_window?.offset_y || 0}
                                                onChange={(e) => handleUpdateWindowValue('writer', 'offset_y', parseInt(e.target.value) || 0)}
                                                style={{ width: '100%', padding: '6px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '12px' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
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
