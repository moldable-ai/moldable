import { useCallback, useEffect, useState } from 'react'
import type { WorkspacesConfig } from '../lib/workspaces'
import {
  createWorkspace as createWorkspaceApi,
  deleteWorkspace as deleteWorkspaceApi,
  getWorkspacesConfig,
  setActiveWorkspace as setActiveWorkspaceApi,
  updateWorkspace as updateWorkspaceApi,
} from '../lib/workspaces'
import { listen } from '@tauri-apps/api/event'

export function useWorkspaces() {
  const [config, setConfig] = useState<WorkspacesConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadWorkspaces = useCallback(async () => {
    try {
      const workspacesConfig = await getWorkspacesConfig()
      setConfig(workspacesConfig)
    } catch (err) {
      console.error('Failed to load workspaces:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  // Listen for workspace changes from Tauri
  useEffect(() => {
    const unlisten = listen('workspaces-changed', () => {
      console.log('📂 Workspaces changed, reloading...')
      loadWorkspaces()
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [loadWorkspaces])

  const activeWorkspace =
    config?.workspaces.find((w) => w.id === config.activeWorkspace) ?? null

  const setActiveWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!config) return

      try {
        // Wait for backend to update before updating frontend state
        // This avoids a race condition where loadApps() fetches from the old workspace
        await setActiveWorkspaceApi(workspaceId)
        setConfig((prev) =>
          prev ? { ...prev, activeWorkspace: workspaceId } : prev,
        )
      } catch (err) {
        console.error('Failed to set active workspace:', err)
      }
    },
    [config],
  )

  const createWorkspace = useCallback(async (name: string, color?: string) => {
    try {
      const newWorkspace = await createWorkspaceApi(name, color)
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              workspaces: [...prev.workspaces, newWorkspace],
            }
          : prev,
      )
      return newWorkspace
    } catch (err) {
      console.error('Failed to create workspace:', err)
      throw err
    }
  }, [])

  const updateWorkspace = useCallback(
    async (workspaceId: string, updates: { name?: string; color?: string }) => {
      try {
        const updated = await updateWorkspaceApi(workspaceId, updates)
        setConfig((prev) =>
          prev
            ? {
                ...prev,
                workspaces: prev.workspaces.map((w) =>
                  w.id === workspaceId ? updated : w,
                ),
              }
            : prev,
        )
        return updated
      } catch (err) {
        console.error('Failed to update workspace:', err)
        throw err
      }
    },
    [],
  )

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!config) return
      if (config.workspaces.length <= 1) {
        throw new Error('Cannot delete the last workspace')
      }

      try {
        await deleteWorkspaceApi(workspaceId)
        setConfig((prev) => {
          if (!prev) return prev
          const newWorkspaces = prev.workspaces.filter(
            (w) => w.id !== workspaceId,
          )
          // If we deleted the active workspace, switch to the first one
          const newActive =
            prev.activeWorkspace === workspaceId
              ? (newWorkspaces[0]?.id ?? 'personal')
              : prev.activeWorkspace
          return {
            ...prev,
            workspaces: newWorkspaces,
            activeWorkspace: newActive,
          }
        })
      } catch (err) {
        console.error('Failed to delete workspace:', err)
        throw err
      }
    },
    [config],
  )

  return {
    workspaces: config?.workspaces ?? [],
    activeWorkspace,
    isLoading,
    setActiveWorkspace,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    reload: loadWorkspaces,
  }
}
