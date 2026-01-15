import { useCallback, useEffect, useState } from 'react'

interface UpdateInfo {
  timestamp: number
  file: string
}

/**
 * Hook that listens for custom HMR events from our Vite plugin
 * and provides manual reload control. Instead of auto-reloading,
 * it tracks when updates are available and lets the user decide when to reload.
 */
export function useHotReloadNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    // Only run in development with HMR
    if (!import.meta.hot) return

    // Listen for our custom event from the manual-reload plugin
    const handleUpdate = (data: { file: string; timestamp: number }) => {
      setUpdateInfo({
        timestamp: data.timestamp,
        file: data.file,
      })
      setUpdateAvailable(true)
    }

    import.meta.hot.on('moldable:update-available', handleUpdate)

    return () => {
      // Cleanup - though HMR listeners don't have a standard remove API
    }
  }, [])

  const reload = useCallback(() => {
    window.location.reload()
  }, [])

  const dismiss = useCallback(() => {
    setUpdateAvailable(false)
    setUpdateInfo(null)
  }, [])

  return {
    updateAvailable,
    updateInfo,
    reload,
    dismiss,
  }
}
