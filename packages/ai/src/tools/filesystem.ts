import { tool, zodSchema } from 'ai'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { z } from 'zod/v4'

/**
 * Create filesystem tools for the AI agent
 */
export function createFilesystemTools(options: { basePath?: string } = {}) {
  const { basePath } = options

  const basePathResolved = basePath ? path.resolve(basePath) : undefined
  const homeDir = os.homedir()

  const expandTilde = (p: string) => {
    if (p === '~') return homeDir
    if (p.startsWith('~/') || p.startsWith('~\\')) {
      return path.join(homeDir, p.slice(2))
    }
    return p
  }

  const isWithin = (parentDir: string, childPath: string) => {
    const rel = path.relative(parentDir, childPath)
    return (
      rel === '' ||
      (!rel.startsWith(`..${path.sep}`) &&
        rel !== '..' &&
        !path.isAbsolute(rel))
    )
  }

  // Allowlisted paths that are always accessible (read + write) even when sandboxed
  // Include home directory so users can access their own files
  const allowedRoots = basePathResolved ? [homeDir] : []

  /**
   * Resolve a path with sandboxing:
   * - If no basePath is provided: resolve normally.
   * - If basePath is provided: path must be within basePath OR in allowlisted locations
   */
  const resolvePath = (filePath: string): string => {
    const expanded = expandTilde(filePath)
    const resolved = basePathResolved
      ? path.resolve(basePathResolved, expanded)
      : path.resolve(expanded)

    if (!basePathResolved) return resolved
    if (isWithin(basePathResolved, resolved)) return resolved
    if (allowedRoots.some((root) => isWithin(root, resolved))) return resolved

    throw new Error('Path traversal not allowed')
  }

  const readFileSchema = z.object({
    path: z
      .string()
      .describe('The path to the file to read (absolute or relative)'),
    offset: z
      .number()
      .optional()
      .describe('Line number to start reading from (1-indexed)'),
    limit: z.number().optional().describe('Maximum number of lines to read'),
  })

  const writeFileSchema = z.object({
    path: z
      .string()
      .describe('The path to the file to write (absolute or relative)'),
    content: z.string().describe('The content to write to the file'),
  })

  const editFileSchema = z.object({
    path: z
      .string()
      .describe('The path to the file to edit (absolute or relative)'),
    oldString: z.string().describe('The exact text to find and replace'),
    newString: z.string().describe('The replacement text'),
    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe('Replace all occurrences (default: false)'),
  })

  const deleteFileSchema = z.object({
    path: z
      .string()
      .describe('The path to the file to delete (absolute or relative)'),
  })

  const listDirectorySchema = z.object({
    path: z
      .string()
      .default('.')
      .describe(
        'The path to the directory to list (absolute or relative). Defaults to current directory if empty.',
      ),
  })

  const fileExistsSchema = z.object({
    path: z.string().describe('The path to check (absolute or relative)'),
  })

  return {
    readFile: tool({
      description:
        'Read the contents of a file at the specified path. Returns the file content as text. Supports optional line offset and limit.',
      inputSchema: zodSchema(readFileSchema),
      execute: async (input) => {
        try {
          const resolvedPath = resolvePath(input.path)
          let content = await fs.readFile(resolvedPath, 'utf-8')

          // Apply offset and limit if specified
          if (input.offset !== undefined || input.limit !== undefined) {
            const lines = content.split('\n')
            const startLine = (input.offset ?? 1) - 1 // Convert to 0-indexed
            const endLine = input.limit ? startLine + input.limit : lines.length

            content = lines
              .slice(Math.max(0, startLine), endLine)
              .map((line, idx) => `${startLine + idx + 1}|${line}`)
              .join('\n')
          }

          return {
            success: true,
            path: resolvedPath,
            content,
            size: content.length,
          }
        } catch (error) {
          return {
            success: false,
            path: input.path,
            error:
              error instanceof Error ? error.message : 'Failed to read file',
          }
        }
      },
    }),

    writeFile: tool({
      description:
        'Write content to a file at the specified path. Creates the file if it does not exist, or overwrites it if it does.',
      inputSchema: zodSchema(writeFileSchema),
      execute: async (input) => {
        try {
          const resolvedPath = resolvePath(input.path)
          // Ensure directory exists
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
          await fs.writeFile(resolvedPath, input.content, 'utf-8')

          // Return a preview of the content (first 20 lines, max 1000 chars)
          const lines = input.content.split('\n')
          const previewLines = lines.slice(0, 20)
          let preview = previewLines.join('\n')
          if (preview.length > 1000) {
            preview = preview.slice(0, 1000) + '...'
          }
          const truncated = lines.length > 20 || input.content.length > 1000

          return {
            success: true,
            path: resolvedPath,
            bytesWritten: Buffer.byteLength(input.content, 'utf-8'),
            lineCount: lines.length,
            preview,
            truncated,
          }
        } catch (error) {
          return {
            success: false,
            path: input.path,
            error:
              error instanceof Error ? error.message : 'Failed to write file',
          }
        }
      },
    }),

    editFile: tool({
      description:
        'Perform surgical string replacement in a file. The oldString must be unique unless replaceAll is true.',
      inputSchema: zodSchema(editFileSchema),
      execute: async (input) => {
        try {
          const resolvedPath = resolvePath(input.path)
          const content = await fs.readFile(resolvedPath, 'utf-8')

          // Check if oldString exists
          if (!content.includes(input.oldString)) {
            return {
              success: false,
              path: resolvedPath,
              error: 'oldString not found in file',
            }
          }

          // Check for uniqueness if not replaceAll
          if (!input.replaceAll) {
            const occurrences = content.split(input.oldString).length - 1
            if (occurrences > 1) {
              return {
                success: false,
                path: resolvedPath,
                error: `oldString found ${occurrences} times - must be unique or use replaceAll`,
              }
            }
          }

          // Perform replacement
          const newContent = input.replaceAll
            ? content.replaceAll(input.oldString, input.newString)
            : content.replace(input.oldString, input.newString)

          await fs.writeFile(resolvedPath, newContent, 'utf-8')

          return {
            success: true,
            path: resolvedPath,
            replacements: input.replaceAll
              ? content.split(input.oldString).length - 1
              : 1,
          }
        } catch (error) {
          return {
            success: false,
            path: input.path,
            error:
              error instanceof Error ? error.message : 'Failed to edit file',
          }
        }
      },
    }),

    deleteFile: tool({
      description: 'Delete a file at the specified path.',
      inputSchema: zodSchema(deleteFileSchema),
      execute: async (input) => {
        try {
          const resolvedPath = resolvePath(input.path)
          await fs.unlink(resolvedPath)
          return {
            success: true,
            path: resolvedPath,
          }
        } catch (error) {
          return {
            success: false,
            path: input.path,
            error:
              error instanceof Error ? error.message : 'Failed to delete file',
          }
        }
      },
    }),

    listDirectory: tool({
      description:
        'List the contents of a directory. Returns file and directory names with their types.',
      inputSchema: zodSchema(listDirectorySchema),
      execute: async (input) => {
        try {
          const resolvedPath = resolvePath(input.path)
          const entries = await fs.readdir(resolvedPath, {
            withFileTypes: true,
          })
          // Filter out hidden files (starting with .)
          const visibleEntries = entries.filter(
            (entry) => !entry.name.startsWith('.'),
          )
          const items = visibleEntries
            .map((entry) => ({
              name: entry.name,
              type: entry.isDirectory()
                ? 'directory'
                : entry.isFile()
                  ? 'file'
                  : entry.isSymbolicLink()
                    ? 'symlink'
                    : 'other',
            }))
            .sort((a, b) => {
              // Directories first, then files
              if (a.type === 'directory' && b.type !== 'directory') return -1
              if (a.type !== 'directory' && b.type === 'directory') return 1
              return a.name.localeCompare(b.name)
            })
          return {
            success: true,
            path: resolvedPath,
            items,
            count: items.length,
          }
        } catch (error) {
          return {
            success: false,
            path: input.path,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to list directory',
          }
        }
      },
    }),

    fileExists: tool({
      description: 'Check if a file or directory exists at the specified path.',
      inputSchema: zodSchema(fileExistsSchema),
      execute: async (input) => {
        try {
          const resolvedPath = resolvePath(input.path)
          const stats = await fs.stat(resolvedPath)
          return {
            exists: true,
            path: resolvedPath,
            isDirectory: stats.isDirectory(),
            type: stats.isDirectory()
              ? 'directory'
              : stats.isFile()
                ? 'file'
                : 'other',
            size: stats.size,
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {
              exists: false,
              path: input.path,
            }
          }
          return {
            exists: false,
            path: input.path,
            error:
              error instanceof Error ? error.message : 'Failed to check path',
          }
        }
      },
    }),
  }
}
