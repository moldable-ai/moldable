import { Check, Copy, RefreshCw, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@moldable-ai/ui'
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

interface DeveloperToolsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeveloperToolsDialog({
  open,
  onOpenChange,
}: DeveloperToolsDialogProps) {
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
    if (open) {
      checkStatus()
    }
  }, [open, checkStatus])

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-[700px] max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-5" />
            Developer Tools
          </DialogTitle>
          <DialogDescription>
            Runtime status for Node.js and pnpm (bundled with the app).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-hidden py-4">
          {/* Node.js Status */}
          <div className="bg-muted/50 overflow-hidden rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="shrink-0 text-lg">⬢</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Node.js</p>
                  <p className="text-muted-foreground text-sm">
                    {status?.nodeVersion ?? 'Checking...'}
                  </p>
                </div>
              </div>
              {status?.nodeInstalled ? (
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-500">
                  <Check className="size-4" />
                </div>
              ) : (
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                  ✕
                </div>
              )}
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
          <div className="bg-muted/50 overflow-hidden rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="shrink-0 text-lg">📦</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">pnpm</p>
                  <p className="text-muted-foreground text-sm">
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
              ) : (
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                  ✕
                </div>
              )}
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
      </DialogContent>
    </Dialog>
  )
}
