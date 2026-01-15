'use client'

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * Header name used to pass workspace ID from client to server.
 * Keep in sync with @moldable-ai/storage WORKSPACE_HEADER
 */
export const WORKSPACE_HEADER = 'x-moldable-workspace'

interface WorkspaceContextValue {
  /**
   * The current workspace ID (from URL param or default 'personal')
   */
  workspaceId: string
  /**
   * Fetch function that automatically includes the workspace header.
   * Use this for all API calls to ensure workspace isolation.
   */
  fetchWithWorkspace: typeof fetch
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

/**
 * Get workspace ID from URL query parameter.
 * Used when app is embedded in Moldable desktop iframe.
 */
function getUrlWorkspace(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('workspace')
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWorkspaceId] = useState<string>('personal')

  // Read workspace from URL on mount and when URL changes
  useEffect(() => {
    const urlWorkspace = getUrlWorkspace()
    if (urlWorkspace) {
      setWorkspaceId(urlWorkspace)
    }
  }, [])

  // Listen for URL changes (e.g., when workspace switches and iframe reloads)
  useEffect(() => {
    const handleUrlChange = () => {
      const urlWorkspace = getUrlWorkspace()
      if (urlWorkspace && urlWorkspace !== workspaceId) {
        setWorkspaceId(urlWorkspace)
      }
    }

    // Check on popstate (back/forward navigation)
    window.addEventListener('popstate', handleUrlChange)

    return () => {
      window.removeEventListener('popstate', handleUrlChange)
    }
  }, [workspaceId])

  // Create a fetch wrapper that adds the workspace header
  const fetchWithWorkspace = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers)
      headers.set(WORKSPACE_HEADER, workspaceId)

      return fetch(input, {
        ...init,
        headers,
      })
    },
    [workspaceId],
  )

  const value = useMemo(
    () => ({
      workspaceId,
      fetchWithWorkspace,
    }),
    [workspaceId, fetchWithWorkspace],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

/**
 * Hook to access current workspace context.
 *
 * @returns workspaceId and fetchWithWorkspace utility
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { workspaceId, fetchWithWorkspace } = useWorkspace()
 *
 *   // Use in TanStack Query
 *   const { data } = useQuery({
 *     queryKey: ['notes', workspaceId],
 *     queryFn: () => fetchWithWorkspace('/api/notes').then(r => r.json()),
 *   })
 * }
 * ```
 */
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}
