#!/usr/bin/env node
/**
 * Build a stub audio capture sidecar for non-macOS platforms.
 *
 * The real audio capture binary is macOS-only (Swift, Audio Taps).
 * On Windows/Linux, we build a small stub so Tauri bundling succeeds.
 */
import { execSync } from 'child_process'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const STUB_DIR = join(ROOT, 'desktop/src-tauri/audio-capture-stub')
const STUB_ENTRY = join(STUB_DIR, 'src', 'index.ts')
const BINARIES_DIR = join(ROOT, 'desktop/src-tauri/binaries')
const DEBUG_DIR = join(ROOT, 'desktop/src-tauri/target/debug')

const platform = process.platform
const arch = process.arch

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

function getBunTarget() {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'bun-darwin-arm64' : 'bun-darwin-x64'
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'bun-linux-arm64' : 'bun-linux-x64'
  }
  if (platform === 'win32') {
    return 'bun-windows-x64'
  }
  throw new Error(`Unsupported platform: ${platform}`)
}

function main() {
  const targetTriple = getTargetTriple()
  const outputName =
    platform === 'win32'
      ? `moldable-audio-capture-${targetTriple}.exe`
      : `moldable-audio-capture-${targetTriple}`

  if (!existsSync(BINARIES_DIR)) {
    mkdirSync(BINARIES_DIR, { recursive: true })
  }

  const outputPath = join(BINARIES_DIR, outputName)

  if (platform === 'darwin') {
    if (existsSync(outputPath)) {
      console.log('✅ Audio capture sidecar already present for macOS')
      return
    }
    console.log('ℹ️  macOS audio capture is built from Swift sources.')
    console.log(`   Missing: ${outputPath}`)
    console.log('   Build it from desktop/src-tauri/audio-capture if needed.')
    return
  }

  if (!existsSync(STUB_ENTRY)) {
    throw new Error(`Stub entry not found: ${STUB_ENTRY}`)
  }

  const bunTarget = getBunTarget()
  const cmd = `bun build "${STUB_ENTRY}" --compile --target=${bunTarget} --outfile "${outputPath}"`

  console.log('🔨 Building audio capture stub...')
  console.log(`   Platform: ${platform} (${arch})`)
  console.log(`   Target: ${targetTriple}`)
  console.log(`   Bun target: ${bunTarget}`)
  console.log(`   Output: ${outputPath}`)

  execSync(cmd, { stdio: 'inherit' })

  if (platform !== 'win32') {
    execSync(`chmod +x "${outputPath}"`)
  }

  if (existsSync(DEBUG_DIR)) {
    const debugPath = join(
      DEBUG_DIR,
      platform === 'win32'
        ? 'moldable-audio-capture.exe'
        : 'moldable-audio-capture',
    )
    cpSync(outputPath, debugPath)
    if (platform !== 'win32') {
      execSync(`chmod +x "${debugPath}"`)
    }
    console.log(`✅ Copied to debug: ${debugPath}`)
  }
}

main()
