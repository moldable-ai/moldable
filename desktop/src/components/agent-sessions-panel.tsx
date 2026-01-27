import { Bot, Loader2, RefreshCcw, Trash2, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button, ScrollArea, cn } from '@moldable-ai/ui'
import {
  type GatewayMessage,
  type GatewaySessionMeta,
  useGatewaySessions,
} from '../hooks/use-gateway-sessions'

interface AgentSessionsPanelProps {
  aiServerPort?: number
  workspaceId?: string
  onClose?: () => void
  variant?: 'panel' | 'popover' | 'dialog'
  showCloseButton?: boolean
  pollingEnabled?: boolean
  pollIntervalMs?: number
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return date.toLocaleString()
}

function formatIsoDate(value: string): string {
  const date = new Date(value)
  return date.toLocaleString()
}

function buildSessionSubtitle(session: GatewaySessionMeta): string {
  const parts = [session.channel, session.displayName].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Gateway session'
}

function messageTone(role: GatewayMessage['role']): string {
  if (role === 'assistant') return 'bg-primary/10 border-primary/20'
  if (role === 'system') return 'bg-muted border-muted'
  return 'bg-card border-border'
}

export function AgentSessionsPanel({
  aiServerPort,
  workspaceId,
  onClose,
  variant = 'panel',
  showCloseButton = true,
  pollingEnabled = false,
  pollIntervalMs = 5000,
}: AgentSessionsPanelProps) {
  const {
    sessions,
    activeSession,
    activeSessionId,
    isLoadingList,
    isLoadingSession,
    error,
    refreshSessions,
    selectSession,
    deleteSession,
  } = useGatewaySessions({ aiServerPort, workspaceId })

  useEffect(() => {
    if (!pollingEnabled) return
    const intervalId = window.setInterval(() => {
      if (!isLoadingList) {
        refreshSessions()
      }
    }, pollIntervalMs)

    return () => window.clearInterval(intervalId)
  }, [pollingEnabled, pollIntervalMs, refreshSessions, isLoadingList])

  return (
    <section
      className={cn(
        'bg-card flex h-full w-full flex-col',
        variant === 'popover'
          ? 'border-border rounded-xl border shadow-lg'
          : variant === 'panel'
            ? 'border-border border-l'
            : null,
      )}
    >
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshSessions}
            className="cursor-pointer"
            aria-label="Refresh sessions"
          >
            <RefreshCcw className="size-4" />
          </Button>
          <div className="bg-muted flex size-8 items-center justify-center rounded-lg">
            <Bot className="size-4" />
          </div>
          <div>
            <div className="text-sm font-medium">Agents</div>
            <div className="text-muted-foreground text-xs">
              Gateway sessions
            </div>
          </div>
        </div>
        {onClose && showCloseButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="cursor-pointer"
          >
            <X className="size-4" />
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="border-border min-h-0 w-52 shrink-0 border-r">
          <ScrollArea className="h-full min-h-0">
            <div className="flex flex-col gap-2 p-2">
              {isLoadingList && (
                <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading sessions...
                </div>
              )}
              {!isLoadingList && sessions.length === 0 && (
                <div className="text-muted-foreground px-2 py-2 text-xs">
                  No gateway sessions yet.
                </div>
              )}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => selectSession(session.id)}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors',
                    session.id === activeSessionId
                      ? 'bg-muted text-foreground'
                      : 'hover:bg-muted/50 text-foreground',
                  )}
                >
                  <span className="truncate text-sm font-medium">
                    {session.title}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {buildSessionSubtitle(session)}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {formatIsoDate(session.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {error && (
            <div className="border-border bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
              {error}
            </div>
          )}

          {isLoadingSession && (
            <div className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading session...
            </div>
          )}

          {!activeSession && !isLoadingSession && (
            <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-sm">
              Select a session to view its transcript.
            </div>
          )}

          {activeSession && (
            <>
              <div className="border-border flex items-center justify-between border-b px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">
                    {activeSession.title}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {buildSessionSubtitle(activeSession)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteSession(activeSession.id)}
                  className="cursor-pointer"
                >
                  <Trash2 className="mr-1 size-3.5" />
                  Delete
                </Button>
              </div>

              <div className="border-border grid grid-cols-2 gap-2 border-b px-4 py-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Channel</div>
                  <div>{activeSession.channel ?? 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Sender</div>
                  <div>{activeSession.displayName ?? 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Agent</div>
                  <div>{activeSession.agentId ?? 'Default'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Updated</div>
                  <div>{formatIsoDate(activeSession.updatedAt)}</div>
                </div>
                {activeSession.peerId && (
                  <div>
                    <div className="text-muted-foreground">Peer ID</div>
                    <div className="truncate" title={activeSession.peerId}>
                      {activeSession.peerId}
                    </div>
                  </div>
                )}
                {activeSession.sessionKey && (
                  <div>
                    <div className="text-muted-foreground">Session Key</div>
                    <div className="truncate" title={activeSession.sessionKey}>
                      {activeSession.sessionKey}
                    </div>
                  </div>
                )}
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-3 p-4">
                  {activeSession.messages.map((message, index) => (
                    <div
                      key={`${message.timestamp}-${index}`}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm',
                        messageTone(message.role),
                      )}
                    >
                      <div className="text-muted-foreground mb-1 text-[11px] uppercase tracking-wide">
                        {message.role}
                      </div>
                      <div className="whitespace-pre-wrap text-sm">
                        {message.text}
                      </div>
                      <div className="text-muted-foreground mt-2 text-[11px]">
                        {formatTimestamp(message.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
