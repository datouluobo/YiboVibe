// ConfigPanel.tsx — Codex/AI workbench config editing panel
// Extracted from the monolithic Agents.tsx

import type { AiWorkbenchConfig, AiWorkbenchModel } from "../../services/aiWorkbench";

export interface ConfigPanelProps {
  config: AiWorkbenchConfig | null;
  models: AiWorkbenchModel[];
  onUpdateConfig: (config: Partial<AiWorkbenchConfig>) => void;
}

// Placeholder — full implementation will be migrated from pages/Agents.tsx
export function ConfigPanel(_props: ConfigPanelProps) {
  return null;
}
