import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Palette, Monitor, Laptop, Zap, CheckCircle2, Save, UploadCloud, AlertTriangle, AlertCircle, ToggleRight, ToggleLeft, RefreshCw, HardDrive, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

export default function Settings() {
    const { t, i18n } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState("dark");
    const [currentLang, setCurrentLang] = useState(i18n.language || "zh");

    const [appConfig, setAppConfig] = useState<any>(null);
    const [isAutostartEnabled, setIsAutostartEnabled] = useState(false);
    const [appVersion, setAppVersion] = useState("");


    const fetchConfig = () => {
        invoke("get_app_config").then((cfg: any) => {
            if (cfg) setAppConfig(cfg);
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

    const [cacheStats, setCacheStats] = useState<any>(null);
    const [cacheMaxSize, setCacheMaxSize] = useState(200);

    const fetchCacheStats = () => {
        invoke("get_cache_stats").then((stats: any) => {
            setCacheStats(stats);
            setCacheMaxSize(stats.max_size_mb);
        }).catch(console.error);
    };

    useEffect(() => { fetchCacheStats(); }, []);

    const handleCacheDirChange = async () => {
        try {
            const selected = await open({
                title: "选择缓存目录",
                directory: true,
                multiple: false,
            });
            if (selected && typeof selected === "string") {
                await invoke("set_cache_dir", { path: selected });
                fetchCacheStats();
                setAlertDialog({ isOpen: true, message: "缓存目录已迁移！", type: 'success' });
            }
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "迁移失败: " + String(e), type: 'error' });
        }
    };

    const handleCacheMaxSizeChange = async (mb: number) => {
        try {
            await invoke("set_cache_max_size", { mb });
            setCacheMaxSize(mb);
            fetchCacheStats();
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "设置失败: " + String(e), type: 'error' });
        }
    };

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
        <div style={{ width: '100%', paddingBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                        <Palette size={22} color="var(--color-primary)" />
                        {t('settings.title')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '6px' }}>{t('settings.subtitle')}</p>
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

            {/* Language & Autostart */}
            <div className="glass-panel" style={{ padding: '18px 24px', borderRadius: 'var(--radius-lg)', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
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
                                            padding: '8px 20px',
                                            borderRadius: '100px',
                                            cursor: 'pointer',
                                            fontWeight: 600,
                                            fontSize: '13px',
                                            transition: 'all 0.2s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px'
                                        }}
                                    >
                                        {isActive && <CheckCircle2 size={14} />}
                                        {lang.name}
                                    </button>
                                );
                            })}
                        </div>

                        <div style={{ width: '1px', height: '32px', background: 'var(--color-border)' }} />

                        <button 
                            onClick={toggleAutostart}
                            style={{
                                background: isAutostartEnabled ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-surface-elevated)',
                                border: `1px solid ${isAutostartEnabled ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                                color: isAutostartEnabled ? '#22c55e' : 'var(--color-text-muted)',
                                padding: '8px 18px',
                                borderRadius: '100px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '13px',
                                transition: 'all 0.2s'
                            }}
                        >
                            {isAutostartEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                            {isAutostartEnabled ? '开机自启: 已开启' : '开机自启: 已关闭'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Clipboard History Cache */}
            <div className="glass-panel" style={{ padding: '18px 24px', borderRadius: 'var(--radius-lg)', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <HardDrive size={16} color="var(--color-primary)" />
                    <span style={{ fontSize: '14px', fontWeight: 600 }}>剪贴板历史缓存</span>
                    {cacheStats && (
                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                            {cacheStats.total_entries} 条 · {cacheStats.total_size_mb} MB / {cacheStats.max_size_mb} MB
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
                        <FolderOpen size={14} color="var(--color-text-muted)" />
                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {cacheStats?.cache_dir || '...'}
                        </span>
                        <button
                            onClick={handleCacheDirChange}
                            className="btn-ghost"
                            style={{ padding: '4px 10px', fontSize: '11px', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                        >
                            更改目录
                        </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>空间上限：</span>
                        {[100, 200, 500, 1000].map(mb => (
                            <button
                                key={mb}
                                onClick={() => handleCacheMaxSizeChange(mb)}
                                style={{
                                    padding: '3px 10px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    fontWeight: cacheMaxSize === mb ? 600 : 400,
                                    background: cacheMaxSize === mb ? 'var(--color-primary-glow)' : 'transparent',
                                    color: cacheMaxSize === mb ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                    border: cacheMaxSize === mb ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {mb >= 1000 ? `${mb / 1000}G` : `${mb}M`}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Theme Selector */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}>
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


            {/* Backup & Restore */}
            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', marginTop: '32px' }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '14px' }}>
                            设备指纹: <code style={{ background: 'var(--color-bg-base)', padding: '2px 6px', borderRadius: '4px', color: 'var(--color-primary)', fontSize: '12px' }}>{appConfig?.device_fingerprint || '获取中...'}</code>
                        </p>
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
