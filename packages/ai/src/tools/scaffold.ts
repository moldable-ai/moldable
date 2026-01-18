import { tool, zodSchema } from 'ai'
import { z } from 'zod/v4'

/**
 * Valid widget sizes
 */
const WIDGET_SIZES = ['small', 'medium', 'large'] as const

/**
 * Default API server port (may be different if another instance is running)
 */
const DEFAULT_API_SERVER_PORT = 39102

/**
 * Options for creating scaffold tools
 */
export interface ScaffoldToolsOptions {
  /** API server port (passed from frontend which knows the actual port) */
  apiServerPort?: number
}

/**
 * Response from the create-app API
 */
interface CreateAppResponse {
  success: boolean
  appId?: string
  name?: string
  icon?: string
  port?: number
  path?: string
  files?: string[]
  pnpmInstalled?: boolean
  registered?: boolean
  message?: string
  error?: string
}

/**
 * Create app scaffolding tools
 */
export function createScaffoldTools(options: ScaffoldToolsOptions = {}) {
  const { apiServerPort = DEFAULT_API_SERVER_PORT } = options

  const scaffoldAppSchema = z.object({
    appId: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'App ID must be lowercase with hyphens only')
      .describe(
        'Unique app identifier (lowercase, hyphens allowed, e.g., "my-app")',
      ),
    name: z
      .string()
      .min(1)
      .describe('Display name of the app (e.g., "My App")'),
    icon: z.string().describe('Emoji icon for the app (e.g., "🚀")'),
    description: z.string().describe('Brief description of what the app does'),
    widgetSize: z
      .enum(WIDGET_SIZES)
      .default('medium')
      .describe('Widget size: small, medium, or large'),
    extraDependencies: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Optional extra npm dependencies to add (e.g., {"zod": "^3.0.0"})',
      ),
    extraDevDependencies: z
      .record(z.string(), z.string())
      .optional()
      .describe('Optional extra npm dev dependencies to add'),
  })

  return {
    scaffoldApp: tool({
      description: `Create a new Moldable app from the standard template. This creates a complete Next.js app in ~/.moldable/shared/apps/{appId} with all required files, runs pnpm install, finds an available port, and registers the app in the workspace config. ALWAYS use this tool when creating a new app - do not create app files manually. After scaffolding, customize the app's pages and components.`,
      inputSchema: zodSchema(scaffoldAppSchema),
      execute: async (input) => {
        const {
          appId,
          name,
          icon,
          description,
          widgetSize,
          extraDependencies,
          extraDevDependencies,
        } = input

        try {
          // Call the Rust API server to create the app
          const response = await fetch(
            `http://127.0.0.1:${apiServerPort}/api/create-app`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                appId,
                name,
                icon,
                description,
                widgetSize,
                extraDependencies: extraDependencies ?? {},
                extraDevDependencies: extraDevDependencies ?? {},
              }),
            },
          )

          const result: CreateAppResponse = await response.json()

          if (!result.success) {
            return {
              success: false,
              error: result.error || 'Failed to create app',
            }
          }

          return {
            success: true,
            appId: result.appId,
            name: result.name,
            icon: result.icon,
            port: result.port,
            path: result.path,
            files: result.files,
            pnpmInstalled: result.pnpmInstalled,
            registered: result.registered,
            message: result.message,
          }
        } catch (error) {
          // Check if it's a connection error (API server not running)
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
              error instanceof Error ? error.message : 'Failed to create app',
          }
        }
      },
    }),
  }
}

/**
 * Tool descriptions for UI display
 */
export const SCAFFOLD_TOOL_DESCRIPTIONS = {
  scaffoldApp: 'Create a new Moldable app from the standard template',
} as const
