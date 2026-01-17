import { useState } from 'react'
import type { Workspace } from '../lib/workspaces'
import type { AIServerHealth } from '../hooks/use-ai-server-health'
import { OnboardingApiKey } from './onboarding-api-key'
import type { DependencyStatus } from './onboarding-dependencies'
import { OnboardingDependencies } from './onboarding-dependencies'
import { OnboardingStarterApps } from './onboarding-starter-apps'
import { OnboardingWorkspace } from './onboarding-workspace'
import { invoke } from '@tauri-apps/api/core'
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
 * 2. Dependencies check (Node.js, pnpm) - required before installing apps
 * 3. Starter apps (optional install)
 * 4. API key setup (only if needed)
 */

type OnboardingStep = 'workspace' | 'dependencies' | 'starter-apps' | 'api-key'

interface OnboardingProps {
  workspaces: Workspace[]
  health: AIServerHealth
  onComplete: (workspaceId: string, markOnboardingDone?: boolean) => void
  onCreateWorkspace: (name: string, color?: string) => Promise<Workspace>
  onHealthRetry: () => void
  /** Whether onboarding was already completed for this workspace (persisted) */
  workspaceOnboardingCompleted?: boolean
}

export function Onboarding({
  workspaces,
  health,
  onComplete,
  onCreateWorkspace,
  onHealthRetry,
  workspaceOnboardingCompleted = false,
}: OnboardingProps) {
  const needsApiKey = health.status === 'no-keys'

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  )
  const [step, setStep] = useState<OnboardingStep>('workspace')

  // Handle workspace selection
  const handleSelectWorkspace = async (workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId)

    // Only skip if user has explicitly completed onboarding before (saved in config)
    // First-time users always go through all steps
    if (workspaceOnboardingCompleted) {
      onComplete(workspaceId, false) // false = don't re-mark as completed
      return
    }

    // Check if deps are already installed - if so, skip to starter apps
    try {
      const status = await invoke<DependencyStatus>('check_dependencies')
      const allDepsInstalled = status.nodeInstalled && status.pnpmInstalled

      if (allDepsInstalled) {
        setStep('starter-apps')
      } else {
        setStep('dependencies')
      }
    } catch (err) {
      console.error('Failed to check dependencies:', err)
      // On error, show dependencies step anyway
      setStep('dependencies')
    }
  }

  // After dependencies, go to starter apps
  const handleDependenciesComplete = () => {
    setStep('starter-apps')
  }

  // After starter apps, go to API key if needed, otherwise finish
  const handleStarterAppsComplete = () => {
    if (needsApiKey) {
      setStep('api-key')
    } else {
      handleFinish()
    }
  }

  // After API key (or skip), finish onboarding
  const handleApiKeyComplete = () => {
    handleFinish()
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

          {step === 'dependencies' && (
            <OnboardingDependencies
              key="dependencies"
              onComplete={handleDependenciesComplete}
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
        </AnimatePresence>
      </div>
    </div>
  )
}
