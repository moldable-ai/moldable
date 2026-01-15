import {
  DEFAULT_SYSTEM_PROMPT,
  buildSystemPrompt,
  readAgentsFile,
} from './system-prompt'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('system-prompt', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moldable-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('DEFAULT_SYSTEM_PROMPT', () => {
    it('contains core identity', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Moldable')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('AI coding assistant')
    })

    it('contains capability descriptions', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Read and write files')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Execute commands')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Search codebases')
    })

    it('contains guidelines', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('File Operations')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Search Strategy')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Command Execution')
    })
  })

  describe('readAgentsFile', () => {
    it('reads AGENTS.md when present', async () => {
      const content = '# Test Guidelines\n\nSome instructions.'
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), content)

      const result = await readAgentsFile(tempDir)

      expect(result).toBe(content)
    })

    it('reads lowercase agents.md', async () => {
      const content = '# lowercase test'
      await fs.writeFile(path.join(tempDir, 'agents.md'), content)

      const result = await readAgentsFile(tempDir)

      expect(result).toBe(content)
    })

    it('returns null when file does not exist', async () => {
      const result = await readAgentsFile(tempDir)

      expect(result).toBeNull()
    })

    it('reads mixed case Agents.md', async () => {
      const content = '# Mixed case test'
      await fs.writeFile(path.join(tempDir, 'Agents.md'), content)

      const result = await readAgentsFile(tempDir)

      expect(result).toBe(content)
    })
  })

  describe('buildSystemPrompt', () => {
    it('includes default prompt', async () => {
      const result = await buildSystemPrompt()

      expect(result).toContain('You are Moldable')
      expect(result).toContain('AI coding assistant')
    })

    it('includes current date when provided', async () => {
      const date = new Date('2025-01-15')
      const result = await buildSystemPrompt({ currentDate: date })

      expect(result).toContain('January')
      expect(result).toContain('2025')
    })

    it('includes OS info when provided', async () => {
      const result = await buildSystemPrompt({ osInfo: 'darwin 23.6.0' })

      expect(result).toContain('darwin 23.6.0')
      expect(result).toContain('Operating system')
    })

    it('includes workspace path when provided', async () => {
      const result = await buildSystemPrompt({
        workspacePath: '/home/user/project',
      })

      expect(result).toContain('/home/user/project')
      expect(result).toContain('Workspace')
    })

    it('includes tool instructions for available tools', async () => {
      const result = await buildSystemPrompt({
        availableTools: ['readFile', 'writeFile', 'grep'],
      })

      expect(result).toContain('### readFile')
      expect(result).toContain('### writeFile')
      expect(result).toContain('### grep')
    })

    it('includes agents file content from workspace', async () => {
      const agentsContent = '# My Project Rules\n\nAlways use TypeScript.'
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent)

      const result = await buildSystemPrompt({ workspacePath: tempDir })

      expect(result).toContain('Workspace Guidelines')
      expect(result).toContain('My Project Rules')
      expect(result).toContain('Always use TypeScript')
    })

    it('skips agents file when includeAgentsFile is false', async () => {
      const agentsContent = '# Should not appear'
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent)

      const result = await buildSystemPrompt({
        workspacePath: tempDir,
        includeAgentsFile: false,
      })

      expect(result).not.toContain('Should not appear')
    })

    it('includes additional context when provided', async () => {
      const result = await buildSystemPrompt({
        additionalContext: 'User prefers verbose output.',
      })

      expect(result).toContain('Additional Context')
      expect(result).toContain('User prefers verbose output')
    })
  })
})
