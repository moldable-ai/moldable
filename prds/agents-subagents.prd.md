# Agents + Subagents PRD (Moldable)

## Summary

Add first-class agent routing and subagent orchestration to Moldable Gateway and Moldable AI Server. Gateway remains the execution orchestrator (channels + schedules), while ai-server provides LLM execution and tool access. Subagents run in isolated sessions, report results back to their requester, and obey stricter tool policies.

## Goals

- Agent-aware session keys (`agent:{id}:...`) for gateway sessions.
- Deterministic routing from inbound channel messages to the correct agent + session.
- Subagent spawning with lifecycle tracking and result announcements.
- Gateway ↔ ai-server integration that preserves existing desktop chat behavior.
- Minimal but extensible APIs that allow UI surfaces to list agent sessions.

## Non-goals

- Full Control UI parity with Clawdbot (v1 is API + gateway behavior).
- Agent memory system beyond existing session storage.

## Requirements

### Agent routing

- Compute agent session keys per inbound message.
- Allow per-channel/per-peer overrides similar to current routing config.
- Persist session transcripts keyed by agent session key.

### Subagents

- Subagents run in isolated sessions with session keys like `agent:{target}:subagent:{uuid}`.
- Subagent runs are tracked (run id, requester, status, timestamps).
- Subagents announce back to requester on completion.
- Subagent spawning is blocked from existing subagent sessions.
- Subagents use tighter tool policy (deny management/system tools by default).

## Architecture

### Session keys

- Adopt Clawdbot-style agent session keys for gateway sessions.
- Example:
  - DM: `agent:main:telegram:dm:123`
  - Group: `agent:main:telegram:group:-100abc`
  - Subagent: `agent:main:subagent:uuid`

### Gateway ↔ ai-server

- Gateway sends conversations to ai-server via `/api/gateway/chat`.
- Gateway includes metadata in requests: channel, peerId, displayName, agentId, sessionKey, etc.
- ai-server persists gateway sessions for UI consumption.

### Subagent orchestration

- Gateway provides HTTP endpoints for subagent spawn/list/status.
- ai-server exposes tools to call those endpoints.
- Gateway runs subagent turns via ai-server, then posts results back to the requester session.

## Data Model

```ts
// Gateway-side
SubagentRun {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterChannel?: string;
  requesterChatId?: string;
  requesterPeerId?: string;
  label?: string;
  task: string;
  status: "queued" | "running" | "completed" | "error";
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}
```

## API (Gateway HTTP)

- `POST /api/agents/subagents/spawn`
- `GET /api/agents/subagents`
- `GET /api/agents/subagents/:runId`
- `DELETE /api/agents/subagents/:runId`

## UI

- Existing Agents panel lists gateway sessions.
- Subagent runs may be surfaced later (phase 2).

## TODO Checklist

- [x] Implement agent session key generator and resolver in gateway
- [x] Update session store index with agent session metadata
- [x] Route inbound messages through agent-aware session keys
- [x] Switch ai-server adapter calls to `/api/gateway/chat`
- [x] Add gateway subagent runner + persistence
- [x] Add gateway HTTP endpoints for subagents
- [x] Add ai-server tools for subagent spawn/list/status
- [x] Add tool policy restrictions for subagent sessions
- [x] Add comprehensive tests (gateway + ai-server)
