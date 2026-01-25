import { execSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'

/**
 * Common executable names that need path resolution
 */
const RESOLVABLE_COMMANDS = [
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'python',
  'python3',
  'uv',
]

/**
 * Try to find an executable in common locations
 * This is needed because Tauri apps don't inherit shell PATH in production
 */
export function resolveExecutablePath(command: string): string {
  // If it's already an absolute path, return as-is
  const isWindowsAbsolute =
    /^[a-zA-Z]:[\\/]/.test(command) || command.startsWith('\\\\')
  if (command.startsWith('/') || command.startsWith('~') || isWindowsAbsolute) {
    return command.replace(/^~/, homedir())
  }

  // Only resolve known commands
  const baseName = command.split('/').pop() || command
  if (!RESOLVABLE_COMMANDS.includes(baseName)) {
    return command
  }

  // Try to find the executable
  const resolved = findExecutable(baseName)
  if (resolved) {
    return resolved
  }

  // Fallback to original command
  return command
}

/**
 * Find an executable by name, checking common locations
 */
function findExecutable(name: string): string | null {
  const home = homedir()
  const isWindows = process.platform === 'win32'

  // Build list of paths to check based on the executable
  const searchPaths: string[] = []

  // NVM paths (most common for Node.js developers)
  const nvmDir = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir)
        .filter((v) => v.startsWith('v'))
        .sort()
        .reverse() // Prefer newest version
      for (const version of versions) {
        searchPaths.push(join(nvmDir, version, 'bin'))
      }
    } catch {
      // Ignore errors reading NVM dir
    }
  }

  // fnm (Fast Node Manager) paths
  searchPaths.push(
    join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
  )

  // Homebrew paths
  searchPaths.push('/opt/homebrew/bin') // macOS ARM
  searchPaths.push('/usr/local/bin') // macOS Intel / Linux
  searchPaths.push('/home/linuxbrew/.linuxbrew/bin') // Linux Homebrew

  // System paths
  searchPaths.push('/usr/bin')
  searchPaths.push('/bin')

  // User local bin
  searchPaths.push(join(home, '.local', 'bin'))

  // pnpm global bin
  searchPaths.push(join(home, 'Library', 'pnpm'))
  searchPaths.push(join(home, '.pnpm-global', 'bin'))

  if (isWindows) {
    const appData = process.env.APPDATA
    const localAppData = process.env.LOCALAPPDATA
    const programFiles = process.env.ProgramFiles
    const programFilesX86 = process.env['ProgramFiles(x86)']

    if (appData) {
      searchPaths.push(join(appData, 'npm'))
      searchPaths.push(join(appData, 'nvm'))
    }

    if (localAppData) {
      searchPaths.push(join(localAppData, 'pnpm'))
    }

    if (programFiles) {
      searchPaths.push(join(programFiles, 'nodejs'))
    }

    if (programFilesX86) {
      searchPaths.push(join(programFilesX86, 'nodejs'))
    }

    searchPaths.push('C:\\\\Windows\\\\System32')
    searchPaths.push('C:\\\\Windows')
  }

  // Check each path
  const candidates = isWindows
    ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
    : [name]
  for (const dir of searchPaths) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate)
      if (existsSync(fullPath)) {
        return fullPath
      }
    }
  }

  // Try 'which' command as fallback (works in dev, might not in prod)
  try {
    const resolver = isWindows ? 'where' : 'which'
    const result = execSync(`${resolver} ${name}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()
    if (result) {
      const first = result.split(/\r?\n/)[0]?.trim()
      if (first && existsSync(first)) {
        return first
      }
    }
  } catch {
    // which command failed, continue
  }

  return null
}

/**
 * Get a PATH string that includes common executable locations
 * This can be used to augment the environment when spawning processes
 */
export function getAugmentedPath(): string {
  const home = homedir()
  const paths: string[] = []
  const isWindows = process.platform === 'win32'

  // NVM paths
  const nvmDir = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir)
        .filter((v) => v.startsWith('v'))
        .sort()
        .reverse()
      const latestVersion = versions[0]
      if (latestVersion) {
        paths.push(join(nvmDir, latestVersion, 'bin'))
      }
    } catch {
      // Ignore
    }
  }

  // fnm
  const fnmPath = join(
    home,
    '.local',
    'share',
    'fnm',
    'aliases',
    'default',
    'bin',
  )
  if (existsSync(fnmPath)) {
    paths.push(fnmPath)
  }

  // Common paths
  paths.push('/opt/homebrew/bin')
  paths.push('/usr/local/bin')
  paths.push('/usr/bin')
  paths.push('/bin')
  paths.push('/home/linuxbrew/.linuxbrew/bin')
  paths.push(join(home, '.local', 'bin'))

  // pnpm
  const pnpmPath = join(home, 'Library', 'pnpm')
  if (existsSync(pnpmPath)) {
    paths.push(pnpmPath)
  }

  if (isWindows) {
    const appData = process.env.APPDATA
    const localAppData = process.env.LOCALAPPDATA
    const programFiles = process.env.ProgramFiles
    const programFilesX86 = process.env['ProgramFiles(x86)']

    if (appData) {
      paths.push(join(appData, 'npm'))
      paths.push(join(appData, 'nvm'))
    }

    if (localAppData) {
      paths.push(join(localAppData, 'pnpm'))
    }

    if (programFiles) {
      paths.push(join(programFiles, 'nodejs'))
    }

    if (programFilesX86) {
      paths.push(join(programFilesX86, 'nodejs'))
    }

    paths.push('C:\\\\Windows\\\\System32')
    paths.push('C:\\\\Windows')
  }

  // Add existing PATH
  const existingPath = process.env.PATH || ''
  if (existingPath) {
    paths.push(existingPath)
  }

  return paths.join(delimiter)
}
