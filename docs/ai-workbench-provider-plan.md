# AI Workbench Provider Plan

This document keeps the Agents/Codex MVP from becoming a Codex-only corner of the app.

## Goal

YiboVibe should treat Codex Desktop as the first AI workbench provider, not the only possible one. Future providers can include Cursor, Claude Code, other AI IDEs, local agents, or custom tools.

## Provider Boundary

The shared provider contract lives in:

- `desktop/src/services/aiWorkbench.ts`

Provider adapters should map their native objects into these app-level concepts:

- `AiWorkbenchProvider`
- `AiWorkbenchProject`
- `AiWorkbenchConversation`
- `AiWorkbenchMessage`
- `AiWorkbenchModel`
- `AiWorkbenchConfig`

Codex-specific transport, JSON-RPC shapes, item types, and status names stay inside:

- `desktop/src/services/codexBridge.ts`

## Adapter Rules

1. Keep native protocol types in the provider adapter.
2. Expose normalized project, conversation, message, model, config, and status shapes to UI and future sync layers.
3. Do not let UI components depend on provider-specific item names unless the UI is explicitly a provider diagnostics panel.
4. Keep raw native payloads available on normalized objects for debugging and migration.
5. Add capabilities to the provider object before adding provider-specific UI affordances.

## Current Status

Codex is the first provider and currently supports:

- project and conversation listing
- conversation create/read/rename/archive
- message send and turn cancel
- model/config read/write
- event stream

The NAS/mobile sync design is intentionally not defined here. This layer only defines the local desktop capability boundary that any sync path can consume later.
