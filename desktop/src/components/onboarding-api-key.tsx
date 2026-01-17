import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button, Input } from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { AnimatePresence, motion } from 'framer-motion'

type KeyProvider = 'openrouter' | 'anthropic' | 'openai' | null

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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const detectedProvider = useMemo(() => detectKeyProvider(apiKey), [apiKey])
  const isValidKey = apiKey.trim().length > 20 && detectedProvider !== null

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
