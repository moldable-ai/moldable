import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock os.homedir before importing skills module
const _originalHomedir = os.homedir
let fakeHome: string

beforeEach(async () => {
  // Create a fake home directory for each test
  fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'moldable-skills-test-'))
  vi.spyOn(os, 'homedir').mockReturnValue(fakeHome)
})

afterEach(async () => {
  vi.restoreAllMocks()
  // Clean up
  await fs.rm(fakeHome, { recursive: true, force: true })
})

// Import after mocking - use dynamic import to get fresh module each time
async function importSkillsModule() {
  // Clear the module cache to get fresh constants
  vi.resetModules()
  return await import('./skills')
}

// Helper types for tool execution
type ToolContext = { toolCallId: string; messages: []; abortSignal: never }
const ctx: ToolContext = {
  toolCallId: 'test',
  messages: [],
  abortSignal: undefined as never,
}

describe('createSkillsTools', () => {
  describe('initSkillsConfig', () => {
    it('creates default config when none exists', async () => {
      const { createSkillsTools } = await importSkillsModule()
      const tools = createSkillsTools()

      const result = (await tools.initSkillsConfig.execute!({}, ctx)) as {
        success: boolean
        message?: string
        repositories?: Array<{ name: string; url: string }>
      }

      expect(result.success).toBe(true)
      expect(result.message).toContain('Anthropic')
      expect(result.repositories).toHaveLength(1)
      expect(result.repositories![0].name).toBe('anthropic-skills')

      // Verify file was created
      const configPath = path.join(
        fakeHome,
        '.moldable',
        'shared',
        'config',
        'skills.json',
      )
      const content = await fs.readFile(configPath, 'utf-8')
      const config = JSON.parse(content)
      expect(config.repositories).toHaveLength(1)
    })

    it('fails if config already exists', async () => {
      const { createSkillsTools } = await importSkillsModule()
      const tools = createSkillsTools()

      // Create config first
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({ repositories: [] }),
      )

      const result = (await tools.initSkillsConfig.execute!({}, ctx)) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('already exists')
    })
  })

  describe('listSkillRepos', () => {
    it('returns error when no config exists', async () => {
      const { createSkillsTools } = await importSkillsModule()
      const tools = createSkillsTools()

      const result = (await tools.listSkillRepos.execute!({}, ctx)) as {
        success: boolean
        error?: string
        repositories: Array<unknown>
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No skills config found')
      expect(result.repositories).toEqual([])
    })

    it('lists repositories from config', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'test-skills',
              url: 'test/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'all',
              skills: [],
            },
          ],
        }),
      )

      const tools = createSkillsTools()
      const result = (await tools.listSkillRepos.execute!({}, ctx)) as {
        success: boolean
        repositories: Array<{ name: string; url: string; enabled: boolean }>
      }

      expect(result.success).toBe(true)
      expect(result.repositories).toHaveLength(1)
      expect(result.repositories[0].name).toBe('test-skills')
      expect(result.repositories[0].url).toBe('test/repo')
      expect(result.repositories[0].enabled).toBe(true)
    })
  })

  describe('addSkillRepo', () => {
    it('creates config and adds repo when none exists', async () => {
      const { createSkillsTools } = await importSkillsModule()
      const tools = createSkillsTools()

      // Mock fetch for GitHub API
      const mockSkills = [
        { type: 'dir', name: 'skill1' },
        { type: 'dir', name: 'skill2' },
        { type: 'file', name: 'README.md' },
      ]
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockSkills,
      } as Response)

      const result = (await tools.addSkillRepo.execute!(
        {
          url: 'owner/repo',
          name: 'my-skills',
          branch: 'main',
          skillsPath: 'skills',
          mode: 'all',
          skills: [],
        },
        ctx,
      )) as {
        success: boolean
        name?: string
        availableSkills?: string[]
        error?: string
      }

      expect(result.success).toBe(true)
      expect(result.name).toBe('my-skills')
      expect(result.availableSkills).toEqual(['skill1', 'skill2'])
    })

    it('fails if repo already registered', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config with existing repo
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'existing',
              url: 'owner/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'all',
              skills: [],
            },
          ],
        }),
      )

      const tools = createSkillsTools()
      const result = (await tools.addSkillRepo.execute!(
        {
          url: 'owner/repo',
          name: 'duplicate',
          branch: 'main',
          skillsPath: 'skills',
          mode: 'all',
          skills: [],
        },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('already registered')
    })

    it('fails if repo has no skills', async () => {
      const { createSkillsTools } = await importSkillsModule()
      const tools = createSkillsTools()

      // Mock fetch returning empty list
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response)

      const result = (await tools.addSkillRepo.execute!(
        {
          url: 'owner/empty-repo',
          name: 'empty',
          branch: 'main',
          skillsPath: 'skills',
          mode: 'all',
          skills: [],
        },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No skills found')
    })
  })

  describe('updateSkillSelection', () => {
    it('updates mode and skills list', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'test-repo',
              url: 'test/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'all',
              skills: [],
            },
          ],
        }),
      )

      const tools = createSkillsTools()
      const result = (await tools.updateSkillSelection.execute!(
        {
          repoName: 'test-repo',
          mode: 'include',
          skills: ['pdf', 'docx'],
          enabled: true,
        },
        ctx,
      )) as {
        success: boolean
        mode?: string
        skills?: string[]
      }

      expect(result.success).toBe(true)
      expect(result.mode).toBe('include')
      expect(result.skills).toEqual(['pdf', 'docx'])

      // Verify file was updated
      const content = await fs.readFile(
        path.join(configDir, 'skills.json'),
        'utf-8',
      )
      const config = JSON.parse(content)
      expect(config.repositories[0].mode).toBe('include')
      expect(config.repositories[0].skills).toEqual(['pdf', 'docx'])
    })

    it('can disable a repository', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'test-repo',
              url: 'test/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'all',
              skills: [],
            },
          ],
        }),
      )

      const tools = createSkillsTools()
      const result = (await tools.updateSkillSelection.execute!(
        {
          repoName: 'test-repo',
          enabled: false,
        },
        ctx,
      )) as {
        success: boolean
        enabled?: boolean
      }

      expect(result.success).toBe(true)
      expect(result.enabled).toBe(false)
    })

    it('fails for non-existent repo', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({ repositories: [] }),
      )

      const tools = createSkillsTools()
      const result = (await tools.updateSkillSelection.execute!(
        {
          repoName: 'nonexistent',
          mode: 'include',
        },
        ctx,
      )) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('listAvailableSkills', () => {
    it('fetches skills from GitHub and shows selection', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'test-repo',
              url: 'test/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'include',
              skills: ['pdf', 'docx'],
            },
          ],
        }),
      )

      // Mock fetch
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { type: 'dir', name: 'pdf' },
          { type: 'dir', name: 'docx' },
          { type: 'dir', name: 'xlsx' },
          { type: 'dir', name: 'pptx' },
        ],
      } as Response)

      const tools = createSkillsTools()
      const result = (await tools.listAvailableSkills.execute!(
        { repoName: 'test-repo' },
        ctx,
      )) as {
        success: boolean
        repoName?: string
        available?: string[]
        selected?: string[]
        mode?: string
      }

      expect(result.success).toBe(true)
      expect(result.available).toEqual(['pdf', 'docx', 'xlsx', 'pptx'])
      expect(result.selected).toEqual(['pdf', 'docx']) // Only included ones
      expect(result.mode).toBe('include')
    })

    it('handles exclude mode correctly', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config with exclude mode
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'test-repo',
              url: 'test/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'exclude',
              skills: ['xlsx'], // Exclude xlsx
            },
          ],
        }),
      )

      // Mock fetch
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { type: 'dir', name: 'pdf' },
          { type: 'dir', name: 'docx' },
          { type: 'dir', name: 'xlsx' },
        ],
      } as Response)

      const tools = createSkillsTools()
      const result = (await tools.listAvailableSkills.execute!(
        { repoName: 'test-repo' },
        ctx,
      )) as {
        success: boolean
        selected?: string[]
      }

      expect(result.success).toBe(true)
      expect(result.selected).toEqual(['pdf', 'docx']) // xlsx excluded
    })
  })

  describe('syncSkills', () => {
    it('downloads skills from enabled repos', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'test-repo',
              url: 'test/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'include',
              skills: ['pdf'],
            },
          ],
        }),
      )

      // Mock fetch calls
      const fetchMock = vi.spyOn(global, 'fetch')

      // First call: list available skills
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { type: 'dir', name: 'pdf' },
          { type: 'dir', name: 'docx' },
        ],
      } as Response)

      // Second call: get skill contents
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            type: 'file',
            name: 'SKILL.md',
            download_url: 'https://raw.githubusercontent.com/test/skill.md',
          },
        ],
      } as Response)

      // Third call: download file content
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => '# PDF Skill\n\nThis skill handles PDFs.',
      } as Response)

      const tools = createSkillsTools()
      const result = (await tools.syncSkills.execute!({}, ctx)) as {
        success: boolean
        synced?: number
        failed?: number
        skills?: string[]
        skillsDir?: string
      }

      expect(result.success).toBe(true)
      expect(result.synced).toBe(1)
      expect(result.skills).toContain('pdf')

      // Verify file was created
      const skillPath = path.join(
        fakeHome,
        '.moldable',
        'shared',
        'skills',
        'test-repo',
        'pdf',
        'SKILL.md',
      )
      const content = await fs.readFile(skillPath, 'utf-8')
      expect(content).toContain('PDF Skill')
    })

    it('skips disabled repos', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config with disabled repo
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'disabled-repo',
              url: 'test/repo',
              branch: 'main',
              skillsPath: 'skills',
              enabled: false,
              mode: 'all',
              skills: [],
            },
          ],
        }),
      )

      const tools = createSkillsTools()
      const result = (await tools.syncSkills.execute!({}, ctx)) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No enabled repositories')
    })

    it('syncs specific repo when repoName provided', async () => {
      const { createSkillsTools } = await importSkillsModule()

      // Create config with multiple repos
      const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, 'skills.json'),
        JSON.stringify({
          repositories: [
            {
              name: 'repo-1',
              url: 'test/repo1',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'all',
              skills: [],
            },
            {
              name: 'repo-2',
              url: 'test/repo2',
              branch: 'main',
              skillsPath: 'skills',
              enabled: true,
              mode: 'all',
              skills: [],
            },
          ],
        }),
      )

      // Mock fetch - only expect calls for repo-1
      const fetchMock = vi.spyOn(global, 'fetch')
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ type: 'dir', name: 'skill1' }],
      } as Response)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { type: 'file', name: 'SKILL.md', download_url: 'https://test.com' },
        ],
      } as Response)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => '# Skill 1',
      } as Response)

      const tools = createSkillsTools()
      const result = (await tools.syncSkills.execute!(
        { repoName: 'repo-1' },
        ctx,
      )) as {
        success: boolean
        synced?: number
      }

      expect(result.success).toBe(true)
      expect(result.synced).toBe(1)
    })
  })
})

describe('getSkillsToSync logic', () => {
  // Test the skill selection logic indirectly through listAvailableSkills

  it('mode "all" returns all available skills', async () => {
    const { createSkillsTools } = await importSkillsModule()

    const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, 'skills.json'),
      JSON.stringify({
        repositories: [
          {
            name: 'test',
            url: 'test/repo',
            branch: 'main',
            skillsPath: 'skills',
            enabled: true,
            mode: 'all',
            skills: [],
          },
        ],
      }),
    )

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { type: 'dir', name: 'a' },
        { type: 'dir', name: 'b' },
        { type: 'dir', name: 'c' },
      ],
    } as Response)

    const tools = createSkillsTools()
    const result = (await tools.listAvailableSkills.execute!({}, ctx)) as {
      selected?: string[]
    }

    expect(result.selected).toEqual(['a', 'b', 'c'])
  })

  it('mode "include" returns only listed skills that exist', async () => {
    const { createSkillsTools } = await importSkillsModule()

    const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, 'skills.json'),
      JSON.stringify({
        repositories: [
          {
            name: 'test',
            url: 'test/repo',
            branch: 'main',
            skillsPath: 'skills',
            enabled: true,
            mode: 'include',
            skills: ['a', 'c', 'nonexistent'],
          },
        ],
      }),
    )

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { type: 'dir', name: 'a' },
        { type: 'dir', name: 'b' },
        { type: 'dir', name: 'c' },
      ],
    } as Response)

    const tools = createSkillsTools()
    const result = (await tools.listAvailableSkills.execute!({}, ctx)) as {
      selected?: string[]
    }

    expect(result.selected).toEqual(['a', 'c']) // nonexistent filtered out
  })

  it('mode "exclude" returns skills not in the list', async () => {
    const { createSkillsTools } = await importSkillsModule()

    const configDir = path.join(fakeHome, '.moldable', 'shared', 'config')
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, 'skills.json'),
      JSON.stringify({
        repositories: [
          {
            name: 'test',
            url: 'test/repo',
            branch: 'main',
            skillsPath: 'skills',
            enabled: true,
            mode: 'exclude',
            skills: ['b'],
          },
        ],
      }),
    )

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { type: 'dir', name: 'a' },
        { type: 'dir', name: 'b' },
        { type: 'dir', name: 'c' },
      ],
    } as Response)

    const tools = createSkillsTools()
    const result = (await tools.listAvailableSkills.execute!({}, ctx)) as {
      selected?: string[]
    }

    expect(result.selected).toEqual(['a', 'c']) // b excluded
  })
})
