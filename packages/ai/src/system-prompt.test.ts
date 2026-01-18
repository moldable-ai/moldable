import { DEFAULT_SYSTEM_PROMPT, buildSystemPrompt } from './system-prompt'
import { describe, expect, it } from 'vitest'

describe('system-prompt', () => {
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

    it('contains app creation guidance', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('scaffoldApp')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('~/.moldable/shared/apps/')
    })

    it('contains workspace-aware data isolation guidance', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('WorkspaceProvider')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('workspace-aware')
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

    it('includes tool instructions for available tools', async () => {
      const result = await buildSystemPrompt({
        availableTools: ['readFile', 'writeFile', 'grep'],
      })

      expect(result).toContain('### readFile')
      expect(result).toContain('### writeFile')
      expect(result).toContain('### grep')
    })

    it('includes additional context when provided', async () => {
      const result = await buildSystemPrompt({
        additionalContext: 'User prefers verbose output.',
      })

      expect(result).toContain('Additional Context')
      expect(result).toContain('User prefers verbose output')
    })

    it('includes moldable home path when provided', async () => {
      const result = await buildSystemPrompt({
        moldableHome: '/Users/test/.moldable',
      })

      expect(result).toContain('MOLDABLE_HOME: /Users/test/.moldable')
      expect(result).toContain(
        'App source code directory: /Users/test/.moldable/shared/apps/',
      )
    })

    it('includes active workspace ID when provided', async () => {
      const result = await buildSystemPrompt({
        activeWorkspaceId: 'personal',
        moldableHome: '/Users/test/.moldable',
      })

      expect(result).toContain('Active workspace ID: personal')
      expect(result).toContain(
        'Workspace config path: /Users/test/.moldable/workspaces/personal/config.json',
      )
    })

    it('includes registered apps when provided', async () => {
      const result = await buildSystemPrompt({
        registeredApps: [
          { id: 'notes', name: 'Notes', icon: '📝' },
          { id: 'todo', name: 'Todo', icon: '✅' },
        ],
      })

      expect(result).toContain('Registered Apps')
      expect(result).toContain('📝 **Notes**')
      expect(result).toContain('✅ **Todo**')
    })

    it('includes active app context when provided', async () => {
      const result = await buildSystemPrompt({
        activeApp: {
          id: 'notes',
          name: 'Notes',
          icon: '📝',
          workingDir: '/Users/test/.moldable/shared/apps/notes',
          dataDir: '/Users/test/.moldable/workspaces/personal/apps/notes/data',
        },
      })

      expect(result).toContain('Active App Context')
      expect(result).toContain('📝 Notes')
      expect(result).toContain('Working Directory')
      expect(result).toContain('Data Directory')
    })
  })
})
