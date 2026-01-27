import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  MessageSquare,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Label, Switch, cn } from '@moldable-ai/ui'
import {
  DEFAULT_GATEWAY_SETUP_ID,
  type GatewayConfig,
  type GatewayFormState,
  type GatewaySetupId,
  createDefaultGatewayFormState,
  gatewayConfigToFormState,
  getGatewaySetup,
} from '../lib/gateway-config'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { type Variants, motion } from 'framer-motion'
import { toast } from 'sonner'

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

interface SettingsGatewayProps {
  aiServerPort: number
  activeWorkspaceId?: string
  gatewayEnabled: boolean
  onGatewayEnabledChange: (value: boolean) => void
  gatewaySetupId: GatewaySetupId
  onGatewaySetupIdChange: (value: GatewaySetupId) => void
}

type GatewayStatus = 'checking' | 'running' | 'stopped'

type PairingEntry = {
  id: string
  code: string
  sender_id: string
  display_name?: string | null
  requested_at: number
  status: 'pending' | 'approved' | 'rejected' | 'expired'
}

type PairingChannelSnapshot = {
  pending: PairingEntry[]
  approved: PairingEntry[]
}

type PairingSnapshot = Record<string, PairingChannelSnapshot>

export function SettingsGateway({
  aiServerPort,
  activeWorkspaceId,
  gatewayEnabled: _gatewayEnabled,
  onGatewayEnabledChange,
  gatewaySetupId,
  onGatewaySetupIdChange,
}: SettingsGatewayProps) {
  const [formState, setFormState] = useState<GatewayFormState>(() =>
    createDefaultGatewayFormState({
      setupId: gatewaySetupId,
      workspaceId: activeWorkspaceId ?? null,
    }),
  )
  const [status, setStatus] = useState<GatewayStatus>('checking')
  const [isSaving, setIsSaving] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [showTelegramToken, setShowTelegramToken] = useState(false)
  const [pairingSnapshot, setPairingSnapshot] =
    useState<PairingSnapshot | null>(null)
  const [pairingLoading, setPairingLoading] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingBusyCode, setPairingBusyCode] = useState<string | null>(null)
  const [lastSavedToken, setLastSavedToken] = useState<string>('')

  const telegramSetup = useMemo(
    () => getGatewaySetup(DEFAULT_GATEWAY_SETUP_ID),
    [],
  )
  const telegramPending = useMemo(
    () => pairingSnapshot?.telegram?.pending ?? [],
    [pairingSnapshot],
  )

  const loadConfig = useCallback(async () => {
    try {
      const rawConfig = await invoke<GatewayConfig | null>('get_gateway_config')
      const newFormState = gatewayConfigToFormState(rawConfig, {
        setupId: gatewaySetupId,
        workspaceId: activeWorkspaceId ?? null,
      })
      setFormState(newFormState)
      setLastSavedToken(newFormState.telegramBotToken)
      // Auto-expand if Telegram is already configured
      if (rawConfig?.channels?.telegram?.bot_token) {
        setIsExpanded(true)
      }
    } catch (error) {
      console.error('Failed to load gateway config:', error)
      toast.error('Failed to load gateway config')
    } finally {
      setHasLoadedConfig(true)
    }
  }, [activeWorkspaceId, gatewaySetupId])

  const checkStatus = useCallback(async () => {
    setStatus('checking')
    try {
      const running = await invoke<boolean>('is_gateway_running')
      setStatus(running ? 'running' : 'stopped')
    } catch {
      setStatus('stopped')
    }
  }, [])

  // Fetch pairing list via Tauri command
  const refreshPairing = useCallback(async () => {
    if (status !== 'running') {
      setPairingSnapshot(null)
      setPairingError(null)
      return
    }

    setPairingLoading(true)
    setPairingError(null)
    try {
      const payload = await invoke<PairingSnapshot>('list_pairing')
      setPairingSnapshot(payload ?? null)
    } catch (error) {
      setPairingError(
        error instanceof Error ? error.message : 'Failed to load pairing',
      )
    } finally {
      setPairingLoading(false)
    }
  }, [status])

  // Handle pairing actions via Tauri commands
  const handlePairingAction = useCallback(
    async (channel: string, code: string, action: 'approve' | 'reject') => {
      setPairingBusyCode(code)
      try {
        if (action === 'approve') {
          await invoke('approve_pairing', { channel, code })
        } else {
          await invoke('deny_pairing', { channel, code })
        }
        toast.success(
          action === 'approve' ? 'Pairing approved' : 'Pairing rejected',
        )
        await refreshPairing()
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to update pairing',
        )
      } finally {
        setPairingBusyCode(null)
      }
    },
    [refreshPairing],
  )

  const formatRequestedAt = useCallback((value: number) => {
    if (!value) return 'Unknown time'
    return new Date(value * 1000).toLocaleString()
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  useEffect(() => {
    refreshPairing()
  }, [refreshPairing])

  // Listen for pairing events to auto-refresh
  useEffect(() => {
    const unlistenRequested = listen('gateway:pairing-requested', () => {
      refreshPairing()
    })
    const unlistenApproved = listen('gateway:pairing-approved', () => {
      refreshPairing()
    })
    const unlistenRejected = listen('gateway:pairing-rejected', () => {
      refreshPairing()
    })

    return () => {
      unlistenRequested.then((fn) => fn())
      unlistenApproved.then((fn) => fn())
      unlistenRejected.then((fn) => fn())
    }
  }, [refreshPairing])

  const setupIsValid = useMemo(() => {
    if (formState.telegramEnabled && !formState.telegramBotToken.trim()) {
      return false
    }
    return true
  }, [formState.telegramEnabled, formState.telegramBotToken])

  const handleToggleTelegram = useCallback(
    async (enabled: boolean) => {
      // Keep the token in local state - just toggle enabled
      setFormState((prev) => ({
        ...prev,
        telegramEnabled: enabled,
      }))

      // If disabling, save immediately via gateway WebSocket (preserve token)
      if (!enabled) {
        setIsSaving(true)
        try {
          await invoke('gateway_config_patch', {
            patch: {
              channels: {
                telegram: {
                  enabled: false,
                  // Don't send bot_token - preserve existing value
                },
              },
            },
          })
          await loadConfig() // Reload to get updated config
          onGatewayEnabledChange(false)
          toast.success('Telegram disabled')
        } catch (error) {
          console.error('Failed to save config:', error)
          toast.error('Failed to disable Telegram')
        } finally {
          setIsSaving(false)
        }
      }
    },
    [loadConfig, onGatewayEnabledChange],
  )

  // Auto-save when bot token changes (on blur)
  const handleSaveConfig = useCallback(async () => {
    if (!formState.telegramEnabled || !formState.telegramBotToken.trim()) return
    // Only save if the token has actually changed
    if (formState.telegramBotToken === lastSavedToken) return

    setIsSaving(true)
    try {
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
                workspace_id: activeWorkspaceId || null,
              },
            ],
          },
        },
      })
      setLastSavedToken(formState.telegramBotToken)
      await loadConfig()
      onGatewayEnabledChange(formState.telegramEnabled)
      onGatewaySetupIdChange(DEFAULT_GATEWAY_SETUP_ID)
      await checkStatus()
      toast.success('Settings saved! Send /start to your bot to pair.')
    } catch (error) {
      console.error('Failed to save config:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to save config',
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    aiServerPort,
    activeWorkspaceId,
    checkStatus,
    formState,
    lastSavedToken,
    loadConfig,
    onGatewayEnabledChange,
    onGatewaySetupIdChange,
  ])

  const handleRestart = useCallback(async () => {
    setIsRestarting(true)
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
                workspace_id: formState.workspaceId || null,
              },
            ],
          },
        },
      })

      await loadConfig() // Reload to get updated config
      await invoke('restart_gateway')
      await checkStatus()
      toast.success('Gateway restarted')
    } catch (error) {
      console.error('Failed to restart gateway:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to restart gateway',
      )
    } finally {
      setIsRestarting(false)
    }
  }, [aiServerPort, checkStatus, formState, loadConfig])

  if (!hasLoadedConfig) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-base font-semibold">Gateway</h2>
          <p className="text-muted-foreground text-xs">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold">Gateway</h2>
        <p className="text-muted-foreground text-xs">
          Connect to Moldable from anywhere via Telegram.
        </p>
      </div>

      {/* Gateway status */}
      <div className="bg-muted/30 border-border flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
        <div className="flex items-center gap-2">
          {status === 'running' ? (
            <CheckCircle2 className="text-primary size-4" />
          ) : status === 'checking' ? (
            <RefreshCcw className="text-muted-foreground size-4 animate-spin" />
          ) : (
            <AlertTriangle className="text-muted-foreground size-4" />
          )}
          <div>
            <p className="text-sm font-medium">
              {status === 'running'
                ? 'Gateway running'
                : status === 'checking'
                  ? 'Checking...'
                  : 'Gateway stopped'}
            </p>
            <p className="text-muted-foreground text-xs">
              {status === 'running'
                ? formState.telegramEnabled
                  ? 'Telegram active'
                  : 'Private mode (no channels)'
                : 'Not accepting remote connections'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={checkStatus}
            disabled={status === 'checking'}
          >
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={handleRestart}
            disabled={isRestarting || !setupIsValid}
          >
            <RefreshCcw
              className={cn('mr-2 size-4', isRestarting && 'animate-spin')}
            />
            {isRestarting ? 'Restarting...' : 'Restart'}
          </Button>
        </div>
      </div>

      {/* Telegram channel with HeightReveal */}
      <div className="space-y-0">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'border-border bg-card hover:bg-muted/50 relative z-10 flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all',
            isExpanded && 'shadow-md',
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

        <HeightReveal show={isExpanded} skipInitialAnimation>
          <div className="bg-muted/30 border-border mx-4 -mt-2 rounded-b-xl border border-t-0 px-4 pb-4 pt-6 shadow-inner">
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

            {/* Config fields */}
            {(formState.telegramEnabled || formState.telegramBotToken) && (
              <div className="flex flex-col gap-4">
                {/* Bot token input */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="settings-telegram-token" className="text-xs">
                    Bot token
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="settings-telegram-token"
                      type={showTelegramToken ? 'text' : 'password'}
                      value={formState.telegramBotToken}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          telegramBotToken: e.target.value,
                        }))
                      }
                      onBlur={handleSaveConfig}
                      placeholder="123456:ABCDEF..."
                      className="font-mono text-xs"
                      disabled={isSaving}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 cursor-pointer"
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

      {/* Pairing requests */}
      {formState.telegramEnabled && status === 'running' && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Pairing requests</p>
              <p className="text-muted-foreground text-xs">
                Approve users before they can message your bot.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={refreshPairing}
              disabled={pairingLoading}
            >
              <RefreshCcw
                className={cn('mr-2 size-4', pairingLoading && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
          <div className="bg-muted/20 border-border flex flex-col gap-3 rounded-lg border px-4 py-3">
            {pairingError ? (
              <p className="text-destructive text-xs">{pairingError}</p>
            ) : pairingLoading ? (
              <p className="text-muted-foreground text-xs">
                Loading pairing requests...
              </p>
            ) : telegramPending.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No pending requests. Send /start to your bot to create one.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {telegramPending.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {entry.display_name || entry.sender_id}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Code <span className="font-mono">{entry.code}</span> ·{' '}
                        {formatRequestedAt(entry.requested_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="cursor-pointer"
                        disabled={pairingBusyCode === entry.code}
                        onClick={() =>
                          handlePairingAction('telegram', entry.code, 'approve')
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                        disabled={pairingBusyCode === entry.code}
                        onClick={() =>
                          handlePairingAction('telegram', entry.code, 'reject')
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
