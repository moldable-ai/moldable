import { useChat } from '@ai-sdk/react'
import { useEffect, useRef, useState } from 'react'
import { type ReasoningEffort } from '@moldable-ai/ai/client'
import { isTauri } from '../lib/app-manager'
import { useMoldablePreferences } from './use-moldable-preferences'
import { invoke } from '@tauri-apps/api/core'
import { DefaultChatTransport, type UIMessage } from 'ai'

const API_ENDPOINT = 'http://127.0.0.1:3100/api/chat'

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

interface UseMoldableChatOptions {
  /** Active workspace ID (e.g., "personal", "work") */
  activeWorkspaceId?: string
  /** All registered apps in Moldable */
  registeredApps?: RegisteredAppInfo[]
  /** Currently active/focused app in Moldable */
  activeApp?: ActiveAppContext | null
  /** Callback when a response finishes streaming */
  onFinish?: (messages: UIMessage[]) => void
}

// Store for dynamic body values that the transport can read
interface DynamicBodyStore {
  model: string
  reasoningEffort: ReasoningEffort
  workspacePath: string | null
  activeWorkspaceId: string | null
  registeredApps: RegisteredAppInfo[]
  activeApp: ActiveAppContext | null
}

/**
 * Hook for managing Moldable chat using AI SDK's useChat
 */
export function useMoldableChat(options: UseMoldableChatOptions = {}) {
  const { activeWorkspaceId, registeredApps = [], activeApp = null } = options
  const preferences = useMoldablePreferences()
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)

  // Use a ref to store dynamic values that the transport body function can read
  const bodyStoreRef = useRef<DynamicBodyStore>({
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    workspacePath: null,
    activeWorkspaceId: null,
    registeredApps: [],
    activeApp: null,
  })

  // Keep the ref updated with latest values
  bodyStoreRef.current = {
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    workspacePath,
    activeWorkspaceId: activeWorkspaceId ?? null,
    registeredApps,
    activeApp,
  }

  // Load workspace path from config
  useEffect(() => {
    if (isTauri()) {
      invoke<string | null>('get_workspace_path').then(setWorkspacePath)
    }
  }, [])

  // Create transport once with a body function that reads from the ref
  const transportRef = useRef<DefaultChatTransport<UIMessage> | null>(null)
  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport({
      api: API_ENDPOINT,
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
        }
      },
    })
  }

  const chat = useChat({
    transport: transportRef.current,
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
  }
}

// Re-export for convenience
export {
  getAvailableModels,
  getReasoningEffortOptions,
} from './use-moldable-preferences'
