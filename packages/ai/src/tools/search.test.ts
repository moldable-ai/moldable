import { createSearchTools } from './search'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Helper types and functions to handle AI SDK's strict tool types
type ToolContext = { toolCallId: string; messages: []; abortSignal: never }
const ctx: ToolContext = {
  toolCallId: 'test',
  messages: [],
  abortSignal: undefined as never,
}

type SearchTools = ReturnType<typeof createSearchTools>
type GrepResult = {
  success: boolean
  matches: Array<{ file: string; line: number; content: string }>
  totalMatches: number
  truncated: boolean
  error?: string
}
type GlobResult = {
  success: boolean
  files: string[]
  count: number
  error?: string
}

type GrepInput = { pattern: string; caseInsensitive?: boolean; path?: string }
async function execGrep(
  tools: SearchTools,
  input: GrepInput,
): Promise<GrepResult> {
  return (await tools.grep.execute!(
    { caseInsensitive: false, ...input },
    ctx,
  )) as GrepResult
}

type GlobInput = { pattern: string; directory?: string }
async function execGlobSearch(
  tools: SearchTools,
  input: GlobInput,
): Promise<GlobResult> {
  return (await tools.globFileSearch.execute!(input, ctx)) as GlobResult
}

describe('createSearchTools', () => {
  let tempDir: string
  let tools: SearchTools

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moldable-search-test-'))
    tools = createSearchTools({ basePath: tempDir, maxResults: 50 })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('grep', () => {
    beforeEach(async () => {
      // Create test files
      await fs.writeFile(
        path.join(tempDir, 'file1.txt'),
        'Hello World\nfoo bar baz\nHello Again',
      )
      await fs.writeFile(
        path.join(tempDir, 'file2.txt'),
        'Different content\nNo matches here',
      )
      await fs.mkdir(path.join(tempDir, 'subdir'))
      await fs.writeFile(
        path.join(tempDir, 'subdir', 'nested.txt'),
        'Hello from nested file',
      )
    })

    it('finds matches across files', async () => {
      const result = await execGrep(tools, { pattern: 'Hello' })

      expect(result.success).toBe(true)
      expect(result.matches.length).toBeGreaterThanOrEqual(3) // file1 has 2, nested has 1
    })

    it('returns empty array when no matches', async () => {
      const result = await execGrep(tools, { pattern: 'ZZZZNOTFOUND' })

      expect(result.success).toBe(true)
      expect(result.matches).toHaveLength(0)
      expect(result.totalMatches).toBe(0)
    })

    it('supports case-insensitive search', async () => {
      const result = await execGrep(tools, {
        pattern: 'hello',
        caseInsensitive: true,
      })

      expect(result.success).toBe(true)
      expect(result.matches.length).toBeGreaterThanOrEqual(3)
    })

    it('searches specific path', async () => {
      const result = await execGrep(tools, { pattern: 'Hello', path: 'subdir' })

      expect(result.success).toBe(true)
      // Should only find the one in nested.txt
      expect(result.matches.length).toBe(1)
      expect(result.matches[0].file).toContain('nested.txt')
    })

    it('respects maxResults limit', async () => {
      // Create many matches
      let content = ''
      for (let i = 0; i < 100; i++) {
        content += `Match line ${i}\n`
      }
      await fs.writeFile(path.join(tempDir, 'many.txt'), content)

      const limitedTools = createSearchTools({
        basePath: tempDir,
        maxResults: 10,
      })
      const result = await execGrep(limitedTools, { pattern: 'Match' })

      expect(result.success).toBe(true)
      expect(result.matches.length).toBeLessThanOrEqual(10)
      expect(result.truncated).toBe(true)
    })
  })

  describe('globFileSearch', () => {
    beforeEach(async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'file.ts'), '')
      await fs.writeFile(path.join(tempDir, 'file.tsx'), '')
      await fs.writeFile(path.join(tempDir, 'file.js'), '')
      await fs.mkdir(path.join(tempDir, 'src'))
      await fs.writeFile(path.join(tempDir, 'src', 'component.tsx'), '')
      await fs.writeFile(path.join(tempDir, 'src', 'util.ts'), '')
    })

    it('finds files by glob pattern', async () => {
      const result = await execGlobSearch(tools, { pattern: '*.tsx' })

      expect(result.success).toBe(true)
      expect(result.files.length).toBe(2) // file.tsx and src/component.tsx
    })

    it('finds files in specific directory', async () => {
      const result = await execGlobSearch(tools, {
        pattern: '*.ts',
        directory: 'src',
      })

      expect(result.success).toBe(true)
      expect(result.files.length).toBe(1) // Only src/util.ts
    })

    it('returns empty array when no matches', async () => {
      const result = await execGlobSearch(tools, { pattern: '*.xyz' })

      expect(result.success).toBe(true)
      expect(result.files).toHaveLength(0)
    })

    it('returns files sorted by modification time', async () => {
      // Create files with slight delay to ensure different mtimes
      const file1 = path.join(tempDir, 'mtime1.txt')
      const file2 = path.join(tempDir, 'mtime2.txt')

      await fs.writeFile(file1, 'first')
      await new Promise((r) => setTimeout(r, 100))
      await fs.writeFile(file2, 'second')

      const result = await execGlobSearch(tools, { pattern: 'mtime*.txt' })

      expect(result.success).toBe(true)
      // Most recent should be first
      expect(result.files[0]).toContain('mtime2.txt')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Security Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('security: path traversal prevention', () => {
    it('BLOCKS grep searching outside basePath', async () => {
      const result = await execGrep(tools, { pattern: 'root', path: '/etc' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('traversal')
    })

    it('BLOCKS glob search with path traversal', async () => {
      const result = await execGlobSearch(tools, {
        pattern: '*.txt',
        directory: '../../../etc',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('traversal')
    })
  })
})
