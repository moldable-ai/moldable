/**
 * Codemod runner
 *
 * Runs transforms on app directories, tracking which have been applied.
 */
import { TRANSFORMS, type TransformName } from './transforms/index.js'
import { globby } from 'globby'
import { run as jscodeshift } from 'jscodeshift/src/Runner.js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface MigrationState {
  version: number
  applied: Array<{
    id: string
    appliedAt: string
  }>
}

const MIGRATION_STATE_FILE = '.moldable.migrations.json'

function readMigrationState(appDir: string): MigrationState {
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

function writeMigrationState(appDir: string, state: MigrationState): void {
  const path = join(appDir, MIGRATION_STATE_FILE)
  writeFileSync(path, JSON.stringify(state, null, 2))
}

function isApplied(state: MigrationState, transformName: string): boolean {
  return state.applied.some((m) => m.id === transformName)
}

function markApplied(appDir: string, transformName: string): void {
  const state = readMigrationState(appDir)
  if (!isApplied(state, transformName)) {
    state.applied.push({
      id: transformName,
      appliedAt: new Date().toISOString(),
    })
    writeMigrationState(appDir, state)
  }
}

export interface RunOptions {
  dry?: boolean
  print?: boolean
  verbose?: boolean
  force?: boolean
}

/**
 * Run a specific transform on files
 */
export async function run(
  transformName: TransformName,
  paths: string[],
  options: RunOptions = {},
): Promise<{ ok: number; nochange: number; skip: number; error: number }> {
  const transform = TRANSFORMS[transformName]
  if (!transform) {
    throw new Error(`Unknown transform: ${transformName}`)
  }

  // Resolve transform path
  const transformPath = join(__dirname, 'transforms', `${transformName}.js`)
  if (!existsSync(transformPath)) {
    throw new Error(`Transform file not found: ${transformPath}`)
  }

  // Run jscodeshift
  const result = await jscodeshift(transformPath, paths, {
    dry: options.dry ?? false,
    print: options.print ?? false,
    verbose: options.verbose ? 2 : 0,
    babel: false,
    parser: 'tsx',
    extensions: 'js,mjs,ts,tsx',
    ignorePattern: ['**/node_modules/**'],
    runInBand: true,
    silent: !options.verbose,
  })

  return result
}

/**
 * Run all pending transforms on an app directory
 */
export async function runOnApp(
  appDir: string,
  options: RunOptions = {},
): Promise<{
  applied: string[]
  skipped: string[]
  errors: string[]
}> {
  const applied: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  const state = readMigrationState(appDir)

  for (const [name, transform] of Object.entries(TRANSFORMS)) {
    // Skip if already applied (unless force)
    if (!options.force && isApplied(state, name)) {
      if (options.verbose) {
        console.log(pc.dim(`  ↳ ${name}: already applied, skipping`))
      }
      skipped.push(name)
      continue
    }

    // Find files matching the pattern
    const files = await globby(transform.files, {
      cwd: appDir,
      absolute: true,
    })

    if (files.length === 0) {
      if (options.verbose) {
        console.log(pc.dim(`  ↳ ${name}: no matching files, skipping`))
      }
      skipped.push(name)
      markApplied(appDir, name) // Mark as applied even if no files (prevent future checks)
      continue
    }

    if (options.verbose) {
      console.log(pc.blue(`  ↳ ${name}: processing ${files.length} file(s)`))
    }

    try {
      const result = await run(name as TransformName, files, options)

      if (result.error > 0) {
        errors.push(`${name}: ${result.error} error(s)`)
      } else {
        if (!options.dry) {
          markApplied(appDir, name)
        }
        if (result.ok > 0) {
          applied.push(name)
          if (options.verbose) {
            console.log(pc.green(`    ✓ transformed ${result.ok} file(s)`))
          }
        } else {
          skipped.push(name)
          if (!options.dry) {
            markApplied(appDir, name) // Mark as applied if no changes needed
          }
        }
      }
    } catch (err) {
      errors.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { applied, skipped, errors }
}
