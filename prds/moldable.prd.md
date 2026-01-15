# Moldable: The Local-First Generative Desktop

> **A desktop application where software is summoned, shaped, and evolved through natural language.**

---

## Executive Summary

Moldable is a desktop application that transforms how people create and use software. Instead of installing pre-built applications, users describe what they need in natural language, and an AI agent builds it locally on their machine. The software evolves as the user's needs evolve—always personal, always malleable.

**One-line definition:**

> Moldable is the factory floor where personal software comes into existence.

---

## 1. Core Vision

### The Problem

Software today is:

- Built for the masses, not the individual
- Rigid and unchangeable by the end user
- Hosted on someone else's servers
- Expensive to maintain and subscribe to
- Disconnected from the user's actual workflow

### The Solution

Moldable inverts this model:

- Software is **generated** on demand
- Built **locally** on the user's machine
- **Shaped** through conversation
- **Evolved** as needs change
- **Discarded** when obsolete

The era of "one app for everyone" gives way to "your app, built for you."

---

## 2. Product Architecture

### 2.1 The Desktop App

Moldable is a native desktop application (Tauri) that provides:

```
┌─────────────────────────────────────────────────────────────────┐
│  Moldable Desktop                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                          │  │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │  │
│  │   │  App 1  │  │  App 2  │  │  App 3  │  │   ...   │   │  │
│  │   │(webview)│  │(webview)│  │(webview)│  │         │   │  │
│  │   └─────────┘  └─────────┘  └─────────┘  └─────────┘   │  │
│  │                                                          │  │
│  │                     Canvas / Grid View                   │  │
│  │                                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  💬 Floating Chat Interface (Orchestrator)               │  │
│  │  "Build me a meeting notes app like Granola..."          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Components:**

| Component          | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| **Desktop**        | The native Tauri container with full filesystem access       |
| **Canvas**         | Grid/widget view where generated apps live                   |
| **Chat Interface** | Floating overlay for agent interaction, visible on all views |
| **Webviews**       | Isolated containers for each generated app                   |
| **Agent Core**     | The orchestrator powered by Claude's Agent SDK               |

### 2.2 Generated Apps as Isolated Servers

Each app the agent creates runs as an **isolated local server**:

```
~/.moldable/
├── apps/
│   ├── meeting-notes-abc123/
│   │   ├── server/           # Node/Python/etc server code
│   │   ├── client/           # Frontend code
│   │   ├── moldable.json     # App manifest
│   │   └── .port             # Running port file
│   └── expense-tracker-def456/
│       └── ...
├── skills/
├── agents/
├── mcps/                     # Custom MCP server code
└── config/
    └── mcp.json              # MCP server connections
```

**Why isolated servers?**

- No hot reload of the Moldable desktop required
- Each app can use its own tech stack
- Crash isolation—one app failing doesn't kill others
- Easy to inspect, debug, and modify
- Simple IPC via localhost

The desktop app simply displays each app in a webview pointed at `localhost:<port>`.

### 2.3 Widgets (Portal Views)

Each app can expose **widgets**—small, glanceable views displayed on the main canvas before opening the full app.

```
┌─────────────────────────────────────────────────────────────────┐
│  Moldable Canvas                                                │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐ │
│  │ Meeting Notes │  │   Expenses    │  │    Habit Tracker    │ │
│  │ ───────────── │  │ ───────────── │  │ ─────────────────── │ │
│  │ 📅 Today: 2   │  │ 💰 $1,234     │  │ ✅ ✅ ✅ ⬜ ⬜ ⬜ ⬜ │ │
│  │ Next: 2:30pm  │  │ This month    │  │ 3 day streak 🔥     │ │
│  │ Product sync  │  │ ↑12% vs last  │  │                     │ │
│  │               │  │               │  │ [Log Today]         │ │
│  │    [Open]     │  │    [Open]     │  │       [Open]        │ │
│  └───────────────┘  └───────────────┘  └─────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────┐  ┌───────────────────┐│
│  │         Research Agent              │  │   Quick Note   +  ││
│  │ ─────────────────────────────────── │  └───────────────────┘│
│  │ Last run: 2h ago                    │                       │
│  │ "AI news summary - 5 articles"      │                       │
│  │                   [Run Now] [Open]  │                       │
│  └─────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

**Widget sizes:**

| Size     | Dimensions | Use Case                       |
| -------- | ---------- | ------------------------------ |
| `small`  | 1×1        | Status indicator, quick action |
| `medium` | 2×1        | Summary + one action           |
| `large`  | 2×2        | Rich preview, multiple actions |
| `wide`   | 3×1        | Timeline, list preview         |

**App structure with widgets:**

```
~/.moldable/apps/meeting-notes-abc123/
├── moldable.json           # App manifest with widget config
├── server/
├── client/
└── widgets/
    ├── summary.tsx         # Default widget component
    ├── upcoming.tsx        # "Next meeting" widget
    └── quick-record.tsx    # Quick action widget
```

**moldable.json with widget definitions:**

```json
{
  "name": "Meeting Notes",
  "icon": "📝",
  "widgets": [
    {
      "id": "summary",
      "name": "Today's Meetings",
      "component": "./widgets/summary.tsx",
      "sizes": ["small", "medium"],
      "defaultSize": "medium",
      "refreshInterval": 60000
    },
    {
      "id": "upcoming",
      "name": "Next Meeting",
      "component": "./widgets/upcoming.tsx",
      "sizes": ["small"],
      "refreshInterval": 30000
    },
    {
      "id": "quick-record",
      "name": "Quick Record",
      "component": "./widgets/quick-record.tsx",
      "sizes": ["small"],
      "actions": ["startRecording"]
    }
  ],
  "defaultWidget": "summary"
}
```

**Widget component (React):**

```tsx
// widgets/summary.tsx
import { WidgetAction, useWidgetData } from '@moldable-ai/widget-sdk'

export default function SummaryWidget({ size }: { size: 'small' | 'medium' }) {
  const { data, refresh } = useWidgetData('/api/today-summary')

  if (size === 'small') {
    return (
      <div className="widget-small">
        <span className="count">{data.meetingCount}</span>
        <span className="label">meetings today</span>
      </div>
    )
  }

  return (
    <div className="widget-medium">
      <h3>Today's Meetings</h3>
      <p>{data.meetingCount} scheduled</p>
      <p className="next">Next: {data.nextMeeting?.title}</p>
      <WidgetAction action="open" label="Open" />
    </div>
  )
}
```

**Widget capabilities:**

| Feature           | Description                                        |
| ----------------- | -------------------------------------------------- |
| **Data binding**  | Widgets fetch from app's API endpoints             |
| **Auto-refresh**  | Configurable refresh intervals                     |
| **Quick actions** | Buttons that trigger app functions without opening |
| **Deep links**    | Tap widget to open app at specific view            |
| **Resize**        | User can change widget size on canvas              |
| **Drag & drop**   | Rearrange widgets on the canvas                    |

**Agent creates widgets automatically:**

```
User: "Build me a habit tracker"

Agent: "Creating habit tracker with widgets:

        📊 Main app: Full habit management

        Widgets:
        ├── streak-summary (medium) - Shows current streaks
        ├── today-checklist (large) - Quick check-off
        └── add-habit (small) - Quick add button

        Which widget should be the default on your canvas?"
```

### 2.4 Workspaces

Workspaces allow users to organize their Moldable environment into separate contexts—like having different desks for different projects or life areas.

```
┌─────────────────────────────────────────────────────────────────┐
│  [◀]  📓 Scribo Languages  │  ● Personal ▾      [:3001] [↻]    │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                     Workspace selector (with color dot)
```

**Key Concepts:**

| Concept              | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| **Workspace**        | An isolated environment with its own apps, conversations, config |
| **Active Workspace** | The workspace currently displayed in the UI                      |
| **Shared Resources** | Skills and base `.env` shared across workspaces                  |
| **Instant Switch**   | All apps run always; switching workspaces is instant             |

**Example workspaces:**

- **Personal** — Default workspace for personal projects
- **Work** — Company tools, work-related apps
- **Side Project** — Isolated environment for a specific project

**Workspace Selector:**

The header displays a workspace badge with:

- Colored dot indicating the workspace
- Workspace name
- Dropdown to switch, create, or manage workspaces

**All Apps Run Always:**

Unlike traditional workspace models that stop/start processes, Moldable keeps all apps from all workspaces running simultaneously. Switching workspaces simply changes which apps are visible in the canvas—making switches instant with no boot time.

**Directory Structure with Workspaces:**

```
~/.moldable/
├── workspaces.json              # Workspace list + active workspace
├── shared/                      # Shared across all workspaces
│   ├── .env                     # Base environment variables
│   ├── skills/                  # Skills library (instruction & executable)
│   │   └── {repo-name}/         # Skills grouped by source repo
│   │       └── {skill-name}/    # Individual skill (SKILL.md or bin/)
│   └── config/
│       └── mcp.json             # Shared MCP servers (optional)
│
└── workspaces/
    ├── personal/                # Default workspace
    │   ├── config.json          # Apps, preferences, installed skills
    │   ├── .env                 # Workspace-specific env overrides
    │   ├── apps/                # App data (e.g., apps/scribo/data/)
    │   ├── conversations/       # Chat history
    │   └── config/
    │       ├── mcp.json         # Workspace-specific MCPs
    │       └── skills.json      # Which shared skills are "installed"
    │
    ├── work/
    │   └── ...
    └── my-project/
        └── ...
```

**workspaces.json Schema:**

```json
{
  "activeWorkspace": "personal",
  "workspaces": [
    {
      "id": "personal",
      "name": "Personal",
      "color": "#10b981",
      "createdAt": "2026-01-14T..."
    },
    {
      "id": "work",
      "name": "Work",
      "color": "#3b82f6",
      "createdAt": "2026-01-14T..."
    }
  ]
}
```

**Layered Environment Variables:**

Environment variables are resolved in layers:

1. `shared/.env` — Base values (API keys used everywhere)
2. `workspaces/{id}/.env` — Workspace overrides (project-specific keys)

```bash
# shared/.env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# workspaces/work/.env
OPENAI_API_KEY=sk-work-...  # Override for work context
COMPANY_API_KEY=secret      # Work-only key
```

**Shared Skills Model:**

Skills are installed once in `shared/skills/` and available to all workspaces. Each workspace's `config/skills.json` specifies which skills are "enabled" for that workspace:

```json
// workspaces/personal/config/skills.json
{
  "enabledSkills": ["translate-text", "audio-transcribe", "pdf-extract"],
  "disabledSkills": ["company-internal-tool"]
}
```

This is similar to having a shared pnpm installation—the executables exist once, but each project can choose which to use.

---

## 3. The Orchestrator

### 3.1 Chat Interface

A persistent, floating chat interface hovers above all views. This is the primary interaction surface.

**Capabilities:**

- Always accessible via keyboard shortcut (e.g., `Cmd+Shift+M`)
- Context-aware: knows which app/view is in focus
- Supports multi-turn conversations
- Shows agent reasoning and progress
- Can be collapsed but never hidden

### 3.2 Agent Architecture

Built on **Claude's Agent SDK**, the orchestrator follows this pattern:

```
User Intent
     │
     ▼
┌─────────────────┐
│  Moldable Agent │  ← Primary orchestrator
│  (Agent SDK)    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│              Tool Router                     │
├─────────────┬─────────────┬─────────────────┤
│   Skills    │    MCPs     │   Sub-Agents    │
│ (CLI tools) │ (protocols) │ (specialized)   │
└─────────────┴─────────────┴─────────────────┘
         │
         ▼
    File System
    (the source of truth)
```

### 3.3 Dynamic Context Discovery

Following [Cursor's approach](https://cursor.com/blog/dynamic-context-discovery), Moldable treats **files as the primitive for context**:

1. **Long outputs → Files**: Agent outputs are written to files, not crammed into context
2. **Chat history as files**: Conversations are persisted and searchable
3. **Skills as files**: Tool definitions live on disk, loaded dynamically
4. **Terminal sessions as files**: All CLI output is captured for agent access

This enables:

- Token-efficient agent runs
- Recoverable context after summarization
- Searchable history via `grep` and semantic search
- Debuggable agent behavior

---

## 4. Primitives: Skills, MCPs, and Agents

### 4.1 Skills

Skills are **CLI-invocable packages** that provide atomic capabilities:

```
~/.moldable/skills/
├── audio-record/
│   ├── skill.json          # Manifest with CLI interface
│   ├── bin/
│   │   └── record          # Executable
│   └── README.md
├── audio-transcribe/
├── text-summarize/
├── browser-navigate/
└── file-extract-table/
```

**skill.json manifest:**

```json
{
  "name": "audio-record",
  "version": "1.0.0",
  "description": "Record audio from system microphone",
  "cli": {
    "command": "./bin/record",
    "args": ["--duration", "--output", "--format"],
    "env": ["AUDIO_DEVICE"]
  },
  "inputs": {
    "duration": {
      "type": "integer",
      "description": "Recording duration in seconds"
    },
    "output": { "type": "string", "description": "Output file path" }
  },
  "outputs": {
    "file": { "type": "string", "description": "Path to recorded audio file" }
  },
  "permissions": ["microphone"]
}
```

**The agent invokes skills via CLI**, just like Cursor runs terminal commands:

```bash
~/.moldable/skills/audio-record/bin/record --duration 300 --output ./meeting.wav
```

### 4.2 MCPs (Model Context Protocol)

MCPs connect Moldable to external services via a simple JSON config (like Claude Code and Cursor):

**~/.moldable/config/mcp.json:**

```json
{
  "mcpServers": {
    "google-calendar": {
      "type": "http",
      "url": "https://calendar-mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${GOOGLE_CALENDAR_TOKEN}"
      }
    },
    "local-filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-filesystem", "/Users/me/Documents"]
    },
    "my-api-gateway": {
      "type": "stdio",
      "command": "node",
      "args": ["~/.moldable/mcps/my-api-gateway/server.js"]
    }
  }
}
```

**Custom MCP servers** live in `~/.moldable/mcps/`:

```
~/.moldable/mcps/
├── my-api-gateway/
│   ├── server.js           # MCP server code (stdio)
│   ├── package.json
│   └── README.md
└── local-ai-models/
    ├── server.py           # Python MCP server
    └── requirements.txt
```

**MCP types supported:**

| Type    | Description                    | Example                        |
| ------- | ------------------------------ | ------------------------------ |
| `http`  | Remote MCP server via HTTP     | SaaS integrations, hosted MCPs |
| `stdio` | Local process via stdin/stdout | Custom servers, CLI tools      |
| `sse`   | Server-sent events             | Streaming data sources         |

**Creating a custom MCP via chat:**

```
User: "Create an MCP that wraps my company's internal API"

Agent: "I'll create a custom MCP server for your internal API.

        Creating:
        ├─ [✓] Generate MCP server in ~/.moldable/mcps/company-api/
        ├─ [✓] Add to mcp.json config
        ├─ [→] Test connection

        What endpoints should I expose as tools?
        - GET /users
        - POST /tickets
        - ..."
```

**Adding a remote MCP:**

```
User: "Connect my Google Calendar"

Agent: "I'll add the Google Calendar MCP.

        1. Authorize with Google → [Connect Google]
        2. I'll store the token securely

        Once connected, I can:
        - Check your schedule before meetings
        - Create calendar events
        - Find free time slots"
```

Tokens are stored in `~/.moldable/config/secrets/` (gitignored) and referenced via `${VAR}` syntax.

### 4.3 Agents (Claude Agent SDK)

Agents are **code**, not just prompts. Built on the Claude Agent SDK, each agent is a full configuration with tools, models, permissions, hooks, and sub-agents.

```
~/.moldable/agents/
├── moldable-core/
│   └── agent.ts            # Primary orchestrator
├── finance/
│   └── agent.ts            # Financial tasks agent
├── research/
│   └── agent.ts            # News/research agent
└── code-review/
    └── agent.ts            # Code analysis agent
```

**Agent definition (TypeScript):**

```typescript
import {
  AgentDefinition,
  ClaudeAgentOptions,
  query,
} from '@anthropic-ai/claude-agent-sdk'

// Sub-agents can be delegated to for specialized tasks
const securityReviewer: AgentDefinition = {
  description: 'Security specialist for vulnerability detection',
  prompt: `You are a security expert. Focus on:
    - SQL injection, XSS, CSRF vulnerabilities
    - Exposed credentials and secrets
    - Insecure data handling`,
  tools: ['Read', 'Grep', 'Glob'],
  model: 'sonnet',
}

const translatorAgent: AgentDefinition = {
  description: 'Translate content between languages',
  prompt: 'You are an expert language translator.',
  tools: ['Read', 'Edit'],
  model: 'haiku', // Faster model for simpler tasks
}

// Main agent configuration
export const agentOptions: ClaudeAgentOptions = {
  model: 'opus',
  system_prompt: 'You are a helpful assistant...',

  // Tool access
  allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],

  // Permission handling
  permissionMode: 'default', // or "acceptEdits", "bypassPermissions"
  canUseTool: async (toolName, input) => {
    // Custom permission logic
    if (toolName === 'Bash' && input.command?.includes('rm -rf')) {
      return { behavior: 'deny', message: 'Dangerous command blocked' }
    }
    return { behavior: 'allow', updatedInput: input }
  },

  // Sub-agents for delegation
  agents: {
    'security-reviewer': securityReviewer,
    translator: translatorAgent,
  },

  // MCP connections (references config/mcp.json entries)
  mcpServers: ['google-calendar', 'notion'],

  // Structured output
  outputFormat: {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        result: { type: 'string' },
        confidence: { type: 'number' },
      },
    },
  },

  // Behavioral hooks
  hooks: {
    PreToolUse: [
      { hooks: [auditLogger] },
      { matcher: 'Bash', hooks: [blockDangerousCommands] },
    ],
  },

  maxTurns: 250,
}

// Execute the agent
export async function run(prompt: string) {
  for await (const message of query({ prompt, options: agentOptions })) {
    // Handle streaming messages...
  }
}
```

**Agent capabilities:**

| Capability            | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| **Tools**             | Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task |
| **Sub-agents**        | Delegate to specialized agents (Task tool)                     |
| **MCPs**              | Connect to external services                                   |
| **Permissions**       | Fine-grained control over tool access                          |
| **Hooks**             | Intercept and customize behavior (audit, block, transform)     |
| **Structured output** | JSON schema for programmatic results                           |
| **Model selection**   | opus/sonnet/haiku per agent or sub-agent                       |
| **Sessions**          | Resume conversations with context                              |

**Creating an agent via chat:**

```
User: "Create a research agent that finds AI news and translates to Spanish"

Agent: "I'll create a research agent with translation capability.

        Creating ~/.moldable/agents/ai-news-researcher/agent.ts:

        - Main agent: Uses Firecrawl MCP for web research
        - Sub-agent: Translator for Spanish output
        - Tools: Read, Write, Glob, Grep
        - Output: Markdown files with sources

        [Creates agent.ts with full SDK configuration]

        You can now use this agent: 'Run ai-news-researcher'"
```

**Running an agent:**

```typescript
// Moldable desktop invokes agents
import { run } from '~/.moldable/agents/ai-news-researcher/agent.ts'

await run('What are the latest developments in AI agents?')
// → Creates ai_news_en.md and ai_news_es.md
```

---

## 5. The Generation Flow

### 5.1 User Requests an App

```
User: "Build me a meeting notes app. It should record audio,
       transcribe it, and summarize the key points."
```

### 5.2 Agent Plans and Executes

The Moldable agent:

1. **Understands intent** → Meeting notes app with audio → text → summary
2. **Checks available skills** → `audio-record`, `audio-transcribe`, `text-summarize`
3. **Plans the app structure** → Server + frontend + skill integrations
4. **Generates code** → Writes files to `~/.moldable/apps/meeting-notes-xyz/`
5. **Starts the server** → Spawns process, captures port
6. **Registers in desktop** → App appears in the canvas

### 5.3 Agent Shows Progress

```
Agent: "I'll create a meeting notes app for you.

        Planning:
        ├─ [✓] Check required skills (audio-record, transcribe, summarize)
        ├─ [✓] Generate server code (Node.js + Express)
        ├─ [→] Generate frontend (React)
        └─ [ ] Start app and register

        Need any specific preferences for the UI?"
```

### 5.4 Iterative Refinement

```
User: "The summary is too long. Make it bullet points, max 5 items."

Agent: "Updating the summarization config..."
       [Modifies skill parameters in app code]
       [App hot reloads automatically]

       "Done. Summaries will now be 5 bullet points max."
```

---

## 6. File System as Source of Truth

### 6.1 Directory Structure

The Moldable directory uses a workspace-based structure with shared resources:

```
~/.moldable/
├── workspaces.json              # Workspace list + active workspace
│
├── shared/                      # Shared across ALL workspaces
│   ├── .env                     # Base environment variables
│   ├── skills/                  # Skills library (instruction & executable)
│   │   └── {repo-name}/         # Skills grouped by source repo
│   │       └── {skill-name}/    # Individual skill
│   │           ├── SKILL.md     # Instruction file (for instruction-based skills)
│   │           ├── skill.json   # Skill manifest (for executable skills)
│   │           └── bin/         # Executables (for executable skills)
│   ├── agents/                  # Agent code (Claude Agent SDK)
│   │   └── {agent-name}/
│   │       ├── agent.ts         # Agent definition & config
│   │       └── package.json
│   ├── mcps/                    # Custom MCP server code
│   │   └── {mcp-name}/
│   │       ├── server.js        # MCP server (stdio)
│   │       └── package.json
│   └── config/
│       └── mcp.json             # Shared MCP server connections
│
├── workspaces/                  # Per-workspace isolated data
│   └── {workspace-id}/          # e.g., "personal", "work"
│       ├── config.json          # Apps, preferences, installed skills
│       ├── .env                 # Workspace-specific env overrides
│       ├── apps/                # App data directories
│       │   └── {app-id}/
│       │       └── data/        # App-specific data (SQLite, files, etc.)
│       ├── conversations/       # Chat history for this workspace
│       └── config/
│           ├── mcp.json         # Workspace-specific MCP servers
│           └── skills.json      # Which shared skills are enabled
│
└── cache/                       # Temporary files (not workspace-scoped)
```

**Note:** Generated app _source code_ lives in the development workspace (e.g., `/Users/rob/moldable/apps/`), while app _runtime data_ lives in the Moldable workspace directory (`~/.moldable/workspaces/{id}/apps/{app-id}/data/`).

### 6.2 Why Files?

Following Cursor's philosophy:

> "Files have been a simple and powerful primitive to use, and a safer choice than yet another abstraction."

Benefits:

- **Inspectable**: Users can see exactly what was generated
- **Versionable**: Git-friendly structure
- **Portable**: Copy apps between machines
- **Debuggable**: Traditional tools work (grep, cat, vim)
- **Agent-friendly**: Agents reason well about files

---

## 7. Self-Evolution: The Moldable Agent Builds Moldable

### 7.1 Meta-Creation

The Moldable agent can create:

| Artifact   | How                                                       |
| ---------- | --------------------------------------------------------- |
| **Apps**   | Generate code in `~/.moldable/apps/`                      |
| **Skills** | Generate packages in `~/.moldable/skills/`                |
| **Agents** | Generate configs in `~/.moldable/agents/`                 |
| **MCPs**   | Create servers in `mcps/`, configure in `config/mcp.json` |

This means:

- Users can say "I need a skill that extracts tables from PDFs"
- The agent builds the skill, installs dependencies, registers it
- Future app generations can use that skill

### 7.2 Example: Building a Skill

```
User: "I need a skill to convert markdown to PDF"

Agent: "I'll create a new skill for markdown → PDF conversion.

        Creating:
        ├─ [✓] Generate skill manifest
        ├─ [✓] Create converter script (using Pandoc)
        ├─ [→] Install dependencies
        └─ [ ] Test skill

        [Writes to ~/.moldable/skills/markdown-to-pdf/]

        Done! The 'markdown-to-pdf' skill is now available.
        You can use it in future apps or invoke it directly."
```

### 7.3 Hot Reloading

When the agent modifies:

- **Apps**: The webview refreshes automatically (dev server with HMR)
- **Skills**: The skill router reloads the manifest
- **Agents**: The orchestrator re-imports the agent module
- **MCPs**: Connections refresh when `mcp.json` changes

No desktop app restart required.

---

## 8. Technical Implementation

### 8.1 Desktop Technology: Tauri v2

The Moldable desktop is built with **Tauri v2** + React 19 + TypeScript:

```
moldable-desktop/
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # App entry, window management
│   │   ├── commands.rs     # IPC commands (file ops, process spawn)
│   │   ├── agent.rs        # Agent SDK bridge
│   │   └── widgets.rs      # Widget lifecycle management
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # React frontend
│   ├── app.tsx
│   ├── components/
│   │   ├── canvas.tsx      # Widget grid layout
│   │   ├── chat.tsx        # Floating chat interface
│   │   ├── app-webview.tsx # Webview container for apps
│   │   └── ui/             # shadcn components
│   ├── hooks/
│   └── lib/
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

**Why Tauri over Electron:**

| Aspect       | Tauri v2                | Electron                      |
| ------------ | ----------------------- | ----------------------------- |
| Binary size  | ~10-15 MB               | ~150+ MB                      |
| Memory usage | ~50 MB                  | ~200+ MB                      |
| Security     | Rust + allowlist        | Node.js (more attack surface) |
| Webview      | System native           | Bundled Chromium              |
| IPC          | Type-safe Rust commands | Node.js bridge                |

**Desktop tech stack:**

| Layer               | Technology                 |
| ------------------- | -------------------------- |
| **Framework**       | Tauri v2 (Rust backend)    |
| **Frontend**        | React 19 + TypeScript      |
| **Bundler**         | Vite                       |
| **Styling**         | Tailwind CSS 4 + shadcn/ui |
| **State**           | TanStack Query             |
| **Package Manager** | pnpm                       |

**Tauri capabilities needed:**

```json
// tauri.conf.json
{
  "tauri": {
    "allowlist": {
      "fs": { "all": true, "scope": ["$HOME/.moldable/**"] },
      "shell": { "all": true },
      "process": { "all": true },
      "window": { "all": true },
      "http": { "all": true, "scope": ["http://localhost:*"] }
    }
  }
}
```

### 8.2 Default App Tech Stack

When Moldable generates apps, it uses these defaults (similar to `AGENTS.md` conventions):

**Default stack for generated apps:**

| Layer               | Technology                 | Notes                         |
| ------------------- | -------------------------- | ----------------------------- |
| **Framework**       | Next.js 16                 | App Router, server components |
| **UI**              | React 19 + TypeScript      | Strict mode                   |
| **Styling**         | Tailwind CSS 4 + shadcn/ui | Semantic colors               |
| **Database**        | PostgreSQL + Prisma        | Via Docker/Tilt or Neon       |
| **API**             | tRPC + TanStack Query v5   | Type-safe end-to-end          |
| **Auth**            | BetterAuth                 | When needed                   |
| **Testing**         | Vitest                     | Node + DOM environments       |
| **Package Manager** | pnpm                       | Workspace-aware               |

**The agent follows these conventions:**

```typescript
// Generated apps include an AGENTS.md with conventions
const appConventions = {
  fileNaming: 'kebab-case', // e.g., user-profile.tsx, not UserProfile.tsx
  directoryNaming: 'kebab-case', // e.g., components/user-card/
  serverClientSplit: true, // Explicit /server.ts and /react.ts
  routes: 'typed', // Use routes helper, not string literals
  enums: 'prefer', // Enums over union strings
  statusFields: 'enum', // Import from lib/db/types
  uiComponents: 'shadcn',
  icons: 'untitled-ui', // Lucide for loading only
  styling: 'semantic', // bg-background, not bg-gray-100
}
```

**File naming examples:**

```
✅ Correct (kebab-case)          ❌ Wrong (PascalCase/camelCase)
├── user-profile.tsx            ├── UserProfile.tsx
├── api-client.ts               ├── apiClient.ts
├── auth-provider.tsx           ├── AuthProvider.tsx
├── use-auth.ts                 ├── useAuth.ts
└── components/                 └── components/
    └── user-card/                  └── UserCard/
        ├── index.tsx                   ├── index.tsx
        └── user-card.test.ts           └── UserCard.test.ts
```

**Stack can be nudged per app:**

```
User: "Build me a data analysis dashboard"

Agent: "For data analysis, I'll use:

        ├── Python + FastAPI (better for pandas/numpy)
        ├── React frontend (same as default)
        ├── PostgreSQL (via Docker)

        Or would you prefer the standard Next.js stack?"
```

**Common overrides:**

| Use Case      | Override                  |
| ------------- | ------------------------- |
| Data analysis | Python + FastAPI + Pandas |
| CLI tool      | Node.js or Python         |
| ML/AI app     | Python + FastAPI          |
| Simple static | Vite + React (no Next.js) |
| API-only      | Express or Hono           |

### 8.3 Agent Runtime

Built on the **Claude Agent SDK** (TypeScript):

```typescript
import { query, AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { loadMcpConfig } from "./config";

// Load MCP servers from config/mcp.json
const mcpServers = await loadMcpConfig();

// Sub-agents for specialized tasks
const appBuilderAgent: AgentDefinition = {
  description: "Creates and modifies Moldable apps",
  prompt:
    "You are an expert app developer. Create apps with React frontends and Node.js backends.",
  tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  model: "opus",
};

const skillBuilderAgent: AgentDefinition = {
  description: "Creates CLI-based skills",
  prompt: "You create reusable skills as CLI tools with proper manifests.",
  tools: ["Read", "Write", "Edit", "Bash"],
  model: "sonnet",
};

// Main Moldable orchestrator
export async function runMoldable(prompt: string) {
  for await (const message of query({
    prompt,
    options: {
      model: "opus",
      system_prompt: `You are Moldable, a personal software factory...`,

      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
      permissionMode: "default",

      agents: {
        "app-builder": appBuilderAgent,
        "skill-builder": skillBuilderAgent,
      },

      mcpServers,
      maxTurns: 250,
      cwd: "~/.moldable",
    },
  })) {
    // Stream messages to UI
    yield message;
  }
}
```

**Message types from the SDK:**

| Type        | Description                                       |
| ----------- | ------------------------------------------------- |
| `system`    | Session init, available tools                     |
| `assistant` | Claude's responses and tool calls                 |
| `user`      | User messages (for multi-turn)                    |
| `result`    | Final result with cost, tokens, structured output |

### 8.4 App Runtime

Each generated app runs as:

```javascript
// Moldable starts each app as a child process
const app = spawn('npm', ['run', 'dev'], {
  cwd: `~/.moldable/apps/${appId}/server`,
  env: {
    PORT: assignedPort,
    MOLDABLE_APP_ID: appId,
    MOLDABLE_SKILLS_PATH: '~/.moldable/skills',
  },
})

// Desktop displays via webview
webview.loadURL(`http://localhost:${assignedPort}`)
```

### 8.5 IPC Between Desktop and Apps

Apps can communicate with the desktop via a local API:

```typescript
// App requests a skill invocation
await fetch('http://localhost:MOLDABLE_PORT/api/skills/invoke', {
  method: 'POST',
  body: JSON.stringify({
    skill: 'audio-transcribe',
    input: { file: '/path/to/audio.wav' },
  }),
})
```

### 8.6 App Persistence & Data Layer

Apps that need persistence can use **local containers** or **remote services**—the agent chooses based on requirements.

#### Tiltfile-Based Local Development

Each app can include a `Tiltfile` for orchestrating local services:

```
~/.moldable/apps/expense-tracker-abc123/
├── server/
├── client/
├── Tiltfile                    # Local service orchestration
├── docker-compose.yml          # Container definitions
├── moldable.json
└── data/
    └── postgres/               # Local volume mount
```

**Example Tiltfile:**

```python
# Tiltfile for expense-tracker

# Start Postgres container
docker_compose('./docker-compose.yml')

# Run the app server with live reload
local_resource(
    'server',
    serve_cmd='npm run dev',
    serve_dir='./server',
    deps=['./server/src'],
    resource_deps=['postgres']
)

# Run the frontend
local_resource(
    'client',
    serve_cmd='npm run dev',
    serve_dir='./client',
    deps=['./client/src']
)
```

**Example docker-compose.yml:**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: moldable
      POSTGRES_PASSWORD: local-dev
      POSTGRES_DB: expense_tracker
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    ports:
      - '5432:5432'
```

#### Persistence Modes

The agent offers different persistence strategies based on the app's needs:

| Mode                  | When to Use                      | Implementation               |
| --------------------- | -------------------------------- | ---------------------------- |
| **File-based**        | Simple data, JSON/SQLite         | Write to `./data/` directory |
| **Local Postgres**    | Relational data, complex queries | Docker container + Tiltfile  |
| **Local Redis**       | Caching, sessions, queues        | Docker container             |
| **Remote DB (Neon)**  | Multi-device sync, collaboration | Neon serverless Postgres     |
| **Remote KV (Turso)** | Edge-friendly, SQLite-compatible | Turso libSQL                 |

**Agent decision flow:**

```
User: "Build me an expense tracker with reports"

Agent: "This app needs to store transactions and generate reports.

        For persistence, I recommend:

        1. 🐘 Local Postgres (via Docker)
           - Fast, full SQL support
           - Data stays on your machine
           - Works offline

        2. ☁️ Neon (remote Postgres)
           - Access from any device
           - Automatic backups
           - Requires account setup

        Which do you prefer? [Local] [Neon] [Decide for me]"
```

#### Remote Service Integration

For apps that need remote persistence (multi-device, collaboration, etc.):

**Neon (Serverless Postgres):**

```
User: "Use Neon for the database"

Agent: "Setting up Neon connection...

        1. Create a project at neon.tech (or I can use your existing one)
        2. Store connection string securely

        [Connect Neon Account] [Create New Project]"
```

The connection string is stored in `~/.moldable/config/secrets/` (gitignored):

```
~/.moldable/
├── config/
│   ├── settings.json           # Tracked
│   └── secrets/                # .gitignored
│       └── expense-tracker.env # DATABASE_URL=postgres://...
```

**Supported remote services:**

| Service         | Type                      | Use Case                       |
| --------------- | ------------------------- | ------------------------------ |
| **Neon**        | Postgres                  | Relational data, full SQL      |
| **Turso**       | libSQL/SQLite             | Edge-friendly, embedded feel   |
| **Supabase**    | Postgres + Auth + Storage | Full backend-as-a-service      |
| **PlanetScale** | MySQL                     | MySQL-compatible workloads     |
| **Upstash**     | Redis/Kafka               | Caching, queues, rate limiting |

#### Moldable Manages the Lifecycle

The desktop handles container lifecycle automatically:

```javascript
// When app is opened
await tilt.up(appPath) // Starts Postgres, etc.

// When app is closed
await tilt.down(appPath) // Stops containers, preserves data

// Status in desktop UI
// [expense-tracker] 🟢 Running | 🐘 Postgres | 📊 1.2GB data
```

**Data survives everything:**

- App restarts → Data persists (volume mounts)
- Git rollback → Data preserved (volumes not in git)
- Machine restart → Tilt restarts containers

#### Example: Meeting Notes with Persistence

```
User: "Build me a meeting notes app that syncs across my devices"

Agent: "I'll create a meeting notes app with cloud sync.

        Stack:
        ├── Server: Node.js + Express
        ├── Frontend: React
        ├── Database: Neon (Postgres) — for cross-device sync
        ├── Audio: Local file storage
        └── Search: SQLite FTS (local, for speed)

        The app will:
        - Store audio files locally (too large for cloud)
        - Sync notes and transcripts to Neon
        - Work offline, sync when connected

        [Create App] [Adjust Stack]"
```

---

## 9. Example: Building Granola (Meeting Notes)

### User Request

```
"Build me a meeting notes app like Granola. It should:
- Record audio when I'm in a meeting
- Transcribe the audio in real-time
- Summarize key points and action items
- Let me edit and organize notes"
```

### Required Skills

| Skill              | Purpose                         |
| ------------------ | ------------------------------- |
| `audio-record`     | Capture system/mic audio        |
| `audio-transcribe` | Convert audio to text (Whisper) |
| `text-summarize`   | Extract key points (Claude)     |
| `calendar-detect`  | Know when meetings start (MCP)  |

### Generated Structure

```
~/.moldable/apps/meeting-notes-a1b2c3/
├── moldable.json
├── server/
│   ├── package.json
│   ├── index.ts              # Express server
│   ├── routes/
│   │   ├── recording.ts      # Start/stop recording
│   │   ├── transcription.ts  # Real-time transcription
│   │   └── notes.ts          # CRUD for notes
│   └── services/
│       ├── recorder.ts       # Invokes audio-record skill
│       ├── transcriber.ts    # Invokes audio-transcribe skill
│       └── summarizer.ts     # Invokes text-summarize skill
├── client/
│   ├── package.json
│   ├── src/
│   │   ├── app.tsx
│   │   ├── components/
│   │   └── hooks/
│   └── public/
└── data/
    └── notes/                # Stored meeting notes
```

---

## 10. Permissions Model

### 10.1 Principle of Least Privilege

Each skill, app, and agent declares required permissions:

```json
{
  "permissions": [
    "microphone",
    "filesystem:read:~/Documents",
    "filesystem:write:~/.moldable/apps/meeting-notes/data",
    "network:localhost"
  ]
}
```

### 10.2 User Consent Flow

```
Agent: "The meeting notes app needs these permissions:

        🎤 Microphone access (for recording)
        📁 Read ~/Documents (for importing files)
        💾 Write to app data folder

        [Grant All] [Review Each] [Deny]"
```

### 10.3 Runtime Sandboxing

Apps run with restricted capabilities:

- No network access unless explicitly granted
- Filesystem access limited to declared paths
- System calls filtered via Tauri's security model

---

## 11. Local-First Philosophy

### 11.1 Why Local?

| SaaS Model                 | Moldable Model            |
| -------------------------- | ------------------------- |
| Your data on their servers | Your data on your machine |
| Monthly subscriptions      | One-time creation         |
| Features they decide       | Features you decide       |
| Vendor lock-in             | Full portability          |
| Privacy concerns           | Complete privacy          |

### 11.2 Optional Cloud

Users who want hosting can:

- Export apps as standalone packages
- Deploy to Vercel/Netlify/etc
- Share skill packages with others
- Sync configs across machines

But cloud is **opt-in**, never required.

---

## 12. Git-Native Version Control

The entire `~/.moldable/` directory is a **Git repository**. This provides versioning, backup, rollback, and collaboration—all with a tool users already trust.

### 12.1 Why Git?

| Need               | Git Solution                      |
| ------------------ | --------------------------------- |
| Version history    | Every change is a commit          |
| Rollback           | `git checkout` to any prior state |
| Backup             | Push to GitHub/GitLab             |
| Releases           | Git tags for snapshots            |
| Multi-machine sync | Pull from remote                  |
| Collaboration      | Share repos, fork apps            |
| Audit trail        | Full history of agent changes     |

Git is the **universal version control primitive**. Rather than inventing a new system, Moldable leverages what already works.

### 12.2 Repository Structure

```
~/.moldable/                    # Git root
├── .git/                       # Git internals
├── .gitignore                  # Exclude cache, secrets, runtime files
├── apps/
│   ├── meeting-notes-abc123/
│   └── expense-tracker-def456/
├── skills/
├── agents/
├── mcps/
├── context/                    # Chat history, tool outputs
├── config/
│   ├── settings.json
│   └── permissions.json
└── README.md                   # Auto-generated index of your Moldable
```

**What's tracked:**

- All generated apps, skills, agents, MCPs
- Configuration and permissions
- Chat history and context (searchable via git log)

**What's ignored (.gitignore):**

- `cache/` — Temporary files
- `*/node_modules/` — Dependencies (reinstallable)
- `*/.port` — Runtime state
- `config/api-keys.json` — Secrets (handled separately)

### 12.3 Automatic Commits

The agent commits after meaningful changes:

```
Agent: "I've created your meeting notes app."

        [Auto-commit: "feat(apps): create meeting-notes-abc123

        - Added Express server with transcription routes
        - Added React frontend with note editor
        - Integrated audio-record and text-summarize skills"]
```

**Commit conventions:**

- `feat(apps):` — New app created
- `fix(apps):` — App modification/bugfix
- `feat(skills):` — New skill added
- `refactor(agents):` — Agent config changed
- `chore(config):` — Settings updated

Users can also manually commit via chat:

```
User: "Save this as a checkpoint"

Agent: "Created checkpoint: 'Working meeting notes v1'
        [git tag checkpoint-2026-01-08-meeting-notes]"
```

### 12.4 GitHub Integration

Optional cloud backup via GitHub (or GitLab, etc.):

```
User: "Connect this to my GitHub"

Agent: "I'll set up GitHub sync for your Moldable.

        1. Create a private repo 'my-moldable' on GitHub
        2. Add it as remote origin
        3. Push your current state

        [Authorize GitHub] [Skip for now]"
```

**Once connected:**

- `moldable push` — Sync to GitHub
- `moldable pull` — Sync from GitHub (new machine setup)
- `moldable clone <repo>` — Import someone else's setup

### 12.5 Releases & Snapshots

Create named releases for important milestones:

```
User: "This setup is perfect. Save it as a release."

Agent: "Creating release 'v1.0.0 - My Productivity Suite'

        Included:
        ├── 3 apps (meeting-notes, expense-tracker, habit-tracker)
        ├── 7 skills
        ├── 2 custom agents
        └── All configurations

        [Create Release] [Add Release Notes]"
```

Releases are Git tags with rich metadata:

```bash
git tag -a v1.0.0 -m "My Productivity Suite

Apps:
- meeting-notes: Audio transcription and summaries
- expense-tracker: Receipt scanning and categorization
- habit-tracker: Daily habits with streaks

Created: 2026-01-08"
```

### 12.6 Rollback & Recovery

**Rollback an app:**

```
User: "The meeting notes app was better yesterday"

Agent: "I found 3 recent versions of meeting-notes:

        1. Today 2:30pm - Added dark mode
        2. Today 10:15am - Fixed transcription bug
        3. Yesterday 4:00pm - Initial creation

        Which version should I restore?"

User: "The 10:15am one"

Agent: "Restored meeting-notes to 'Fixed transcription bug'
        [git checkout abc123 -- apps/meeting-notes-abc123/]"
```

**Rollback everything:**

```
User: "Something broke. Go back to last week."

Agent: "Rolling back to checkpoint from Jan 1, 2026...

        ⚠️ This will affect:
        - 2 apps modified since then
        - 1 new skill added

        [Rollback] [Cancel] [Show Diff First]"
```

### 12.7 Multi-Machine Sync

Set up Moldable on a new machine:

```bash
# On new machine
moldable init --from github.com/user/my-moldable

# Or via the app
User: "Set up from my GitHub"

Agent: "Cloning your Moldable from GitHub...

        Restored:
        ├── 5 apps
        ├── 12 skills
        ├── 3 agents
        └── All preferences

        Installing dependencies...
        Starting apps...

        Welcome back! Everything is ready."
```

### 12.8 Collaboration & Sharing

**Share a skill:**

```
User: "Share my pdf-to-markdown skill"

Agent: "I can share this skill as:

        1. GitHub Gist (quick share link)
        2. Separate repo (for updates)
        3. Export as .zip

        Which do you prefer?"
```

**Import shared content:**

```
User: "Install the skill from github.com/alice/cool-skill"

Agent: "Importing 'cool-skill' from Alice's repo...

        Skill: pdf-table-extractor
        Description: Extracts tables from PDFs to CSV
        Permissions: filesystem:read

        [Install] [View Source First]"
```

**Fork someone's entire setup:**

```
User: "I want to start from Sarah's productivity setup"

Agent: "Cloning Sarah's Moldable as your base...

        This includes:
        - 4 apps (you can modify or delete)
        - 8 skills
        - Custom finance agent

        Your version will be independent—changes won't affect Sarah's.

        [Clone Setup] [Preview First]"
```

### 12.9 Git UI in Moldable

The desktop includes a simple Git interface:

```
┌─────────────────────────────────────────────────────────────┐
│  History                                             [Sync] │
├─────────────────────────────────────────────────────────────┤
│  ● Today                                                    │
│  │ 2:30pm  feat(apps): add dark mode to meeting-notes      │
│  │ 10:15am fix(apps): fix transcription in meeting-notes   │
│  │                                                          │
│  ● Yesterday                                                │
│  │ 4:00pm  feat(apps): create meeting-notes-abc123         │
│  │ 2:00pm  feat(skills): add audio-transcribe              │
│  │                                                          │
│  ○ Jan 6 — Release: v1.0.0 "Initial Setup"                 │
└─────────────────────────────────────────────────────────────┘
```

Users don't need to know Git—the UI handles it. But power users can drop to terminal anytime.

---

## 13. MVP Scope

### Phase 1: Foundation (4-6 weeks)

- [ ] Tauri desktop with webview grid
- [ ] Floating chat interface
- [ ] Claude Agent SDK integration
- [ ] Basic file system tools (read, write, list, search)
- [ ] CLI command execution
- [ ] Single app generation and display
- [ ] Widget canvas with drag-and-drop layout
- [ ] Git repo initialization (`~/.moldable/` as repo)
- [ ] Automatic commits on agent changes

### Phase 2: Skills System (4-6 weeks)

- [ ] Skill manifest format and loader
- [ ] 5 starter skills:
  - `audio-record`
  - `audio-transcribe` (Whisper)
  - `text-summarize` (Claude)
  - `file-read`
  - `browser-screenshot`
- [ ] Skill invocation via agent
- [ ] Skill installation from disk
- [ ] Tiltfile generation for apps with services
- [ ] Docker/Postgres local persistence support
- [ ] Widget SDK (`@moldable-ai/widget-sdk`)
- [ ] Widget auto-generation for new apps

### Phase 3: Self-Evolution (4-6 weeks)

- [ ] Agent can create new skills
- [ ] Agent can create new agents
- [ ] Hot reload for all artifact types
- [ ] MCP integration framework
- [ ] Context persistence (Cursor pattern)
- [ ] GitHub remote setup via chat
- [ ] Push/pull sync commands
- [ ] Remote DB integration (Neon, Turso, Supabase)

### Phase 4: Polish (4-6 weeks)

- [ ] Permission system UI
- [ ] App management (start, stop, delete)
- [ ] Settings and preferences
- [ ] Error recovery and debugging tools
- [ ] Documentation and onboarding
- [ ] Git history UI (timeline view)
- [ ] Rollback and release tagging

---

## 14. Success Metrics

| Metric                            | Target             |
| --------------------------------- | ------------------ |
| Time to first app                 | < 5 minutes        |
| App generation success rate       | > 80%              |
| User satisfaction (feedback loop) | > 4/5 stars        |
| Skills created by users           | 10+ in first month |
| Apps created per user per week    | 3+                 |

---

## 15. Open Questions

### Product Questions

- How much should the agent explain vs. just do?
- What's the right balance of autonomy vs. control?
- How granular should auto-commits be? (every change vs. logical units)
- What's the right default for GitHub sync? (opt-in vs. nudge)

### Technical Questions

- What's the ideal tech stack for generated apps?
- How do we handle skill dependencies and conflicts?
- What's the right isolation model for apps?
- How do we enable offline-first operation?

### Safety Questions

- How do we prevent malicious skill installation?
- What guardrails prevent data exfiltration?
- How do we audit what agents have done?
- What's the kill switch for runaway agents?

---

## 16. Competitive Landscape

| Product            | Relationship to Moldable                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| **Cursor**         | Inspiration for file-based context; Moldable for end-users, not developers |
| **Claude Desktop** | Chat-only; Moldable adds persistent apps and local execution               |
| **Replit Agent**   | Cloud-hosted; Moldable is local-first                                      |
| **v0.dev**         | UI generation only; Moldable creates full apps                             |
| **GPT Store**      | Distributes apps; Moldable creates them personally                         |

---

## 17. The End State

Moldable becomes:

- Your **personal software factory**
- That **learns** your preferences
- **Assembles** your tools
- **Evolves** with your needs

Software is no longer something you consume.

It's something you **grow**.

---

## Appendix A: Inspiration Sources

- [Browser as Generative Surface](<./browser_as_app_os_initial_spec_mvp%20(1).md>) — Original vision document
- [Cursor: Dynamic Context Discovery](https://cursor.com/blog/dynamic-context-discovery) — File-based context patterns
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) — Agent runtime
- [Claude Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — Skill architecture

## Appendix B: Example Moldable Core Agent (TypeScript)

```typescript
// ~/.moldable/agents/moldable-core/agent.ts
import {
  AgentDefinition,
  ClaudeAgentOptions,
  query,
} from '@anthropic-ai/claude-agent-sdk'

// Sub-agents for specialized tasks
const appBuilder: AgentDefinition = {
  description: 'Creates and modifies Moldable applications',
  prompt: `You are an expert full-stack developer. Create apps with:
    - React/Vue frontends with modern UI
    - Node.js/Python backends
    - Proper error handling and types
    - Tiltfile + Docker for persistence when needed`,
  tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  model: 'opus',
}

const skillBuilder: AgentDefinition = {
  description: 'Creates reusable CLI-based skills',
  prompt: `You create skills as CLI tools with:
    - skill.json manifest
    - Executable in bin/
    - Clear input/output contracts`,
  tools: ['Read', 'Write', 'Edit', 'Bash'],
  model: 'sonnet',
}

const agentBuilder: AgentDefinition = {
  description: 'Creates new specialized agents',
  prompt: `You create agents using the Claude Agent SDK with:
    - Proper AgentDefinition
    - Tool restrictions appropriate to the task
    - Sub-agents for delegation when useful`,
  tools: ['Read', 'Write', 'Edit'],
  model: 'sonnet',
}

export const moldableOptions: ClaudeAgentOptions = {
  model: 'opus',
  system_prompt: `You are Moldable, a personal software factory.

Your purpose: help users create, modify, and manage personal software locally.

## What you can create:
- Apps in ~/.moldable/apps/ (React + Node servers)
- Skills in ~/.moldable/skills/ (CLI tools)
- Agents in ~/.moldable/agents/ (TypeScript with SDK)
- MCPs in ~/.moldable/mcps/ (custom servers)

## Principles:
1. Local-first: Everything runs on the user's machine
2. Files as truth: Persist everything to filesystem
3. Composable: Build on existing skills and primitives
4. Delegate: Use sub-agents for specialized tasks
5. Iterate: Start simple, refine through conversation`,

  allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
  permissionMode: 'default',

  agents: {
    'app-builder': appBuilder,
    'skill-builder': skillBuilder,
    'agent-builder': agentBuilder,
  },

  maxTurns: 250,
  cwd: process.env.MOLDABLE_HOME || '~/.moldable',
}

export async function* run(prompt: string) {
  for await (const message of query({ prompt, options: moldableOptions })) {
    yield message
  }
}
```
