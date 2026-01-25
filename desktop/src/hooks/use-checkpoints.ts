import { useCallback, useState } from 'react'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Summary of a checkpoint for listing
 */
export interface CheckpointSummary {
  id: string
  messageId: string
  createdAt: string
  fileCount: number
  totalBytes: number
  /** Whether this checkpoint differs from the previous one (files were modified) */
  hasChanges: boolean
}

/**
 * Result of creating a checkpoint
 */
export interface CheckpointResult {
  id: string
  messageId: string
  fileCount: number
  totalBytes: number
  blobsCreated: number
  blobsReused: number
}

/**
 * Result of restoring a checkpoint
 */
export interface RestoreResult {
  filesRestored: number
  filesDeleted: number
  bytesWritten: number
}

/**
 * Result of garbage collection
 */
export interface CleanupResult {
  snapshotsDeleted: number
  blobsDeleted: number
  bytesFreed: number
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing checkpoints for file snapshots.
 *
 * Checkpoints allow reverting files to a previous state when the AI
 * agent makes unwanted changes. They are scoped to a single app and
 * conversation.
 *
 * @param appId - The ID of the app (null if not focused on an app)
 * @param conversationId - The ID of the current conversation
 */
export function useCheckpoints(
  appId: string | null,
  conversationId: string | null,
) {
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Whether checkpoints are enabled (requires app context)
  const enabled = Boolean(appId && conversationId && isTauri())

  /**
   * Refresh the list of checkpoints for this app + conversation
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || !appId || !conversationId) {
      setCheckpoints([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const list = await invoke<CheckpointSummary[]>('list_checkpoints', {
        appId,
        conversationId,
      })
      setCheckpoints(list)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      console.error('[Checkpoints] Failed to list checkpoints:', message)
      setCheckpoints([])
    } finally {
      setIsLoading(false)
    }
  }, [enabled, appId, conversationId])

  /**
   * Create a checkpoint by scanning all source files in the app directory.
   * This captures the complete state of the app before an AI response.
   *
   * @param messageId - The ID of the user message being sent
   * @param appDir - The absolute path to the app directory
   * @param conversationIdOverride - Optional override for conversationId (useful when ID was just created)
   * @returns The checkpoint result, or null if checkpoints are disabled
   */
  const createCheckpoint = useCallback(
    async (
      messageId: string,
      appDir: string,
      conversationIdOverride?: string,
    ): Promise<CheckpointResult | null> => {
      const effectiveConversationId = conversationIdOverride ?? conversationId

      if (!appId || !effectiveConversationId || !isTauri()) {
        console.log(
          '[Checkpoints] Disabled - appId:',
          appId,
          'conversationId:',
          effectiveConversationId,
          'isTauri:',
          isTauri(),
        )
        return null
      }

      try {
        const result = await invoke<CheckpointResult>('create_checkpoint', {
          appId,
          appDir,
          conversationId: effectiveConversationId,
          messageId,
        })
        // Refresh the list after creating
        await refresh()
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[Checkpoints] Failed to create checkpoint:', message)
        throw err
      }
    },
    [appId, conversationId, refresh],
  )

  /**
   * Restore files to a checkpoint state.
   *
   * @param messageId - The message ID of the checkpoint to restore
   * @returns The restore result
   */
  const restore = useCallback(
    async (messageId: string): Promise<RestoreResult | null> => {
      if (!enabled || !appId || !conversationId) {
        return null
      }

      try {
        const result = await invoke<RestoreResult>('restore_checkpoint', {
          appId,
          conversationId,
          messageId,
        })
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[Checkpoints] Failed to restore checkpoint:', message)
        throw err
      }
    },
    [enabled, appId, conversationId],
  )

  /**
   * Clean up old checkpoints, keeping only the last N.
   *
   * @param keepLastN - Number of checkpoints to keep (default: 50)
   * @returns The cleanup result
   */
  const cleanup = useCallback(
    async (keepLastN: number = 50): Promise<CleanupResult | null> => {
      if (!enabled || !appId || !conversationId) {
        return null
      }

      try {
        const result = await invoke<CleanupResult>('cleanup_checkpoints', {
          appId,
          conversationId,
          keepLastN,
        })
        // Refresh the list after cleanup
        await refresh()
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[Checkpoints] Failed to cleanup checkpoints:', message)
        throw err
      }
    },
    [enabled, appId, conversationId, refresh],
  )

  /**
   * Check if a specific message has a checkpoint.
   */
  const hasCheckpoint = useCallback(
    (messageId: string): boolean => {
      return checkpoints.some((cp) => cp.messageId === messageId)
    },
    [checkpoints],
  )

  /**
   * Get checkpoint info for a specific message.
   */
  const getCheckpoint = useCallback(
    (messageId: string): CheckpointSummary | undefined => {
      return checkpoints.find((cp) => cp.messageId === messageId)
    },
    [checkpoints],
  )

  return {
    /** List of checkpoints for this app + conversation */
    checkpoints,
    /** Whether checkpoints are enabled (requires app context) */
    enabled,
    /** Whether a checkpoint list refresh is in progress */
    isLoading,
    /** Last error message, if any */
    error,
    /** Refresh the checkpoint list */
    refresh,
    /** Create a checkpoint (scans all source files in app) */
    createCheckpoint,
    /** Restore to a checkpoint */
    restore,
    /** Clean up old checkpoints */
    cleanup,
    /** Check if a message has a checkpoint */
    hasCheckpoint,
    /** Get checkpoint info for a message */
    getCheckpoint,
  }
}
