import {
  AlertCircle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { AnimatePresence, motion } from 'framer-motion'

/** Where Node.js was found - must match Rust NodeSource enum */
type NodeSource =
  | 'moldable'
  | 'homebrew'
  | 'system'
  | 'nvm'
  | 'fnm'
  | 'volta'
  | 'asdf'
  | 'mise'
  | 'n'
  | 'nodenv'
  | 'other'

/** Dependency status from the Rust backend */
export interface DependencyStatus {
  nodeInstalled: boolean
  nodeVersion: string | null
  nodePath: string | null
  nodeSource: NodeSource | null
  pnpmInstalled: boolean
  pnpmVersion: string | null
  pnpmPath: string | null
}

interface OnboardingDependenciesProps {
  onComplete: () => void
}

// Animation variants
const fadeIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const staggerItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
}

/** Get human-readable description of where Node.js was found */
function getNodeSourceLabel(source: NodeSource | null): string {
  switch (source) {
    case 'moldable':
      return 'Managed by Moldable'
    case 'homebrew':
      return 'Homebrew'
    case 'system':
      return 'System'
    case 'nvm':
      return 'NVM'
    case 'fnm':
      return 'fnm'
    case 'volta':
      return 'Volta'
    case 'asdf':
      return 'asdf'
    case 'mise':
      return 'mise'
    case 'n':
      return 'n'
    case 'nodenv':
      return 'nodenv'
    case 'other':
      return 'Custom'
    default:
      return ''
  }
}

export function OnboardingDependencies({
  onComplete,
}: OnboardingDependenciesProps) {
  const [depStatus, setDepStatus] = useState<DependencyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [installingNode, setInstallingNode] = useState(false)
  const [installingPnpm, setInstallingPnpm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allDepsInstalled = depStatus?.nodeInstalled && depStatus?.pnpmInstalled

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current)
      }
    }
  }, [])

  // Check dependencies on mount and after installations
  const checkDependencies = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const status = await invoke<DependencyStatus>('check_dependencies')
      setDepStatus(status)
    } catch (err) {
      console.error('Failed to check dependencies:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkDependencies()
  }, [checkDependencies])

  const handleInstallNode = useCallback(async () => {
    setInstallingNode(true)
    setError(null)
    setInstallProgress('Downloading Node.js...')
    setRetryCount((c) => c + 1)

    // Set a timeout warning (not a hard failure, just UI feedback)
    installTimeoutRef.current = setTimeout(() => {
      setInstallProgress(
        'Still downloading... this may take a minute on slower connections.',
      )
    }, 15000)

    try {
      await invoke<string>('install_node')
      setInstallProgress(null)
      // Refresh status after installation
      await checkDependencies()
    } catch (err) {
      console.error('Failed to install Node.js:', err)
      setError(err instanceof Error ? err.message : String(err))
      setInstallProgress(null)
    } finally {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current)
        installTimeoutRef.current = null
      }
      setInstallingNode(false)
    }
  }, [checkDependencies])

  const handleInstallPnpm = useCallback(async () => {
    setInstallingPnpm(true)
    setError(null)
    setInstallProgress('Installing pnpm...')
    setRetryCount((c) => c + 1)

    try {
      await invoke<string>('install_pnpm')
      setInstallProgress(null)
      // Refresh status after installation
      await checkDependencies()
    } catch (err) {
      console.error('Failed to install pnpm:', err)
      setError(err instanceof Error ? err.message : String(err))
      setInstallProgress(null)
    } finally {
      setInstallingPnpm(false)
    }
  }, [checkDependencies])

  const handleOpenUrl = useCallback(async (url: string) => {
    await open(url)
  }, [])

  const handleCopyError = useCallback(async () => {
    if (!error) return

    const errorReport = `Moldable Installation Error Report
====================================
Error: ${error}
Node.js installed: ${depStatus?.nodeInstalled ?? 'unknown'}
Node.js version: ${depStatus?.nodeVersion ?? 'N/A'}
Node.js source: ${depStatus?.nodeSource ?? 'N/A'}
Node.js path: ${depStatus?.nodePath ?? 'N/A'}
pnpm installed: ${depStatus?.pnpmInstalled ?? 'unknown'}
pnpm version: ${depStatus?.pnpmVersion ?? 'N/A'}
pnpm path: ${depStatus?.pnpmPath ?? 'N/A'}
Retry count: ${retryCount}
Platform: ${navigator.platform}
User agent: ${navigator.userAgent}
Time: ${new Date().toISOString()}`

    try {
      await navigator.clipboard.writeText(errorReport)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      console.log('Error report:', errorReport)
    }
  }, [error, depStatus, retryCount])

  const isInstalling = installingNode || installingPnpm

  // Build the Node.js status description
  const nodeDescription = depStatus?.nodeInstalled
    ? depStatus.nodeSource
      ? `${getNodeSourceLabel(depStatus.nodeSource)}`
      : 'JavaScript runtime installed'
    : 'Required to run Moldable apps'

  return (
    <motion.div
      key="dependencies-step"
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
        <h1 className="text-foreground text-xl font-medium">One-time Setup</h1>
        <p className="text-muted-foreground max-w-sm text-center text-sm">
          Moldable creates apps that run on your computer. To do this, it needs
          two standard developer tools: <strong>Node.js</strong> (runs the apps)
          and <strong>pnpm</strong> (manages their dependencies).
        </p>
      </motion.div>

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center py-8">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Checking installed tools...
        </div>
      ) : (
        <motion.div
          className="flex w-full flex-col gap-3"
          initial="initial"
          animate="animate"
          variants={staggerContainer}
        >
          {/* Node.js Status */}
          <motion.div
            className="bg-card border-border flex w-full items-center gap-3 rounded-lg border p-4"
            variants={staggerItem}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
              <span className="text-lg">⬢</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-foreground text-sm font-medium">Node.js</p>
                {depStatus?.nodeInstalled && depStatus.nodeVersion && (
                  <span className="text-muted-foreground text-xs">
                    {depStatus.nodeVersion}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-xs">{nodeDescription}</p>
            </div>
            {depStatus?.nodeInstalled ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                <Check className="size-4" />
              </div>
            ) : (
              <Button
                size="sm"
                onClick={handleInstallNode}
                disabled={isInstalling}
                className="shrink-0 cursor-pointer"
              >
                {installingNode ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="mr-1.5 size-3.5" />
                    Install Node.js
                  </>
                )}
              </Button>
            )}
          </motion.div>

          {/* pnpm Status */}
          <motion.div
            className="bg-card border-border flex w-full items-center gap-3 rounded-lg border p-4"
            variants={staggerItem}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
              <span className="text-lg">📦</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-foreground text-sm font-medium">pnpm</p>
                {depStatus?.pnpmInstalled && depStatus.pnpmVersion && (
                  <span className="text-muted-foreground text-xs">
                    v{depStatus.pnpmVersion}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {depStatus?.pnpmInstalled
                  ? 'Package manager installed'
                  : 'Fast package manager for Node.js'}
              </p>
            </div>
            {depStatus?.pnpmInstalled ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                <Check className="size-4" />
              </div>
            ) : (
              <Button
                size="sm"
                onClick={handleInstallPnpm}
                disabled={isInstalling || !depStatus?.nodeInstalled}
                className="shrink-0 cursor-pointer"
                title={
                  !depStatus?.nodeInstalled
                    ? 'Install Node.js first'
                    : undefined
                }
              >
                {installingPnpm ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="mr-1.5 size-3.5" />
                    Install pnpm
                  </>
                )}
              </Button>
            )}
          </motion.div>

          {/* Success message when all deps installed */}
          {allDepsInstalled && (
            <motion.div
              className="flex items-center gap-3 rounded-lg border border-green-500/20 bg-green-500/10 p-3"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-500">
                <Check className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-green-600 dark:text-green-400">
                  All set!
                </p>
                <p className="text-muted-foreground text-xs">
                  Development tools are ready. You can start creating apps.
                </p>
              </div>
            </motion.div>
          )}

          {/* Refresh button */}
          <motion.div
            className="flex justify-center pt-2"
            variants={staggerItem}
          >
            <button
              onClick={checkDependencies}
              disabled={loading || isInstalling}
              className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs transition-colors disabled:opacity-50"
            >
              <RefreshCw className="size-3" />
              Recheck tools
            </button>
          </motion.div>
        </motion.div>
      )}

      {/* Installation progress */}
      <AnimatePresence>
        {installProgress && (
          <motion.div
            className="text-muted-foreground flex items-center gap-2 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Loader2 className="size-3.5 animate-spin" />
            {installProgress}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error display */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="bg-destructive/10 border-destructive/20 w-full overflow-hidden rounded-lg border"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-destructive mt-0.5 size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-destructive font-medium">
                    Installation failed
                  </p>
                  <p className="text-destructive/80 mt-1 text-sm">{error}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={
                    !depStatus?.nodeInstalled
                      ? handleInstallNode
                      : handleInstallPnpm
                  }
                  disabled={isInstalling}
                  className="cursor-pointer text-xs"
                >
                  <RefreshCw className="mr-1.5 size-3" />
                  Try again
                </Button>

                <button
                  onClick={handleCopyError}
                  className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs transition-colors"
                >
                  <Copy className="size-3" />
                  {copied ? 'Copied!' : 'Copy for support'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help text for manual installation */}
      {!allDepsInstalled && !loading && !error && (
        <motion.div
          className="text-muted-foreground space-y-1.5 text-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <p className="text-center">Prefer to install manually?</p>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            {!depStatus?.nodeInstalled && (
              <button
                onClick={() => handleOpenUrl('https://nodejs.org/')}
                className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
              >
                <ExternalLink className="size-3" />
                Get Node.js
              </button>
            )}
            {!depStatus?.pnpmInstalled && (
              <button
                onClick={() => handleOpenUrl('https://pnpm.io/installation')}
                className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
              >
                <ExternalLink className="size-3" />
                Get pnpm
              </button>
            )}
          </div>
          <p className="text-muted-foreground/70 pt-1 text-center">
            After installing, click &ldquo;Recheck tools&rdquo; above.
          </p>
        </motion.div>
      )}

      {/* Continue button - only enabled when all deps installed */}
      {allDepsInstalled && (
        <div className="flex w-full flex-col gap-2">
          <Button
            className="w-full cursor-pointer"
            onClick={onComplete}
            disabled={isInstalling}
          >
            Continue
          </Button>
        </div>
      )}
    </motion.div>
  )
}
