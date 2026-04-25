import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Activity, GripVertical, Plus, RefreshCw, ShieldCheck, ShieldAlert, Trash2, ChevronDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Reorder, useDragControls } from "framer-motion";

const AI_PRESETS: { [key: string]: { url: string, models: string[] } } = {
    "Ollama (Local)": { url: "http://localhost:11434/v1", models: ["qwen2.5:0.5b", "gemma2:2b", "llama3.2:1b"] },
    "Ollama (LAN)": { url: "http://192.168.1.88:11434/v1", models: ["deepseek-r1:1.5b", "qwen2.5:7b"] },
    "DeepSeek": { url: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
    "Google Gemini": { url: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-3-pro-preview"] },
    "\u667A\u8C31 AI": { url: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4", "glm-4-flash", "glm-4-9b", "glm-3-turbo"] },
    "AIPM": { url: "https://emtf.aipm9527.online/v1", models: ["gpt-4o", "claude-3-5-sonnet", "gemini-1.5-pro"] },
    "Groq": { url: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"] },
    "OpenRouter": { url: "https://openrouter.ai/api/v1", models: ["google/gemini-pro-1.5", "deepseek/deepseek-chat", "anthropic/claude-3.5-sonnet"] },
};

function AiEndpointItem({ 
    ep, idx, handleUpdateEndpoint, handleRemoveEndpoint, handleTestEndpoint, handleFetchModels,
    verificationStatuses, endpointModels, openModelMenus, setOpenModelMenus, endpointProviderQuick,
    setEndpointProviderQuick, AI_PRESETS 
}: any) {
    const { t } = useTranslation();
    const dragControls = useDragControls();

    const inputStyle: React.CSSProperties = {
        padding: '6px 10px', borderRadius: '6px', background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border)', color: 'var(--color-text-main)',
        fontSize: '12px', width: '100%', boxSizing: 'border-box'
    };

    return (
        <Reorder.Item 
            key={ep._id || idx} value={ep} dragListener={false} dragControls={dragControls}
            style={{
                background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', padding: '10px 14px',
                opacity: ep.is_enabled ? 1 : 0.6,
                position: 'relative', zIndex: 1
            }}
        >
            {/* Row 1: Drag + Checkbox + Preset + URL + Model */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div 
                    onPointerDown={(e) => dragControls.start(e)}
                    style={{ cursor: 'grab', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                    title={t('flowprobe.drag_sort')}
                >
                    <GripVertical size={18} />
                </div>

                <input 
                    type="checkbox" checked={ep.is_enabled} 
                    onChange={(e) => handleUpdateEndpoint(idx, 'is_enabled', e.target.checked)} 
                    style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                    title={ep.is_enabled ? t('flowprobe.status_enabled') : t('flowprobe.status_disabled')}
                />

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
                    style={{ ...inputStyle, width: '130px', flexShrink: 0 }}
                >
                    <option value="">{t('flowprobe.preset_custom')}</option>
                    {Object.keys(AI_PRESETS).map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                <input 
                    value={ep.base_url} 
                    onChange={(e) => {
                        handleUpdateEndpoint(idx, 'base_url', e.target.value);
                        const matched = Object.keys(AI_PRESETS).find(k => AI_PRESETS[k].url === e.target.value);
                        setEndpointProviderQuick((prev: any) => ({ ...prev, [idx]: matched || "" }));
                    }} 
                    onBlur={() => ep.base_url && handleFetchModels(idx)}
                    style={{ ...inputStyle, flex: '1 1 0', minWidth: '120px' }}
                    placeholder={t('flowprobe.placeholder_url')} 
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: '0 0 auto', position: 'relative' }}>
                    <input 
                        list={`probe_models_${idx}`}
                        value={ep.model} 
                        onChange={(e) => handleUpdateEndpoint(idx, 'model', e.target.value.replace(/^models\//, ""))} 
                        style={{ ...inputStyle, width: '160px', fontWeight: 600 }}
                        placeholder={t('flowprobe.placeholder_model')} 
                    />
                    <button 
                        onClick={() => openModelMenus[idx] ? setOpenModelMenus((prev: any) => ({ ...prev, [idx]: false })) : handleFetchModels(idx)}
                        style={{
                            height: '28px', width: '28px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                            borderRadius: '6px', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
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
                    <datalist id={`probe_models_${idx}`}>
                        {(AI_PRESETS[endpointProviderQuick[idx]]?.models || []).map((m: any) => <option key={m} value={m.replace(/^models\//, "")} />)}
                        {(endpointModels[idx]?.list || []).map((m: any) => <option key={m} value={m.replace(/^models\//, "")} />)}
                    </datalist>
                </div>
            </div>

            {/* Row 2: API Key + Status + Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingLeft: '50px' }}>
                <input 
                    type="password" value={ep.api_key} 
                    onChange={(e) => handleUpdateEndpoint(idx, 'api_key', e.target.value)} 
                    style={{ ...inputStyle, flex: '1 1 0', minWidth: '100px' }} 
                    placeholder="API Key" 
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', width: '80px', flexShrink: 0 }}>
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

                <button 
                    onClick={() => handleTestEndpoint(idx)}
                    disabled={verificationStatuses[idx]?.loading}
                    className="btn-ghost"
                    style={{ height: '28px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '11px', fontWeight: 600, flexShrink: 0 }}
                >
                    {t('flowprobe.btn_test')}
                </button>
                <button 
                    onClick={() => handleRemoveEndpoint(idx)} 
                    style={{ 
                        height: '28px', width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                        color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', 
                        borderRadius: '6px', cursor: 'pointer', flexShrink: 0
                    }}
                    title={t('flowprobe.btn_delete')}
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </Reorder.Item>
    );
}

export default function FlowProbe() {
    const { t } = useTranslation();
    const [endpoints, setEndpoints] = useState<any[]>([]);
    const [verificationStatuses, setVerificationStatuses] = useState<{ [key: number]: { loading: boolean, status: 'idle' | 'success' | 'auth_err' | 'net_err', msg: string, latency_ms?: number } }>({});
    const [endpointModels, setEndpointModels] = useState<{ [key: number]: { loading: boolean, list: string[] } }>({});
    const [openModelMenus, setOpenModelMenus] = useState<{ [key: number]: boolean }>({});
    const [endpointProviderQuick, setEndpointProviderQuick] = useState<{ [key: number]: string }>({});

    const fetchConfig = () => {
        invoke("get_app_config").then((cfg: any) => {
            if (cfg?.ai_engine?.endpoints) {
                const eps = cfg.ai_engine.endpoints.map((e: any, i: number) => ({ ...e, _id: e._id || `ep-${Date.now()}-${i}` }));
                setEndpoints(eps);
                const quick: { [key: number]: string } = {};
                eps.forEach((e: any, i: number) => {
                    const matched = Object.keys(AI_PRESETS).find(k => AI_PRESETS[k].url === e.base_url);
                    if (matched) quick[i] = matched;
                });
                setEndpointProviderQuick(quick);
            }
        }).catch(console.error);
    };

    useEffect(() => { fetchConfig(); }, []);

    const handleTestEndpoint = async (idx: number) => {
        const ep = endpoints[idx];
        setVerificationStatuses(prev => ({ ...prev, [idx]: { loading: true, status: 'idle', msg: t('flowprobe.loading') } }));
        try {
            const result: any = await invoke("test_ai_endpoint", { endpoint: ep });
            setVerificationStatuses(prev => ({ 
                ...prev, 
                [idx]: { 
                    loading: false, 
                    status: result.success ? 'success' : (result.error_type === 'Unauthorized' ? 'auth_err' : 'net_err'), 
                    msg: result.message || (result.success ? 'OK' : 'Failed'),
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
        try { await invoke("update_ai_endpoints", { endpoints: newEndpoints }); } catch (e) { console.error("Save endpoints failed", e); }
    };

    const handleAddEndpoint = () => {
        const list = [...endpoints, {
            _id: `ep-new-${Date.now()}-${Math.random()}`,
            provider: "OllamaLAN", base_url: "http://localhost:11434/v1",
            api_key: "", model: "", is_enabled: true, priority: endpoints.length + 1
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

    return (
        <div style={{ width: '100%', paddingBottom: '40px' }}>
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <Activity size={22} color="var(--color-primary)" />
                    {t('flowprobe.title')}
                </h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '6px' }}>
                    {t('flowprobe.subtitle')}
                </p>
            </div>

            <div className="glass-panel" style={{ padding: '18px', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '16px' }}>
                    <button onClick={handleAddEndpoint} className="btn-ghost" style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid var(--color-border)', borderRadius: '10px' }}>
                        <Plus size={16} /> {t('flowprobe.btn_add_node')}
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
        </div>
    );
}
