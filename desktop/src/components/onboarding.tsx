import { Check, ExternalLink, Loader2, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button, Input, Label } from '@moldable-ai/ui'
import { cn } from '../lib/utils'
import type { Workspace } from '../lib/workspaces'
import { WORKSPACE_COLORS } from '../lib/workspaces'
import type { AIServerHealth } from '../hooks/use-ai-server-health'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * Unified onboarding flow shown on app launch.
 *
 * IMPORTANT: This component exists not just for UX, but to provide a required
 * user gesture (click) before rendering iframes. WebKit defers painting iframe
 * content until user activation occurs. Without this, widget iframes would
 * appear stuck in loading state forever.
 *
 * See: prds/webkit-iframe-loading.prd.md
 *
 * Flow:
 * 1. Workspace selection (always shown first)
 * 2. API key setup (only if needed)
 */

type OnboardingStep = 'workspace' | 'api-key'
type KeyProvider = 'openrouter' | 'anthropic' | 'openai' | null

interface OnboardingProps {
  workspaces: Workspace[]
  health: AIServerHealth
  onComplete: (workspaceId: string) => void
  onCreateWorkspace: (name: string, color?: string) => Promise<Workspace>
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

const providerInfo: Record<
  Exclude<KeyProvider, null>,
  { name: string; color: string }
> = {
  openrouter: { name: 'OpenRouter', color: 'text-purple-500' },
  anthropic: { name: 'Anthropic', color: 'text-orange-500' },
  openai: { name: 'OpenAI', color: 'text-green-500' },
}

// Animation variants
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

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
}

const staggerItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
}

export function Onboarding({
  workspaces,
  health,
  onComplete,
  onCreateWorkspace,
  onHealthRetry,
}: OnboardingProps) {
  // Determine if we need API key step
  const needsApiKey = health.status === 'no-keys'
  const isServerStarting = health.status === 'unhealthy'

  // Track selected workspace (user must click to provide gesture)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  )

  // Current step
  const [step, setStep] = useState<OnboardingStep>('workspace')

  // Workspace creation
  const [isCreating, setIsCreating] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceColor, setNewWorkspaceColor] = useState<string>(
    WORKSPACE_COLORS[0],
  )
  const [createError, setCreateError] = useState<string | null>(null)
  const [isSubmittingWorkspace, setIsSubmittingWorkspace] = useState(false)

  // API key state
  const [apiKey, setApiKey] = useState('')
  const [isSavingKey, setIsSavingKey] = useState(false)
  const [saveKeyError, setSaveKeyError] = useState<string | null>(null)
  const [saveKeySuccess, setSaveKeySuccess] = useState(false)

  const detectedProvider = useMemo(() => detectKeyProvider(apiKey), [apiKey])
  const isValidKey = apiKey.trim().length > 20 && detectedProvider !== null

  const handleSelectWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId)

    // If we need API key, go to that step. Otherwise complete.
    if (needsApiKey) {
      setStep('api-key')
    } else if (isServerStarting) {
      // Server is starting, just complete and let the main app show loading
      onComplete(workspaceId)
    } else {
      onComplete(workspaceId)
    }
  }

  const handleCreateWorkspace = async () => {
    const trimmedName = newWorkspaceName.trim()
    if (!trimmedName) {
      setCreateError('Name is required')
      return
    }

    if (
      workspaces.some((w) => w.name.toLowerCase() === trimmedName.toLowerCase())
    ) {
      setCreateError('A workspace with this name already exists')
      return
    }

    setIsSubmittingWorkspace(true)
    setCreateError(null)

    try {
      const workspace = await onCreateWorkspace(trimmedName, newWorkspaceColor)
      // Select the newly created workspace
      handleSelectWorkspace(workspace.id)
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create workspace',
      )
      setIsSubmittingWorkspace(false)
    }
  }

  const handleSaveApiKey = useCallback(async () => {
    if (!isValidKey || !selectedWorkspaceId) return

    setIsSavingKey(true)
    setSaveKeyError(null)

    try {
      await invoke<string>('save_api_key', { apiKey: apiKey.trim() })
      setSaveKeySuccess(true)

      // Brief delay to show success, then complete onboarding
      setTimeout(async () => {
        await onHealthRetry()
        onComplete(selectedWorkspaceId)
      }, 500)
    } catch (error) {
      console.error('Failed to save API key:', error)
      setSaveKeyError(
        error instanceof Error ? error.message : 'Failed to save API key',
      )
      setIsSavingKey(false)
    }
  }, [apiKey, isValidKey, selectedWorkspaceId, onComplete, onHealthRetry])

  const handleOpenUrl = useCallback(async (url: string) => {
    await open(url)
  }, [])

  const handleSkipApiKey = () => {
    if (selectedWorkspaceId) {
      onComplete(selectedWorkspaceId)
    }
  }

  return (
    <div className="bg-background flex h-screen w-screen flex-col items-center justify-center">
      <div className="flex w-full max-w-md flex-col items-center gap-6 px-6">
        {/* Logo - always visible */}
        <motion.div
          className="bg-primary/10 flex size-16 items-center justify-center rounded-full"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <img src="/logo.svg" alt="Moldable" className="size-8" />
        </motion.div>

        <AnimatePresence mode="wait">
          {/* Step 1: Workspace Selection */}
          {step === 'workspace' && (
            <motion.div
              key="workspace-step"
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
                  Welcome to Moldable
                </h1>
                <p className="text-muted-foreground text-sm">
                  {isCreating
                    ? 'Create a new workspace'
                    : 'Select a workspace to continue'}
                </p>
              </motion.div>

              <AnimatePresence mode="wait">
                {!isCreating ? (
                  <motion.div
                    key="workspace-list"
                    className="flex w-full max-w-[300px] flex-col gap-2"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={staggerContainer}
                  >
                    {workspaces.map((workspace, index) => (
                      <motion.button
                        key={workspace.id}
                        onClick={() => handleSelectWorkspace(workspace.id)}
                        className="bg-card hover:bg-muted border-border flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
                        variants={staggerItem}
                        transition={{ duration: 0.2, delay: index * 0.05 }}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: workspace.color }}
                        />
                        <span className="text-foreground text-sm font-medium">
                          {workspace.name}
                        </span>
                      </motion.button>
                    ))}

                    {/* Create new workspace button */}
                    <motion.button
                      onClick={() => setIsCreating(true)}
                      className="text-muted-foreground hover:text-foreground hover:bg-muted flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-transparent px-4 py-3 transition-colors hover:border-current"
                      variants={staggerItem}
                      transition={{
                        duration: 0.2,
                        delay: workspaces.length * 0.05,
                      }}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <Plus className="size-4" />
                      <span className="text-sm">New workspace</span>
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="create-form"
                    className="flex w-full flex-col gap-4"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={scaleIn}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="workspace-name">Name</Label>
                      <Input
                        id="workspace-name"
                        value={newWorkspaceName}
                        onChange={(e) => {
                          setNewWorkspaceName(e.target.value)
                          setCreateError(null)
                        }}
                        placeholder="e.g., Work, Side Project"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateWorkspace()
                        }}
                      />
                      {createError && (
                        <motion.p
                          className="text-destructive text-sm"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          {createError}
                        </motion.p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label>Color</Label>
                      <div className="flex flex-wrap gap-2">
                        {WORKSPACE_COLORS.map((color) => (
                          <motion.button
                            key={color}
                            type="button"
                            onClick={() => setNewWorkspaceColor(color)}
                            className={cn(
                              'size-6 cursor-pointer rounded-full transition-all',
                              newWorkspaceColor === color
                                ? 'ring-primary ring-2 ring-offset-2'
                                : '',
                            )}
                            style={{ backgroundColor: color }}
                            whileHover={{ scale: 1.15 }}
                            whileTap={{ scale: 0.95 }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setIsCreating(false)
                          setNewWorkspaceName('')
                          setCreateError(null)
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={handleCreateWorkspace}
                        disabled={
                          isSubmittingWorkspace || !newWorkspaceName.trim()
                        }
                      >
                        {isSubmittingWorkspace ? 'Creating...' : 'Create'}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Legal footer - only show when not creating */}
              <AnimatePresence>
                {!isCreating && (
                  <motion.p
                    className="text-muted-foreground max-w-[280px] text-center text-xs"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    By continuing, you agree to our{' '}
                    <a
                      href="https://moldable.sh/legal/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2"
                    >
                      Terms of Service
                    </a>{' '}
                    and{' '}
                    <a
                      href="https://moldable.sh/legal/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2"
                    >
                      Privacy Policy
                    </a>
                    .
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Step 2: API Key Setup */}
          {step === 'api-key' && (
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
                {!saveKeySuccess ? (
                  <motion.div
                    key="api-key-form"
                    className="flex w-full flex-col gap-4"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={fadeIn}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="relative">
                      <Input
                        type="password"
                        placeholder="OpenRouter, Anthropic, or OpenAI API key"
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value)
                          setSaveKeyError(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && isValidKey) {
                            handleSaveApiKey()
                          }
                        }}
                        className="font-mono text-sm"
                        autoFocus
                      />
                      <AnimatePresence>
                        {detectedProvider && (
                          <motion.span
                            className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${providerInfo[detectedProvider].color}`}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                          >
                            {providerInfo[detectedProvider].name}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>

                    <AnimatePresence>
                      {saveKeyError && (
                        <motion.p
                          className="text-xs text-red-500"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          {saveKeyError}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <Button
                      className="w-full cursor-pointer"
                      onClick={handleSaveApiKey}
                      disabled={!isValidKey || isSavingKey}
                    >
                      {isSavingKey ? (
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
                      onClick={handleSkipApiKey}
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
                          onClick={() =>
                            handleOpenUrl('https://openrouter.ai/keys')
                          }
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
                            handleOpenUrl(
                              'https://platform.openai.com/api-keys',
                            )
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
                    <p className="text-muted-foreground text-sm">
                      API key saved. Starting...
                    </p>
                    <Loader2 className="text-muted-foreground size-5 animate-spin" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
