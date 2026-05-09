import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Palette, Monitor, Laptop, Zap, CheckCircle2, Save, UploadCloud, AlertTriangle, AlertCircle, ToggleRight, ToggleLeft, RefreshCw, HardDrive, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { formatOperationError } from "../utils/errorDisplay";

export default function Settings() {
    const { t, i18n } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState("dark");
    const [currentLang, setCurrentLang] = useState(i18n.language || "zh");

    const [appConfig, setAppConfig] = useState<any>(null);
    const [isAutostartEnabled, setIsAutostartEnabled] = useState(false);
    const [appVersion, setAppVersion] = useState("");
    const [debugMode, setDebugMode] = useState(false);


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
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_REMOTE_ACCOUNT_REQUIRED", "settings.error_remote_account_required"),
                type: 'error'
            });
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
                    setAlertDialog({
                        isOpen: true,
                        message: formatOperationError(t, "SETTINGS_VAULT_ACTION_FAILED", "settings.error_vault_action_failed", { detail: String(e) }),
                        type: 'error'
                    });
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
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_EXPORT_FAILED", "settings.error_export_failed", { detail: String(e) }),
                type: 'error'
            });
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
                            setAlertDialog({
                                isOpen: true,
                                message: formatOperationError(t, "SETTINGS_IMPORT_FAILED", "settings.error_import_failed", { detail: String(err) }),
                                type: 'error'
                            });
                        }
                    }
                });
            }
        } catch (e) {
            console.error(e);
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_OPEN_FILE_FAILED", "settings.error_open_file_failed", { detail: String(e) }),
                type: 'error'
            });
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
    const [imageTransportFormat, setImageTransportFormat] = useState("png");
    const [flowprobeBackupKeys, setFlowprobeBackupKeys] = useState(false);
    const cacheUsageRatio = cacheStats?.max_size_mb ? cacheStats.total_size_mb / cacheStats.max_size_mb : 0;
    const cacheOverLimit = Boolean(cacheStats && cacheStats.total_size_mb > cacheStats.max_size_mb);
    const cacheUsageTone = cacheOverLimit ? 'var(--color-danger)' : (cacheUsageRatio >= 0.85 ? 'var(--color-warning)' : 'var(--color-primary)');

    const fetchRuntimeSettings = () => {
        invoke("get_settings").then((settings: any) => {
            if (settings?.image_transport_format) {
                setImageTransportFormat(settings.image_transport_format);
            }
            setDebugMode(!!settings?.debug_mode);
            setFlowprobeBackupKeys(!!settings?.flowprobe_backup_keys);
        }).catch(console.error);
    };

    const fetchCacheStats = () => {
        invoke("get_cache_stats").then((stats: any) => {
            setCacheStats(stats);
            setCacheMaxSize(stats.max_size_mb);
        }).catch(console.error);
    };

    useEffect(() => {
        fetchCacheStats();
        fetchRuntimeSettings();
    }, []);

    const persistImageTransportFormat = async (nextFormat: string) => {
        try {
            const settings: any = await invoke("get_settings");
            await invoke("update_settings", {
                isSyncEnabled: settings.is_sync_enabled,
                flowhintMinChars: settings.flowhint_min_chars,
                flowhintAcceptTab: settings.flowhint_accept_tab,
                flowhintAcceptRight: settings.flowhint_accept_right,
                debugMode: !!settings.debug_mode,
                imageTransportFormat: nextFormat,
                flowprobeBackupKeys: !!settings.flowprobe_backup_keys,
            });
            setImageTransportFormat(nextFormat);
            setAlertDialog({ isOpen: true, message: "图片传输格式已更新。新复制的图片会按新格式同步。", type: 'success' });
        } catch (e) {
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_IMAGE_TRANSPORT_FORMAT_FAILED", "settings.error_image_transport_format_failed", { detail: String(e) }),
                type: 'error'
            });
        }
    };

    const toggleDebugMode = async () => {
        const next = !debugMode;
        try {
            const settings: any = await invoke("get_settings");
            await invoke("update_settings", {
                isSyncEnabled: settings.is_sync_enabled,
                flowhintMinChars: settings.flowhint_min_chars,
                flowhintAcceptTab: settings.flowhint_accept_tab,
                flowhintAcceptRight: settings.flowhint_accept_right,
                debugMode: next,
                imageTransportFormat: settings.image_transport_format || "png",
                flowprobeBackupKeys: !!settings.flowprobe_backup_keys,
            });
            setDebugMode(next);
        } catch (e) {
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_DEBUG_MODE_FAILED", "settings.error_debug_mode_failed", { detail: String(e) }),
                type: 'error'
            });
        }
    };

    const toggleFlowprobeBackupKeys = async () => {
        const next = !flowprobeBackupKeys;
        try {
            const settings: any = await invoke("get_settings");
            await invoke("update_settings", {
                isSyncEnabled: settings.is_sync_enabled,
                flowhintMinChars: settings.flowhint_min_chars,
                flowhintAcceptTab: settings.flowhint_accept_tab,
                flowhintAcceptRight: settings.flowhint_accept_right,
                debugMode: !!settings.debug_mode,
                imageTransportFormat: settings.image_transport_format || "png",
                flowprobeBackupKeys: next,
            });
            setFlowprobeBackupKeys(next);
            setAlertDialog({
                isOpen: true,
                message: next
                    ? "FlowProbe Key 将以加密形式随备份导出。"
                    : "FlowProbe Key 仅保留在本机，不再随备份导出。",
                type: 'success'
            });
        } catch (e) {
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_FLOWPROBE_BACKUP_FAILED", "settings.error_flowprobe_backup_failed", { detail: String(e) }),
                type: 'error'
            });
        }
    };

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
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_CACHE_DIR_CHANGE_FAILED", "settings.error_cache_dir_change_failed", { detail: String(e) }),
                type: 'error'
            });
        }
    };

    const handleCacheMaxSizeChange = async (mb: number) => {
        try {
            await invoke("set_cache_max_size", { mb });
            setCacheMaxSize(mb);
            fetchCacheStats();
        } catch (e) {
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_CACHE_MAX_SIZE_FAILED", "settings.error_cache_max_size_failed", { detail: String(e) }),
                type: 'error'
            });
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
            setAlertDialog({
                isOpen: true,
                message: formatOperationError(t, "SETTINGS_AUTOSTART_FAILED", "settings.error_autostart_failed", { detail: String(e) }),
                type: 'error'
            });
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

            <div className="glass-panel" style={{ padding: '18px 24px', borderRadius: 'var(--radius-lg)', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                            {t('settings.debug_mode_title')}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px', lineHeight: 1.6, maxWidth: '680px' }}>
                            {t('settings.debug_mode_desc')}
                        </div>
                    </div>
                    <button
                        onClick={toggleDebugMode}
                        style={{
                            background: debugMode ? 'rgba(245, 158, 11, 0.14)' : 'var(--color-surface-elevated)',
                            border: `1px solid ${debugMode ? 'rgba(245, 158, 11, 0.35)' : 'var(--color-border)'}`,
                            color: debugMode ? '#f59e0b' : 'var(--color-text-muted)',
                            padding: '9px 18px',
                            borderRadius: '100px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '13px',
                            transition: 'all 0.2s'
                        }}
                    >
                        {debugMode ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        {debugMode ? t('settings.debug_mode_on') : t('settings.debug_mode_off')}
                    </button>
                </div>
            </div>

            {/* Clipboard History Cache */}
            <div className="glass-panel" style={{ padding: '18px 24px', borderRadius: 'var(--radius-lg)', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '18px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <HardDrive size={16} color="var(--color-primary)" />
                        <div>
                            <div style={{ fontSize: '14px', fontWeight: 600 }}>剪贴板历史缓存</div>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginTop: '4px' }}>
                                自动保留最近活动；超出上限后会按未固定条目的最早记录开始清理。
                            </div>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', alignItems: 'stretch' }}>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        padding: '14px 16px',
                        borderRadius: '14px',
                        background: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-glass-border)',
                        minWidth: 0,
                        minHeight: '168px'
                    }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)' }}>缓存目录</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <FolderOpen size={14} color="var(--color-text-muted)" />
                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                                {cacheStats?.cache_dir || '...'}
                            </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
                            迁移后会沿用现有数据库和缓存文件。
                        </div>
                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={handleCacheDirChange}
                                className="btn-ghost"
                                style={{ padding: '6px 12px', fontSize: '11px', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                            >
                                更改目录
                            </button>
                        </div>
                    </div>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        padding: '14px 16px',
                        borderRadius: '14px',
                        background: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-glass-border)',
                        minWidth: 0,
                        minHeight: '168px'
                    }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)' }}>图片传输格式</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {[
                                { value: 'png', label: 'PNG 无损' },
                                { value: 'webp_lossless', label: 'WebP 无损' },
                                { value: 'jpeg', label: 'JPEG 有损' },
                            ].map((option) => {
                                const active = imageTransportFormat === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        onClick={() => void persistImageTransportFormat(option.value)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '999px',
                                            fontSize: '11px',
                                            fontWeight: active ? 600 : 500,
                                            background: active ? 'var(--color-primary-glow)' : 'transparent',
                                            color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                            border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
                            PNG 最稳，WebP 更省流量，JPEG 最小但会损失画质。
                        </div>
                    </div>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        padding: '14px 16px',
                        borderRadius: '14px',
                        background: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-glass-border)',
                        minWidth: 0,
                        minHeight: '168px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)' }}>空间上限</div>
                                <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginTop: '4px', lineHeight: 1.5 }}>
                                    达到上限后自动按未固定条目的最早记录回收。
                                </div>
                            </div>
                            {cacheStats && (
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600, color: cacheUsageTone }}>
                                        {cacheStats.total_entries} 条 · {cacheStats.total_size_mb} MB / {cacheStats.max_size_mb} MB
                                    </div>
                                    {cacheOverLimit && (
                                        <div style={{ fontSize: '11px', color: 'var(--color-danger)', marginTop: '4px' }}>
                                            当前已超上限
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div style={{
                            width: '100%',
                            height: '8px',
                            borderRadius: '999px',
                            background: 'var(--color-bg-base)',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                width: `${Math.min(cacheUsageRatio * 100, 100)}%`,
                                height: '100%',
                                borderRadius: '999px',
                                background: cacheUsageTone,
                                transition: 'width 0.2s ease'
                            }} />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {[100, 200, 500, 1000].map(mb => (
                                <button
                                    key={mb}
                                    onClick={() => handleCacheMaxSizeChange(mb)}
                                    style={{
                                        padding: '5px 12px',
                                        borderRadius: '999px',
                                        fontSize: '11px',
                                        fontWeight: cacheMaxSize === mb ? 600 : 500,
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
                        <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', lineHeight: 1.5, marginTop: 'auto' }}>
                            修改上限会立即触发一次回收检查，新写入条目也会继续自动检查。
                        </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: '280px', flex: '1 1 320px' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                            {t('settings.backup_title')}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px', lineHeight: 1.6, maxWidth: '640px' }}>
                            {t('settings.backup_desc')}
                        </div>
                        <div style={{
                            marginTop: '16px',
                            padding: '14px 16px',
                            borderRadius: '14px',
                            background: 'var(--color-surface-elevated)',
                            border: '1px solid var(--color-glass-border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '16px',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    {t('settings.flowprobe_backup_title')}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginTop: '6px', lineHeight: 1.55 }}>
                                    {t('settings.flowprobe_backup_desc')}
                                </div>
                            </div>
                            <button
                                onClick={toggleFlowprobeBackupKeys}
                                style={{
                                    background: flowprobeBackupKeys ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-surface-elevated)',
                                    border: `1px solid ${flowprobeBackupKeys ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                                    color: flowprobeBackupKeys ? '#22c55e' : 'var(--color-text-muted)',
                                    padding: '8px 18px',
                                    borderRadius: '100px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {flowprobeBackupKeys ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                                {flowprobeBackupKeys ? t('settings.flowprobe_backup_on') : t('settings.flowprobe_backup_off')}
                            </button>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
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
            </div>

            {/* Advanced Vault Sync Manager */}
            {debugMode && (
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
            )}

            {/* Device Identity & Collision Management */}
            {debugMode && (
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
                                        setAlertDialog({
                                            isOpen: true,
                                            message: formatOperationError(t, "SETTINGS_DEVICE_FINGERPRINT_RESET_FAILED", "settings.error_device_fingerprint_reset_failed", { detail: String(e) }),
                                            type: 'error'
                                        });
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
            )}

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
