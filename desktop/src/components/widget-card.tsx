import { AlertCircle, Play, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTheme } from '@moldable-ai/ui'
import { cn } from '@/lib/utils'
import { type AppState, useAppStatus } from '@/hooks/use-app-status'
import type { AppConfig } from '../app'

interface WidgetCardProps {
  app: AppConfig
  workspaceId: string
  onClick: () => void
}

const WIDGET_SIZES = {
  small: 'min-h-[140px]',
  medium: 'min-h-[200px]',
  large: 'min-h-[200px]',
}

const STATUS_BG_COLORS: Record<AppState, string> = {
  running: 'bg-status-running',
  stopped: 'bg-status-stopped',
  starting: 'bg-status-pending',
  stopping: 'bg-status-pending',
  error: 'bg-status-error',
  port_conflict: 'bg-amber-500',
}

const STATUS_LABELS: Record<AppState, string> = {
  running: 'Running',
  stopped: 'Stopped',
  starting: 'Starting...',
  stopping: 'Stopping...',
  error: 'Error',
  port_conflict: 'Port in use',
}

export function WidgetCard({ app, workspaceId, onClick }: WidgetCardProps) {
  const [isLoading, setIsLoading] = useState(true)
  const { state, error, actualPort } = useAppStatus(app)
  const { resolvedTheme } = useTheme()
  // Use actual port if available, otherwise configured port
  const runningPort = actualPort ?? app.port
  const widgetUrl = `http://127.0.0.1:${runningPort}/widget?theme=${resolvedTheme}&workspace=${workspaceId}`
  const isRunning = state === 'running'
  const isStarting = state === 'starting'
  const isError = state === 'error'

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl transition-all',
        // Base background color
        'bg-card',
        // Outer shadow for depth - softer shadows
        'shadow-[0_2px_12px_rgba(0,0,0,0.08)]',
        'hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)]',
        WIDGET_SIZES[app.widgetSize],
      )}
    >
      {/* Background Sheen - glossy volume effect */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'linear-gradient(134deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 50%, transparent 55%)',
        }}
      />

      {/* Specular Highlight Border */}
      <div
        className="pointer-events-none absolute inset-0 z-50 rounded-2xl"
        style={{
          padding: '1px',
          // Subtle white on top-left AND bottom-right, dimmed white in middle
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.1) 20%, rgba(255,255,255,0.05) 45%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.1) 80%, rgba(255,255,255,0.25) 100%)',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMask:
            'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
          WebkitMaskComposite: 'xor',
        }}
      />

      {/* Header bar - floating pill */}
      <button
        onClick={onClick}
        className="relative z-40 mx-0.5 my-0.5 flex h-7 shrink-0 cursor-pointer items-center justify-between rounded-xl px-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      >
        <div className="flex items-center gap-2">
          {app.iconPath ? (
            <img
              src={app.iconPath}
              alt=""
              className="size-4 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <span className={app.iconPath ? 'hidden text-sm' : 'text-sm'}>
            {app.icon}
          </span>
          <span className="text-muted-foreground text-xs font-medium">
            {app.name}
          </span>
        </div>
        <div className="flex items-center">
          <span
            className={cn('size-2 rounded-full', STATUS_BG_COLORS[state])}
            title={STATUS_LABELS[state]}
          />
        </div>
      </button>

      {/* Widget content - always navigate to app view */}
      <button
        onClick={onClick}
        className="bg-background relative z-10 mx-1 mb-1 flex-1 cursor-pointer overflow-hidden rounded-xl"
      >
        {/* Stopped/Starting state */}
        {!isRunning && !isError && (
          <div className="bg-muted/30 absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
            <div className="mb-2">
              {app.iconPath ? (
                <img
                  src={app.iconPath}
                  alt={app.name}
                  className="size-12 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                    e.currentTarget.nextElementSibling?.classList.remove(
                      'hidden',
                    )
                  }}
                />
              ) : null}
              <div className={app.iconPath ? 'hidden text-3xl' : 'text-3xl'}>
                {app.icon}
              </div>
            </div>
            <div className="mb-1 text-sm font-medium">{app.name}</div>
            {isStarting ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <RefreshCw className="size-3 animate-spin" />
                Starting...
              </div>
            ) : (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <Play className="size-3" />
                Click to start
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="bg-status-error/5 absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
            <div className="bg-status-error/10 mb-2 flex size-10 items-center justify-center rounded-full">
              <AlertCircle className="text-status-error size-5" />
            </div>
            <div className="mb-1 text-sm font-medium">Failed to start</div>
            <div className="text-muted-foreground line-clamp-2 text-xs">
              {error || 'Click to see details'}
            </div>
          </div>
        )}

        {/* Iframe with widget view - only show when running */}
        {isRunning && (
          <iframe
            src={widgetUrl}
            className="absolute inset-0 size-full border-0"
            title={`${app.name} widget`}
            allow="microphone; camera; display-capture"
            onLoad={() => setIsLoading(false)}
            onError={() => setIsLoading(false)}
          />
        )}

        {/* Loading overlay - on top of iframe while loading */}
        {isLoading && isRunning && (
          <div className="bg-muted/50 absolute inset-0 flex items-center justify-center">
            <RefreshCw className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}

        {/* Invisible click overlay */}
        <div className="absolute inset-0" />
      </button>
    </div>
  )
}
