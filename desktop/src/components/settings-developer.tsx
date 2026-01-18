import { Check, Copy, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'

/** Runtime status from the Rust backend */
interface DependencyStatus {
  nodeInstalled: boolean
  nodeVersion: string | null
  nodePath: string | null
  nodeSource: 'bundled' | 'system' | null
  pnpmInstalled: boolean
  pnpmVersion: string | null
  pnpmPath: string | null
}

export function SettingsDeveloper() {
  const [status, setStatus] = useState<DependencyStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const checkStatus = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<DependencyStatus>('check_dependencies')
      setStatus(result)
    } catch (err) {
      console.error('Failed to check dependencies:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const handleCopyDiagnostics = useCallback(async () => {
    if (!status) return

    const lines = [
      'Moldable Runtime Status',
      '=======================',
      '',
      'Node.js:',
      `  Status: ${status.nodeInstalled ? 'OK' : 'Not found'}`,
      `  Version: ${status.nodeVersion ?? 'N/A'}`,
      `  Source: ${status.nodeSource ?? 'N/A'}`,
      `  Path: ${status.nodePath ?? 'N/A'}`,
      '',
      'pnpm:',
      `  Status: ${status.pnpmInstalled ? 'OK' : 'Not found'}`,
      `  Version: ${status.pnpmVersion ?? 'N/A'}`,
      `  Path: ${status.pnpmPath ?? 'N/A'}`,
      '',
      'System:',
      `  Platform: ${navigator.platform}`,
      `  Time: ${new Date().toISOString()}`,
    ]

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      console.log('Diagnostic report:', lines.join('\n'))
    }
  }, [status])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Developer Tools</h2>
        <p className="text-muted-foreground text-xs">
          Runtime status for Node.js and pnpm (bundled with the app)
        </p>
      </div>

      <div className="space-y-3">
        {/* Node.js Status */}
        <div className="bg-muted/30 overflow-hidden rounded-lg px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="shrink-0 text-sm">⬢</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Node.js</p>
                <p className="text-muted-foreground text-xs">
                  {status?.nodeVersion ?? 'Checking...'}
                </p>
              </div>
            </div>
            {status?.nodeInstalled ? (
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-500">
                <Check className="size-4" />
              </div>
            ) : status !== null ? (
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                ✕
              </div>
            ) : null}
          </div>
          {status?.nodePath && (
            <p
              className="text-muted-foreground mt-2 truncate text-xs"
              title={status.nodePath}
            >
              {status.nodeSource === 'bundled' ? '📦 Bundled' : '💻 System'}
            </p>
          )}
        </div>

        {/* pnpm Status */}
        <div className="bg-muted/30 overflow-hidden rounded-lg px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="shrink-0 text-sm">📦</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">pnpm</p>
                <p className="text-muted-foreground text-xs">
                  {status?.pnpmVersion
                    ? `v${status.pnpmVersion}`
                    : 'Checking...'}
                </p>
              </div>
            </div>
            {status?.pnpmInstalled ? (
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-500">
                <Check className="size-4" />
              </div>
            ) : status !== null ? (
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                ✕
              </div>
            ) : null}
          </div>
          {status?.pnpmPath && (
            <p
              className="text-muted-foreground mt-2 truncate text-xs"
              title={status.pnpmPath}
            >
              Bundled with Node.js
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkStatus}
            disabled={loading}
            className="cursor-pointer"
          >
            <RefreshCw
              className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyDiagnostics}
            className="cursor-pointer"
          >
            <Copy className="mr-2 size-4" />
            {copied ? 'Copied!' : 'Copy for support'}
          </Button>
        </div>
      </div>
    </div>
  )
}
