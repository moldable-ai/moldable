/**
 * @moldable-ai/storage - Filesystem-first storage utilities for Moldable applications
 *
 * This package provides helpers for apps to persist data to the filesystem,
 * following Moldable's local-first philosophy.
 */
import { homedir } from 'os'
import path from 'path'

/**
 * Get the Moldable home directory.
 *
 * - If MOLDABLE_HOME env var is set, uses that
 * - Otherwise defaults to ~/.moldable
 */
export function getMoldableHome(): string {
  return process.env.MOLDABLE_HOME ?? path.join(homedir(), '.moldable')
}

/**
 * Get the active workspace ID.
 *
 * @param override - Optional workspace ID override (from request header)
 * @returns The workspace ID from override, MOLDABLE_WORKSPACE_ID env var, or 'personal' as default
 */
export function getWorkspaceId(override?: string): string {
  return override ?? process.env.MOLDABLE_WORKSPACE_ID ?? 'personal'
}

/**
 * Get the app's data directory.
 *
 * Resolution order:
 * 1. If workspaceId override provided, use ${MOLDABLE_HOME}/workspaces/${workspaceId}/apps/${appId}/data
 * 2. MOLDABLE_APP_DATA_DIR env var (set by Moldable desktop at startup)
 * 3. ${MOLDABLE_HOME}/workspaces/${MOLDABLE_WORKSPACE_ID}/apps/${MOLDABLE_APP_ID}/data
 * 4. ./data (dev fallback - logs a warning)
 *
 * @param workspaceId - Optional workspace ID override (from request header)
 * @returns Absolute path to the app's data directory
 */
export function getAppDataDir(workspaceId?: string): string {
  const appId = process.env.MOLDABLE_APP_ID

  // Option 1: Workspace override provided (runtime workspace switching)
  if (workspaceId && appId) {
    const home = getMoldableHome()
    return path.join(home, 'workspaces', workspaceId, 'apps', appId, 'data')
  }

  // Option 2: Explicit data dir from env (set at process start)
  if (process.env.MOLDABLE_APP_DATA_DIR) {
    return process.env.MOLDABLE_APP_DATA_DIR
  }

  // Option 3: Derive from MOLDABLE_HOME + workspace + app ID
  if (appId) {
    const home = getMoldableHome()
    const workspace = getWorkspaceId()
    return path.join(home, 'workspaces', workspace, 'apps', appId, 'data')
  }

  // Option 4: Dev fallback
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      '[@moldable-ai/storage] MOLDABLE_APP_DATA_DIR not set, using ./data (dev fallback)',
    )
  }
  return path.join(process.cwd(), 'data')
}

/**
 * Header name used to pass workspace ID from client to server.
 */
export const WORKSPACE_HEADER = 'x-moldable-workspace'

/**
 * Extract workspace ID from a Request object's headers.
 *
 * @param request - The incoming request (Next.js Request or standard Request)
 * @returns The workspace ID from the header, or undefined if not present
 *
 * @example
 * ```ts
 * // In a Next.js API route:
 * export async function GET(request: Request) {
 *   const workspaceId = getWorkspaceFromRequest(request)
 *   const dataDir = getAppDataDir(workspaceId)
 *   // ... use dataDir
 * }
 * ```
 */
export function getWorkspaceFromRequest(request: Request): string | undefined {
  return request.headers.get(WORKSPACE_HEADER) ?? undefined
}

/**
 * Get the app ID from environment.
 *
 * @returns The app ID, or undefined if not running in Moldable
 */
export function getAppId(): string | undefined {
  return process.env.MOLDABLE_APP_ID
}

/**
 * Check if running inside Moldable (vs standalone dev mode).
 */
export function isRunningInMoldable(): boolean {
  return Boolean(process.env.MOLDABLE_APP_ID)
}

/**
 * Error thrown when path traversal is detected.
 */
export class PathTraversalError extends Error {
  constructor(segment: string) {
    super(`Path traversal detected: "${segment}" is not allowed`)
    this.name = 'PathTraversalError'
  }
}

/**
 * Validate a path segment to prevent directory traversal.
 * Rejects segments containing '..', starting with '/', or containing backslashes.
 *
 * @throws PathTraversalError if the segment is invalid
 */
function validatePathSegment(segment: string): void {
  // Reject parent directory references
  if (segment === '..' || segment.includes('..')) {
    throw new PathTraversalError(segment)
  }

  // Reject absolute paths
  if (segment.startsWith('/')) {
    throw new PathTraversalError(segment)
  }

  // Reject backslashes (Windows path separator, could be used for traversal)
  if (segment.includes('\\')) {
    throw new PathTraversalError(segment)
  }

  // Reject null bytes
  if (segment.includes('\0')) {
    throw new PathTraversalError(segment)
  }
}

/**
 * Safely join path segments, preventing directory traversal attacks.
 *
 * @param base - The base directory (must be absolute)
 * @param segments - Path segments to join (validated for safety)
 * @returns The joined path
 * @throws PathTraversalError if any segment attempts directory traversal
 *
 * @example
 * ```ts
 * const dataDir = getAppDataDir()
 *
 * // OK
 * safePath(dataDir, 'entries', 'abc123.json')
 *
 * // Throws PathTraversalError
 * safePath(dataDir, '../../../etc/passwd')
 * ```
 */
export function safePath(base: string, ...segments: string[]): string {
  // Validate each segment
  for (const segment of segments) {
    validatePathSegment(segment)
  }

  // Join the paths
  const result = path.join(base, ...segments)

  // Final check: ensure result is still within base
  const normalizedBase = path.normalize(base)
  const normalizedResult = path.normalize(result)

  if (!normalizedResult.startsWith(normalizedBase)) {
    throw new PathTraversalError(segments.join('/'))
  }

  return result
}

/**
 * Valid characters for sanitized IDs: alphanumeric, dash, underscore
 */
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/

/**
 * Sanitize an ID for use in filenames.
 *
 * - Validates the ID contains only safe characters (alphanumeric, dash, underscore)
 * - Returns the ID unchanged if valid
 * - Throws if the ID contains unsafe characters
 *
 * @param id - The ID to sanitize
 * @returns The sanitized ID (unchanged if valid)
 * @throws Error if the ID contains invalid characters
 *
 * @example
 * ```ts
 * sanitizeId('meeting-123')  // OK: 'meeting-123'
 * sanitizeId('note_v2')      // OK: 'note_v2'
 * sanitizeId('../etc')       // Throws
 * sanitizeId('file.json')    // Throws (no dots allowed)
 * ```
 */
export function sanitizeId(id: string): string {
  if (!id || id.length === 0) {
    throw new Error('ID cannot be empty')
  }

  if (id.length > 255) {
    throw new Error('ID too long (max 255 characters)')
  }

  if (!VALID_ID_REGEX.test(id)) {
    throw new Error(
      `Invalid ID "${id}": must contain only alphanumeric characters, dashes, and underscores`,
    )
  }

  return id
}

/**
 * Generate a simple unique ID for use in filenames.
 * Uses timestamp + random suffix for uniqueness.
 *
 * @returns A unique ID string (alphanumeric with dashes)
 *
 * @example
 * ```ts
 * const id = generateId()  // e.g., '1704067200000-x7k9m2'
 * ```
 */
export function generateId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}`
}

/**
 * Ensure a directory exists, creating it if necessary.
 * This is a convenience wrapper around fs.mkdir with recursive option.
 *
 * @param dir - The directory path to ensure exists
 */
export async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import('fs/promises')
  await mkdir(dir, { recursive: true })
}

/**
 * Read JSON from a file, returning a default value if the file doesn't exist.
 *
 * @param filePath - Path to the JSON file
 * @param defaultValue - Value to return if file doesn't exist
 * @returns The parsed JSON, or defaultValue if file doesn't exist
 */
export async function readJson<T>(
  filePath: string,
  defaultValue: T,
): Promise<T> {
  const { readFile } = await import('fs/promises')

  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return defaultValue
    }
    throw error
  }
}

/**
 * Write JSON to a file, creating parent directories if needed.
 *
 * @param filePath - Path to the JSON file
 * @param data - Data to write
 * @param pretty - Whether to pretty-print (default: true)
 */
export async function writeJson<T>(
  filePath: string,
  data: T,
  pretty = true,
): Promise<void> {
  const { writeFile } = await import('fs/promises')
  const dir = path.dirname(filePath)

  await ensureDir(dir)

  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  await writeFile(filePath, content, 'utf-8')
}
