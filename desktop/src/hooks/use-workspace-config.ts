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
  /** Custom dangerous command patterns (regex strings) added by user */
  CUSTOM_DANGEROUS_PATTERNS: 'customDangerousPatterns',
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
 */
export const DEFAULT_DANGEROUS_PATTERNS = [
  {
    pattern: '\\brm\\s+(-[a-z]*r[a-z]*|-[a-z]*f[a-z]*r)\\b',
    description: 'Recursive delete (rm -rf)',
  },
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
    pattern: '\\b(curl|wget)\\b.*\\|\\s*(bash|sh|zsh)\\b',
    description: 'Remote script execution',
  },
  { pattern: ':\\(\\)\\s*\\{.*:\\|:.*\\}', description: 'Fork bomb' },
  {
    pattern: '\\bchmod\\s+(-[a-z]*\\s+)?7[0-7]{2}\\b',
    description: 'Permissive chmod (7xx)',
  },
  {
    pattern: '\\bchown\\s+(-[a-z]*\\s+)?root\\b',
    description: 'Change owner to root',
  },
  {
    pattern: '\\bgit\\s+push\\s+.*(-f|--force).*\\b(main|master)\\b',
    description: 'Force push to main/master',
  },
  {
    pattern: '\\bgit\\s+push\\s+.*\\b(main|master)\\b.*(-f|--force)',
    description: 'Force push to main/master',
  },
  {
    pattern: '\\b(drop\\s+database|drop\\s+table)\\b',
    description: 'Database drop commands',
  },
] as const

export type DangerousPattern = {
  pattern: string
  description: string
}
