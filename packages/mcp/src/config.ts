import { McpConfig, McpConfigSchema, McpServerConfig } from './types.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

/**
 * Default path for MCP configuration file
 * MCPs are shared across all workspaces
 */
export function getDefaultConfigPath(): string {
  return join(homedir(), '.moldable', 'shared', 'config', 'mcp.json')
}

/**
 * Load MCP configuration from a file
 */
export function loadMcpConfig(configPath?: string): McpConfig {
  const path = configPath ?? getDefaultConfigPath()

  if (!existsSync(path)) {
    return { mcpServers: {} }
  }

  try {
    const content = readFileSync(path, 'utf-8')
    const json = JSON.parse(content)
    return McpConfigSchema.parse(json)
  } catch (error) {
    console.error(`Failed to load MCP config from ${path}:`, error)
    return { mcpServers: {} }
  }
}

/**
 * Save MCP configuration to a file
 */
export function saveMcpConfig(config: McpConfig, configPath?: string): void {
  const path = configPath ?? getDefaultConfigPath()

  // Ensure directory exists
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // Validate before saving
  const validated = McpConfigSchema.parse(config)

  writeFileSync(path, JSON.stringify(validated, null, 2), 'utf-8')
}

/**
 * Add or update an MCP server in the configuration
 */
export function addMcpServer(
  name: string,
  serverConfig: McpServerConfig,
  configPath?: string,
): McpConfig {
  const config = loadMcpConfig(configPath)
  config.mcpServers[name] = serverConfig
  saveMcpConfig(config, configPath)
  return config
}

/**
 * Remove an MCP server from the configuration
 */
export function removeMcpServer(name: string, configPath?: string): McpConfig {
  const config = loadMcpConfig(configPath)
  delete config.mcpServers[name]
  saveMcpConfig(config, configPath)
  return config
}

/**
 * Get a specific MCP server configuration
 */
export function getMcpServer(
  name: string,
  configPath?: string,
): McpServerConfig | undefined {
  const config = loadMcpConfig(configPath)
  return config.mcpServers[name]
}

/**
 * List all configured MCP servers
 */
export function listMcpServers(
  configPath?: string,
): Record<string, McpServerConfig> {
  const config = loadMcpConfig(configPath)
  return config.mcpServers
}

/**
 * Expand environment variables in a string (e.g., ${VAR_NAME})
 */
export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] ?? ''
  })
}

/**
 * Expand environment variables in a record of strings
 */
function expandEnvVarsInRecord(
  record: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = expandEnvVars(value)
  }
  return result
}

/**
 * Expand environment variables in server config
 */
export function expandServerConfig(config: McpServerConfig): McpServerConfig {
  if (config.type === 'stdio') {
    return {
      ...config,
      command: expandEnvVars(config.command),
      args: config.args?.map(expandEnvVars),
      cwd: config.cwd ? expandEnvVars(config.cwd) : undefined,
      env: config.env ? expandEnvVarsInRecord(config.env) : undefined,
      disabled: config.disabled,
    }
  }

  if (config.type === 'http' || config.type === 'sse') {
    return {
      ...config,
      url: expandEnvVars(config.url),
      headers: config.headers
        ? expandEnvVarsInRecord(config.headers)
        : undefined,
      disabled: config.disabled,
    }
  }

  return config
}
