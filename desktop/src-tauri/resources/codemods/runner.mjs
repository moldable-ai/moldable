#!/usr/bin/env node
/**
 * Moldable Codemods Runner
 *
 * Discovers and runs codemods on app directories.
 * Each codemod is a separate file (e.g., 001-fix-something.mjs)
 *
 * Usage:
 *   node runner.mjs <app-dir>
 *   node runner.mjs --all <app-dir>
 *   node runner.mjs --dry <app-dir>
 *
 * Output:
 *   JSON on last line: { "applied": [...], "skipped": [...], "errors": [...] }
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MIGRATION_STATE_FILE = '.moldable.migrations.json'

function readMigrationState(appDir) {
  const path = join(appDir, MIGRATION_STATE_FILE)
  if (!existsSync(path)) {
    return { version: 0, applied: [] }
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { version: 0, applied: [] }
  }
}

function writeMigrationState(appDir, state) {
  const path = join(appDir, MIGRATION_STATE_FILE)
  writeFileSync(path, JSON.stringify(state, null, 2))
}

function isApplied(state, codemodId) {
  return state.applied.some((m) => m.id === codemodId)
}

function markApplied(appDir, codemodId) {
  const state = readMigrationState(appDir)
  if (!isApplied(state, codemodId)) {
    state.applied.push({
      id: codemodId,
      appliedAt: new Date().toISOString(),
    })
    state.version = Math.max(
      state.version,
      parseInt(codemodId.split('-')[0]) || 0,
    )
    writeMigrationState(appDir, state)
  }
}

async function discoverCodemods() {
  const codemods = []
  const files = readdirSync(__dirname)
    .filter((f) => f.match(/^\d{3}-.*\.mjs$/) && f !== 'runner.mjs')
    .sort()

  for (const file of files) {
    try {
      const mod = await import(join(__dirname, file))
      codemods.push({
        file,
        id: mod.id,
        description: mod.description,
        files: mod.files,
        shouldTransform: mod.shouldTransform,
        transform: mod.transform,
      })
    } catch (err) {
      console.error(`Failed to load codemod ${file}:`, err.message)
    }
  }

  return codemods
}

async function runCodemods(appDir, options = {}) {
  const { dry = false, force = false, verbose = false } = options
  const applied = []
  const skipped = []
  const errors = []

  const state = readMigrationState(appDir)
  const codemods = await discoverCodemods()

  for (const codemod of codemods) {
    // Skip if already applied (unless force)
    if (!force && isApplied(state, codemod.id)) {
      if (verbose) {
        console.error(`[skip] ${codemod.id}: already applied`)
      }
      skipped.push(codemod.id)
      continue
    }

    let anyTransformed = false

    for (const filePattern of codemod.files) {
      const filePath = join(appDir, filePattern)

      if (!existsSync(filePath)) {
        if (verbose) {
          console.error(`[skip] ${codemod.id}: file not found: ${filePattern}`)
        }
        continue
      }

      try {
        const content = readFileSync(filePath, 'utf-8')

        if (!codemod.shouldTransform(content)) {
          if (verbose) {
            console.error(
              `[skip] ${codemod.id}: transform not needed for ${filePattern}`,
            )
          }
          continue
        }

        const transformed = codemod.transform(content)

        if (transformed !== content) {
          if (!dry) {
            writeFileSync(filePath, transformed)
          }
          anyTransformed = true
          if (verbose) {
            console.error(`[transform] ${codemod.id}: ${filePattern}`)
          }
        }
      } catch (err) {
        errors.push(`${codemod.id}: ${err.message}`)
        console.error(`[error] ${codemod.id}: ${err.message}`)
      }
    }

    if (anyTransformed) {
      applied.push(codemod.id)
      if (!dry) {
        markApplied(appDir, codemod.id)
      }
    } else if (errors.length === 0) {
      // Mark as applied even if no changes needed (prevents future checks)
      skipped.push(codemod.id)
      if (!dry) {
        markApplied(appDir, codemod.id)
      }
    }
  }

  return { applied, skipped, errors }
}

// CLI
async function main() {
  const args = process.argv.slice(2)

  const options = {
    dry: args.includes('--dry'),
    force: args.includes('--force'),
    verbose: args.includes('--verbose'),
  }

  const appDir = args.find((a) => !a.startsWith('--'))

  if (!appDir) {
    console.error(
      'Usage: node runner.mjs [--dry] [--force] [--verbose] <app-dir>',
    )
    process.exit(1)
  }

  if (!existsSync(appDir)) {
    console.error(`Directory not found: ${appDir}`)
    process.exit(1)
  }

  const result = await runCodemods(appDir, options)

  // Output JSON result on last line for Rust to parse
  console.log(JSON.stringify(result))
}

main().catch((err) => {
  console.error('Fatal error:', err)
  console.log(
    JSON.stringify({ applied: [], skipped: [], errors: [err.message] }),
  )
  process.exit(1)
})
