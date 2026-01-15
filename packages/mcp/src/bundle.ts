import { addMcpServer } from './config.js'
import type { StdioServerConfig } from './types.js'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod'

/**
 * MCPB Manifest Schema
 *
 * Based on: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
 *
 * MCPB (MCP Bundles) are zip archives containing an MCP server and a manifest.json
 * that describes the server and its capabilities.
 */

// Author info
const AuthorSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  url: z.string().optional(),
})

// Repository info
const RepositorySchema = z.object({
  type: z.string().optional(),
  url: z.string(),
})

// User config field types
const UserConfigFieldSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    .optional(),
  multiple: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

export type UserConfigField = z.infer<typeof UserConfigFieldSchema>

// MCP config embedded in manifest
const McpConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  platform_overrides: z
    .record(
      z.object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
      }),
    )
    .optional(),
})

// Server configuration
const ServerSchema = z.object({
  type: z.enum(['node', 'python', 'binary', 'uv']),
  entry_point: z.string(),
  mcp_config: McpConfigSchema.optional(),
})

// Tool definition
const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
})

// Prompt definition
const PromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(z.string()).optional(),
  text: z.string().optional(),
})

// Compatibility requirements
const CompatibilitySchema = z
  .object({
    claude_desktop: z.string().optional(),
    moldable: z.string().optional(),
    platforms: z.array(z.enum(['darwin', 'win32', 'linux'])).optional(),
    runtimes: z
      .object({
        python: z.string().optional(),
        node: z.string().optional(),
      })
      .optional(),
  })
  .passthrough() // Allow other client version constraints

// Icon descriptor
const IconSchema = z.object({
  src: z.string(),
  size: z.string().optional(),
  theme: z.string().optional(),
})

/**
 * Full MCPB Manifest schema
 */
export const McpbManifestSchema = z.object({
  // Required fields
  manifest_version: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: AuthorSchema,
  server: ServerSchema,

  // Optional fields
  display_name: z.string().optional(),
  long_description: z.string().optional(),
  repository: RepositorySchema.optional(),
  homepage: z.string().optional(),
  documentation: z.string().optional(),
  support: z.string().optional(),
  icon: z.string().optional(),
  icons: z.array(IconSchema).optional(),
  screenshots: z.array(z.string()).optional(),
  tools: z.array(ToolSchema).optional(),
  tools_generated: z.boolean().optional(),
  prompts: z.array(PromptSchema).optional(),
  prompts_generated: z.boolean().optional(),
  keywords: z.array(z.string()).optional(),
  license: z.string().optional(),
  privacy_policies: z.array(z.string()).optional(),
  compatibility: CompatibilitySchema.optional(),
  user_config: z.record(UserConfigFieldSchema).optional(),
  _meta: z.record(z.unknown()).optional(),
})

export type McpbManifest = z.infer<typeof McpbManifestSchema>

/**
 * Result of parsing an MCPB bundle
 */
export interface McpbBundleInfo {
  manifest: McpbManifest
  /** Raw manifest JSON for display purposes */
  rawManifest: Record<string, unknown>
  /** Path to the extracted bundle (if extracted) */
  extractedPath?: string
  /** Whether this bundle is compatible with the current platform */
  isCompatible: boolean
  /** Compatibility issues if any */
  compatibilityIssues: string[]
}

/**
 * User configuration values collected during installation
 */
export type UserConfigValues = Record<
  string,
  string | number | boolean | string[]
>

/**
 * Get the default MCPB installation directory
 */
export function getMcpbInstallDir(): string {
  return join(homedir(), '.moldable', 'shared', 'mcps')
}

/**
 * Parse an MCPB manifest from JSON
 */
export function parseManifest(json: unknown): McpbManifest {
  return McpbManifestSchema.parse(json)
}

/**
 * Check platform compatibility
 */
export function checkCompatibility(manifest: McpbManifest): {
  isCompatible: boolean
  issues: string[]
} {
  const issues: string[] = []
  const platform = process.platform as 'darwin' | 'win32' | 'linux'

  // Check platform compatibility
  if (manifest.compatibility?.platforms) {
    if (!manifest.compatibility.platforms.includes(platform)) {
      issues.push(
        `This bundle only supports: ${manifest.compatibility.platforms.join(', ')}. Current platform: ${platform}`,
      )
    }
  }

  // Check runtime requirements
  if (manifest.compatibility?.runtimes) {
    if (
      manifest.server.type === 'python' &&
      manifest.compatibility.runtimes.python
    ) {
      // Could add actual version checking here
      // For now, just note the requirement
    }
    if (
      manifest.server.type === 'node' &&
      manifest.compatibility.runtimes.node
    ) {
      // Could add actual version checking here
    }
  }

  return {
    isCompatible: issues.length === 0,
    issues,
  }
}

/**
 * Expand MCPB variables in a string
 *
 * Supported variables:
 * - ${__dirname} - Path to the installed bundle directory
 * - ${HOME} - User's home directory
 * - ${DESKTOP} - User's desktop directory
 * - ${DOCUMENTS} - User's documents directory
 * - ${DOWNLOADS} - User's downloads directory
 * - ${pathSeparator} or ${/} - Path separator
 * - ${user_config.KEY} - User-provided config value
 */
export function expandMcpbVariables(
  value: string,
  bundlePath: string,
  userConfig: UserConfigValues = {},
): string {
  const home = homedir()

  return value
    .replace(/\$\{__dirname\}/g, bundlePath)
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$\{DESKTOP\}/g, join(home, 'Desktop'))
    .replace(/\$\{DOCUMENTS\}/g, join(home, 'Documents'))
    .replace(/\$\{DOWNLOADS\}/g, join(home, 'Downloads'))
    .replace(/\$\{pathSeparator\}/g, process.platform === 'win32' ? '\\' : '/')
    .replace(/\$\{\/\}/g, process.platform === 'win32' ? '\\' : '/')
    .replace(/\$\{user_config\.([^}]+)\}/g, (_, key) => {
      const val = userConfig[key]
      if (Array.isArray(val)) {
        return val.join(' ') // For arrays, join with space
      }
      return String(val ?? '')
    })
}

/**
 * Generate MCP server config from an installed MCPB bundle
 */
export function generateServerConfig(
  manifest: McpbManifest,
  bundlePath: string,
  userConfig: UserConfigValues = {},
): StdioServerConfig {
  const platform = process.platform as 'darwin' | 'win32' | 'linux'

  // Get base MCP config
  let mcpConfig = manifest.server.mcp_config

  // Apply platform overrides if present
  if (mcpConfig?.platform_overrides?.[platform]) {
    const override = mcpConfig.platform_overrides[platform]
    mcpConfig = {
      ...mcpConfig,
      command: override.command ?? mcpConfig.command,
      args: override.args ?? mcpConfig.args,
      env: { ...mcpConfig.env, ...override.env },
    }
  }

  // If no mcp_config, generate default based on server type
  if (!mcpConfig) {
    mcpConfig = generateDefaultMcpConfig(manifest, bundlePath)
  }

  // Expand variables
  const command = expandMcpbVariables(mcpConfig.command, bundlePath, userConfig)
  const args = mcpConfig.args?.map((arg) =>
    expandMcpbVariables(arg, bundlePath, userConfig),
  )
  const env = mcpConfig.env
    ? Object.fromEntries(
        Object.entries(mcpConfig.env).map(([k, v]) => [
          k,
          expandMcpbVariables(v, bundlePath, userConfig),
        ]),
      )
    : undefined

  return {
    type: 'stdio',
    command,
    args,
    env,
    cwd: bundlePath,
  }
}

/**
 * Generate default MCP config based on server type
 */
function generateDefaultMcpConfig(
  manifest: McpbManifest,
  bundlePath: string,
): NonNullable<McpbManifest['server']['mcp_config']> {
  const entryPoint = manifest.server.entry_point

  switch (manifest.server.type) {
    case 'node':
      return {
        command: 'node',
        args: [join(bundlePath, entryPoint)],
      }
    case 'python':
      return {
        command: process.platform === 'win32' ? 'python' : 'python3',
        args: [join(bundlePath, entryPoint)],
        env: {
          PYTHONPATH: join(bundlePath, 'server', 'lib'),
        },
      }
    case 'uv':
      return {
        command: 'uv',
        args: ['run', join(bundlePath, entryPoint)],
      }
    case 'binary': {
      const cmd =
        process.platform === 'win32' ? `${entryPoint}.exe` : entryPoint
      return {
        command: join(bundlePath, cmd),
        args: [],
      }
    }
  }
}

/**
 * Install an MCPB bundle
 *
 * @param bundleData - The raw MCPB file data (ZIP)
 * @param userConfig - User-provided configuration values
 * @param mcpConfigPath - Path to the mcp.json config file
 * @returns The installed server name and path
 */
export async function installBundle(
  _bundleData: ArrayBuffer,
  _userConfig: UserConfigValues = {},
  _mcpConfigPath?: string,
): Promise<{ name: string; path: string }> {
  // Bundle installation is handled by the AI server which extracts the ZIP
  // and calls installBundleFromExtracted(). This function exists for API
  // compatibility but delegates to the server-side implementation.
  throw new Error(
    'Bundle installation requires server-side extraction. Use installBundleFromExtracted() for pre-extracted bundles.',
  )
}

/**
 * Install an MCPB bundle from an already-extracted directory
 *
 * This is useful when the extraction is done elsewhere (e.g., in Tauri/Rust)
 */
export function installBundleFromExtracted(
  extractedPath: string,
  userConfig: UserConfigValues = {},
  mcpConfigPath?: string,
): { name: string; serverConfig: StdioServerConfig } {
  // Read manifest
  const manifestPath = join(extractedPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${extractedPath}`)
  }

  const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const manifest = parseManifest(manifestJson)

  // Check compatibility
  const { isCompatible, issues } = checkCompatibility(manifest)
  if (!isCompatible) {
    throw new Error(`Bundle is not compatible: ${issues.join(', ')}`)
  }

  // Generate server config
  const serverConfig = generateServerConfig(manifest, extractedPath, userConfig)

  // Add to MCP config
  addMcpServer(manifest.name, serverConfig, mcpConfigPath)

  return {
    name: manifest.name,
    serverConfig,
  }
}

/**
 * Get the install path for a bundle
 */
export function getBundleInstallPath(bundleName: string): string {
  return join(getMcpbInstallDir(), bundleName)
}

/**
 * Check if a bundle is already installed
 */
export function isBundleInstalled(bundleName: string): boolean {
  const installPath = getBundleInstallPath(bundleName)
  return existsSync(join(installPath, 'manifest.json'))
}

/**
 * Read manifest from an installed bundle
 */
export function readInstalledManifest(bundleName: string): McpbManifest | null {
  const manifestPath = join(getBundleInstallPath(bundleName), 'manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }

  try {
    const json = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    return parseManifest(json)
  } catch {
    return null
  }
}

/**
 * Get default values for user config fields
 */
export function getDefaultUserConfigValues(
  userConfig: Record<string, UserConfigField>,
): UserConfigValues {
  const values: UserConfigValues = {}

  for (const [key, field] of Object.entries(userConfig)) {
    if (field.default !== undefined) {
      // Expand HOME variables in defaults
      if (typeof field.default === 'string') {
        values[key] = field.default.replace(/\$\{HOME\}/g, homedir())
      } else if (Array.isArray(field.default)) {
        values[key] = field.default.map((v) =>
          typeof v === 'string' ? v.replace(/\$\{HOME\}/g, homedir()) : v,
        ) as string[]
      } else {
        values[key] = field.default
      }
    }
  }

  return values
}

/**
 * Validate user config values against the schema
 */
export function validateUserConfig(
  userConfig: Record<string, UserConfigField>,
  values: UserConfigValues,
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  for (const [key, field] of Object.entries(userConfig)) {
    const value = values[key]

    // Check required fields
    if (field.required && (value === undefined || value === '')) {
      errors[key] = `${field.title} is required`
      continue
    }

    // Skip validation if not required and empty
    if (value === undefined || value === '') {
      continue
    }

    // Type-specific validation
    switch (field.type) {
      case 'number':
        if (typeof value !== 'number') {
          errors[key] = `${field.title} must be a number`
        } else {
          if (field.min !== undefined && value < field.min) {
            errors[key] = `${field.title} must be at least ${field.min}`
          }
          if (field.max !== undefined && value > field.max) {
            errors[key] = `${field.title} must be at most ${field.max}`
          }
        }
        break

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors[key] = `${field.title} must be a boolean`
        }
        break

      case 'directory':
      case 'file':
        if (field.multiple) {
          if (!Array.isArray(value)) {
            errors[key] = `${field.title} must be an array of paths`
          }
        } else {
          if (typeof value !== 'string') {
            errors[key] = `${field.title} must be a path`
          }
        }
        break
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}
