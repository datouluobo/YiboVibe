// ChatPanel.tsx — Chat/message stream rendering for AI workbench
// Extracted from the monolithic Agents.tsx

import type { AiWorkbenchConversation, AiWorkbenchMessage } from "../../services/aiWorkbench";

export interface ChatPanelProps {
  messages: AiWorkbenchMessage[];
  conversation: AiWorkbenchConversation | null;
  onSendMessage: (text: string) => void;
  onCancelTurn: (turnId: string) => void;
}

// Placeholder — full implementation will be migrated from agents/Agents.tsx
export function ChatPanel(_props: ChatPanelProps) {
  return null;
}
