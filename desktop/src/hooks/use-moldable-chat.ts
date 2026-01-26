import { useChat } from '@ai-sdk/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ReasoningEffort } from '@moldable-ai/ai/client'
import { isTauri } from '../lib/app-manager'
import {
  type AvailableKeys,
  useMoldablePreferences,
} from './use-moldable-preferences'
import { SHARED_PREFERENCE_KEYS, useSharedConfig } from './use-workspace-config'
import { invoke } from '@tauri-apps/api/core'
import {
  DefaultChatTransport,
  type UIMessage,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai'

const DEFAULT_AI_SERVER_PORT = 39200

/**
 * Basic info about a registered app
 */
export interface RegisteredAppInfo {
  id: string
  name: string
  icon: string
}

/**
 * Context about the currently active app (if any)
 */
export interface ActiveAppContext extends RegisteredAppInfo {
  workingDir: string
  dataDir: string
}

/**
 * Progress data for a running tool (command execution)
 */
export interface ToolProgressData {
  toolCallId: string
  command: string
  stdout: string
  stderr: string
  status: 'running' | 'complete'
}

interface UseMoldableChatOptions {
  /** Active workspace ID (e.g., "personal", "work") */
  activeWorkspaceId?: string
  /** All registered apps in Moldable */
  registeredApps?: RegisteredAppInfo[]
  /** Currently active/focused app in Moldable */
  activeApp?: ActiveAppContext | null
  /** Available API keys from health check - used to auto-select appropriate model */
  availableKeys?: AvailableKeys
  /** App-provided instructions to embed in chat context */
  appChatInstructions?: string
  /** Callback when a response finishes streaming */
  onFinish?: (messages: UIMessage[]) => void
  /** AI server port (from health check, may be fallback port) */
  aiServerPort?: number
  /** API server port (for scaffold tools, handles multi-user on same machine) */
  apiServerPort?: number
}

// Store for dynamic body values that the transport can read
interface DynamicBodyStore {
  model: string
  reasoningEffort: ReasoningEffort
  workspacePath: string | null
  activeWorkspaceId: string | null
  registeredApps: RegisteredAppInfo[]
  activeApp: ActiveAppContext | null
  appChatInstructions: string | null
  apiServerPort: number | null
  requireUnsandboxedApproval: boolean
  requireDangerousCommandApproval: boolean
  dangerousPatterns: string[]
}

/**
 * Hook for managing Moldable chat using AI SDK's useChat
 */
export function useMoldableChat(options: UseMoldableChatOptions = {}) {
  const {
    activeWorkspaceId,
    registeredApps = [],
    activeApp = null,
    availableKeys,
    appChatInstructions,
    aiServerPort = DEFAULT_AI_SERVER_PORT,
    apiServerPort,
  } = options
  const preferences = useMoldablePreferences({ availableKeys })
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)

  // Load security preferences (global/shared, default: true = require approval)
  const [requireUnsandboxedApproval] = useSharedConfig(
    SHARED_PREFERENCE_KEYS.REQUIRE_UNSANDBOXED_APPROVAL,
    true,
  )
  const [requireDangerousCommandApproval] = useSharedConfig(
    SHARED_PREFERENCE_KEYS.REQUIRE_DANGEROUS_COMMAND_APPROVAL,
    true,
  )
  const [dangerousPatterns] = useSharedConfig<
    Array<{ pattern: string; description: string }>
  >(SHARED_PREFERENCE_KEYS.DANGEROUS_PATTERNS, [])

  // Build API endpoint with dynamic port
  const apiEndpoint = useMemo(
    () => `http://127.0.0.1:${aiServerPort}/api/chat`,
    [aiServerPort],
  )

  // Use a ref to store dynamic values that the transport body function can read
  const bodyStoreRef = useRef<DynamicBodyStore>({
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    workspacePath: null,
    activeWorkspaceId: null,
    registeredApps: [],
    activeApp: null,
    appChatInstructions: null,
    apiServerPort: null,
    requireUnsandboxedApproval: true,
    requireDangerousCommandApproval: true,
    dangerousPatterns: [],
  })

  // Keep the ref updated with latest values
  bodyStoreRef.current = {
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    workspacePath,
    activeWorkspaceId: activeWorkspaceId ?? null,
    registeredApps,
    activeApp,
    appChatInstructions: appChatInstructions ?? null,
    apiServerPort: apiServerPort ?? null,
    requireUnsandboxedApproval,
    requireDangerousCommandApproval,
    // Extract just the pattern strings for the server
    dangerousPatterns: dangerousPatterns.map((p) => p.pattern),
  }

  // Load workspace path from config
  useEffect(() => {
    if (isTauri()) {
      invoke<string | null>('get_workspace_path').then(setWorkspacePath)
    }
  }, [])

  // Track tool progress (streaming stdout/stderr from command execution)
  const [toolProgress, setToolProgress] = useState<
    Record<string, ToolProgressData>
  >({})

  // Handle data parts from the stream (including tool progress)
  const handleData = useCallback(
    (dataPart: { type: string; id?: string; data?: unknown }) => {
      if (dataPart.type === 'data-tool-progress' && dataPart.data) {
        const progress = dataPart.data as ToolProgressData
        setToolProgress((prev) => ({
          ...prev,
          [progress.toolCallId]: progress,
        }))
      }
    },
    [],
  )

  // Clear tool progress when a tool result comes in
  const clearToolProgress = useCallback((toolCallId: string) => {
    setToolProgress((prev) => {
      const { [toolCallId]: _removed, ...rest } = prev
      void _removed // silence unused variable warning
      return rest
    })
  }, [])

  // Create transport - recreate when API endpoint changes (port may change on fallback)
  const transport = useMemo(() => {
    return new DefaultChatTransport({
      api: apiEndpoint,
      body: () => {
        const store = bodyStoreRef.current
        return {
          model: store.model,
          reasoningEffort: store.reasoningEffort,
          ...(store.workspacePath && { basePath: store.workspacePath }),
          ...(store.activeWorkspaceId && {
            activeWorkspaceId: store.activeWorkspaceId,
          }),
          ...(store.registeredApps.length > 0 && {
            registeredApps: store.registeredApps,
          }),
          ...(store.activeApp && {
            activeApp: {
              id: store.activeApp.id,
              name: store.activeApp.name,
              icon: store.activeApp.icon,
              workingDir: store.activeApp.workingDir,
              dataDir: store.activeApp.dataDir,
            },
          }),
          ...(store.appChatInstructions && {
            appChatInstructions: store.appChatInstructions,
          }),
          // Pass API server port for scaffold tools (handles multi-user on same machine)
          ...(store.apiServerPort && { apiServerPort: store.apiServerPort }),
          // Pass security preferences
          requireUnsandboxedApproval: store.requireUnsandboxedApproval,
          requireDangerousCommandApproval:
            store.requireDangerousCommandApproval,
          dangerousPatterns: store.dangerousPatterns,
        }
      },
    })
  }, [apiEndpoint])

  // Transform error messages to be more user-friendly
  const handleError = useCallback((error: Error) => {
    console.error('[Chat] Error:', error.message)
    // The error message should already be well-formatted from the server
    // But we can catch any client-side errors here too
    const message = error.message || 'Unknown error'

    // Handle client-side specific errors
    if (
      message.includes('Failed to fetch') ||
      message.includes('NetworkError')
    ) {
      error.message =
        'Could not connect to the AI server. Please check that Moldable is running properly.'
    } else if (message.includes('Load failed')) {
      error.message =
        'Failed to load response from AI server. The connection may have been interrupted.'
    } else if (message === 'Load error' || message === 'Error') {
      // Generic errors - provide more context
      error.message = 'The AI request failed. Please try again.'
    }
  }, [])

  const chat = useChat({
    transport,
    onData: handleData,
    onError: handleError,
    // Auto-continue after tool approval responses are added
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })

  return {
    ...chat,
    selectedModel: preferences.model,
    setSelectedModel: preferences.setModel,
    selectedReasoningEffort: preferences.reasoningEffort,
    setSelectedReasoningEffort: preferences.setReasoningEffort,
    workspacePath,
    isPreferencesLoaded: preferences.isLoaded,
    error: chat.error,
    /** Progress data for running tools (streaming stdout/stderr) */
    toolProgress,
    /** Clear progress for a tool when it completes */
    clearToolProgress,
    /** Respond to tool approval requests (from AI SDK useChat) */
    addToolApprovalResponse: chat.addToolApprovalResponse,
  }
}

// Re-export for convenience
export {
  getAvailableModels,
  getReasoningEffortOptions,
} from './use-moldable-preferences'
