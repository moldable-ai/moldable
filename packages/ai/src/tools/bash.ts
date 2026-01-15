import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import { tool, zodSchema } from 'ai'
import { spawn } from 'child_process'
import os from 'os'
import path from 'path'
import { z } from 'zod/v4'

// Default sandbox configuration for Moldable
// Philosophy: Network is the moat (prevents exfiltration), filesystem writes are the walls.
// Let the AI read what it needs to do its job, but control where it can write and what it can talk to.
const DEFAULT_SANDBOX_CONFIG: SandboxRuntimeConfig = {
  network: {
    // Allow common package registries and APIs
    allowedDomains: [
      // npm / Node.js
      'registry.npmjs.org',
      'registry.yarnpkg.com',
      'registry.npmmirror.com',

      // pnpm
      'registry.npmmirror.com',

      // Python
      'pypi.org',
      'files.pythonhosted.org',

      // Rust
      'crates.io',
      'static.crates.io',
      'index.crates.io',

      // Go
      'proxy.golang.org',
      'sum.golang.org',
      'storage.googleapis.com',

      // Ruby
      'rubygems.org',
      'index.rubygems.org',

      // Java / Maven / Gradle
      'repo.maven.apache.org',
      'repo1.maven.org',
      'plugins.gradle.org',
      'services.gradle.org',
      'jcenter.bintray.com',

      // Deno
      'deno.land',
      'esm.sh',
      'cdn.esm.sh',
      'cdn.jsdelivr.net',
      'unpkg.com',

      // GitHub (releases, raw content, API)
      'github.com',
      'api.github.com',
      'raw.githubusercontent.com',
      'objects.githubusercontent.com',
      'github-releases.githubusercontent.com',
      'codeload.github.com',

      // GitLab
      'gitlab.com',

      // Homebrew (macOS)
      'homebrew.bintray.com',
      'ghcr.io',

      // CDNs commonly used for dependencies
      'cdnjs.cloudflare.com',
      'cdn.skypack.dev',

      // Google APIs (for web search tool, etc.)
      'www.googleapis.com',
    ],
    deniedDomains: [],
    allowLocalBinding: true, // Allow local dev servers
  },
  filesystem: {
    // Only block reads to actual private keys - not configs.
    // Network restrictions prevent exfiltration, so reading configs is safe.
    denyRead: [
      '~/.ssh/id_*', // Private keys
      '~/.ssh/*_rsa', // RSA private keys
      '~/.ssh/*_ed25519', // Ed25519 private keys
      '~/.ssh/*_ecdsa', // ECDSA private keys
      '~/.gnupg/private-keys-v1.d', // GPG private keys
    ],
    // Allow write to workspace and common development paths
    // Note: The workspace cwd is added dynamically in createBashTools
    // Use /** suffix to allow writes to all nested paths within directories
    allowWrite: [
      // System temp directories
      '/tmp/**',
      `${os.tmpdir()}/**`,

      // Moldable user data
      `${path.join(os.homedir(), '.moldable')}/**`,

      // General caches (Linux XDG / macOS)
      `${path.join(os.homedir(), '.cache')}/**`,
      `${path.join(os.homedir(), 'Library/Caches')}/**`,

      // Package managers - npm
      `${path.join(os.homedir(), '.npm')}/**`,

      // Package managers - pnpm
      `${path.join(os.homedir(), '.pnpm-store')}/**`,
      `${path.join(os.homedir(), '.local/share/pnpm')}/**`,
      `${path.join(os.homedir(), 'Library/pnpm')}/**`,

      // Package managers - yarn
      `${path.join(os.homedir(), '.yarn')}/**`,
      path.join(os.homedir(), '.yarnrc.yml'),

      // Package managers - bun
      `${path.join(os.homedir(), '.bun')}/**`,

      // Node.js version managers
      `${path.join(os.homedir(), '.nvm')}/**`,
      `${path.join(os.homedir(), '.fnm')}/**`,
      `${path.join(os.homedir(), '.volta')}/**`,
      `${path.join(os.homedir(), '.n')}/**`,

      // Python
      `${path.join(os.homedir(), '.pyenv')}/**`,
      `${path.join(os.homedir(), '.local/lib')}/**`,
      `${path.join(os.homedir(), '.local/bin')}/**`,
      `${path.join(os.homedir(), '.virtualenvs')}/**`,
      `${path.join(os.homedir(), '.venv')}/**`,

      // Rust
      `${path.join(os.homedir(), '.cargo')}/**`,
      `${path.join(os.homedir(), '.rustup')}/**`,

      // Go
      `${path.join(os.homedir(), 'go')}/**`,

      // Ruby
      `${path.join(os.homedir(), '.rbenv')}/**`,
      `${path.join(os.homedir(), '.rvm')}/**`,
      `${path.join(os.homedir(), '.gem')}/**`,
      `${path.join(os.homedir(), '.bundle')}/**`,

      // Java
      `${path.join(os.homedir(), '.m2')}/**`,
      `${path.join(os.homedir(), '.gradle')}/**`,
      `${path.join(os.homedir(), '.sdkman')}/**`,

      // Deno
      `${path.join(os.homedir(), '.deno')}/**`,

      // Build tools
      `${path.join(os.homedir(), '.turbo')}/**`,

      // Git (for operations, not config - config controlled by allowGitConfig)
      path.join(os.homedir(), '.gitconfig'),
    ],
    // Deny write to security-critical locations
    denyWrite: [
      '~/.ssh',
      '~/.gnupg',
      '~/.aws',
      '~/.config/gcloud',
      '~/.kube',
      '/etc',
      '/usr',
      '/bin',
      '/sbin',
      '/System', // macOS system
      '/Library', // macOS library
    ],
    allowGitConfig: true, // Needed for normal git operations
  },
}

// Track initialization state
let sandboxInitialized = false
let sandboxSupported = true

/**
 * Initialize the sandbox manager with config
 */
async function initializeSandbox(
  customConfig?: Partial<SandboxRuntimeConfig>,
): Promise<boolean> {
  if (sandboxInitialized) return sandboxSupported

  try {
    // Deep merge config, properly merging arrays instead of replacing
    const config: SandboxRuntimeConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      ...customConfig,
      network: {
        ...DEFAULT_SANDBOX_CONFIG.network,
        ...customConfig?.network,
        // Merge domain arrays
        allowedDomains: [
          ...(DEFAULT_SANDBOX_CONFIG.network?.allowedDomains ?? []),
          ...(customConfig?.network?.allowedDomains ?? []),
        ],
        deniedDomains: [
          ...(DEFAULT_SANDBOX_CONFIG.network?.deniedDomains ?? []),
          ...(customConfig?.network?.deniedDomains ?? []),
        ],
      },
      filesystem: {
        ...DEFAULT_SANDBOX_CONFIG.filesystem,
        ...customConfig?.filesystem,
        // Merge filesystem arrays (critical fix!)
        denyRead: [
          ...(DEFAULT_SANDBOX_CONFIG.filesystem?.denyRead ?? []),
          ...(customConfig?.filesystem?.denyRead ?? []),
        ],
        allowWrite: [
          ...(DEFAULT_SANDBOX_CONFIG.filesystem?.allowWrite ?? []),
          ...(customConfig?.filesystem?.allowWrite ?? []),
        ],
        denyWrite: [
          ...(DEFAULT_SANDBOX_CONFIG.filesystem?.denyWrite ?? []),
          ...(customConfig?.filesystem?.denyWrite ?? []),
        ],
      },
    }

    // Check if platform is supported
    const platform = process.platform
    if (platform !== 'darwin' && platform !== 'linux') {
      console.warn(
        `[sandbox] Platform ${platform} not supported, running without sandbox`,
      )
      sandboxSupported = false
      sandboxInitialized = true
      return false
    }

    // Check dependencies
    const hasRipgrep = SandboxManager.checkDependencies({ command: 'rg' })
    if (!hasRipgrep && platform === 'linux') {
      console.warn(
        '[sandbox] ripgrep not found, some Linux features may be limited',
      )
    }

    await SandboxManager.initialize(config)
    sandboxInitialized = true
    sandboxSupported = SandboxManager.isSandboxingEnabled()

    if (!sandboxSupported) {
      console.warn('[sandbox] Sandboxing could not be enabled on this system')
    }

    return sandboxSupported
  } catch (error) {
    console.error('[sandbox] Failed to initialize:', error)
    sandboxInitialized = true
    sandboxSupported = false
    return false
  }
}

/**
 * Execute a command with optional sandboxing
 */
async function executeCommand(
  command: string,
  options: {
    cwd?: string
    timeout?: number
    maxBuffer?: number
    useSandbox?: boolean
  },
): Promise<{
  success: boolean
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number
  killed?: boolean
  signal?: string
  error?: string
  sandboxed?: boolean
}> {
  const {
    cwd,
    timeout = 30000,
    maxBuffer = 1024 * 1024,
    useSandbox = true,
  } = options

  let finalCommand = command
  let isSandboxed = false

  // Try to wrap with sandbox if enabled
  if (useSandbox && sandboxSupported) {
    try {
      await initializeSandbox()
      if (SandboxManager.isSandboxingEnabled()) {
        finalCommand = await SandboxManager.wrapWithSandbox(command)
        isSandboxed = true
      }
    } catch (error) {
      console.warn(
        '[sandbox] Failed to wrap command, running unsandboxed:',
        error,
      )
    }
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false
    let timeoutId: NodeJS.Timeout | undefined

    const child = spawn(finalCommand, {
      shell: '/bin/bash',
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure sandbox proxies are used
        ...(isSandboxed ? {} : {}),
      },
    })

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        // Force kill after 5s if SIGTERM doesn't work
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 5000)
      }, timeout)
    }

    // Collect stdout
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      if (stdout.length + chunk.length <= maxBuffer) {
        stdout += chunk
      }
    })

    // Collect stderr
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      if (stderr.length + chunk.length <= maxBuffer) {
        stderr += chunk
      }
    })

    // Handle completion
    child.on('close', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId)

      // Annotate stderr with sandbox failures if applicable
      if (isSandboxed && stderr) {
        stderr = SandboxManager.annotateStderrWithSandboxFailures(
          command,
          stderr,
        )
      }

      resolve({
        success: code === 0,
        command,
        stdout: stdout.trim() || undefined,
        stderr: stderr.trim() || undefined,
        exitCode: code ?? undefined,
        killed,
        signal: signal ?? undefined,
        error: code !== 0 ? `Command exited with code ${code}` : undefined,
        sandboxed: isSandboxed,
      })
    })

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve({
        success: false,
        command,
        stdout: stdout.trim() || undefined,
        stderr: stderr.trim() || undefined,
        error: error.message,
        sandboxed: isSandboxed,
      })
    })
  })
}

/**
 * Create bash/shell tools for the AI agent with sandbox support
 */
export function createBashTools(
  options: {
    cwd?: string
    timeout?: number
    maxBuffer?: number
    sandboxConfig?: Partial<SandboxRuntimeConfig>
    disableSandbox?: boolean
  } = {},
) {
  const {
    cwd,
    timeout = 30000,
    maxBuffer = 1024 * 1024,
    sandboxConfig,
    disableSandbox = false,
  } = options

  // Build config with workspace path added to allowWrite (with /** for nested paths)
  const workspaceAllowWrite = cwd ? [`${path.resolve(cwd)}/**`] : []
  const configWithWorkspace: Partial<SandboxRuntimeConfig> = {
    ...sandboxConfig,
    filesystem: sandboxConfig?.filesystem
      ? {
          ...sandboxConfig.filesystem,
          allowWrite: [
            ...(sandboxConfig.filesystem.allowWrite ?? []),
            ...workspaceAllowWrite,
          ],
        }
      : workspaceAllowWrite.length > 0
        ? {
            denyRead: [],
            allowWrite: workspaceAllowWrite,
            denyWrite: [],
          }
        : undefined,
  }

  // Initialize sandbox on first use
  if (!disableSandbox) {
    initializeSandbox(configWithWorkspace).catch(() => {
      // Initialization errors are handled inside
    })
  }

  const runCommandSchema = z.object({
    command: z.string().describe('The bash command to execute'),
    workingDirectory: z
      .string()
      .optional()
      .describe(
        'Optional working directory for the command. Defaults to the configured base directory.',
      ),
  })

  return {
    runCommand: tool({
      description: `Execute a bash command in a sandboxed environment with filesystem and network restrictions. The command runs with a ${timeout / 1000}s timeout. Network access is limited to package registries and allowed APIs. Sensitive paths like ~/.ssh are protected.`,
      inputSchema: zodSchema(runCommandSchema),
      execute: async (input) => {
        return executeCommand(input.command, {
          cwd: input.workingDirectory || cwd,
          timeout,
          maxBuffer,
          useSandbox: !disableSandbox,
        })
      },
    }),
  }
}

/**
 * Get current sandbox status
 */
export function getSandboxStatus(): {
  initialized: boolean
  supported: boolean
  enabled: boolean
} {
  return {
    initialized: sandboxInitialized,
    supported: sandboxSupported,
    enabled:
      sandboxInitialized &&
      sandboxSupported &&
      SandboxManager.isSandboxingEnabled(),
  }
}

/**
 * Reset sandbox state (useful for testing)
 */
export async function resetSandbox(): Promise<void> {
  if (sandboxInitialized && sandboxSupported) {
    await SandboxManager.reset()
  }
  sandboxInitialized = false
  sandboxSupported = true
}
