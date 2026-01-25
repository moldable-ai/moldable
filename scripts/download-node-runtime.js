#!/usr/bin/env node
/**
 * Download Node.js and pnpm for bundling with the Moldable desktop app.
 *
 * This script downloads:
 * 1. Node.js LTS binary for the target architecture
 * 2. pnpm (installed via npm into the Node directory)
 *
 * The result is placed in desktop/src-tauri/resources/node/
 * which Tauri bundles into the app's Resources folder.
 *
 * Usage:
 *   node scripts/download-node-runtime.js [--target <arch>]
 *
 * Options:
 *   --target    Target architecture: 'aarch64-apple-darwin' or 'x86_64-apple-darwin'
 *               Defaults to current system architecture.
 *   --clean     Remove existing runtime before downloading
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { delimiter, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')
const OUTPUT_DIR = join(ROOT_DIR, 'desktop/src-tauri/resources/node')
const IS_WINDOWS = process.platform === 'win32'

// Node.js LTS version to bundle
const NODE_VERSION = '22.22.0'

// pnpm version to install
const PNPM_VERSION = 'latest'

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    target: null,
    clean: false,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      options.target = args[++i]
    } else if (args[i] === '--clean') {
      options.clean = true
    }
  }

  return options
}

/**
 * Determine Node.js architecture from Rust target triple
 */
function getNodeArch(target) {
  if (!target) {
    // Use current system
    return process.arch === 'arm64' ? 'arm64' : 'x64'
  }

  if (target.includes('aarch64')) {
    return 'arm64'
  } else if (target.includes('x86_64')) {
    return 'x64'
  }

  throw new Error(`Unknown target architecture: ${target}`)
}

/**
 * Get Node.js download URL
 */
function getNodeDownloadUrl(version, arch) {
  if (process.platform === 'darwin') {
    return `https://nodejs.org/dist/v${version}/node-v${version}-darwin-${arch}.tar.gz`
  }
  if (process.platform === 'win32') {
    return `https://nodejs.org/dist/v${version}/node-v${version}-win-${arch}.zip`
  }
  return `https://nodejs.org/dist/v${version}/node-v${version}-linux-${arch}.tar.gz`
}

/**
 * Run a shell command with output
 */
function run(cmd, options = {}) {
  console.log(`  $ ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit', ...options })
  } catch (err) {
    throw new Error(`Command failed: ${cmd}`)
  }
}

/**
 * Run a shell command and return output
 */
function runOutput(cmd, options = {}) {
  return execSync(cmd, { encoding: 'utf8', ...options }).trim()
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs()
  const arch = getNodeArch(options.target)

  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║           Moldable Node.js Runtime Bundler                     ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log()
  console.log(`  Node.js version: v${NODE_VERSION}`)
  console.log(`  Architecture:    ${arch}`)
  console.log(`  Target:          ${options.target || 'current system'}`)
  console.log(`  Output:          ${OUTPUT_DIR}`)
  console.log()

  // Clean existing runtime if requested
  if (options.clean && existsSync(OUTPUT_DIR)) {
    console.log('→ Cleaning existing runtime...')
    rmSync(OUTPUT_DIR, { recursive: true, force: true })
  }

  // Check if already downloaded with correct version
  const binDir = IS_WINDOWS ? OUTPUT_DIR : join(OUTPUT_DIR, 'bin')
  const nodeBin = join(binDir, IS_WINDOWS ? 'node.exe' : 'node')
  const pnpmBin = join(binDir, IS_WINDOWS ? 'pnpm.cmd' : 'pnpm')

  if (existsSync(nodeBin) && existsSync(pnpmBin)) {
    console.log('→ Runtime already exists, checking version...')

    try {
      const currentVersion = runOutput(`"${nodeBin}" --version`)
      if (currentVersion === `v${NODE_VERSION}`) {
        console.log(`  ✓ Node.js ${currentVersion} is already installed`)
        const pnpmVersion = runOutput(`"${pnpmBin}" --version`, {
          env: {
            ...process.env,
            PATH: `${binDir}${delimiter}${process.env.PATH}`,
          },
        })
        console.log(`  ✓ pnpm ${pnpmVersion} is already installed`)
        console.log('\n✅ Runtime is up to date!')
        return
      }
      console.log(`  Current: ${currentVersion}, Required: v${NODE_VERSION}`)
      console.log('  Updating runtime...')
      rmSync(OUTPUT_DIR, { recursive: true, force: true })
    } catch (err) {
      console.log('  Existing runtime is corrupted, re-downloading...')
      rmSync(OUTPUT_DIR, { recursive: true, force: true })
    }
  }

  // Create output directory
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Download and extract Node.js using curl/tar (macOS/Linux) or PowerShell (Windows)
  console.log('→ Downloading Node.js...')
  const downloadUrl = getNodeDownloadUrl(NODE_VERSION, arch)
  const archivePath = join(OUTPUT_DIR, IS_WINDOWS ? 'node.zip' : 'node.tar.gz')

  if (IS_WINDOWS) {
    run(
      `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${archivePath}'"`,
    )
  } else {
    run(`curl -L -o "${archivePath}" "${downloadUrl}"`)
  }

  // Extract Node.js
  console.log('→ Extracting Node.js...')
  if (IS_WINDOWS) {
    run(
      `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${OUTPUT_DIR}' -Force"`,
    )
    const extractedDir = join(OUTPUT_DIR, `node-v${NODE_VERSION}-win-${arch}`)
    run(
      `powershell -NoProfile -Command "Copy-Item -Path '${extractedDir}\\\\*' -Destination '${OUTPUT_DIR}' -Recurse -Force"`,
    )
    rmSync(extractedDir, { recursive: true, force: true })
  } else {
    run(`tar -xzf "${archivePath}" -C "${OUTPUT_DIR}" --strip-components=1`)
  }

  // Clean up archive
  rmSync(archivePath, { force: true })

  // Install pnpm
  console.log('→ Installing pnpm...')
  const npmPath = join(binDir, IS_WINDOWS ? 'npm.cmd' : 'npm')
  const env = {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH}`,
    npm_config_prefix: OUTPUT_DIR,
  }

  run(`"${npmPath}" install -g pnpm@${PNPM_VERSION}`, { env })

  // Verify pnpm is installed
  if (!existsSync(pnpmBin)) {
    throw new Error('pnpm installation failed - binary not found')
  }

  // Fix pnpm launcher script - the symlinks break when Tauri bundles the app
  // because the symlink content is copied but relative paths become invalid.
  // Solution: Replace symlinks with shell script wrappers that resolve paths at runtime.
  if (!IS_WINDOWS) {
    console.log('→ Fixing pnpm launcher paths for bundling...')

    const { writeFileSync, chmodSync, unlinkSync, lstatSync } = await import(
      'fs'
    )

    // Remove symlink and create a shell script launcher
    const fixLauncher = (binPath, relativeModulePath) => {
      // Check if it's a symlink and remove it
      try {
        const stats = lstatSync(binPath)
        if (stats.isSymbolicLink()) {
          unlinkSync(binPath)
        }
      } catch {}

      // Use a shell script that resolves the path at runtime
      // This works because the shell can find the script's directory
      const launcher = `#!/bin/sh
# Moldable-patched launcher - resolves path at runtime for bundled app
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/node" "$SCRIPT_DIR/${relativeModulePath}" "$@"
`
      writeFileSync(binPath, launcher)
      chmodSync(binPath, 0o755)
    }

    fixLauncher(pnpmBin, '../lib/node_modules/pnpm/dist/pnpm.cjs')
    fixLauncher(
      join(OUTPUT_DIR, 'bin/pnpx'),
      '../lib/node_modules/pnpm/dist/pnpm.cjs',
    )
  }

  // Verify installation
  console.log('→ Verifying installation...')
  const nodeVersion = runOutput(`"${nodeBin}" --version`)
  const pnpmVersion = runOutput(`"${pnpmBin}" --version`, { env })

  console.log()
  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                    Installation Complete!                       ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log()
  console.log(`  ✓ Node.js ${nodeVersion}`)
  console.log(`  ✓ pnpm ${pnpmVersion}`)
  console.log(`  ✓ Location: ${OUTPUT_DIR}`)
  console.log()
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message)
  process.exit(1)
})
