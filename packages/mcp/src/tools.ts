import type { McpClientManager } from './client.js'
import type { McpToolInfo } from './types.js'
import { tool } from 'ai'
import { z } from 'zod'

/**
 * Convert a JSON Schema to a Zod schema
 * This is a simplified converter that handles common cases
 *
 * Per MCP spec, inputSchema MUST have type: "object"
 * See: https://modelcontextprotocol.io/specification/2025-11-25/server/tools.md
 * But some MCP servers may return malformed schemas, so we handle edge cases.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema.type as string | undefined

  // Handle object type (most common for tool inputSchema)
  // Also handle missing type if properties exist (malformed but recoverable)
  if (type === 'object' || (!type && schema.properties)) {
    const properties = schema.properties as
      | Record<string, Record<string, unknown>>
      | undefined
    const required = (schema.required as string[]) ?? []

    if (!properties) {
      // No properties = accepts any object or empty object
      return z.object({})
    }

    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, propSchema] of Object.entries(properties)) {
      let zodProp = jsonSchemaToZod(propSchema)
      if (!required.includes(key)) {
        zodProp = zodProp.optional()
      }
      // Add description if available
      if (propSchema.description) {
        zodProp = zodProp.describe(propSchema.description as string)
      }
      shape[key] = zodProp
    }

    return z.object(shape)
  }

  switch (type) {
    case 'string':
      return schema.enum
        ? z.enum(schema.enum as [string, ...string[]])
        : z.string()

    case 'number':
    case 'integer':
      return z.number()

    case 'boolean':
      return z.boolean()

    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined
      if (items) {
        return z.array(jsonSchemaToZod(items))
      }
      return z.array(z.unknown())
    }

    case 'null':
      return z.null()

    default:
      // Per MCP spec, inputSchema MUST be type: "object"
      // Default to empty object for malformed schemas without type
      return z.object({})
  }
}

/**
 * Extract text content from MCP tool result
 */
function extractResultContent(result: unknown): string {
  // MCP tools return a CallToolResult with content array
  // Extract the text content for the AI
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content: unknown[] }).content
    if (Array.isArray(content)) {
      // Combine all text content
      const textParts = content
        .filter(
          (c): c is { type: 'text'; text: string } =>
            typeof c === 'object' &&
            c !== null &&
            'type' in c &&
            c.type === 'text',
        )
        .map((c) => c.text)

      if (textParts.length > 0) {
        return textParts.join('\n')
      }

      // If no text, return JSON representation
      return JSON.stringify(content, null, 2)
    }
  }

  // Return raw result if not in expected format
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}

/**
 * Convert an MCP tool to an AI SDK tool
 */
export function mcpToolToAiTool(
  mcpTool: McpToolInfo,
  manager: McpClientManager,
) {
  // Convert JSON Schema to Zod schema
  const zodSchema = jsonSchemaToZod(mcpTool.inputSchema)

  return tool({
    description:
      mcpTool.description ?? `Tool from MCP server: ${mcpTool.serverName}`,
    parameters: zodSchema as z.ZodObject<z.ZodRawShape>,
    execute: async (args) => {
      try {
        const result = await manager.callTool(
          mcpTool.serverName,
          mcpTool.name,
          args as Record<string, unknown>,
        )
        return extractResultContent(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error calling MCP tool "${mcpTool.name}": ${message}`
      }
    },
  })
}

/**
 * Convert all MCP tools from a manager to AI SDK tools
 * Tool names are prefixed with server name to avoid conflicts
 */
export function createMcpTools(
  manager: McpClientManager,
): Record<string, ReturnType<typeof mcpToolToAiTool>> {
  const tools: Record<string, ReturnType<typeof mcpToolToAiTool>> = {}
  const mcpTools = manager.getAllTools()

  for (const mcpTool of mcpTools) {
    // Prefix tool name with server name to avoid conflicts
    // e.g., "mcp_shippy_list_bounties" instead of just "list_bounties"
    const toolName = `mcp_${mcpTool.serverName}_${mcpTool.name}`
    tools[toolName] = mcpToolToAiTool(mcpTool, manager)
  }

  return tools
}

/**
 * Get tool descriptions for all MCP tools (for system prompt)
 */
export function getMcpToolDescriptions(
  manager: McpClientManager,
): Record<string, string> {
  const descriptions: Record<string, string> = {}
  const mcpTools = manager.getAllTools()

  for (const mcpTool of mcpTools) {
    const toolName = `mcp_${mcpTool.serverName}_${mcpTool.name}`
    descriptions[toolName] =
      mcpTool.description ?? `MCP tool from ${mcpTool.serverName}`
  }

  return descriptions
}
