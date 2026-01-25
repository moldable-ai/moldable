import type { ReasoningEffort } from '@moldable-ai/ai'
import type { GatewayImagePart, GatewayMessage } from './gateway-sessions.js'
import type { FileUIPart, UIMessage } from 'ai'

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
  images?: GatewayImagePart[]
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
  return messages.map((msg, index) => {
    const parts: Array<FileUIPart | { type: 'text'; text: string }> = []
    const text = msg.text ?? ''
    if (text.trim() !== '') {
      parts.push({ type: 'text', text })
    }
    if (msg.images && msg.images.length > 0) {
      for (const image of msg.images) {
        const mediaType = resolveImageMediaType(image)
        const url = toFileUrl(image, mediaType)
        if (!url) continue
        parts.push({
          type: 'file',
          mediaType,
          url,
        })
        if (image.path && image.path.trim() !== '') {
          parts.push({
            type: 'text',
            text: `Image saved to: ${image.path}`,
          })
        }
      }
    }
    if (parts.length === 0) {
      parts.push({ type: 'text', text: '' })
    }
    return {
      id: msg.timestamp ? String(msg.timestamp) : `${Date.now()}-${index}`,
      role: msg.role,
      parts,
    }
  })
}

function toFileUrl(
  image: GatewayImagePart,
  resolvedMediaType: string,
): string | null {
  const raw = image.image?.trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) {
    return raw
  }
  if (/^data:/i.test(raw)) {
    const comma = raw.indexOf(',')
    if (comma === -1) return raw
    const header = raw.slice(0, comma)
    if (!/;base64$/i.test(header)) {
      return raw
    }
    const base64 = raw.slice(comma + 1)
    return `data:${resolvedMediaType};base64,${base64}`
  }
  return `data:${resolvedMediaType};base64,${raw}`
}

const GENERIC_MEDIA_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
])

function normalizeMediaType(mediaType?: string | null): string | null {
  if (!mediaType) return null
  const normalized = mediaType.split(';')[0]?.trim().toLowerCase()
  return normalized || null
}

function mediaTypeFromDataUrl(raw: string): string | null {
  if (!/^data:/i.test(raw)) return null
  const withoutPrefix = raw.replace(/^data:/i, '')
  const media = withoutPrefix.split(';')[0]?.trim().toLowerCase()
  return media || null
}

function mediaTypeFromUrl(raw: string): string | null {
  if (!/^https?:\/\//i.test(raw) && !/^file:\/\//i.test(raw)) {
    return null
  }
  const clean = raw.split('?')[0]?.split('#')[0] ?? ''
  const extMatch = /\.([a-z0-9]+)$/i.exec(clean)
  const ext = extMatch?.[1]?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    default:
      return null
  }
}

function mediaTypeFromBase64(raw: string): string | null {
  if (!raw) return null
  let base64 = raw.trim()
  if (/^data:/i.test(base64)) {
    const comma = base64.indexOf(',')
    if (comma === -1) return null
    base64 = base64.slice(comma + 1)
  }
  base64 = base64.replace(/\s/g, '')
  if (!base64) return null
  const sample = base64.slice(0, 64)
  let bytes: Uint8Array
  try {
    bytes = Buffer.from(sample, 'base64')
  } catch {
    return null
  }
  if (bytes.length >= 4) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png'
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg'
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif'
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'image/bmp'
    }
    if (
      (bytes[0] === 0x49 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x2a &&
        bytes[3] === 0x00) ||
      (bytes[0] === 0x4d &&
        bytes[1] === 0x4d &&
        bytes[2] === 0x00 &&
        bytes[3] === 0x2a)
    ) {
      return 'image/tiff'
    }
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function resolveImageMediaType(image: GatewayImagePart): string {
  const declared = normalizeMediaType(image.mediaType)
  if (
    declared &&
    declared.startsWith('image/') &&
    !GENERIC_MEDIA_TYPES.has(declared)
  ) {
    return declared
  }
  const raw = image.image ?? ''
  const fromDataUrl = mediaTypeFromDataUrl(raw)
  if (fromDataUrl && fromDataUrl.startsWith('image/')) {
    return fromDataUrl
  }
  const fromUrl = mediaTypeFromUrl(raw)
  if (fromUrl) return fromUrl
  const fromBase64 = mediaTypeFromBase64(raw)
  if (fromBase64) return fromBase64
  return 'image/png'
}

export function toGatewayMessages(
  messages: GatewayMessageInput[],
): GatewayMessage[] {
  const now = Date.now()
  return messages.map((msg, index) => ({
    role: msg.role,
    text: msg.text,
    timestamp: msg.timestamp ?? Math.floor((now + index) / 1000),
    images: msg.images,
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
