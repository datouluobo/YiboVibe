import { useTranslation } from "react-i18next";
import { Sparkles, ToggleRight, ToggleLeft, Edit, Trash2, Plus, X, Save, Eye, AlertCircle, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { CustomSelect } from "../components/CustomSelect";

interface SmartEntry {
    trigger_key: string | null;
    keyword: string | null;
    content: string;
}

interface SmartDictionary {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    min_trigger_chars: number;
    entries: SmartEntry[];
    dict_type: "builtin" | "custom";
}

export default function FlowMind() {
    const { t } = useTranslation();
    const [engineOn, setEngineOn] = useState(false);
    const [minChars, setMinChars] = useState(2);
    const [acceptKey, setAcceptKey] = useState(9);
    const [dicts, setDicts] = useState<SmartDictionary[]>([]);
    const [diagReport, setDiagReport] = useState("");

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDict, setEditingDict] = useState<SmartDictionary | null>(null);
    const [isReadOnly, setIsReadOnly] = useState(false);

    const [conflictWarning, setConflictWarning] = useState<string>("");

    // Custom confirm dialog for delete
    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, targetId: string | null }>({ isOpen: false, targetId: null });

    const TRIGGER_OPTIONS = [
        { val: "", label: "无" },
        { val: "/", label: "/ (斜杠)" },
        { val: ";", label: "; (分号)" },
        { val: ",", label: ", (逗号)" },
        { val: ".", label: ". (句号)" },
        { val: "'", label: "' (单引号)" },
        { val: "`", label: "` (反引号)" },
        { val: "[", label: "[ (左方括号)" },
        { val: "]", label: "] (右方括号)" },
        { val: "=", label: "= (等号)" },
        { val: "-", label: "- (减号)" },
    ];

    const ALL_KEYS = [
        { val: 9, label: "Tab 键" },
        { val: 13, label: "Enter (回车键)" },
        { val: 32, label: "Space (空格键)" },
        { val: 37, label: "Left (左方向键)" },
        { val: 38, label: "Up (上方向键)" },
        { val: 39, label: "Right (右方向键)" },
        { val: 40, label: "Down (下方向键)" },
        { val: 112, label: "F1 键" }, { val: 113, label: "F2 键" }, { val: 114, label: "F3 键" },
        { val: 115, label: "F4 键" }, { val: 116, label: "F5 键" }, { val: 117, label: "F6 键" },
        { val: 118, label: "F7 键" }, { val: 119, label: "F8 键" }, { val: 120, label: "F9 键" },
        { val: 121, label: "F10 键" }, { val: 122, label: "F11 键" }, { val: 123, label: "F12 键" },
        { val: 186, label: "; (分号键)", char: ";" }, { val: 187, label: "= (等号键)", char: "=" },
        { val: 188, label: ", (逗号键)", char: "," }, { val: 189, label: "- (减号键)", char: "-" },
        { val: 190, label: ". (句号键)", char: "." }, { val: 191, label: "/ (斜杠键)", char: "/" },
        { val: 192, label: "` (反引号键)", char: "`" }, { val: 219, label: "[ (左方括号)", char: "[" },
        { val: 220, label: "\\ (反斜杠)", char: "\\" }, { val: 221, label: "] (右方括号)", char: "]" },
        { val: 222, label: "' (单引号)", char: "'" }
    ];

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const settings: any = await invoke("get_settings");
            setEngineOn(settings.is_smartlib_enabled);
            setMinChars(settings.flowhint_min_chars);
            setAcceptKey(settings.flowhint_accept_key);

            const allDicts: SmartDictionary[] = await invoke("get_all_dictionaries");
            const processed = allDicts.map(d => ({
                ...d,
            }));

            // Find all conflict keys used in SmartDictionary (trigger keys)
            const usedPrefixes = new Set<string>();
            for (const d of processed) {
                if (d.dict_type !== 'builtin') {
                    for (const e of d.entries) {
                        if (e.trigger_key && e.trigger_key.length > 0) {
                            usedPrefixes.add(e.trigger_key[0]);
                        }
                    }
                }
            }

            const selectedKey = ALL_KEYS.find(k => k.val === settings.flowhint_accept_key);
            if (selectedKey && selectedKey.char && usedPrefixes.has(selectedKey.char)) {
                setConflictWarning(`⚠️ 提示：您选的按键「${selectedKey.char}」被当作替换词条触发键(Trigger Key)，可能导致冲突冲突。`);
            } else {
                setConflictWarning("");
            }

            processed.sort((a, b) => {
                if (a.dict_type === 'builtin' && b.dict_type === 'custom') return -1;
                if (a.dict_type === 'custom' && b.dict_type === 'builtin') return 1;
                return a.name.localeCompare(b.name);
            });

            setDicts(processed);
        } catch (e) {
            console.error("Failed to fetch dictionaries:", e);
        }
    };

    const toggleEngine = async () => {
        try {
            const settings: any = await invoke("get_settings");
            await invoke("update_settings", {
                isSmartlibEnabled: !engineOn,
                isSyncEnabled: settings.is_sync_enabled,
                isAutofillEnabled: settings.is_autofill_enabled,
                flowhintMinChars: settings.flowhint_min_chars,
                flowhintAcceptKey: settings.flowhint_accept_key,
            });
            setEngineOn(!engineOn);
        } catch (e) {
            console.error("Failed to toggle FlowMind engine:", e);
        }
    };

    const updateMinChars = async (val: number) => {
        setMinChars(val);
        try {
            const settings: any = await invoke("get_settings");
            await invoke("update_settings", {
                ...settings,
                isSmartlibEnabled: settings.is_smartlib_enabled,
                flowhintMinChars: val,
            });
        } catch (e) {
            console.error(e);
        }
    };

    const updateAcceptKey = async (val: number) => {
        setAcceptKey(val);
        try {
            const settings: any = await invoke("get_settings");
            await invoke("update_settings", {
                ...settings,
                isSmartlibEnabled: settings.is_smartlib_enabled,
                flowhintAcceptKey: val,
            });
            await loadData();
        } catch (e) {
            console.error(e);
        }
    };

    const runDiagnose = async () => {
        try {
            const report: string = await invoke("diagnose_flowhint");
            setDiagReport(report);
        } catch (e) {
            setDiagReport("Error: " + String(e));
        }
    };

    const openCreateModal = () => {
        setEditingDict({
            id: "custom_" + Date.now(),
            name: "新词库",
            description: "",
            version: "1.0",
            author: "User",
            min_trigger_chars: 2,
            entries: [],
            dict_type: "custom",
        });
        setIsReadOnly(false);
        setIsModalOpen(true);
    };

    const openEditModal = (dict: SmartDictionary, readOnly: boolean) => {
        setEditingDict(JSON.parse(JSON.stringify(dict)));
        setIsReadOnly(readOnly);
        setIsModalOpen(true);
    };

    const handleDelete = (id: string) => {
        setConfirmDialog({ isOpen: true, targetId: id });
    };

    const confirmDelete = async () => {
        const id = confirmDialog.targetId;
        setConfirmDialog({ isOpen: false, targetId: null });
        if (!id) return;
        try {
            await invoke("delete_dictionary", { id });
            await loadData();
        } catch (e) {
            await message("删除失败: " + e, { kind: 'error' });
        }
    };

    const handleSaveDict = async () => {
        if (!editingDict) return;
        try {
            if (!editingDict.name.trim()) {
                await message("请输入词库名称", { kind: 'warning' });
                return;
            }
            for (const e of editingDict.entries) {
                if (!e.content.trim()) {
                    await message("词条内容不能为空", { kind: 'warning' });
                    return;
                }
            }
            await invoke("save_dictionary", { dict: editingDict });
            setIsModalOpen(false);
            await loadData();
        } catch (e) {
            await message("保存失败: " + e, { kind: 'error' });
        }
    };

    return (
        <div style={{ animation: 'fadeIn 0.4s ease-out', maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>
                        <Sparkles size={22} color="var(--color-primary)" style={{ verticalAlign: 'middle', marginRight: '10px' }} />
                        {t('nav.flowmind', 'FlowMind · 灵思')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                        {t('nav.tooltip_flowmind', '统一智能输入引擎，前缀展开与智能词库补全')}
                    </p>
                </div>

                <button
                    onClick={toggleEngine}
                    style={{
                        background: engineOn ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-surface-elevated)',
                        border: `1px solid ${engineOn ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                        color: engineOn ? '#22c55e' : 'var(--color-text-muted)',
                        padding: '10px 16px',
                        borderRadius: '100px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        transition: 'all var(--transition-fast)'
                    }}
                >
                    {engineOn ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    {engineOn ? '全局引擎: 已开启' : '全局引擎: 已关闭'}
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div className="glass-panel" style={{ padding: '16px 20px', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0', color: 'var(--color-text-main)' }}>
                            词库触发最小字数
                        </h3>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
                            输入达到多少字母后才开始前缀候选。
                        </p>
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: '16px' }}>
                        <input
                            type="number"
                            min={1}
                            max={10}
                            value={minChars}
                            onChange={(e) => updateMinChars(parseInt(e.target.value) || 2)}
                            className="modern-input"
                            style={{ width: '80px', textAlign: 'center' }}
                        />
                    </div>
                </div>

                <div className="glass-panel" style={{ padding: '16px 20px', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0', color: 'var(--color-text-main)' }}>
                            候选词上屏快捷键
                        </h3>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
                            选中候选词进行智能补全时的快捷按键。
                        </p>
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: '16px', width: '160px' }}>
                        <CustomSelect
                            options={ALL_KEYS}
                            value={acceptKey}
                            onChange={(val) => updateAcceptKey(val)}
                        />
                    </div>
                </div>
            </div>

            {conflictWarning && (
                <div style={{
                    padding: '12px 16px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '13px',
                    fontWeight: 500
                }}>
                    <AlertCircle size={18} />
                    {conflictWarning}
                </div>
            )}

            <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={18} color="var(--color-text-muted)" />
                        智能输入词库
                    </h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', background: 'var(--color-surface)', padding: '4px 10px', borderRadius: '100px', border: '1px solid var(--color-border)' }}>
                            {dicts.length} 个词库
                        </span>
                        <button onClick={openCreateModal} className="btn-ghost" style={{ padding: '5px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--color-surface-elevated)' }}>
                            <Plus size={13} />新建词库
                        </button>
                    </div>
                </div>

                <div style={{ padding: '12px' }}>
                    {dicts.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无词库</div>}
                    {dicts.map(d => (
                        <div key={d.id} className="dict-row" style={{
                            padding: '16px',
                            display: 'flex', alignItems: 'center', gap: '12px',
                            borderBottom: '1px solid var(--color-glass-border)',
                            transition: 'background 0.2s',
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-elevated)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {d.name}
                                    <span style={{
                                        fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                                        background: d.dict_type === 'builtin' ? 'rgba(94, 106, 210, 0.15)' : 'rgba(130,201,30,0.15)',
                                        color: d.dict_type === 'builtin' ? 'var(--color-primary)' : '#82c91e',
                                        fontWeight: 500
                                    }}>
                                        {d.dict_type === 'builtin' ? '内置' : '自定义'}
                                    </span>
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                    {d.entries.length} 组词条 · {d.description}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '8px' }}>
                                {d.dict_type === 'builtin' ? (
                                    <button onClick={() => openEditModal(d, true)} className="btn-ghost" style={{ padding: '6px' }} title="查看">
                                        <Eye size={16} />
                                    </button>
                                ) : (
                                    <>
                                        <button onClick={() => openEditModal(d, false)} className="btn-ghost" style={{ padding: '6px' }} title="编辑">
                                            <Edit size={16} />
                                        </button>
                                        <button onClick={() => handleDelete(d.id)} className="btn-ghost" style={{ padding: '6px', color: '#ef4444' }} title="删除">
                                            <Trash2 size={16} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '20px', marginTop: '20px', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>🔍 引擎诊断</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={async () => { try { await invoke("dismiss_hint_window"); } catch { } }} className="btn-ghost" style={{ padding: '6px 16px', fontSize: '12px', color: '#ef4444' }}>
                            关闭候选窗
                        </button>
                        <button onClick={runDiagnose} className="btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }}>
                            运行诊断
                        </button>
                    </div>
                </div>
                {diagReport && (
                    <pre style={{
                        background: 'var(--color-surface)',
                        padding: '12px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontFamily: 'Consolas, monospace',
                        whiteSpace: 'pre-wrap',
                        color: 'var(--color-text-main)',
                        border: '1px solid var(--color-border)',
                        maxHeight: '300px',
                        overflow: 'auto',
                    }}>
                        {diagReport}
                    </pre>
                )}
            </div>

            {isModalOpen && editingDict && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 999
                }}>
                    <div className="glass-panel" style={{
                        width: '90%', maxWidth: '800px', maxHeight: '85vh',
                        display: 'flex', flexDirection: 'column', background: 'var(--color-bg-base)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {isReadOnly ? <Eye size={20} /> : <Edit size={20} />}
                                {isReadOnly ? '查看词库' : '编辑智能词库'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="btn-ghost" style={{ padding: '4px' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>词库名称</label>
                                    <input className="modern-input" value={editingDict.name} readOnly={isReadOnly}
                                        onChange={e => setEditingDict({ ...editingDict, name: e.target.value })} />
                                </div>
                                <div style={{ width: '100px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>最少触发</label>
                                    <input className="modern-input" type="number" value={editingDict.min_trigger_chars} readOnly={isReadOnly}
                                        onChange={e => setEditingDict({ ...editingDict, min_trigger_chars: parseInt(e.target.value) || 2 })} />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>说明描述</label>
                                <input className="modern-input" value={editingDict.description} readOnly={isReadOnly}
                                    onChange={e => setEditingDict({ ...editingDict, description: e.target.value })} />
                            </div>

                            <div style={{ marginTop: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <h4 style={{ margin: 0, fontSize: '14px' }}>词条配置 ({editingDict.entries.length})</h4>
                                    {!isReadOnly && (
                                        <button onClick={() => setEditingDict({ ...editingDict, entries: [{ trigger_key: '', keyword: '', content: '' }, ...editingDict.entries] })}
                                            className="btn-ghost" style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Plus size={14} /> 新增词条
                                        </button>
                                    )}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {editingDict.entries.map((entry, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '8px', background: 'var(--color-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            <div style={{ width: '135px' }}>
                                                {isReadOnly ? (
                                                    <input className="modern-input" placeholder="触发键 (可选)"
                                                        value={entry.trigger_key || ''} readOnly={true}
                                                        style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px' }} />
                                                ) : (
                                                    <CustomSelect
                                                        options={TRIGGER_OPTIONS}
                                                        value={entry.trigger_key || ''}
                                                        placeholder="选择触发键"
                                                        triggerStyle={{ padding: '0 12px', height: '34px', fontSize: '12px' }}
                                                        style={{ fontSize: '12px' }}
                                                        onChange={val => {
                                                            const newEntries = [...editingDict.entries];
                                                            const newTrigger = val === '' ? null : val;
                                                            newEntries[idx] = { ...newEntries[idx], trigger_key: newTrigger };
                                                            if (!newTrigger) {
                                                                newEntries[idx].keyword = null; // cascade clear keyword
                                                            }
                                                            setEditingDict({ ...editingDict, entries: newEntries });
                                                        }}
                                                    />
                                                )}
                                            </div>
                                            <div style={{ width: '100px' }}>
                                                <input className="modern-input" placeholder="缩写键 (可选)"
                                                    value={entry.keyword || ''} readOnly={isReadOnly || !entry.trigger_key}
                                                    disabled={!entry.trigger_key}
                                                    onChange={e => {
                                                        const newEntries = [...editingDict.entries];
                                                        newEntries[idx] = { ...newEntries[idx], keyword: e.target.value || null };
                                                        setEditingDict({ ...editingDict, entries: newEntries });
                                                    }} style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px', opacity: (!entry.trigger_key) ? 0.5 : 1 }} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <input className="modern-input" placeholder="输入替换上屏的内容 (若未设置触发键或缩写键，仍然支持智能候选模式)"
                                                    value={entry.content} readOnly={isReadOnly}
                                                    onChange={e => {
                                                        const newEntries = [...editingDict.entries];
                                                        newEntries[idx] = { ...newEntries[idx], content: e.target.value };
                                                        setEditingDict({ ...editingDict, entries: newEntries });
                                                    }} style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px' }} />
                                            </div>
                                            {!isReadOnly && (
                                                <button onClick={() => {
                                                    const newEntries = [...editingDict.entries];
                                                    newEntries.splice(idx, 1);
                                                    setEditingDict({ ...editingDict, entries: newEntries });
                                                }} className="btn-ghost" style={{ padding: '0', height: '34px', width: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', flexShrink: 0 }}>
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {editingDict.entries.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无条目，请点击上方按钮添加。</div>}
                                </div>
                            </div>
                        </div>

                        {!isReadOnly && (
                            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button onClick={() => setIsModalOpen(false)} className="btn-ghost" style={{ padding: '8px 24px', borderRadius: 'var(--radius-md)' }}>取消</button>
                                <button onClick={handleSaveDict} className="btn-primary" style={{ padding: '8px 24px' }}>
                                    <Save size={16} style={{ marginRight: '8px', verticalAlign: '-3px' }} /> 保存变更
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Custom Theme Confirmation Dialog */}
            {confirmDialog.isOpen && (
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
                                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>确定要删除此词库吗？</h3>
                                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>此操作将永久抹除数据，无法恢复。</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button onClick={() => setConfirmDialog({ isOpen: false, targetId: null })} className="btn-ghost" style={{ padding: '8px 16px', fontSize: '14px', borderRadius: 'var(--radius-md)' }}>取消</button>
                            <button onClick={confirmDelete} className="btn-primary" style={{ padding: '8px 16px', fontSize: '14px', background: '#ef4444', backgroundBlendMode: 'normal' }}>
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
