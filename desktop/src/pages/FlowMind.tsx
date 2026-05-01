import { useTranslation } from "react-i18next";
import { Sparkles, ToggleRight, ToggleLeft, Edit, Trash2, Plus, X, Save, Eye, AlertCircle, AlertTriangle, GripVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useState, useEffect } from "react";
import { Reorder } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

const FLOWMIND_BOTTOM_EXTENSION = 10;

const appWindow = (() => {
    try {
        return getCurrentWindow();
    } catch {
        return null;
    }
})();

function makeEditableDict(dict: SmartDictionary): SmartDictionary {
    const cloned = JSON.parse(JSON.stringify(dict));
    cloned.entries = cloned.entries.map((entry: SmartEntry) => ({
        ...entry,
        _id: crypto.randomUUID(),
    }));
    return cloned;
}

export default function FlowMind() {
    const { t } = useTranslation();
    const [isMaximized, setIsMaximized] = useState(false);
    const [flowsnapOn, setFlowsnapOn] = useState(false);
    const [flowhintOn, setFlowhintOn] = useState(false);
    const [debugMode, setDebugMode] = useState(false);
    const [minChars, setMinChars] = useState(2);
    const [posType, setPosType] = useState(0);
    const [acceptTab, setAcceptTab] = useState(true);
    const [acceptRight, setAcceptRight] = useState(true);
    const [dicts, setDicts] = useState<SmartDictionary[]>([]);
    const [diagReport, setDiagReport] = useState("");

    const [editingDict, setEditingDict] = useState<SmartDictionary | null>(null);
    const [isReadOnly, setIsReadOnly] = useState(false);
    const [sortField, setSortField] = useState<'trigger_key' | 'keyword' | 'content' | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    useEffect(() => {
        invoke<any>("get_settings")
            .then((settings) => setDebugMode(!!settings?.debug_mode))
            .catch(e => console.error("Failed to load debug mode:", e));
    }, []);

    useEffect(() => {
        if (!appWindow) return;
        appWindow.isMaximized().then(setIsMaximized).catch(() => {});
        const unlisten = appWindow.onResized(() => {
            appWindow.isMaximized().then(setIsMaximized).catch(() => {});
        });
        return () => {
            unlisten.then((cleanup) => cleanup()).catch(() => {});
        };
    }, []);

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
            setEditingDict((current) => {
                if (!current) return null;
                const matched = processed.find((dict) => dict.id === current.id);
                return matched ? makeEditableDict(matched) : null;
            });
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
            min_trigger_chars: 3,
            entries: [],
            dict_type: "custom",
        });
        setIsReadOnly(false);
        setSortField(null);
    };

    const openEditModal = (dict: SmartDictionary, readOnly: boolean) => {
        setEditingDict(makeEditableDict(dict));
        setIsReadOnly(readOnly);
        setSortField(null);
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
            setEditingDict((current) => current?.id === id ? null : current);
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
            await loadData();
        } catch (e) {
            setAlertDialog({ isOpen: true, message: "保存失败: " + e });
        }
    };

    return (
        <div style={{
            width: '100%',
            height: isMaximized ? `calc(100% + ${FLOWMIND_BOTTOM_EXTENSION}px)` : '100%',
            paddingBottom: '0px',
            marginBottom: isMaximized ? `-${FLOWMIND_BOTTOM_EXTENSION}px` : 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', gap: '16px', flexShrink: 0 }}>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                        <Sparkles size={22} color="var(--color-primary)" />
                        {t('flowmind.title')}
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '6px' }}>
                        {t('flowmind.subtitle')}
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <div
                        className="glass-panel"
                        style={{
                            padding: '8px 12px',
                            borderRadius: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            background: 'var(--color-surface)',
                            boxShadow: 'none',
                            border: '1px solid var(--color-border)',
                            minHeight: '36px',
                        }}
                    >
                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>弹窗位置</span>
                        <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                            <button onClick={() => updatePosType(0)} style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', background: posType === 0 ? 'var(--color-primary)' : 'transparent', color: posType === 0 ? '#fff' : 'var(--color-text-muted)' }}>跟随光标</button>
                            <button onClick={() => updatePosType(1)} style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', borderLeft: '1px solid var(--color-border)', background: posType === 1 ? 'var(--color-primary)' : 'transparent', color: posType === 1 ? '#fff' : 'var(--color-text-muted)' }}>固定位置</button>
                        </div>
                    </div>
                    <div
                        className="glass-panel"
                        style={{
                            padding: '8px 12px',
                            borderRadius: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            background: 'var(--color-surface)',
                            boxShadow: 'none',
                            border: '1px solid var(--color-border)',
                            minHeight: '36px',
                        }}
                    >
                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>上屏键</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={toggleAcceptTab} style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: acceptTab ? '1px solid rgba(94, 106, 210, 0.5)' : '1px solid var(--color-border)', background: acceptTab ? 'rgba(94, 106, 210, 0.2)' : 'transparent', color: acceptTab ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>Tab</button>
                            <button onClick={toggleAcceptRight} style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: acceptRight ? '1px solid rgba(94, 106, 210, 0.5)' : '1px solid var(--color-border)', background: acceptRight ? 'rgba(94, 106, 210, 0.2)' : 'transparent', color: acceptRight ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>→</button>
                        </div>
                    </div>
                    {debugMode && (
                        <button
                            onClick={runDiagnose}
                            className="btn-primary"
                            style={{
                                padding: '8px 14px',
                                fontSize: '12px',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                whiteSpace: 'nowrap',
                                lineHeight: '20px',
                                height: '36px',
                            }}
                        >
                            {t('flowmind.diagnostics_run')}
                        </button>
                    )}
                    <button
                        onClick={toggleFlowsnap}
                        style={{
                            background: flowsnapOn ? 'var(--color-primary-glow)' : 'var(--color-surface)',
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
                    <button
                        onClick={toggleFlowhint}
                        style={{
                            background: flowhintOn ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-surface)',
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

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(360px, 42%) minmax(0, 1fr)',
                gap: '16px',
                minHeight: 0,
                flex: 1,
            }}>
                <div className="glass-panel" style={{
                    background: 'var(--color-surface)',
                    boxShadow: 'none',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                }}>
                    <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>词库列表</h2>
                                <span style={{
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: 'var(--color-text-muted)',
                                    background: 'var(--color-surface-elevated)',
                                    padding: '4px 10px',
                                    borderRadius: '999px',
                                    border: '1px solid var(--color-border)',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {dicts.length} {t('flowmind.dict_count_unit')}
                                </span>
                            </div>
                            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>左侧选择词库，右侧直接编辑。</p>
                        </div>
                        <button
                            onClick={openCreateModal}
                            style={{
                                padding: '8px 16px',
                                fontSize: '13px',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                background: 'var(--color-surface)',
                                color: 'var(--color-text-main)',
                                border: '1px solid var(--color-border)',
                                borderRadius: '100px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s',
                                lineHeight: '20px',
                                height: '36px',
                                flexShrink: 0,
                            }}
                        >
                            <Plus size={16} />{t('flowmind.btn_create_dict')}
                        </button>
                    </div>
                    <Reorder.Group axis="y" values={dicts} onReorder={handleReorderDicts} style={{
                        padding: '10px 12px',
                        listStyleType: 'none',
                        margin: 0,
                        minHeight: 0,
                        flex: 1,
                        overflowY: 'auto',
                    }}>
                        {dicts.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无词库</div>}
                        {dicts.map(d => {
                            const isSelected = editingDict?.id === d.id;
                            return (
                                <Reorder.Item
                                    key={d.id}
                                    value={d}
                                    className="dict-row"
                                    style={{
                                        padding: '14px 16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        borderBottom: '1px solid var(--color-border)',
                                        transition: 'background 0.2s, border-color 0.2s',
                                        background: isSelected ? 'var(--color-primary-glow)' : 'transparent',
                                        borderRadius: '12px',
                                        marginBottom: '6px',
                                        border: isSelected ? '1px solid rgba(94, 106, 210, 0.28)' : '1px solid transparent',
                                    }}
                                    onClick={() => openEditModal(d, false)}
                                >
                                    <div style={{ padding: '0 4px', cursor: 'grab', color: 'var(--color-text-muted)' }}>
                                        <GripVertical size={16} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <span>{d.name}</span>
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '2px 8px',
                                                borderRadius: '999px',
                                                background: d.dict_type === 'builtin' ? 'rgba(94, 106, 210, 0.15)' : 'rgba(130, 201, 30, 0.15)',
                                                color: d.dict_type === 'builtin' ? 'var(--color-primary)' : '#82c91e',
                                                fontWeight: 600
                                            }}>
                                                {d.dict_type === 'builtin' ? '内置' : '自定义'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                            {d.entries.length} 组词条 · {d.description || '未填写描述'}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                        {d.dict_type !== 'builtin' && (
                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }} className="btn-ghost" style={{ padding: '6px', color: '#ef4444' }} title="删除">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </Reorder.Item>
                            );
                        })}
                    </Reorder.Group>
                </div>

                <div className="glass-panel" style={{
                    background: 'var(--color-surface)',
                    boxShadow: 'none',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                }}>
                    {editingDict ? (
                        <>
                            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {isReadOnly ? <Eye size={18} /> : <Edit size={18} />}
                                        {isReadOnly ? '查看词库' : '编辑词库'}
                                    </h2>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>最少触发</label>
                                        <input className="modern-input" type="number" min={1} max={10} value={editingDict.min_trigger_chars} readOnly={isReadOnly} onChange={e => setEditingDict({ ...editingDict, min_trigger_chars: parseInt(e.target.value) || 3 })} style={{ width: '96px' }} />
                                    </div>
                                    <button onClick={() => setEditingDict(null)} className="btn-ghost" style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)' }}>
                                        <X size={16} style={{ marginRight: '6px', verticalAlign: '-3px' }} />
                                        关闭
                                    </button>
                                    {!isReadOnly && (
                                        <button onClick={handleSaveDict} className="btn-primary" style={{ padding: '8px 16px' }}>
                                            <Save size={16} style={{ marginRight: '8px', verticalAlign: '-3px' }} />
                                            保存变更
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 0.72fr) minmax(320px, 1.8fr)', gap: '16px', alignItems: 'start' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>词库名称</label>
                                        <input className="modern-input" value={editingDict.name} readOnly={isReadOnly} onChange={e => setEditingDict({ ...editingDict, name: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>说明描述</label>
                                        <input className="modern-input" value={editingDict.description} readOnly={isReadOnly} onChange={e => setEditingDict({ ...editingDict, description: e.target.value })} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                    <h4 style={{ margin: 0, fontSize: '14px' }}>词条配置 ({editingDict.entries.length})</h4>
                                    {!isReadOnly && (
                                        <button
                                            onClick={() => setEditingDict({ ...editingDict, entries: [{ trigger_key: '', keyword: '', content: '', _id: crypto.randomUUID() }, ...editingDict.entries] })}
                                            style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                                        >
                                            <Plus size={15} /> 新增词条
                                        </button>
                                    )}
                                </div>

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
                                    {getSortedEntries().map((entry) => {
                                        const realIdx = editingDict.entries.findIndex(e => e._id === entry._id);
                                        return (
                                            <Reorder.Item key={entry._id} value={entry} style={{ display: 'flex', gap: '8px', background: 'var(--color-surface-elevated)', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', cursor: 'default' }}>
                                                {!isReadOnly && (
                                                    <div style={{ display: 'flex', alignItems: 'center', cursor: 'grab', color: 'var(--color-text-muted)', paddingRight: '4px' }}>
                                                        <GripVertical size={16} />
                                                    </div>
                                                )}
                                                <div style={{ width: '135px' }}>
                                                    {isReadOnly ? (
                                                        <input className="modern-input" placeholder="无触发前缀" value={entry.trigger_key || ''} readOnly={true} style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px' }} />
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
                                                                if (!newTrigger) newEntries[realIdx].keyword = null;
                                                                setEditingDict({ ...editingDict, entries: newEntries });
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                                <div style={{ width: '100px' }}>
                                                    <input
                                                        className="modern-input"
                                                        placeholder={entry.trigger_key ? '缩写词 (必填)' : '无缩写 (需前缀)'}
                                                        value={entry.keyword || ''}
                                                        readOnly={isReadOnly || !entry.trigger_key}
                                                        disabled={!entry.trigger_key}
                                                        onChange={e => {
                                                            const newEntries = [...editingDict.entries];
                                                            newEntries[realIdx] = { ...newEntries[realIdx], keyword: e.target.value || null };
                                                            setEditingDict({ ...editingDict, entries: newEntries });
                                                        }}
                                                        style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px', opacity: (!entry.trigger_key) ? 0.5 : 1 }}
                                                    />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <input
                                                        className="modern-input"
                                                        placeholder="输入替换上屏的内容"
                                                        value={entry.content}
                                                        readOnly={isReadOnly}
                                                        onChange={e => {
                                                            const newEntries = [...editingDict.entries];
                                                            newEntries[realIdx] = { ...newEntries[realIdx], content: e.target.value };
                                                            setEditingDict({ ...editingDict, entries: newEntries });
                                                        }}
                                                        style={{ padding: '0 8px', height: '34px', width: '100%', fontSize: '12px' }}
                                                    />
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

                                {debugMode && diagReport && (
                                    <div style={{ marginTop: '8px' }}>
                                        <h4 style={{ margin: '0 0 8px', fontSize: '14px' }}>诊断输出</h4>
                                        <pre style={{ background: 'var(--color-surface-elevated)', padding: '12px', borderRadius: '8px', fontSize: '12px', fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', maxHeight: '240px', overflow: 'auto' }}>
                                            {diagReport}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
                            <div style={{ textAlign: 'center', maxWidth: '360px' }}>
                                <div style={{ width: '56px', height: '56px', borderRadius: '18px', background: 'var(--color-primary-glow)', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                                    <Edit size={24} />
                                </div>
                                <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>选择一个词库开始编辑</h3>
                                <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                                    左侧支持拖拽排序、快速选择和删除。右侧会常驻显示当前词库的元数据与词条编辑器。
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

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
