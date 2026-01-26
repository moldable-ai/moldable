import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from '@moldable-ai/ui'
import {
  GATEWAY_FEATURE_FLAGS,
  type GatewayConfig,
  type GatewayFormState,
  type GatewaySetupId,
  applySetupToState,
  createDefaultGatewayFormState,
  gatewayConfigToFormState,
  generateToken,
  getGatewaySetup,
  getVisibleGatewaySetups,
  mergeGatewayConfig,
} from '../lib/gateway-config'
import type { Workspace } from '../lib/workspaces'
import { OnboardingGateway } from './onboarding-gateway'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'

interface SettingsGatewayProps {
  aiServerPort: number
  workspaces: Workspace[]
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

const GATEWAY_PROTOCOL_VERSION = 1

const riskLevelStyles: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-primary/10 text-primary',
  medium: 'bg-muted text-foreground',
  high: 'bg-destructive/10 text-destructive',
}

export function SettingsGateway({
  aiServerPort,
  workspaces,
  activeWorkspaceId,
  gatewayEnabled,
  onGatewayEnabledChange,
  gatewaySetupId,
  onGatewaySetupIdChange,
}: SettingsGatewayProps) {
  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [formState, setFormState] = useState<GatewayFormState>(() =>
    createDefaultGatewayFormState({
      setupId: gatewaySetupId,
      workspaceId: activeWorkspaceId ?? null,
    }),
  )
  const [setupId, setSetupId] = useState<GatewaySetupId>(gatewaySetupId)
  const [configPath, setConfigPath] = useState<string | null>(null)
  const [status, setStatus] = useState<GatewayStatus>('checking')
  const [isSaving, setIsSaving] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showGatewayToken, setShowGatewayToken] = useState(false)
  const [showTelegramToken, setShowTelegramToken] = useState(false)
  const [showWhatsappVerifyToken, setShowWhatsappVerifyToken] = useState(false)
  const [showWhatsappAccessToken, setShowWhatsappAccessToken] = useState(false)
  const [pairingSnapshot, setPairingSnapshot] =
    useState<PairingSnapshot | null>(null)
  const [pairingLoading, setPairingLoading] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingBusyCode, setPairingBusyCode] = useState<string | null>(null)

  const whatsappAvailable = GATEWAY_FEATURE_FLAGS.whatsapp
  const visibleSetups = getVisibleGatewaySetups()
  const selectedSetup = useMemo(() => getGatewaySetup(setupId), [setupId])
  const telegramPending = useMemo(
    () => pairingSnapshot?.telegram?.pending ?? [],
    [pairingSnapshot],
  )
  const genericRisks = useMemo(
    () => [
      'Language models are susceptible to prompt injection and data exfiltration attacks.',
      'Every new skill or data connector adds new ways for attackers to exploit your machine or data.',
      'Only install trusted skills and data connectors built by official sources.',
      'Gateway can potentially expose your machine or data to the public internet for certain configurations.',
      'Chat messages are stored locally in gateway session logs and may contain sensitive information.',
      'Command execution or gateway nodes can access local data when approved.',
    ],
    [],
  )
  const onboardingWorkspaceId =
    formState.workspaceId ?? activeWorkspaceId ?? workspaces[0]?.id ?? null

  const loadConfig = useCallback(async () => {
    try {
      const [rawConfig, path] = await Promise.all([
        invoke<GatewayConfig | null>('get_gateway_config'),
        invoke<string>('get_gateway_config_path'),
      ])
      setConfig(rawConfig)
      setConfigPath(path)
      setFormState(
        gatewayConfigToFormState(rawConfig, {
          setupId: gatewaySetupId,
          workspaceId: activeWorkspaceId ?? null,
        }),
      )
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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1500)
      const response = await fetch(
        `http://127.0.0.1:${formState.httpPort}/health`,
        {
          signal: controller.signal,
        },
      )
      clearTimeout(timeout)
      setStatus(response.ok ? 'running' : 'stopped')
    } catch {
      setStatus('stopped')
    }
  }, [formState.httpPort])

  const gatewayUrl = useMemo(
    () => `ws://127.0.0.1:${formState.gatewayPort}`,
    [formState.gatewayPort],
  )

  const callGatewayMethod = useCallback(
    async (method: string, params: unknown = null) => {
      if (!formState.authToken) {
        throw new Error('Gateway token is missing')
      }

      return new Promise<unknown>((resolve, reject) => {
        let completed = false
        const ws = new WebSocket(gatewayUrl)

        const finish = (fn: () => void) => {
          if (completed) return
          completed = true
          fn()
        }

        const timeout = window.setTimeout(() => {
          finish(() => {
            ws.close()
            reject(new Error('Gateway request timed out'))
          })
        }, 4000)

        ws.onerror = () => {
          finish(() => {
            clearTimeout(timeout)
            reject(new Error('Failed to connect to gateway'))
          })
        }

        ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data)
            if (frame?.type !== 'res') return

            if (frame.id === 'connect-1') {
              if (!frame.ok) {
                throw new Error(frame?.error?.message || 'Gateway auth failed')
              }
              ws.send(
                JSON.stringify({
                  type: 'req',
                  id: 'req-1',
                  method,
                  params,
                }),
              )
              return
            }

            if (frame.id === 'req-1') {
              finish(() => {
                clearTimeout(timeout)
                ws.close()
                if (!frame.ok) {
                  reject(
                    new Error(
                      frame?.error?.message || 'Gateway request failed',
                    ),
                  )
                  return
                }
                resolve(frame?.payload ?? null)
              })
            }
          } catch (error) {
            finish(() => {
              clearTimeout(timeout)
              ws.close()
              reject(
                error instanceof Error
                  ? error
                  : new Error('Failed to read gateway response'),
              )
            })
          }
        }

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'req',
              id: 'connect-1',
              method: 'connect',
              params: {
                min_protocol: GATEWAY_PROTOCOL_VERSION,
                max_protocol: GATEWAY_PROTOCOL_VERSION,
                client: {
                  id: 'moldable-desktop',
                  version: 'desktop',
                  platform: 'desktop',
                },
                auth: {
                  token: formState.authToken,
                },
                role: 'operator',
                scopes: [],
              },
            }),
          )
        }
      })
    },
    [formState.authToken, gatewayUrl],
  )

  const refreshPairing = useCallback(async () => {
    if (!gatewayEnabled || status !== 'running') {
      setPairingSnapshot(null)
      setPairingError(null)
      return
    }

    setPairingLoading(true)
    setPairingError(null)
    try {
      const payload = await callGatewayMethod('pair.list')
      setPairingSnapshot((payload as PairingSnapshot) ?? null)
    } catch (error) {
      setPairingError(
        error instanceof Error ? error.message : 'Failed to load pairing',
      )
    } finally {
      setPairingLoading(false)
    }
  }, [callGatewayMethod, gatewayEnabled, status])

  const handlePairingAction = useCallback(
    async (channel: string, code: string, action: 'approve' | 'reject') => {
      setPairingBusyCode(code)
      try {
        await callGatewayMethod(`pair.${action}`, { channel, code })
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
    [callGatewayMethod, refreshPairing],
  )

  const formatRequestedAt = useCallback((value: number) => {
    if (!value) return 'Unknown time'
    return new Date(value * 1000).toLocaleString()
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (!hasLoadedConfig) return
    setShowOnboarding(!config && gatewayEnabled)
  }, [config, gatewayEnabled, hasLoadedConfig])

  useEffect(() => {
    setSetupId(gatewaySetupId)
    setFormState((prev) => applySetupToState(gatewaySetupId, prev))
  }, [gatewaySetupId])

  useEffect(() => {
    checkStatus()
  }, [checkStatus, gatewayEnabled])

  useEffect(() => {
    refreshPairing()
  }, [refreshPairing])

  const handleSetupChange = useCallback(
    (nextId: GatewaySetupId) => {
      setSetupId(nextId)
      onGatewaySetupIdChange(nextId)
      setFormState((prev) => applySetupToState(nextId, prev))
    },
    [onGatewaySetupIdChange],
  )

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const nextConfig = mergeGatewayConfig(config, formState, aiServerPort)
      await invoke('save_gateway_config', { config: nextConfig })
      setConfig(nextConfig)

      toast.success('Gateway settings saved')
      await checkStatus()
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
  }, [aiServerPort, checkStatus, config, formState])

  const handleStart = useCallback(async () => {
    setIsRestarting(true)
    try {
      const nextConfig = mergeGatewayConfig(config, formState, aiServerPort)
      await invoke('save_gateway_config', { config: nextConfig })
      setConfig(nextConfig)
      await invoke('start_gateway')
      await checkStatus()
    } catch (error) {
      console.error('Failed to start gateway:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to start gateway',
      )
    } finally {
      setIsRestarting(false)
    }
  }, [aiServerPort, checkStatus, config, formState])

  const handleRestart = useCallback(async () => {
    setIsRestarting(true)
    try {
      const nextConfig = mergeGatewayConfig(config, formState, aiServerPort)
      await invoke('save_gateway_config', { config: nextConfig })
      setConfig(nextConfig)
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
  }, [aiServerPort, checkStatus, config, formState])

  const handleStop = useCallback(async () => {
    setIsRestarting(true)
    try {
      await invoke('stop_gateway')
      await checkStatus()
    } catch (error) {
      console.error('Failed to stop gateway:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to stop gateway',
      )
    } finally {
      setIsRestarting(false)
    }
  }, [checkStatus])

  const handleRotateToken = useCallback(() => {
    const nextToken = generateToken()
    setFormState((prev) => ({
      ...prev,
      authToken: nextToken,
      httpAuthToken: nextToken,
    }))
  }, [])

  const handleCopyToken = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formState.authToken)
      toast.success('Gateway token copied')
    } catch {
      toast.error('Failed to copy token')
    }
  }, [formState.authToken])

  const setupIsValid = useMemo(() => {
    if (!gatewayEnabled) return true
    if (formState.telegramEnabled && !formState.telegramBotToken.trim())
      return false
    if (whatsappAvailable && formState.whatsappEnabled) {
      if (!formState.whatsappVerifyToken.trim()) return false
      if (!formState.whatsappAccessToken.trim()) return false
      if (!formState.whatsappPhoneNumberId.trim()) return false
    }
    return true
  }, [formState, gatewayEnabled, whatsappAvailable])

  const handleToggleEnabled = useCallback(
    async (value: boolean) => {
      onGatewayEnabledChange(value)
      if (!value) {
        await handleStop()
        return
      }
      if (setupIsValid) {
        await handleStart()
      }
    },
    [handleStart, handleStop, onGatewayEnabledChange, setupIsValid],
  )

  const handleRevealConfig = useCallback(async () => {
    if (!configPath) return
    try {
      await invoke('reveal_in_file_manager', { path: configPath })
    } catch (error) {
      console.error('Failed to reveal config:', error)
      toast.error('Failed to reveal config file')
    }
  }, [configPath])

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false)
    loadConfig()
  }, [loadConfig])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Gateway</h2>
        <p className="text-muted-foreground text-xs">
          Control Moldable from chat channels like Telegram. The gateway runs
          locally and is disabled by default.
        </p>
      </div>

      <div className="bg-muted/30 border-border flex items-start justify-between gap-3 rounded-lg border px-4 py-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-primary size-4" />
            <p className="text-sm font-medium">
              Enable remote access to this Moldable instance
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            When enabled, the gateway will start automatically when Moldable
            launches.
          </p>
        </div>
        <Switch
          checked={gatewayEnabled}
          onCheckedChange={handleToggleEnabled}
          className="cursor-pointer"
        />
      </div>

      <div className="bg-muted/20 border-border flex flex-col gap-3 rounded-lg border px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="text-muted-foreground mt-0.5 size-4" />
          <div>
            <p className="text-sm font-medium">
              {gatewayEnabled
                ? `Risks for the '${selectedSetup.title}' setup`
                : 'Gateway risks'}
            </p>
            <p className="text-muted-foreground text-xs">
              By enabling the gateway, you acknowledge these risks.
            </p>
            <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-4 text-xs">
              {(gatewayEnabled ? selectedSetup.risks : genericRisks).map(
                (risk) => (
                  <li key={risk}>{risk}</li>
                ),
              )}
            </ul>
            {gatewayEnabled && selectedSetup.notes && (
              <p className="text-muted-foreground mt-2 text-xs">
                {selectedSetup.notes}
              </p>
            )}
          </div>
        </div>
      </div>

      {gatewayEnabled &&
        showOnboarding &&
        !config &&
        hasLoadedConfig &&
        onboardingWorkspaceId && (
          <OnboardingGateway
            workspaceId={onboardingWorkspaceId}
            aiServerPort={aiServerPort}
            onComplete={handleOnboardingComplete}
            onGatewayEnabledChange={onGatewayEnabledChange}
            onGatewaySetupIdChange={onGatewaySetupIdChange}
            variant="settings"
          />
        )}

      {gatewayEnabled && hasLoadedConfig && (!showOnboarding || !!config) && (
        <>
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
                  {status === 'running' ? 'Gateway running' : 'Gateway stopped'}
                </p>
                <p className="text-muted-foreground text-xs">
                  {status === 'running'
                    ? 'Listening for remote messages.'
                    : 'Not accepting remote connections.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={checkStatus}
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
                <RefreshCcw className="mr-2 size-4" />
                Restart
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Recommended setup</p>
            <div className="grid gap-2">
              {visibleSetups.map((setup) => (
                <button
                  key={setup.id}
                  type="button"
                  onClick={() => handleSetupChange(setup.id)}
                  className={cn(
                    'border-border bg-card hover:bg-muted flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                    setupId === setup.id && 'border-primary bg-primary/5',
                    'cursor-pointer',
                  )}
                >
                  <div
                    className={cn(
                      'mt-1 size-2.5 rounded-full border',
                      setupId === setup.id
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground',
                    )}
                  />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{setup.title}</span>
                      {setup.recommended && (
                        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          Recommended
                        </span>
                      )}
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          riskLevelStyles[setup.riskLevel],
                        )}
                      >
                        {setup.riskLevel} risk
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {setup.description}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Channels</p>
            <div className="bg-muted/20 border-border flex flex-col gap-3 rounded-lg border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Telegram</p>
                  <p className="text-muted-foreground text-xs">
                    Moldable polls Telegram for new messages and sends responses
                    back. No public internet exposure.
                  </p>
                </div>
                <Switch
                  checked={formState.telegramEnabled}
                  onCheckedChange={(value) =>
                    setFormState((prev) => ({
                      ...prev,
                      telegramEnabled: value,
                    }))
                  }
                  className="cursor-pointer"
                />
              </div>
              {formState.telegramEnabled && (
                <div className="grid gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="settings-telegram-token">Bot token</Label>
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
                        className="font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="cursor-pointer"
                        aria-label={
                          showTelegramToken
                            ? 'Hide Telegram bot token'
                            : 'Reveal Telegram bot token'
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
                  <div className="bg-muted/30 border-border flex flex-col gap-2 rounded-lg border px-3 py-2">
                    <p className="text-xs font-medium">
                      Telegram setup (quick steps)
                    </p>
                    <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                      <li>
                        Open Telegram, chat with @BotFather, and run /newbot.
                      </li>
                      <li>Copy the bot token and paste it here.</li>
                      <li>
                        Send a DM to your bot to generate a pairing request,
                        then approve it below.
                      </li>
                    </ol>
                    <p className="text-muted-foreground text-xs">
                      For group chats, run /setprivacy in BotFather and keep
                      &ldquo;Require mention&rdquo; on.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={formState.telegramRequireMention}
                      onCheckedChange={(value) =>
                        setFormState((prev) => ({
                          ...prev,
                          telegramRequireMention: value,
                        }))
                      }
                      className="cursor-pointer"
                    />
                    <span className="text-muted-foreground">
                      Require mention in group chats
                    </span>
                  </label>
                </div>
              )}
            </div>

            {whatsappAvailable && (
              <div className="bg-muted/20 border-border flex flex-col gap-3 rounded-lg border px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">WhatsApp Cloud</p>
                    <p className="text-muted-foreground text-xs">
                      Requires a webhook URL (use a tunnel).
                    </p>
                  </div>
                  <Switch
                    checked={formState.whatsappEnabled}
                    onCheckedChange={(value) =>
                      setFormState((prev) => ({
                        ...prev,
                        whatsappEnabled: value,
                        whatsappVerifyToken: value
                          ? prev.whatsappVerifyToken || generateToken(16)
                          : prev.whatsappVerifyToken,
                      }))
                    }
                    className="cursor-pointer"
                  />
                </div>
                {formState.whatsappEnabled && (
                  <div className="grid gap-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="settings-whatsapp-verify">
                        Verify token
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="settings-whatsapp-verify"
                          type={showWhatsappVerifyToken ? 'text' : 'password'}
                          value={formState.whatsappVerifyToken}
                          onChange={(e) =>
                            setFormState((prev) => ({
                              ...prev,
                              whatsappVerifyToken: e.target.value,
                            }))
                          }
                          className="font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="cursor-pointer"
                          aria-label={
                            showWhatsappVerifyToken
                              ? 'Hide WhatsApp verify token'
                              : 'Reveal WhatsApp verify token'
                          }
                          onClick={() =>
                            setShowWhatsappVerifyToken((prev) => !prev)
                          }
                        >
                          {showWhatsappVerifyToken ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="settings-whatsapp-access">
                        Access token
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="settings-whatsapp-access"
                          type={showWhatsappAccessToken ? 'text' : 'password'}
                          value={formState.whatsappAccessToken}
                          onChange={(e) =>
                            setFormState((prev) => ({
                              ...prev,
                              whatsappAccessToken: e.target.value,
                            }))
                          }
                          className="font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="cursor-pointer"
                          aria-label={
                            showWhatsappAccessToken
                              ? 'Hide WhatsApp access token'
                              : 'Reveal WhatsApp access token'
                          }
                          onClick={() =>
                            setShowWhatsappAccessToken((prev) => !prev)
                          }
                        >
                          {showWhatsappAccessToken ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="settings-whatsapp-phone">
                        Phone number ID
                      </Label>
                      <Input
                        id="settings-whatsapp-phone"
                        value={formState.whatsappPhoneNumberId}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            whatsappPhoneNumberId: e.target.value,
                          }))
                        }
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="settings-whatsapp-webhook">
                        Webhook bind
                      </Label>
                      <Input
                        id="settings-whatsapp-webhook"
                        value={formState.whatsappWebhookBind}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            whatsappWebhookBind: e.target.value,
                          }))
                        }
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="bg-muted/30 border-border flex flex-col gap-2 rounded-lg border px-3 py-2">
                      <p className="text-xs font-medium">
                        WhatsApp setup (quick steps)
                      </p>
                      <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                        <li>Create a Meta app with WhatsApp Cloud enabled.</li>
                        <li>
                          Copy the access token, phone number ID, and verify
                          token into this form.
                        </li>
                        <li>
                          Point your webhook to the bind shown above (use a
                          tunnel).
                        </li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Pairing requests</p>
                <p className="text-muted-foreground text-xs">
                  Approve new senders before they can message your bot.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={refreshPairing}
                disabled={pairingLoading || status !== 'running'}
              >
                <RefreshCcw
                  className={cn(
                    'mr-2 size-4',
                    pairingLoading && 'animate-spin',
                  )}
                />
                Refresh
              </Button>
            </div>
            <div className="bg-muted/20 border-border flex flex-col gap-3 rounded-lg border px-4 py-3">
              {status !== 'running' ? (
                <p className="text-muted-foreground text-xs">
                  Start the gateway to manage pairing requests.
                </p>
              ) : !formState.telegramEnabled ? (
                <p className="text-muted-foreground text-xs">
                  Enable Telegram to receive pairing requests.
                </p>
              ) : pairingError ? (
                <p className="text-destructive text-xs">{pairingError}</p>
              ) : pairingLoading ? (
                <p className="text-muted-foreground text-xs">
                  Loading pairing requests…
                </p>
              ) : telegramPending.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No pending Telegram pairing requests yet. Send a DM to your
                  bot to create one.
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
                          Code <span className="font-mono">{entry.code}</span> ·
                          Requested {formatRequestedAt(entry.requested_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="cursor-pointer"
                          disabled={pairingBusyCode === entry.code}
                          onClick={() =>
                            handlePairingAction(
                              'telegram',
                              entry.code,
                              'approve',
                            )
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
                            handlePairingAction(
                              'telegram',
                              entry.code,
                              'reject',
                            )
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

          <div className="space-y-3">
            <p className="text-sm font-medium">Workspace</p>
            <div className="bg-muted/20 border-border rounded-lg border px-4 py-3">
              <Label className="text-xs">
                Active workspace for gateway sessions
              </Label>
              <Select
                value={formState.workspaceId ?? ''}
                onValueChange={(value) =>
                  setFormState((prev) => ({
                    ...prev,
                    workspaceId: value || null,
                  }))
                }
              >
                <SelectTrigger className="mt-2 cursor-pointer">
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Gateway authentication</p>
            <div className="bg-muted/20 border-border flex flex-col gap-3 rounded-lg border px-4 py-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="gateway-token">Gateway token</Label>
                <div className="flex gap-2">
                  <Input
                    id="gateway-token"
                    type={showGatewayToken ? 'text' : 'password'}
                    value={formState.authToken}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        authToken: e.target.value,
                        httpAuthToken: e.target.value,
                      }))
                    }
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    aria-label={
                      showGatewayToken
                        ? 'Hide gateway token'
                        : 'Reveal gateway token'
                    }
                    onClick={() => setShowGatewayToken((prev) => !prev)}
                  >
                    {showGatewayToken ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={handleCopyToken}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={handleRotateToken}
                  >
                    Rotate
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Used by the CLI and HTTP endpoints. Keep it private.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              className="cursor-pointer"
              onClick={handleSave}
              disabled={isSaving || !setupIsValid}
            >
              {isSaving ? 'Saving...' : 'Save & restart gateway'}
            </Button>
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={handleRevealConfig}
              disabled={!configPath}
            >
              Open config file
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
