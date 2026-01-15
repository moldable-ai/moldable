import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AppConfig,
  type PortInfo,
  checkPort,
  discoverAppPort,
  findFreePort,
  getAppLogs,
  getAppStatus,
  getPortInfo,
  isPortAvailable,
  isTauri,
  killPort,
  startApp as startAppCmd,
  stopApp as stopAppCmd,
} from '@/lib/app-manager'

export type AppState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'
  | 'port_conflict'

export interface PortConflict {
  port: number
  info: PortInfo | null
  suggestedPort: number
}

export function useAppStatus(app: AppConfig | null) {
  const [state, setState] = useState<AppState>('stopped')
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [actualPort, setActualPort] = useState<number | null>(null)
  const [portConflict, setPortConflict] = useState<PortConflict | null>(null)
  const initialCheckDone = useRef(false)

  const fetchLogs = useCallback(async () => {
    if (!app || !isTauri()) return
    try {
      const appLogs = await getAppLogs(app.id)
      setLogs(appLogs)
    } catch {
      // Ignore errors fetching logs
    }
  }, [app])

  // Discover if app is already running (via Tauri process state or port file)
  const discoverRunningApp = useCallback(async () => {
    if (!app || !isTauri()) return null

    // First check Tauri's process state
    const status = await getAppStatus(app.id)
    if (status.running && status.actual_port) {
      return status.actual_port
    }

    // Try discovering via port file or other means
    const discovered = await discoverAppPort(app.id, app.workingDir)
    if (discovered) {
      // Verify the port is responding
      const isResponding = await checkPort(discovered)
      if (isResponding) {
        return discovered
      }
    }

    return null
  }, [app])

  // Initial check on mount - discover if app is already running
  useEffect(() => {
    if (!app) {
      setState('stopped')
      setActualPort(null)
      initialCheckDone.current = false
      return
    }

    // Reset for new app
    if (!initialCheckDone.current) {
      initialCheckDone.current = true

      const doInitialCheck = async () => {
        const runningPort = await discoverRunningApp()
        if (runningPort) {
          setActualPort(runningPort)
          setState('running')
          setError(null)
        } else {
          setState('stopped')
        }
      }

      doInitialCheck()

      // Do a follow-up check after a short delay to catch apps that are starting
      // This handles the race between auto-start and widget mount
      const followUpCheck = setTimeout(async () => {
        const runningPort = await discoverRunningApp()
        if (runningPort) {
          setActualPort(runningPort)
          setState('running')
          setError(null)
        }
      }, 1500)

      return () => clearTimeout(followUpCheck)
    }
  }, [app, discoverRunningApp])

  // Reset initialCheckDone when app changes
  useEffect(() => {
    initialCheckDone.current = false
  }, [app?.id])

  // Periodic status check
  const checkStatus = useCallback(async () => {
    if (!app) {
      setState('stopped')
      return
    }

    try {
      // Check the actual port if we have one, otherwise try discovery
      let portToCheck = actualPort
      if (!portToCheck) {
        // Try to discover the port
        portToCheck = await discoverRunningApp()
        if (portToCheck) {
          setActualPort(portToCheck)
        }
      }

      if (portToCheck) {
        const isRunning = await checkPort(portToCheck)
        setState((prev) => {
          // Don't override transitional, error, or port_conflict states
          if (
            prev === 'starting' ||
            prev === 'stopping' ||
            prev === 'error' ||
            prev === 'port_conflict'
          ) {
            return prev
          }
          if (isRunning) {
            setError(null)
            return 'running'
          }
          // Port was tracked but no longer responding
          setActualPort(null)
          return 'stopped'
        })
      }

      // Fetch logs in background
      fetchLogs()
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [app, actualPort, discoverRunningApp, fetchLogs])

  const start = useCallback(
    async (overridePort?: number) => {
      if (!app) return

      // First, check if already running
      const runningPort = await discoverRunningApp()
      if (runningPort) {
        setActualPort(runningPort)
        setState('running')
        return
      }

      const targetPort = overridePort ?? app.port

      // Check if the port is available
      const portAvailable = await isPortAvailable(targetPort)

      if (!portAvailable) {
        // Port is in use by something else
        if (app.requiresPort) {
          // App requires this specific port - show conflict dialog
          const [info, suggested] = await Promise.all([
            getPortInfo(targetPort),
            findFreePort(targetPort + 1),
          ])

          setPortConflict({
            port: targetPort,
            info,
            suggestedPort: suggested,
          })
          setState('port_conflict')
          return
        } else {
          // App doesn't require specific port - auto-pick a free one
          const freePort = await findFreePort(targetPort)
          return startWithPort(freePort)
        }
      }

      // Port is available, start on it
      return startWithPort(targetPort)

      async function startWithPort(port: number) {
        setState('starting')
        setError(null)
        setLogs([])
        setPortConflict(null)

        try {
          const result = await startAppCmd(
            app!,
            port !== app!.port ? port : undefined,
          )

          // Track the actual port
          const startedPort = result.actual_port ?? port
          setActualPort(startedPort)

          // Poll until running or timeout
          let attempts = 0
          const maxAttempts = 30 // 30 seconds

          const poll = async () => {
            // Check if port is accessible
            const isRunning = await checkPort(startedPort)
            if (isRunning) {
              setState('running')
              setError(null)
              return
            }

            // Check if process crashed (via Tauri status)
            if (isTauri()) {
              const status = await getAppStatus(app!.id)
              if (!status.running && status.recent_output.length > 0) {
                // Process crashed - show error with logs
                setState('error')
                setLogs(status.recent_output)
                // Extract error message from logs
                const errorLines = status.recent_output
                  .filter(
                    (l) =>
                      l.includes('error') ||
                      l.includes('Error') ||
                      l.includes('ERROR'),
                  )
                  .slice(-5)
                setError(
                  errorLines.length > 0
                    ? errorLines.join('\n')
                    : 'App crashed during startup. Check logs for details.',
                )
                return
              }

              // Update actual port if detected from stdout
              if (status.actual_port && status.actual_port !== startedPort) {
                setActualPort(status.actual_port)
              }
            }

            attempts++
            if (attempts < maxAttempts) {
              setTimeout(poll, 1000)
            } else {
              // Timeout - fetch logs to see what happened
              await fetchLogs()
              setState('error')
              setError(
                'App failed to start within 30 seconds. Check logs for details.',
              )
            }
          }

          setTimeout(poll, 1000)
        } catch (err) {
          setState('error')
          setError(err instanceof Error ? err.message : 'Failed to start app')
          await fetchLogs()
        }
      }
    },
    [app, discoverRunningApp, fetchLogs],
  )

  // Kill the process on the conflicting port and retry start
  const killAndStart = useCallback(async () => {
    if (!app || !portConflict) return

    const killed = await killPort(portConflict.port)
    if (killed) {
      // Wait a moment for port to be released
      await new Promise((r) => setTimeout(r, 300))
    }

    // Clear conflict state and start
    setPortConflict(null)
    start()
  }, [app, portConflict, start])

  // Start on an alternative port
  const startOnAlternatePort = useCallback(async () => {
    if (!app || !portConflict) return

    setPortConflict(null)
    start(portConflict.suggestedPort)
  }, [app, portConflict, start])

  // Dismiss port conflict dialog
  const dismissPortConflict = useCallback(() => {
    setPortConflict(null)
    setState('stopped')
  }, [])

  const stop = useCallback(async () => {
    if (!app) return
    setState('stopping')
    try {
      await stopAppCmd(app.id)
      setState('stopped')
      setError(null)
      setActualPort(null)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Failed to stop app')
    }
  }, [app])

  const restart = useCallback(async () => {
    if (!app) return
    await stop()
    // Small delay to ensure process is fully stopped
    await new Promise((r) => setTimeout(r, 500))
    await start()
  }, [app, start, stop])

  const clearError = useCallback(() => {
    setError(null)
    setLogs([])
  }, [])

  // Periodic status check
  useEffect(() => {
    if (!app) return

    // Poll every 3 seconds
    const interval = setInterval(checkStatus, 3000)
    return () => clearInterval(interval)
  }, [app, checkStatus])

  return {
    state,
    error,
    logs,
    actualPort,
    portConflict,
    checkStatus,
    start,
    stop,
    restart,
    clearError,
    fetchLogs,
    killAndStart,
    startOnAlternatePort,
    dismissPortConflict,
  }
}
