// hooks.ts — Shared state management hooks for AI workbench
// Extracted from the monolithic Agents.tsx

import { useState } from "react";
import type { AiWorkbenchAdapter, AiWorkbenchConversation, AiWorkbenchMessage, AiWorkbenchProject, AiWorkbenchConfig, AiWorkbenchModel } from "../../services/aiWorkbench";

export interface UseWorkbenchOptions {
  adapter: AiWorkbenchAdapter;
}

export interface UseWorkbenchResult {
  conversations: AiWorkbenchConversation[];
  messages: AiWorkbenchMessage[];
  projects: AiWorkbenchProject[];
  config: AiWorkbenchConfig | null;
  models: AiWorkbenchModel[];
  activeConversationId: string | null;
  isLoading: boolean;

  setActiveConversation: (id: string | null) => void;
  refresh: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  cancelTurn: (turnId: string) => Promise<void>;
  createConversation: () => Promise<string>;
  archiveConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, name: string) => Promise<void>;
}

// Placeholder — full state management hook will be migrated from pages/Agents.tsx
export function useWorkbench(_options: UseWorkbenchOptions): UseWorkbenchResult {
  const [activeId] = useState<string | null>(null);
  // ... full implementation will be migrated
  return {
    conversations: [],
    messages: [],
    projects: [],
    config: null,
    models: [],
    activeConversationId: activeId,
    isLoading: false,
    setActiveConversation: () => {},
    refresh: async () => {},
    sendMessage: async () => {},
    cancelTurn: async () => {},
    createConversation: async () => "",
    archiveConversation: async () => {},
    renameConversation: async () => {},
  };
}
