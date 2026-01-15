# Filesystem-First Persistence PRD

## Overview

Moldable is **local-first** and treats **files as the primitive** for truth and context (see `prds/moldable.prd.md`). This PRD proposes a unified approach so that **all Moldable apps (and core Moldable state like chat history) persist to the filesystem by default**, rather than browser `localStorage` / `indexedDB`.

This makes data:

- **Durable**: survives webview resets, storage eviction, and browser-like constraints
- **Inspectable**: users can open data in Finder / terminal and understand it
- **Versionable**: can be committed to Git (where appropriate) and diffed
- **Portable**: easy export/backup and migration between machines

## Problem Statement

Today, persistence is inconsistent:

- Some apps persist to files (e.g. `apps/todo` writes `data/todos.json`; `apps/scribo` writes to `~/.moldable/apps/scribo/data/entries/*.json`)
- Some apps persist to browser storage (e.g. `apps/meetings` uses `localStorage` for meeting transcripts + settings)
- The desktop UI persists some user preferences to `localStorage` (selected model, reasoning effort, theme)

This causes:

- Data loss risk when browser storage is cleared/evicted
- Hard-to-debug state (not searchable via `grep`, not visible in Git)
- Inconsistent app authoring patterns and migrations

## Goals

- **G1: Default filesystem persistence**: newly generated apps persist their primary data to the filesystem by default.
- **G2: App-scoped data directories**: every app has a single "source of truth" data directory, separate from source code.
- **G3: Simple formats**: JSON files by default; apps choose their own structure.
- **G4: Config-backed preferences**: user + app preferences are persisted to Moldable config files (not browser storage), via a shared `use-moldable-config`.

## Non-Goals (for MVP)

- Multi-device sync (Git/remote sync can be layered later)
- Full database layer (SQLite/Postgres) as the default
- Schema versioning / migration framework (apps can add if needed)
- Formal "record store" or "event log" abstractions
- End-to-end encryption at rest for all app data
- Strong sandbox enforcement for arbitrary app code (conventions + linting for now)

## Data Directory Specification

### Required Environment Variables

The desktop should launch apps with:

- `MOLDABLE_HOME` (absolute path), default `${os.homedir()}/.moldable`
- `MOLDABLE_APP_ID` (string, stable app id)
- `MOLDABLE_APP_DATA_DIR` (absolute path)

Default:

```
MOLDABLE_APP_DATA_DIR = ${MOLDABLE_HOME}/apps/${MOLDABLE_APP_ID}/data
```

### Fallback Behavior (Dev / Non-Moldable)

If `MOLDABLE_APP_DATA_DIR` is not set (running standalone):

- Use `process.cwd()/data` **only for developer convenience**
- Provide a prominent warning in logs and, optionally, a UI banner in dev mode

### Directory Structure

Apps choose their own file layout within `MOLDABLE_APP_DATA_DIR`. Examples:

- `todos.json` (single file with array)
- `entries/{id}.json` (one file per record)
- `meetings.json` + `settings.json` (multiple files)

No prescribed structure — keep it simple.

## `@moldable-ai/storage` (Shared Package)

A lightweight package providing:

### `getAppDataDir()`

Returns the app's data directory, respecting env vars with dev fallback:

```ts
import { getAppDataDir } from '@moldable-ai/storage'

const dataDir = getAppDataDir()
// In Moldable: ~/.moldable/apps/todo/data
// In dev: ./data
```

### `safePath(base, ...segments)`

Joins paths safely, preventing directory traversal:

```ts
import { safePath } from '@moldable-ai/storage'

// OK
safePath(dataDir, 'entries', `${id}.json`)

// Throws (rejects ..)
safePath(dataDir, '../../../etc/passwd')
```

### `sanitizeId(id)`

Validates/sanitizes IDs for use in filenames (alphanumeric + `-_`).

That's it. Apps use standard `fs.promises` for actual reads/writes.

## App Integration Pattern (Next.js)

### Principle: server writes, client reads via API

- Filesystem access happens in server code (Route Handlers / Server Actions)
- Client code calls those APIs

### Example: API route using `@moldable-ai/storage`

```ts
// src/app/api/todos/route.ts
import { getAppDataDir, safePath } from '@moldable-ai/storage'
import fs from 'fs/promises'

const todosPath = () => safePath(getAppDataDir(), 'todos.json')

export async function GET() {
  const data = await fs.readFile(todosPath(), 'utf-8').catch(() => '[]')
  return Response.json(JSON.parse(data))
}

export async function POST(req: Request) {
  const todos = await req.json()
  await fs.writeFile(todosPath(), JSON.stringify(todos, null, 2))
  return Response.json({ ok: true })
}
```

## Desktop Persistence

### Desktop Preferences

Persist user preferences via config files (not browser storage).

#### Config locations

- **Global**: `~/.moldable/config.json`
- **Per-app**: `~/.moldable/apps/${MOLDABLE_APP_ID}/config.json` (or a subpath under `MOLDABLE_APP_DATA_DIR`, e.g. `data/meta/app-config.json`)

The global config should remain the primary place for cross-app preferences (theme, model choices), while per-app config is for app-specific preferences (sort order, filters, UI options).

#### `use-moldable-config`

Add a shared hook (desktop + apps) named `use-moldable-config` that reads/writes preferences through a Moldable-managed config file, using:

- **Tauri commands** when running inside Moldable (authoritative)
- **Dev fallback** (optional): a local file under `process.cwd()` or an explicit env var, never `localStorage`

#### Examples of preferences to store

- last selected model
- reasoning effort per vendor
- theme preference

#### Explicit stance on `localStorage`

`localStorage` is **not allowed** for persistence in Moldable apps or the Moldable desktop UI. Any preference that should survive reloads must be stored in config files.

## Tooling & Linting

Extend `scripts/lint-moldable-app.js`:

- **Warn** if app source contains `localStorage` usage
- Optionally **suggest** using `@moldable-ai/storage` helpers

## Security Considerations

- **Path traversal protection**: `@moldable-ai/storage` helpers reject `..` and absolute paths
- **App isolation**: convention-based (apps stay within their data dir)
- **Secrets**: continue storing in `~/.moldable/.env` (gitignored), not in app data

## Acceptance Criteria

- **New apps** generated by the agent:
  - do not use `localStorage` for persistence
  - persist to `MOLDABLE_APP_DATA_DIR` (or `./data` in dev)
  - use `@moldable-ai/storage` helpers for paths
- **`apps/meetings`**:
  - meeting list + settings are loaded from filesystem (not `localStorage`)
- **Desktop**:
  - selected model / reasoning effort / theme are persisted via `use-moldable-config` into `~/.moldable/config.json` (not `localStorage`)
- **Linter**:
  - warns on `localStorage` usage in app code

## Open Questions

- How should large binary data (audio/video) be stored/rotated? (size limits, retention policies)
- Should chat history persistence be in scope for this PRD or separate?
