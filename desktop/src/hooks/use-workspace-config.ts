import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'

/**
 * Hook to read/write preferences from a workspace's config.json
 *
 * This persists preferences to the workspace config (~/.moldable/workspaces/{id}/config.json)
 * instead of localStorage, ensuring they survive webview resets and are inspectable/portable.
 *
 * @param key - The preference key
 * @param defaultValue - Default value if preference is not set
 * @returns [value, setValue, isLoading] tuple
 */
export function useWorkspaceConfig<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void, boolean] {
  const [value, setValueState] = useState<T>(defaultValue)
  const [isLoading, setIsLoading] = useState(true)

  // Load preference on mount
  useEffect(() => {
    if (!isTauri()) {
      setIsLoading(false)
      return
    }

    invoke<unknown | null>('get_preference', { key })
      .then((result) => {
        if (result !== null && result !== undefined) {
          setValueState(result as T)
        }
      })
      .catch((error) => {
        console.error(`Failed to load preference "${key}":`, error)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [key])

  // Set preference
  const setValue = useCallback(
    (newValue: T) => {
      setValueState(newValue)

      if (!isTauri()) {
        return
      }

      invoke('set_preference', { key, value: newValue }).catch((error) => {
        console.error(`Failed to save preference "${key}":`, error)
      })
    },
    [key],
  )

  return [value, setValue, isLoading]
}

/**
 * Hook to load all workspace preferences at once
 *
 * @returns [preferences, isLoading] tuple
 */
export function useAllWorkspacePreferences(): [
  Record<string, unknown>,
  boolean,
] {
  const [preferences, setPreferences] = useState<Record<string, unknown>>({})
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!isTauri()) {
      setIsLoading(false)
      return
    }

    invoke<Record<string, unknown>>('get_all_preferences')
      .then((result) => {
        setPreferences(result ?? {})
      })
      .catch((error) => {
        console.error('Failed to load preferences:', error)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  return [preferences, isLoading]
}

/**
 * Hook to read/write SHARED preferences (global settings like security).
 *
 * These are stored in ~/.moldable/shared/config.json and apply across all workspaces.
 * Use this for settings that should be the same regardless of which workspace is active.
 *
 * @param key - The preference key
 * @param defaultValue - Default value if preference is not set
 * @returns [value, setValue, isLoading] tuple
 */
export function useSharedConfig<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void, boolean] {
  const [value, setValueState] = useState<T>(defaultValue)
  const [isLoading, setIsLoading] = useState(true)

  // Load shared preference on mount
  useEffect(() => {
    if (!isTauri()) {
      setIsLoading(false)
      return
    }

    invoke<unknown | null>('get_shared_preference', { key })
      .then((result) => {
        if (result !== null && result !== undefined) {
          setValueState(result as T)
        }
      })
      .catch((error) => {
        console.error(`Failed to load shared preference "${key}":`, error)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [key])

  // Set shared preference
  const setValue = useCallback(
    (newValue: T) => {
      setValueState(newValue)

      if (!isTauri()) {
        return
      }

      invoke('set_shared_preference', { key, value: newValue }).catch(
        (error) => {
          console.error(`Failed to save shared preference "${key}":`, error)
        },
      )
    },
    [key],
  )

  return [value, setValue, isLoading]
}

/**
 * Shared preference keys (global settings that apply across all workspaces)
 */
export const SHARED_PREFERENCE_KEYS = {
  /** Whether to require approval for unsandboxed commands (default: true) */
  REQUIRE_UNSANDBOXED_APPROVAL: 'requireUnsandboxedApproval',
  /** Whether to require approval for dangerous commands (default: true) */
  REQUIRE_DANGEROUS_COMMAND_APPROVAL: 'requireDangerousCommandApproval',
  /** Dangerous command patterns (user-editable, populated with defaults on first run) */
  DANGEROUS_PATTERNS: 'dangerousPatterns',
  /** Whether the gateway should auto-start */
  GATEWAY_ENABLED: 'gatewayEnabled',
  /** The last selected gateway setup */
  GATEWAY_SETUP_ID: 'gatewaySetupId',
} as const

/**
 * Workspace preference keys (settings specific to each workspace)
 */
export const WORKSPACE_PREFERENCE_KEYS = {
  /** Selected AI model ID */
  SELECTED_MODEL: 'selectedModel',
  /** Reasoning effort settings per vendor */
  REASONING_EFFORT: 'reasoningEffort',
  /** Theme preference: 'light' | 'dark' | 'system' */
  THEME: 'theme',
  /** Whether onboarding has been completed for this workspace */
  ONBOARDING_COMPLETED: 'onboardingCompleted',
} as const

/**
 * Default dangerous command patterns that require approval.
 * These are built-in and always checked (unless approval is disabled).
 * Users can remove patterns they don't want via the Security settings.
 */
export const DEFAULT_DANGEROUS_PATTERNS = [
  // File operations
  {
    pattern: '\\brm\\s+(-[a-z]*r[a-z]*|-[a-z]*f[a-z]*r)\\b',
    description: 'Recursive delete (rm -rf)',
  },
  { pattern: '\\bmv\\s+/\\s', description: 'Moving root directory' },
  { pattern: '\\bshred\\b', description: 'Secure deletion (unrecoverable)' },

  // System privileges
  { pattern: '\\bsudo\\b', description: 'Elevated privileges (sudo)' },
  {
    pattern: '\\b(mkfs|dd|fdisk|parted)\\b',
    description: 'Disk formatting/operations',
  },
  {
    pattern: '>\\s*/dev/(sd|hd|nvme|disk)',
    description: 'Redirect to disk device',
  },
  {
    pattern: '\\bchmod\\s+(-[a-z]*\\s+)?7[0-7]{2}\\b',
    description: 'Permissive chmod (7xx)',
  },
  {
    pattern: '\\bchmod\\s+-R\\s+777\\b',
    description: 'Recursive world-writable',
  },
  {
    pattern: '\\bchown\\s+(-[a-z]*\\s+)?root\\b',
    description: 'Change owner to root',
  },

  // Remote execution
  {
    pattern: '\\b(curl|wget)\\b.*\\|\\s*(bash|sh|zsh)\\b',
    description: 'Remote script execution',
  },
  { pattern: ':\\(\\)\\s*\\{.*:\\|:.*\\}', description: 'Fork bomb' },

  // Process management
  {
    pattern: '\\bkill\\s+(-9|-KILL)\\s',
    description: 'Aggressive process killing',
  },
  { pattern: '\\bpkill\\s+(-9|-KILL)\\s', description: 'Aggressive pkill' },
  {
    pattern: '\\b(shutdown|reboot|halt|poweroff)\\b',
    description: 'System power commands',
  },

  // Git dangerous operations
  {
    pattern: '\\bgit\\s+push\\s+.*(-f|--force).*\\b(main|master)\\b',
    description: 'Force push to main/master',
  },
  {
    pattern: '\\bgit\\s+push\\s+.*\\b(main|master)\\b.*(-f|--force)',
    description: 'Force push to main/master',
  },
  {
    pattern: '\\bgit\\s+reset\\s+--hard\\b',
    description: 'Discard uncommitted changes',
  },
  {
    pattern: '\\bgit\\s+clean\\s+-[a-z]*f',
    description: 'Remove untracked files',
  },
  {
    pattern: '\\bgit\\s+push\\s+.*:(?!\\s)',
    description: 'Delete remote branch',
  },
  {
    pattern: '\\bgit\\s+push\\s+--delete\\b',
    description: 'Delete remote branch',
  },

  // Docker/container operations
  {
    pattern: '\\bdocker\\s+system\\s+prune\\b',
    description: 'Remove all unused docker data',
  },
  {
    pattern: '\\bdocker\\s+(rm|rmi)\\s+(-[a-z]*f|-[a-z]*a)',
    description: 'Force remove containers/images',
  },
  {
    pattern: '\\bdocker\\s+container\\s+prune\\b',
    description: 'Remove stopped containers',
  },

  // Database operations
  {
    pattern: '\\b(drop\\s+database|drop\\s+table)\\b',
    description: 'Drop database/table',
  },
  { pattern: '\\btruncate\\s+table\\b', description: 'Empty table' },
  {
    pattern: '\\bdelete\\s+from\\s+\\w+\\s*(;|$|where\\s+1)',
    description: 'Mass deletion without WHERE',
  },
] as const

export type DangerousPattern = {
  pattern: string
  description: string
}
