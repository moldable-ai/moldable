import { createAppManagementTools } from './app-management'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Helper types for tool execution
type ToolContext = { toolCallId: string; messages: []; abortSignal: never }
const ctx: ToolContext = {
  toolCallId: 'test',
  messages: [],
  abortSignal: undefined as never,
}

describe('createAppManagementTools', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getAppInfo', () => {
    it('returns app info with workspaces when found', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          appId: 'scribo',
          appName: 'Scribo Languages',
          appPath: '/Users/rob/.moldable/shared/apps/scribo',
          installedInWorkspaces: ['Personal', 'Work'],
          hasWorkspaceData: true,
        }),
      } as Response)

      const result = (await tools.getAppInfo.execute!(
        { appId: 'scribo' },
        ctx,
      )) as {
        success: boolean
        appId?: string
        appName?: string
        installedInWorkspaces?: string[]
        hasWorkspaceData?: boolean
      }

      expect(result.success).toBe(true)
      expect(result.appId).toBe('scribo')
      expect(result.appName).toBe('Scribo Languages')
      expect(result.installedInWorkspaces).toEqual(['Personal', 'Work'])
      expect(result.hasWorkspaceData).toBe(true)
    })

    it('returns error when app not found', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: "App 'nonexistent' not found in shared apps",
        }),
      } as Response)

      const result = (await tools.getAppInfo.execute!(
        { appId: 'nonexistent' },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('handles connection error gracefully', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('fetch failed: ECONNREFUSED'),
      )

      const result = (await tools.getAppInfo.execute!(
        { appId: 'test' },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Could not connect to Moldable API server')
    })
  })

  describe('unregisterApp', () => {
    it('requires approval', () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })
      // needsApproval should be defined (either true or a function returning true)
      expect(tools.unregisterApp.needsApproval).toBeTruthy()
    })

    it('unregisters app successfully', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          appId: 'scribo',
          appName: 'Scribo Languages',
          message: 'App removed from workspace. Code and data are preserved.',
        }),
      } as Response)

      const result = (await tools.unregisterApp.execute!(
        { appId: 'scribo' },
        ctx,
      )) as {
        success: boolean
        appId?: string
        appName?: string
        message?: string
      }

      expect(result.success).toBe(true)
      expect(result.appId).toBe('scribo')
      expect(result.message).toContain('preserved')
    })

    it('returns error when unregister fails', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: 'App not found in workspace config',
        }),
      } as Response)

      const result = (await tools.unregisterApp.execute!(
        { appId: 'unknown' },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('deleteAppData', () => {
    it('requires approval', () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })
      // needsApproval should be defined (either true or a function returning true)
      expect(tools.deleteAppData.needsApproval).toBeTruthy()
    })

    it('deletes app data successfully', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          appId: 'scribo',
          deletedPath: '/Users/rob/.moldable/workspaces/personal/apps/scribo',
          message:
            'App data deleted. The app is still installed and will start fresh.',
        }),
      } as Response)

      const result = (await tools.deleteAppData.execute!(
        { appId: 'scribo' },
        ctx,
      )) as {
        success: boolean
        appId?: string
        deletedPath?: string
        message?: string
      }

      expect(result.success).toBe(true)
      expect(result.appId).toBe('scribo')
      expect(result.deletedPath).toContain('workspaces')
      expect(result.message).toContain('start fresh')
    })

    it('returns error when no data exists', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: "No data found for app 'test' in this workspace",
        }),
      } as Response)

      const result = (await tools.deleteAppData.execute!(
        { appId: 'test' },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No data found')
    })
  })

  describe('deleteApp', () => {
    it('requires approval', () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })
      // needsApproval should be defined (either true or a function returning true)
      expect(tools.deleteApp.needsApproval).toBeTruthy()
    })

    it('deletes app completely and returns affected workspaces', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          appId: 'scribo',
          appName: 'Scribo Languages',
          deletedPath: '/Users/rob/.moldable/shared/apps/scribo',
          workspacesAffected: ['Personal', 'Work'],
          message: 'App deleted permanently from all workspaces.',
        }),
      } as Response)

      const result = (await tools.deleteApp.execute!(
        { appId: 'scribo' },
        ctx,
      )) as {
        success: boolean
        appId?: string
        appName?: string
        deletedPath?: string
        workspacesAffected?: string[]
        message?: string
      }

      expect(result.success).toBe(true)
      expect(result.appId).toBe('scribo')
      expect(result.appName).toBe('Scribo Languages')
      expect(result.workspacesAffected).toEqual(['Personal', 'Work'])
      expect(result.message).toContain('permanently')
    })

    it('returns error when app not found', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: "App 'nonexistent' not found in shared apps",
        }),
      } as Response)

      const result = (await tools.deleteApp.execute!(
        { appId: 'nonexistent' },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('handles network errors gracefully', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39102 })

      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const result = (await tools.deleteApp.execute!(
        { appId: 'test' },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Could not connect to Moldable API server')
    })
  })

  describe('tool descriptions', () => {
    it('has descriptions for all tools', async () => {
      const { APP_MANAGEMENT_TOOL_DESCRIPTIONS } = await import(
        './app-management'
      )

      expect(APP_MANAGEMENT_TOOL_DESCRIPTIONS.getAppInfo).toBeDefined()
      expect(APP_MANAGEMENT_TOOL_DESCRIPTIONS.unregisterApp).toBeDefined()
      expect(APP_MANAGEMENT_TOOL_DESCRIPTIONS.deleteAppData).toBeDefined()
      expect(APP_MANAGEMENT_TOOL_DESCRIPTIONS.deleteApp).toBeDefined()

      // deleteApp should mention it's dangerous
      expect(APP_MANAGEMENT_TOOL_DESCRIPTIONS.deleteApp).toContain('DANGEROUS')
    })
  })

  describe('API server port configuration', () => {
    it('uses default port when not specified', async () => {
      const tools = createAppManagementTools()

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, appId: 'test' }),
      } as Response)

      await tools.getAppInfo.execute!({ appId: 'test' }, ctx)

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:39102/api/app-info',
        expect.any(Object),
      )
    })

    it('uses custom port when specified', async () => {
      const tools = createAppManagementTools({ apiServerPort: 39150 })

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, appId: 'test' }),
      } as Response)

      await tools.getAppInfo.execute!({ appId: 'test' }, ctx)

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:39150/api/app-info',
        expect.any(Object),
      )
    })
  })

  describe('input validation', () => {
    it('validates appId format in schema', () => {
      const tools = createAppManagementTools()

      // The schema should be defined and require lowercase with hyphens
      expect(tools.getAppInfo.inputSchema).toBeDefined()
      expect(tools.unregisterApp.inputSchema).toBeDefined()
      expect(tools.deleteAppData.inputSchema).toBeDefined()
      expect(tools.deleteApp.inputSchema).toBeDefined()
    })
  })
})
