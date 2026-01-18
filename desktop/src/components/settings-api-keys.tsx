import { ExternalLink, Key, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { toast } from 'sonner'

interface ApiKeyInfo {
  provider: string
  env_var: string
  is_configured: boolean
  masked_value: string | null
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

const providerUrls: Record<string, string> = {
  OpenRouter: 'https://openrouter.ai/keys',
  Anthropic: 'https://console.anthropic.com/',
  OpenAI: 'https://platform.openai.com/api-keys',
}

interface SettingsApiKeysProps {
  /** Called when API keys are added or removed - use to refresh health status */
  onKeysChanged?: () => void
}

export function SettingsApiKeys({ onKeysChanged }: SettingsApiKeysProps) {
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newApiKey, setNewApiKey] = useState('')
  const [isSaving, setSaving] = useState(false)
  const [removingKey, setRemovingKey] = useState<string | null>(null)

  const detectedProvider = detectKeyProvider(newApiKey)
  const isValidKey = newApiKey.trim().length > 20 && detectedProvider !== null

  const loadApiKeys = useCallback(async () => {
    try {
      setIsLoading(true)
      const keys = await invoke<ApiKeyInfo[]>('get_api_key_status')
      setApiKeys(keys)
    } catch (error) {
      console.error('Failed to load API keys:', error)
      toast.error('Failed to load API keys')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApiKeys()
  }, [loadApiKeys])

  const handleSaveKey = useCallback(async () => {
    if (!isValidKey) return

    setSaving(true)
    try {
      const provider = await invoke<string>('save_api_key', {
        apiKey: newApiKey.trim(),
      })
      toast.success(`${provider} API key saved`)
      setNewApiKey('')
      setShowAddForm(false)
      await loadApiKeys()
      onKeysChanged?.()
    } catch (error) {
      console.error('Failed to save API key:', error)
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [newApiKey, isValidKey, loadApiKeys, onKeysChanged])

  const handleRemoveKey = useCallback(
    async (envVar: string, provider: string) => {
      setRemovingKey(envVar)
      try {
        await invoke('remove_api_key', { envVar })
        toast.success(`${provider} API key removed`)
        await loadApiKeys()
        onKeysChanged?.()
      } catch (error) {
        console.error('Failed to remove API key:', error)
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setRemovingKey(null)
      }
    },
    [loadApiKeys, onKeysChanged],
  )

  const handleOpenUrl = useCallback(async (url: string) => {
    await openUrl(url)
  }, [])

  const configuredKeys = apiKeys.filter((k) => k.is_configured)
  const hasAnyKey = configuredKeys.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">API Keys</h2>
        <p className="text-muted-foreground text-xs">
          Manage your LLM provider API keys. These are stored locally in your
          ~/.moldable/shared/.env file.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* Configured keys */}
          {hasAnyKey && (
            <div className="flex flex-col gap-2">
              {configuredKeys.map((key) => (
                <div
                  key={key.env_var}
                  className="bg-muted/30 flex items-center justify-between rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="bg-muted flex size-6 shrink-0 items-center justify-center rounded">
                      <Key className="text-muted-foreground size-3.5" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-foreground text-sm font-medium">
                        {key.provider}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {key.masked_value}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground h-8 cursor-pointer px-2"
                      onClick={() => handleOpenUrl(providerUrls[key.provider])}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 cursor-pointer px-2 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                      onClick={() => handleRemoveKey(key.env_var, key.provider)}
                      disabled={removingKey === key.env_var}
                    >
                      {removingKey === key.env_var ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!hasAnyKey && !showAddForm && (
            <div className="bg-muted/30 rounded-lg py-8 text-center">
              <Key className="text-muted-foreground mx-auto mb-2 size-6" />
              <p className="text-muted-foreground text-xs">
                No API keys configured yet.
              </p>
            </div>
          )}

          {/* Add key form */}
          {showAddForm ? (
            <div className="bg-muted/30 flex flex-col gap-3 rounded-lg p-4">
              <Input
                type="password"
                placeholder="OpenRouter, Anthropic, or OpenAI API key"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isValidKey) {
                    handleSaveKey()
                  }
                  if (e.key === 'Escape') {
                    setShowAddForm(false)
                    setNewApiKey('')
                  }
                }}
                className="font-mono text-sm"
                autoFocus
              />
              {newApiKey && detectedProvider && (
                <p className="text-muted-foreground text-xs">
                  Detected:{' '}
                  {detectedProvider === 'openrouter'
                    ? 'OpenRouter'
                    : detectedProvider === 'anthropic'
                      ? 'Anthropic'
                      : 'OpenAI'}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 cursor-pointer"
                  onClick={() => {
                    setShowAddForm(false)
                    setNewApiKey('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 cursor-pointer"
                  onClick={handleSaveKey}
                  disabled={!isValidKey || isSaving}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Key'
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full cursor-pointer"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="mr-2 size-4" />
              Add API Key
            </Button>
          )}

          {/* Help links */}
          <div className="text-muted-foreground border-t pt-4 text-xs">
            <p className="mb-2">Get an API key from:</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(providerUrls).map(([provider, url]) => (
                <button
                  key={provider}
                  onClick={() => handleOpenUrl(url)}
                  className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  {provider}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
