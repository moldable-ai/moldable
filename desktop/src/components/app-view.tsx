import { AlertCircle, Check, Copy, Play, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '@moldable-ai/ui'
import { getAppEnvRequirements } from '@/lib/app-manager'
import { cn } from '@/lib/utils'
import { useAppStatus } from '@/hooks/use-app-status'
import type { AppConfig } from '../app'
import { AppEnvDialog } from './app-env-dialog'
import { PortConflictDialog } from './port-conflict-dialog'
import { open } from '@tauri-apps/plugin-shell'

interface AppViewProps {
  app: AppConfig
  workspaceId: string
  reloadKey?: number
}

export function AppView({ app, workspaceId, reloadKey = 0 }: AppViewProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [showEnvDialog, setShowEnvDialog] = useState(false)
  const {
    state,
    error,
    logs,
    actualPort,
    portConflict,
    start,
    clearError,
    killAndStart,
    startOnAlternatePort,
    dismissPortConflict,
  } = useAppStatus(app)
  const { resolvedTheme } = useTheme()
  // Use actual port if available, otherwise configured port
  const runningPort = actualPort ?? app.port
  const appUrl = `http://127.0.0.1:${runningPort}?theme=${resolvedTheme}&workspace=${workspaceId}`
  const isRunning = state === 'running'
  const isStarting = state === 'starting'
  const isStopped = state === 'stopped'
  const isError = state === 'error'
  const isPortConflict = state === 'port_conflict'

  // Check env requirements before starting
  const checkEnvAndStart = useCallback(async () => {
    try {
      const envStatus = await getAppEnvRequirements(app.workingDir)

      // Check if there are any pending requirements (not yet configured)
      const pendingRequirements = envStatus.requirements.filter(
        (req) => !envStatus.present.includes(req.key),
      )

      if (pendingRequirements.length > 0) {
        // Show env dialog
        setShowEnvDialog(true)
      } else {
        // All set, start the app
        start()
      }
    } catch (e) {
      // If we can't check env, just start the app
      console.error('Failed to check env requirements:', e)
      start()
    }
  }, [app.workingDir, start])

  // Auto-start the app when view is opened and app is stopped
  const hasAutoStarted = useRef(false)
  useEffect(() => {
    if (isStopped && !hasAutoStarted.current && !showEnvDialog) {
      hasAutoStarted.current = true
      checkEnvAndStart()
    }
  }, [isStopped, checkEnvAndStart, showEnvDialog])

  // Reset state when app changes
  useEffect(() => {
    hasAutoStarted.current = false
    setIsLoading(true)
  }, [app.id])

  // Listen for messages from app iframes (e.g., to open external URLs)
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from our app's origin
      if (
        !event.origin.startsWith('http://127.0.0.1:') &&
        !event.origin.startsWith('http://localhost:')
      )
        return

      if (event.data?.type === 'moldable:open-url' && event.data?.url) {
        try {
          await open(event.data.url)
        } catch (err) {
          console.error('Failed to open URL:', err)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleCopyLogs = async () => {
    const logText =
      logs.length > 0 ? logs.join('\n') : error || 'No logs available'
    await navigator.clipboard.writeText(logText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDismissError = () => {
    clearError()
  }

  const handleEnvDialogClose = useCallback(() => {
    setShowEnvDialog(false)
  }, [])

  const handleEnvDialogComplete = useCallback(() => {
    setShowEnvDialog(false)
    // Start the app after env setup
    start()
  }, [start])

  return (
    <div className="flex h-full flex-col">
      {/* Env setup dialog */}
      {showEnvDialog && (
        <AppEnvDialog
          appName={app.name}
          appPath={app.workingDir}
          onClose={handleEnvDialogClose}
          onComplete={handleEnvDialogComplete}
        />
      )}

      {/* Port conflict dialog */}
      {isPortConflict && (
        <PortConflictDialog
          appName={app.name}
          conflict={portConflict}
          onKillAndStart={killAndStart}
          onUseAlternatePort={startOnAlternatePort}
          onDismiss={dismissPortConflict}
        />
      )}

      {/* App iframe container */}
      <div className="bg-background relative flex-1">
        {/* Loading overlay */}
        {isLoading && isRunning && (
          <div className="bg-background absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="text-primary size-8 animate-spin" />
              <span className="text-muted-foreground text-sm">
                Loading {app.name}...
              </span>
            </div>
          </div>
        )}

        {/* Starting state */}
        {isStarting && (
          <div className="bg-card absolute inset-0 z-10 flex flex-col items-center justify-center">
            <div className="mb-4">
              {app.iconPath ? (
                <img
                  src={app.iconPath}
                  alt={app.name}
                  className="size-24 object-contain"
                />
              ) : (
                <div className="text-6xl">{app.icon}</div>
              )}
            </div>
            <h2 className="mb-2 text-xl font-semibold">{app.name}</h2>
            <div className="text-muted-foreground flex items-center gap-3">
              <RefreshCw className="size-5 animate-spin" />
              <span>Starting app on port {runningPort}...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="bg-card absolute inset-0 z-10 flex flex-col">
            <div className="flex flex-1 flex-col items-center justify-center p-8">
              <div className="bg-status-error/10 mb-4 flex size-16 items-center justify-center rounded-full">
                <AlertCircle className="text-status-error size-8" />
              </div>
              <h2 className="mb-2 text-xl font-semibold">{app.name}</h2>
              <p className="text-muted-foreground mb-4 text-center">
                Failed to start on port {runningPort}
              </p>

              {/* Error message */}
              {error && (
                <div className="border-status-error/30 bg-status-error/5 mb-4 max-w-lg rounded-lg border p-4">
                  <pre className="text-status-error whitespace-pre-wrap text-sm">
                    {error}
                  </pre>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => start()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
                >
                  <Play className="size-4" />
                  Try Again
                </button>
                <button
                  onClick={handleDismissError}
                  className="bg-muted text-muted-foreground hover:bg-muted/80 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
                >
                  <X className="size-4" />
                  Dismiss
                </button>
              </div>
            </div>

            {/* Logs panel */}
            {logs.length > 0 && (
              <div className="border-border bg-muted/30 border-t">
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    Process Output ({logs.length} lines)
                  </span>
                  <button
                    onClick={handleCopyLogs}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" />
                        Copy Logs
                      </>
                    )}
                  </button>
                </div>
                <div className="border-border bg-card max-h-48 overflow-auto border-t p-4">
                  <pre className="text-muted-foreground font-mono text-xs leading-relaxed">
                    {logs.slice(-50).map((line, i) => (
                      <div
                        key={i}
                        className={cn(
                          line.includes('[stderr]') && 'text-status-error',
                          (line.includes('error') ||
                            line.includes('Error') ||
                            line.includes('ERROR')) &&
                            'text-status-error font-medium',
                        )}
                      >
                        {line}
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stopped state - will auto-start */}
        {isStopped && (
          <div className="bg-card absolute inset-0 z-10 flex flex-col items-center justify-center">
            <div className="mb-4">
              {app.iconPath ? (
                <img
                  src={app.iconPath}
                  alt={app.name}
                  className="size-24 object-contain"
                />
              ) : (
                <div className="text-6xl">{app.icon}</div>
              )}
            </div>
            <h2 className="mb-2 text-xl font-semibold">{app.name}</h2>
            <div className="text-muted-foreground flex items-center gap-3">
              <RefreshCw className="size-5 animate-spin" />
              <span>Starting app...</span>
            </div>
          </div>
        )}

        {/* Iframe - only render when running */}
        {isRunning && (
          <iframe
            key={`${app.id}-${reloadKey}`}
            src={appUrl}
            className="absolute inset-0 size-full border-0"
            title={app.name}
            allow="microphone; camera; display-capture"
            onLoad={() => setIsLoading(false)}
            onError={() => setIsLoading(false)}
          />
        )}
      </div>
    </div>
  )
}
