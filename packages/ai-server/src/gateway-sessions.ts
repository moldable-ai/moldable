import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

export type GatewayImagePart = {
  type: 'image'
  image: string
  mediaType?: string
  path?: string
}

export type GatewayMessage = {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: number
  images?: GatewayImagePart[]
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

export type GatewaySessionStoreOptions = {
  moldableHome: string
  workspaceId?: string | null
}

function resolveGatewaySessionsDir({
  moldableHome,
  workspaceId,
}: GatewaySessionStoreOptions): string {
  if (workspaceId) {
    return join(moldableHome, 'workspaces', workspaceId, 'gateway-sessions')
  }
  return join(moldableHome, 'shared', 'gateway-sessions')
}

function sessionPath(id: string, opts: GatewaySessionStoreOptions): string {
  return join(resolveGatewaySessionsDir(opts), `${sanitizeId(id)}.json`)
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-z0-9-_:.]/gi, '_')
}

export function listGatewaySessions(
  opts: GatewaySessionStoreOptions,
): GatewaySessionMeta[] {
  const dir = resolveGatewaySessionsDir(opts)
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const sessions: GatewaySessionMeta[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.json')) continue
      try {
        const raw = readFileSync(join(dir, entry.name), 'utf-8')
        const parsed = JSON.parse(raw) as GatewaySessionMeta
        if (parsed?.id) sessions.push(parsed)
      } catch {
        continue
      }
    }
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return sessions
  } catch {
    return []
  }
}

export function loadGatewaySession(
  id: string,
  opts: GatewaySessionStoreOptions,
): GatewaySession | null {
  try {
    const raw = readFileSync(sessionPath(id, opts), 'utf-8')
    return JSON.parse(raw) as GatewaySession
  } catch {
    return null
  }
}

export function saveGatewaySession(
  session: GatewaySession,
  opts: GatewaySessionStoreOptions,
): void {
  const dir = resolveGatewaySessionsDir(opts)
  mkdirSync(dir, { recursive: true })
  writeFileSync(sessionPath(session.id, opts), JSON.stringify(session, null, 2))
}

export function deleteGatewaySession(
  id: string,
  opts: GatewaySessionStoreOptions,
): boolean {
  try {
    rmSync(sessionPath(id, opts), { force: true })
    return true
  } catch {
    return false
  }
}

export function buildGatewaySessionTitle(messages: GatewayMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  const text = firstUser?.text?.trim() ?? ''
  if (!text) {
    const hasImages = Boolean(firstUser?.images?.length)
    return hasImages ? 'Image message' : 'Gateway session'
  }
  if (text.length <= 50) return text
  return `${text.slice(0, 47)}...`
}
