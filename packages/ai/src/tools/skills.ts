import { tool, zodSchema } from 'ai'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { z } from 'zod/v4'

const MOLDABLE_DIR = path.join(os.homedir(), '.moldable')
// Skills are shared across all workspaces
const CONFIG_PATH = path.join(MOLDABLE_DIR, 'shared', 'config', 'skills.json')
const SKILLS_DIR = path.join(MOLDABLE_DIR, 'shared', 'skills')

/**
 * Type definitions for skills configuration
 */
interface SkillRepo {
  name: string
  url: string
  branch: string
  skillsPath: string
  enabled: boolean
  mode: 'all' | 'include' | 'exclude'
  skills: string[]
  lastSync?: string
}

interface SkillsConfig {
  repositories: SkillRepo[]
}

/**
 * Default skills configuration with Anthropic skills repo.
 * Additional repos can be added via the addSkillRepo tool or by editing ~/.moldable/shared/config/skills.json
 */
const DEFAULT_CONFIG: SkillsConfig = {
  repositories: [
    {
      name: 'anthropic-skills',
      url: 'anthropics/skills',
      branch: 'main',
      skillsPath: 'skills',
      enabled: true,
      mode: 'include',
      skills: [
        'pdf',
        'docx',
        'xlsx',
        'pptx',
        'webapp-testing',
        'frontend-design',
        'mcp-builder',
        'skill-creator',
      ],
    },
  ],
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    // Directory exists
  }
}

async function loadConfig(): Promise<SkillsConfig | null> {
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function saveConfig(config: SkillsConfig): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATH))
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
}

async function fetchAvailableSkills(repo: SkillRepo): Promise<string[]> {
  const apiUrl = `https://api.github.com/repos/${repo.url}/contents/${repo.skillsPath}?ref=${repo.branch}`

  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }
    const contents = (await response.json()) as Array<{
      type: string
      name: string
    }>
    return contents
      .filter((item) => item.type === 'dir')
      .map((item) => item.name)
  } catch {
    return []
  }
}

async function downloadSkill(
  repo: SkillRepo,
  skillName: string,
  targetDir: string,
): Promise<boolean> {
  const skillDir = path.join(targetDir, skillName)
  await ensureDir(skillDir)

  const apiUrl = `https://api.github.com/repos/${repo.url}/contents/${repo.skillsPath}/${skillName}?ref=${repo.branch}`

  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }
    const contents = await response.json()

    await downloadContents(repo, contents, skillDir)
    return true
  } catch {
    return false
  }
}

async function downloadContents(
  _repo: SkillRepo,
  contents: Array<{
    type: string
    name: string
    download_url?: string
    url: string
  }>,
  targetDir: string,
): Promise<void> {
  for (const item of contents) {
    const targetPath = path.join(targetDir, item.name)

    if (item.type === 'file' && item.download_url) {
      const response = await fetch(item.download_url)
      if (response.ok) {
        const content = await response.text()
        await fs.writeFile(targetPath, content)
      }
    } else if (item.type === 'dir') {
      await ensureDir(targetPath)
      const dirResponse = await fetch(item.url)
      if (dirResponse.ok) {
        const dirContents = await dirResponse.json()
        await downloadContents(_repo, dirContents, targetPath)
      }
    }
  }
}

function getSkillsToSync(repo: SkillRepo, availableSkills: string[]): string[] {
  switch (repo.mode) {
    case 'all':
      return availableSkills
    case 'include':
      return repo.skills.filter((s) => availableSkills.includes(s))
    case 'exclude':
      return availableSkills.filter((s) => !repo.skills.includes(s))
    default:
      return []
  }
}

/**
 * Create skills management tools for the AI agent
 */
export function createSkillsTools() {
  const listSkillReposSchema = z.object({})

  const listAvailableSkillsSchema = z.object({
    repoName: z
      .string()
      .optional()
      .describe(
        'Name of a specific repository to list skills from. If not provided, lists from all repos.',
      ),
  })

  const syncSkillsSchema = z.object({
    repoName: z
      .string()
      .optional()
      .describe(
        'Name of a specific repository to sync. If not provided, syncs from all enabled repos.',
      ),
  })

  const addSkillRepoSchema = z.object({
    url: z
      .string()
      .describe(
        'GitHub repository URL in owner/repo format (e.g., "anthropics/skills")',
      ),
    name: z
      .string()
      .optional()
      .describe('Display name for the repository. Defaults to repo name.'),
    branch: z
      .string()
      .optional()
      .default('main')
      .describe('Branch to fetch skills from. Defaults to "main".'),
    skillsPath: z
      .string()
      .optional()
      .default('skills')
      .describe(
        'Path to the skills directory within the repo. Defaults to "skills".',
      ),
    mode: z
      .enum(['all', 'include', 'exclude'])
      .optional()
      .default('all')
      .describe(
        'Selection mode: "all" syncs all skills, "include" only syncs listed skills, "exclude" skips listed skills.',
      ),
    skills: z
      .array(z.string())
      .optional()
      .default([])
      .describe('List of skills to include or exclude based on mode.'),
  })

  const updateSkillSelectionSchema = z.object({
    repoName: z.string().describe('Name of the repository to update'),
    mode: z
      .enum(['all', 'include', 'exclude'])
      .optional()
      .describe('New selection mode'),
    skills: z
      .array(z.string())
      .optional()
      .describe('Updated list of skills to include/exclude'),
    enabled: z
      .boolean()
      .optional()
      .describe('Enable or disable the repository'),
  })

  return {
    listSkillRepos: tool({
      description:
        'List all registered skill repositories and their configuration. Use this to see what skill sources are available.',
      inputSchema: zodSchema(listSkillReposSchema),
      execute: async () => {
        const config = await loadConfig()

        if (!config) {
          return {
            success: false,
            error:
              'No skills config found. Initialize with addSkillRepo first.',
            repositories: [] as Array<{
              name: string
              url: string
              enabled: boolean
              mode: string
              skills: string[]
              lastSync?: string
            }>,
          }
        }

        return {
          success: true,
          repositories: config.repositories.map((r) => ({
            name: r.name,
            url: r.url,
            enabled: r.enabled,
            mode: r.mode,
            skills: r.skills,
            lastSync: r.lastSync,
          })),
        }
      },
    }),

    listAvailableSkills: tool({
      description:
        'Fetch and list all available skills from a skill repository. Shows which skills are selected for syncing.',
      inputSchema: zodSchema(listAvailableSkillsSchema),
      execute: async (input) => {
        const config = await loadConfig()

        if (!config) {
          return {
            success: false,
            error: 'No skills config found',
          }
        }

        const repo = input.repoName
          ? config.repositories.find((r) => r.name === input.repoName)
          : config.repositories[0]

        if (!repo) {
          return {
            success: false,
            error: input.repoName
              ? `Repository "${input.repoName}" not found`
              : 'No repositories configured',
          }
        }

        const available = await fetchAvailableSkills(repo)
        const selected = getSkillsToSync(repo, available)

        return {
          success: true,
          repoName: repo.name,
          available,
          selected,
          mode: repo.mode,
        }
      },
    }),

    syncSkills: tool({
      description:
        'Download and sync skills from registered repositories to the local filesystem. The agent can then read these skills to learn new capabilities.',
      inputSchema: zodSchema(syncSkillsSchema),
      execute: async (input) => {
        const config = await loadConfig()

        if (!config) {
          return {
            success: false,
            error: 'No skills config found',
          }
        }

        const repos = input.repoName
          ? config.repositories.filter(
              (r) => r.name === input.repoName && r.enabled,
            )
          : config.repositories.filter((r) => r.enabled)

        if (repos.length === 0) {
          return {
            success: false,
            error: input.repoName
              ? `Repository "${input.repoName}" not found or disabled`
              : 'No enabled repositories',
          }
        }

        let synced = 0
        let failed = 0
        const syncedSkills: string[] = []

        for (const repo of repos) {
          const available = await fetchAvailableSkills(repo)
          const toSync = getSkillsToSync(repo, available)

          const repoDir = path.join(
            SKILLS_DIR,
            repo.name.replace(/[^a-z0-9-]/gi, '-'),
          )
          await ensureDir(repoDir)

          for (const skill of toSync) {
            const success = await downloadSkill(repo, skill, repoDir)
            if (success) {
              synced++
              syncedSkills.push(skill)
            } else {
              failed++
            }
          }

          repo.lastSync = new Date().toISOString()
        }

        await saveConfig(config)

        return {
          success: true,
          synced,
          failed,
          skills: syncedSkills,
          skillsDir: SKILLS_DIR,
        }
      },
    }),

    addSkillRepo: tool({
      description:
        'Add a new skill repository. Skills repositories contain SKILL.md files that teach the agent new capabilities.',
      inputSchema: zodSchema(addSkillRepoSchema),
      execute: async (input) => {
        let config = await loadConfig()

        if (!config) {
          config = { repositories: [] }
        }

        // Check if repo already exists
        const existing = config.repositories.find((r) => r.url === input.url)
        if (existing) {
          return {
            success: false,
            error: `Repository "${input.url}" is already registered as "${existing.name}"`,
          }
        }

        const repoName = input.name || input.url.split('/').pop() || 'unknown'

        const newRepo: SkillRepo = {
          name: repoName,
          url: input.url,
          branch: input.branch || 'main',
          skillsPath: input.skillsPath || 'skills',
          enabled: true,
          mode: input.mode || 'all',
          skills: input.skills || [],
        }

        // Verify the repo has skills
        const available = await fetchAvailableSkills(newRepo)

        if (available.length === 0) {
          return {
            success: false,
            error: `No skills found in ${input.url} at path "${newRepo.skillsPath}"`,
          }
        }

        config.repositories.push(newRepo)
        await saveConfig(config)

        return {
          success: true,
          name: repoName,
          url: input.url,
          availableSkills: available,
        }
      },
    }),

    updateSkillSelection: tool({
      description:
        'Update skill selection settings for a repository. Change which skills are synced or enable/disable the repo.',
      inputSchema: zodSchema(updateSkillSelectionSchema),
      execute: async (input) => {
        const config = await loadConfig()

        if (!config) {
          return {
            success: false,
            error: 'No skills config found',
          }
        }

        const repo = config.repositories.find((r) => r.name === input.repoName)
        if (!repo) {
          return {
            success: false,
            error: `Repository "${input.repoName}" not found`,
          }
        }

        if (input.mode !== undefined) repo.mode = input.mode
        if (input.skills !== undefined) repo.skills = input.skills
        if (input.enabled !== undefined) repo.enabled = input.enabled

        await saveConfig(config)

        return {
          success: true,
          repoName: repo.name,
          mode: repo.mode,
          skills: repo.skills,
          enabled: repo.enabled,
        }
      },
    }),

    initSkillsConfig: tool({
      description:
        'Initialize the skills configuration with default repositories (Anthropic skills). Use this if no skills config exists.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const existing = await loadConfig()

        if (existing) {
          return {
            success: false,
            error:
              'Skills config already exists. Use listSkillRepos to view it.',
          }
        }

        await saveConfig(DEFAULT_CONFIG)

        return {
          success: true,
          message: 'Initialized with Anthropic skills repository',
          repositories: DEFAULT_CONFIG.repositories.map((r) => ({
            name: r.name,
            url: r.url,
            mode: r.mode,
            skills: r.skills,
          })),
        }
      },
    }),
  }
}

/**
 * Tool descriptions for UI display
 */
export const SKILLS_TOOL_DESCRIPTIONS = {
  listSkillRepos: 'List registered skill repositories',
  listAvailableSkills: 'Show available skills from repositories',
  syncSkills: 'Download skills to local filesystem',
  addSkillRepo: 'Add a new skill repository',
  updateSkillSelection: 'Update which skills are synced',
  initSkillsConfig: 'Initialize default skills configuration',
} as const
