import { AlertTriangle, Skull, Unplug } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@moldable-ai/ui'
import type { PortConflict } from '@/hooks/use-app-status'

interface PortConflictDialogProps {
  appName: string
  conflict: PortConflict | null
  onKillAndStart: () => void
  onUseAlternatePort: () => void
  onDismiss: () => void
}

export function PortConflictDialog({
  appName,
  conflict,
  onKillAndStart,
  onUseAlternatePort,
  onDismiss,
}: PortConflictDialogProps) {
  if (!conflict) return null

  const processInfo = conflict.info
  const processName = processInfo?.process_name || 'Unknown process'

  return (
    <AlertDialog
      open={!!conflict}
      onOpenChange={(open) => !open && onDismiss()}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Port {conflict.port} is in use
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                <strong>{appName}</strong> wants to use port{' '}
                <code className="bg-muted rounded px-1">{conflict.port}</code>,
                but it&apos;s already in use.
              </p>

              {processInfo && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="text-foreground font-medium">
                    Blocking process:
                  </div>
                  <div className="text-muted-foreground mt-1 space-y-1">
                    <div>
                      <span className="text-foreground/80">Name:</span>{' '}
                      {processName}
                    </div>
                    {processInfo.pid && (
                      <div>
                        <span className="text-foreground/80">PID:</span>{' '}
                        {processInfo.pid}
                      </div>
                    )}
                    {processInfo.command && (
                      <div className="truncate">
                        <span className="text-foreground/80">Command:</span>{' '}
                        <code className="text-xs">{processInfo.command}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <p className="text-muted-foreground text-sm">
                You can kill the blocking process, or start {appName} on port{' '}
                <code className="bg-muted rounded px-1">
                  {conflict.suggestedPort}
                </code>{' '}
                instead.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel onClick={onDismiss}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onUseAlternatePort}
            className="bg-primary cursor-pointer"
          >
            <Unplug className="mr-2 size-4" />
            Use port {conflict.suggestedPort}
          </AlertDialogAction>
          <AlertDialogAction
            onClick={onKillAndStart}
            className="text-destructive-foreground bg-destructive hover:bg-destructive/90 cursor-pointer"
          >
            <Skull className="mr-2 size-4" />
            Kill &amp; start
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
