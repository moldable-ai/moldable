import {
  AlertTriangle,
  ChevronRight,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Label, Switch, cn } from '@moldable-ai/ui'
import {
  GATEWAY_FEATURE_FLAGS,
  type GatewayConfig,
  type GatewayFormState,
  type GatewaySetupId,
  applySetupToState,
  createDefaultGatewayFormState,
  generateToken,
  getGatewaySetup,
  getVisibleGatewaySetups,
  mergeGatewayConfig,
} from '../lib/gateway-config'
import { SHARED_PREFERENCE_KEYS } from '../hooks/use-workspace-config'
import { invoke } from '@tauri-apps/api/core'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'

const fadeIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

const scaleIn = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
}

const riskLevelStyles: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-primary/10 text-primary',
  medium: 'bg-muted text-foreground',
  high: 'bg-destructive/10 text-destructive',
}

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
  const [enabled, setEnabled] = useState(isSettingsVariant)
  const [setupId, setSetupId] = useState<GatewaySetupId>('just-me')
  const [isSaving, setIsSaving] = useState(false)
  const [showTelegramToken, setShowTelegramToken] = useState(false)
  const [showWhatsappVerifyToken, setShowWhatsappVerifyToken] = useState(false)
  const [showWhatsappAccessToken, setShowWhatsappAccessToken] = useState(false)

  const whatsappAvailable = GATEWAY_FEATURE_FLAGS.whatsapp
  const visibleSetups = getVisibleGatewaySetups()
  const [formState, setFormState] = useState<GatewayFormState>(() =>
    createDefaultGatewayFormState({
      setupId: 'just-me',
      workspaceId,
    }),
  )

  const selectedSetup = useMemo(() => getGatewaySetup(setupId), [setupId])

  useEffect(() => {
    if (isSettingsVariant) {
      setEnabled(true)
    }
  }, [isSettingsVariant])

  const handleSetupChange = useCallback(
    (nextId: GatewaySetupId) => {
      setSetupId(nextId)
      onGatewaySetupIdChange?.(nextId)
      setFormState((prev) => applySetupToState(nextId, prev))
    },
    [onGatewaySetupIdChange],
  )

  const handleToggleEnabled = useCallback(
    (value: boolean) => {
      if (isSettingsVariant) return
      setEnabled(value)
    },
    [isSettingsVariant],
  )

  const handleToggleTelegram = useCallback((value: boolean) => {
    setFormState((prev) => ({
      ...prev,
      telegramEnabled: value,
      telegramBotToken: value ? prev.telegramBotToken : '',
    }))
  }, [])

  const handleToggleWhatsapp = useCallback((value: boolean) => {
    setFormState((prev) => ({
      ...prev,
      whatsappEnabled: value,
      whatsappVerifyToken: value
        ? prev.whatsappVerifyToken || generateToken(16)
        : '',
      whatsappAccessToken: value ? prev.whatsappAccessToken : '',
      whatsappPhoneNumberId: value ? prev.whatsappPhoneNumberId : '',
    }))
  }, [])

  const setupIsValid = useMemo(() => {
    if (!enabled) return true
    if (formState.telegramEnabled && !formState.telegramBotToken.trim())
      return false
    if (whatsappAvailable && formState.whatsappEnabled) {
      if (!formState.whatsappVerifyToken.trim()) return false
      if (!formState.whatsappAccessToken.trim()) return false
      if (!formState.whatsappPhoneNumberId.trim()) return false
    }
    return true
  }, [enabled, formState, whatsappAvailable])

  const handleSave = useCallback(async () => {
    if (!enabled) {
      try {
        await invoke('set_shared_preference', {
          key: SHARED_PREFERENCE_KEYS.GATEWAY_ENABLED,
          value: false,
        })
      } catch (error) {
        console.error('Failed to persist gateway preference:', error)
      }
      onGatewayEnabledChange?.(false)
      onComplete()
      return
    }

    if (!setupIsValid) return

    setIsSaving(true)
    try {
      const existing = await invoke<GatewayConfig | null>('get_gateway_config')
      const config = mergeGatewayConfig(existing, formState, aiServerPort)

      await invoke('save_gateway_config', { config })
      await invoke('set_shared_preference', {
        key: SHARED_PREFERENCE_KEYS.GATEWAY_ENABLED,
        value: true,
      })
      await invoke('set_shared_preference', {
        key: SHARED_PREFERENCE_KEYS.GATEWAY_SETUP_ID,
        value: setupId,
      })

      onGatewayEnabledChange?.(true)
      onGatewaySetupIdChange?.(setupId)

      await invoke('start_gateway')
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
    enabled,
    formState,
    onComplete,
    onGatewayEnabledChange,
    onGatewaySetupIdChange,
    setupId,
    setupIsValid,
  ])

  return (
    <motion.div
      key="gateway-step"
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
          Enable remote access
        </h1>
        <p className="text-muted-foreground text-center text-sm">
          {isSettingsVariant
            ? 'Finish configuring the gateway so it can accept remote messages.'
            : whatsappAvailable
              ? 'Connect Moldable to Telegram, WhatsApp, or other services. This is optional and can be configured later.'
              : 'Connect Moldable to Telegram. This is optional and can be configured later.'}
        </p>
      </motion.div>

      <motion.div
        className="flex w-full flex-col gap-4"
        variants={scaleIn}
        transition={{ duration: 0.2 }}
      >
        {!isSettingsVariant && (
          <div className="bg-muted/30 border-border flex items-start justify-between gap-3 rounded-lg border px-4 py-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-primary size-4" />
                <p className="text-sm font-medium">Gateway (optional)</p>
              </div>
              <p className="text-muted-foreground text-xs">
                Disabled by default. Only enable if you understand the risks.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={handleToggleEnabled}
              className="cursor-pointer"
            />
          </div>
        )}

        <AnimatePresence mode="wait">
          {enabled && (
            <motion.div
              key="gateway-enabled"
              className="flex flex-col gap-4"
              initial="initial"
              animate="animate"
              exit="exit"
              variants={fadeIn}
            >
              <div className="space-y-2">
                <p className="text-sm font-medium">Recommended setups</p>
                <div className="grid gap-2">
                  {visibleSetups.map((setup) => (
                    <button
                      key={setup.id}
                      type="button"
                      onClick={() => handleSetupChange(setup.id)}
                      className={cn(
                        'border-border bg-card hover:bg-muted flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                        setupId === setup.id &&
                          'border-primary bg-primary/5 shadow-sm',
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
                          <span className="text-sm font-medium">
                            {setup.title}
                          </span>
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
                      <ChevronRight className="text-muted-foreground mt-0.5 size-4" />
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
                        Moldable polls Telegram for new messages and sends
                        responses back. No public internet exposure.
                      </p>
                    </div>
                    <Switch
                      checked={formState.telegramEnabled}
                      onCheckedChange={handleToggleTelegram}
                      className="cursor-pointer"
                    />
                  </div>
                  {formState.telegramEnabled && (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="telegram-token">Bot token</Label>
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
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="cursor-pointer"
                            aria-label={
                              showTelegramToken
                                ? 'Hide Telegram bot token'
                                : 'Reveal Telegram bot token'
                            }
                            onClick={() =>
                              setShowTelegramToken((prev) => !prev)
                            }
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
                            Open Telegram, chat with @BotFather, and run
                            /newbot.
                          </li>
                          <li>Copy the bot token and paste it here.</li>
                          <li>
                            Send a DM to your bot. It will reply with a pairing
                            code you’ll approve in Settings after onboarding.
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
                        onCheckedChange={handleToggleWhatsapp}
                        className="cursor-pointer"
                      />
                    </div>
                    {formState.whatsappEnabled && (
                      <div className="flex flex-col gap-2">
                        <div className="grid gap-2">
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="whatsapp-verify">
                              Verify token
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id="whatsapp-verify"
                                type={
                                  showWhatsappVerifyToken ? 'text' : 'password'
                                }
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
                                size="icon"
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
                            <Label htmlFor="whatsapp-access">
                              Access token
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id="whatsapp-access"
                                type={
                                  showWhatsappAccessToken ? 'text' : 'password'
                                }
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
                                size="icon"
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
                            <Label htmlFor="whatsapp-phone">
                              Phone number ID
                            </Label>
                            <Input
                              id="whatsapp-phone"
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
                            <Label htmlFor="whatsapp-webhook">
                              Webhook bind
                            </Label>
                            <Input
                              id="whatsapp-webhook"
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
                        </div>
                        <div className="bg-muted/30 border-border flex flex-col gap-2 rounded-lg border px-3 py-2">
                          <p className="text-xs font-medium">
                            WhatsApp setup (quick steps)
                          </p>
                          <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                            <li>
                              Create a Meta app with WhatsApp Cloud enabled.
                            </li>
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

              <div className="bg-muted/20 border-border flex flex-col gap-3 rounded-lg border px-4 py-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="text-muted-foreground mt-0.5 size-4" />
                  <div>
                    <p className="text-sm font-medium">
                      Risks for {selectedSetup.title}
                    </p>
                    <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-4 text-xs">
                      {selectedSetup.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
                    {selectedSetup.notes && (
                      <p className="text-muted-foreground mt-2 text-xs">
                        {selectedSetup.notes}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  By enabling the gateway, you acknowledge these risks.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col gap-2">
          <Button
            className="w-full cursor-pointer"
            onClick={handleSave}
            disabled={isSaving || !setupIsValid}
          >
            {enabled
              ? isSaving
                ? 'Saving...'
                : isSettingsVariant
                  ? 'Save gateway setup'
                  : 'Enable gateway'
              : 'Continue'}
          </Button>
          {!isSettingsVariant && (
            <Button
              variant="ghost"
              className="w-full cursor-pointer"
              onClick={() => {
                invoke('set_shared_preference', {
                  key: SHARED_PREFERENCE_KEYS.GATEWAY_ENABLED,
                  value: false,
                }).catch((error) => {
                  console.error('Failed to persist gateway preference:', error)
                })
                onGatewayEnabledChange?.(false)
                onComplete()
              }}
            >
              Skip for now
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
