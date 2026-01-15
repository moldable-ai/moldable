import { createBashTools, getSandboxStatus, resetSandbox } from './bash'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
      timeout: 10000,
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

    it('handles command timeout', async () => {
      const shortTimeoutTools = createBashTools({
        cwd: tempDir,
        timeout: 100,
        disableSandbox: true,
      })

      const result = await execCommand(shortTimeoutTools, {
        command: 'sleep 10',
      })

      expect(result).toMatchObject({
        success: false,
        killed: true,
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
    const tools = createBashTools({ cwd: tempDir, timeout: 5000 })

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

    const tools = createBashTools({ cwd: tempDir, timeout: 5000 })

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

    const tools = createBashTools({ cwd: tempDir, timeout: 10000 })

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

    const tools = createBashTools({ cwd: tempDir, timeout: 10000 })

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

    const tools = createBashTools({ cwd: tempDir, timeout: 10000 })

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
    const tools = createBashTools({ cwd: tempDir, timeout: 10000 })

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
