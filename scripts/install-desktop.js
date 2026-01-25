#!/usr/bin/env node
import { execSync } from 'child_process'
import { platform } from 'os'

const os = platform()

if (os !== 'darwin') {
  console.log('build:desktop:install is only supported on macOS.')
  process.exit(0)
}

execSync('pnpm build:desktop', { stdio: 'inherit' })
execSync(
  'rm -rf /Applications/Moldable.app && ditto desktop/src-tauri/target/release/bundle/macos/Moldable.app /Applications/Moldable.app',
  { stdio: 'inherit' },
)
