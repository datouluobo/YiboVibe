# AI Workbench Mobile Contract

This contract defines the desktop-side data shape that a future mobile client can consume through any transport, including NAS relay.

Transport is intentionally out of scope here.

## Snapshot

The normalized snapshot type is `AiWorkbenchSnapshot` in:

- `desktop/src/services/aiWorkbench.ts`

A snapshot contains:

- `providers`: available AI tools such as Codex, Cursor, Claude Code, or custom adapters.
- `projects`: normalized project/workspace list.
- `conversations`: normalized conversation metadata.
- `activeConversationId`: desktop-selected conversation when known.
- `messagesByConversationId`: normalized messages grouped by conversation.
- `modelsByProviderId`: selectable models by provider.
- `configsByProviderId`: current model, approval, sandbox, and provider config.
- `errors`: normalized user-facing errors.

## Required Mobile MVP Reads

Mobile UI should be able to render from snapshot alone:

1. provider list and provider capabilities
2. project list
3. conversation list
4. active conversation messages
5. current model/config/status
6. readable error states

## Required Mobile MVP Actions

Actions should map to `AiWorkbenchAdapter` methods:

1. create conversation
2. rename conversation
3. archive conversation
4. send message
5. cancel current turn
6. list models
7. read/update config

## Provider Rule

Mobile and sync layers should not depend on Codex-specific names such as `thread/read`, `turn/start`, or `agentMessage`.
Those belong inside the Codex adapter.

## Mock Data

Use `AI_WORKBENCH_MOCK_SNAPSHOT` in:

- `desktop/src/services/aiWorkbenchMock.ts`

The mock exists so mobile UI can be built before NAS sync is finalized.
