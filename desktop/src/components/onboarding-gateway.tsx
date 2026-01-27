import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Label, Switch, cn } from '@moldable-ai/ui'
import {
  DEFAULT_GATEWAY_SETUP_ID,
  DEFAULT_HTTP_PORT,
  type GatewayConfig,
  type GatewayFormState,
  type GatewaySetupId,
  createDefaultGatewayFormState,
  getGatewaySetup,
} from '../lib/gateway-config'
import { SHARED_PREFERENCE_KEYS } from '../hooks/use-workspace-config'
import { invoke } from '@tauri-apps/api/core'
import { type Variants, motion } from 'framer-motion'
import { toast } from 'sonner'

type GatewayStatus = 'checking' | 'running' | 'stopped'

// HeightReveal component for smooth expand/collapse animation
type HeightRevealProps = {
  show: boolean
  children: React.ReactNode
  className?: string
  skipInitialAnimation?: boolean
}

const HeightReveal = forwardRef<HTMLDivElement, HeightRevealProps>(
  ({ show, children, className, skipInitialAnimation }, ref) => {
    const variants: Variants = {
      show: {
        height: 'auto',
        opacity: 1,
        y: 0,
        visibility: 'visible',
        transition: {
          height: { duration: 0.2 },
          opacity: { duration: 0.2 },
          y: { duration: 0.2 },
        },
      },
      hide: {
        height: 0,
        opacity: 0,
        y: -20,
        transition: {
          height: { duration: 0.2 },
          opacity: { duration: 0.15 },
          y: { duration: 0.2 },
        },
        transitionEnd: {
          visibility: 'hidden' as const,
        },
      },
    }

    return (
      <motion.div
        ref={ref}
        initial={skipInitialAnimation ? 'show' : 'hide'}
        animate={show ? 'show' : 'hide'}
        variants={variants}
        className={cn('overflow-hidden', className)}
      >
        {children}
      </motion.div>
    )
  },
)
HeightReveal.displayName = 'HeightReveal'

interface OnboardingGatewayProps {
  workspaceId: string
  aiServerPort: number
  onComplete: () => void
  onGatewayEnabledChange?: (enabled: boolean) => void
  onGatewaySetupIdChange?: (setupId: GatewaySetupId) => void
  variant?: 'onboarding' | 'settings'
}

export function OnboardingGateway({
  workspaceId,
  aiServerPort,
  onComplete,
  onGatewayEnabledChange,
  onGatewaySetupIdChange,
  variant = 'onboarding',
}: OnboardingGatewayProps) {
  const isSettingsVariant = variant === 'settings'
  const [isExpanded, setIsExpanded] = useState(isSettingsVariant)
  const [isSaving, setIsSaving] = useState(false)
  const [showTelegramToken, setShowTelegramToken] = useState(false)
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('checking')

  const telegramSetup = useMemo(
    () => getGatewaySetup(DEFAULT_GATEWAY_SETUP_ID),
    [],
  )

  const [formState, setFormState] = useState<GatewayFormState>(() =>
    createDefaultGatewayFormState({
      setupId: DEFAULT_GATEWAY_SETUP_ID,
      workspaceId,
    }),
  )

  // Check gateway status
  const checkStatus = useCallback(async (httpPort: number) => {
    setGatewayStatus('checking')
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1500)
      const response = await fetch(`http://127.0.0.1:${httpPort}/health`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      setGatewayStatus(response.ok ? 'running' : 'stopped')
    } catch {
      setGatewayStatus('stopped')
    }
  }, [])

  // Load existing config on mount
  useEffect(() => {
    invoke<GatewayConfig | null>('get_gateway_config')
      .then((config) => {
        const httpPort = config?.gateway?.http?.port ?? DEFAULT_HTTP_PORT
        checkStatus(httpPort)
        if (config?.channels?.telegram?.enabled) {
          setFormState((prev) => ({
            ...prev,
            telegramEnabled: true,
            telegramBotToken: config.channels?.telegram?.bot_token ?? '',
            telegramRequireMention:
              config.channels?.telegram?.require_mention ?? true,
          }))
          // Auto-expand if already configured
          if (config.channels?.telegram?.bot_token) {
            setIsExpanded(true)
          }
        }
      })
      .catch((error) => {
        console.error('Failed to load gateway config:', error)
        setGatewayStatus('stopped')
      })
  }, [checkStatus])

  const setupIsValid = useMemo(() => {
    if (formState.telegramEnabled && !formState.telegramBotToken.trim()) {
      return false
    }
    return true
  }, [formState.telegramEnabled, formState.telegramBotToken])

  const handleToggleTelegram = useCallback(
    async (enabled: boolean) => {
      const newState = {
        ...formState,
        telegramEnabled: enabled,
        telegramBotToken: enabled ? formState.telegramBotToken : '',
      }
      setFormState(newState)

      // If disabling, save immediately via gateway WebSocket
      if (!enabled) {
        setIsSaving(true)
        try {
          await invoke('gateway_config_patch', {
            patch: {
              channels: {
                telegram: {
                  enabled: false,
                  bot_token: null,
                },
              },
            },
          })
          toast.success('Telegram disabled')
        } catch (error) {
          console.error('Failed to save config:', error)
          toast.error('Failed to disable Telegram')
        } finally {
          setIsSaving(false)
        }
      }
    },
    [formState],
  )

  const handleSave = useCallback(async () => {
    if (!setupIsValid) return

    setIsSaving(true)
    try {
      // Patch config via gateway WebSocket (handles validation, tokens, permissions)
      await invoke('gateway_config_patch', {
        patch: {
          channels: {
            telegram: {
              enabled: formState.telegramEnabled,
              bot_token: formState.telegramBotToken || null,
              require_mention: formState.telegramRequireMention,
            },
          },
          pairing: {
            human_friendly_messages: true,
            app_name: 'Moldable',
          },
          ai: {
            default_adapter: 'ai-server',
            adapters: [
              {
                type: 'ai-server',
                name: 'ai-server',
                base_url: `http://127.0.0.1:${aiServerPort}`,
                workspace_id: workspaceId || null,
              },
            ],
          },
        },
      })

      await invoke('set_shared_preference', {
        key: SHARED_PREFERENCE_KEYS.GATEWAY_ENABLED,
        value: formState.telegramEnabled,
      })
      await invoke('set_shared_preference', {
        key: SHARED_PREFERENCE_KEYS.GATEWAY_SETUP_ID,
        value: DEFAULT_GATEWAY_SETUP_ID,
      })

      onGatewayEnabledChange?.(formState.telegramEnabled)
      onGatewaySetupIdChange?.(DEFAULT_GATEWAY_SETUP_ID)

      if (formState.telegramEnabled) {
        toast.success('Telegram enabled! Send /start to your bot to pair.')
      }

      onComplete()
    } catch (error) {
      console.error('Failed to save gateway config:', error)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to save gateway config',
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    aiServerPort,
    formState,
    onComplete,
    onGatewayEnabledChange,
    onGatewaySetupIdChange,
    setupIsValid,
    workspaceId,
  ])

  const handleSkip = useCallback(() => {
    invoke('set_shared_preference', {
      key: SHARED_PREFERENCE_KEYS.GATEWAY_ENABLED,
      value: false,
    }).catch((error) => {
      console.error('Failed to persist gateway preference:', error)
    })
    onGatewayEnabledChange?.(false)
    onComplete()
  }, [onComplete, onGatewayEnabledChange])

  return (
    <motion.div
      key="gateway-step"
      className="flex w-full flex-col items-center gap-6"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-foreground text-xl font-medium">
          {isSettingsVariant ? 'Remote access' : 'Enable remote access'}
        </h1>
        <p className="text-muted-foreground text-center text-sm">
          {isSettingsVariant
            ? 'Connect to Moldable from anywhere via Telegram.'
            : 'Connect to Moldable from your phone via Telegram. This is optional.'}
        </p>
      </div>

      {/* Gateway status indicator */}
      <div className="flex items-center gap-2 text-sm">
        {gatewayStatus === 'checking' && (
          <>
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
            <span className="text-muted-foreground">Checking gateway...</span>
          </>
        )}
        {gatewayStatus === 'running' && (
          <>
            <CheckCircle2 className="text-primary size-4" />
            <span className="text-muted-foreground">
              Gateway running{formState.telegramEnabled ? '' : ' (Private)'}
            </span>
          </>
        )}
        {gatewayStatus === 'stopped' && (
          <>
            <XCircle className="text-destructive size-4" />
            <span className="text-muted-foreground">Gateway not running</span>
          </>
        )}
      </div>

      {/* Telegram channel row with expansion */}
      <div className="w-full space-y-0">
        {/* Channel row - acts as trigger */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'border-border bg-card hover:bg-muted/50 flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
            isExpanded && 'rounded-b-none border-b-0',
          )}
        >
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-2">
              <MessageSquare className="text-primary size-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-medium">{telegramSetup.title}</span>
              <span className="text-muted-foreground text-xs">
                {telegramSetup.description}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {formState.telegramEnabled && (
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                Active
              </span>
            )}
            <ChevronDown
              className={cn(
                'text-muted-foreground size-5 transition-transform',
                isExpanded && 'rotate-180',
              )}
            />
          </div>
        </button>

        {/* Expanded config - tucks under the row */}
        <HeightReveal
          show={isExpanded}
          skipInitialAnimation={isSettingsVariant}
        >
          <div className="bg-muted/30 mx-4 -mt-px rounded-b-xl border px-4 py-4 shadow-inner">
            {/* Enable toggle */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-muted-foreground size-4" />
                <span className="text-sm font-medium">Enable Telegram</span>
              </div>
              <Switch
                checked={formState.telegramEnabled}
                onCheckedChange={handleToggleTelegram}
                disabled={isSaving}
                className="cursor-pointer"
              />
            </div>

            {/* Config fields - show when enabled or when there's a token */}
            {(formState.telegramEnabled || formState.telegramBotToken) && (
              <div className="flex flex-col gap-4">
                {/* Bot token input */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="telegram-token" className="text-xs">
                    Bot token
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="telegram-token"
                      type={showTelegramToken ? 'text' : 'password'}
                      value={formState.telegramBotToken}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          telegramBotToken: e.target.value,
                        }))
                      }
                      placeholder="123456:ABCDEF..."
                      className="font-mono text-xs"
                      disabled={isSaving}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 cursor-pointer"
                      aria-label={
                        showTelegramToken
                          ? 'Hide bot token'
                          : 'Reveal bot token'
                      }
                      onClick={() => setShowTelegramToken((prev) => !prev)}
                    >
                      {showTelegramToken ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Setup instructions */}
                <div className="bg-background/50 rounded-lg border px-3 py-2.5">
                  <p className="mb-2 text-xs font-medium">Quick setup</p>
                  <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                    <li>
                      Open Telegram and chat with{' '}
                      <span className="font-medium">@BotFather</span>
                    </li>
                    <li>
                      Send <span className="font-mono">/newbot</span> and follow
                      the prompts
                    </li>
                    <li>Copy the bot token and paste it above</li>
                    <li>
                      After saving, send{' '}
                      <span className="font-mono">/start</span> to your bot to
                      pair
                    </li>
                  </ol>
                </div>

                {/* Require mention toggle */}
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={formState.telegramRequireMention}
                    onCheckedChange={(value) =>
                      setFormState((prev) => ({
                        ...prev,
                        telegramRequireMention: value,
                      }))
                    }
                    disabled={isSaving}
                    className="cursor-pointer"
                  />
                  <span className="text-muted-foreground">
                    Require @mention in group chats (recommended)
                  </span>
                </label>

                {/* Risks disclosure */}
                <div className="text-muted-foreground space-y-1 text-xs">
                  <p className="font-medium">Things to know:</p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {telegramSetup.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </HeightReveal>
      </div>

      {/* Action buttons */}
      <div className="flex w-full flex-col gap-2">
        <Button
          className="w-full cursor-pointer"
          onClick={handleSave}
          disabled={isSaving || (formState.telegramEnabled && !setupIsValid)}
        >
          {isSaving
            ? 'Saving...'
            : formState.telegramEnabled
              ? 'Save and continue'
              : 'Continue'}
        </Button>
        {!isSettingsVariant && (
          <Button
            variant="ghost"
            className="w-full cursor-pointer"
            onClick={handleSkip}
            disabled={isSaving}
          >
            Skip for now
          </Button>
        )}
      </div>
    </motion.div>
  )
}
