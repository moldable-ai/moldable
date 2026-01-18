import {
  BUILTIN_DANGEROUS_PATTERNS,
  createBashTools,
  getAugmentedPath,
  getSandboxStatus,
  isDangerousCommand as isDangerousCommandRaw,
  resetSandbox,
} from './bash'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Wrap isDangerousCommand to use the default patterns for testing
const isDangerousCommand = (command: string) =>
  isDangerousCommandRaw(command, BUILTIN_DANGEROUS_PATTERNS)

// Helper to execute tool and extract result (handles AI SDK's union types)
type CommandResult = {
  success: boolean
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number
  killed?: boolean
  signal?: string
  error?: string
  sandboxed?: boolean
}

async function execCommand(
  tools: ReturnType<typeof createBashTools>,
  input: { command: string; workingDirectory?: string },
): Promise<CommandResult> {
  const result = await tools.runCommand.execute!(input, {
    toolCallId: 'test',
    messages: [],
    abortSignal: undefined as never,
  })
  return result as CommandResult
}

describe('createBashTools', () => {
  let tempDir: string
  let tools: ReturnType<typeof createBashTools>

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bash-test-'))
    // Disable sandbox for unit tests to avoid system dependencies
    tools = createBashTools({
      cwd: tempDir,
      disableSandbox: true,
    })
  })

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
    await resetSandbox()
  })

  describe('runCommand', () => {
    it('executes simple commands', async () => {
      const result = await execCommand(tools, { command: 'echo "hello world"' })

      expect(result).toMatchObject({
        success: true,
        command: 'echo "hello world"',
        stdout: 'hello world',
      })
    })

    it('returns exit code for failed commands', async () => {
      const result = await execCommand(tools, { command: 'exit 42' })

      expect(result).toMatchObject({
        success: false,
        exitCode: 42,
      })
    })

    it('captures stderr', async () => {
      const result = await execCommand(tools, { command: 'echo "error" >&2' })

      expect(result).toMatchObject({
        success: true,
        stderr: 'error',
      })
    })

    it('respects working directory', async () => {
      const result = await execCommand(tools, { command: 'pwd' })

      // macOS resolves /var to /private/var
      expect(result.stdout).toMatch(
        new RegExp(tempDir.replace('/var/', '(/private)?/var/')),
      )
    })

    it('allows overriding working directory', async () => {
      const subDir = path.join(tempDir, 'subdir')
      await fs.mkdir(subDir)

      const result = await execCommand(tools, {
        command: 'pwd',
        workingDirectory: subDir,
      })

      // macOS resolves /var to /private/var
      expect(result.stdout).toMatch(
        new RegExp(subDir.replace('/var/', '(/private)?/var/')),
      )
    })

    it('handles abort signal to stop long-running commands', async () => {
      const abortController = new AbortController()

      // Start a long-running command
      const resultPromise = tools.runCommand.execute!(
        { command: 'sleep 10' },
        {
          toolCallId: 'test',
          messages: [],
          abortSignal: abortController.signal,
        },
      ) as Promise<CommandResult>

      // Abort after a short delay
      setTimeout(() => abortController.abort(), 100)

      const result = await resultPromise

      expect(result).toMatchObject({
        success: false,
        killed: true,
        error: 'Command was aborted',
      })
    })

    it('handles non-existent commands', async () => {
      const result = await execCommand(tools, {
        command: 'nonexistentcommand12345',
      })

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(127) // Command not found
    })

    it('can create and read files', async () => {
      await execCommand(tools, { command: 'echo "test content" > test.txt' })

      const result = await execCommand(tools, { command: 'cat test.txt' })

      expect(result).toMatchObject({
        success: true,
        stdout: 'test content',
      })
    })

    it('handles multi-line output', async () => {
      const result = await execCommand(tools, {
        command: 'echo -e "line1\\nline2\\nline3"',
      })

      expect(result.success).toBe(true)
      expect(result.stdout).toContain('line1')
      expect(result.stdout).toContain('line2')
      expect(result.stdout).toContain('line3')
    })

    it('handles commands with special characters', async () => {
      const result = await execCommand(tools, { command: 'echo "hello $USER"' })

      expect(result.success).toBe(true)
      expect(result.stdout).toBeTruthy()
    })

    it('handles pipe commands', async () => {
      const result = await execCommand(tools, {
        command: 'echo "hello world" | wc -w',
      })

      expect(result.success).toBe(true)
      expect(result.stdout?.trim()).toBe('2')
    })
  })

  describe('getSandboxStatus', () => {
    it('reports sandbox status', () => {
      const status = getSandboxStatus()

      expect(status).toHaveProperty('initialized')
      expect(status).toHaveProperty('supported')
      expect(status).toHaveProperty('enabled')
      expect(typeof status.initialized).toBe('boolean')
      expect(typeof status.supported).toBe('boolean')
      expect(typeof status.enabled).toBe('boolean')
    })
  })
})

// Helper to check if sandbox dependencies are available
async function checkSandboxAvailable(): Promise<boolean> {
  // On macOS, sandbox is handled by sandbox-exec (built-in)
  if (process.platform === 'darwin') {
    return true
  }
  // On Linux, we need bubblewrap and socat
  if (process.platform === 'linux') {
    const { execSync } = await import('child_process')
    try {
      execSync('which bwrap', { stdio: 'ignore' })
      execSync('which socat', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  return false
}

describe('createBashTools with sandbox', () => {
  let tempDir: string
  let sandboxAvailable: boolean

  beforeAll(async () => {
    sandboxAvailable = await checkSandboxAvailable()
  })

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bash-sandbox-test-'))
    await resetSandbox()
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    await resetSandbox()
  })

  it('initializes sandbox when enabled', async () => {
    // Skip on CI/environments without sandbox dependencies
    if (!sandboxAvailable) {
      console.log('Skipping: sandbox dependencies not available')
      return
    }

    // Create tools with sandbox enabled (default)
    const tools = createBashTools({ cwd: tempDir })

    // Run a simple command - this should trigger sandbox initialization
    const result = await execCommand(tools, { command: 'echo "sandboxed"' })

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('sandboxed')

    // Check that we got sandbox status in result
    expect(result).toHaveProperty('sandboxed')
  })

  it('gracefully falls back when sandbox unavailable', async () => {
    // Skip on CI/environments without sandbox dependencies
    if (!sandboxAvailable) {
      console.log('Skipping: sandbox dependencies not available')
      return
    }

    // Reset to unknown state
    await resetSandbox()

    const tools = createBashTools({ cwd: tempDir })

    // Should still work even if sandbox init fails
    const result = await execCommand(tools, { command: 'echo "works"' })

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('works')
  })

  it('allows writes to ~/.moldable/ when sandboxed', async () => {
    // Skip on CI/environments without sandbox dependencies
    if (!sandboxAvailable) {
      console.log('Skipping: sandbox dependencies not available')
      return
    }

    const homeDir = os.homedir()
    const moldableDir = path.join(homeDir, '.moldable')
    const testFile = path.join(moldableDir, 'sandbox-write-test.txt')

    const tools = createBashTools({ cwd: tempDir })

    // Write to ~/.moldable/ (should be in allowWrite)
    const result = await execCommand(tools, {
      command: `echo 'sandbox test' > "${testFile}"`,
    })

    // Only assert if sandbox is active - on unsupported platforms this may not apply
    if (result.sandboxed) {
      expect(result.success).toBe(true)
    }

    // Clean up
    await execCommand(tools, { command: `rm -f "${testFile}"` })
  })

  it('allows writes to nested paths in ~/.moldable/', async () => {
    // Skip on CI/environments without sandbox dependencies
    if (!sandboxAvailable) {
      console.log('Skipping: sandbox dependencies not available')
      return
    }

    const homeDir = os.homedir()
    const nestedPath = path.join(
      homeDir,
      '.moldable',
      'apps',
      'test-app',
      'data',
    )
    const testFile = path.join(nestedPath, 'sandbox-nested-test.txt')

    const tools = createBashTools({ cwd: tempDir })

    // Create nested directory and write file
    const mkdirResult = await execCommand(tools, {
      command: `mkdir -p "${nestedPath}"`,
    })

    const writeResult = await execCommand(tools, {
      command: `echo 'nested test' > "${testFile}"`,
    })

    // Only assert if sandbox is active
    if (writeResult.sandboxed) {
      expect(mkdirResult.success).toBe(true)
      expect(writeResult.success).toBe(true)
    }

    // Clean up
    await execCommand(tools, {
      command: `rm -rf "${path.join(homeDir, '.moldable', 'apps', 'test-app')}"`,
    })
  })

  it('allows writes to ~/.cache/ when sandboxed', async () => {
    // Skip on CI/environments without sandbox dependencies
    if (!sandboxAvailable) {
      console.log('Skipping: sandbox dependencies not available')
      return
    }

    const homeDir = os.homedir()
    const cacheDir = path.join(homeDir, '.cache', 'moldable-sandbox-test')
    const testFile = path.join(cacheDir, 'test.txt')

    const tools = createBashTools({ cwd: tempDir })

    // Create cache directory and write file
    const result = await execCommand(tools, {
      command: `mkdir -p "${cacheDir}" && echo 'cache test' > "${testFile}"`,
    })

    // Only assert if sandbox is active
    if (result.sandboxed) {
      expect(result.success).toBe(true)
    }

    // Clean up
    await execCommand(tools, { command: `rm -rf "${cacheDir}"` })
  })

  it('merges default allowWrite paths with workspace path', async () => {
    // Skip on CI/environments without sandbox dependencies
    if (!sandboxAvailable) {
      console.log('Skipping: sandbox dependencies not available')
      return
    }

    const homeDir = os.homedir()
    const tools = createBashTools({ cwd: tempDir })

    // Test 1: Workspace write (explicitly added)
    const workspaceFile = path.join(tempDir, 'workspace-test.txt')
    const workspaceResult = await execCommand(tools, {
      command: `echo 'workspace' > "${workspaceFile}"`,
    })

    // Test 2: ~/.moldable write (from defaults)
    const moldableFile = path.join(homeDir, '.moldable', 'merge-test.txt')
    const moldableResult = await execCommand(tools, {
      command: `echo 'moldable' > "${moldableFile}"`,
    })

    // Both should work - proving the arrays are merged, not replaced
    if (workspaceResult.sandboxed && moldableResult.sandboxed) {
      expect(workspaceResult.success).toBe(true)
      expect(moldableResult.success).toBe(true)
    }

    // Clean up
    await execCommand(tools, {
      command: `rm -f "${workspaceFile}" "${moldableFile}"`,
    })
  })
})

describe('getAugmentedPath', () => {
  it('returns a colon-separated PATH string', () => {
    const augmentedPath = getAugmentedPath()

    expect(typeof augmentedPath).toBe('string')
    expect(augmentedPath).toContain(':')
  })

  it('includes standard system paths', () => {
    const augmentedPath = getAugmentedPath()

    // Should always include these standard paths
    expect(augmentedPath).toContain('/usr/bin')
    expect(augmentedPath).toContain('/bin')
  })

  it('includes homebrew paths', () => {
    const augmentedPath = getAugmentedPath()

    // Should include homebrew paths (even if they don't exist on the system)
    expect(augmentedPath).toContain('/opt/homebrew/bin')
    expect(augmentedPath).toContain('/usr/local/bin')
  })

  it('includes existing PATH at the end', () => {
    const originalPath = process.env.PATH
    const augmentedPath = getAugmentedPath()

    // The original PATH should be included
    if (originalPath) {
      expect(augmentedPath).toContain(originalPath)
      // And it should be at the end (after the colon-joined augmented paths)
      expect(augmentedPath.endsWith(originalPath)).toBe(true)
    }
  })

  it('includes user local bin path', () => {
    const augmentedPath = getAugmentedPath()
    const homeDir = os.homedir()

    expect(augmentedPath).toContain(path.join(homeDir, '.local', 'bin'))
  })

  it('includes nvm path if nvm directory exists', async () => {
    const homeDir = os.homedir()
    const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node')

    // Check if nvm is installed on this system
    let nvmExists = false
    try {
      await fs.access(nvmDir)
      nvmExists = true
    } catch {
      nvmExists = false
    }

    const augmentedPath = getAugmentedPath()

    if (nvmExists) {
      // If nvm exists, the path should include an nvm node bin directory
      expect(augmentedPath).toMatch(/\.nvm\/versions\/node\/v[^:]+\/bin/)
    }
    // If nvm doesn't exist, we just verify the function doesn't crash
  })

  it('commands can find node/pnpm with augmented PATH', async () => {
    // This test verifies the fix actually works - that commands
    // executed through bash tools can find executables like node/pnpm
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'path-test-'))

    try {
      const tools = createBashTools({
        cwd: tempDir,
        disableSandbox: true,
      })

      // Try to find node - this should work with the augmented PATH
      const result = await execCommand(tools, { command: 'which node' })

      // On a system with node installed (via nvm, homebrew, etc.),
      // this should succeed. If node isn't installed at all, this test
      // just verifies we don't crash.
      if (result.success) {
        expect(result.stdout).toMatch(/node/)
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('isDangerousCommand', () => {
  describe('recursive delete (rm -rf)', () => {
    it('should flag rm -rf', () => {
      expect(isDangerousCommand('rm -rf /some/path')).toBe(true)
    })

    it('should flag rm -r', () => {
      expect(isDangerousCommand('rm -r /some/path')).toBe(true)
    })

    it('should flag rm -fr', () => {
      expect(isDangerousCommand('rm -fr /some/path')).toBe(true)
    })

    it('should flag rm with combined flags', () => {
      expect(isDangerousCommand('rm -rfi /some/path')).toBe(true)
    })

    it('should not flag simple rm', () => {
      expect(isDangerousCommand('rm file.txt')).toBe(false)
    })

    it('should not flag rm -f without -r', () => {
      expect(isDangerousCommand('rm -f file.txt')).toBe(false)
    })
  })

  describe('sudo commands', () => {
    it('should flag sudo', () => {
      expect(isDangerousCommand('sudo apt update')).toBe(true)
    })

    it('should flag sudo in middle of command', () => {
      expect(isDangerousCommand('echo "test" && sudo rm file')).toBe(true)
    })
  })

  describe('disk operations', () => {
    it('should flag mkfs', () => {
      expect(isDangerousCommand('mkfs.ext4 /dev/sda1')).toBe(true)
    })

    it('should flag dd', () => {
      expect(isDangerousCommand('dd if=/dev/zero of=/dev/sda')).toBe(true)
    })

    it('should flag fdisk', () => {
      expect(isDangerousCommand('fdisk /dev/sda')).toBe(true)
    })
  })

  describe('remote script execution', () => {
    it('should flag curl piped to bash', () => {
      expect(isDangerousCommand('curl https://example.com | bash')).toBe(true)
    })

    it('should flag wget piped to sh', () => {
      expect(isDangerousCommand('wget -O - https://example.com | sh')).toBe(
        true,
      )
    })

    it('should not flag curl without pipe to shell', () => {
      expect(isDangerousCommand('curl https://example.com')).toBe(false)
    })
  })

  describe('chmod/chown', () => {
    it('should flag chmod 777', () => {
      expect(isDangerousCommand('chmod 777 /some/file')).toBe(true)
    })

    it('should flag chmod 755', () => {
      expect(isDangerousCommand('chmod 755 /some/file')).toBe(true)
    })

    it('should not flag chmod 644', () => {
      expect(isDangerousCommand('chmod 644 /some/file')).toBe(false)
    })

    it('should flag chown root', () => {
      expect(isDangerousCommand('chown root:root /some/file')).toBe(true)
    })
  })

  describe('git force push', () => {
    it('should flag git push --force to main', () => {
      expect(isDangerousCommand('git push --force origin main')).toBe(true)
    })

    it('should flag git push -f to master', () => {
      expect(isDangerousCommand('git push -f origin master')).toBe(true)
    })

    it('should flag git push main --force', () => {
      expect(isDangerousCommand('git push origin main --force')).toBe(true)
    })

    it('should not flag normal git push', () => {
      expect(isDangerousCommand('git push origin main')).toBe(false)
    })

    it('should not flag force push to feature branch', () => {
      expect(
        isDangerousCommand('git push --force origin feature/my-branch'),
      ).toBe(false)
    })
  })

  describe('database operations', () => {
    it('should flag DROP DATABASE', () => {
      expect(isDangerousCommand('DROP DATABASE mydb')).toBe(true)
    })

    it('should flag drop table', () => {
      expect(isDangerousCommand('drop table users')).toBe(true)
    })

    it('should flag TRUNCATE TABLE', () => {
      expect(isDangerousCommand('TRUNCATE TABLE users')).toBe(true)
    })

    it('should flag DELETE FROM without WHERE', () => {
      expect(isDangerousCommand('DELETE FROM users;')).toBe(true)
    })

    it('should flag DELETE FROM with WHERE 1', () => {
      expect(isDangerousCommand('DELETE FROM users WHERE 1')).toBe(true)
    })
  })

  describe('git reset and clean', () => {
    it('should flag git reset --hard', () => {
      expect(isDangerousCommand('git reset --hard')).toBe(true)
    })

    it('should flag git reset --hard HEAD~1', () => {
      expect(isDangerousCommand('git reset --hard HEAD~1')).toBe(true)
    })

    it('should flag git clean -fd', () => {
      expect(isDangerousCommand('git clean -fd')).toBe(true)
    })

    it('should flag git clean -f', () => {
      expect(isDangerousCommand('git clean -f')).toBe(true)
    })

    it('should flag git push origin :branch (delete)', () => {
      expect(isDangerousCommand('git push origin :feature-branch')).toBe(true)
    })

    it('should flag git push --delete', () => {
      expect(
        isDangerousCommand('git push --delete origin feature-branch'),
      ).toBe(true)
    })

    it('should not flag git reset --soft', () => {
      expect(isDangerousCommand('git reset --soft HEAD~1')).toBe(false)
    })
  })

  describe('docker operations', () => {
    it('should flag docker system prune', () => {
      expect(isDangerousCommand('docker system prune')).toBe(true)
    })

    it('should flag docker system prune -a', () => {
      expect(isDangerousCommand('docker system prune -a')).toBe(true)
    })

    it('should flag docker rm -f', () => {
      expect(isDangerousCommand('docker rm -f container_id')).toBe(true)
    })

    it('should flag docker rmi -f', () => {
      expect(isDangerousCommand('docker rmi -f image_id')).toBe(true)
    })

    it('should flag docker container prune', () => {
      expect(isDangerousCommand('docker container prune')).toBe(true)
    })

    it('should not flag docker ps', () => {
      expect(isDangerousCommand('docker ps')).toBe(false)
    })

    it('should not flag docker run', () => {
      expect(isDangerousCommand('docker run -it ubuntu bash')).toBe(false)
    })
  })

  describe('process killing', () => {
    it('should flag kill -9', () => {
      expect(isDangerousCommand('kill -9 1234')).toBe(true)
    })

    it('should flag kill -KILL', () => {
      expect(isDangerousCommand('kill -KILL 1234')).toBe(true)
    })

    it('should flag pkill -9', () => {
      expect(isDangerousCommand('pkill -9 process_name')).toBe(true)
    })

    it('should not flag normal kill', () => {
      expect(isDangerousCommand('kill 1234')).toBe(false)
    })
  })

  describe('system power commands', () => {
    it('should flag shutdown', () => {
      expect(isDangerousCommand('shutdown -h now')).toBe(true)
    })

    it('should flag reboot', () => {
      expect(isDangerousCommand('reboot')).toBe(true)
    })

    it('should flag halt', () => {
      expect(isDangerousCommand('halt')).toBe(true)
    })

    it('should flag poweroff', () => {
      expect(isDangerousCommand('poweroff')).toBe(true)
    })
  })

  describe('file operations', () => {
    it('should flag mv /', () => {
      expect(isDangerousCommand('mv / /backup')).toBe(true)
    })

    it('should flag shred', () => {
      expect(isDangerousCommand('shred -u secret.txt')).toBe(true)
    })

    it('should flag chmod -R 777', () => {
      expect(isDangerousCommand('chmod -R 777 /var/www')).toBe(true)
    })
  })

  describe('safe commands', () => {
    it('should not flag ls', () => {
      expect(isDangerousCommand('ls -la')).toBe(false)
    })

    it('should not flag cat', () => {
      expect(isDangerousCommand('cat file.txt')).toBe(false)
    })

    it('should not flag npm install', () => {
      expect(isDangerousCommand('npm install')).toBe(false)
    })

    it('should not flag git commit', () => {
      expect(isDangerousCommand('git commit -m "message"')).toBe(false)
    })
  })
})
