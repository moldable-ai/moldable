import {
  buildGatewayContext,
  normalizeGatewayMessages,
  resolveGatewaySessionId,
  toGatewayMessages,
} from './gateway.js'
import { describe, expect, it } from 'vitest'

describe('gateway helpers', () => {
  it('normalizes gateway messages into UI messages', () => {
    const uiMessages = normalizeGatewayMessages([
      { role: 'user', text: 'Hello', timestamp: 1710000000 },
      { role: 'assistant', text: 'Hi there' },
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
  })

  it('converts gateway input into stored messages', () => {
    const stored = toGatewayMessages([
      { role: 'user', text: 'Ping', timestamp: 1710001111 },
      { role: 'assistant', text: 'Pong' },
    ])

    expect(stored[0]).toMatchObject({ role: 'user', text: 'Ping' })
    expect(typeof stored[1]?.timestamp).toBe('number')
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
