import { createFilesystemTools } from './filesystem'
import { TRUNCATION_LIMITS } from './tool-output'
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

type FsTools = ReturnType<typeof createFilesystemTools>

async function execReadFile(
  tools: FsTools,
  input: { path: string; offset?: number; limit?: number },
) {
  return (await tools.readFile.execute!(input, ctx)) as {
    success: boolean
    content?: string
    totalLines?: number
    truncated?: boolean
    linesReturned?: number
    truncationMessage?: string
    savedPath?: string
    error?: string
  }
}

async function execWriteFile(
  tools: FsTools,
  input: { path: string; content: string },
) {
  return (await tools.writeFile.execute!(input, ctx)) as {
    success: boolean
    error?: string
  }
}

async function execEditFile(
  tools: FsTools,
  input: {
    path: string
    oldString: string
    newString: string
    replaceAll?: boolean
  },
) {
  return (await tools.editFile.execute!(
    { ...input, replaceAll: input.replaceAll ?? false },
    ctx,
  )) as { success: boolean; replacements?: number; error?: string }
}

async function execDeleteFile(tools: FsTools, input: { path: string }) {
  return (await tools.deleteFile.execute!(input, ctx)) as {
    success: boolean
    error?: string
  }
}

async function execListDir(tools: FsTools, input: { path: string }) {
  return (await tools.listDirectory.execute!(input, ctx)) as {
    success: boolean
    items?: Array<{ name: string; type: string }>
    count?: number
    totalCount?: number
    truncated?: boolean
    truncationMessage?: string
    savedPath?: string
    error?: string
  }
}

async function execFileExists(tools: FsTools, input: { path: string }) {
  return (await tools.fileExists.execute!(input, ctx)) as {
    exists: boolean
    type?: string
    isDirectory?: boolean
    error?: string
  }
}

describe('createFilesystemTools', () => {
  let tempDir: string
  let tools: FsTools

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moldable-test-'))
    tools = createFilesystemTools({ basePath: tempDir })
  })

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('readFile', () => {
    it('reads a file successfully', async () => {
      const testContent = 'Hello, World!\nLine 2\nLine 3'
      await fs.writeFile(path.join(tempDir, 'test.txt'), testContent)

      const result = await execReadFile(tools, { path: 'test.txt' })

      expect(result.success).toBe(true)
      expect(result.content).toBe(testContent)
    })

    it('reads a file with offset and limit', async () => {
      const testContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      await fs.writeFile(path.join(tempDir, 'test.txt'), testContent)

      const result = await execReadFile(tools, {
        path: 'test.txt',
        offset: 2,
        limit: 2,
      })

      expect(result.success).toBe(true)
      expect(result.content).toContain('2|Line 2')
      expect(result.content).toContain('3|Line 3')
      expect(result.content).not.toContain('Line 1')
      expect(result.content).not.toContain('Line 4')
    })

    it('returns error for non-existent file', async () => {
      const result = await execReadFile(tools, { path: 'nonexistent.txt' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('ENOENT')
    })

    it('truncates large files automatically', async () => {
      // Create a file that exceeds the line limit
      const lines = Array.from(
        { length: TRUNCATION_LIMITS.FILE_CONTENT_LINES + 100 },
        (_, i) => `Line ${i + 1}`,
      )
      const largeContent = lines.join('\n')
      await fs.writeFile(path.join(tempDir, 'large.txt'), largeContent)

      const result = await execReadFile(tools, { path: 'large.txt' })

      expect(result.success).toBe(true)
      expect(result.truncated).toBe(true)
      expect(result.linesReturned).toBeLessThanOrEqual(
        TRUNCATION_LIMITS.FILE_CONTENT_LINES,
      )
      expect(result.totalLines).toBe(lines.length)
      expect(result.truncationMessage).toContain('truncated')
    })

    it('does not truncate when user specifies offset/limit', async () => {
      // Create a large file
      const lines = Array.from(
        { length: TRUNCATION_LIMITS.FILE_CONTENT_LINES + 100 },
        (_, i) => `Line ${i + 1}`,
      )
      await fs.writeFile(path.join(tempDir, 'large2.txt'), lines.join('\n'))

      // Request specific range - should not auto-truncate
      const result = await execReadFile(tools, {
        path: 'large2.txt',
        offset: 1,
        limit: 10,
      })

      expect(result.success).toBe(true)
      expect(result.truncated).toBeUndefined() // No auto-truncation
    })

    it('saves full output to file when truncated and outputDir provided', async () => {
      const outputDir = path.join(tempDir, 'tool-output')
      const toolsWithOutput = createFilesystemTools({
        basePath: tempDir,
        outputDir,
      })

      // Create large file
      const lines = Array.from(
        { length: TRUNCATION_LIMITS.FILE_CONTENT_LINES + 100 },
        (_, i) => `Line ${i + 1}`,
      )
      await fs.writeFile(path.join(tempDir, 'large3.txt'), lines.join('\n'))

      const result = await execReadFile(toolsWithOutput, { path: 'large3.txt' })

      expect(result.success).toBe(true)
      expect(result.truncated).toBe(true)
      expect(result.savedPath).toBeDefined()
      expect(result.savedPath).toContain(outputDir)

      // Verify saved file exists and contains full content
      const savedContent = await fs.readFile(result.savedPath!, 'utf-8')
      expect(savedContent).toContain(`Line ${lines.length}`)
    })
  })

  describe('writeFile', () => {
    it('writes a new file', async () => {
      const result = await execWriteFile(tools, {
        path: 'new-file.txt',
        content: 'New content',
      })

      expect(result.success).toBe(true)
      const content = await fs.readFile(
        path.join(tempDir, 'new-file.txt'),
        'utf-8',
      )
      expect(content).toBe('New content')
    })

    it('creates parent directories', async () => {
      const result = await execWriteFile(tools, {
        path: 'nested/deep/file.txt',
        content: 'Nested content',
      })

      expect(result.success).toBe(true)
      const content = await fs.readFile(
        path.join(tempDir, 'nested/deep/file.txt'),
        'utf-8',
      )
      expect(content).toBe('Nested content')
    })

    it('overwrites existing file', async () => {
      await fs.writeFile(path.join(tempDir, 'existing.txt'), 'Old content')

      const result = await execWriteFile(tools, {
        path: 'existing.txt',
        content: 'New content',
      })

      expect(result.success).toBe(true)
      const content = await fs.readFile(
        path.join(tempDir, 'existing.txt'),
        'utf-8',
      )
      expect(content).toBe('New content')
    })
  })

  describe('editFile', () => {
    it('replaces unique string', async () => {
      await fs.writeFile(path.join(tempDir, 'edit.txt'), 'Hello, World!')

      const result = await execEditFile(tools, {
        path: 'edit.txt',
        oldString: 'World',
        newString: 'Universe',
      })

      expect(result.success).toBe(true)
      const content = await fs.readFile(path.join(tempDir, 'edit.txt'), 'utf-8')
      expect(content).toBe('Hello, Universe!')
    })

    it('fails if oldString not found', async () => {
      await fs.writeFile(path.join(tempDir, 'edit.txt'), 'Hello, World!')

      const result = await execEditFile(tools, {
        path: 'edit.txt',
        oldString: 'Mars',
        newString: 'Venus',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('fails if oldString is not unique without replaceAll', async () => {
      await fs.writeFile(path.join(tempDir, 'edit.txt'), 'foo bar foo baz foo')

      const result = await execEditFile(tools, {
        path: 'edit.txt',
        oldString: 'foo',
        newString: 'qux',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('3 times')
    })

    it('replaces all occurrences with replaceAll flag', async () => {
      await fs.writeFile(path.join(tempDir, 'edit.txt'), 'foo bar foo baz foo')

      const result = await execEditFile(tools, {
        path: 'edit.txt',
        oldString: 'foo',
        newString: 'qux',
        replaceAll: true,
      })

      expect(result.success).toBe(true)
      expect(result.replacements).toBe(3)
      const content = await fs.readFile(path.join(tempDir, 'edit.txt'), 'utf-8')
      expect(content).toBe('qux bar qux baz qux')
    })
  })

  describe('deleteFile', () => {
    it('deletes an existing file', async () => {
      await fs.writeFile(path.join(tempDir, 'to-delete.txt'), 'Delete me')

      const result = await execDeleteFile(tools, { path: 'to-delete.txt' })

      expect(result.success).toBe(true)
      await expect(
        fs.access(path.join(tempDir, 'to-delete.txt')),
      ).rejects.toThrow()
    })

    it('returns error for non-existent file', async () => {
      const result = await execDeleteFile(tools, { path: 'nonexistent.txt' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('ENOENT')
    })
  })

  describe('listDirectory', () => {
    it('lists directory contents', async () => {
      await fs.writeFile(path.join(tempDir, 'file1.txt'), '')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), '')
      await fs.mkdir(path.join(tempDir, 'subdir'))

      const result = await execListDir(tools, { path: '.' })

      expect(result.success).toBe(true)
      expect(result.items).toHaveLength(3)

      const names = result.items!.map((i: { name: string }) => i.name)
      expect(names).toContain('file1.txt')
      expect(names).toContain('file2.txt')
      expect(names).toContain('subdir')

      // Directories should be first (sorted)
      expect(result.items![0].type).toBe('directory')
    })

    it('filters hidden files', async () => {
      await fs.writeFile(path.join(tempDir, 'visible.txt'), '')
      await fs.writeFile(path.join(tempDir, '.hidden'), '')

      const result = await execListDir(tools, { path: '.' })

      expect(result.success).toBe(true)
      const names = result.items!.map((i: { name: string }) => i.name)
      expect(names).toContain('visible.txt')
      expect(names).not.toContain('.hidden')
    })

    it('truncates large directories', async () => {
      // Create many files exceeding the limit
      const numFiles = TRUNCATION_LIMITS.DIRECTORY_ITEMS + 100
      for (let i = 0; i < numFiles; i++) {
        await fs.writeFile(
          path.join(tempDir, `file${i.toString().padStart(4, '0')}.txt`),
          '',
        )
      }

      const result = await execListDir(tools, { path: '.' })

      expect(result.success).toBe(true)
      expect(result.truncated).toBe(true)
      expect(result.count).toBeLessThanOrEqual(
        TRUNCATION_LIMITS.DIRECTORY_ITEMS,
      )
      expect(result.totalCount).toBe(numFiles)
      expect(result.truncationMessage).toContain('truncated')
    })
  })

  describe('fileExists', () => {
    it('returns true for existing file', async () => {
      await fs.writeFile(path.join(tempDir, 'exists.txt'), '')

      const result = await execFileExists(tools, { path: 'exists.txt' })

      expect(result.exists).toBe(true)
      expect(result.type).toBe('file')
    })

    it('returns true for existing directory', async () => {
      await fs.mkdir(path.join(tempDir, 'existsdir'))

      const result = await execFileExists(tools, { path: 'existsdir' })

      expect(result.exists).toBe(true)
      expect(result.type).toBe('directory')
      expect(result.isDirectory).toBe(true)
    })

    it('returns false for non-existent path', async () => {
      const result = await execFileExists(tools, { path: 'nonexistent' })

      expect(result.exists).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Security Tests - Verify that protections PREVENT access
  // ─────────────────────────────────────────────────────────────────────────────

  describe('security: path traversal prevention', () => {
    it('BLOCKS reading files outside basePath with ../', async () => {
      // Create a file outside the sandbox to verify we can't read it
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moldable-outside-'),
      )
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret data')

      try {
        const result = await execReadFile(tools, {
          path: '../../../' + path.basename(outsideDir) + '/secret.txt',
        })

        // Should either fail with path traversal error OR not find the file
        // (depends on how many ../ are needed)
        expect(result.success).toBe(false)
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true })
      }
    })

    it('BLOCKS writing files outside basePath with ../', async () => {
      const result = await execWriteFile(tools, {
        path: '../../../tmp/evil.txt',
        content: 'malicious',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('traversal')
    })

    it('BLOCKS deleting files outside basePath', async () => {
      const result = await execDeleteFile(tools, {
        path: '../../../tmp/something.txt',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('traversal')
    })

    it('BLOCKS editing files outside basePath', async () => {
      const result = await execEditFile(tools, {
        path: '../../../etc/passwd',
        oldString: 'root',
        newString: 'hacked',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('traversal')
    })

    it('BLOCKS listing directories outside basePath', async () => {
      const result = await execListDir(tools, { path: '../../../' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('traversal')
    })
  })

  describe('security: absolute path handling', () => {
    it('allows absolute paths within basePath', async () => {
      await fs.writeFile(path.join(tempDir, 'absolute.txt'), 'content')

      const result = await execReadFile(tools, {
        path: path.join(tempDir, 'absolute.txt'),
      })

      expect(result.success).toBe(true)
    })

    it('BLOCKS absolute paths outside basePath', async () => {
      const result = await execReadFile(tools, { path: '/etc/passwd' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('traversal')
    })
  })

  describe('allowlisted write paths', () => {
    it('allows writing to ~/tmp even when basePath is set', async () => {
      const fakeHome = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moldable-home-'),
      )
      const prevHome = process.env.HOME
      const prevUserProfile = process.env.USERPROFILE

      try {
        process.env.HOME = fakeHome
        process.env.USERPROFILE = fakeHome
        const localTools = createFilesystemTools({ basePath: tempDir })

        const result = await execWriteFile(localTools, {
          path: '~/tmp/allowed.txt',
          content: 'ok',
        })

        expect(result.success).toBe(true)
        const written = await fs.readFile(
          path.join(fakeHome, 'tmp', 'allowed.txt'),
          'utf-8',
        )
        expect(written).toBe('ok')
      } finally {
        if (prevHome === undefined) delete process.env.HOME
        else process.env.HOME = prevHome

        if (prevUserProfile === undefined) delete process.env.USERPROFILE
        else process.env.USERPROFILE = prevUserProfile

        await fs.rm(fakeHome, { recursive: true, force: true })
      }
    })

    it('allows writing to ~/.moldable even when basePath is set', async () => {
      const fakeHome = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moldable-home-'),
      )
      const prevHome = process.env.HOME
      const prevUserProfile = process.env.USERPROFILE

      try {
        process.env.HOME = fakeHome
        process.env.USERPROFILE = fakeHome
        const localTools = createFilesystemTools({ basePath: tempDir })

        const result = await execWriteFile(localTools, {
          path: '~/.moldable/allowed.txt',
          content: 'ok2',
        })

        expect(result.success).toBe(true)
        const written = await fs.readFile(
          path.join(fakeHome, '.moldable', 'allowed.txt'),
          'utf-8',
        )
        expect(written).toBe('ok2')
      } finally {
        if (prevHome === undefined) delete process.env.HOME
        else process.env.HOME = prevHome

        if (prevUserProfile === undefined) delete process.env.USERPROFILE
        else process.env.USERPROFILE = prevUserProfile

        await fs.rm(fakeHome, { recursive: true, force: true })
      }
    })

    it('allows reading from ~/.moldable when basePath is set', async () => {
      const fakeHome = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moldable-home-'),
      )
      const prevHome = process.env.HOME
      const prevUserProfile = process.env.USERPROFILE

      try {
        process.env.HOME = fakeHome
        process.env.USERPROFILE = fakeHome
        await fs.mkdir(path.join(fakeHome, '.moldable'), { recursive: true })
        await fs.writeFile(
          path.join(fakeHome, '.moldable', 'config.json'),
          '{"key":"value"}',
        )

        const localTools = createFilesystemTools({ basePath: tempDir })
        const result = await execReadFile(localTools, {
          path: '~/.moldable/config.json',
        })

        expect(result.success).toBe(true)
        expect(result.content).toBe('{"key":"value"}')
      } finally {
        if (prevHome === undefined) delete process.env.HOME
        else process.env.HOME = prevHome

        if (prevUserProfile === undefined) delete process.env.USERPROFILE
        else process.env.USERPROFILE = prevUserProfile

        await fs.rm(fakeHome, { recursive: true, force: true })
      }
    })
  })
})

describe('createFilesystemTools without basePath', () => {
  // Tests for when no basePath is set (should use current directory)
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moldable-cwd-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('works without basePath restriction', async () => {
    const tools = createFilesystemTools() // No basePath

    await fs.writeFile(path.join(tempDir, 'test.txt'), 'content')

    const result = await execReadFile(tools, { path: 'test.txt' })

    expect(result.success).toBe(true)
  })
})
