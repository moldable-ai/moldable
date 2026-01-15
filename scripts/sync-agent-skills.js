#!/usr/bin/env node
/**
 * Sync Skills from registered repositories
 *
 * Skills are instruction-based capabilities that teach the AI agent how to perform tasks.
 * They follow the Agent Skills spec: https://agentskills.io/specification.md
 *
 * Configuration: ~/.moldable/shared/config/skills.json
 * Output: ~/.moldable/shared/skills/<repo-name>/<skill-name>/
 *
 * Usage:
 *   pnpm sync:skills              # Sync all enabled skills
 *   pnpm sync:skills --list       # List available skills from all repos
 *   pnpm sync:skills --init       # Initialize config with Anthropic skills
 */
import fs from 'fs'
import path from 'path'

const MOLDABLE_DIR = path.join(process.env.HOME, '.moldable')
// Skills config is shared across all workspaces
const CONFIG_PATH = path.join(MOLDABLE_DIR, 'shared', 'config', 'skills.json')
const SKILLS_DIR = path.join(MOLDABLE_DIR, 'shared', 'skills')

/**
 * @typedef {Object} SkillRepo
 * @property {string} name - Display name for the repo
 * @property {string} url - GitHub repo URL (owner/repo format)
 * @property {string} branch - Branch to fetch from
 * @property {string} skillsPath - Path to skills directory within the repo
 * @property {boolean} enabled - Whether this repo is enabled
 * @property {'all' | 'include' | 'exclude'} mode - Selection mode
 * @property {string[]} skills - List of skills to include/exclude based on mode
 * @property {string} [lastSync] - ISO timestamp of last sync
 */

/**
 * @typedef {Object} SkillsConfig
 * @property {SkillRepo[]} repositories
 */

/**
 * Default skills configuration with Anthropic skills repo.
 * Additional repos can be added by editing ~/.moldable/shared/config/skills.json
 * @type {SkillsConfig}
 */
const DEFAULT_CONFIG = {
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
}

function saveConfig(config) {
  ensureDir(path.dirname(CONFIG_PATH))
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

/**
 * Fetch the list of skills available in a repository
 */
async function fetchAvailableSkills(repo) {
  const apiUrl = `https://api.github.com/repos/${repo.url}/contents/${repo.skillsPath}?ref=${repo.branch}`

  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }
    const contents = await response.json()
    return contents
      .filter((item) => item.type === 'dir')
      .map((item) => item.name)
  } catch (error) {
    console.error(
      `  ⚠️  Failed to fetch skills from ${repo.name}: ${error.message}`,
    )
    return []
  }
}

/**
 * Download a skill from a repository using GitHub's raw content
 */
async function downloadSkill(repo, skillName, targetDir) {
  const skillDir = path.join(targetDir, skillName)
  ensureDir(skillDir)

  // Fetch the skill directory contents
  const apiUrl = `https://api.github.com/repos/${repo.url}/contents/${repo.skillsPath}/${skillName}?ref=${repo.branch}`

  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }
    const contents = await response.json()

    // Download each file/directory
    await downloadContents(repo, contents, skillDir)

    return true
  } catch (error) {
    console.error(`  ⚠️  Failed to download ${skillName}: ${error.message}`)
    return false
  }
}

/**
 * Recursively download directory contents
 */
async function downloadContents(repo, contents, targetDir) {
  for (const item of contents) {
    const targetPath = path.join(targetDir, item.name)

    if (item.type === 'file') {
      // Download file
      const response = await fetch(item.download_url)
      if (response.ok) {
        const content = await response.text()
        fs.writeFileSync(targetPath, content)
      }
    } else if (item.type === 'dir') {
      // Recursively download directory
      ensureDir(targetPath)
      const dirResponse = await fetch(item.url)
      if (dirResponse.ok) {
        const dirContents = await dirResponse.json()
        await downloadContents(repo, dirContents, targetPath)
      }
    }
  }
}

/**
 * Get the list of skills to sync based on repo configuration
 */
async function getSkillsToSync(repo, availableSkills) {
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
 * List all available skills from all repositories
 */
async function listSkills(config) {
  console.log('\n📚 Available Agent Skills\n')

  for (const repo of config.repositories) {
    console.log(`${repo.enabled ? '✓' : '○'} ${repo.name} (${repo.url})`)
    console.log(`  Branch: ${repo.branch}, Path: ${repo.skillsPath}`)
    console.log(
      `  Mode: ${repo.mode}${repo.mode !== 'all' ? ` [${repo.skills.join(', ')}]` : ''}`,
    )

    const skills = await fetchAvailableSkills(repo)
    if (skills.length > 0) {
      console.log(`  Available skills (${skills.length}):`)
      for (const skill of skills) {
        const included =
          repo.mode === 'all' ||
          (repo.mode === 'include' && repo.skills.includes(skill)) ||
          (repo.mode === 'exclude' && !repo.skills.includes(skill))
        console.log(`    ${included ? '✓' : '○'} ${skill}`)
      }
    }
    console.log('')
  }
}

/**
 * Sync skills from all enabled repositories
 */
async function syncSkills(config) {
  console.log('\n🔄 Syncing Agent Skills\n')

  let totalSynced = 0
  let totalFailed = 0

  for (const repo of config.repositories) {
    if (!repo.enabled) {
      console.log(`○ Skipping ${repo.name} (disabled)`)
      continue
    }

    console.log(`📦 ${repo.name}`)

    const availableSkills = await fetchAvailableSkills(repo)
    if (availableSkills.length === 0) {
      continue
    }

    const skillsToSync = await getSkillsToSync(repo, availableSkills)
    console.log(`  Syncing ${skillsToSync.length} skills...`)

    const repoDir = path.join(
      SKILLS_DIR,
      repo.name.replace(/[^a-z0-9-]/gi, '-'),
    )
    ensureDir(repoDir)

    for (const skill of skillsToSync) {
      process.stdout.write(`  • ${skill}... `)
      const success = await downloadSkill(repo, skill, repoDir)
      if (success) {
        console.log('✓')
        totalSynced++
      } else {
        console.log('✗')
        totalFailed++
      }
    }

    // Update last sync time
    repo.lastSync = new Date().toISOString()
    console.log('')
  }

  // Save updated config with sync timestamps
  saveConfig(config)

  console.log('─'.repeat(40))
  console.log(`✓ ${totalSynced} skills synced`)
  if (totalFailed > 0) {
    console.log(`⚠️  ${totalFailed} skills failed`)
  }
  console.log(`\nSkills directory: ${SKILLS_DIR}`)
  console.log('')
}

/**
 * Initialize default configuration
 */
function initConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`\n⚠️  Config already exists at ${CONFIG_PATH}`)
    console.log('   Edit it manually or delete it to reinitialize.\n')
    return
  }

  saveConfig(DEFAULT_CONFIG)
  console.log(`\n✓ Created skills config at ${CONFIG_PATH}`)
  console.log('\nDefault configuration includes Anthropic skills repo with:')
  DEFAULT_CONFIG.repositories[0].skills.forEach((s) => console.log(`  • ${s}`))
  console.log('\nEdit the config to:')
  console.log('  • Add more repositories')
  console.log('  • Change which skills are enabled')
  console.log('  • Set mode to "all" to sync all skills from a repo')
  console.log('\nThen run: pnpm sync:skills\n')
}

/**
 * Generate the skills prompt XML for injection into agent context
 */
function generateSkillsPrompt() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('\n⚠️  No skills synced yet. Run: pnpm sync:skills\n')
    return
  }

  const repos = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  console.log('<available_skills>')

  for (const repo of repos) {
    const repoPath = path.join(SKILLS_DIR, repo.name)
    const skills = fs
      .readdirSync(repoPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())

    for (const skill of skills) {
      const skillPath = path.join(repoPath, skill.name)
      const skillMdPath = path.join(skillPath, 'SKILL.md')

      if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const frontmatter = extractFrontmatter(content)

        console.log('  <skill>')
        console.log(`    <name>${frontmatter.name || skill.name}</name>`)
        console.log(
          `    <description>${frontmatter.description || 'No description'}</description>`,
        )
        console.log(`    <location>${skillMdPath}</location>`)
        console.log('  </skill>')
      }
    }
  }

  console.log('</available_skills>')
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const frontmatter = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':')
    if (key && valueParts.length > 0) {
      frontmatter[key.trim()] = valueParts.join(':').trim()
    }
  }
  return frontmatter
}

// Main
async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--init')) {
    initConfig()
    return
  }

  if (args.includes('--prompt')) {
    generateSkillsPrompt()
    return
  }

  const config = loadConfig()

  if (!config) {
    console.log('\n⚠️  No skills config found.')
    console.log('   Run: pnpm sync:skills --init\n')
    return
  }

  if (args.includes('--list')) {
    await listSkills(config)
    return
  }

  await syncSkills(config)
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
