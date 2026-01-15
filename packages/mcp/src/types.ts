import { z } from 'zod'

/**
 * Configuration for a stdio-based MCP server (local process)
 *
 * Per MCP spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
 * stdio transport is the primary transport for local servers.
 *
 * Note: Claude Desktop config doesn't require explicit `type` field for stdio servers.
 * We support both explicit type: "stdio" and inferred type when `command` is present.
 */
export const StdioServerConfigSchema = z.object({
  /** Transport type (optional - inferred from `command` if not specified) */
  type: z.literal('stdio').optional(),
  /** Command to run the server */
  command: z.string(),
  /** Arguments to pass to the command */
  args: z.array(z.string()).optional(),
  /** Environment variables for the server process */
  env: z.record(z.string()).optional(),
  /** Working directory for the server process */
  cwd: z.string().optional(),
  /** Whether this server is disabled (won't connect automatically) */
  disabled: z.boolean().optional(),
})

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>

/**
 * Configuration for an HTTP-based MCP server (Streamable HTTP transport)
 *
 * Per MCP spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
 * This is the standard transport for remote servers (replaces legacy SSE).
 */
export const HttpServerConfigSchema = z.object({
  /** Transport type */
  type: z.literal('http'),
  /** URL of the remote MCP server */
  url: z.string().url(),
  /** HTTP headers to include in requests (e.g., Authorization) */
  headers: z.record(z.string()).optional(),
  /** Whether this server is disabled (won't connect automatically) */
  disabled: z.boolean().optional(),
})

export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>

/**
 * Configuration for an SSE-based MCP server (legacy remote)
 *
 * @deprecated Per MCP spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
 * SSE transport is deprecated from protocol version 2024-11-05.
 * Use HTTP (Streamable HTTP) transport for new servers.
 * Kept for backwards compatibility with older servers.
 */
export const SseServerConfigSchema = z.object({
  /** Transport type */
  type: z.literal('sse'),
  /** URL of the SSE endpoint */
  url: z.string().url(),
  /** HTTP headers to include in requests */
  headers: z.record(z.string()).optional(),
  /** Whether this server is disabled (won't connect automatically) */
  disabled: z.boolean().optional(),
})

/** @deprecated Use HttpServerConfig instead */
export type SseServerConfig = z.infer<typeof SseServerConfigSchema>

/**
 * Raw server config before type normalization.
 * This matches Claude Desktop's config format where `type` is optional for stdio servers.
 */
const RawServerConfigSchema = z.union([
  // Explicit type configs
  z.object({ type: z.literal('http') }).and(HttpServerConfigSchema),
  z.object({ type: z.literal('sse') }).and(SseServerConfigSchema),
  z.object({ type: z.literal('stdio') }).and(StdioServerConfigSchema),
  // Inferred stdio config (Claude Desktop style - no type field)
  z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
    disabled: z.boolean().optional(),
  }),
])

/**
 * Union of all server config types.
 * Supports both explicit type field and inferred type from command/url presence.
 */
export const McpServerConfigSchema = RawServerConfigSchema.transform(
  (config): StdioServerConfig | HttpServerConfig | SseServerConfig => {
    // Already has explicit type
    if ('type' in config && config.type) {
      return config as StdioServerConfig | HttpServerConfig | SseServerConfig
    }

    // Infer stdio from command presence
    if ('command' in config) {
      return { ...config, type: 'stdio' as const }
    }

    // Should not reach here due to schema validation
    throw new Error('Invalid MCP server config: missing type or command')
  },
)

export type McpServerConfig =
  | StdioServerConfig
  | HttpServerConfig
  | SseServerConfig

/**
 * MCP configuration file format (compatible with Claude Desktop format)
 */
export const McpConfigSchema = z.object({
  /** Map of server name to server configuration */
  mcpServers: z.record(McpServerConfigSchema),
})

export type McpConfig = z.infer<typeof McpConfigSchema>

/**
 * Information about an MCP tool
 */
export interface McpToolInfo {
  /** Server this tool belongs to */
  serverName: string
  /** Tool name */
  name: string
  /** Tool description */
  description?: string
  /** JSON schema for input parameters */
  inputSchema: Record<string, unknown>
}

/**
 * Status of an MCP server connection
 */
export type McpServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

/**
 * Information about a connected MCP server
 */
export interface McpServerInfo {
  /** Server name (key in config) */
  name: string
  /** Server configuration */
  config: McpServerConfig
  /** Current connection status */
  status: McpServerStatus
  /** Error message if status is 'error' */
  error?: string
  /** Available tools from this server */
  tools: McpToolInfo[]
}
