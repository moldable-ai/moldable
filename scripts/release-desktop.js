#!/usr/bin/env node
/**
 * Desktop Release Script
 *
 * Usage:
 *   pnpm release:desktop patch    # 0.1.0 -> 0.1.1
 *   pnpm release:desktop minor    # 0.1.0 -> 0.2.0
 *   pnpm release:desktop major    # 0.1.0 -> 1.0.0
 *   pnpm release:desktop 0.2.0    # Set specific version
 *
 * This script:
 * 1. Bumps version in package.json, tauri.conf.json, and Cargo.toml
 * 2. Commits the version bump
 * 3. Creates a git tag (desktop-v0.x.x)
 * 4. Pushes to trigger the release workflow
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const desktopDir = path.join(rootDir, 'desktop')

const PACKAGE_JSON = path.join(desktopDir, 'package.json')
const TAURI_CONF = path.join(desktopDir, 'src-tauri', 'tauri.conf.json')
const CARGO_TOML = path.join(desktopDir, 'src-tauri', 'Cargo.toml')
const CHANGELOG = path.join(desktopDir, 'CHANGELOG.md')

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  return pkg.version
}

function parseVersion(version) {
  const parts = version.split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`)
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] }
}

function bumpVersion(current, type) {
  const v = parseVersion(current)

  switch (type) {
    case 'major':
      return `${v.major + 1}.0.0`
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`
    default:
      // Assume it's a specific version
      parseVersion(type) // Validate format
      return type
  }
}

function updatePackageJson(version) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  pkg.version = version
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`  Updated ${path.relative(rootDir, PACKAGE_JSON)}`)
}

function updateTauriConf(version) {
  const conf = JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8'))
  conf.version = version
  fs.writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + '\n')
  console.log(`  Updated ${path.relative(rootDir, TAURI_CONF)}`)
}

function updateCargoToml(version) {
  let content = fs.readFileSync(CARGO_TOML, 'utf8')
  // Replace the version in [package] section
  content = content.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)
  fs.writeFileSync(CARGO_TOML, content)
  console.log(`  Updated ${path.relative(rootDir, CARGO_TOML)}`)
}

function getUnreleasedNotes() {
  if (!fs.existsSync(CHANGELOG)) {
    return null
  }
  const content = fs.readFileSync(CHANGELOG, 'utf8')
  // Extract content between [Unreleased] and the next ## heading
  const match = content.match(/## \[Unreleased\]\s*([\s\S]*?)(?=\n## \[|$)/)
  if (!match) {
    return null
  }
  const notes = match[1].trim()
  return notes || null
}

function updateChangelog(version) {
  if (!fs.existsSync(CHANGELOG)) {
    console.log(`  Warning: ${path.relative(rootDir, CHANGELOG)} not found`)
    return null
  }

  let content = fs.readFileSync(CHANGELOG, 'utf8')
  const today = new Date().toISOString().split('T')[0]

  // Replace [Unreleased] section with new version, keeping [Unreleased] for future
  const unreleasedMatch = content.match(
    /## \[Unreleased\]\s*([\s\S]*?)(?=\n## \[|$)/,
  )
  if (unreleasedMatch) {
    const notes = unreleasedMatch[1].trim()
    const newSection = `## [Unreleased]\n\n## [${version}] - ${today}\n\n${notes}`
    content = content.replace(
      /## \[Unreleased\]\s*[\s\S]*?(?=\n## \[|$)/,
      newSection + '\n\n',
    )
    fs.writeFileSync(CHANGELOG, content)
    console.log(`  Updated ${path.relative(rootDir, CHANGELOG)}`)
    return notes
  }

  return null
}

function exec(cmd, options = {}) {
  console.log(`  $ ${cmd}`)
  return execSync(cmd, { stdio: 'inherit', cwd: rootDir, ...options })
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Desktop Release Script

Usage:
  pnpm release:desktop <version-type>

Arguments:
  patch    Bump patch version (0.1.0 -> 0.1.1)
  minor    Bump minor version (0.1.0 -> 0.2.0)
  major    Bump major version (0.1.0 -> 1.0.0)
  x.y.z    Set specific version

Options:
  --dry-run    Show what would happen without making changes
  --no-push    Create tag but don't push (manual push later)
  --retrigger  Re-trigger release for existing version (deletes release/tag and re-pushes)

Examples:
  pnpm release:desktop patch
  pnpm release:desktop 1.0.0
  pnpm release:desktop minor --dry-run
  pnpm release:desktop 0.1.7 --retrigger   # Re-run failed release
`)
    process.exit(0)
  }

  const dryRun = args.includes('--dry-run')
  const noPush = args.includes('--no-push')
  const retrigger = args.includes('--retrigger')
  const versionArg = args.find((a) => !a.startsWith('--'))

  const currentVersion = getCurrentVersion()

  // Handle --retrigger for re-running a failed release
  if (retrigger) {
    // For retrigger, use specified version or current version
    const targetVersion =
      versionArg && versionArg.match(/^\d+\.\d+\.\d+$/)
        ? versionArg
        : currentVersion
    const targetTag = `desktop-v${targetVersion}`

    console.log(`\nRe-triggering Moldable Desktop release`)
    console.log(`  Version: ${targetVersion}`)
    console.log(`  Tag: ${targetTag}`)

    if (dryRun) {
      console.log(`\n[DRY RUN] Would perform the following:`)
      console.log(`  1. Move tag ${targetTag} to HEAD`)
      console.log(`  2. Delete GitHub release ${targetTag} (if exists)`)
      console.log(`  3. Delete remote tag ${targetTag}`)
      console.log(`  4. Push tag ${targetTag} to trigger workflow`)
      process.exit(0)
    }

    // Check if tag exists locally
    let tagExists = false
    try {
      execSync(`git rev-parse ${targetTag}`, { cwd: rootDir, stdio: 'pipe' })
      tagExists = true
    } catch {
      // Tag doesn't exist locally
    }

    if (!tagExists) {
      console.error(`\nError: Tag ${targetTag} does not exist locally.`)
      console.error(`Run a normal release first, or check out the tag.`)
      process.exit(1)
    }

    // Move the tag to HEAD so the release includes latest changes
    console.log(`\nMoving tag to HEAD...`)
    const headCommit = execSync('git rev-parse --short HEAD', {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim()
    exec(`git tag -f ${targetTag} HEAD`)
    console.log(`  Tag ${targetTag} now points to ${headCommit}`)

    console.log(`\nDeleting existing GitHub release (if any)...`)
    try {
      exec(`gh release delete ${targetTag} --yes`, { stdio: 'pipe' })
      console.log(`  Deleted release ${targetTag}`)
    } catch {
      console.log(`  No existing release found (or already deleted)`)
    }

    console.log(`\nDeleting remote tag...`)
    try {
      exec(`git push origin :${targetTag}`, { stdio: 'pipe' })
      console.log(`  Deleted remote tag ${targetTag}`)
    } catch {
      console.log(`  Remote tag not found (or already deleted)`)
    }

    console.log(`\nRe-pushing tag to trigger release workflow...`)
    exec(`git push origin ${targetTag}`)

    console.log(`\nRelease workflow triggered! Check progress at:`)
    console.log(`  https://github.com/moldable-ai/moldable/actions`)
    console.log(
      `\nDone! Version ${targetVersion} release has been re-triggered.`,
    )
    process.exit(0)
  }

  // For normal releases, version argument is required
  if (!versionArg) {
    console.error(
      'Error: Please specify a version type (patch, minor, major) or version number',
    )
    process.exit(1)
  }

  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --', { cwd: rootDir })
  } catch {
    console.error(
      'Error: You have uncommitted changes. Please commit or stash them first.',
    )
    process.exit(1)
  }

  const newVersion = bumpVersion(currentVersion, versionArg)
  const newTagName = `desktop-v${newVersion}`

  // Check for release notes
  const unreleasedNotes = getUnreleasedNotes()

  console.log(`\nReleasing Moldable Desktop`)
  console.log(`  Current version: ${currentVersion}`)
  console.log(`  New version: ${newVersion}`)
  console.log(`  Tag: ${newTagName}`)

  if (unreleasedNotes) {
    console.log(`  Release notes: Found`)
  } else {
    console.log(
      `  Release notes: None (add to desktop/CHANGELOG.md under [Unreleased])`,
    )
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would perform the following:`)
    console.log(`  1. Update CHANGELOG.md with new version heading`)
    console.log(
      `  2. Update version in package.json, tauri.conf.json, Cargo.toml`,
    )
    console.log(`  3. Commit: "release: desktop v${newVersion}"`)
    console.log(`  4. Create tag: ${newTagName}`)
    if (!noPush) {
      console.log(`  5. Push to origin (triggers release workflow)`)
    }
    if (unreleasedNotes) {
      console.log(`\nRelease notes preview:`)
      console.log(
        unreleasedNotes
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
      )
    }
    process.exit(0)
  }

  console.log(`\nUpdating changelog...`)
  updateChangelog(newVersion)

  console.log(`\nUpdating version files...`)
  updatePackageJson(newVersion)
  updateTauriConf(newVersion)
  updateCargoToml(newVersion)

  console.log(`\nCommitting changes...`)
  exec(`git add ${PACKAGE_JSON} ${TAURI_CONF} ${CARGO_TOML} ${CHANGELOG}`)
  exec(`git commit -m "release: desktop v${newVersion}"`)

  console.log(`\nCreating tag...`)
  exec(`git tag -a ${newTagName} -m "Moldable Desktop v${newVersion}"`)

  if (noPush) {
    console.log(`\nTag created locally. Push manually with:`)
    console.log(`  git push origin main ${newTagName}`)
  } else {
    console.log(`\nPushing to origin...`)
    exec(`git push origin main ${newTagName}`)
    console.log(`\nRelease workflow triggered! Check progress at:`)
    console.log(`  https://github.com/moldable-ai/moldable/actions`)
  }

  console.log(`\nDone! Version ${newVersion} is being released.`)
}

main()
