import {
  buildGatewayContext,
  normalizeGatewayMessages,
  resolveGatewaySessionId,
  toGatewayMessages,
} from './gateway.js'
import type { FileUIPart } from 'ai'
import { describe, expect, it } from 'vitest'

describe('gateway helpers', () => {
  it('normalizes gateway messages into UI messages', () => {
    const uiMessages = normalizeGatewayMessages([
      { role: 'user', text: 'Hello', timestamp: 1710000000 },
      {
        role: 'assistant',
        text: 'Hi there',
        images: [
          {
            type: 'image',
            image: 'data:image/png;base64,abcd',
            mediaType: 'image/png',
          },
        ],
      },
    ])

    expect(uiMessages).toHaveLength(2)
    expect(uiMessages[0]?.parts?.[0]).toMatchObject({
      type: 'text',
      text: 'Hello',
    })
    expect(uiMessages[1]?.parts?.[0]).toMatchObject({
      type: 'text',
      text: 'Hi there',
    })
    expect(uiMessages[1]?.parts?.[1]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,abcd',
    })
  })

  it('infers image media type when generic type is provided', () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='
    const uiMessages = normalizeGatewayMessages([
      {
        role: 'user',
        text: '',
        images: [
          {
            type: 'image',
            image: pngBase64,
            mediaType: 'application/octet-stream',
          },
        ],
      },
    ])

    const filePart = uiMessages[0]?.parts?.[0]
    expect(filePart?.type).toBe('file')
    const typedFilePart = filePart as FileUIPart | undefined
    expect(typedFilePart).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
    })
    expect(typedFilePart?.url?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('converts gateway input into stored messages', () => {
    const stored = toGatewayMessages([
      { role: 'user', text: 'Ping', timestamp: 1710001111 },
      {
        role: 'assistant',
        text: 'Pong',
        images: [{ type: 'image', image: 'base64', mediaType: 'image/png' }],
      },
    ])

    expect(stored[0]).toMatchObject({ role: 'user', text: 'Ping' })
    expect(typeof stored[1]?.timestamp).toBe('number')
    expect(stored[1]?.images?.[0]).toMatchObject({
      type: 'image',
      image: 'base64',
      mediaType: 'image/png',
    })
  })

  it('resolves gateway session id by priority', () => {
    expect(resolveGatewaySessionId({ sessionId: 'primary' })).toBe('primary')
    expect(resolveGatewaySessionId({ session_id: 'fallback' })).toBe('fallback')
    expect(
      resolveGatewaySessionId({ gateway: { sessionKey: 'gateway-key' } }),
    ).toBe('gateway-key')
  })

  it('builds gateway context from metadata', () => {
    expect(buildGatewayContext()).toBeNull()
    const context = buildGatewayContext({
      channel: 'telegram',
      displayName: 'Alice',
      peerId: '123',
      isGroup: false,
      agentId: 'main',
    })
    expect(context).toContain('Gateway context:')
    expect(context).toContain('Channel: telegram')
    expect(context).toContain('Sender: Alice')
  })
})
