import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Palette, Monitor, Laptop, Zap, CheckCircle2, Languages, Save, UploadCloud, DownloadCloud, ServerCog, AlertTriangle, AlertCircle, BrainCircuit, Plus, Trash2, Key, Link2, Box } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

export default function Settings() {
    const { t, i18n } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState("dark");
    const [currentLang, setCurrentLang] = useState(i18n.language || "zh");

    const [endpoints, setEndpoints] = useState<any[]>([]);

    useEffect(() => {
        const theme = localStorage.getItem('yiboflow_theme') || 'dark';
        setCurrentTheme(theme);

        invoke("get_app_config").then((cfg: any) => {
            if (cfg && cfg.ai_engine && cfg.ai_engine.endpoints) {
                setEndpoints(cfg.ai_engine.endpoints);
            }
        }).catch(console.error);
    }, []);

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
            model: "qwen3:0.6b",
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
    };

    const handleLangChange = (langId: string) => {
        setCurrentLang(langId);
        i18n.changeLanguage(langId);
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
                        <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '14px' }}>动态路由多个模型节点，优先调用高优先级且就绪的节点。</p>
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
                    <option value="qwen3:0.6b">qwen3:0.6b (本地极速)</option>
                    <option value="gemma3:270m">gemma3:270m (本地极速)</option>
                    <option value="deepseek-chat">deepseek-chat</option>
                    <option value="deepseek-reasoner">deepseek-reasoner</option>
                </datalist>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {endpoints.map((ep, idx) => (
                        <div key={idx} style={{
                            background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px',
                            opacity: ep.is_enabled ? 1 : 0.6
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                                        <input type="checkbox" checked={ep.is_enabled} onChange={(e) => handleUpdateEndpoint(idx, 'is_enabled', e.target.checked)} />
                                        节点 {idx + 1}
                                    </label>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-dim)', background: 'var(--color-bg-base)', padding: '2px 8px', borderRadius: '100px', border: '1px solid var(--color-border)' }}>
                                        优先级: <input type="number" value={ep.priority} onChange={(e) => handleUpdateEndpoint(idx, 'priority', parseInt(e.target.value) || 0)} style={{ width: '40px', background: 'transparent', border: 'none', color: 'inherit', textAlign: 'center' }} />
                                    </span>
                                </div>
                                <button onClick={() => handleRemoveEndpoint(idx)} className="btn-ghost" style={{ padding: '4px', color: 'var(--color-danger)', opacity: 0.8 }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Link2 size={12} /> 接口地址 (Base URL)</span>
                                    <input list="preset_base_urls" value={ep.base_url} onChange={(e) => handleUpdateEndpoint(idx, 'base_url', e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '13px' }} placeholder="如 http://localhost:11434/v1" />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Box size={12} /> 模型名称 (Model)</span>
                                    <input list="preset_models" value={ep.model} onChange={(e) => handleUpdateEndpoint(idx, 'model', e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '13px' }} placeholder="如 qwen3:0.6b" />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Key size={12} /> API Key (可选)</span>
                                    <input type="password" value={ep.api_key} onChange={(e) => handleUpdateEndpoint(idx, 'api_key', e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontSize: '13px' }} placeholder="默认不需要" />
                                </div>
                            </div>
                        </div>
                    ))}
                    {endpoints.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-dim)', fontSize: '13.5px', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                            尚无任何 AI 节点配置，请手动新增
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
