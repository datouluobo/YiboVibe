// ProjectList.tsx — Project list panel for AI workbench
// Extracted from the monolithic Agents.tsx

import type { AiWorkbenchProject } from "../../services/aiWorkbench";

export interface ProjectListProps {
  projects: AiWorkbenchProject[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onSearch: (query: string) => void;
}

// Placeholder — full implementation will be migrated from pages/Agents.tsx
export function ProjectList(_props: ProjectListProps) {
  return null;
}
