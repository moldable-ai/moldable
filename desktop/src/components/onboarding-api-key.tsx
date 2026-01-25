import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Switch } from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { AnimatePresence, motion } from 'framer-motion'

type KeyProvider = 'openrouter' | 'anthropic' | 'openai' | null

interface ApiKeyInfo {
  provider: string
  env_var: string
  is_configured: boolean
  masked_value: string | null
  source?: 'env' | 'codex-cli' | null
}

interface OnboardingApiKeyProps {
  onComplete: () => void
  onSkip: () => void
  onHealthRetry: () => void
}

/** Detect the provider from an API key based on its prefix */
function detectKeyProvider(key: string): KeyProvider {
  const trimmed = key.trim()
  if (trimmed.startsWith('sk-or-')) return 'openrouter'
  if (trimmed.startsWith('sk-ant-')) return 'anthropic'
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-'))
    return 'openai'
  return null
}

const fadeIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

const scaleIn = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
}

export function OnboardingApiKey({
  onComplete,
  onSkip,
  onHealthRetry,
}: OnboardingApiKeyProps) {
  const [apiKey, setApiKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isContinuingWithCodex, setIsContinuingWithCodex] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [useCodexCli, setUseCodexCli] = useState(true)
  const [codexDetected, setCodexDetected] = useState(false)
  const [isCheckingCodex, setIsCheckingCodex] = useState(false)

  const detectedProvider = useMemo(() => detectKeyProvider(apiKey), [apiKey])
  const isValidKey = apiKey.trim().length > 20 && detectedProvider !== null

  const refreshCodexStatus = useCallback(async () => {
    setIsCheckingCodex(true)
    try {
      const [pref, keys] = await Promise.all([
        invoke<unknown>('get_shared_preference', { key: 'useCodexCliAuth' }),
        invoke<ApiKeyInfo[]>('get_api_key_status'),
      ])
      const prefValue = typeof pref === 'boolean' ? pref : true
      setUseCodexCli(prefValue)

      const openaiKey = keys.find((key) => key.provider === 'OpenAI')
      const detected = openaiKey?.source === 'codex-cli'
      setCodexDetected(!!detected)

      if (detected && typeof pref !== 'boolean') {
        await invoke('set_shared_preference', {
          key: 'useCodexCliAuth',
          value: true,
        })
        setUseCodexCli(true)
      }
    } catch (error) {
      console.error('Failed to refresh Codex CLI status:', error)
      setUseCodexCli(true)
      setCodexDetected(false)
    } finally {
      setIsCheckingCodex(false)
    }
  }, [])

  useEffect(() => {
    refreshCodexStatus()
  }, [refreshCodexStatus])

  const handleSave = useCallback(async () => {
    if (!isValidKey) return

    setIsSaving(true)
    setSaveError(null)

    try {
      await invoke<string>('save_api_key', { apiKey: apiKey.trim() })
      setSaveSuccess(true)
      setIsSaving(false)

      // Brief delay to show success, then continue
      setTimeout(async () => {
        try {
          await onHealthRetry()
        } catch (err) {
          console.error('Error refreshing health:', err)
        }
        onComplete()
      }, 500)
    } catch (error) {
      console.error('Failed to save API key:', error)
      setSaveError(error instanceof Error ? error.message : String(error))
      setIsSaving(false)
    }
  }, [apiKey, isValidKey, onHealthRetry, onComplete])

  const handleCodexToggle = useCallback(
    async (value: boolean) => {
      setUseCodexCli(value)
      try {
        await invoke('set_shared_preference', {
          key: 'useCodexCliAuth',
          value,
        })
        await onHealthRetry()
      } catch (error) {
        console.error('Failed to update Codex CLI preference:', error)
        setUseCodexCli(!value)
      }
    },
    [onHealthRetry],
  )

  const handleContinueWithCodex = useCallback(async () => {
    if (!codexDetected || !useCodexCli) return
    setIsContinuingWithCodex(true)
    try {
      await onHealthRetry()
      onComplete()
    } catch (error) {
      console.error('Error continuing with Codex CLI:', error)
    } finally {
      setIsContinuingWithCodex(false)
    }
  }, [codexDetected, useCodexCli, onHealthRetry, onComplete])

  const handleOpenUrl = useCallback(async (url: string) => {
    await open(url)
  }, [])

  return (
    <motion.div
      key="api-key-step"
      className="flex w-full flex-col items-center gap-6"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={fadeIn}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="flex flex-col items-center gap-2"
        variants={fadeIn}
      >
        <h1 className="text-foreground text-xl font-medium">
          Set up your API key
        </h1>
        <p className="text-muted-foreground text-center text-sm">
          Moldable needs an API key to power its AI features.
        </p>
      </motion.div>

      <AnimatePresence mode="wait">
        {!saveSuccess ? (
          <motion.div
            key="api-key-form"
            className="flex w-full flex-col gap-4"
            initial="initial"
            animate="animate"
            exit="exit"
            variants={fadeIn}
            transition={{ duration: 0.2 }}
          >
            <div className="bg-muted/30 flex flex-col gap-3 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Use Codex CLI OAuth</p>
                  <p className="text-muted-foreground text-xs">
                    If you already signed into Codex CLI, Moldable can use that
                    automatically.
                  </p>
                </div>
                <Switch
                  checked={useCodexCli}
                  onCheckedChange={handleCodexToggle}
                  className="cursor-pointer"
                />
              </div>
              {useCodexCli && codexDetected && (
                <p className="text-muted-foreground text-xs">
                  Codex CLI detected and connected.
                </p>
              )}
              {useCodexCli && !codexDetected && (
                <p className="text-muted-foreground text-xs">
                  Codex CLI not detected yet.
                </p>
              )}
              <Button
                variant="outline"
                className="w-full cursor-pointer"
                onClick={refreshCodexStatus}
                disabled={isCheckingCodex}
              >
                {isCheckingCodex ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Check Codex CLI'
                )}
              </Button>
              {useCodexCli && codexDetected && !apiKey.trim() && (
                <Button
                  className="w-full cursor-pointer"
                  onClick={handleContinueWithCodex}
                  disabled={isContinuingWithCodex}
                >
                  {isContinuingWithCodex ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Continuing...
                    </>
                  ) : (
                    'Continue with Codex CLI'
                  )}
                </Button>
              )}
            </div>

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
                  handleSave()
                }
              }}
              className="font-mono text-sm"
              autoFocus
            />

            <AnimatePresence>
              {saveError && (
                <motion.p
                  className="text-xs text-red-500"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {saveError}
                </motion.p>
              )}
            </AnimatePresence>

            <Button
              className="w-full cursor-pointer"
              onClick={handleSave}
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

            <Button
              variant="ghost"
              className="w-full cursor-pointer"
              onClick={onSkip}
            >
              Skip for now
            </Button>

            {/* Get a key links */}
            <motion.div
              className="text-muted-foreground space-y-1.5 text-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              <p className="text-center">Get an API key from:</p>
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
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="api-key-success"
            className="flex flex-col items-center gap-3"
            initial="initial"
            animate="animate"
            variants={scaleIn}
            transition={{ duration: 0.3, type: 'spring', bounce: 0.4 }}
          >
            <motion.div
              className="flex size-12 items-center justify-center rounded-full bg-green-500/10 text-green-500"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                duration: 0.4,
                type: 'spring',
                bounce: 0.5,
              }}
            >
              <Check className="size-6" />
            </motion.div>
            <p className="text-muted-foreground text-sm">API key saved!</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
