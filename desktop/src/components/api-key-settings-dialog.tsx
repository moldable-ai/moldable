import { ExternalLink, Key, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { toast } from 'sonner'

interface ApiKeyInfo {
  provider: string
  env_var: string
  is_configured: boolean
  masked_value: string | null
  source?: 'env' | 'codex-cli' | null
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

interface ApiKeySettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when API keys are added or removed - use to refresh health status */
  onKeysChanged?: () => void
}

export function ApiKeySettingsDialog({
  open,
  onOpenChange,
  onKeysChanged,
}: ApiKeySettingsDialogProps) {
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newApiKey, setNewApiKey] = useState('')
  const [isSaving, setSaving] = useState(false)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [useCodexCli, setUseCodexCli] = useState(true)

  const detectedProvider = detectKeyProvider(newApiKey)
  const isValidKey = newApiKey.trim().length > 20 && detectedProvider !== null

  const loadCodexPreference = useCallback(async () => {
    try {
      const value = await invoke<unknown>('get_shared_preference', {
        key: 'useCodexCliAuth',
      })
      if (typeof value === 'boolean') {
        setUseCodexCli(value)
      } else {
        setUseCodexCli(true)
      }
    } catch (error) {
      console.error('Failed to load Codex CLI preference:', error)
      setUseCodexCli(true)
    }
  }, [])

  const loadApiKeys = useCallback(async (): Promise<ApiKeyInfo[]> => {
    try {
      setIsLoading(true)
      const keys = await invoke<ApiKeyInfo[]>('get_api_key_status')
      setApiKeys(keys)
      return keys
    } catch (error) {
      console.error('Failed to load API keys:', error)
      toast.error('Failed to load API keys')
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadApiKeys()
      loadCodexPreference()
      setShowAddForm(false)
      setNewApiKey('')
    }
  }, [open, loadApiKeys, loadCodexPreference])

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

  const handleCheckCodexCli = useCallback(async () => {
    const keys = await loadApiKeys()
    const openaiKey = keys.find((key) => key.provider === 'OpenAI')
    if (openaiKey?.source === 'codex-cli') {
      toast.success('Codex CLI detected and synced')
    } else {
      toast.info(
        'Codex CLI not detected. Open Codex CLI once to sign in, then try again.',
      )
    }
  }, [loadApiKeys])

  const handleCodexToggle = useCallback(
    async (value: boolean) => {
      setUseCodexCli(value)
      try {
        await invoke('set_shared_preference', {
          key: 'useCodexCliAuth',
          value,
        })
        await loadApiKeys()
        onKeysChanged?.()
      } catch (error) {
        console.error('Failed to update Codex CLI preference:', error)
        toast.error('Failed to update Codex CLI preference')
        setUseCodexCli(!value)
      }
    },
    [loadApiKeys, onKeysChanged],
  )

  const configuredKeys = apiKeys.filter((k) => k.is_configured)
  const hasAnyKey = configuredKeys.length > 0
  const openaiKey = apiKeys.find((key) => key.provider === 'OpenAI')
  const shouldShowCodexSync =
    useCodexCli && !openaiKey?.is_configured && !newApiKey

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="size-5" />
            API Keys
          </DialogTitle>
          <DialogDescription>
            Manage your LLM provider API keys. These are stored locally in your
            ~/.moldable/shared/.env file or synced from Codex CLI when
            available.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
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
                      key={`${key.env_var}:${key.source ?? 'env'}`}
                      className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-foreground text-sm font-medium">
                          {key.provider}
                        </span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {key.masked_value}
                        </span>
                        {key.source === 'codex-cli' && (
                          <span className="text-muted-foreground text-[11px]">
                            Codex CLI
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-foreground h-8 cursor-pointer px-2"
                          onClick={() =>
                            handleOpenUrl(providerUrls[key.provider])
                          }
                        >
                          <ExternalLink className="size-4" />
                        </Button>
                        {key.source !== 'codex-cli' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 cursor-pointer px-2 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() =>
                              handleRemoveKey(key.env_var, key.provider)
                            }
                            disabled={removingKey === key.env_var}
                          >
                            {removingKey === key.env_var ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!hasAnyKey && !showAddForm && (
                <div className="text-muted-foreground py-6 text-center text-sm">
                  No API keys configured yet.
                </div>
              )}

              {/* Add key form */}
              {showAddForm ? (
                <div className="flex flex-col gap-3">
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

              <div className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Use Codex CLI OAuth</p>
                    <p className="text-muted-foreground text-xs">
                      When enabled, Moldable will use your Codex CLI sign-in for
                      OpenAI Codex models.
                    </p>
                  </div>
                  <Switch
                    checked={useCodexCli}
                    onCheckedChange={handleCodexToggle}
                    className="cursor-pointer"
                  />
                </div>
                {useCodexCli && openaiKey?.source === 'codex-cli' && (
                  <p className="text-muted-foreground text-xs">
                    Codex CLI detected and connected.
                  </p>
                )}
                {shouldShowCodexSync && (
                  <Button
                    variant="outline"
                    className="w-full cursor-pointer"
                    onClick={handleCheckCodexCli}
                  >
                    Check Codex CLI
                  </Button>
                )}
              </div>

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
      </DialogContent>
    </Dialog>
  )
}
