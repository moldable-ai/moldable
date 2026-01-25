import type { ReasoningEffort } from '@moldable-ai/ai'
import type { GatewayMessage } from './gateway-sessions.js'
import type { UIMessage } from 'ai'

export type GatewayMetadata = {
  channel?: string
  peerId?: string
  chatId?: string
  displayName?: string
  isGroup?: boolean
  agentId?: string
  sessionKey?: string
  lane?: string
}

export type GatewayMessageInput = {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp?: number
}

export type GatewayChatRequest = {
  sessionId?: string
  session_id?: string
  messages?: GatewayMessageInput[]
  model?: string
  reasoningEffort?: ReasoningEffort
  activeWorkspaceId?: string
  apiServerPort?: number
  requireUnsandboxedApproval?: boolean
  requireDangerousCommandApproval?: boolean
  dangerousPatterns?: string[]
  gateway?: GatewayMetadata
}

export function normalizeGatewayMessages(
  messages: GatewayMessageInput[],
): UIMessage[] {
  return messages.map((msg, index) => ({
    id: msg.timestamp ? String(msg.timestamp) : `${Date.now()}-${index}`,
    role: msg.role,
    parts: [{ type: 'text', text: msg.text }],
  }))
}

export function toGatewayMessages(
  messages: GatewayMessageInput[],
): GatewayMessage[] {
  const now = Date.now()
  return messages.map((msg, index) => ({
    role: msg.role,
    text: msg.text,
    timestamp: msg.timestamp ?? Math.floor((now + index) / 1000),
  }))
}

export function resolveGatewaySessionId(body: GatewayChatRequest): string {
  if (body.sessionId) return body.sessionId
  if (body.session_id) return body.session_id
  if (body.gateway?.sessionKey) return body.gateway.sessionKey
  return `gateway-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildGatewayContext(meta?: GatewayMetadata): string | null {
  if (!meta) return null
  const lines = [
    'Gateway context:',
    meta.channel ? `Channel: ${meta.channel}` : null,
    meta.displayName ? `Sender: ${meta.displayName}` : null,
    meta.peerId ? `Peer ID: ${meta.peerId}` : null,
    meta.chatId ? `Chat ID: ${meta.chatId}` : null,
    typeof meta.isGroup === 'boolean'
      ? `Group message: ${meta.isGroup ? 'yes' : 'no'}`
      : null,
    meta.agentId ? `Agent: ${meta.agentId}` : null,
    meta.sessionKey ? `Session key: ${meta.sessionKey}` : null,
    meta.lane ? `Lane: ${meta.lane}` : null,
  ].filter(Boolean)
  return lines.length > 1 ? lines.join('\n') : null
}
