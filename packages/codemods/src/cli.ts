#!/usr/bin/env node
/**
 * Moldable Codemods CLI
 *
 * Usage:
 *   npx @moldable-ai/codemods <transform> <path>
 *   npx @moldable-ai/codemods --all <path>
 *
 * Options:
 *   --dry      Dry run (don't write changes)
 *   --print    Print transformed files to stdout
 *   --verbose  Show detailed logs
 *   --force    Run even if already applied
 *   --all      Run all transforms
 */
import { run, runOnApp } from './runner.js'
import { TRANSFORMS, type TransformName } from './transforms/index.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pc from 'picocolors'

function printUsage() {
  console.log(`
${pc.bold('Moldable Codemods')}

${pc.dim('Usage:')}
  npx @moldable-ai/codemods <transform> <path>
  npx @moldable-ai/codemods --all <path>

${pc.dim('Available transforms:')}
${Object.entries(TRANSFORMS)
  .map(([name, t]) => `  ${pc.cyan(name.padEnd(25))} ${t.description}`)
  .join('\n')}

${pc.dim('Options:')}
  --dry      Dry run (don't write changes)
  --print    Print transformed files to stdout
  --verbose  Show detailed logs
  --force    Run even if already applied
  --all      Run all transforms on an app directory

${pc.dim('Examples:')}
  npx @moldable-ai/codemods resolve-next-path ./my-app
  npx @moldable-ai/codemods --all ~/.moldable/shared/apps/my-app
  npx @moldable-ai/codemods --all --dry ./my-app
`)
}

async function main() {
  const args = process.argv.slice(2)

  // Parse flags
  const flags = {
    dry: args.includes('--dry'),
    print: args.includes('--print'),
    verbose: args.includes('--verbose'),
    force: args.includes('--force'),
    all: args.includes('--all'),
    help: args.includes('--help') || args.includes('-h'),
  }

  // Remove flags from args
  const positionalArgs = args.filter((a) => !a.startsWith('--') && a !== '-h')

  if (flags.help || positionalArgs.length === 0) {
    printUsage()
    process.exit(flags.help ? 0 : 1)
  }

  if (flags.all) {
    // Run all transforms on app directory
    const appDir = resolve(positionalArgs[0] ?? '.')

    if (!existsSync(appDir)) {
      console.error(pc.red(`Error: Directory not found: ${appDir}`))
      process.exit(1)
    }

    console.log(pc.bold(`Running all codemods on ${appDir}`))

    const { applied, skipped, errors } = await runOnApp(appDir, flags)

    console.log()
    if (applied.length > 0) {
      console.log(pc.green(`✓ Applied: ${applied.join(', ')}`))
    }
    if (skipped.length > 0 && flags.verbose) {
      console.log(pc.dim(`○ Skipped: ${skipped.join(', ')}`))
    }
    if (errors.length > 0) {
      console.log(pc.red(`✗ Errors: ${errors.join(', ')}`))
      process.exit(1)
    }

    if (applied.length === 0 && errors.length === 0) {
      console.log(pc.dim('No changes needed.'))
    }
  } else {
    // Run specific transform
    const [transformName, ...paths] = positionalArgs

    if (!transformName || !(transformName in TRANSFORMS)) {
      console.error(pc.red(`Error: Unknown transform: ${transformName}`))
      console.log(
        pc.dim(`Available transforms: ${Object.keys(TRANSFORMS).join(', ')}`),
      )
      process.exit(1)
    }

    if (paths.length === 0) {
      console.error(pc.red('Error: No paths specified'))
      process.exit(1)
    }

    const resolvedPaths = paths.map((p) => resolve(p))

    console.log(
      pc.bold(`Running ${transformName} on ${resolvedPaths.length} path(s)...`),
    )

    const result = await run(
      transformName as TransformName,
      resolvedPaths,
      flags,
    )

    console.log()
    console.log(
      `Results: ${pc.green(`${result.ok} ok`)}, ` +
        `${pc.dim(`${result.nochange} unchanged`)}, ` +
        `${pc.yellow(`${result.skip} skipped`)}, ` +
        `${pc.red(`${result.error} errors`)}`,
    )

    if (result.error > 0) {
      process.exit(1)
    }
  }
}

main().catch((err) => {
  console.error(pc.red('Error:'), err)
  process.exit(1)
})
