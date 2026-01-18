import { useChat } from '@ai-sdk/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ReasoningEffort } from '@moldable-ai/ai/client'
import { isTauri } from '../lib/app-manager'
import {
  type AvailableKeys,
  useMoldablePreferences,
} from './use-moldable-preferences'
import { invoke } from '@tauri-apps/api/core'
import { DefaultChatTransport, type UIMessage } from 'ai'

const DEFAULT_AI_SERVER_PORT = 39100

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
  apiServerPort: number | null
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
    aiServerPort = DEFAULT_AI_SERVER_PORT,
    apiServerPort,
  } = options
  const preferences = useMoldablePreferences({ availableKeys })
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)

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
    apiServerPort: null,
  })

  // Keep the ref updated with latest values
  bodyStoreRef.current = {
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    workspacePath,
    activeWorkspaceId: activeWorkspaceId ?? null,
    registeredApps,
    activeApp,
    apiServerPort: apiServerPort ?? null,
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
          // Pass API server port for scaffold tools (handles multi-user on same machine)
          ...(store.apiServerPort && { apiServerPort: store.apiServerPort }),
        }
      },
    })
  }, [apiEndpoint])

  const chat = useChat({
    transport,
    onData: handleData,
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
  }
}

// Re-export for convenience
export {
  getAvailableModels,
  getReasoningEffortOptions,
} from './use-moldable-preferences'
