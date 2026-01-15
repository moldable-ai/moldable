import { useCallback, useEffect, useState } from 'react'
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  LLMProvider,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
  getVendorFromModel,
} from '@moldable-ai/ai/client'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'

/**
 * Preference keys stored in the workspace config (~/.moldable/workspaces/{id}/config.json)
 */
const PREF_KEYS = {
  MODEL: 'selectedModel',
  REASONING_EFFORT: 'reasoningEffort',
} as const

type ReasoningEffortByVendor = Record<string, ReasoningEffort>

/**
 * Hook for managing AI preferences (model, reasoning effort)
 *
 * Persists to config.json via Tauri commands, not localStorage.
 */
export function useMoldablePreferences() {
  const [model, setModelState] = useState<LLMProvider>(DEFAULT_MODEL)
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort>(
    DEFAULT_REASONING_EFFORT.anthropic,
  )
  const [isLoaded, setIsLoaded] = useState(false)

  // Load preferences on mount
  useEffect(() => {
    if (!isTauri()) {
      setIsLoaded(true)
      return
    }

    loadPreferences()
      .then(({ model, reasoningEffort }) => {
        setModelState(model)
        setReasoningEffortState(reasoningEffort)
      })
      .catch((error) => {
        console.error('Failed to load preferences:', error)
      })
      .finally(() => {
        setIsLoaded(true)
      })
  }, [])

  // Set model and update reasoning effort to match vendor
  const setModel = useCallback((newModel: string) => {
    setModelState(newModel as LLMProvider)
    persistPreference(PREF_KEYS.MODEL, newModel)

    // Load reasoning effort for the new vendor
    const vendor = getVendorFromModel(newModel)
    getReasoningEffortForVendor(vendor).then(setReasoningEffortState)
  }, [])

  // Set reasoning effort and persist by vendor
  // Accepts string to be compatible with UI components
  const setReasoningEffort = useCallback(
    (effort: string) => {
      const validEffort = effort as ReasoningEffort
      setReasoningEffortState(validEffort)
      persistReasoningEffortForVendor(model, validEffort)
    },
    [model],
  )

  return {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    isLoaded,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

async function loadPreferences(): Promise<{
  model: LLMProvider
  reasoningEffort: ReasoningEffort
}> {
  const [savedModel, savedEffortByVendor] = await Promise.all([
    invoke<string | null>('get_preference', { key: PREF_KEYS.MODEL }),
    invoke<ReasoningEffortByVendor | null>('get_preference', {
      key: PREF_KEYS.REASONING_EFFORT,
    }),
  ])

  // Validate model - check if it's a valid LLMProvider enum value
  const model = isValidModel(savedModel)
    ? (savedModel as LLMProvider)
    : DEFAULT_MODEL

  // Get effort for current vendor
  const vendor = getVendorFromModel(model)
  const reasoningEffort = getValidEffort(vendor, savedEffortByVendor?.[vendor])

  return { model, reasoningEffort }
}

async function getReasoningEffortForVendor(
  vendor: string,
): Promise<ReasoningEffort> {
  if (!isTauri()) {
    return DEFAULT_REASONING_EFFORT[
      vendor as keyof typeof DEFAULT_REASONING_EFFORT
    ]
  }

  try {
    const saved = await invoke<ReasoningEffortByVendor | null>(
      'get_preference',
      {
        key: PREF_KEYS.REASONING_EFFORT,
      },
    )
    return getValidEffort(vendor, saved?.[vendor])
  } catch {
    return DEFAULT_REASONING_EFFORT[
      vendor as keyof typeof DEFAULT_REASONING_EFFORT
    ]
  }
}

async function persistPreference(key: string, value: unknown): Promise<void> {
  if (!isTauri()) return

  try {
    await invoke('set_preference', { key, value })
  } catch (error) {
    console.error(`Failed to persist preference "${key}":`, error)
  }
}

async function persistReasoningEffortForVendor(
  model: string,
  effort: ReasoningEffort,
): Promise<void> {
  if (!isTauri()) return

  const vendor = getVendorFromModel(model)

  try {
    const existing = await invoke<ReasoningEffortByVendor | null>(
      'get_preference',
      { key: PREF_KEYS.REASONING_EFFORT },
    )
    const updated = { ...existing, [vendor]: effort }
    await invoke('set_preference', {
      key: PREF_KEYS.REASONING_EFFORT,
      value: updated,
    })
  } catch (error) {
    console.error('Failed to persist reasoning effort:', error)
  }
}

function isValidModel(model: unknown): model is string {
  return (
    typeof model === 'string' && AVAILABLE_MODELS.some((m) => m.id === model)
  )
}

function getValidEffort(
  vendor: string,
  effort: ReasoningEffort | undefined,
): ReasoningEffort {
  if (!effort) {
    return DEFAULT_REASONING_EFFORT[
      vendor as keyof typeof DEFAULT_REASONING_EFFORT
    ]
  }

  const options =
    REASONING_EFFORT_OPTIONS[vendor as keyof typeof REASONING_EFFORT_OPTIONS]
  if (options?.some((o) => o.value === effort)) {
    return effort
  }

  return DEFAULT_REASONING_EFFORT[
    vendor as keyof typeof DEFAULT_REASONING_EFFORT
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get available models (without icons - use VendorLogo component)
 */
export function getAvailableModels() {
  return AVAILABLE_MODELS
}

/**
 * Get reasoning effort options for a given model
 */
export function getReasoningEffortOptions(modelId: string) {
  const vendor = getVendorFromModel(modelId)
  return REASONING_EFFORT_OPTIONS[vendor]
}
