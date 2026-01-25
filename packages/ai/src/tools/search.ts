import {
  TRUNCATION_LIMITS,
  generateOutputId,
  truncateArray,
} from './tool-output'
import { tool, zodSchema } from 'ai'
import { exec } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { z } from 'zod/v4'

const execAsync = promisify(exec)
const isWindows = process.platform === 'win32'

/**
 * Check if a command exists on the system
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const resolver = process.platform === 'win32' ? 'where' : 'which'
    await execAsync(`${resolver} ${cmd}`)
    return true
  } catch {
    return false
  }
}

// Cache tool availability (checked once per process)
let toolsDetected = false
let hasRg = false
let hasFd = false

async function detectTools(): Promise<void> {
  if (toolsDetected) return
  ;[hasRg, hasFd] = await Promise.all([
    commandExists('rg'),
    commandExists('fd'),
  ])
  toolsDetected = true
}

export type SearchToolsOptions = {
  /** Base path for search operations (security boundary) */
  basePath?: string
  /** Max results for search operations (default: 100) */
  maxResults?: number
  /** Directory to save large tool outputs for later retrieval */
  outputDir?: string
}

/**
 * Create search tools for the AI agent (grep, glob file search)
 */
export function createSearchTools(options: SearchToolsOptions = {}) {
  const { basePath, maxResults = 100, outputDir } = options

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

  // Allowlisted paths that are always accessible even when sandboxed
  // Include home directory so users can access their own files
  const allowedRoots = basePathResolved ? [homeDir] : []

  // Helper to resolve paths with security check
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

  // Escape special regex chars for grep (but not for rg which handles it)
  const escapeForGrep = (pattern: string): string => {
    // Basic escaping for grep -E (extended regex)
    return pattern.replace(/[[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
  }

  const grepSchema = z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z
      .string()
      .optional()
      .describe('File or directory to search (default: current directory)'),
    fileType: z
      .string()
      .optional()
      .describe('File type filter (e.g., "js", "py", "tsx")'),
    glob: z
      .string()
      .optional()
      .describe('Glob pattern filter (e.g., "*.config.ts")'),
    caseInsensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Case-insensitive search'),
    context: z
      .number()
      .optional()
      .describe('Lines of context before and after each match'),
    maxResults: z
      .number()
      .optional()
      .describe('Maximum number of results to return'),
  })

  const globFileSearchSchema = z.object({
    pattern: z
      .string()
      .describe('Glob pattern (e.g., "*.tsx", "**/test/*.spec.ts")'),
    directory: z
      .string()
      .optional()
      .describe('Directory to search in (default: current directory)'),
  })

  return {
    grep: tool({
      description:
        'Search file contents using regex patterns. Returns matching lines with file paths and line numbers. Large result sets are automatically truncated.',
      inputSchema: zodSchema(grepSchema),
      execute: async (input) => {
        await detectTools()

        try {
          const searchPath = input.path
            ? resolvePath(input.path)
            : basePath || '.'

          // Use higher internal limit to detect if truncation is needed
          const internalLimit = Math.max(
            (input.maxResults || maxResults) * 2,
            TRUNCATION_LIMITS.GREP_MATCHES * 2,
          )

          let result: {
            success: boolean
            matches: Array<{ file: string; line: number; content: string }>
            totalMatches: number
            truncated: boolean
          }

          if (hasRg) {
            result = await grepWithRipgrep(input, searchPath, internalLimit)
          } else if (isWindows) {
            result = await grepWithNode(input, searchPath, internalLimit)
          } else {
            result = await grepWithGrep(
              input,
              searchPath,
              internalLimit,
              escapeForGrep,
            )
          }

          // Apply truncation with saved output
          const truncationLimit =
            input.maxResults ||
            Math.min(maxResults, TRUNCATION_LIMITS.GREP_MATCHES)
          const outputId = generateOutputId()
          const truncated = truncateArray(result.matches, {
            maxItems: truncationLimit,
            outputDir,
            outputId,
            itemToString: (match) =>
              `${match.file}:${match.line}: ${match.content}`,
            metadata: {
              tool: 'grep',
              pattern: input.pattern,
              path: searchPath,
            },
          })

          return {
            success: result.success,
            matches: truncated.data,
            totalMatches: result.totalMatches,
            returnedMatches: truncated.returnedCount,
            truncated: truncated.truncated,
            ...(truncated.truncated && {
              truncationMessage: truncated.message,
              savedPath: truncated.savedPath,
            }),
          }
        } catch (error) {
          // Handle "no matches" case
          const execError = error as {
            code?: number
            stdout?: string
            stderr?: string
          }
          // rg returns 1, grep returns 1 when no matches
          if (execError.code === 1 && !execError.stderr) {
            return {
              success: true,
              matches: [],
              totalMatches: 0,
              returnedMatches: 0,
              truncated: false,
            }
          }

          return {
            success: false,
            error: error instanceof Error ? error.message : 'Search failed',
            matches: [],
          }
        }
      },
    }),

    globFileSearch: tool({
      description:
        'Find files matching a glob pattern. Returns matching file paths sorted by modification time (most recent first). Large result sets are automatically truncated.',
      inputSchema: zodSchema(globFileSearchSchema),
      execute: async (input) => {
        await detectTools()

        try {
          const searchDir = input.directory
            ? resolvePath(input.directory)
            : basePath || '.'

          // Use higher internal limit to detect if truncation is needed
          const internalLimit = TRUNCATION_LIMITS.GLOB_FILES * 2

          let result: { success: boolean; files: string[]; count: number }

          if (hasFd) {
            result = await findWithFd(input.pattern, searchDir, internalLimit)
          } else if (isWindows) {
            result = await findWithNode(input.pattern, searchDir, internalLimit)
          } else {
            result = await findWithFind(input.pattern, searchDir, internalLimit)
          }

          // Apply truncation with saved output
          const truncationLimit = Math.min(
            maxResults,
            TRUNCATION_LIMITS.GLOB_FILES,
          )
          const outputId = generateOutputId()
          const truncated = truncateArray(result.files, {
            maxItems: truncationLimit,
            outputDir,
            outputId,
            itemToString: (file) => file,
            metadata: {
              tool: 'globFileSearch',
              pattern: input.pattern,
              directory: searchDir,
            },
          })

          return {
            success: result.success,
            files: truncated.data,
            count: truncated.returnedCount,
            totalCount: truncated.totalCount,
            truncated: truncated.truncated,
            ...(truncated.truncated && {
              truncationMessage: truncated.message,
              savedPath: truncated.savedPath,
            }),
          }
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'File search failed',
            files: [],
          }
        }
      },
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ripgrep implementation (preferred)
// ─────────────────────────────────────────────────────────────────────────────

interface GrepInput {
  pattern: string
  caseInsensitive?: boolean
  context?: number
  fileType?: string
  glob?: string
}

async function grepWithRipgrep(
  input: GrepInput,
  searchPath: string,
  limit: number,
) {
  const args: string[] = ['--json', '--max-count', String(limit)]

  if (input.caseInsensitive) args.push('-i')
  if (input.context) args.push('-C', String(input.context))
  if (input.fileType) args.push('-t', input.fileType)
  if (input.glob) args.push('-g', input.glob)

  args.push('--', input.pattern, searchPath)

  // Properly escape arguments for shell
  const escapedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`)
  const { stdout } = await execAsync(`rg ${escapedArgs.join(' ')}`, {
    maxBuffer: 10 * 1024 * 1024,
  })

  // Parse JSON lines output
  const lines = stdout.trim().split('\n').filter(Boolean)
  const matches: Array<{ file: string; line: number; content: string }> = []

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === 'match') {
        matches.push({
          file: parsed.data.path.text,
          line: parsed.data.line_number,
          content: parsed.data.lines.text.trim(),
        })
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return {
    success: true,
    matches,
    totalMatches: matches.length,
    truncated: matches.length >= limit,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grep fallback implementation
// ─────────────────────────────────────────────────────────────────────────────

async function grepWithGrep(
  input: GrepInput,
  searchPath: string,
  limit: number,
  escapeForGrep: (s: string) => string,
) {
  const args: string[] = ['-rn', '--include="*"']

  if (input.caseInsensitive) args.push('-i')
  if (input.context) args.push(`-C${input.context}`)

  // Handle file type filter (convert to --include patterns)
  if (input.fileType) {
    const typeMap: Record<string, string> = {
      js: '*.js',
      ts: '*.ts',
      tsx: '*.tsx',
      jsx: '*.jsx',
      py: '*.py',
      rs: '*.rs',
      go: '*.go',
      java: '*.java',
      json: '*.json',
      md: '*.md',
      txt: '*.txt',
    }
    const pattern = typeMap[input.fileType] || `*.${input.fileType}`
    args.push(`--include="${pattern}"`)
  }

  if (input.glob) {
    args.push(`--include="${input.glob}"`)
  }

  // Escape pattern for grep -E
  const escapedPattern = escapeForGrep(input.pattern)
  args.push('-E', `"${escapedPattern}"`, `"${searchPath}"`)

  const { stdout } = await execAsync(
    `grep ${args.join(' ')} | head -${limit}`,
    {
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash',
    },
  )

  // Parse grep output (format: file:line:content)
  const lines = stdout.trim().split('\n').filter(Boolean)
  const matches: Array<{ file: string; line: number; content: string }> = []

  for (const line of lines) {
    // Match file:line:content or file-line-content (context lines use -)
    const match = line.match(/^(.+?):(\d+)[:-](.*)$/)
    if (match) {
      matches.push({
        file: match[1],
        line: parseInt(match[2], 10),
        content: match[3].trim(),
      })
    }
  }

  return {
    success: true,
    matches,
    totalMatches: matches.length,
    truncated: matches.length >= limit,
  }
}

// Windows-friendly fallback (no grep)
async function grepWithNode(
  input: GrepInput,
  searchPath: string,
  limit: number,
): Promise<{
  success: boolean
  matches: Array<{ file: string; line: number; content: string }>
  totalMatches: number
  truncated: boolean
}> {
  const matches: Array<{ file: string; line: number; content: string }> = []
  const regex = new RegExp(
    input.pattern,
    input.caseInsensitive ? 'i' : undefined,
  )
  const fileType = input.fileType?.toLowerCase()
  const globRegex = input.glob ? globToRegex(input.glob) : null

  const files = await walkFiles(searchPath)
  for (const file of files) {
    if (matches.length >= limit) break

    if (fileType && !file.toLowerCase().endsWith(`.${fileType}`)) {
      continue
    }

    if (globRegex) {
      const normalized = file.replace(/\\\\/g, '/')
      if (!globRegex.test(normalized)) {
        continue
      }
    }

    let contents: string
    try {
      contents = await fs.readFile(file, 'utf8')
    } catch {
      continue
    }

    const lines = contents.split(/\\r?\\n/)
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ file, line: i + 1, content: lines[i] })
        if (matches.length >= limit) break
      }
    }
  }

  return {
    success: true,
    matches,
    totalMatches: matches.length,
    truncated: matches.length >= limit,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fd implementation (preferred)
// ─────────────────────────────────────────────────────────────────────────────

async function findWithFd(
  pattern: string,
  searchDir: string,
  limit: number,
): Promise<{ success: boolean; files: string[]; count: number }> {
  const args = [
    '--type',
    'f',
    '--glob',
    pattern,
    '--max-results',
    String(limit),
    searchDir,
  ]
  const escapedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`)
  const { stdout } = await execAsync(`fd ${escapedArgs.join(' ')}`, {
    maxBuffer: 5 * 1024 * 1024,
  })

  const files = stdout.trim().split('\n').filter(Boolean)
  const sortedFiles = await sortByMtime(files)

  return {
    success: true,
    files: sortedFiles,
    count: sortedFiles.length,
  }
}

// Windows-friendly fallback (no fd/find)
async function findWithNode(
  pattern: string,
  searchDir: string,
  limit: number,
): Promise<{ success: boolean; files: string[]; count: number }> {
  const globRegex = globToRegex(pattern)
  const files = await walkFiles(searchDir)
  const matches = files.filter((file) => {
    const normalized = file.replace(/\\\\/g, '/')
    return globRegex.test(normalized)
  })

  const limited = matches.slice(0, limit)
  const sortedFiles = await sortByMtime(limited)

  return {
    success: true,
    files: sortedFiles,
    count: sortedFiles.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// find fallback implementation
// ─────────────────────────────────────────────────────────────────────────────

async function findWithFind(
  pattern: string,
  searchDir: string,
  limit: number,
): Promise<{ success: boolean; files: string[]; count: number }> {
  // find uses -name for simple patterns
  const { stdout } = await execAsync(
    `find "${searchDir}" -type f -name "${pattern}" 2>/dev/null | head -${limit}`,
    { maxBuffer: 5 * 1024 * 1024, shell: '/bin/bash' },
  )

  const files = stdout.trim().split('\n').filter(Boolean)
  const sortedFiles = await sortByMtime(files)

  return {
    success: true,
    files: sortedFiles,
    count: sortedFiles.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function sortByMtime(files: string[]): Promise<string[]> {
  const filesWithMtime = await Promise.all(
    files.map(async (file) => {
      try {
        const stats = await fs.stat(file)
        return { file, mtime: stats.mtimeMs }
      } catch {
        return { file, mtime: 0 }
      }
    }),
  )

  filesWithMtime.sort((a, b) => b.mtime - a.mtime)
  return filesWithMtime.map((f) => f.file)
}

async function walkFiles(root: string): Promise<string[]> {
  const results: string[] = []
  let entries: Array<import('fs').Dirent>

  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) {
        continue
      }
      results.push(...(await walkFiles(fullPath)))
    } else if (entry.isFile()) {
      results.push(fullPath)
    }
  }

  return results
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regex = escaped
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '.')
  return new RegExp(`^${regex}$`, 'i')
}
