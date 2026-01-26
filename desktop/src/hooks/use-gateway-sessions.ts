import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_AI_SERVER_PORT = 39200

export type GatewayMessage = {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: number
}

export type GatewaySessionMeta = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  channel?: string
  peerId?: string
  displayName?: string
  isGroup?: boolean
  agentId?: string
  sessionKey?: string
}

export type GatewaySession = GatewaySessionMeta & {
  messages: GatewayMessage[]
}

export type UseGatewaySessionsOptions = {
  aiServerPort?: number
  workspaceId?: string
}

export function useGatewaySessions({
  aiServerPort = DEFAULT_AI_SERVER_PORT,
  workspaceId,
}: UseGatewaySessionsOptions) {
  const [sessions, setSessions] = useState<GatewaySessionMeta[]>([])
  const [activeSession, setActiveSession] = useState<GatewaySession | null>(
    null,
  )
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const baseUrl = useMemo(
    () => `http://127.0.0.1:${aiServerPort}`,
    [aiServerPort],
  )

  const queryString = useMemo(() => {
    if (!workspaceId) return ''
    const params = new URLSearchParams({ workspaceId })
    return `?${params.toString()}`
  }, [workspaceId])

  const sessionsUrl = useMemo(
    () => `${baseUrl}/api/gateway/sessions${queryString}`,
    [baseUrl, queryString],
  )

  const sessionUrl = useCallback(
    (id: string) =>
      `${baseUrl}/api/gateway/sessions/${encodeURIComponent(id)}${queryString}`,
    [baseUrl, queryString],
  )

  const refreshSessions = useCallback(async () => {
    setIsLoadingList(true)
    setError(null)
    try {
      const response = await fetch(sessionsUrl)
      if (!response.ok) throw new Error('Failed to load gateway sessions')
      const data = (await response.json()) as GatewaySessionMeta[]
      setSessions(Array.isArray(data) ? data : [])
      const currentActiveId = activeSessionIdRef.current
      if (
        currentActiveId &&
        !data.some((session) => session.id === currentActiveId)
      ) {
        setActiveSessionId(null)
        setActiveSession(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setIsLoadingList(false)
    }
  }, [sessionsUrl])

  const loadSession = useCallback(
    async (id: string): Promise<GatewaySession | null> => {
      setIsLoadingSession(true)
      setError(null)
      try {
        const response = await fetch(sessionUrl(id))
        if (!response.ok) throw new Error('Failed to load gateway session')
        const data = (await response.json()) as GatewaySession
        setActiveSession(data)
        setActiveSessionId(id)
        return data
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session')
        return null
      } finally {
        setIsLoadingSession(false)
      }
    },
    [sessionUrl],
  )

  const selectSession = useCallback(
    async (id: string) => {
      await loadSession(id)
    },
    [loadSession],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      setError(null)
      try {
        const response = await fetch(sessionUrl(id), { method: 'DELETE' })
        if (!response.ok) throw new Error('Failed to delete session')
        if (activeSessionId === id) {
          setActiveSessionId(null)
          setActiveSession(null)
        }
        await refreshSessions()
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to delete session',
        )
      }
    },
    [activeSessionId, refreshSessions, sessionUrl],
  )

  const clearSelection = useCallback(() => {
    setActiveSessionId(null)
    setActiveSession(null)
  }, [])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    clearSelection()
    refreshSessions()
  }, [clearSelection, refreshSessions])

  return {
    sessions,
    activeSession,
    activeSessionId,
    isLoadingList,
    isLoadingSession,
    error,
    refreshSessions,
    loadSession,
    selectSession,
    deleteSession,
    clearSelection,
  }
}
