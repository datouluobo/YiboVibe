import type { CSSProperties, ReactNode } from "react";
import { Activity } from "lucide-react";

export const workbenchPanelStyle: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-surface)",
  minWidth: 0,
};

export const workbenchToolbarMetricStyle: CSSProperties = {
  minHeight: 34,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--color-text-muted)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 10px",
  fontSize: 12,
  minWidth: 0,
};

export const workbenchFloatingIconButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "rgba(255,255,255,0.92)",
  color: "var(--color-text-muted)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  pointerEvents: "auto",
  boxShadow: "0 4px 16px rgba(15,23,42,0.12)",
};

export const workbenchIconButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "rgba(255,255,255,0.84)",
  color: "var(--color-text-muted)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

export function WorkbenchPanelHeader({
  icon,
  title,
  meta,
  metaColor = "var(--color-text-muted)",
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  metaColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        {icon}
        {title}
      </div>
      {meta ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: metaColor, fontSize: 12 }}>
          <Activity size={13} />
          {meta}
        </div>
      ) : null}
    </div>
  );
}

export function WorkbenchEmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div
      style={{
        minHeight: 120,
        display: "grid",
        placeItems: "center",
        gap: 8,
        color: "var(--color-text-muted)",
        fontSize: 12,
        textAlign: "center",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );
}
