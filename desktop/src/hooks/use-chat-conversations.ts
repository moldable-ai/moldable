import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'
import type { UIMessage } from 'ai'

/**
 * Conversation metadata for listing
 */
export interface ConversationMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/**
 * Full conversation with messages
 */
export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  messages: UIMessage[]
}

/**
 * Generate a unique conversation ID
 */
function generateId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}`
}

/**
 * Generate a title from the first user message
 */
function generateTitle(messages: UIMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user')
  if (!firstUserMessage) return 'New conversation'

  // Get text content from the message parts
  const textPart = firstUserMessage.parts?.find((p) => p.type === 'text')
  const text = textPart && 'text' in textPart ? (textPart.text as string) : ''

  if (!text) return 'New conversation'

  // Truncate to ~50 chars
  if (text.length <= 50) return text
  return text.substring(0, 47) + '...'
}

/**
 * Hook for managing chat conversation history
 *
 * Persists conversations to ~/.moldable/workspaces/{workspace}/conversations/ via Tauri commands.
 *
 * @param workspaceId - The active workspace ID. Conversations are reloaded when this changes.
 */
export function useChatConversations(workspaceId: string | undefined) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load conversation list on mount and when workspace changes
  useEffect(() => {
    if (!isTauri()) {
      setIsLoading(false)
      return
    }

    // Clear current conversation when workspace changes
    setCurrentConversationId(null)
    setIsLoading(true)

    invoke<ConversationMeta[]>('list_conversations')
      .then(setConversations)
      .catch((error) => {
        console.error('Failed to load conversations:', error)
        setConversations([])
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [workspaceId])

  /**
   * Load a specific conversation
   */
  const loadConversation = useCallback(
    async (id: string): Promise<Conversation | null> => {
      if (!isTauri()) return null

      try {
        const data = await invoke<Conversation | null>('load_conversation', {
          id,
        })
        if (data) {
          setCurrentConversationId(id)
        }
        return data
      } catch (error) {
        console.error('Failed to load conversation:', error)
        return null
      }
    },
    [],
  )

  /**
   * Save a conversation (creates new or updates existing)
   */
  const saveConversation = useCallback(
    async (
      messages: UIMessage[],
      existingId?: string | null,
    ): Promise<string | null> => {
      if (!isTauri() || messages.length === 0) return null

      try {
        const now = new Date().toISOString()
        const id = existingId ?? generateId()
        const isNew = !existingId

        const conversation: Conversation = {
          id,
          title: generateTitle(messages),
          createdAt: isNew
            ? now
            : (conversations.find((c) => c.id === id)?.createdAt ?? now),
          updatedAt: now,
          messageCount: messages.length,
          messages,
        }

        await invoke('save_conversation', { conversation })

        // Update local state
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === id)
          const meta: ConversationMeta = {
            id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messageCount: conversation.messageCount,
          }

          if (existing) {
            return prev.map((c) => (c.id === id ? meta : c))
          }
          return [meta, ...prev]
        })

        setCurrentConversationId(id)
        return id
      } catch (error) {
        console.error('Failed to save conversation:', error)
        return null
      }
    },
    [conversations],
  )

  /**
   * Delete a conversation
   */
  const deleteConversation = useCallback(async (id: string): Promise<void> => {
    if (!isTauri()) return

    try {
      await invoke('delete_conversation', { id })
      setConversations((prev) => prev.filter((c) => c.id !== id))

      // Clear current if deleted
      setCurrentConversationId((current) => (current === id ? null : current))
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }, [])

  /**
   * Start a new conversation (clears current)
   */
  const newConversation = useCallback(() => {
    setCurrentConversationId(null)
  }, [])

  /**
   * Ensure a conversation ID exists (generates one if needed)
   * Call this before creating checkpoints to guarantee an ID exists.
   */
  const ensureConversationId = useCallback((): string => {
    if (currentConversationId) {
      return currentConversationId
    }
    const newId = generateId()
    setCurrentConversationId(newId)
    return newId
  }, [currentConversationId])

  return {
    conversations,
    currentConversationId,
    isLoading,
    loadConversation,
    saveConversation,
    deleteConversation,
    newConversation,
    ensureConversationId,
  }
}
