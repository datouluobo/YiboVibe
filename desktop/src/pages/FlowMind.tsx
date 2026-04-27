import { useTranslation } from "react-i18next";
import { Sparkles, ToggleRight, ToggleLeft, Edit, Trash2, Plus, X, Save, Eye, AlertCircle, AlertTriangle, GripVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useState, useEffect } from "react";
import { Reorder } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { CustomSelect } from "../components/CustomSelect";

type FeatureKey = "flowsnap" | "flowhint" | "flowsync" | "flowkeys";

interface SmartEntry {
    trigger_key: string | null;
    keyword: string | null;
    content: string;
    _id?: string;
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
    const [flowsnapOn, setFlowsnapOn] = useState(false);
    const [flowhintOn, setFlowhintOn] = useState(false);
    const [minChars, setMinChars] = useState(2);
    const [posType, setPosType] = useState(0);
    const [hintScale, setHintScale] = useState(1.0);
    const [acceptTab, setAcceptTab] = useState(true);
    const [acceptRight, setAcceptRight] = useState(true);
    const [dicts, setDicts] = useState<SmartDictionary[]>([]);
    const [diagReport, setDiagReport] = useState("");

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDict, setEditingDict] = useState<SmartDictionary | null>(null);
    const [isReadOnly, setIsReadOnly] = useState(false);
    const [sortField, setSortField] = useState<'trigger_key' | 'keyword' | 'content' | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    // Sort logic for entries
    const handleSort = (field: 'trigger_key' | 'keyword' | 'content') => {
        if (sortField === field) {
            if (sortDir === 'asc') {
                setSortDir('desc');
            } else {
                // desc → null (reset)
                setSortField(null);
                setSortDir('asc');
            }
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    };

    const getSortedEntries = () => {
        if (!editingDict || !sortField) return editingDict?.entries || [];
        const sorted = [...editingDict.entries];
        sorted.sort((a, b) => {
            const va = (a[sortField] || '').toString().toLowerCase();
            const vb = (b[sortField] || '').toString().toLowerCase();
            const cmp = va.localeCompare(vb, 'zh-CN');
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return sorted;
    };

    // Custom confirm dialog for delete
    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, targetId: string | null }>({ isOpen: false, targetId: null });
    const [alertDialog, setAlertDialog] = useState<{ isOpen: boolean, message: string }>({ isOpen: false, message: "" });

    const TRIGGER_OPTIONS = [
        { val: "", label: "无" },
        { val: "/", label: "/ (斜杠)" },
        { val: ";", label: "; (分号)" },
        { val: ",", label: ", (逗号)" },
        { val: ".", label: ". (句号)" },
        { val: "`", label: "` (反引号)" },
        { val: "'", label: "' (单引号)" },
        { val: "[", label: "[ (左方括号)" },
        { val: "]", label: "] (右方括号)" },
        { val: "=", label: "= (等号)" },
        { val: "-", label: "- (减号)" },
        { val: "\\", label: "\\ (反斜杠)" },
        { val: "@", label: "@ (艾特)" },
        { val: "#", label: "# (井号)" },
        { val: "$", label: "$ (美元)" },
        { val: "\uFFE5", label: "\uFFE5 (人民币全角)" },
        { val: "%", label: "% (百分号)" },
        { val: "^", label: "^ (脱字符)" },
        { val: "&", label: "& (和号)" },
        { val: "*", label: "* (星号)" },
        { val: "+", label: "+ (加号)" },
        { val: "!", label: "! (感叹号)" },
        { val: "?", label: "? (问号)" },
        { val: ":", label: ": (冒号)" },
        { val: "<", label: "< (小于号)" },
        { val: ">", label: "> (大于号)" },
        { val: "(", label: "( (左小括号)" },
        { val: ")", label: ") (右小括号)" },
        { val: "{", label: "{ (左花括号)" },
        { val: "}", label: "} (右花括号)" },
        { val: "|", label: "| (竖线)" },
        { val: "~", label: "~ (波浪号)" },
        { val: "_", label: "_ (下划线)" },
    ];

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const rules: any = await invoke("get_flow_rules");
            setFlowsnapOn(rules.default.flowsnap);
            setFlowhintOn(rules.default.flowhint);

            const settings: any = await invoke("get_settings");
            setMinChars(settings.flowhint_min_chars);
            setPosType(settings.hint_window?.pos_type ?? 0);
            setHintScale(settings.hint_window?.scale ?? 1.0);
            setAcceptTab(settings.flowhint_accept_tab ?? true);
            setAcceptRight(settings.flowhint_accept_right ?? true);

            const allDicts: SmartDictionary[] = await invoke("get_all_dictionaries");
            const processed = allDicts.map(d => ({
                ...d,
            }));

            const order = settings.dictionary_order || [];
            processed.sort((a, b) => {
                const idxA = order.indexOf(a.id);
                const idxB = order.indexOf(b.id);
                
                // If both are in the saved order, follow it
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                // If only one is in the saved order, it comes first
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                
                // Fallback: Builtin first, then name
                if (a.dict_type === 'builtin' && b.dict_type === 'custom') return -1;
                if (a.dict_type === 'custom' && b.dict_type === 'builtin') return 1;
                return a.name.localeCompare(b.name);
            });

            setDicts(processed);
        } catch (e) {
            console.error("Failed to fetch dictionaries:", e);
        }
    };

    const toggleFeature = async (feature: FeatureKey, current: boolean, setter: (v: boolean) => void) => {
        try {
            await invoke("toggle_default_feature", { feature });
            setter(!current);
        } catch (e) {
            console.error(`Failed to toggle ${feature}:`, e);
        }
    };

    const toggleFlowsnap = () => toggleFeature("flowsnap", flowsnapOn, setFlowsnapOn);
    const toggleFlowhint = () => toggleFeature("flowhint", flowhintOn, setFlowhintOn);

    const updateMinChars = async (val: number) => {
        setMinChars(val);
        try {
            await invoke("update_settings", {
                isSyncEnabled: flowhintOn,
                flowhintMinChars: val,
                flowhintAcceptTab: acceptTab,
                flowhintAcceptRight: acceptRight,
            });
        } catch (e) {
            console.error(e);
        }
    };

    const toggleAcceptTab = async () => {
        const newVal = !acceptTab;
        setAcceptTab(newVal);
        try {
            await invoke("update_settings", {
                isSyncEnabled: flowhintOn,
                flowhintMinChars: minChars,
                flowhintAcceptTab: newVal,
                flowhintAcceptRight: acceptRight,
            });
        } catch (e) { console.error(e); }
    };

    const toggleAcceptRight = async () => {
        const newVal = !acceptRight;
        setAcceptRight(newVal);
        try {
            await invoke("update_settings", {
                isSyncEnabled: flowhintOn,
                flowhintMinChars: minChars,
                flowhintAcceptTab: acceptTab,
                flowhintAcceptRight: newVal,
            });
        } catch (e) { console.error(e); }
    };

    const handleReorderDicts = async (newDicts: SmartDictionary[]) => {
        setDicts(newDicts);
        try {
            const order = newDicts.map(d => d.id);
            await invoke("set_dictionary_order", { order });
        } catch (e) {
            console.error("Failed to save dictionary order:", e);
        }
    };

    const updatePosType = async (val: number) => {
        setPosType(val);
        try {
            await invoke("set_hint_window_mode", { posType: val });
        } catch (e) {
            console.error("Failed to update hint window mode:", e);
        }
    };

    const updateHintScale = async (val: number) => {
        setHintScale(val);
        try {
            await invoke("set_hint_window_scale", { scale: val });
        } catch (e) {
            console.error("Failed to update hint window scale:", e);
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
        setSortField(null);
        setIsModalOpen(true);
    };

    const openEditModal = (dict: SmartDictionary, readOnly: boolean) => {
        // Add random IDs to entries for stable DND keys
        const d = JSON.parse(JSON.stringify(dict));
        d.entries = d.entries.map((e: any) => ({ ...e, _id: crypto.randomUUID() }));
        setEditingDict(d);
        setIsReadOnly(readOnly);
        setSortField(null);
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
            setAlertDialog({ isOpen: true, message: "删除失败: " + e });
        }
    };

    const handleSaveDict = async () => {
        if (!editingDict) return;
        try {
            if (!editingDict.name.trim()) {
                setAlertDialog({ isOpen: true, message: "请输入词库名称" });
                return;
            }
            for (let i = 0; i < editingDict.entries.length; i++) {
                const e = editingDict.entries[i];
                if (!e.content.trim()) {
                    setAlertDialog({ isOpen: true, message: `第 ${i + 1} 个词条内容不能为空` });
                    return;
                }
                if (e.trigger_key && !e.keyword?.trim()) {
                    setAlertDialog({ isOpen: true, message: `第 ${i + 1} 个词条已设置触发前缀，请提供配套的缩写词` });
                    return;
                }
                if (!e.trigger_key && e.keyword?.trim()) {
                    setAlertDialog({ isOpen: true, message: `第 ${i + 1} 个词条已设置缩写词，必须提供配套的触发前缀` });
                    return;
                }
            }
            // Strip temporary _id before saving to Rust
            const dictToSave = JSON.parse(JSON.stringify(editingDict));
            dictToSave.entries = dictToSave.entries.map((e: any) => {
                const { _id, ...rest } = e;
                return rest;
            });

            await invoke("save_dictionary", { dict: dictToSave });
            setIsModalOpen(false);
            await loadData();
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "保存失败: " + e });
        }
    };

    return (
        <div style={{ width: '100%', paddingBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                        <Sparkles size={22} color="var(--color-primary)" />
                        {t('flowmind.title')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '6px' }}>
                        {t('flowmind.subtitle')}
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--color-text-muted)',
                        background: 'var(--color-surface)',
                        padding: '8px 16px',
                        borderRadius: '100px',
                        border: '1px solid var(--color-border)',
                        whiteSpace: 'nowrap',
                        lineHeight: '20px',
                        height: '36px',
                        display: 'inline-flex',
                        alignItems: 'center',
                    }}>
                        {dicts.length} {t('flowmind.dict_count_unit')}
                    </span>
                    <button
                        onClick={openCreateModal}
                        style={{
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            background: 'var(--color-surface-elevated)',
                            color: 'var(--color-text-main)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '100px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s',
                            lineHeight: '20px',
                            height: '36px',
                        }}
                    >
                        <Plus size={16} />{t('flowmind.btn_create_dict')}
                    </button>
                    {/* FlowSnap Toggle */}
                    <button
                        onClick={toggleFlowsnap}
                        style={{
                            background: flowsnapOn ? 'var(--color-primary-glow)' : 'var(--color-surface-elevated)',
                            border: `1px solid ${flowsnapOn ? 'rgba(94, 106, 210, 0.4)' : 'var(--color-border)'}`,
                            color: flowsnapOn ? 'var(--color-primary)' : 'var(--color-text-muted)',
                            padding: '8px 14px',
                            borderRadius: '100px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '12px',
                            whiteSpace: 'nowrap',
                            lineHeight: '20px',
                            height: '36px',
                            transition: 'all 0.15s'
                        }}
                    >
                        {flowsnapOn ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        {t('flowmind.flowsnap_label')} {flowsnapOn ? t('flowmind.state_on') : t('flowmind.state_off')}
                    </button>
                    {/* FlowHint Toggle */}
                    <button
                        onClick={toggleFlowhint}
                        style={{
                            background: flowhintOn ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-surface-elevated)',
                            border: `1px solid ${flowhintOn ? 'rgba(34, 197, 94, 0.3)' : 'var(--color-border)'}`,
                            color: flowhintOn ? '#22c55e' : 'var(--color-text-muted)',
                            padding: '8px 14px',
                            borderRadius: '100px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '12px',
                            whiteSpace: 'nowrap',
                            lineHeight: '20px',
                            height: '36px',
                            transition: 'all 0.15s'
                        }}
                    >
                        {flowhintOn ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        {t('flowmind.flowhint_label')} {flowhintOn ? t('flowmind.state_on') : t('flowmind.state_off')}
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
                {/* 触发最小字数 */}
                <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: '1 1 180px', minWidth: '180px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>触发最小字数</span>
                    <input
                        type="number"
                        min={1}
                        max={10}
                        value={minChars}
                        onChange={(e) => updateMinChars(parseInt(e.target.value) || 2)}
                        className="modern-input"
                        style={{ width: '64px', textAlign: 'center' }}
                    />
                </div>

                {/* 弹窗位置 - 双向切换 */}
                <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: '1 1 220px', minWidth: '220px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>弹窗位置</span>
                    <div style={{
                        display: 'flex',
                        background: 'var(--color-surface)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: '1px solid var(--color-border)',
                    }}>
                        <button
                            onClick={() => updatePosType(0)}
                            style={{
                                padding: '6px 14px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: 'none',
                                background: posType === 0 ? 'var(--color-primary)' : 'transparent',
                                color: posType === 0 ? '#fff' : 'var(--color-text-muted)',
                                transition: 'all 0.15s',
                            }}
                        >跟随光标</button>
                        <button
                            onClick={() => updatePosType(1)}
                            style={{
                                padding: '6px 14px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: 'none',
                                borderLeft: '1px solid var(--color-border)',
                                background: posType === 1 ? 'var(--color-primary)' : 'transparent',
                                color: posType === 1 ? '#fff' : 'var(--color-text-muted)',
                                transition: 'all 0.15s',
                            }}
                        >固定位置</button>
                    </div>
                </div>

                {/* 上屏键 - 可开关按钮 */}
                <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: '1 1 200px', minWidth: '200px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>上屏键</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                            onClick={toggleAcceptTab}
                            style={{
                                padding: '4px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: acceptTab ? '1px solid rgba(94, 106, 210, 0.5)' : '1px solid var(--color-border)',
                                background: acceptTab ? 'rgba(94, 106, 210, 0.2)' : 'transparent',
                                color: acceptTab ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                transition: 'all 0.15s',
                            }}
                        >Tab</button>
                        <button
                            onClick={toggleAcceptRight}
                            style={{
                                padding: '4px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: acceptRight ? '1px solid rgba(94, 106, 210, 0.5)' : '1px solid var(--color-border)',
                                background: acceptRight ? 'rgba(94, 106, 210, 0.2)' : 'transparent',
                                color: acceptRight ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                transition: 'all 0.15s',
                            }}
                        >→</button>
                    </div>
                </div>

                {/* 弹窗大小滑块 */}
                <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: '1 1 280px', minWidth: '280px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>弹窗大小</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, marginLeft: '12px', minWidth: '120px' }}>
                        <input
                            type="range"
                            min={0.6}
                            max={1.8}
                            step={0.1}
                            value={hintScale}
                            onChange={(e) => updateHintScale(parseFloat(e.target.value))}
                            style={{ flex: 1, accentColor: 'var(--color-primary)', cursor: 'pointer', minWidth: '60px' }}
                        />
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-primary)', minWidth: '36px', textAlign: 'right' }}>
                            {Math.round(hintScale * 100)}%
                        </span>
                    </div>
                </div>
            </div>

            <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <Reorder.Group axis="y" values={dicts} onReorder={handleReorderDicts} style={{ padding: '12px', listStyleType: 'none', margin: 0 }}>
                    {dicts.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无词库</div>}
                    {dicts.map(d => (
                        <Reorder.Item key={d.id} value={d} className="dict-row" style={{
                            padding: '16px',
                            display: 'flex', alignItems: 'center', gap: '12px',
                            borderBottom: '1px solid var(--color-glass-border)',
                            transition: 'background 0.2s',
                            background: 'transparent'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-elevated)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            <div style={{ padding: '0 4px', cursor: 'grab', color: 'var(--color-text-muted)' }}>
                                <GripVertical size={16} />
                            </div>
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
                                    <button onClick={() => openEditModal(d, false)} className="btn-ghost" style={{ padding: '6px' }} title="编辑">
                                        <Edit size={16} />
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
                        </Reorder.Item>
                    ))}
                </Reorder.Group>
            </div>

            <div className="glass-panel" style={{ padding: '20px', marginTop: '20px', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '12px' }}>
                    <button onClick={runDiagnose} className="btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }}>
                        运行诊断
                    </button>
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
                                        <button onClick={() => setEditingDict({ ...editingDict, entries: [{ trigger_key: '', keyword: '', content: '', _id: crypto.randomUUID() }, ...editingDict.entries] })}
                                            style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s' }}>
                                            <Plus size={15} /> 新增词条
                                        </button>
                                    )}
                                </div>

                                {/* Column headers with sort - aligned with entry rows */}
                                <div style={{ display: 'flex', gap: '8px', padding: '0 10px' }}>
                                    {!isReadOnly && <div style={{ width: '20px', flexShrink: 0 }} />}
                                    <div style={{ width: '135px' }}>
                                        <button onClick={() => handleSort('trigger_key')} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: sortField === 'trigger_key' ? 'var(--color-primary)' : 'var(--color-text-muted)', padding: '2px 0' }}>
                                            前缀
                                            {sortField === 'trigger_key' ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}
                                        </button>
                                    </div>
                                    <div style={{ width: '100px' }}>
                                        <button onClick={() => handleSort('keyword')} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: sortField === 'keyword' ? 'var(--color-primary)' : 'var(--color-text-muted)', padding: '2px 0' }}>
                                            缩略词
                                            {sortField === 'keyword' ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}
                                        </button>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <button onClick={() => handleSort('content')} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: sortField === 'content' ? 'var(--color-primary)' : 'var(--color-text-muted)', padding: '2px 0' }}>
                                            内容
                                            {sortField === 'content' ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}
                                        </button>
                                    </div>
                                    {!isReadOnly && <div style={{ width: '34px', flexShrink: 0 }} />}
                                </div>

                                <Reorder.Group axis="y" values={getSortedEntries()} onReorder={(newEntries) => { setSortField(null); setEditingDict({ ...editingDict, entries: newEntries }); }} style={{ display: 'flex', flexDirection: 'column', gap: '8px', listStyleType: 'none', margin: 0, padding: 0 }}>
                                    {getSortedEntries().map((entry, idx) => {
                                        // Find real index in editingDict.entries by _id
                                        const realIdx = editingDict.entries.findIndex(e => e._id === entry._id);
                                        return (
                                        <Reorder.Item key={entry._id} value={entry} style={{ display: 'flex', gap: '8px', background: 'var(--color-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', cursor: 'default' }}>
                                            {!isReadOnly && (
                                                <div style={{ display: 'flex', alignItems: 'center', cursor: 'grab', color: 'var(--color-text-muted)', paddingRight: '4px' }}>
                                                    <GripVertical size={16} />
                                                </div>
                                            )}
                                            <div style={{ width: '135px' }}>
                                                {isReadOnly ? (
                                                    <input className="modern-input" placeholder="无触发前缀"
                                                        value={entry.trigger_key || ''} readOnly={true}
                                                        style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px' }} />
                                                ) : (
                                                    <CustomSelect
                                                        options={TRIGGER_OPTIONS}
                                                        value={entry.trigger_key || ''}
                                                        placeholder="无前缀"
                                                        triggerStyle={{ padding: '0 12px', height: '34px', fontSize: '12px' }}
                                                        style={{ fontSize: '12px' }}
                                                        onChange={val => {
                                                            const newEntries = [...editingDict.entries];
                                                            const newTrigger = val === '' ? null : val;
                                                            newEntries[realIdx] = { ...newEntries[realIdx], trigger_key: newTrigger };
                                                            if (!newTrigger) {
                                                                newEntries[realIdx].keyword = null;
                                                            }
                                                            setEditingDict({ ...editingDict, entries: newEntries });
                                                        }}
                                                    />
                                                )}
                                            </div>
                                            <div style={{ width: '100px' }}>
                                                <input className="modern-input" placeholder={entry.trigger_key ? "缩写词 (必填)" : "无缩写 (需前缀)"}
                                                    value={entry.keyword || ''} readOnly={isReadOnly || !entry.trigger_key}
                                                    disabled={!entry.trigger_key}
                                                    onChange={e => {
                                                        const newEntries = [...editingDict.entries];
                                                        newEntries[realIdx] = { ...newEntries[realIdx], keyword: e.target.value || null };
                                                        setEditingDict({ ...editingDict, entries: newEntries });
                                                    }} style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px', opacity: (!entry.trigger_key) ? 0.5 : 1 }} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <input className="modern-input" placeholder="输入替换上屏的内容 (若不设前缀和缩写，则完全依赖于智能推荐模式)"
                                                    value={entry.content} readOnly={isReadOnly}
                                                    onChange={e => {
                                                        const newEntries = [...editingDict.entries];
                                                        newEntries[realIdx] = { ...newEntries[realIdx], content: e.target.value };
                                                        setEditingDict({ ...editingDict, entries: newEntries });
                                                    }} style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px' }} />
                                            </div>
                                            {!isReadOnly && (
                                                <button onClick={() => {
                                                    const newEntries = [...editingDict.entries];
                                                    newEntries.splice(realIdx, 1);
                                                    setEditingDict({ ...editingDict, entries: newEntries });
                                                }} className="btn-ghost" style={{ padding: '0', height: '34px', width: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', flexShrink: 0 }}>
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </Reorder.Item>
                                    );
                                    })}
                                    {editingDict.entries.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无条目，请点击上方按钮添加。</div>}
                                </Reorder.Group>
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

            {/* Custom Alert Dialog */}
            {alertDialog.isOpen && (
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
                            <div style={{ padding: '10px', background: 'rgba(239,160,0,0.1)', borderRadius: '100px', color: '#f59e0b' }}>
                                <AlertCircle size={24} />
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>提示</h3>
                                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{alertDialog.message}</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button onClick={() => setAlertDialog({ isOpen: false, message: "" })} className="btn-primary" style={{ padding: '8px 20px', fontSize: '14px', borderRadius: 'var(--radius-md)' }}>确定</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
