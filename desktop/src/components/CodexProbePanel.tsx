import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { Play, WandSparkles } from "lucide-react";
import {
  CODEX_ENDPOINT,
  DEFAULT_PARAMS_BY_METHOD,
  SAMPLE_METHODS,
  formatJson,
  probeCodexAppServer,
  type CodexAppServerProbeResponse,
} from "../services/codexBridge";

const panelStyle: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-surface)",
  minWidth: 0,
};

export function CodexProbePanel() {
  const [endpoint, setEndpoint] = useState(CODEX_ENDPOINT);
  const [method, setMethod] = useState("thread/list");
  const [paramsText, setParamsText] = useState(DEFAULT_PARAMS_BY_METHOD["thread/list"]);
  const [result, setResult] = useState<CodexAppServerProbeResponse | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const bearerToken = "";

  const parsedParams = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(paramsText || "{}") };
    } catch (err) {
      return { ok: false as const, message: String(err) };
    }
  }, [paramsText]);

  const runProbe = useCallback(async () => {
    setError("");
    setResult(null);

    if (!parsedParams.ok) {
      setError(`Params JSON is invalid: ${parsedParams.message}`);
      return;
    }

    setIsRunning(true);
    try {
      const { response } = await probeCodexAppServer(endpoint, method, parsedParams.value, bearerToken);
      setResult(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRunning(false);
    }
  }, [endpoint, method, parsedParams]);

  const resultTone = result?.ok ? "#7ee787" : result ? "#f2cc60" : "#8b949e";
  const probeLabel = result ? `${result.transport} ${result.status}` : "测试连接";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setResult(null)}
          style={{
            borderRadius: 8,
            minHeight: 34,
            borderColor: result ? resultTone : undefined,
            color: result ? resultTone : undefined,
          }}
        >
          <WandSparkles size={15} />
          {probeLabel}
        </button>
      </div>

      <section
        style={{
          ...panelStyle,
          display: "grid",
          gridTemplateColumns: "minmax(220px, 300px) minmax(160px, 220px) minmax(0, 1fr) auto",
          gap: 10,
          padding: 12,
          alignItems: "end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          Endpoint
          <input
            className="modern-input"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            spellCheck={false}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          Method
          <select
            className="modern-input custom-select"
            value={method}
            onChange={(event) => {
              const nextMethod = event.target.value;
              setMethod(nextMethod);
              setParamsText(DEFAULT_PARAMS_BY_METHOD[nextMethod] ?? "{}");
            }}
            style={{ fontSize: 12 }}
          >
            {SAMPLE_METHODS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          Params
          <input
            className="modern-input"
            value={paramsText.replace(/\s+/g, " ").trim()}
            onChange={(event) => setParamsText(event.target.value)}
            spellCheck={false}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              borderColor: parsedParams.ok ? undefined : "#ff7b72",
            }}
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={isRunning}
          onClick={runProbe}
          style={{ minHeight: 38, borderRadius: 8, opacity: isRunning ? 0.72 : 1, whiteSpace: "nowrap" }}
        >
          <Play size={15} />
          {isRunning ? "Testing" : "测试连接"}
        </button>
        {(error || result) && (
          <pre
            style={{
              gridColumn: "1 / -1",
              maxHeight: 190,
              overflow: "auto",
              borderRadius: 8,
              border: "1px solid #30363d",
              background: "#0d1117",
              color: error ? "#ffb4ad" : "#d6dde8",
              padding: 12,
              margin: 0,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error ||
              formatJson({
                ok: result?.ok,
                status: result?.status,
                elapsed_ms: result?.elapsed_ms,
                transport: result?.transport,
                error: result?.error,
                response_json: result?.response_json,
              })}
          </pre>
        )}
      </section>
    </>
  );
}
