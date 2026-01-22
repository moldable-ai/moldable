import {
  TRUNCATION_LIMITS,
  createToolOutputTools,
  generateOutputId,
  readSavedToolOutput,
  saveToolOutput,
  truncateArray,
  truncateString,
} from './tool-output'
import { existsSync, promises as fs, readFileSync, writeFileSync } from 'fs'
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

describe('tool-output utilities', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-output-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('generateOutputId', () => {
    it('generates unique IDs', () => {
      const id1 = generateOutputId()
      const id2 = generateOutputId()

      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^tool_[a-z0-9]+$/)
      expect(id2).toMatch(/^tool_[a-z0-9]+$/)
    })
  })

  describe('saveToolOutput', () => {
    it('saves content to file', () => {
      const outputId = 'test_output'
      const content = 'Hello, World!'

      const savedPath = saveToolOutput(tempDir, outputId, content)

      expect(savedPath).toBe(path.join(tempDir, 'test_output.txt'))
      const saved = readFileSync(savedPath, 'utf-8')
      expect(saved).toBe(content)
    })

    it('creates directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'dir')
      const outputId = 'nested_output'
      const content = 'Nested content'

      const savedPath = saveToolOutput(nestedDir, outputId, content)

      expect(existsSync(savedPath)).toBe(true)
    })

    it('includes metadata as YAML front matter', () => {
      const outputId = 'with_metadata'
      const content = 'Content here'
      const metadata = { tool: 'grep', pattern: 'test' }

      const savedPath = saveToolOutput(tempDir, outputId, content, metadata)

      const saved = readFileSync(savedPath, 'utf-8')
      expect(saved).toContain('---')
      expect(saved).toContain('tool: "grep"')
      expect(saved).toContain('pattern: "test"')
      expect(saved).toContain('Content here')
    })
  })

  describe('readSavedToolOutput', () => {
    it('reads entire file', () => {
      const content = 'Line 1\nLine 2\nLine 3'
      const filePath = path.join(tempDir, 'read_test.txt')
      writeFileSync(filePath, content)

      const result = readSavedToolOutput(filePath)

      expect(result.content).toBe(content)
      expect(result.totalLines).toBe(3)
      expect(result.hasMore).toBe(false)
    })

    it('reads with offset', () => {
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      const filePath = path.join(tempDir, 'offset_test.txt')
      writeFileSync(filePath, content)

      const result = readSavedToolOutput(filePath, { offset: 2 })

      expect(result.content).toBe('Line 3\nLine 4\nLine 5')
      expect(result.totalLines).toBe(5)
      expect(result.hasMore).toBe(false)
    })

    it('reads with limit', () => {
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      const filePath = path.join(tempDir, 'limit_test.txt')
      writeFileSync(filePath, content)

      const result = readSavedToolOutput(filePath, { limit: 2 })

      expect(result.content).toBe('Line 1\nLine 2')
      expect(result.totalLines).toBe(5)
      expect(result.hasMore).toBe(true)
    })

    it('reads with offset and limit', () => {
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      const filePath = path.join(tempDir, 'offset_limit_test.txt')
      writeFileSync(filePath, content)

      const result = readSavedToolOutput(filePath, { offset: 1, limit: 2 })

      expect(result.content).toBe('Line 2\nLine 3')
      expect(result.totalLines).toBe(5)
      expect(result.hasMore).toBe(true)
    })

    it('throws for non-existent file', () => {
      expect(() =>
        readSavedToolOutput(path.join(tempDir, 'nonexistent.txt')),
      ).toThrow('Tool output file not found')
    })
  })

  describe('truncateString', () => {
    it('returns unchanged data if under limit', () => {
      const content = 'Short content'
      const result = truncateString(content, { maxChars: 1000, maxLines: 100 })

      expect(result.truncated).toBe(false)
      expect(result.data).toBe(content)
      expect(result.totalCount).toBe(1)
      expect(result.returnedCount).toBe(1)
    })

    it('truncates by character limit', () => {
      const content = 'A'.repeat(100)
      const result = truncateString(content, { maxChars: 50, maxLines: 1000 })

      expect(result.truncated).toBe(true)
      expect(result.data.length).toBe(50)
      expect(result.message).toContain('truncated')
    })

    it('truncates by line limit', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      const content = lines.join('\n')
      const result = truncateString(content, { maxChars: 100000, maxLines: 10 })

      expect(result.truncated).toBe(true)
      expect(result.returnedCount).toBe(10)
      expect(result.totalCount).toBe(100)
    })

    it('saves to file when outputDir provided', () => {
      const content = 'A'.repeat(100)
      const outputId = 'truncated_output'

      const result = truncateString(content, {
        maxChars: 50,
        maxLines: 1000,
        outputDir: tempDir,
        outputId,
      })

      expect(result.truncated).toBe(true)
      expect(result.savedPath).toBe(path.join(tempDir, `${outputId}.txt`))
      expect(existsSync(result.savedPath!)).toBe(true)
    })

    it('includes metadata in saved file', () => {
      const content = 'A'.repeat(100)
      const outputId = 'metadata_output'

      const result = truncateString(content, {
        maxChars: 50,
        maxLines: 1000,
        outputDir: tempDir,
        outputId,
        metadata: { tool: 'readFile', path: '/some/path' },
      })

      const saved = readFileSync(result.savedPath!, 'utf-8')
      expect(saved).toContain('tool: "readFile"')
    })
  })

  describe('truncateArray', () => {
    it('returns unchanged data if under limit', () => {
      const items = [1, 2, 3, 4, 5]
      const result = truncateArray(items, { maxItems: 10 })

      expect(result.truncated).toBe(false)
      expect(result.data).toEqual(items)
      expect(result.totalCount).toBe(5)
      expect(result.returnedCount).toBe(5)
    })

    it('truncates to maxItems', () => {
      const items = Array.from({ length: 100 }, (_, i) => i)
      const result = truncateArray(items, { maxItems: 10 })

      expect(result.truncated).toBe(true)
      expect(result.data).toHaveLength(10)
      expect(result.totalCount).toBe(100)
      expect(result.returnedCount).toBe(10)
    })

    it('saves to file when outputDir provided', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      const outputId = 'array_output'

      const result = truncateArray(items, {
        maxItems: 10,
        outputDir: tempDir,
        outputId,
        itemToString: (item) => JSON.stringify(item),
      })

      expect(result.truncated).toBe(true)
      expect(result.savedPath).toBe(path.join(tempDir, `${outputId}.txt`))

      const saved = readFileSync(result.savedPath!, 'utf-8')
      expect(saved).toContain('"id":0')
      expect(saved).toContain('"id":99')
    })

    it('uses custom itemToString function', () => {
      const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
      const outputId = 'custom_string'

      truncateArray(items, {
        maxItems: 1,
        outputDir: tempDir,
        outputId,
        itemToString: (item) => `Name: ${item.name}`,
      })

      const saved = readFileSync(path.join(tempDir, `${outputId}.txt`), 'utf-8')
      expect(saved).toContain('Name: a')
      expect(saved).toContain('Name: b')
      expect(saved).toContain('Name: c')
    })
  })

  describe('TRUNCATION_LIMITS', () => {
    it('has reasonable default limits', () => {
      expect(TRUNCATION_LIMITS.FILE_CONTENT_CHARS).toBeGreaterThan(10000)
      expect(TRUNCATION_LIMITS.FILE_CONTENT_LINES).toBeGreaterThan(100)
      expect(TRUNCATION_LIMITS.GREP_MATCHES).toBeGreaterThan(50)
      expect(TRUNCATION_LIMITS.GLOB_FILES).toBeGreaterThan(100)
      expect(TRUNCATION_LIMITS.DIRECTORY_ITEMS).toBeGreaterThan(100)
      expect(TRUNCATION_LIMITS.COMMAND_STDOUT_CHARS).toBeGreaterThan(10000)
      expect(TRUNCATION_LIMITS.COMMAND_STDERR_CHARS).toBeGreaterThan(5000)
    })
  })
})

describe('createToolOutputTools', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-output-tool-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('readToolOutput', () => {
    it('reads saved tool output', async () => {
      // Create a saved output file
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      const filePath = path.join(tempDir, 'saved_output.txt')
      writeFileSync(filePath, content)

      const tools = createToolOutputTools({ outputDir: tempDir })
      const result = (await tools.readToolOutput.execute!(
        { path: filePath, limit: 3 },
        ctx,
      )) as {
        success: boolean
        content: string
        totalLines: number
        hasMore: boolean
      }

      expect(result.success).toBe(true)
      expect(result.content).toBe('Line 1\nLine 2\nLine 3')
      expect(result.totalLines).toBe(5)
      expect(result.hasMore).toBe(true)
    })

    it('reads with offset and limit', async () => {
      const content = Array.from(
        { length: 20 },
        (_, i) => `Line ${i + 1}`,
      ).join('\n')
      const filePath = path.join(tempDir, 'paged_output.txt')
      writeFileSync(filePath, content)

      const tools = createToolOutputTools({ outputDir: tempDir })
      const result = (await tools.readToolOutput.execute!(
        { path: filePath, offset: 5, limit: 5 },
        ctx,
      )) as {
        success: boolean
        content: string
        startLine: number
        linesReturned: number
        hasMore: boolean
      }

      expect(result.success).toBe(true)
      expect(result.startLine).toBe(5)
      expect(result.linesReturned).toBe(5)
      expect(result.hasMore).toBe(true)
      expect(result.content).toContain('Line 6')
      expect(result.content).toContain('Line 10')
    })

    it('resolves relative paths against outputDir', async () => {
      const content = 'Test content'
      const filePath = path.join(tempDir, 'relative.txt')
      writeFileSync(filePath, content)

      const tools = createToolOutputTools({ outputDir: tempDir })
      const result = (await tools.readToolOutput.execute!(
        { path: 'relative.txt' },
        ctx,
      )) as { success: boolean; content: string }

      expect(result.success).toBe(true)
      expect(result.content).toBe(content)
    })

    it('returns error for non-existent file', async () => {
      const tools = createToolOutputTools({ outputDir: tempDir })
      const result = (await tools.readToolOutput.execute!(
        { path: 'nonexistent.txt' },
        ctx,
      )) as { success: boolean; error: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('includes hint when more content available', async () => {
      const content = Array.from(
        { length: 100 },
        (_, i) => `Line ${i + 1}`,
      ).join('\n')
      const filePath = path.join(tempDir, 'hint_output.txt')
      writeFileSync(filePath, content)

      const tools = createToolOutputTools({ outputDir: tempDir })
      const result = (await tools.readToolOutput.execute!(
        { path: filePath, offset: 0, limit: 10 },
        ctx,
      )) as { success: boolean; hasMore: boolean; hint: string }

      expect(result.success).toBe(true)
      expect(result.hasMore).toBe(true)
      expect(result.hint).toContain('offset=10')
    })
  })
})
