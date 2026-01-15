#!/usr/bin/env node
/**
 * Build the AI server as a standalone binary for Tauri sidecar
 */
import { execSync } from 'child_process'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const AI_SERVER_DIR = join(ROOT, 'packages/ai-server')
const BINARIES_DIR = join(ROOT, 'desktop/src-tauri/binaries')
const DEBUG_DIR = join(ROOT, 'desktop/src-tauri/target/debug')

// Detect current platform
const platform = process.platform
const arch = process.arch

function getTargetTriple() {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  } else if (platform === 'linux') {
    return arch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu'
  } else if (platform === 'win32') {
    return 'x86_64-pc-windows-msvc'
  }
  throw new Error(`Unsupported platform: ${platform}`)
}

function getBunTarget() {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'bun-darwin-arm64' : 'bun-darwin-x64'
  } else if (platform === 'linux') {
    return arch === 'arm64' ? 'bun-linux-arm64' : 'bun-linux-x64'
  } else if (platform === 'win32') {
    return 'bun-windows-x64'
  }
  throw new Error(`Unsupported platform: ${platform}`)
}

async function main() {
  console.log('🔨 Building AI server binary...')
  console.log(`   Platform: ${platform} (${arch})`)

  const targetTriple = getTargetTriple()
  const bunTarget = getBunTarget()
  const outputName = `moldable-ai-server-${targetTriple}`

  console.log(`   Target: ${targetTriple}`)
  console.log(`   Bun target: ${bunTarget}`)

  // Ensure binaries directory exists
  if (!existsSync(BINARIES_DIR)) {
    mkdirSync(BINARIES_DIR, { recursive: true })
  }

  // Build the binary with Bun
  const outputPath = join(BINARIES_DIR, outputName)
  const cmd = `bun build src/index.ts --compile --target=${bunTarget} --outfile "${outputPath}"`

  console.log(`   Command: ${cmd}`)
  console.log('')

  try {
    execSync(cmd, {
      cwd: AI_SERVER_DIR,
      stdio: 'inherit',
    })

    console.log('')
    console.log(`✅ Built: ${outputPath}`)

    // Make executable
    if (platform !== 'win32') {
      execSync(`chmod +x "${outputPath}"`)
    }

    // Also copy to debug directory for dev mode (pnpm desktop / tauri dev)
    if (existsSync(DEBUG_DIR)) {
      const debugPath = join(DEBUG_DIR, 'moldable-ai-server')
      cpSync(outputPath, debugPath)
      if (platform !== 'win32') {
        execSync(`chmod +x "${debugPath}"`)
      }
      console.log(`✅ Copied to debug: ${debugPath}`)
    }
  } catch (error) {
    console.error('❌ Build failed:', error.message)
    process.exit(1)
  }
}

main()
