import {
  type GatewaySession,
  buildGatewaySessionTitle,
  deleteGatewaySession,
  listGatewaySessions,
  loadGatewaySession,
  saveGatewaySession,
} from './gateway-sessions.js'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('gateway sessions store', () => {
  it('saves and loads sessions', () => {
    const home = mkdtempSync(join(tmpdir(), 'moldable-gateway-'))
    const session: GatewaySession = {
      id: 'agent:main:telegram:dm:123',
      title: 'Hello',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 1,
      messages: [{ role: 'user', text: 'Hello', timestamp: Date.now() / 1000 }],
      channel: 'telegram',
      peerId: '123',
      agentId: 'main',
      sessionKey: 'agent:main:telegram:dm:123',
    }
    saveGatewaySession(session, { moldableHome: home })
    const loaded = loadGatewaySession(session.id, { moldableHome: home })
    expect(loaded?.id).toBe(session.id)
    const list = listGatewaySessions({ moldableHome: home })
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(session.id)
    expect(deleteGatewaySession(session.id, { moldableHome: home })).toBe(true)
  })

  it('builds a title from the first user message', () => {
    const title = buildGatewaySessionTitle([
      { role: 'user', text: 'Build a quick todo list app', timestamp: 0 },
    ])
    expect(title).toContain('Build a quick todo list')
  })
})
