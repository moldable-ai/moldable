import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button } from '@moldable-ai/ui'
import type { AppRegistryEntry } from '../lib/app-manager'
import {
  fetchAppRegistry,
  getRegisteredApps,
  installAppFromRegistry,
} from '../lib/app-manager'
import { cn } from '../lib/utils'
import { invoke } from '@tauri-apps/api/core'
import { AnimatePresence, motion } from 'framer-motion'

interface OnboardingStarterAppsProps {
  workspaceId: string
  onComplete: () => void
}

const fadeIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
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

export function OnboardingStarterApps({
  workspaceId,
  onComplete,
}: OnboardingStarterAppsProps) {
  const [starterApps, setStarterApps] = useState<AppRegistryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [installingApp, setInstallingApp] = useState<string | null>(null)
  const [installedAppIds, setInstalledAppIds] = useState<Set<string>>(new Set())
  const [installError, setInstallError] = useState<string | null>(null)

  // Load starter apps on mount
  useEffect(() => {
    setLoading(true)
    Promise.all([fetchAppRegistry(), getRegisteredApps()])
      .then(([registry, installed]) => {
        // Filter to apps that don't require additional env vars
        // These are the best for onboarding since they work immediately
        // Also exclude "hello-moldables" since it's auto-installed for all users
        const noEnvRequired = registry.apps.filter(
          (app) =>
            (!app.requiredEnv || app.requiredEnv.length === 0) &&
            app.id !== 'hello-moldables',
        )
        setStarterApps(noEnvRequired)
        setInstalledAppIds(new Set(installed.map((a) => a.id)))
      })
      .catch((err) => {
        console.error('Failed to load starter apps:', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const handleInstallApp = useCallback(
    async (app: AppRegistryEntry) => {
      setInstallingApp(app.id)
      setInstallError(null)
      try {
        // Ensure the workspace is active before installing so app goes to the right place
        await invoke('set_active_workspace', { workspaceId })
        await installAppFromRegistry(app.id, app.path, app.commit, app.version)
        setInstalledAppIds((prev) => new Set([...prev, app.id]))
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error('Failed to install app:', errorMsg)
        setInstallError(errorMsg)
      } finally {
        setInstallingApp(null)
      }
    },
    [workspaceId],
  )

  return (
    <motion.div
      key="starter-apps-step"
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
          Install starter apps
        </h1>
        <p className="text-muted-foreground text-center text-sm">
          Get started with some pre-built apps, or skip to create your own.
        </p>
      </motion.div>

      <motion.div
        className="flex w-full flex-col gap-3"
        initial="initial"
        animate="animate"
        variants={staggerContainer}
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center py-8">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading apps...
          </div>
        ) : starterApps.length === 0 ? (
          <div className="text-muted-foreground py-4 text-center text-sm">
            No starter apps available.
          </div>
        ) : (
          starterApps.slice(0, 4).map((app, index) => {
            const isInstalled = installedAppIds.has(app.id)
            const isInstalling = installingApp === app.id

            return (
              <motion.div
                key={app.id}
                className="bg-card border-border flex w-full items-center gap-3 rounded-lg border p-3"
                variants={staggerItem}
                transition={{ duration: 0.2, delay: index * 0.05 }}
              >
                {/* Icon */}
                <div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                  {app.iconUrl ? (
                    <img
                      src={app.iconUrl}
                      alt={app.name}
                      className="size-full object-cover p-1"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        e.currentTarget.nextElementSibling?.classList.remove(
                          'hidden',
                        )
                      }}
                    />
                  ) : null}
                  <span className={cn('text-lg', app.iconUrl && 'hidden')}>
                    {app.icon}
                  </span>
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-foreground text-sm font-medium">
                      {app.name}
                    </p>
                  </div>
                  {app.description && (
                    <p className="text-muted-foreground line-clamp-1 text-xs">
                      {app.description}
                    </p>
                  )}
                </div>

                {/* Action */}
                {isInstalled ? (
                  <Badge variant="secondary" className="shrink-0">
                    Installed
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleInstallApp(app)}
                    disabled={installingApp !== null}
                    className="shrink-0 cursor-pointer"
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        Installing...
                      </>
                    ) : (
                      'Install'
                    )}
                  </Button>
                )}
              </motion.div>
            )
          })
        )}
      </motion.div>

      {/* Show install error if any */}
      <AnimatePresence>
        {installError && (
          <motion.div
            className="bg-destructive/10 border-destructive/20 text-destructive w-full rounded-lg border p-3 text-sm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <p className="font-medium">Failed to install app</p>
            <p className="mt-1 text-xs opacity-80">{installError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex w-full flex-col gap-2">
        <Button
          className="w-full cursor-pointer"
          onClick={onComplete}
          disabled={installingApp !== null}
        >
          {installedAppIds.size > 0 ? 'Continue' : 'Skip & Continue'}
        </Button>
      </div>
    </motion.div>
  )
}
