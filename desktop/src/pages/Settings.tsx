import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Palette, Monitor, Laptop, Zap, CheckCircle2, Languages, Save, UploadCloud, DownloadCloud } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

export default function Settings() {
    const { t, i18n } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState("dark");
    const [currentLang, setCurrentLang] = useState(i18n.language || "zh");

    useEffect(() => {
        const theme = localStorage.getItem('yiboflow_theme') || 'dark';
        setCurrentTheme(theme);
    }, []);

    const handleExport = async () => {
        try {
            const destPath = await save({
                title: "导出 YiboFlow 配置",
                filters: [{ name: "YiboFlow Backup", extensions: ["ybflow"] }]
            });
            if (destPath) {
                await invoke("export_config", { destPath });
                alert("导出成功！");
            }
        } catch (e) {
            console.error(e);
            alert("导出失败: " + e);
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
                if (window.confirm("导入配置将覆盖现有设置，是否继续？")) {
                    await invoke("import_config", { srcPath });
                    alert("导入成功！");
                    window.location.reload();
                }
            }
        } catch (e) {
            console.error(e);
            alert("导入失败: " + e);
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

        </div>
    );
}
