// ThreadList.tsx — Session/thread list panel for AI workbench
// Extracted from the monolithic Agents.tsx

import type { AiWorkbenchConversation } from "../../services/aiWorkbench";

export interface ThreadListProps {
  conversations: AiWorkbenchConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onArchive: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

// Placeholder — full implementation will be migrated from agents/Agents.tsx
export function ThreadList(_props: ThreadListProps) {
  return null;
}
