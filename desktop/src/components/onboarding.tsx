import { useEffect, useState } from 'react'
import type { GatewaySetupId } from '../lib/gateway-config'
import type { Workspace } from '../lib/workspaces'
import type { AIServerHealth } from '../hooks/use-ai-server-health'
import { OnboardingApiKey } from './onboarding-api-key'
import { OnboardingGateway } from './onboarding-gateway'
import { OnboardingStarterApps } from './onboarding-starter-apps'
import { OnboardingWorkspace } from './onboarding-workspace'
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
 * 1. Workspace selection (always shown first - provides required user gesture)
 * 2. Starter apps (first-time users only)
 * 3. API key setup (only if needed)
 * 4. Gateway setup (optional, only when API keys exist)
 *
 * Note: Dependencies (Node.js, pnpm) are bundled with the app, so no setup needed.
 */

type OnboardingStep = 'workspace' | 'starter-apps' | 'api-key' | 'gateway'

interface OnboardingProps {
  workspaces: Workspace[]
  health: AIServerHealth
  onComplete: (workspaceId: string, markOnboardingDone?: boolean) => void
  onCreateWorkspace: (name: string, color?: string) => Promise<Workspace>
  onHealthRetry: () => void
  onGatewayEnabledChange?: (enabled: boolean) => void
  onGatewaySetupIdChange?: (setupId: GatewaySetupId) => void
  /** Whether onboarding was already completed for this workspace (persisted) */
  workspaceOnboardingCompleted?: boolean
}

export function Onboarding({
  workspaces,
  health,
  onComplete,
  onCreateWorkspace,
  onHealthRetry,
  onGatewayEnabledChange,
  onGatewaySetupIdChange,
  workspaceOnboardingCompleted = false,
}: OnboardingProps) {
  const needsApiKey = health.status === 'no-keys'
  const hasAnyKey =
    health.hasOpenRouterKey || health.hasAnthropicKey || health.hasOpenAIKey

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  )
  const [step, setStep] = useState<OnboardingStep>('workspace')
  const [gatewayEligible, setGatewayEligible] = useState(hasAnyKey)

  // Keep gateway eligibility in sync with health status
  useEffect(() => {
    if (hasAnyKey) {
      setGatewayEligible(true)
    }
  }, [hasAnyKey])

  // Handle workspace selection
  const handleSelectWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId)

    if (workspaceOnboardingCompleted) {
      // Returning user - go straight to app
      onComplete(workspaceId, false)
    } else {
      // First-time user - show starter apps
      setStep('starter-apps')
    }
  }

  // After starter apps, go to API key if needed, otherwise finish
  const handleStarterAppsComplete = () => {
    if (needsApiKey) {
      setStep('api-key')
    } else if (gatewayEligible) {
      setStep('gateway')
    } else {
      handleFinish()
    }
  }

  // After API key (or skip), finish onboarding
  const handleApiKeyComplete = () => {
    setGatewayEligible(true)
    setStep('gateway')
  }

  const handleApiKeySkip = () => {
    handleFinish()
  }

  const handleFinish = () => {
    if (selectedWorkspaceId) {
      onComplete(selectedWorkspaceId, true)
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
          {step === 'workspace' && (
            <OnboardingWorkspace
              key="workspace"
              workspaces={workspaces}
              onSelect={handleSelectWorkspace}
              onCreateWorkspace={onCreateWorkspace}
            />
          )}

          {step === 'starter-apps' && selectedWorkspaceId && (
            <OnboardingStarterApps
              key="starter-apps"
              workspaceId={selectedWorkspaceId}
              onComplete={handleStarterAppsComplete}
            />
          )}

          {step === 'api-key' && (
            <OnboardingApiKey
              key="api-key"
              onComplete={handleApiKeyComplete}
              onSkip={handleApiKeySkip}
              onHealthRetry={onHealthRetry}
            />
          )}

          {step === 'gateway' && selectedWorkspaceId && (
            <OnboardingGateway
              key="gateway"
              workspaceId={selectedWorkspaceId}
              aiServerPort={health.port}
              onComplete={handleFinish}
              onGatewayEnabledChange={onGatewayEnabledChange}
              onGatewaySetupIdChange={(setupId) =>
                onGatewaySetupIdChange?.(setupId)
              }
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
