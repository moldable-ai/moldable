import {
  PathTraversalError,
  WORKSPACE_HEADER,
  ensureDir,
  generateId,
  getAppDataDir,
  getAppId,
  getMoldableHome,
  getWorkspaceFromRequest,
  getWorkspaceId,
  isRunningInMoldable,
  readJson,
  safePath,
  sanitizeId,
  writeJson,
} from './index.js'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Store original env vars
const originalEnv = { ...process.env }

describe('@moldable-ai/storage', () => {
  beforeEach(() => {
    // Reset env vars before each test
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('getMoldableHome', () => {
    it('returns MOLDABLE_HOME when set', () => {
      process.env.MOLDABLE_HOME = '/custom/moldable'
      expect(getMoldableHome()).toBe('/custom/moldable')
    })

    it('returns ~/.moldable when MOLDABLE_HOME is not set', () => {
      delete process.env.MOLDABLE_HOME
      const expected = path.join(os.homedir(), '.moldable')
      expect(getMoldableHome()).toBe(expected)
    })

    it('returns empty string when MOLDABLE_HOME is explicitly set to empty', () => {
      process.env.MOLDABLE_HOME = ''
      // Nullish coalescing only handles null/undefined, not empty strings
      // An explicitly set empty MOLDABLE_HOME is honored (edge case)
      expect(getMoldableHome()).toBe('')
    })
  })

  describe('getWorkspaceId', () => {
    it('returns override when provided', () => {
      expect(getWorkspaceId('work')).toBe('work')
    })

    it('returns MOLDABLE_WORKSPACE_ID when set and no override', () => {
      process.env.MOLDABLE_WORKSPACE_ID = 'work'
      expect(getWorkspaceId()).toBe('work')
      delete process.env.MOLDABLE_WORKSPACE_ID
    })

    it('returns personal as default when MOLDABLE_WORKSPACE_ID is not set', () => {
      delete process.env.MOLDABLE_WORKSPACE_ID
      expect(getWorkspaceId()).toBe('personal')
    })

    it('prefers override over env var', () => {
      process.env.MOLDABLE_WORKSPACE_ID = 'env-workspace'
      expect(getWorkspaceId('override-workspace')).toBe('override-workspace')
      delete process.env.MOLDABLE_WORKSPACE_ID
    })
  })

  describe('getWorkspaceFromRequest', () => {
    it('returns workspace from header', () => {
      const request = new Request('http://localhost/api/notes', {
        headers: { [WORKSPACE_HEADER]: 'work' },
      })
      expect(getWorkspaceFromRequest(request)).toBe('work')
    })

    it('returns undefined when header is not present', () => {
      const request = new Request('http://localhost/api/notes')
      expect(getWorkspaceFromRequest(request)).toBeUndefined()
    })
  })

  describe('getAppDataDir', () => {
    it('returns MOLDABLE_APP_DATA_DIR when set', () => {
      process.env.MOLDABLE_APP_DATA_DIR = '/explicit/data/dir'
      expect(getAppDataDir()).toBe('/explicit/data/dir')
    })

    it('derives path from MOLDABLE_HOME + workspace + MOLDABLE_APP_ID', () => {
      delete process.env.MOLDABLE_APP_DATA_DIR
      process.env.MOLDABLE_HOME = '/custom/moldable'
      process.env.MOLDABLE_APP_ID = 'my-app'
      // Uses default workspace 'personal' when MOLDABLE_WORKSPACE_ID is not set

      expect(getAppDataDir()).toBe(
        '/custom/moldable/workspaces/personal/apps/my-app/data',
      )
    })

    it('derives path from default home + workspace + MOLDABLE_APP_ID', () => {
      delete process.env.MOLDABLE_APP_DATA_DIR
      delete process.env.MOLDABLE_HOME
      process.env.MOLDABLE_APP_ID = 'my-app'
      // Uses default workspace 'personal' when MOLDABLE_WORKSPACE_ID is not set

      const expected = path.join(
        os.homedir(),
        '.moldable',
        'workspaces',
        'personal',
        'apps',
        'my-app',
        'data',
      )
      expect(getAppDataDir()).toBe(expected)
    })

    it('uses custom workspace from MOLDABLE_WORKSPACE_ID', () => {
      delete process.env.MOLDABLE_APP_DATA_DIR
      process.env.MOLDABLE_HOME = '/custom/moldable'
      process.env.MOLDABLE_APP_ID = 'my-app'
      process.env.MOLDABLE_WORKSPACE_ID = 'work'

      expect(getAppDataDir()).toBe(
        '/custom/moldable/workspaces/work/apps/my-app/data',
      )

      delete process.env.MOLDABLE_WORKSPACE_ID
    })

    it('falls back to ./data in development when no env vars set', () => {
      delete process.env.MOLDABLE_APP_DATA_DIR
      delete process.env.MOLDABLE_APP_ID
      process.env.NODE_ENV = 'development'

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = getAppDataDir()
      expect(result).toBe(path.join(process.cwd(), 'data'))
      expect(warnSpy).toHaveBeenCalledWith(
        '[@moldable-ai/storage] MOLDABLE_APP_DATA_DIR not set, using ./data (dev fallback)',
      )
    })

    it('falls back to ./data in production without warning', () => {
      delete process.env.MOLDABLE_APP_DATA_DIR
      delete process.env.MOLDABLE_APP_ID
      process.env.NODE_ENV = 'production'

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = getAppDataDir()
      expect(result).toBe(path.join(process.cwd(), 'data'))
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('prefers MOLDABLE_APP_DATA_DIR over derived path when no override', () => {
      process.env.MOLDABLE_APP_DATA_DIR = '/explicit/dir'
      process.env.MOLDABLE_HOME = '/home/dir'
      process.env.MOLDABLE_APP_ID = 'app-id'

      expect(getAppDataDir()).toBe('/explicit/dir')
    })

    it('uses workspace override to derive path (ignores MOLDABLE_APP_DATA_DIR)', () => {
      process.env.MOLDABLE_APP_DATA_DIR = '/explicit/dir'
      process.env.MOLDABLE_HOME = '/home/moldable'
      process.env.MOLDABLE_APP_ID = 'my-app'

      // When workspace override is provided, it derives the path dynamically
      expect(getAppDataDir('work')).toBe(
        '/home/moldable/workspaces/work/apps/my-app/data',
      )
    })

    it('requires MOLDABLE_APP_ID for workspace override to work', () => {
      delete process.env.MOLDABLE_APP_ID
      process.env.MOLDABLE_APP_DATA_DIR = '/explicit/dir'

      // Without app ID, falls back to MOLDABLE_APP_DATA_DIR even with override
      expect(getAppDataDir('work')).toBe('/explicit/dir')
    })
  })

  describe('getAppId', () => {
    it('returns MOLDABLE_APP_ID when set', () => {
      process.env.MOLDABLE_APP_ID = 'test-app'
      expect(getAppId()).toBe('test-app')
    })

    it('returns undefined when MOLDABLE_APP_ID is not set', () => {
      delete process.env.MOLDABLE_APP_ID
      expect(getAppId()).toBeUndefined()
    })
  })

  describe('isRunningInMoldable', () => {
    it('returns true when MOLDABLE_APP_ID is set', () => {
      process.env.MOLDABLE_APP_ID = 'any-app'
      expect(isRunningInMoldable()).toBe(true)
    })

    it('returns false when MOLDABLE_APP_ID is not set', () => {
      delete process.env.MOLDABLE_APP_ID
      expect(isRunningInMoldable()).toBe(false)
    })

    it('returns false when MOLDABLE_APP_ID is empty', () => {
      process.env.MOLDABLE_APP_ID = ''
      expect(isRunningInMoldable()).toBe(false)
    })
  })

  describe('PathTraversalError', () => {
    it('creates error with correct name', () => {
      const error = new PathTraversalError('../bad')
      expect(error.name).toBe('PathTraversalError')
    })

    it('creates error with descriptive message', () => {
      const error = new PathTraversalError('../etc/passwd')
      expect(error.message).toBe(
        'Path traversal detected: "../etc/passwd" is not allowed',
      )
    })

    it('is an instance of Error', () => {
      const error = new PathTraversalError('test')
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe('safePath', () => {
    const baseDir = '/safe/base/dir'

    describe('valid paths', () => {
      it('joins simple segments', () => {
        expect(safePath(baseDir, 'file.txt')).toBe('/safe/base/dir/file.txt')
      })

      it('joins multiple segments', () => {
        expect(safePath(baseDir, 'subdir', 'file.txt')).toBe(
          '/safe/base/dir/subdir/file.txt',
        )
      })

      it('joins deeply nested paths', () => {
        expect(safePath(baseDir, 'a', 'b', 'c', 'd', 'file.txt')).toBe(
          '/safe/base/dir/a/b/c/d/file.txt',
        )
      })

      it('handles current directory reference (.)', () => {
        expect(safePath(baseDir, '.', 'file.txt')).toBe(
          '/safe/base/dir/file.txt',
        )
      })

      it('handles segments with dots in names', () => {
        expect(safePath(baseDir, 'file.test.json')).toBe(
          '/safe/base/dir/file.test.json',
        )
      })

      it('handles empty segments array', () => {
        expect(safePath(baseDir)).toBe(baseDir)
      })
    })

    describe('path traversal prevention', () => {
      it('rejects parent directory reference (..)', () => {
        expect(() => safePath(baseDir, '..')).toThrow(PathTraversalError)
      })

      it('rejects .. at start of segment', () => {
        expect(() => safePath(baseDir, '../etc')).toThrow(PathTraversalError)
      })

      it('rejects .. in middle of segment', () => {
        expect(() => safePath(baseDir, 'foo/../bar')).toThrow(
          PathTraversalError,
        )
      })

      it('rejects .. at end of segment', () => {
        expect(() => safePath(baseDir, 'foo/..')).toThrow(PathTraversalError)
      })

      it('rejects multiple .. in path', () => {
        expect(() => safePath(baseDir, '..', '..', 'etc')).toThrow(
          PathTraversalError,
        )
      })

      it('rejects .. buried in valid-looking path', () => {
        expect(() =>
          safePath(baseDir, 'subdir', '..', '..', 'secrets'),
        ).toThrow(PathTraversalError)
      })

      it('rejects absolute paths in segments', () => {
        expect(() => safePath(baseDir, '/etc/passwd')).toThrow(
          PathTraversalError,
        )
      })

      it('rejects backslashes (Windows path separator)', () => {
        expect(() => safePath(baseDir, 'foo\\bar')).toThrow(PathTraversalError)
      })

      it('rejects backslash traversal attempts', () => {
        expect(() => safePath(baseDir, '..\\..\\etc')).toThrow(
          PathTraversalError,
        )
      })

      it('rejects null bytes', () => {
        expect(() => safePath(baseDir, 'file\0.txt')).toThrow(
          PathTraversalError,
        )
      })

      it('rejects null byte traversal', () => {
        expect(() => safePath(baseDir, 'file.txt\0../etc/passwd')).toThrow(
          PathTraversalError,
        )
      })
    })

    describe('edge cases', () => {
      it('handles base path with trailing slash', () => {
        expect(safePath('/base/', 'file.txt')).toBe('/base/file.txt')
      })

      it('handles segments with spaces', () => {
        expect(safePath(baseDir, 'my file.txt')).toBe(
          '/safe/base/dir/my file.txt',
        )
      })

      it('handles unicode in segments', () => {
        expect(safePath(baseDir, '日本語.txt')).toBe(
          '/safe/base/dir/日本語.txt',
        )
      })

      it('handles emoji in segments', () => {
        expect(safePath(baseDir, '📁', 'data.json')).toBe(
          '/safe/base/dir/📁/data.json',
        )
      })
    })
  })

  describe('sanitizeId', () => {
    describe('valid IDs', () => {
      it('accepts alphanumeric IDs', () => {
        expect(sanitizeId('abc123')).toBe('abc123')
      })

      it('accepts IDs with dashes', () => {
        expect(sanitizeId('my-app-id')).toBe('my-app-id')
      })

      it('accepts IDs with underscores', () => {
        expect(sanitizeId('my_app_id')).toBe('my_app_id')
      })

      it('accepts mixed valid characters', () => {
        expect(sanitizeId('My-App_v2-beta')).toBe('My-App_v2-beta')
      })

      it('accepts single character IDs', () => {
        expect(sanitizeId('a')).toBe('a')
      })

      it('accepts numeric-only IDs', () => {
        expect(sanitizeId('12345')).toBe('12345')
      })

      it('accepts uppercase IDs', () => {
        expect(sanitizeId('MYAPP')).toBe('MYAPP')
      })

      it('accepts 255-character IDs (max length)', () => {
        const longId = 'a'.repeat(255)
        expect(sanitizeId(longId)).toBe(longId)
      })
    })

    describe('invalid IDs', () => {
      it('rejects empty string', () => {
        expect(() => sanitizeId('')).toThrow('ID cannot be empty')
      })

      it('rejects IDs with dots', () => {
        expect(() => sanitizeId('file.json')).toThrow('Invalid ID')
      })

      it('rejects IDs with slashes', () => {
        expect(() => sanitizeId('path/to/file')).toThrow('Invalid ID')
      })

      it('rejects IDs with parent directory references', () => {
        expect(() => sanitizeId('../etc')).toThrow('Invalid ID')
      })

      it('rejects IDs with spaces', () => {
        expect(() => sanitizeId('my app')).toThrow('Invalid ID')
      })

      it('rejects IDs with special characters', () => {
        expect(() => sanitizeId('app@123')).toThrow('Invalid ID')
        expect(() => sanitizeId('app#tag')).toThrow('Invalid ID')
        expect(() => sanitizeId('app$var')).toThrow('Invalid ID')
      })

      it('rejects IDs with backslashes', () => {
        expect(() => sanitizeId('path\\to')).toThrow('Invalid ID')
      })

      it('rejects IDs over 255 characters', () => {
        const tooLong = 'a'.repeat(256)
        expect(() => sanitizeId(tooLong)).toThrow('ID too long')
      })

      it('rejects IDs with null bytes', () => {
        expect(() => sanitizeId('app\0')).toThrow('Invalid ID')
      })

      it('rejects IDs with unicode', () => {
        expect(() => sanitizeId('日本語')).toThrow('Invalid ID')
      })

      it('rejects IDs with emoji', () => {
        expect(() => sanitizeId('app-🚀')).toThrow('Invalid ID')
      })
    })
  })

  describe('generateId', () => {
    it('generates a non-empty string', () => {
      const id = generateId()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('generates unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateId())
      }
      expect(ids.size).toBe(100)
    })

    it('generates IDs in expected format (timestamp-random)', () => {
      const id = generateId()
      expect(id).toMatch(/^\d+-[a-z0-9]+$/)
    })

    it('generates IDs that pass sanitizeId validation', () => {
      for (let i = 0; i < 10; i++) {
        const id = generateId()
        expect(() => sanitizeId(id)).not.toThrow()
      }
    })

    it('includes current timestamp', () => {
      const before = Date.now()
      const id = generateId()
      const after = Date.now()

      const parts = id.split('-')
      const timestamp = parseInt(parts[0] ?? '0', 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('has consistent format length', () => {
      // Timestamp (13 digits) + dash + random (6 chars) = 20 chars
      const id = generateId()
      const parts = id.split('-')
      expect(parts).toHaveLength(2)
      expect(parts[0]?.length).toBe(13) // Milliseconds timestamp
      expect(parts[1]?.length).toBe(6)
    })
  })

  describe('ensureDir', () => {
    const testDir = path.join(
      os.tmpdir(),
      'moldable-storage-test',
      generateId(),
    )

    afterEach(async () => {
      // Clean up test directories
      try {
        await fs.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('creates a new directory', async () => {
      await ensureDir(testDir)

      const stat = await fs.stat(testDir)
      expect(stat.isDirectory()).toBe(true)
    })

    it('creates nested directories', async () => {
      const nested = path.join(testDir, 'deep', 'nested', 'dir')
      await ensureDir(nested)

      const stat = await fs.stat(nested)
      expect(stat.isDirectory()).toBe(true)
    })

    it('does not throw if directory already exists', async () => {
      await ensureDir(testDir)
      // Second call should not throw
      await expect(ensureDir(testDir)).resolves.not.toThrow()
    })

    it('does not throw for existing nested directories', async () => {
      const nested = path.join(testDir, 'a', 'b')
      await ensureDir(nested)
      await expect(ensureDir(nested)).resolves.not.toThrow()
    })
  })

  describe('readJson', () => {
    const testDir = path.join(
      os.tmpdir(),
      'moldable-storage-test',
      generateId(),
    )
    const testFile = path.join(testDir, 'test.json')

    beforeEach(async () => {
      await fs.mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('reads and parses JSON file', async () => {
      const data = { name: 'test', count: 42 }
      await fs.writeFile(testFile, JSON.stringify(data))

      const result = await readJson(testFile, null)
      expect(result).toEqual(data)
    })

    it('returns default value for non-existent file', async () => {
      const defaultValue = { empty: true }
      const result = await readJson(
        path.join(testDir, 'nonexistent.json'),
        defaultValue,
      )
      expect(result).toEqual(defaultValue)
    })

    it('returns default value when file does not exist (null default)', async () => {
      const result = await readJson(path.join(testDir, 'missing.json'), null)
      expect(result).toBeNull()
    })

    it('returns default value when file does not exist (array default)', async () => {
      const result = await readJson(path.join(testDir, 'missing.json'), [])
      expect(result).toEqual([])
    })

    it('throws on invalid JSON', async () => {
      await fs.writeFile(testFile, 'not valid json {{{')

      await expect(readJson(testFile, null)).rejects.toThrow(SyntaxError)
    })

    it('throws on permission errors (not ENOENT)', async () => {
      // Create a directory with the same name as the file we're trying to read
      const dirAsFile = path.join(testDir, 'is-a-dir')
      await fs.mkdir(dirAsFile)

      await expect(readJson(dirAsFile, null)).rejects.toThrow()
    })

    it('preserves complex data types', async () => {
      const data = {
        string: 'hello',
        number: 123.456,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { a: { b: { c: 'deep' } } },
      }
      await fs.writeFile(testFile, JSON.stringify(data))

      const result = await readJson(testFile, {})
      expect(result).toEqual(data)
    })

    it('handles empty JSON object', async () => {
      await fs.writeFile(testFile, '{}')

      const result = await readJson(testFile, { fallback: true })
      expect(result).toEqual({})
    })

    it('handles JSON arrays', async () => {
      const data = [1, 2, 3, 'four']
      await fs.writeFile(testFile, JSON.stringify(data))

      const result = await readJson<unknown[]>(testFile, [])
      expect(result).toEqual(data)
    })
  })

  describe('writeJson', () => {
    const testDir = path.join(
      os.tmpdir(),
      'moldable-storage-test',
      generateId(),
    )
    const testFile = path.join(testDir, 'output.json')

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('writes JSON to file', async () => {
      const data = { name: 'test', value: 42 }
      await writeJson(testFile, data)

      const content = await fs.readFile(testFile, 'utf-8')
      expect(JSON.parse(content)).toEqual(data)
    })

    it('creates parent directories', async () => {
      const nestedFile = path.join(testDir, 'a', 'b', 'c', 'file.json')
      await writeJson(nestedFile, { nested: true })

      const content = await fs.readFile(nestedFile, 'utf-8')
      expect(JSON.parse(content)).toEqual({ nested: true })
    })

    it('pretty-prints by default', async () => {
      const data = { a: 1, b: 2 }
      await writeJson(testFile, data)

      const content = await fs.readFile(testFile, 'utf-8')
      expect(content).toBe('{\n  "a": 1,\n  "b": 2\n}')
    })

    it('can write compact JSON', async () => {
      const data = { a: 1, b: 2 }
      await writeJson(testFile, data, false)

      const content = await fs.readFile(testFile, 'utf-8')
      expect(content).toBe('{"a":1,"b":2}')
    })

    it('overwrites existing file', async () => {
      await ensureDir(testDir)
      await fs.writeFile(testFile, JSON.stringify({ old: 'data' }))

      await writeJson(testFile, { new: 'data' })

      const content = await fs.readFile(testFile, 'utf-8')
      expect(JSON.parse(content)).toEqual({ new: 'data' })
    })

    it('handles complex nested data', async () => {
      const data = {
        users: [
          { id: 1, name: 'Alice', tags: ['admin', 'user'] },
          { id: 2, name: 'Bob', tags: ['user'] },
        ],
        metadata: {
          version: '1.0.0',
          created: '2024-01-01',
        },
      }
      await writeJson(testFile, data)

      const result = await readJson(testFile, null)
      expect(result).toEqual(data)
    })

    it('handles null value', async () => {
      await writeJson(testFile, null)

      const content = await fs.readFile(testFile, 'utf-8')
      expect(content).toBe('null')
    })

    it('handles arrays', async () => {
      const data = [1, 2, 3]
      await writeJson(testFile, data)

      const result = await readJson(testFile, [])
      expect(result).toEqual(data)
    })

    it('handles empty objects', async () => {
      await writeJson(testFile, {})

      const content = await fs.readFile(testFile, 'utf-8')
      expect(content).toBe('{}')
    })

    it('handles unicode content', async () => {
      const data = { message: '日本語テスト 🎉' }
      await writeJson(testFile, data)

      const result = await readJson(testFile, null)
      expect(result).toEqual(data)
    })
  })

  describe('integration: safePath + sanitizeId', () => {
    it('safely constructs data file paths', () => {
      const dataDir = '/data'
      const id = sanitizeId('meeting-123')
      const filePath = safePath(dataDir, 'entries', `${id}.json`)

      expect(filePath).toBe('/data/entries/meeting-123.json')
    })

    it('prevents injection via ID manipulation', () => {
      // These should fail at sanitizeId before reaching safePath
      expect(() => sanitizeId('../etc')).toThrow()
      expect(() => sanitizeId('../../passwd')).toThrow()
      expect(() => sanitizeId('file.json')).toThrow()
    })

    it('allows generated IDs in safe paths', () => {
      const dataDir = '/data'
      const id = generateId()

      expect(() => {
        sanitizeId(id)
        safePath(dataDir, 'entries', `${id}.json`)
      }).not.toThrow()
    })
  })

  describe('integration: full workflow', () => {
    const testDir = path.join(
      os.tmpdir(),
      'moldable-storage-test',
      generateId(),
    )

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('simulates app data persistence workflow', async () => {
      // Setup: Create app data directory
      const appDataDir = path.join(testDir, 'app-data')
      await ensureDir(appDataDir)

      // Step 1: Generate unique ID for a new entry
      const entryId = generateId()
      expect(() => sanitizeId(entryId)).not.toThrow()

      // Step 2: Construct safe file path
      const entriesDir = safePath(appDataDir, 'entries')
      const entryFile = safePath(entriesDir, `${entryId}.json`)

      // Step 3: Write data
      const entryData = {
        id: entryId,
        title: 'Meeting Notes',
        content: 'Discussed project roadmap',
        created: new Date().toISOString(),
      }
      await writeJson(entryFile, entryData)

      // Step 4: Read data back
      const retrieved = await readJson(entryFile, null)
      expect(retrieved).toEqual(entryData)

      // Step 5: Update data
      const updatedData = { ...entryData, content: 'Updated notes' }
      await writeJson(entryFile, updatedData)

      const reread = await readJson(entryFile, null)
      expect(reread).toEqual(updatedData)
    })

    it('simulates config file management', async () => {
      const configDir = path.join(testDir, 'config')
      const configFile = safePath(configDir, 'settings.json')

      // Read with default when file doesn't exist
      const defaultSettings = { theme: 'light', notifications: true }
      const settings = await readJson(configFile, defaultSettings)
      expect(settings).toEqual(defaultSettings)

      // Write updated settings
      const updatedSettings = { ...settings, theme: 'dark' }
      await writeJson(configFile, updatedSettings)

      // Read again - should get updated value
      const persisted = await readJson(configFile, defaultSettings)
      expect(persisted).toEqual(updatedSettings)
    })
  })
})
