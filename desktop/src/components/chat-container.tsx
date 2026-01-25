import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ChatMessage,
  type ChatMessagePart,
  ChatPanel,
  type CheckpointInfo,
  type MessageCheckpoint,
  RestoreDialog,
} from '@moldable-ai/ui'
import { generateMessageId } from '../lib/checkpoints'
import { useChatConversations } from '../hooks/use-chat-conversations'
import { useCheckpoints } from '../hooks/use-checkpoints'
import {
  type ActiveAppContext,
  type RegisteredAppInfo,
  getAvailableModels,
  getReasoningEffortOptions,
  useMoldableChat,
} from '../hooks/use-moldable-chat'
import type { AvailableKeys } from '../hooks/use-moldable-preferences'
import { VendorLogo } from './vendor-logo'

const WELCOME_MESSAGE = (
  <div className="space-y-2">
    <p className="font-medium">👋 Welcome to Moldable</p>
    <p>
      Describe any app and watch it come to life—running locally with full
      system access, completely private, infinitely moldable.
    </p>
  </div>
)

interface ChatContainerProps {
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** Whether the chat is minimized (hidden below fold) */
  isMinimized: boolean
  onMinimizedChange: (minimized: boolean) => void
  /** Active workspace ID - conversations are scoped to workspace */
  workspaceId?: string
  /** All registered apps in Moldable */
  registeredApps?: RegisteredAppInfo[]
  /** Currently active app being viewed (if any) */
  activeApp?: ActiveAppContext | null
  /** Available API keys - used to auto-select appropriate model */
  availableKeys?: AvailableKeys
  /** Whether API keys are missing */
  missingApiKey?: boolean
  /** Callback to trigger API key setup */
  onAddApiKey?: () => void
  /** External input to populate (from apps via postMessage) */
  suggestedInput?: string
  /** Called when suggested input has been consumed */
  onSuggestedInputConsumed?: () => void
  /** App-provided instructions to include in chat context */
  appChatInstructions?: string
  /** AI server port (may be fallback port if default was unavailable) */
  aiServerPort?: number
  /** API server port (for scaffold tools, handles multi-user on same machine) */
  apiServerPort?: number
}

export function ChatContainer({
  isExpanded,
  onExpandedChange,
  isMinimized,
  onMinimizedChange,
  workspaceId,
  registeredApps,
  activeApp,
  availableKeys,
  missingApiKey,
  onAddApiKey,
  suggestedInput,
  onSuggestedInputConsumed,
  appChatInstructions,
  aiServerPort,
  apiServerPort,
}: ChatContainerProps) {
  // When enabled (default), AI knows to edit the active app's source code
  // When disabled, the app's own chat instructions take over (e.g., Code Editor editing user's project)
  const [isEditingApp, setIsEditingApp] = useState(true)

  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    setMessages,
    clearError,
    selectedModel,
    setSelectedModel,
    selectedReasoningEffort,
    setSelectedReasoningEffort,
    toolProgress,
    addToolApprovalResponse,
  } = useMoldableChat({
    activeWorkspaceId: workspaceId,
    registeredApps,
    // Only pass activeApp when isEditingApp is true - otherwise let the app's own instructions take over
    activeApp: isEditingApp ? activeApp : null,
    availableKeys,
    appChatInstructions,
    aiServerPort,
    apiServerPort,
  })

  const {
    conversations,
    currentConversationId,
    saveConversation,
    loadConversation,
    deleteConversation,
    newConversation,
    ensureConversationId,
  } = useChatConversations(workspaceId)

  // Checkpoints for reverting file changes
  const {
    checkpoints,
    refresh: refreshCheckpoints,
    createCheckpoint,
    restore: restoreCheckpoint,
    getCheckpoint,
  } = useCheckpoints(activeApp?.id ?? null, currentConversationId ?? null)

  // Refresh checkpoints when conversation changes
  useEffect(() => {
    refreshCheckpoints()
  }, [refreshCheckpoints, currentConversationId])

  // State for restore dialog
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<CheckpointInfo | null>(null)
  const [restoringMessageId, setRestoringMessageId] = useState<string | null>(
    null,
  )

  const [inputValue, setInputValue] = useState('')

  // Consume suggested input from external sources (e.g., apps via postMessage)
  useEffect(() => {
    if (suggestedInput) {
      setInputValue(suggestedInput)
      onSuggestedInputConsumed?.()
    }
  }, [suggestedInput, onSuggestedInputConsumed])

  // Track previous status to detect when streaming ends
  const prevStatusRef = useRef(status)

  // Save conversation and refresh checkpoints when streaming finishes
  useEffect(() => {
    const wasStreaming =
      prevStatusRef.current === 'streaming' ||
      prevStatusRef.current === 'submitted'
    const isNowDone = status === 'ready' || status === 'error'

    if (wasStreaming && isNowDone && messages.length > 0) {
      // Save the conversation (even on error, preserve what we have)
      saveConversation(messages, currentConversationId)
      // Refresh checkpoints to detect if AI made changes (updates hasChanges flags)
      refreshCheckpoints()
    }

    prevStatusRef.current = status
  }, [
    status,
    messages,
    saveConversation,
    currentConversationId,
    refreshCheckpoints,
  ])

  // Map available models to include vendor logo icons
  const models = useMemo(
    () =>
      getAvailableModels().map((m) => ({
        id: m.id,
        name: m.name,
        icon: <VendorLogo vendor={m.logoVendor ?? m.vendor} />,
      })),
    [],
  )

  // Get reasoning effort options for current model
  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortOptions(selectedModel),
    [selectedModel],
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value)
    },
    [],
  )

  const handleSubmit = useCallback(
    async (e?: React.FormEvent<HTMLFormElement>) => {
      e?.preventDefault()
      const text = inputValue.trim()
      if (!text) return

      setInputValue('')

      // Generate message ID upfront so we can use it for both the message and checkpoint
      const messageId = generateMessageId()

      // Create a checkpoint before sending if we're editing an app
      // This captures ALL source files in the app, enabling undo of any changes
      if (activeApp && isEditingApp) {
        // Ensure we have a conversation ID before creating checkpoint
        const convId = ensureConversationId()
        try {
          const result = await createCheckpoint(
            messageId,
            activeApp.workingDir,
            convId,
          )
          if (result) {
            console.log(
              `[Checkpoints] Created checkpoint for ${result.fileCount} files (${result.blobsCreated} new, ${result.blobsReused} reused)`,
            )
          }
        } catch (err) {
          // Don't block message sending if checkpoint fails
          console.error('[Checkpoints] Failed to create checkpoint:', err)
        }
      }

      console.log('[Chat] Sending message with id:', messageId)
      await sendMessage({
        id: messageId,
        role: 'user',
        parts: [{ type: 'text', text }],
      })
    },
    [
      inputValue,
      sendMessage,
      activeApp,
      isEditingApp,
      createCheckpoint,
      ensureConversationId,
    ],
  )

  const handleNewChat = useCallback(() => {
    setMessages([])
    clearError()
    newConversation()
  }, [setMessages, clearError, newConversation])

  const handleSelectConversation = useCallback(
    async (id: string) => {
      const conversation = await loadConversation(id)
      if (conversation) {
        setMessages(conversation.messages)
        clearError()
      }
    },
    [loadConversation, setMessages, clearError],
  )

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id)
      // If we deleted the current conversation, clear messages
      if (id === currentConversationId) {
        setMessages([])
        clearError()
      }
    },
    [deleteConversation, currentConversationId, setMessages, clearError],
  )

  // Handle tool approval responses
  // Note: useChat is configured with sendAutomaticallyWhen to auto-continue after approval
  const handleApprovalResponse = useCallback(
    (params: { approvalId: string; approved: boolean; reason?: string }) => {
      console.log('[Chat] Tool approval response:', params)
      addToolApprovalResponse?.({
        id: params.approvalId,
        approved: params.approved,
        reason: params.reason,
      })
    },
    [addToolApprovalResponse],
  )

  // Convert AI SDK messages to our ChatMessage format
  const chatMessages: ChatMessage[] = messages.map((m) => {
    // Convert parts to our format
    const parts: ChatMessagePart[] = []
    for (const part of m.parts ?? []) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text })
      } else if (part.type === 'reasoning') {
        parts.push({ type: 'reasoning', text: part.text })
      } else if (part.type === 'dynamic-tool') {
        // Dynamic tool - has toolName property
        const toolPart = part as {
          toolCallId?: string
          toolName?: string
          state?: string
          input?: unknown
          output?: unknown
        }
        parts.push({
          type: 'tool-invocation',
          toolCallId: toolPart.toolCallId,
          toolName: toolPart.toolName || 'unknown',
          state: toolPart.state || 'pending',
          args: toolPart.input,
          output: toolPart.output,
        })
      } else if (part.type.startsWith('tool-')) {
        // Static tool - type is "tool-{toolName}"
        const toolName = part.type.replace('tool-', '')
        const toolPart = part as {
          toolCallId?: string
          state?: string
          input?: unknown
          output?: unknown
          approval?: { id: string; approved?: boolean }
        }
        parts.push({
          type: 'tool-invocation',
          toolCallId: toolPart.toolCallId,
          toolName: toolName,
          state: toolPart.state || 'pending',
          args: toolPart.input,
          output: toolPart.output,
          approval: toolPart.approval,
        })
      }
    }

    // Extract text content for backward compatibility
    const textContent = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')

    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: textContent,
      parts,
    }
  })

  // Map AI SDK status to our status
  const chatStatus =
    status === 'streaming' || status === 'submitted'
      ? status
      : status === 'error'
        ? 'error'
        : 'ready'

  // Map conversations to the UI format
  const conversationMetas = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messageCount,
  }))

  // Generate contextual placeholder based on active app
  const placeholder = useMemo(() => {
    if (activeApp) {
      return 'What can I help with or tweak?'
    }
    return 'What should we build today?'
  }, [activeApp])

  // Build checkpoint map for Messages component
  // Only include checkpoints that have actual changes
  const checkpointMap = useMemo(() => {
    const map = new Map<string, MessageCheckpoint>()
    for (const cp of checkpoints) {
      if (cp.hasChanges) {
        map.set(cp.messageId, {
          messageId: cp.messageId,
          fileCount: cp.fileCount,
          totalBytes: cp.totalBytes,
        })
      }
    }
    return map
  }, [checkpoints])

  // Handle restore checkpoint request (opens dialog)
  const handleRestoreCheckpoint = useCallback(
    (messageId: string) => {
      const cp = getCheckpoint(messageId)
      if (cp) {
        setSelectedCheckpoint({
          messageId: cp.messageId,
          fileCount: cp.fileCount,
          totalBytes: cp.totalBytes,
          createdAt: cp.createdAt,
          // TODO: Could fetch file list from backend if needed
        })
        setRestoreDialogOpen(true)
      }
    },
    [getCheckpoint],
  )

  // Handle restore confirmation
  const handleConfirmRestore = useCallback(async () => {
    if (!selectedCheckpoint) return

    setRestoringMessageId(selectedCheckpoint.messageId)
    try {
      const result = await restoreCheckpoint(selectedCheckpoint.messageId)
      if (result) {
        console.log(
          `[Checkpoints] Restored ${result.filesRestored} files, deleted ${result.filesDeleted}`,
        )
        await refreshCheckpoints()
      }
    } catch (err) {
      console.error('[Checkpoints] Restore failed:', err)
    } finally {
      setRestoringMessageId(null)
      setRestoreDialogOpen(false)
      setSelectedCheckpoint(null)
    }
  }, [selectedCheckpoint, restoreCheckpoint, refreshCheckpoints])

  return (
    <>
      <ChatPanel
        messages={chatMessages}
        status={chatStatus}
        error={error}
        input={inputValue}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        onStop={stop}
        onNewChat={handleNewChat}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        reasoningEffortOptions={reasoningEffortOptions}
        selectedReasoningEffort={selectedReasoningEffort}
        onReasoningEffortChange={setSelectedReasoningEffort}
        conversations={conversationMetas}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        placeholder={placeholder}
        welcomeMessage={WELCOME_MESSAGE}
        isExpanded={isExpanded}
        onExpandedChange={onExpandedChange}
        isMinimized={isMinimized}
        onMinimizedChange={onMinimizedChange}
        missingApiKey={missingApiKey}
        onAddApiKey={onAddApiKey}
        toolProgress={toolProgress}
        onApprovalResponse={handleApprovalResponse}
        // Show the "edit app" toggle only when viewing an app
        showEditingAppToggle={!!activeApp}
        isEditingApp={isEditingApp}
        onEditingAppChange={setIsEditingApp}
        // Checkpoint props
        checkpoints={checkpointMap}
        restoringMessageId={restoringMessageId}
        onRestoreCheckpoint={handleRestoreCheckpoint}
      />

      {/* Restore checkpoint confirmation dialog */}
      <RestoreDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        checkpoint={selectedCheckpoint}
        onConfirm={handleConfirmRestore}
        isRestoring={restoringMessageId !== null}
      />
    </>
  )
}
