import { Check, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { AnimatePresence, motion } from 'framer-motion'

/** Where Node.js was found */
type NodeSource =
  | 'moldable'
  | 'homebrew'
  | 'system'
  | 'nvm'
  | 'fnm'
  | 'volta'
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

  const allDepsInstalled = depStatus?.nodeInstalled && depStatus?.pnpmInstalled

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
    try {
      await invoke<string>('install_node')
      // Refresh status after installation
      await checkDependencies()
    } catch (err) {
      console.error('Failed to install Node.js:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallingNode(false)
    }
  }, [checkDependencies])

  const handleInstallPnpm = useCallback(async () => {
    setInstallingPnpm(true)
    setError(null)
    try {
      await invoke<string>('install_pnpm')
      // Refresh status after installation
      await checkDependencies()
    } catch (err) {
      console.error('Failed to install pnpm:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallingPnpm(false)
    }
  }, [checkDependencies])

  const handleOpenUrl = useCallback(async (url: string) => {
    await open(url)
  }, [])

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
        <h1 className="text-foreground text-xl font-medium">
          Development Tools
        </h1>
        <p className="text-muted-foreground text-center text-sm">
          Moldable apps require Node.js and pnpm to run.
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

      {/* Error display */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="bg-destructive/10 border-destructive/20 text-destructive w-full rounded-lg border p-3 text-sm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <p className="font-medium">Installation failed</p>
            <p className="mt-1 text-xs opacity-80">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help text for manual installation */}
      {!allDepsInstalled && !loading && (
        <motion.div
          className="text-muted-foreground space-y-1.5 text-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <p className="text-center">Or install manually:</p>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            <button
              onClick={() => handleOpenUrl('https://nodejs.org/')}
              className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
            >
              <ExternalLink className="size-3" />
              Node.js
            </button>
            <button
              onClick={() => handleOpenUrl('https://pnpm.io/installation')}
              className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
            >
              <ExternalLink className="size-3" />
              pnpm
            </button>
          </div>
        </motion.div>
      )}

      {/* Action buttons */}
      <div className="flex w-full flex-col gap-2">
        <Button
          className="w-full cursor-pointer"
          onClick={onComplete}
          disabled={isInstalling}
        >
          {allDepsInstalled ? 'Continue' : 'Skip for now'}
        </Button>
      </div>
    </motion.div>
  )
}
