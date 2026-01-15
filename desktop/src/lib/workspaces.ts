import { isTauri } from './app-manager'
import { invoke } from '@tauri-apps/api/core'

export interface Workspace {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface WorkspacesConfig {
  activeWorkspace: string
  workspaces: Workspace[]
}

// Default workspace colors (nice palette)
export const WORKSPACE_COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
] as const

// Get workspaces config
export async function getWorkspacesConfig(): Promise<WorkspacesConfig> {
  if (!isTauri()) {
    return {
      activeWorkspace: 'personal',
      workspaces: [
        {
          id: 'personal',
          name: 'Personal',
          color: WORKSPACE_COLORS[0],
          createdAt: new Date().toISOString(),
        },
      ],
    }
  }

  return invoke<WorkspacesConfig>('get_workspaces_config')
}

// Get active workspace
export async function getActiveWorkspace(): Promise<Workspace | null> {
  const config = await getWorkspacesConfig()
  return config.workspaces.find((w) => w.id === config.activeWorkspace) ?? null
}

// Set active workspace
export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  if (!isTauri()) {
    return
  }

  await invoke('set_active_workspace', { workspaceId })
}

// Create a new workspace
export async function createWorkspace(
  name: string,
  color?: string,
): Promise<Workspace> {
  if (!isTauri()) {
    throw new Error('Cannot create workspace outside of Tauri')
  }

  return invoke<Workspace>('create_workspace', { name, color })
}

// Update a workspace
export async function updateWorkspace(
  workspaceId: string,
  updates: { name?: string; color?: string },
): Promise<Workspace> {
  if (!isTauri()) {
    throw new Error('Cannot update workspace outside of Tauri')
  }

  return invoke<Workspace>('update_workspace', { workspaceId, ...updates })
}

// Delete a workspace
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  if (!isTauri()) {
    return
  }

  await invoke('delete_workspace', { workspaceId })
}

// Generate a slug from a name
export function generateWorkspaceId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
