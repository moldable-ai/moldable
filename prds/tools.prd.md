# Agent Tools Reference

This document describes the tools available to the Moldable AI agent. These are the primitives the agent uses to read, write, search, and interact with the user's system.

> **Implementation Note**: Tool names in this PRD use camelCase (e.g., `readFile`) which maps to the actual Cursor tool names (e.g., `read_file`). The tool handlers should support both conventions.

---

## File Operations

### `readFile`

Read the contents of a file from the filesystem.

| Parameter | Type     | Required | Description                                          |
| --------- | -------- | -------- | ---------------------------------------------------- |
| `path`    | `string` | ✓        | Path to the file (absolute or relative to workspace) |
| `offset`  | `number` |          | Line number to start reading from (1-indexed)        |
| `limit`   | `number` |          | Maximum number of lines to read                      |

**Output:**

```typescript
{
  success: boolean
  path: string
  content?: string    // File contents with line numbers: "1|line content\n2|..."
  error?: string
}
```

**Notes:**

- Can read image files (jpeg, png, gif, webp)
- Lines are numbered in output: `LINE_NUMBER|LINE_CONTENT`
- Empty files return `'File is empty.'`

---

### `writeFile`

Write or overwrite a file on the filesystem.

| Parameter  | Type     | Required | Description                   |
| ---------- | -------- | -------- | ----------------------------- |
| `path`     | `string` | ✓        | Path to the file to write     |
| `contents` | `string` | ✓        | Contents to write to the file |

**Output:**

```typescript
{
  success: boolean
  path: string
  error?: string
}
```

**Notes:**

- Overwrites existing files
- Creates parent directories if needed
- Prefer editing existing files over creating new ones

---

### `editFile`

Perform surgical string replacement in a file.

| Parameter    | Type      | Required | Description                                |
| ------------ | --------- | -------- | ------------------------------------------ |
| `path`       | `string`  | ✓        | Path to the file to modify                 |
| `oldString`  | `string`  | ✓        | Exact text to find and replace             |
| `newString`  | `string`  | ✓        | Replacement text                           |
| `replaceAll` | `boolean` |          | Replace all occurrences (default: `false`) |

**Output:**

```typescript
{
  success: boolean
  path: string
  error?: string
}
```

**Notes:**

- `oldString` must be unique in the file (unless using `replaceAll`)
- Preserves exact indentation
- Fails if `oldString` is not found

---

### `deleteFile`

Delete a file from the filesystem.

| Parameter | Type     | Required | Description                |
| --------- | -------- | -------- | -------------------------- |
| `path`    | `string` | ✓        | Path to the file to delete |

**Output:**

```typescript
{
  success: boolean
  path: string
  error?: string
}
```

---

### `fileExists`

Check if a file or directory exists.

| Parameter | Type     | Required | Description   |
| --------- | -------- | -------- | ------------- |
| `path`    | `string` | ✓        | Path to check |

**Output:**

```typescript
{
  exists: boolean
  path: string
  isDirectory?: boolean
}
```

---

### `listDirectory`

List contents of a directory.

| Parameter     | Type       | Required | Description                                                  |
| ------------- | ---------- | -------- | ------------------------------------------------------------ |
| `path`        | `string`   | ✓        | Path to the directory                                        |
| `ignoreGlobs` | `string[]` |          | Glob patterns to exclude (e.g., `["node_modules", "*.log"]`) |

**Output:**

```typescript
{
  success: boolean
  path: string
  items?: Array<{
    name: string
    type: 'file' | 'directory'
  }>
  error?: string
}
```

**Notes:**

- Does not show dot-files or dot-directories by default
- Items are sorted alphabetically

---

## Search Operations

### `grep`

Search file contents using regex patterns (ripgrep-based).

| Parameter         | Type      | Required | Description                                                 |
| ----------------- | --------- | -------- | ----------------------------------------------------------- |
| `pattern`         | `string`  | ✓        | Regex pattern to search for                                 |
| `path`            | `string`  |          | File or directory to search (default: workspace root)       |
| `fileType`        | `string`  |          | File type filter (e.g., `"js"`, `"py"`, `"tsx"`)            |
| `glob`            | `string`  |          | Glob pattern filter (e.g., `"*.config.ts"`)                 |
| `outputMode`      | `string`  |          | `"content"` (default), `"files_with_matches"`, or `"count"` |
| `contextBefore`   | `number`  |          | Lines to show before each match (`-B`)                      |
| `contextAfter`    | `number`  |          | Lines to show after each match (`-A`)                       |
| `context`         | `number`  |          | Lines before and after each match (`-C`)                    |
| `caseInsensitive` | `boolean` |          | Case-insensitive search (default: `false`)                  |
| `multiline`       | `boolean` |          | Enable multiline matching (default: `false`)                |
| `limit`           | `number`  |          | Maximum results to return                                   |

**Output:**

```typescript
{
  success: boolean
  matches: Array<{
    file: string
    line: number
    content: string
    context?: string[]
  }>
  totalMatches: number
  truncated: boolean
}
```

**Notes:**

- Respects `.gitignore` and `.cursorignore`
- Use `\\(` to match literal parentheses
- Results are capped for performance

---

### `globFileSearch`

Find files matching a glob pattern.

| Parameter   | Type     | Required | Description                                           |
| ----------- | -------- | -------- | ----------------------------------------------------- |
| `pattern`   | `string` | ✓        | Glob pattern (e.g., `"*.tsx"`, `"**/test/*.spec.ts"`) |
| `directory` | `string` |          | Directory to search in (default: workspace root)      |

**Output:**

```typescript
{
  success: boolean
  files: string[] // Matching file paths, sorted by modification time
}
```

---

### `codebaseSearch`

Semantic search that finds code by meaning, not exact text.

| Parameter           | Type       | Required | Description                                                       |
| ------------------- | ---------- | -------- | ----------------------------------------------------------------- |
| `query`             | `string`   | ✓        | Natural language question (e.g., "How does authentication work?") |
| `targetDirectories` | `string[]` | ✓        | Directories to search (`[]` for entire workspace)                 |

**Output:**

```typescript
{
  success: boolean
  results: Array<{
    file: string
    startLine: number
    endLine: number
    content: string
    relevance: number
  }>
}
```

**Notes:**

- Best for exploratory "how/where/what" questions
- Use grep for exact text matches instead
- Query should be a complete question, not keywords
- Requires embedding model / vector index (may not be available in all contexts)

---

## Terminal Operations

### `runCommand`

Execute a shell command with optional sandboxing.

| Parameter     | Type       | Required | Description                                               |
| ------------- | ---------- | -------- | --------------------------------------------------------- |
| `command`     | `string`   | ✓        | The command to execute                                    |
| `cwd`         | `string`   |          | Working directory (default: workspace root)               |
| `background`  | `boolean`  |          | Run in background (default: `false`)                      |
| `timeout`     | `number`   |          | Timeout in milliseconds                                   |
| `permissions` | `string[]` |          | Required permissions: `"network"`, `"git_write"`, `"all"` |

**Output:**

```typescript
{
  success: boolean
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: string
}
```

**Permission Details:**

| Permission  | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `network`   | Internet access, package installs, API calls, running servers |
| `git_write` | Git commits, branch operations, any `.git` modifications      |
| `all`       | Disables sandbox entirely                                     |

**Notes:**

- Commands run in a sandbox by default (see Sandbox Runtime section below)
- Non-interactive flags should be used (e.g., `--yes` for npx)
- Background commands for long-running processes (servers, watchers)

---

## Code Quality

### `readLints`

Read linter/compiler diagnostics from the IDE.

| Parameter | Type       | Required | Description                                                     |
| --------- | ---------- | -------- | --------------------------------------------------------------- |
| `paths`   | `string[]` |          | Specific files/directories to check (default: entire workspace) |

**Output:**

```typescript
{
  diagnostics: Array<{
    file: string
    line: number
    column: number
    severity: 'error' | 'warning' | 'info'
    message: string
    source?: string // e.g., "eslint", "typescript"
  }>
}
```

**Notes:**

- Only call on files you've edited or are about to edit
- Requires IDE integration (works in Cursor, may not be available standalone)
- Alternative: run `pnpm lint` via `runCommand` and parse output

---

## Task Management

### `writeTodos`

Create or update a task list for tracking work.

| Parameter | Type      | Required | Description                                       |
| --------- | --------- | -------- | ------------------------------------------------- |
| `merge`   | `boolean` | ✓        | `true` to merge with existing, `false` to replace |
| `todos`   | `Todo[]`  | ✓        | Array of todo items                               |

**Todo Item:**

```typescript
{
  id: string // Unique identifier
  content: string // Description (max 70 chars)
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}
```

**Notes:**

- Use for complex multi-step tasks (3+ steps)
- Only one task should be `in_progress` at a time
- Don't include operational tasks like "run linter" or "search codebase"

---

## Web Search

### `webSearch`

Search the internet using Google Custom Search API.

| Parameter         | Type     | Required | Description                         |
| ----------------- | -------- | -------- | ----------------------------------- |
| `query`           | `string` | ✓        | Search query                        |
| `exactTerms`      | `string` |          | Exact phrase to match               |
| `numberOfResults` | `number` |          | Max results to return (default: 10) |
| `languageCode`    | `string` |          | Language code (e.g., `"en-US"`)     |

**Output:**

```typescript
{
  success: boolean
  results: Array<{
    title: string
    link: string
    snippet: string
    languageCode?: string
  }>
  error?: string
}
```

**Notes:**

- Requires `GOOGLE_SEARCH_ENGINE_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` env vars
- ~$0.005 per query (Google Custom Search pricing)
- Auto-excludes sites that block scraping (e.g., reddit.com)

**Implementation Reference:** See `~/stax/lib/search/google.ts`

---

## Sandbox Runtime Integration

Moldable uses [@anthropic-ai/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) for secure command execution. This provides OS-level sandboxing without containers.

### Installation

```bash
npm install -g @anthropic-ai/sandbox-runtime
# or as a dependency
pnpm add @anthropic-ai/sandbox-runtime
```

### How It Works

| Platform | Technology                 | Notes                                     |
| -------- | -------------------------- | ----------------------------------------- |
| macOS    | `sandbox-exec` (built-in)  | Violation logging via system log          |
| Linux    | `bubblewrap` + seccomp BPF | Requires `strace` for violation detection |

### Default Sandbox Policy

```json
{
  "filesystem": {
    "allowRead": ["."],
    "allowWrite": ["~/.moldable/apps", "~/.moldable/skills"],
    "denyWrite": ["~/.moldable/config", "~/.moldable/agents"]
  },
  "network": {
    "allowedDomains": []
  }
}
```

### Mandatory Deny Paths (Auto-Protected)

These are **always blocked** from writes, even within allowed paths:

| Category      | Blocked Paths                                             |
| ------------- | --------------------------------------------------------- |
| Shell configs | `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`         |
| Git configs   | `.gitconfig`, `.gitmodules`, `.git/hooks/`, `.git/config` |
| IDE configs   | `.vscode/`, `.idea/`                                      |
| Agent configs | `.claude/commands/`, `.claude/agents/`                    |

### Permission Levels for Moldable

| Permission  | Sandbox Config                                                |
| ----------- | ------------------------------------------------------------- |
| (default)   | Workspace read, `~/.moldable/apps` write, no network          |
| `network`   | + `registry.npmjs.org`, `api.anthropic.com`, `api.openai.com` |
| `git_write` | + `.git/` write access                                        |
| `all`       | Sandbox disabled (user approval required)                     |

### Usage in Agent

```typescript
import { createSandbox } from '@anthropic-ai/sandbox-runtime'

const sandbox = createSandbox({
  filesystem: {
    allowRead: [process.cwd()],
    allowWrite: [path.join(os.homedir(), '.moldable/apps')],
  },
  network: {
    allowedDomains: ['registry.npmjs.org'],
  },
})

// Execute command in sandbox
const result = await sandbox.exec('pnpm install')
```

### Violation Detection

**macOS:** Real-time violation logging via system log:

```bash
log stream --predicate 'process == "sandbox-exec"' --style syslog
```

**Linux:** Use strace to trace blocked operations:

```bash
strace -f srt <command> 2>&1 | grep EPERM
```

---

## Tool Handler Implementation

Tool handlers render tool invocations in the chat UI. Each handler defines:

```typescript
type ToolHandler = {
  loadingLabel: string // "Reading file..."
  marker?: ThinkingTimelineMarker // Icon for timeline
  inline?: boolean // Show inline vs grouped
  renderLoading?: (args?: unknown) => ReactNode // Loading state UI
  renderOutput: (output: unknown, id: string) => ReactNode // Result UI
}
```

### Implemented Handlers

| Tool             | Status | Notes                                           |
| ---------------- | ------ | ----------------------------------------------- |
| `readFile`       | ✓      | Collapsible with content preview                |
| `writeFile`      | ✓      | Inline success/failure indicator                |
| `editFile`       | ✓      | Inline success/failure with file-code icon      |
| `deleteFile`     | ✓      | Inline success/failure with trash icon          |
| `listDirectory`  | ✓      | Collapsible with file list                      |
| `fileExists`     | ✓      | Inline exists/not found                         |
| `runCommand`     | ✓      | Terminal-style output with copy button          |
| `grep`           | ✓      | Collapsible results grouped by file             |
| `globFileSearch` | ✓      | Collapsible file list                           |
| `webSearch`      | ✓      | Results with title, URL, snippet, external link |

### Future Enhancements

| Tool             | Priority | Complexity | Notes                                   |
| ---------------- | -------- | ---------- | --------------------------------------- |
| `readLints`      | Low      | Medium     | Severity icons, file:line:col list      |
| `writeTodos`     | Low      | Medium     | Todo list with status badges            |
| `codebaseSearch` | Low      | High       | Requires embedding model / vector index |

---

## Prefer Specialized Tools

| Instead of...           | Use...           |
| ----------------------- | ---------------- |
| `cat file.txt`          | `readFile`       |
| `echo "..." > file.txt` | `writeFile`      |
| `sed -i 's/old/new/g'`  | `editFile`       |
| `ls -la`                | `listDirectory`  |
| `grep -r "pattern"`     | `grep`           |
| `find . -name "*.ts"`   | `globFileSearch` |

---

## Error Handling

All tools return a `success` boolean. When `success: false`:

- Check the `error` field for details
- For permission errors, retry with appropriate `permissions`
- For file not found, verify the path exists
- For sandbox violations, check if `network` or `git_write` permission is needed
