# Chat Context Compaction

## Overview

As conversations grow, they can exceed the model's context window limits. Context compaction summarizes older messages while preserving the full conversation history for display. This creates a **forked view**: the UI shows complete history, while the API receives a compacted context.

## Problem Statement

1. **Context window limits**: Models have finite context (e.g., 200K tokens for Claude Opus 4.5)
2. **Long conversations degrade**: As context fills, responses may be cut off or quality degrades
3. **Token costs**: Sending redundant history wastes tokens and money
4. **User experience**: Users shouldn't lose conversation history when compacting

## Goals

- Automatically compact conversations before hitting context limits
- Preserve full conversation history in UI
- Allow manual compaction via user request
- Support session resumption with correct compacted context
- Handle multiple compaction cycles gracefully

## Non-Goals

- Real-time token counting (heuristic estimation is sufficient)
- Per-message token display in UI (future enhancement)
- Undo compaction (compaction is one-way; start new conversation if needed)

## Prior Art

OpenAI Codex uses a similar approach: full history persisted to "rollout" files while in-memory context can be compacted. Their `CompactedItem` stores both the summary and the replacement history for resumption.

---

## Architecture

### The Fork Model

Once compaction occurs, two parallel views exist:

```
TIME →
┌─────────────────────────────────────────────────────────────────┐
│                    DISPLAY HISTORY (UI)                         │
│  m1 → m2 → m3 → m4 → m5 → m6 → [BOUNDARY] → m7 → m8 → m9 → m10  │
│                                                                 │
│  Full history - always complete, for user reference             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ compaction creates fork
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API CONTEXT                                  │
│  [SUMMARY of m1-m6] → m7 → m8 → m9 → m10                       │
│                                                                 │
│  What the model sees - smaller, focused context                 │
└─────────────────────────────────────────────────────────────────┘
```

**Critical invariant**: After compaction, ALL subsequent API calls use the compacted context base, not the display history.

### Data Model

```typescript
/**
 * Compaction state - tracks the API context fork
 */
interface CompactionState {
  /** Version number (increments with each compaction) */
  version: number

  /** When this compaction was created */
  compactedAt: string

  /** The summary message that replaces older history in API context */
  summaryMessage: UIMessage

  /**
   * Index in the DISPLAY messages array where the API context begins.
   * Messages before this index are "display only" (summarized away).
   * Messages at and after this index are sent to the API.
   */
  apiStartIndex: number

  /**
   * Metadata about what was summarized (for transparency).
   */
  summarizedRange: {
    fromIndex: number
    toIndex: number
    messageCount: number
  }
}

/**
 * Full conversation with compaction support
 */
interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string

  /** Full message history - ALWAYS complete, for UI display */
  messages: UIMessage[]

  /**
   * Compaction state - if present, API uses this context instead of full messages.
   * null means no compaction has occurred - API uses full messages.
   */
  compaction: CompactionState | null
}
```

---

## Message Flow Scenarios

### Scenario 1: Fresh Conversation (No Compaction)

```
compaction: null

Turn 1: User sends "Hello"
  Display: [u1]
  API:     [u1]           → Model responds with a1
  Display: [u1, a1]
  API:     [u1, a1]

Turn 2: User sends "Help me build X"
  Display: [u1, a1, u2]
  API:     [u1, a1, u2]   → Model responds with a2
  Display: [u1, a1, u2, a2]
  API:     [u1, a1, u2, a2]

State: API messages = Display messages (no fork yet)
```

### Scenario 2: Compaction Triggered

```
Before compaction (10 messages, approaching token limit):
  Display: [u1, a1, u2, a2, u3, a3, u4, a4, u5, a5]
  API:     [u1, a1, u2, a2, u3, a3, u4, a4, u5, a5]

Compaction process:
  1. Summarize messages 0-5 (u1 through a3)
  2. Retain messages 6-9 (u4, a4, u5, a5) for continuity
  3. Create summary message

After compaction:
  compaction: {
    version: 1,
    compactedAt: "2026-01-14T...",
    summaryMessage: { role: 'user', text: '[Context Summary]\n...' },
    apiStartIndex: 6,
    summarizedRange: { fromIndex: 0, toIndex: 5, messageCount: 6 }
  }

  Display: [u1, a1, u2, a2, u3, a3, u4, a4, u5, a5]  ← UNCHANGED
  API:     [summary, u4, a4, u5, a5]                  ← COMPACTED (5 items)
```

### Scenario 3: Subsequent Turns After Compaction

```
compaction.apiStartIndex = 6

Turn 6: User sends u6
  Display: [u1, a1, u2, a2, u3, a3, u4, a4, u5, a5, u6]  (index 10)
  API:     [summary] + messages[6:] = [summary, u4, a4, u5, a5, u6]

  → Model responds with a6

  Display: [u1, a1, u2, a2, u3, a3, u4, a4, u5, a5, u6, a6]
  API:     [summary, u4, a4, u5, a5, u6, a6]

Turn 7, 8, 9... all append to both views
  apiStartIndex stays at 6
  API = [summary] + messages[6:]  ← Always correct
```

### Scenario 4: Second Compaction (Stacking)

```
After many more turns (30 display messages, API context growing again):
  Display: [u1...a5, u6...a15]  (30 messages)
  API:     [summary_v1, u4...a15]  (26 messages - large again)

Second compaction:
  1. Summarize current API context: [summary_v1, u4...a10]
  2. Retain u11→a15 for continuity (indices 20-29 in display)
  3. Create new summary incorporating previous summary

After:
  compaction: {
    version: 2,
    summaryMessage: { text: '[Context v2]\nPreviously: ...\nThen: ...' },
    apiStartIndex: 20,  ← Moved forward
    summarizedRange: { fromIndex: 0, toIndex: 19, messageCount: 20 }
  }

  Display: [u1...a15]  (still all 30 messages)
  API:     [summary_v2, u11, a11, ..., a15]  (11 items)
```

### Scenario 5: Session Resumption

```
User closes app, reopens tomorrow:

1. Load conversation from disk:
   {
     messages: [...30 messages...],
     compaction: {
       version: 2,
       apiStartIndex: 20,
       summaryMessage: {...},
       ...
     }
   }

2. User sends new message u16:
   Display: [...30 messages..., u16]
   API:     buildApiMessages(messages, compaction)
          = [summary_v2, messages[20], ..., messages[30], u16]
          = [summary_v2, u11, a11, ..., a15, u16]

Works correctly because apiStartIndex tells us exactly where the fork begins.
```

---

## Core Algorithm

### Building API Messages

```typescript
/**
 * Build the messages array to send to the LLM API.
 *
 * This is THE critical function - determines what the model sees.
 */
function buildApiMessages(
  displayMessages: UIMessage[],
  compaction: CompactionState | null,
): UIMessage[] {
  // No compaction - send everything
  if (!compaction) {
    return displayMessages
  }

  // Compacted - send summary + messages from apiStartIndex onwards
  return [
    compaction.summaryMessage,
    ...displayMessages.slice(compaction.apiStartIndex),
  ]
}
```

### Token Estimation

```typescript
/**
 * Approximate token count using character-based heuristic.
 * ~3.5-4 characters per token for English/code mix.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function estimateMessageTokens(messages: UIMessage[]): number {
  return messages.reduce((total, msg) => {
    const textContent =
      msg.parts
        ?.filter((p) => p.type === 'text' || p.type === 'reasoning')
        .map((p) => (p as { text?: string }).text || '')
        .join('') || ''
    return total + estimateTokens(textContent) + 10 // +10 for message overhead
  }, 0)
}

/**
 * Model context window sizes
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'anthropic/claude-opus-4-5': 200_000,
  'openai/gpt-5.2': 200_000,
  'openrouter/minimax/minimax-m2.1': 128_000,
  'openrouter/google/gemini-3-flash-preview': 1_000_000,
}
```

### Compaction Trigger

```typescript
const COMPACTION_THRESHOLD = 0.75 // Compact at 75% of context window

function shouldCompact(messages: UIMessage[], model: string): boolean {
  const contextWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200_000
  const estimatedTokens = estimateMessageTokens(messages)
  return estimatedTokens > contextWindow * COMPACTION_THRESHOLD
}
```

### Summary Generation

```typescript
const COMPACTION_SYSTEM_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for the next turn of this conversation.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, code snippets, file paths, or references needed to continue

Be concise, structured, and focused on enabling seamless continuation. The summary will replace the earlier messages, so include all essential context.`

const SUMMARY_PREFIX = `[Conversation Context - Compacted]

The following is a summary of the earlier conversation:`

async function generateSummary(
  messagesToSummarize: UIMessage[],
  model: string,
): Promise<string> {
  const conversationText = formatMessagesForSummary(messagesToSummarize)

  const result = await generateText({
    model: getLanguageModel(model),
    system: COMPACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Summarize this conversation:\n\n${conversationText}`,
      },
    ],
    maxTokens: 2000,
  })

  return `${SUMMARY_PREFIX}\n\n${result.text}\n\n---\nThe conversation continues below:`
}
```

### Performing Compaction

```typescript
interface CompactionResult {
  newApiMessages: UIMessage[]
  compactionState: CompactionState
}

async function performCompaction(
  displayMessages: UIMessage[],
  currentCompaction: CompactionState | null,
  model: string,
): Promise<CompactionResult> {
  // Get current API messages
  const currentApiMessages = buildApiMessages(
    displayMessages,
    currentCompaction,
  )

  // Decide how many recent messages to retain (4-6 turns = 8-12 messages)
  const retainCount = Math.min(10, Math.floor(currentApiMessages.length * 0.3))
  const toSummarize = currentApiMessages.slice(0, -retainCount)
  const toRetain = currentApiMessages.slice(-retainCount)

  // Generate summary
  const summaryText = await generateSummary(toSummarize, model)

  const summaryMessage: UIMessage = {
    id: `compaction-summary-v${(currentCompaction?.version ?? 0) + 1}`,
    role: 'user',
    parts: [{ type: 'text', text: summaryText }],
  }

  // Calculate apiStartIndex in display messages
  // = total display messages - number of retained messages
  const apiStartIndex = displayMessages.length - retainCount

  const compactionState: CompactionState = {
    version: (currentCompaction?.version ?? 0) + 1,
    compactedAt: new Date().toISOString(),
    summaryMessage,
    apiStartIndex,
    summarizedRange: {
      fromIndex: 0,
      toIndex: apiStartIndex - 1,
      messageCount: apiStartIndex,
    },
  }

  return {
    newApiMessages: [summaryMessage, ...toRetain],
    compactionState,
  }
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure

**Files to create/modify:**

1. `packages/ai/src/context/tokens.ts` - Token estimation utilities
2. `packages/ai/src/context/compaction.ts` - Core compaction logic
3. `packages/ai/src/context/index.ts` - Exports

**Token estimation:**

- `estimateTokens(text: string): number`
- `estimateMessageTokens(messages: UIMessage[]): number`
- `MODEL_CONTEXT_WINDOWS` constant

**Compaction logic:**

- `buildApiMessages(displayMessages, compaction): UIMessage[]`
- `shouldCompact(messages, model): boolean`
- `performCompaction(displayMessages, currentCompaction, model): Promise<CompactionResult>`

### Phase 2: Server Integration

**Files to modify:**

1. `packages/ai-server/src/index.ts`

**Changes:**

- Accept `apiMessages` and `compactionState` in request body
- Check if compaction needed before each turn
- Perform inline compaction if threshold exceeded
- Return compaction state in response stream

**Request body additions:**

```typescript
{
  messages: UIMessage[]           // Full display history
  apiMessages?: UIMessage[]       // Pre-computed API context
  compactionState?: CompactionState | null
}
```

**Response stream additions:**

```typescript
// New event type in stream
{ type: 'compaction', compaction: CompactionState }
```

### Phase 3: Client Integration

**Files to modify:**

1. `desktop/src/hooks/use-chat-conversations.ts` - Add compaction to Conversation type
2. `desktop/src/hooks/use-moldable-chat.ts` - Send apiMessages, handle compaction events
3. `desktop/src-tauri/src/lib.rs` - Update conversation serialization (if needed)

**State management:**

- Track `compactionState` alongside messages
- Compute `apiMessages` before each request using `buildApiMessages()`
- Handle `compaction` events from server stream
- Persist compaction state with conversation

### Phase 4: UI Enhancements

**Files to modify:**

1. `packages/ui/src/components/chat/chat-messages.tsx` - Show compaction boundary
2. `packages/ui/src/components/chat/tool-handlers.tsx` - Add `compactContext` tool handler

**UI elements:**

- Compaction boundary marker between old/new messages
- Optional: dim "display only" messages (pre-compaction)
- Optional: context usage indicator in chat header

### Phase 5: Manual Compaction Tool

**Files to create/modify:**

1. `packages/ai/src/tools/context.ts` - Context management tools

**Tools:**

- `getContextStats` - Returns current token usage, context window info
- `compactContext` - Triggers manual compaction

---

## Testing Strategy

### Unit Tests

1. **Token estimation**
   - Various text lengths
   - Code vs prose
   - Edge cases (empty, very long)

2. **buildApiMessages**
   - No compaction (returns all messages)
   - With compaction (returns summary + retained)
   - Empty messages array
   - Compaction at various points

3. **performCompaction**
   - First compaction
   - Stacking compactions
   - Edge cases (very few messages, many messages)

### Integration Tests

1. **Full conversation flow**
   - Fresh conversation → compaction → more messages → resumption
   - Multiple compaction cycles
   - Session persistence and reload

2. **Server round-trip**
   - Compaction triggered server-side
   - Client receives and applies compaction state
   - Subsequent requests use correct context

### Manual Testing

1. Start conversation, chat until compaction triggers
2. Verify UI shows full history
3. Verify model responses make sense (context preserved)
4. Close and reopen app
5. Continue conversation, verify context correct
6. Trigger second compaction, verify stacking works

---

## Edge Cases

1. **Compaction during streaming**: Don't compact mid-response. Only check at turn start.

2. **Very short conversations**: Never compact if < 10 messages.

3. **User interrupts**: If user stops generation, don't save partial compaction.

4. **Summary generation fails**: Log error, continue without compaction. Retry on next turn.

5. **Messages added while compacting**: Use optimistic locking - if message count changed, recompute apiStartIndex.

6. **Tool calls in summarized range**: Include tool names and outcomes in summary, not full output.

---

## Future Enhancements

1. **Token count display**: Show actual usage in chat header
2. **Compaction preview**: Let user see what will be summarized before confirming
3. **Selective compaction**: Let user choose which messages to keep verbatim
4. **Undo compaction**: Start new conversation branch from pre-compaction state
5. **Export full history**: Download complete conversation as markdown/JSON

---

## Success Metrics

1. **No context overflow errors**: Conversations can continue indefinitely
2. **Response quality maintained**: Model still understands context after compaction
3. **Session resumption works**: Users can close/reopen without losing context
4. **Transparent to users**: They see full history, compaction is mostly invisible
