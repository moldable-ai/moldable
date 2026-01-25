# AI Server ↔ Gateway Integration PRD

## Summary

Add first‑class support in `@moldable-ai/ai-server` for Moldable Gateway sessions (Telegram/WhatsApp/etc.) without breaking existing desktop chat flows. Phase 1 enables a gateway-compatible HTTP endpoint and session persistence. Phase 2 adds a dedicated UI surface for agent/subagent sessions and gateway configuration.

## Goals

- Accept gateway messages in a stable, backend‑agnostic format.
- Persist gateway sessions so the desktop UI can render them.
- Keep existing `/api/chat` behavior unchanged for in‑app sessions.
- Provide a clear UI separation between desktop sessions and gateway sessions.

## Non‑goals (initial)

- Replace Moldable Gateway session storage (gateway still stores its own JSONL).
- Implement advanced agent tool orchestration beyond current ai-server capabilities.
- Require users to migrate existing desktop conversations.

## Background (Clawdbot reference)

Clawdbot routes channel messages into agent sessions with consistent session keys and agent routing. We want similar session partitioning (agent/session key + channel/peer metadata) while keeping Moldable’s desktop chat UX intact.

## Phased Plan

### Phase 1 — Basic gateway integration

**Deliverables**

- New ai-server endpoint for gateway: `POST /api/gateway/chat`.
- Gateway session store (JSON per session) under Moldable home.
- List/load/delete endpoints for gateway sessions.
- Optional gateway metadata in requests (channel, peer, agentId, sessionKey).

**Request format (Phase 1)**

```json
{
  "sessionId": "agent:main:telegram:dm:123",
  "messages": [{ "role": "user", "text": "hello", "timestamp": 1737811000 }],
  "model": "anthropic/claude-3.7-sonnet",
  "reasoningEffort": "medium",
  "activeWorkspaceId": "personal",
  "gateway": {
    "channel": "telegram",
    "peerId": "123",
    "chatId": "123",
    "displayName": "alice",
    "isGroup": false,
    "agentId": "main",
    "sessionKey": "agent:main:telegram:dm:123"
  }
}
```

**Response**

```json
{ "text": "assistant response", "sessionId": "agent:main:telegram:dm:123" }
```

**Session storage**

- Default path:
  - `~/.moldable/shared/gateway-sessions/` (shared)
  - or `~/.moldable/workspaces/{workspaceId}/gateway-sessions/` (if provided)
- One JSON per session: `{ id, title, createdAt, updatedAt, messageCount, messages, gateway }`

**HTTP endpoints**

- `POST /api/gateway/chat`
- `GET /api/gateway/sessions?workspaceId=...`
- `GET /api/gateway/sessions/:id?workspaceId=...`
- `DELETE /api/gateway/sessions/:id?workspaceId=...`

### Phase 2 — Agents/subagents UX

**Deliverables**

- Dedicated “Agents” UI panel in desktop app.
- Separate list for gateway sessions (Telegram/WhatsApp/etc.).
- Session details view with metadata (channel, peer, agentId).
- Clear separation from in‑app desktop conversations.

**UX**

- New sidebar button (“Agents”) toggles an overlay panel.
- Left column: gateway sessions list (title, channel, updated time).
- Right column: transcript view (read‑only in v1), metadata header.
- Future: ability to reply from this panel and manage gateway config.

## Data Model

```ts
type GatewayMessage = {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: number
}

type GatewaySessionMeta = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  channel?: string
  peerId?: string
  displayName?: string
  isGroup?: boolean
  agentId?: string
  sessionKey?: string
}

type GatewaySession = GatewaySessionMeta & {
  messages: GatewayMessage[]
}
```

## Compatibility

- `/api/chat` remains the source of truth for desktop chat.
- Gateway sessions are stored separately and read by the desktop UI via ai-server endpoints.

## Risks & Mitigations

- **Mixed session types**: Keep gateway sessions in a separate store and UI surface.
- **Tool execution**: Retain existing `createMoldableTools` approvals (same policy).
- **Missing metadata**: Accept gateway requests without metadata; derive title from content.

## Success Criteria

- Telegram/WhatsApp messages reach ai-server via gateway endpoint.
- Gateway sessions list and transcript render in desktop UI.
- Desktop chat behavior unchanged.

## TODO Checklist

- [x] Implement `/api/gateway/chat` in ai-server
- [x] Add gateway session store module + tests
- [x] Add gateway sessions HTTP endpoints
- [x] Add desktop “Agents” panel + hook
- [x] Wire gateway sessions UI to ai-server endpoints
- [x] Update docs (ai-server and desktop UI notes)
