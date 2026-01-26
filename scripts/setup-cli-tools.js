#!/usr/bin/env node
/**
 * Setup script for optional CLI tools (ripgrep, fd)
 * - CLI tools make search operations much faster but are not required
 *
 * Run manually: pnpm setup:tools
 * Runs automatically: during postinstall
 */
import { exec, execSync } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
    const resolver = process.platform === 'win32' ? 'where' : 'which'
    await execAsync(`${resolver} ${cmd}`)
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

  if (platform === 'win32') {
    try {
      execSync('where winget', { stdio: 'ignore' })
      return 'winget'
    } catch {}

    try {
      execSync('where choco', { stdio: 'ignore' })
      return 'choco'
    } catch {}
  }

  return null
}

async function installTool(tool, packageManager) {
  const pkg =
    packageManager === 'brew'
      ? tool.brew
      : packageManager === 'apt'
        ? tool.apt
        : tool.name

  console.log(`  Installing ${tool.name} via ${packageManager}...`)

  try {
    if (packageManager === 'brew') {
      await execAsync(`brew install ${pkg}`)
    } else if (packageManager === 'apt') {
      // apt requires sudo - we'll try without and let it fail gracefully
      await execAsync(`sudo apt install -y ${pkg}`)
    } else if (packageManager === 'winget') {
      const wingetId =
        tool.name === 'ripgrep' ? 'BurntSushi.ripgrep' : 'sharkdp.fd'
      await execAsync(`winget install --id ${wingetId} -e`)
    } else if (packageManager === 'choco') {
      await execAsync(`choco install -y ${pkg}`)
    }
    return true
  } catch (error) {
    console.log(`  ⚠️  Could not install ${tool.name}: ${error.message}`)
    return false
  }
}

async function main() {
  if (
    process.env.MOLDABLE_SKIP_CLI_SETUP === '1' ||
    process.env.MOLDABLE_SKIP_CLI_SETUP === 'true'
  ) {
    console.log('ℹ️  Skipping CLI tools setup (MOLDABLE_SKIP_CLI_SETUP)')
    process.exit(0)
  }

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

  console.log('\n' + '─'.repeat(40))
  console.log('✓ Moldable setup complete\n')

  // Exit successfully even if some things couldn't be set up
  process.exit(0)
}

main().catch((error) => {
  console.error('Setup error:', error.message)
  process.exit(0) // Don't fail the install
})
