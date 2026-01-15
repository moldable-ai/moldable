import { expandServerConfig, loadMcpConfig } from './config.js'
import { getAugmentedPath, resolveExecutablePath } from './paths.js'
import type {
  McpServerConfig,
  McpServerInfo,
  McpServerStatus,
  McpToolInfo,
} from './types.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
// SSEClientTransport is deprecated - kept for backwards compatibility with older servers
// Prefer StreamableHTTPClientTransport for new remote connections
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'

/**
 * Events emitted by the MCP client manager
 */
export type McpClientEvent =
  | { type: 'tools_changed'; serverName: string }
  | { type: 'resources_changed'; serverName: string }
  | { type: 'prompts_changed'; serverName: string }
  | { type: 'server_connected'; serverName: string }
  | { type: 'server_disconnected'; serverName: string }
  | { type: 'server_error'; serverName: string; error: string }

export type McpClientEventListener = (event: McpClientEvent) => void

/**
 * Manages connections to MCP servers
 *
 * Implements an MCP Host per the spec:
 * https://modelcontextprotocol.io/docs/learn/architecture
 *
 * Each server connection creates a dedicated MCP client that maintains
 * the connection and handles tool discovery, execution, and notifications.
 */
export class McpClientManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, Transport> = new Map()
  private serverInfo: Map<string, McpServerInfo> = new Map()
  private configPath?: string
  private eventListeners: Set<McpClientEventListener> = new Set()

  constructor(configPath?: string) {
    this.configPath = configPath
  }

  /**
   * Subscribe to client events (tool changes, server status, etc.)
   */
  addEventListener(listener: McpClientEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: McpClientEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('Error in MCP event listener:', error)
      }
    }
  }

  /**
   * Load configuration and connect to all configured servers
   * Skips servers marked as disabled
   */
  async connectAll(): Promise<McpServerInfo[]> {
    const config = loadMcpConfig(this.configPath)
    const results: McpServerInfo[] = []

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      // Skip disabled servers but still include them in results
      if (serverConfig.disabled) {
        const info: McpServerInfo = {
          name,
          config: serverConfig,
          status: 'disconnected',
          tools: [],
        }
        this.serverInfo.set(name, info)
        results.push(info)
        console.log(`⏸️  Skipping disabled MCP server "${name}"`)
        continue
      }

      const info = await this.connect(name, serverConfig)
      results.push(info)
    }

    return results
  }

  /**
   * Connect to a specific MCP server
   *
   * Per MCP spec, this implements:
   * 1. Transport creation based on server type (stdio/http/sse)
   * 2. Client initialization with capability negotiation
   * 3. Tool discovery via tools/list
   * 4. Notification handlers for dynamic updates
   *
   * See: https://modelcontextprotocol.io/docs/learn/architecture
   */
  async connect(
    name: string,
    serverConfig: McpServerConfig,
  ): Promise<McpServerInfo> {
    // Disconnect existing connection if any
    await this.disconnect(name)

    // Initialize server info
    const info: McpServerInfo = {
      name,
      config: serverConfig,
      status: 'connecting',
      tools: [],
    }
    this.serverInfo.set(name, info)

    try {
      // Expand environment variables
      const expandedConfig = expandServerConfig(serverConfig)

      // Create transport based on type
      const transport = await this.createTransport(name, expandedConfig)
      this.transports.set(name, transport)

      // Create and connect client with capabilities
      // Per MCP spec, we can declare what client features we support
      const client = new Client(
        { name: `moldable-${name}`, version: '1.0.0' },
        {
          capabilities: {
            // We support receiving tool/resource/prompt change notifications
            // This tells servers they can send us notifications/tools/list_changed etc.
          },
        },
      )

      // Set up notification handlers before connecting
      // Per MCP spec: https://modelcontextprotocol.io/docs/learn/architecture#notifications
      this.setupNotificationHandlers(client, name)

      await client.connect(transport)
      this.clients.set(name, client)

      // List available tools
      const toolsResult = await client.listTools()
      const tools: McpToolInfo[] = toolsResult.tools.map((tool) => ({
        serverName: name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }))

      // Update server info
      info.status = 'connected'
      info.tools = tools
      info.error = undefined

      console.log(
        `✅ Connected to MCP server "${name}" with ${tools.length} tools`,
      )

      this.emit({ type: 'server_connected', serverName: name })

      return info
    } catch (error) {
      info.status = 'error'
      info.error = error instanceof Error ? error.message : String(error)
      console.error(`❌ Failed to connect to MCP server "${name}":`, error)
      this.emit({ type: 'server_error', serverName: name, error: info.error })
      return info
    }
  }

  /**
   * Set up notification handlers for a client
   *
   * Per MCP spec, servers can send notifications when:
   * - Tools change (notifications/tools/list_changed)
   * - Resources change (notifications/resources/list_changed)
   * - Prompts change (notifications/prompts/list_changed)
   *
   * See: https://modelcontextprotocol.io/docs/learn/architecture#notifications
   */
  private setupNotificationHandlers(client: Client, serverName: string): void {
    // Handle tools/list_changed notification
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        console.log(`🔄 Tools changed for MCP server "${serverName}"`)
        await this.refreshTools(serverName)
        this.emit({ type: 'tools_changed', serverName })
      },
    )

    // Handle resources/list_changed notification
    client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async () => {
        console.log(`🔄 Resources changed for MCP server "${serverName}"`)
        this.emit({ type: 'resources_changed', serverName })
      },
    )

    // Handle prompts/list_changed notification
    client.setNotificationHandler(
      PromptListChangedNotificationSchema,
      async () => {
        console.log(`🔄 Prompts changed for MCP server "${serverName}"`)
        this.emit({ type: 'prompts_changed', serverName })
      },
    )
  }

  /**
   * Refresh the tool list for a connected server
   */
  async refreshTools(serverName: string): Promise<McpToolInfo[]> {
    const client = this.clients.get(serverName)
    const info = this.serverInfo.get(serverName)

    if (!client || !info || info.status !== 'connected') {
      return []
    }

    try {
      const toolsResult = await client.listTools()
      const tools: McpToolInfo[] = toolsResult.tools.map((tool) => ({
        serverName,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }))

      info.tools = tools
      console.log(
        `✅ Refreshed tools for "${serverName}": ${tools.length} tools`,
      )

      return tools
    } catch (error) {
      console.error(`❌ Failed to refresh tools for "${serverName}":`, error)
      return info.tools
    }
  }

  /**
   * Create transport for a server configuration
   */
  private async createTransport(
    name: string,
    config: McpServerConfig,
  ): Promise<Transport> {
    switch (config.type) {
      case 'stdio': {
        // Resolve the command path (handles NVM, homebrew, etc.)
        const resolvedCommand = resolveExecutablePath(config.command)

        // Merge config env with process.env so child process has access to
        // HOME, PATH, USER, etc. Config env takes precedence.
        // Also augment PATH to include common executable locations
        const mergedEnv = {
          ...process.env,
          PATH: getAugmentedPath(),
          ...config.env,
        } as Record<string, string>

        return new StdioClientTransport({
          command: resolvedCommand,
          args: config.args,
          env: mergedEnv,
          cwd: config.cwd,
        })
      }

      case 'http': {
        const url = new URL(config.url)
        return new StreamableHTTPClientTransport(url, {
          requestInit: config.headers ? { headers: config.headers } : undefined,
        })
      }

      case 'sse': {
        const url = new URL(config.url)
        return new SSEClientTransport(url, {
          requestInit: config.headers ? { headers: config.headers } : undefined,
        })
      }

      default:
        throw new Error(
          `Unknown transport type for server "${name}": ${(config as McpServerConfig).type}`,
        )
    }
  }

  /**
   * Disconnect from a specific MCP server
   */
  async disconnect(name: string): Promise<void> {
    const wasConnected = this.clients.has(name)

    const client = this.clients.get(name)
    if (client) {
      try {
        await client.close()
      } catch (error) {
        console.warn(`Warning: Error closing MCP client "${name}":`, error)
      }
      this.clients.delete(name)
    }

    const transport = this.transports.get(name)
    if (transport) {
      try {
        await transport.close()
      } catch (error) {
        console.warn(`Warning: Error closing MCP transport "${name}":`, error)
      }
      this.transports.delete(name)
    }

    const info = this.serverInfo.get(name)
    if (info) {
      info.status = 'disconnected'
      info.tools = []
    }

    if (wasConnected) {
      this.emit({ type: 'server_disconnected', serverName: name })
    }
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.clients.keys())
    await Promise.all(names.map((name) => this.disconnect(name)))
  }

  /**
   * Get all connected servers' info
   */
  getServers(): McpServerInfo[] {
    return Array.from(this.serverInfo.values())
  }

  /**
   * Get a specific server's info
   */
  getServer(name: string): McpServerInfo | undefined {
    return this.serverInfo.get(name)
  }

  /**
   * Get server status
   */
  getStatus(name: string): McpServerStatus {
    return this.serverInfo.get(name)?.status ?? 'disconnected'
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const info of this.serverInfo.values()) {
      if (info.status === 'connected') {
        tools.push(...info.tools)
      }
    }
    return tools
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = this.clients.get(serverName)
    if (!client) {
      throw new Error(`MCP server "${serverName}" is not connected`)
    }

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    })

    return result
  }

  /**
   * Reload configuration and reconnect to servers
   */
  async reload(): Promise<McpServerInfo[]> {
    await this.disconnectAll()
    return this.connectAll()
  }
}

/**
 * Create a singleton MCP client manager
 */
let defaultManager: McpClientManager | null = null

export function getDefaultMcpManager(configPath?: string): McpClientManager {
  if (!defaultManager) {
    defaultManager = new McpClientManager(configPath)
  }
  return defaultManager
}

export function resetDefaultMcpManager(): void {
  if (defaultManager) {
    defaultManager.disconnectAll()
    defaultManager = null
  }
}
