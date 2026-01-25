import { createGatewayTools } from './gateway-tools.js'
import { describe, expect, it, vi } from 'vitest'

describe('gateway tools', () => {
  it('spawns subagents using gateway context defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ run_id: 'run-1' }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = fetchMock

    const tools = createGatewayTools({
      baseUrl: 'http://127.0.0.1:18790',
      token: 'token',
      context: {
        sessionKey: 'agent:main:telegram:dm:123',
        channel: 'telegram',
        chatId: '123',
        peerId: '123',
        isGroup: false,
        agentId: 'main',
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.gatewaySpawnSubagent as any).execute({ task: 'Review logs' })

    const [url, init] = fetchMock.mock.calls[0] || []
    expect(url).toBe('http://127.0.0.1:18790/api/agents/subagents/spawn')
    const body = JSON.parse(init.body as string)
    expect(body.requester_session_key).toBe('agent:main:telegram:dm:123')
    expect(body.requester_channel).toBe('telegram')
    expect(body.agent_id).toBe('main')
  })

  it('creates cron jobs using context defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'job-1' }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = fetchMock

    const tools = createGatewayTools({
      baseUrl: 'http://127.0.0.1:18790',
      context: {
        sessionKey: 'agent:main:telegram:dm:123',
        channel: 'telegram',
        chatId: '123',
        peerId: '123',
        isGroup: false,
        agentId: 'main',
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.gatewayCreateCronJob as any).execute({
      schedule: '0 9 * * *',
      task: 'Morning summary',
    })

    const [url, init] = fetchMock.mock.calls[0] || []
    expect(url).toBe('http://127.0.0.1:18790/api/cron/jobs')
    const body = JSON.parse(init.body as string)
    expect(body.channel).toBe('telegram')
    expect(body.agent_id).toBe('main')
    expect(body.session_key).toBe('agent:main:telegram:dm:123')
  })
})
