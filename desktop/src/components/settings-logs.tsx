import {
  ArrowDown,
  Check,
  Copy,
  FolderOpen,
  Terminal,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cn } from '@moldable-ai/ui'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'

export function SettingsLogs() {
  const [logs, setLogs] = useState<string[]>([])
  const [logPath, setLogPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)

  const fetchLogs = useCallback(async () => {
    if (!isTauri()) return

    try {
      const [lines, path] = await Promise.all([
        invoke<string[]>('get_system_logs', { maxLines: 2000 }),
        invoke<string>('get_system_log_path'),
      ])
      setLogs(lines)
      setLogPath(path)
    } catch (err) {
      console.error('Failed to fetch system logs:', err)
      setLogs([`Error loading logs: ${err}`])
    }
  }, [])

  // Fetch logs initially and poll for updates
  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [fetchLogs])

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = logsContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    setIsUserScrolledUp(distanceFromBottom > 50)
  }, [])

  // Auto-scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    const container = logsContainerRef.current
    if (!isUserScrolledUp && container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [logs, isUserScrolledUp])

  const handleCopyLogs = useCallback(async () => {
    const text = logs.join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [logs])

  const handleRevealInFinder = useCallback(async () => {
    if (!logPath) return
    try {
      const logDir = logPath.substring(0, logPath.lastIndexOf('/'))
      await open(logDir)
    } catch (err) {
      console.error('Failed to reveal log file:', err)
    }
  }, [logPath])

  const handleClearLogs = useCallback(async () => {
    if (!isTauri()) return

    setIsClearing(true)
    try {
      await invoke('clear_system_logs')
      setLogs([])
    } catch (err) {
      console.error('Failed to clear logs:', err)
    } finally {
      setIsClearing(false)
    }
  }, [])

  const getLogLevel = (line: string): 'error' | 'warn' | 'info' | 'debug' => {
    if (line.includes(' ERROR ') || line.includes('[ERROR]')) return 'error'
    if (line.includes(' WARN ') || line.includes('[WARN]')) return 'warn'
    if (line.includes(' DEBUG ') || line.includes('[DEBUG]')) return 'debug'
    return 'info'
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">System Logs</h2>
        <p className="text-muted-foreground text-xs">
          View system and AI server logs
        </p>
      </div>

      <div className="border-border flex h-[500px] flex-col overflow-hidden rounded-lg border">
        {/* Header */}
        <div className="border-border bg-muted/30 flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Terminal className="text-muted-foreground size-4" />
            <span className="text-sm font-medium">Logs</span>
            <span className="text-muted-foreground text-xs">
              ({logs.length} lines)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearLogs}
              className="h-7 cursor-pointer gap-1.5 px-2"
              disabled={isClearing || logs.length === 0}
            >
              <Trash2 className="size-3.5" />
              {isClearing ? 'Clearing...' : 'Clear'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRevealInFinder}
              className="h-7 cursor-pointer gap-1.5 px-2"
              disabled={!logPath}
            >
              <FolderOpen className="size-3.5" />
              Finder
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyLogs}
              className="h-7 cursor-pointer gap-1.5 px-2"
            >
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Logs content */}
        <div className="relative flex-1 overflow-hidden">
          <div
            ref={logsContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-auto bg-black/95 p-4 font-mono text-xs"
          >
            {logs.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center">
                No logs yet. Logs will appear here as you use the app.
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((line, i) => {
                  const level = getLogLevel(line)
                  return (
                    <div
                      key={i}
                      className={cn(
                        'whitespace-pre-wrap break-all',
                        level === 'error' && 'text-red-400',
                        level === 'warn' && 'text-yellow-400',
                        level === 'debug' && 'text-gray-500',
                        level === 'info' && 'text-green-400',
                      )}
                    >
                      {line}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {/* Scroll to bottom button */}
          {isUserScrolledUp && logs.length > 0 && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => {
                setIsUserScrolledUp(false)
                const container = logsContainerRef.current
                if (container) {
                  container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth',
                  })
                }
              }}
              className="absolute bottom-4 right-4 size-8 cursor-pointer shadow-lg"
            >
              <ArrowDown className="size-4" />
            </Button>
          )}
        </div>

        {/* Footer */}
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <span className="text-muted-foreground text-xs">
            Auto-refreshing every 2 seconds
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            className="h-7 cursor-pointer"
          >
            Refresh
          </Button>
        </div>
      </div>
    </div>
  )
}
