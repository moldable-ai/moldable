# Cron + Scheduled Jobs PRD (Moldable Gateway)

## Summary

Add gateway-level cron scheduling so agents can run proactive tasks without user input. Gateway owns job scheduling and execution; ai-server provides LLM execution. Jobs can deliver results back to the originating channel/session.

## Goals

- Gateway can store, list, update, and execute cron jobs.
- Jobs can target agent sessions and optionally deliver to a channel.
- ai-server can schedule and manage jobs via tools.
- Jobs survive gateway restarts.

## Non-goals

- Full Control UI for cron management (API + tools first).
- Complex calendar UI or advanced RRULE support.

## Requirements

- Cron expressions (standard 5-field format).
- Job persistence under gateway state dir.
- Job execution uses ai-server via gateway adapter.
- Optional delivery to channel/chat/thread.
- Manual “run now” endpoint.

## Architecture

- Gateway cron scheduler runs on an interval (e.g., 30s) and checks due jobs.
- Each job stores `lastRunAt` and `nextRunAt` to avoid duplicates.
- Job execution:
  1. Build session key + task message
  2. Call ai-server via `/api/gateway/chat`
  3. Persist assistant response in session store
  4. Optionally deliver message via channel manager

## Data Model

```ts
CronJob {
  id: string;
  schedule: string; // cron expression
  timezone?: string; // optional
  enabled: boolean;
  agentId?: string;
  sessionKey?: string;
  channel?: string;
  chatId?: string;
  peerId?: string;
  task: string;
  model?: string;
  reasoningEffort?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}
```

## API (Gateway HTTP)

- `POST /api/cron/jobs`
- `GET /api/cron/jobs`
- `GET /api/cron/jobs/:id`
- `DELETE /api/cron/jobs/:id`
- `POST /api/cron/jobs/:id/run`

## TODO Checklist

- [x] Add cron job store + persistence
- [x] Add cron scheduler runner
- [x] Add cron HTTP endpoints
- [x] Add ai-server tools to create/list/delete/run cron jobs
- [x] Add tests for scheduling logic + endpoints
