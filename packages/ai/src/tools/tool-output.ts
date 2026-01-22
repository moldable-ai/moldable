import { tool, zodSchema } from 'ai'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { z } from 'zod/v4'

/**
 * Default limits for tool output truncation
 */
export const TRUNCATION_LIMITS = {
  /** Max characters for file content (readFile) */
  FILE_CONTENT_CHARS: 30_000,
  /** Max lines for file content */
  FILE_CONTENT_LINES: 500,
  /** Max matches for grep results */
  GREP_MATCHES: 200,
  /** Max files for glob search results */
  GLOB_FILES: 500,
  /** Max items for directory listing */
  DIRECTORY_ITEMS: 500,
  /** Max characters for command stdout */
  COMMAND_STDOUT_CHARS: 50_000,
  /** Max characters for command stderr */
  COMMAND_STDERR_CHARS: 20_000,
} as const

/**
 * Truncation result indicating whether truncation occurred
 */
export interface TruncationResult<T> {
  data: T
  truncated: boolean
  totalCount: number
  returnedCount: number
  /** Path to saved full output (if truncated and outputDir provided) */
  savedPath?: string
  /** Message to include in tool output */
  message?: string
}

/**
 * Generate a unique output file ID
 */
export function generateOutputId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `tool_${timestamp}${random}`
}

/**
 * Save large tool output to a file for later retrieval
 */
export function saveToolOutput(
  outputDir: string,
  outputId: string,
  content: string,
  metadata?: Record<string, unknown>,
): string {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const filePath = path.join(outputDir, `${outputId}.txt`)

  // Prepend metadata as YAML front matter if provided
  let fileContent = content
  if (metadata && Object.keys(metadata).length > 0) {
    const metadataLines = Object.entries(metadata)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n')
    fileContent = `---\n${metadataLines}\n---\n\n${content}`
  }

  writeFileSync(filePath, fileContent, 'utf-8')
  return filePath
}

/**
 * Read saved tool output with optional offset/limit
 */
export function readSavedToolOutput(
  filePath: string,
  options: { offset?: number; limit?: number } = {},
): { content: string; totalLines: number; hasMore: boolean } {
  if (!existsSync(filePath)) {
    throw new Error(`Tool output file not found: ${filePath}`)
  }

  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const totalLines = lines.length

  const startLine = options.offset ?? 0
  const endLine = options.limit ? startLine + options.limit : totalLines

  const selectedLines = lines.slice(startLine, endLine)
  const hasMore = endLine < totalLines

  return {
    content: selectedLines.join('\n'),
    totalLines,
    hasMore,
  }
}

/**
 * Truncate string content if it exceeds the limit
 */
export function truncateString(
  content: string,
  options: {
    maxChars?: number
    maxLines?: number
    outputDir?: string
    outputId?: string
    metadata?: Record<string, unknown>
  } = {},
): TruncationResult<string> {
  const {
    maxChars = TRUNCATION_LIMITS.FILE_CONTENT_CHARS,
    maxLines = TRUNCATION_LIMITS.FILE_CONTENT_LINES,
    outputDir,
    outputId,
    metadata,
  } = options

  const lines = content.split('\n')
  const totalLines = lines.length
  const totalChars = content.length

  // Check if truncation is needed
  const needsCharTruncation = totalChars > maxChars
  const needsLineTruncation = totalLines > maxLines
  const needsTruncation = needsCharTruncation || needsLineTruncation

  if (!needsTruncation) {
    return {
      data: content,
      truncated: false,
      totalCount: totalLines,
      returnedCount: totalLines,
    }
  }

  // Determine truncation point
  let truncatedLines: string[]
  let truncatedContent: string

  if (needsLineTruncation) {
    truncatedLines = lines.slice(0, maxLines)
    truncatedContent = truncatedLines.join('\n')
    // Further truncate by chars if still too long
    if (truncatedContent.length > maxChars) {
      truncatedContent = truncatedContent.slice(0, maxChars)
    }
  } else {
    truncatedContent = content.slice(0, maxChars)
    truncatedLines = truncatedContent.split('\n')
  }

  const returnedCount = truncatedLines.length

  // Save full output if outputDir provided
  let savedPath: string | undefined
  let message: string

  if (outputDir && outputId) {
    savedPath = saveToolOutput(outputDir, outputId, content, metadata)
    message =
      `(Results truncated: showing ${returnedCount} of ${totalLines} lines. ` +
      `Full output saved to: ${savedPath}. ` +
      `Use readToolOutput tool with offset/limit to explore.)`
  } else {
    message = `(Results truncated: showing ${returnedCount} of ${totalLines} lines. Consider using offset/limit parameters or a more specific query.)`
  }

  return {
    data: truncatedContent,
    truncated: true,
    totalCount: totalLines,
    returnedCount,
    savedPath,
    message,
  }
}

/**
 * Truncate an array if it exceeds the limit
 */
export function truncateArray<T>(
  items: T[],
  options: {
    maxItems?: number
    outputDir?: string
    outputId?: string
    itemToString?: (item: T) => string
    metadata?: Record<string, unknown>
  } = {},
): TruncationResult<T[]> {
  const {
    maxItems = TRUNCATION_LIMITS.GREP_MATCHES,
    outputDir,
    outputId,
    itemToString = (item) => JSON.stringify(item),
    metadata,
  } = options

  const totalCount = items.length

  if (totalCount <= maxItems) {
    return {
      data: items,
      truncated: false,
      totalCount,
      returnedCount: totalCount,
    }
  }

  const truncatedItems = items.slice(0, maxItems)
  const returnedCount = truncatedItems.length

  // Save full output if outputDir provided
  let savedPath: string | undefined
  let message: string

  if (outputDir && outputId) {
    const fullContent = items.map(itemToString).join('\n')
    savedPath = saveToolOutput(outputDir, outputId, fullContent, {
      ...metadata,
      totalItems: totalCount,
      format: 'array',
    })
    message =
      `(Results truncated: showing ${returnedCount} of ${totalCount} items. ` +
      `Full output saved to: ${savedPath}. ` +
      `Use readToolOutput tool with offset/limit to explore.)`
  } else {
    message = `(Results truncated: showing ${returnedCount} of ${totalCount} items. Consider using a more specific pattern.)`
  }

  return {
    data: truncatedItems,
    truncated: true,
    totalCount,
    returnedCount,
    savedPath,
    message,
  }
}

/**
 * Create the readToolOutput tool for reading saved large outputs
 */
export function createToolOutputTools(options: { outputDir?: string } = {}) {
  const { outputDir } = options

  const readToolOutputSchema = z.object({
    path: z
      .string()
      .describe(
        'Path to the saved tool output file (from a previous truncated result)',
      ),
    offset: z
      .number()
      .optional()
      .describe('Line number to start reading from (0-indexed, default: 0)'),
    limit: z
      .number()
      .optional()
      .describe(
        'Maximum number of lines to read (default: 500). Use smaller values for exploration.',
      ),
  })

  return {
    readToolOutput: tool({
      description:
        'Read a previously saved tool output file that was truncated. Use this to explore large results from grep, readFile, or other tools that were too big to return directly. Supports pagination with offset/limit.',
      inputSchema: zodSchema(readToolOutputSchema),
      execute: async (input) => {
        try {
          // Resolve path - if relative and outputDir provided, resolve against it
          let filePath = input.path
          if (outputDir && !path.isAbsolute(filePath)) {
            filePath = path.join(outputDir, filePath)
          }

          const result = readSavedToolOutput(filePath, {
            offset: input.offset,
            limit: input.limit ?? 500,
          })

          return {
            success: true,
            path: filePath,
            content: result.content,
            totalLines: result.totalLines,
            startLine: input.offset ?? 0,
            linesReturned: result.content.split('\n').length,
            hasMore: result.hasMore,
            hint: result.hasMore
              ? `More content available. Use offset=${(input.offset ?? 0) + (input.limit ?? 500)} to continue reading.`
              : undefined,
          }
        } catch (error) {
          return {
            success: false,
            path: input.path,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to read tool output',
          }
        }
      },
    }),
  }
}
