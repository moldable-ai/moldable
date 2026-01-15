import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button, Input } from '@moldable-ai/ui'
import type { AIServerHealth } from '../hooks/use-ai-server-health'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'

interface OnboardingDialogProps {
  health: AIServerHealth
  onRetry: () => void
}

type KeyProvider = 'openrouter' | 'anthropic' | 'openai' | null

/** Detect the provider from an API key based on its prefix */
function detectKeyProvider(key: string): KeyProvider {
  const trimmed = key.trim()
  if (trimmed.startsWith('sk-or-')) return 'openrouter'
  if (trimmed.startsWith('sk-ant-')) return 'anthropic'
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-'))
    return 'openai'
  return null
}

const providerInfo: Record<
  Exclude<KeyProvider, null>,
  { name: string; color: string }
> = {
  openrouter: { name: 'OpenRouter', color: 'text-purple-500' },
  anthropic: { name: 'Anthropic', color: 'text-orange-500' },
  openai: { name: 'OpenAI', color: 'text-green-500' },
}

export function OnboardingDialog({ health, onRetry }: OnboardingDialogProps) {
  const [apiKey, setApiKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const detectedProvider = useMemo(() => detectKeyProvider(apiKey), [apiKey])
  const isValidKey = apiKey.trim().length > 20 && detectedProvider !== null

  const handleSaveKey = useCallback(async () => {
    if (!isValidKey) return

    setIsSaving(true)
    setSaveError(null)

    try {
      // Save the key via Tauri command (writes to ~/.moldable/shared/.env)
      await invoke<string>('save_api_key', { apiKey: apiKey.trim() })
      setSaveSuccess(true)

      // Brief delay to show success, then retry health check
      setTimeout(async () => {
        await onRetry()
      }, 500)
    } catch (error) {
      console.error('Failed to save API key:', error)
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save API key',
      )
      setIsSaving(false)
    }
  }, [apiKey, isValidKey, onRetry])

  const handleOpenUrl = useCallback(async (url: string) => {
    await open(url)
  }, [])

  const isServerStarting = health.status === 'unhealthy'
  const needsKeys = health.status === 'no-keys'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="border-border bg-card mx-4 w-full max-w-md rounded-xl border p-6 shadow-2xl">
        {/* Logo */}
        <div className="bg-primary/10 mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
          <img src="/logo.svg" alt="Moldable" className="size-6" />
        </div>

        {/* Title */}
        <h2 className="mb-2 text-center text-xl font-semibold">
          {isServerStarting ? 'Starting Moldable...' : 'Welcome to Moldable'}
        </h2>

        {/* Description */}
        <p className="text-muted-foreground mb-6 text-center text-sm">
          {isServerStarting
            ? 'This usually takes a few seconds.'
            : 'Paste your API key to get started.'}
        </p>

        {/* API Key Input */}
        {needsKeys && !saveSuccess && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Input
                  type="password"
                  placeholder="OpenRouter, Anthropic, or OpenAI API key"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setSaveError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isValidKey) {
                      handleSaveKey()
                    }
                  }}
                  className="font-mono text-sm"
                  autoFocus
                />
                {/* Provider badge */}
                {detectedProvider && (
                  <span
                    className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${providerInfo[detectedProvider].color}`}
                  >
                    {providerInfo[detectedProvider].name}
                  </span>
                )}
              </div>

              {/* Error message */}
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            </div>

            {/* Save button */}
            <Button
              className="w-full cursor-pointer"
              onClick={handleSaveKey}
              disabled={!isValidKey || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Continue'
              )}
            </Button>

            {/* Get a key links */}
            <div className="text-muted-foreground space-y-1.5 text-xs">
              <p>Get an API key from:</p>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                <button
                  onClick={() => handleOpenUrl('https://openrouter.ai/keys')}
                  className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  OpenRouter
                </button>
                <button
                  onClick={() =>
                    handleOpenUrl('https://console.anthropic.com/')
                  }
                  className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  Anthropic
                </button>
                <button
                  onClick={() =>
                    handleOpenUrl('https://platform.openai.com/api-keys')
                  }
                  className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  OpenAI
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success state */}
        {saveSuccess && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
              <Check className="size-6" />
            </div>
            <p className="text-muted-foreground text-sm">
              API key saved. Starting...
            </p>
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}

        {/* Server starting state */}
        {isServerStarting && (
          <div className="flex justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
