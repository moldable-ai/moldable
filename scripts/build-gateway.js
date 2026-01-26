#!/usr/bin/env node
/**
 * Build the Moldable Gateway binary for Tauri sidecar.
 * - Uses local moldable-gateway repo (default: ~/moldable-gateway or MOLDABLE_GATEWAY_DIR)
 * - Dev: copies to desktop/src-tauri/target/debug/moldable-gateway
 * - Release: copies to desktop/src-tauri/binaries/moldable-gateway-<target>
 */
import { execSync } from 'child_process'
import { chmodSync, cpSync, existsSync, mkdirSync } from 'fs'
import os from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const GATEWAY_DIR =
  process.env.MOLDABLE_GATEWAY_DIR || join(os.homedir(), 'moldable-gateway')
const BINARIES_DIR = join(ROOT, 'desktop/src-tauri/binaries')
const DEBUG_DIR = join(ROOT, 'desktop/src-tauri/target/debug')

const platform = process.platform
const arch = process.arch

const args = process.argv.slice(2)
const release =
  args.includes('--release') ||
  process.env.MOLDABLE_GATEWAY_PROFILE === 'release'
const targetArgIndex = args.indexOf('--target')
const targetTriple =
  targetArgIndex >= 0 ? args[targetArgIndex + 1] : getTargetTriple()
if (targetArgIndex >= 0 && !targetTriple) {
  throw new Error('Missing value for --target')
}

function getTargetTriple() {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  }
  if (platform === 'linux') {
    return arch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu'
  }
  if (platform === 'win32') {
    return 'x86_64-pc-windows-msvc'
  }
  throw new Error(`Unsupported platform: ${platform}`)
}

async function main() {
  if (!existsSync(GATEWAY_DIR)) {
    console.log(`ℹ️  moldable-gateway repo not found at ${GATEWAY_DIR}`)
    console.log('   Set MOLDABLE_GATEWAY_DIR to override. Skipping.')
    return
  }

  console.log('🔨 Building Moldable Gateway binary...')
  console.log(`   Repo: ${GATEWAY_DIR}`)
  console.log(`   Profile: ${release ? 'release' : 'debug'}`)

  const cargoArgs = ['build']
  if (release) cargoArgs.push('--release')
  if (targetArgIndex >= 0) {
    cargoArgs.push('--target', targetTriple)
  }

  execSync(`cargo ${cargoArgs.join(' ')}`, {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
  })

  const builtName = platform === 'win32' ? 'moldable.exe' : 'moldable'
  const builtPath = join(
    GATEWAY_DIR,
    'target',
    targetArgIndex >= 0 ? targetTriple : '',
    release ? 'release' : 'debug',
    builtName,
  )

  if (!existsSync(builtPath)) {
    throw new Error(`Gateway build artifact not found at ${builtPath}`)
  }

  if (!existsSync(BINARIES_DIR)) {
    mkdirSync(BINARIES_DIR, { recursive: true })
  }
  const outputName =
    platform === 'win32'
      ? `moldable-gateway-${targetTriple}.exe`
      : `moldable-gateway-${targetTriple}`
  const outputPath = join(BINARIES_DIR, outputName)
  cpSync(builtPath, outputPath)
  if (platform !== 'win32') {
    chmodSync(outputPath, 0o755)
  }
  console.log(`✅ Copied to binaries: ${outputPath}`)

  if (!existsSync(DEBUG_DIR)) {
    mkdirSync(DEBUG_DIR, { recursive: true })
  }
  const debugName =
    platform === 'win32' ? 'moldable-gateway.exe' : 'moldable-gateway'
  const debugPath = join(DEBUG_DIR, debugName)
  cpSync(builtPath, debugPath)
  if (platform !== 'win32') {
    chmodSync(debugPath, 0o755)
  }
  console.log(`✅ Copied to debug: ${debugPath}`)
}

main().catch((error) => {
  console.error('❌ Gateway build failed:', error.message)
  process.exit(1)
})
