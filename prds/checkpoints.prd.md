# Checkpoints PRD

## Overview

Moldable's AI agent can create, modify, and delete files during conversations. Users need the ability to **revert changes** when the agent makes mistakes or goes in an unwanted direction. This PRD defines a checkpoint system that snapshots the state of **all source files** in an app at key moments (user message sends), enabling quick rollback.

## Inspiration: Cursor's Checkpoint System

Cursor IDE implements a sophisticated checkpoint system with the following architecture:

### Cursor's Storage Model

- **Location**: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (5+ GB SQLite)
- **Content-addressable storage**: Files stored by SHA-256 hash for deduplication
- **Key patterns**:
  - `agentKv:checkpoint:{conversationId}` — Root checkpoint for conversation
  - `agentKv:bubbleCheckpoint:{conversationId}:{messageId}` — Per-message checkpoint pointer
  - `agentKv:blob:{sha256}` — Conversation history blobs
  - `composer.content.{sha256}` — Actual file content snapshots

### Key Learnings from Cursor

1. **Content-addressable storage** enables deduplication (same file content = same hash)
2. **Per-message checkpoints** allow fine-grained rollback
3. **Separate from Git** — checkpoints track AI changes only, not manual edits
4. **Auto-cleanup** — old checkpoints are garbage collected after session ends

## Goals

- **G1: Automatic checkpoints** — Create a checkpoint whenever the user sends a message (before AI response)
- **G2: Per-app storage** — Checkpoints stored alongside each app's data in workspace directories
- **G3: Fast snapshots** — Use Rust/Tauri backend for performance (sub-100ms for typical file sets)
- **G4: Content deduplication** — Use content-addressable storage to minimize disk usage
- **G5: Simple rollback** — One-click revert to any previous checkpoint in conversation
- **G6: Cascading revert** — Reverting to checkpoint A undoes ALL changes from A onwards (including B, C, D, etc.)

## Non-Goals (MVP)

- **Cross-app checkpoints** — Only checkpoint within a single app's directory
- **Root-level checkpoints** — No checkpointing when not focused on an app
- Checkpointing files outside the active app's working directory
- Diffing/patching (we store full file snapshots)
- Cross-conversation checkpoint access
- Git integration (complementary, not replacement)
- Checkpointing database state (only files)

## Checkpoint Semantics: Cascading Revert

When a user reverts to a checkpoint, **all changes from that point forward are undone**. This is the key behavior users expect.

### Example Scenario

```
Message A (user): "Add a button to the homepage"
  → AI creates button.tsx

Message B (user): "Make the button red"
  → Checkpoint B created (captures button.tsx state before B's response)
  → AI modifies button.tsx, creates global.css

Message C (user): "Add a header"
  → Checkpoint C created (captures button.tsx, global.css)
  → AI creates header.tsx

Message D (user): "Change header to blue"
  → Checkpoint D created (captures button.tsx, global.css, header.tsx)
  → AI modifies header.tsx
```

**If user clicks "Restore" on Checkpoint B:**

- `button.tsx` → restored to state before B's response (just the basic button)
- `global.css` → **deleted** (didn't exist at checkpoint B)
- `header.tsx` → **deleted** (didn't exist at checkpoint B)

This is the intuitive "undo everything from here" behavior. The user doesn't need to think about which specific files were modified—clicking restore on B reverts the codebase to exactly how it was when they sent message B.

### Implementation

When restoring to checkpoint X:

1. Restore all files in checkpoint X to their captured state
2. Collect all files from checkpoints AFTER X (Y, Z, etc.)
3. For each file in later checkpoints:
   - If it exists in X → already restored (step 1)
   - If it doesn't exist in X → **delete it** (was created after X)

## Architecture

### Scope: Single App Only

Checkpoints are scoped to a **single app's directory**. This simplifies the design:

- **When checkpoints are created**: Every time the user sends a message while focused on an app (captures state BEFORE AI responds)
- **What gets checkpointed**: All source files within `~/.moldable/shared/apps/{app-id}/` (excluding `node_modules`, `.git`, binaries, etc.)
- **When checkpoints are NOT created**: Canvas/root level conversations, or when not focused on an app
- **When undo button appears**: Only on messages where AI actually made changes (detected by comparing consecutive checkpoints)

This means if the agent modifies files in multiple apps during a conversation, only the active app's files are checkpointed. Future versions may expand this.

### Storage Location

Checkpoints live in the workspace, organized by app:

```
~/.moldable/workspaces/{workspaceId}/
└── checkpoints/
    └── {appId}/
        └── {conversationId}/
            ├── manifest.json           # Checkpoint metadata index
            ├── blobs/
            │   ├── {sha256-prefix}/    # First 2 chars of hash
            │   │   └── {sha256}        # Full file content
            │   └── ...
            └── snapshots/
                ├── {messageId}.json    # Snapshot manifest
                └── ...
```

This structure:

- Groups checkpoints by app, then by conversation
- Allows easy cleanup when an app is deleted
- Keeps blob deduplication scoped to the app (simpler GC)

### Data Structures

#### Checkpoint Manifest (`manifest.json`)

```json
{
  "conversationId": "conv-abc123",
  "appId": "my-todo-app",
  "createdAt": "2026-01-23T10:00:00Z",
  "updatedAt": "2026-01-23T12:30:00Z",
  "snapshots": [
    {
      "id": "snap-001",
      "messageId": "msg-xyz789",
      "createdAt": "2026-01-23T10:00:00Z",
      "fileCount": 3,
      "totalBytes": 15420,
      "hasChanges": true
    }
  ]
}
```

**Note**: The `hasChanges` field is computed when listing checkpoints (not stored), by comparing each checkpoint with the next one. For the last checkpoint, it compares against the current disk state. This determines whether to show the undo button.

#### Snapshot File (`snapshots/{messageId}.json`)

Each snapshot captures the state of files within a single app:

```json
{
  "id": "snap-001",
  "messageId": "msg-xyz789",
  "conversationId": "conv-abc123",
  "appId": "my-todo-app",
  "appDir": "/Users/rob/.moldable/shared/apps/my-todo-app",
  "createdAt": "2026-01-23T10:00:00Z",
  "files": [
    {
      "path": "src/app/page.tsx",
      "hash": "a1b2c3d4e5f6...",
      "size": 2048,
      "mode": 33188,
      "exists": true
    },
    {
      "path": "src/lib/utils.ts",
      "hash": "f6e5d4c3b2a1...",
      "size": 512,
      "mode": 33188,
      "exists": true
    },
    {
      "path": "src/old-file.ts",
      "hash": null,
      "size": 0,
      "mode": 0,
      "exists": false
    }
  ]
}
```

#### Blob Storage

Files stored by content hash in sharded directories:

```
blobs/
├── a1/
│   └── a1b2c3d4e5f6...  # Raw file content
├── f6/
│   └── f6e5d4c3b2a1...
└── ...
```

### Content Hashing

Use SHA-256 for content hashing:

```rust
use sha2::{Sha256, Digest};

fn hash_content(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}
```

## Implementation

### Tauri Backend Commands

Add new Rust commands in `desktop/src-tauri/src/checkpoints.rs`:

```rust
/// Create a checkpoint by scanning all source files in the app directory.
/// Excludes node_modules, .git, binaries, etc. (like Codex's approach)
#[tauri::command]
pub fn create_checkpoint(
    app_id: String,
    app_dir: String,                 // Absolute path to app directory
    conversation_id: String,
    message_id: String,
) -> Result<CheckpointResult, String>;

/// List checkpoints for a conversation within an app.
/// Computes `hasChanges` for each by comparing consecutive snapshots.
#[tauri::command]
pub fn list_checkpoints(
    app_id: String,
    conversation_id: String,
) -> Result<Vec<CheckpointSummary>, String>;

/// Restore files to a checkpoint state
#[tauri::command]
pub async fn restore_checkpoint(
    app_id: String,
    conversation_id: String,
    message_id: String,
) -> Result<RestoreResult, String>;

/// Delete old checkpoints (garbage collection)
#[tauri::command]
pub fn cleanup_checkpoints(
    app_id: String,
    conversation_id: String,
    keep_last_n: usize,
) -> Result<CleanupResult, String>;

/// Delete all checkpoints for an app (called when app is deleted)
#[tauri::command]
pub fn delete_app_checkpoints(
    app_id: String,
) -> Result<(), String>;
```

### Frontend Integration

#### Hook: `useCheckpoints`

```typescript
// packages/ui/src/hooks/use-checkpoints.ts
export function useCheckpoints(appId: string | null, conversationId: string) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])

  // List checkpoints for this app + conversation
  const refresh = useCallback(async () => {
    if (!appId) {
      setCheckpoints([])
      return
    }
    const list = await invoke('list_checkpoints', { appId, conversationId })
    setCheckpoints(list)
  }, [appId, conversationId])

  // Create checkpoint before sending message
  const createCheckpoint = useCallback(
    async (messageId: string, appDir: string, modifiedFiles: string[]) => {
      if (!appId) return null
      return invoke('create_checkpoint', {
        appId,
        appDir,
        conversationId,
        messageId,
        modifiedFiles,
      })
    },
    [appId, conversationId],
  )

  // Restore to a checkpoint
  const restore = useCallback(
    async (messageId: string) => {
      if (!appId) return null
      const result = await invoke('restore_checkpoint', {
        appId,
        conversationId,
        messageId,
      })
      // Trigger app refresh after restore
      return result
    },
    [appId, conversationId],
  )

  return { checkpoints, refresh, createCheckpoint, restore, enabled: !!appId }
}
```

#### Integration Point: Chat Input Submit

Modify the chat submission flow to create checkpoints on EVERY message:

```typescript
// In chat-container.tsx
const handleSubmit = async (message: string) => {
  // Only checkpoint if we're focused on an app
  if (!activeApp) {
    await sendMessage(message)
    return
  }

  // Ensure we have a conversation ID (generate one if first message)
  const convId = ensureConversationId()

  // Create checkpoint BEFORE sending to AI (captures current state)
  // This scans ALL source files in the app directory
  await createCheckpoint(messageId, activeApp.workingDir, convId)

  // Send message to AI server
  await sendMessage(message)
}
```

#### Refresh After AI Response

After the AI finishes responding, refresh checkpoints to detect changes:

```typescript
// In chat-container.tsx - when streaming ends
useEffect(() => {
  const wasStreaming = prevStatus === 'streaming' || prevStatus === 'submitted';
  const isNowDone = status === 'ready' || status === 'error';

  if (wasStreaming && isNowDone && messages.length > 0) {
    saveConversation(messages, currentConversationId);
    // Refresh checkpoints to compute hasChanges by comparing with disk
    refreshCheckpoints();
  }
}, [status, ...]);
```

This refresh compares the last checkpoint against current disk state. If files changed, `hasChanges = true` and the undo button appears.

## UI Components

### Checkpoint Badge (Undo Button)

The undo button appears in the **bottom-right corner** of user message bubbles:

- User messages are **full-width** with a background color
- Undo button appears on hover (opacity transition)
- Only shown when `hasChanges === true` (AI actually modified files after this checkpoint)
- Positioned with `absolute bottom-1 right-4`

```tsx
// packages/ui/src/components/chat/chat-messages.tsx
{
  showCheckpointBadge && (
    <div className="absolute bottom-1 right-4 opacity-0 transition-opacity group-hover/message-row:opacity-100">
      <CheckpointBadge
        messageId={message.id}
        isRestoring={restoringMessageId === message.id}
        onRestore={() => onRestoreCheckpoint(message.id)}
      />
    </div>
  )
}
```

### Restore Confirmation Dialog

```tsx
export function RestoreDialog({
  checkpoint,
  onConfirm,
  onCancel,
}: {
  checkpoint: Checkpoint
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore Checkpoint?</DialogTitle>
          <DialogDescription>
            This will revert {checkpoint.fileCount} files to their state at{' '}
            {formatTime(checkpoint.createdAt)}.
          </DialogDescription>
        </DialogHeader>
        <div className="text-muted-foreground text-sm">
          Files to restore:
          <ul className="mt-2 list-disc pl-4">
            {checkpoint.files.slice(0, 5).map((f) => (
              <li key={f.path}>{f.path}</li>
            ))}
            {checkpoint.files.length > 5 && (
              <li>...and {checkpoint.files.length - 5} more</li>
            )}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Restore</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

## Garbage Collection

Checkpoints are cleaned up automatically:

1. **Per-conversation limit**: Keep last N checkpoints per conversation (default: 50)
2. **Age-based cleanup**: Delete checkpoints older than 7 days for closed conversations
3. **Blob reference counting**: Only delete blobs when no snapshots reference them
4. **App deletion**: When an app is deleted, delete all its checkpoints
5. **Manual cleanup**: User can clear checkpoints via settings

```rust
/// Garbage collect unreferenced blobs for an app
fn gc_blobs(app_checkpoint_dir: &Path) -> Result<GcResult, String> {
    // 1. Scan all snapshots to build set of referenced hashes
    // 2. Scan blobs directory
    // 3. Delete unreferenced blobs
}

/// Delete all checkpoints when app is removed
fn delete_app_checkpoints(workspace_id: &str, app_id: &str) -> Result<(), String> {
    let checkpoint_dir = get_checkpoint_dir(workspace_id, app_id);
    fs::remove_dir_all(checkpoint_dir)?;
    Ok(())
}
```

## Performance Considerations

### Fast Path: Incremental Checkpoints

Most checkpoints only need to snapshot a few changed files:

1. **Skip unchanged files**: Compare file mtime with last checkpoint
2. **Hash before store**: Check if blob already exists before writing
3. **Parallel hashing**: Hash multiple files concurrently in Rust

### Estimated Performance

| Operation          | Files                 | Target  |
| ------------------ | --------------------- | ------- |
| Create checkpoint  | 5 files, 50KB total   | < 50ms  |
| Create checkpoint  | 50 files, 500KB total | < 200ms |
| Restore checkpoint | 10 files              | < 100ms |
| List checkpoints   | 100 snapshots         | < 20ms  |

## Security Considerations

- **Path validation**: All paths validated to be within app's working directory
- **No symlink following**: Reject symlinks to prevent escaping sandbox
- **Size limits**: Max 10MB per file, max 100MB total per checkpoint
- **Hash verification**: Verify blob content matches hash on restore

## Migration Path

### Phase 1: Core Infrastructure

1. Implement `checkpoints.rs` Tauri commands
2. Add `useCheckpoints` hook
3. Create checkpoint storage structure

### Phase 2: Integration

1. Hook into chat submit flow
2. Track modified files from tool invocations
3. Add checkpoint badges to message UI

### Phase 3: Polish

1. Add restore confirmation dialog
2. Implement garbage collection
3. Add checkpoint browser in settings

## Acceptance Criteria

- [x] Checkpoint created automatically when user sends message in app context
- [x] Full app directory scanned (excluding node_modules, .git, binaries)
- [x] Checkpoints stored in `~/.moldable/workspaces/{id}/checkpoints/{appId}/`
- [x] Content-addressable blob storage prevents duplication
- [x] Undo button appears only on messages where AI made changes (`hasChanges` flag)
- [x] Undo button positioned in bottom-right of full-width user message
- [x] Checkpoint list refreshes after AI response completes
- [x] Last checkpoint compared against current disk state to detect changes
- [x] Restoring reverts files to their snapshotted state
- [x] **Restoring to checkpoint A also deletes files created in later checkpoints (B, C, D)**
- [x] Restore confirmation dialog with destructive styling
- [x] No checkpoints created when not focused on an app (canvas/root level)
- [ ] Garbage collection removes old checkpoints
- [ ] Checkpoints deleted when app is deleted

## Open Questions

1. Should we checkpoint on every tool call, or only on user message boundaries?
   - **Decided**: User message boundaries (simpler, sufficient granularity)

2. Should checkpoints capture all files or only modified files?
   - **Decided**: All source files in the app directory (full snapshot). This ensures cascading revert works correctly and simplifies the implementation. Content-addressable storage handles deduplication.

3. How to handle binary files (images, etc.)?
   - **Decided**: Exclude them via file extension check. Apps typically don't have many binary files, and they bloat checkpoint storage.

4. Should there be a "checkpoint diff" view showing what changed?
   - **Proposed**: Defer to Phase 2 (nice-to-have, not MVP)

5. Should we auto-initialize Git repos for new apps to enable ghost commits?
   - **Proposed**: No for MVP (avoid surprising users with `.git` directories)
   - Future: Offer as opt-in setting or prompt user on first checkpoint

6. What happens when agent modifies files outside the active app?
   - **Decided**: Those changes are NOT checkpointed (MVP scope is single-app only)
   - Users should be aware that only active app files are captured

## Alternative Strategy: Git-Based Ghost Commits (Codex Approach)

OpenAI's Codex CLI uses a different approach worth considering: **ghost commits** that leverage Git's existing infrastructure.

### How Ghost Commits Work

Instead of custom storage, Codex creates detached Git commits that don't appear in branch history:

```rust
// Codex's approach (simplified):
// 1. Create temporary index to avoid disturbing user's staged changes
// 2. Add all modified/untracked files to temp index
// 3. Create commit object without updating any refs

GIT_INDEX_FILE=/tmp/index git read-tree HEAD
GIT_INDEX_FILE=/tmp/index git add --all -- <paths>
GIT_INDEX_FILE=/tmp/index git write-tree
GIT_INDEX_FILE=/tmp/index git commit-tree <tree> -p <parent> -m "snapshot"

// Result: A commit exists in .git/objects but no branch points to it
// Restore: git restore --source <ghost-commit> --worktree -- .
```

### Benefits of Ghost Commits

1. **No custom storage layer** — Git handles deduplication, compression, garbage collection
2. **Invisible to users** — Commits don't appear in `git log` (no refs)
3. **Fast restore** — Uses optimized `git restore`
4. **Debuggable** — Can inspect with `git show <commit-id>`
5. **Smart filtering built-in** — Respects `.gitignore`

### Codex's Default Ignored Directories

We adopted this approach for our file scanning:

```rust
const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules", ".venv", "venv", "env",
    ".git", ".next", ".turbo",
    "dist", "build", ".cache",
    "__pycache__", ".pytest_cache", ".mypy_cache",
    "target", // Rust
    "coverage",
];

const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "svg",
    "woff", "woff2", "ttf", "eot", "otf",
    "mp3", "mp4", "wav", "ogg", "webm",
    "zip", "tar", "gz", "rar", "7z",
    "exe", "dll", "so", "dylib",
    "pdf", "doc", "docx",
    "db", "sqlite", "sqlite3",
];
```

### Why Ghost Commits Could Work for Single-App Scope

With checkpoints scoped to a single app, ghost commits become more viable:

- Each app is a self-contained directory
- If the user has initialized Git in their app, we can leverage it
- No need for cross-repo coordination

However, there are still challenges:

1. **Apps don't have `.git` by default** — Agent-created apps are just directories
2. **User surprise** — Auto-initializing Git might confuse non-technical users
3. **Consistency** — Some apps would use Git, others filesystem; adds complexity

### Hybrid Approach (Future Enhancement)

For MVP, use **filesystem checkpoints only**. In the future, detect Git repos:

```typescript
async function createCheckpoint(
  context: CheckpointContext,
): Promise<Checkpoint> {
  // Future: If app is a Git repo, use ghost commits
  if (await isGitRepo(context.appDir)) {
    return createGhostCommitCheckpoint(context)
  }

  // Default: Use filesystem-based checkpoints
  return createFilesystemCheckpoint(context)
}
```

#### When Ghost Commits Would Apply

| Scenario                    | Strategy                     |
| --------------------------- | ---------------------------- |
| User cloned app from GitHub | Ghost commit (Git exists)    |
| User ran `git init` in app  | Ghost commit (Git exists)    |
| Agent created fresh app     | Filesystem (no Git)          |
| User preference setting     | Could force one or the other |

This is **out of scope for MVP** — we'll use filesystem checkpoints exclusively for now.

## References

- Cursor checkpoint investigation (this conversation)
- Codex ghost commits implementation (`codex-rs/utils/git/src/ghost_commits.rs`)
- [filesystem-first-persistence.prd.md](./filesystem-first-persistence.prd.md)
- [@moldable-ai/storage package](../packages/storage/)
