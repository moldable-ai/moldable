#!/usr/bin/env node
/**
 * Stash/restore script for testing Moldable fresh installs
 *
 * Commands:
 *   pnpm data:stash              - Move ~/.moldable to ~/.moldable-bak (simulate fresh install)
 *   pnpm data:restore            - Copy ~/.moldable-bak back to ~/.moldable (keeps backup)
 *   pnpm data:restore -- --force - Same, but overwrites existing ~/.moldable if it exists
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

const MOLDABLE_DIR = path.join(os.homedir(), '.moldable')
const BACKUP_DIR = path.join(os.homedir(), '.moldable-bak')

function dirExists(dir) {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory()
}

function getStatus() {
  const moldableExists = dirExists(MOLDABLE_DIR)
  const backupExists = dirExists(BACKUP_DIR)

  return { moldableExists, backupExists }
}

function printStatus() {
  const { moldableExists, backupExists } = getStatus()

  console.log('\n📁 Directory Status\n')
  console.log(
    `  ~/.moldable     ${moldableExists ? '✓ exists' : '✗ does not exist'}`,
  )
  console.log(
    `  ~/.moldable-bak ${backupExists ? '✓ exists' : '✗ does not exist'}`,
  )
  console.log('')

  if (moldableExists && !backupExists) {
    console.log('  State: Normal (your data is in ~/.moldable)')
    console.log('  Action: Run "pnpm data:stash" to test fresh install')
  } else if (!moldableExists && backupExists) {
    console.log('  State: Testing fresh install (data stashed)')
    console.log('  Action: Run "pnpm data:restore" to restore your data')
  } else if (moldableExists && backupExists) {
    console.log('  ⚠️  State: Both directories exist!')
    console.log('  You may have existing data in both locations.')
    console.log(
      '  Action: Run "pnpm data:restore -- --force" to overwrite with backup',
    )
  } else {
    console.log('  State: No Moldable data found')
    console.log('  Both directories are empty - ready for fresh install.')
  }
  console.log('')
}

function stash() {
  console.log('\n🔄 Stashing Moldable data...\n')

  const { moldableExists, backupExists } = getStatus()

  if (!moldableExists) {
    console.log('  ✗ Nothing to stash - ~/.moldable does not exist')
    process.exit(1)
  }

  if (backupExists) {
    console.log('  ✗ Cannot stash - ~/.moldable-bak already exists!')
    console.log('  This might be from a previous stash.')
    console.log('  Please remove or rename it first to avoid data loss.')
    process.exit(1)
  }

  try {
    fs.renameSync(MOLDABLE_DIR, BACKUP_DIR)
    console.log('  ✓ Moved ~/.moldable → ~/.moldable-bak')
    console.log('')
    console.log('  You can now test a fresh Moldable install.')
    console.log('  Run "pnpm data:restore" when done to restore your data.')
    console.log('')
  } catch (error) {
    console.log(`  ✗ Failed to move directory: ${error.message}`)
    process.exit(1)
  }
}

function restore(force = false) {
  console.log('\n🔄 Restoring Moldable data...\n')

  const { moldableExists, backupExists } = getStatus()

  if (!backupExists) {
    console.log('  ✗ Nothing to restore - ~/.moldable-bak does not exist')
    process.exit(1)
  }

  if (moldableExists && !force) {
    console.log('  ✗ Cannot restore - ~/.moldable already exists!')
    console.log('  This might contain data from your fresh install test.')
    console.log('  Please remove or rename it first to avoid data loss.')
    console.log('  Or use --force to overwrite: pnpm data:restore -- --force')
    process.exit(1)
  }

  try {
    if (moldableExists && force) {
      console.log('  ⚠️  Force mode: replacing ~/.moldable with backup...')
      fs.rmSync(MOLDABLE_DIR, { recursive: true, force: true })
      console.log('  ✓ Removed existing ~/.moldable')
    }

    // Copy backup to moldable (keeps backup in case something goes wrong)
    console.log(
      '  ⏳ Copying ~/.moldable-bak → ~/.moldable (this may take a while)...',
    )
    fs.cpSync(BACKUP_DIR, MOLDABLE_DIR, { recursive: true, force: true })
    console.log('  ✓ Copied ~/.moldable-bak → ~/.moldable')
    console.log('')
    console.log('  Your original Moldable data has been restored.')
    console.log('  Backup kept at ~/.moldable-bak (remove manually when ready)')
    console.log('')
  } catch (error) {
    console.log(`  ✗ Failed to restore: ${error.message}`)
    process.exit(1)
  }
}

function main() {
  const command = process.argv[2]
  const args = process.argv.slice(3)
  const force = args.includes('--force') || args.includes('-f')

  console.log('─'.repeat(50))

  switch (command) {
    case 'stash':
      stash()
      break
    case 'restore':
      restore(force)
      break
    case 'status':
      printStatus()
      break
    default:
      console.log('\n📦 Moldable Data Stash Tool\n')
      console.log('Commands:')
      console.log(
        '  pnpm data:stash              Move ~/.moldable → ~/.moldable-bak',
      )
      console.log(
        '  pnpm data:restore            Copy ~/.moldable-bak → ~/.moldable (keeps backup)',
      )
      console.log(
        '  pnpm data:restore -- --force Same, but overwrites existing ~/.moldable',
      )
      console.log('')
      printStatus()
      process.exit(command ? 1 : 0)
  }

  console.log('─'.repeat(50))
}

main()
