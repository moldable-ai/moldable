import { tool, zodSchema } from 'ai'
import { z } from 'zod/v4'

/**
 * Default API server port (may be different if another instance is running)
 */
const DEFAULT_API_SERVER_PORT = 39102

/**
 * Options for creating app management tools
 */
export interface AppManagementToolsOptions {
  /** API server port (passed from frontend which knows the actual port) */
  apiServerPort?: number
}

/**
 * Response from get-app-info API
 */
interface AppInfoResponse {
  success: boolean
  appId?: string
  appName?: string
  appPath?: string
  installedInWorkspaces?: string[]
  hasWorkspaceData?: boolean
  error?: string
}

/**
 * Response from unregister-app API
 */
interface UnregisterAppResponse {
  success: boolean
  appId?: string
  appName?: string
  message?: string
  error?: string
}

/**
 * Response from delete-app-data API
 */
interface DeleteAppDataResponse {
  success: boolean
  appId?: string
  deletedPath?: string
  message?: string
  error?: string
}

/**
 * Response from delete-app API
 */
interface DeleteAppResponse {
  success: boolean
  appId?: string
  appName?: string
  deletedPath?: string
  workspacesAffected?: string[]
  message?: string
  error?: string
}

/**
 * Create app management tools for the Moldable AI agent
 */
export function createAppManagementTools(
  options: AppManagementToolsOptions = {},
) {
  const { apiServerPort = DEFAULT_API_SERVER_PORT } = options

  const appIdSchema = z.object({
    appId: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'App ID must be lowercase with hyphens only')
      .describe('The ID of the app (e.g., "my-app")'),
  })

  return {
    /**
     * Get information about an app, including which workspaces it's installed in.
     * Use this before deleteApp to inform the user about the impact.
     */
    getAppInfo: tool({
      description: `Get information about a Moldable app, including which workspaces it's installed in and whether it has data in the current workspace. Use this before deleteApp to show the user which workspaces will be affected.`,
      inputSchema: zodSchema(appIdSchema),
      execute: async ({ appId }) => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${apiServerPort}/api/app-info`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appId }),
            },
          )

          const result: AppInfoResponse = await response.json()

          if (!result.success) {
            return {
              success: false,
              error: result.error || 'Failed to get app info',
            }
          }

          return {
            success: true,
            appId: result.appId,
            appName: result.appName,
            appPath: result.appPath,
            installedInWorkspaces: result.installedInWorkspaces,
            hasWorkspaceData: result.hasWorkspaceData,
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes('ECONNREFUSED') ||
              error.message.includes('fetch failed'))
          ) {
            return {
              success: false,
              error:
                'Could not connect to Moldable API server. Make sure Moldable desktop is running.',
            }
          }
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Failed to get app info',
          }
        }
      },
    }),

    /**
     * Remove an app from the current workspace only.
     * This does NOT delete the app's code or data - just removes it from the workspace.
     * The app can be re-added later from the app gallery.
     */
    unregisterApp: tool({
      description: `Remove a Moldable app from the current workspace. This keeps the app's code in shared/apps/ and preserves any workspace data. The app can be re-added later from the app gallery. This is the safest option - use this when the user wants to temporarily remove an app from their workspace.`,
      inputSchema: zodSchema(appIdSchema),
      // Always requires approval - user should confirm removal
      needsApproval: () => true,
      execute: async ({ appId }) => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${apiServerPort}/api/unregister-app`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appId }),
            },
          )

          const result: UnregisterAppResponse = await response.json()

          if (!result.success) {
            return {
              success: false,
              error: result.error || 'Failed to unregister app',
            }
          }

          return {
            success: true,
            appId: result.appId,
            appName: result.appName,
            message: result.message,
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes('ECONNREFUSED') ||
              error.message.includes('fetch failed'))
          ) {
            return {
              success: false,
              error:
                'Could not connect to Moldable API server. Make sure Moldable desktop is running.',
            }
          }
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to unregister app',
          }
        }
      },
    }),

    /**
     * Delete an app's data in the current workspace only.
     * This does NOT unregister or delete the app - just clears its workspace data.
     * The app will start fresh with no saved state.
     */
    deleteAppData: tool({
      description: `Delete a Moldable app's data in the current workspace. This clears the app's database, files, and cache. The app remains installed and will start fresh. Use this when the user wants to reset an app to its initial state without removing it.`,
      inputSchema: zodSchema(appIdSchema),
      // Always requires approval - data deletion is irreversible
      needsApproval: () => true,
      execute: async ({ appId }) => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${apiServerPort}/api/delete-app-data`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appId }),
            },
          )

          const result: DeleteAppDataResponse = await response.json()

          if (!result.success) {
            return {
              success: false,
              error: result.error || 'Failed to delete app data',
            }
          }

          return {
            success: true,
            appId: result.appId,
            deletedPath: result.deletedPath,
            message: result.message,
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes('ECONNREFUSED') ||
              error.message.includes('fetch failed'))
          ) {
            return {
              success: false,
              error:
                'Could not connect to Moldable API server. Make sure Moldable desktop is running.',
            }
          }
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to delete app data',
          }
        }
      },
    }),

    /**
     * DANGEROUS: Permanently delete an app from Moldable.
     * This removes the app from ALL workspaces and deletes all code and data.
     * Always call getAppInfo first to show the user which workspaces will be affected.
     */
    deleteApp: tool({
      description: `DANGEROUS: Permanently delete a Moldable app. This removes the app from ALL workspaces, deletes its source code from shared/apps/, and deletes all workspace data. This action cannot be undone. ALWAYS call getAppInfo first to inform the user which workspaces will be affected before using this tool.`,
      inputSchema: zodSchema(appIdSchema),
      // Always requires approval - highly destructive action
      needsApproval: () => true,
      execute: async ({ appId }) => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${apiServerPort}/api/delete-app`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appId }),
            },
          )

          const result: DeleteAppResponse = await response.json()

          if (!result.success) {
            return {
              success: false,
              error: result.error || 'Failed to delete app',
            }
          }

          return {
            success: true,
            appId: result.appId,
            appName: result.appName,
            deletedPath: result.deletedPath,
            workspacesAffected: result.workspacesAffected,
            message: result.message,
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes('ECONNREFUSED') ||
              error.message.includes('fetch failed'))
          ) {
            return {
              success: false,
              error:
                'Could not connect to Moldable API server. Make sure Moldable desktop is running.',
            }
          }
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Failed to delete app',
          }
        }
      },
    }),
  }
}

/**
 * Tool descriptions for UI display
 */
export const APP_MANAGEMENT_TOOL_DESCRIPTIONS = {
  getAppInfo: 'Get information about an app including which workspaces use it',
  unregisterApp:
    'Remove an app from the current workspace (keeps code and data)',
  deleteAppData:
    "Delete an app's data in the current workspace (app stays installed)",
  deleteApp: 'DANGEROUS: Permanently delete an app from all workspaces',
} as const
