#!/usr/bin/env node
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { platform } from 'os'
import { homedir } from 'os'
import { join } from 'path'

const os = platform()

if (os !== 'darwin') {
  console.log('build:desktop:install is only supported on macOS.')
  process.exit(0)
}

// Local-only convenience: if the standard Tauri key location exists and the
// signing key env vars are missing, populate them for this build.
const tauriKeyDir = join(homedir(), '.tauri')
const privateKeyPath = join(tauriKeyDir, 'moldable.key')

if (!process.env.TAURI_SIGNING_PRIVATE_KEY && existsSync(privateKeyPath)) {
  process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(privateKeyPath, 'utf8')
  console.log(
    `Using local Tauri signing key from ${privateKeyPath} for this build.`,
  )
}

execSync('pnpm build:desktop', { stdio: 'inherit', env: process.env })
execSync(
  'rm -rf /Applications/Moldable.app && ditto desktop/src-tauri/target/release/bundle/macos/Moldable.app /Applications/Moldable.app',
  { stdio: 'inherit' },
)
