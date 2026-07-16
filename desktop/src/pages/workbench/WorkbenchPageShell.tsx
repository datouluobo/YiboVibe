import type { ReactNode } from "react";

export function WorkbenchPageShell({
  title,
  description,
  actions,
  error,
  children,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h2 style={{ marginBottom: 8, fontSize: 18, fontWeight: 600 }}>{title}</h2>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{description}</p>
        </div>
        {actions ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{actions}</div> : null}
      </div>

      {error ? (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            color: "#ffb4ad",
            background: "rgba(255,123,114,0.12)",
            border: "1px solid rgba(255,123,114,0.24)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {children}
    </div>
  );
}
