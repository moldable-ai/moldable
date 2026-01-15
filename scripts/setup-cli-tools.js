#!/usr/bin/env node
/**
 * Setup script for optional CLI tools (ripgrep, fd) and default agent skills
 * - CLI tools make search operations much faster but are not required
 * - Agent skills provide capabilities like PDF processing, frontend design, etc.
 *
 * Run manually: pnpm setup:tools
 * Runs automatically: during postinstall
 */
import { exec, execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Skills configuration
const MOLDABLE_DIR = path.join(os.homedir(), '.moldable')
const SKILLS_CONFIG_PATH = path.join(MOLDABLE_DIR, 'config', 'skills.json')

const DEFAULT_SKILLS_CONFIG = {
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

const TOOLS = [
  {
    name: 'ripgrep',
    command: 'rg',
    brew: 'ripgrep',
    apt: 'ripgrep',
    description: 'Fast grep replacement for code search',
  },
  {
    name: 'fd',
    command: 'fd',
    brew: 'fd',
    apt: 'fd-find',
    description: 'Fast find replacement for file search',
  },
]

async function commandExists(cmd) {
  try {
    await execAsync(`which ${cmd}`)
    return true
  } catch {
    return false
  }
}

function getPackageManager() {
  const platform = process.platform

  if (platform === 'darwin') {
    // macOS - check for Homebrew
    try {
      execSync('which brew', { stdio: 'ignore' })
      return 'brew'
    } catch {
      return null
    }
  }

  if (platform === 'linux') {
    // Linux - check for apt
    try {
      execSync('which apt', { stdio: 'ignore' })
      return 'apt'
    } catch {
      return null
    }
  }

  return null
}

async function installTool(tool, packageManager) {
  const pkg = packageManager === 'brew' ? tool.brew : tool.apt

  console.log(`  Installing ${tool.name} via ${packageManager}...`)

  try {
    if (packageManager === 'brew') {
      await execAsync(`brew install ${pkg}`)
    } else if (packageManager === 'apt') {
      // apt requires sudo - we'll try without and let it fail gracefully
      await execAsync(`sudo apt install -y ${pkg}`)
    }
    return true
  } catch (error) {
    console.log(`  ⚠️  Could not install ${tool.name}: ${error.message}`)
    return false
  }
}

/**
 * Initialize default skills configuration if it doesn't exist
 */
async function setupSkillsConfig() {
  console.log('📚 Agent Skills Setup\n')

  // Check if config already exists
  if (fs.existsSync(SKILLS_CONFIG_PATH)) {
    console.log('✓ Skills config already exists')
    return { created: false }
  }

  // Create config directory if needed
  const configDir = path.dirname(SKILLS_CONFIG_PATH)
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  // Write default config
  fs.writeFileSync(
    SKILLS_CONFIG_PATH,
    JSON.stringify(DEFAULT_SKILLS_CONFIG, null, 2),
  )

  console.log('✓ Created default skills config')
  console.log('  Registered repositories:')
  for (const repo of DEFAULT_SKILLS_CONFIG.repositories) {
    console.log(`    • ${repo.name} (${repo.url})`)
    console.log(`      Skills: ${repo.skills.join(', ')}`)
  }
  console.log('')
  console.log('  Run "pnpm sync:skills" to download skills')

  return { created: true }
}

async function main() {
  console.log('\n🔧 Moldable Setup\n')
  console.log('─'.repeat(40) + '\n')

  // 1. Setup CLI tools
  console.log('🛠️  CLI Tools Setup\n')

  const packageManager = getPackageManager()

  if (!packageManager) {
    console.log('ℹ️  No supported package manager found (brew or apt)')
    console.log('   Search tools will use built-in grep/find fallbacks.')
    console.log('   For better performance, manually install ripgrep and fd.\n')
  } else {
    console.log(`📦 Using ${packageManager} package manager\n`)

    let installed = 0
    let skipped = 0
    let failed = 0

    for (const tool of TOOLS) {
      const exists = await commandExists(tool.command)

      if (exists) {
        console.log(`✓ ${tool.name} already installed`)
        skipped++
      } else {
        console.log(`○ ${tool.name} not found - ${tool.description}`)
        const success = await installTool(tool, packageManager)
        if (success) {
          console.log(`  ✓ ${tool.name} installed successfully`)
          installed++
        } else {
          failed++
        }
      }
    }

    console.log('')
    if (skipped > 0) console.log(`✓ ${skipped} CLI tools already installed`)
    if (installed > 0) console.log(`✓ ${installed} CLI tools newly installed`)
    if (failed > 0) {
      console.log(
        `⚠️  ${failed} CLI tools could not be installed (will use fallbacks)`,
      )
    }
  }

  console.log('\n' + '─'.repeat(40) + '\n')

  // 2. Setup skills config
  try {
    await setupSkillsConfig()
  } catch (error) {
    console.log(`⚠️  Could not setup skills config: ${error.message}`)
  }

  console.log('\n' + '─'.repeat(40))
  console.log('✓ Moldable setup complete\n')

  // Exit successfully even if some things couldn't be set up
  process.exit(0)
}

main().catch((error) => {
  console.error('Setup error:', error.message)
  process.exit(0) // Don't fail the install
})
