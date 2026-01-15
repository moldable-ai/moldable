import { type McpClientEvent, McpClientManager } from './client.js'
import type { McpServerConfig } from './types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the MCP SDK modules
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Tool result' }],
    }),
    setNotificationHandler: vi.fn(),
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ToolListChangedNotificationSchema: {
    method: 'notifications/tools/list_changed',
  },
  ResourceListChangedNotificationSchema: {
    method: 'notifications/resources/list_changed',
  },
  PromptListChangedNotificationSchema: {
    method: 'notifications/prompts/list_changed',
  },
}))

vi.mock('./config.js', () => ({
  loadMcpConfig: vi.fn().mockReturnValue({ mcpServers: {} }),
  expandServerConfig: vi.fn().mockImplementation((config) => config),
}))

vi.mock('./paths.js', () => ({
  resolveExecutablePath: vi.fn().mockImplementation((cmd) => {
    // Simulate path resolution by returning a resolved path for known commands
    const resolvedPaths: Record<string, string> = {
      node: '/usr/local/bin/node',
      npm: '/usr/local/bin/npm',
      npx: '/usr/local/bin/npx',
      python: '/usr/bin/python3',
      python3: '/usr/bin/python3',
    }
    return resolvedPaths[cmd] || cmd
  }),
  getAugmentedPath: vi.fn().mockReturnValue('/usr/local/bin:/usr/bin:/bin'),
}))

describe('McpClientManager', () => {
  let manager: McpClientManager

  beforeEach(() => {
    manager = new McpClientManager()
  })

  afterEach(async () => {
    await manager.disconnectAll()
    vi.clearAllMocks()
  })

  describe('connect', () => {
    it('connects to a stdio server', async () => {
      const config: McpServerConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-test'],
      }

      const info = await manager.connect('test-server', config)

      expect(info.name).toBe('test-server')
      expect(info.status).toBe('connected')
      expect(info.tools).toHaveLength(1)
      expect(info.tools[0].name).toBe('test_tool')
    })

    it('connects to an http server', async () => {
      const config: McpServerConfig = {
        type: 'http',
        url: 'https://example.com/mcp',
      }

      const info = await manager.connect('http-server', config)

      expect(info.name).toBe('http-server')
      expect(info.status).toBe('connected')
    })

    it('connects to a legacy sse server', async () => {
      const config: McpServerConfig = {
        type: 'sse',
        url: 'https://example.com/sse',
      }

      const info = await manager.connect('sse-server', config)

      expect(info.name).toBe('sse-server')
      expect(info.status).toBe('connected')
    })

    it('handles connection errors gracefully', async () => {
      const { Client } = await import(
        '@modelcontextprotocol/sdk/client/index.js'
      )
      vi.mocked(
        Client as unknown as (...args: unknown[]) => unknown,
      ).mockImplementationOnce(() => ({
        connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
        close: vi.fn(),
        setNotificationHandler: vi.fn(),
      }))

      const config: McpServerConfig = {
        type: 'stdio',
        command: 'invalid-command',
      }

      const info = await manager.connect('failing-server', config)

      expect(info.status).toBe('error')
      expect(info.error).toContain('Connection failed')
    })

    it('disconnects existing connection when reconnecting', async () => {
      const config: McpServerConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['test'],
      }

      await manager.connect('test-server', config)
      const firstInfo = manager.getServer('test-server')
      expect(firstInfo?.status).toBe('connected')

      await manager.connect('test-server', config)
      const secondInfo = manager.getServer('test-server')
      expect(secondInfo?.status).toBe('connected')
    })
  })

  describe('disconnect', () => {
    it('disconnects a connected server', async () => {
      const config: McpServerConfig = {
        type: 'stdio',
        command: 'npx',
      }

      await manager.connect('test-server', config)
      expect(manager.getStatus('test-server')).toBe('connected')

      await manager.disconnect('test-server')
      expect(manager.getStatus('test-server')).toBe('disconnected')
    })

    it('handles disconnecting non-existent server gracefully', async () => {
      await expect(manager.disconnect('non-existent')).resolves.not.toThrow()
    })
  })

  describe('disconnectAll', () => {
    it('disconnects all connected servers', async () => {
      const config1: McpServerConfig = { type: 'stdio', command: 'cmd1' }
      const config2: McpServerConfig = { type: 'stdio', command: 'cmd2' }

      await manager.connect('server1', config1)
      await manager.connect('server2', config2)

      expect(manager.getStatus('server1')).toBe('connected')
      expect(manager.getStatus('server2')).toBe('connected')

      await manager.disconnectAll()

      expect(manager.getStatus('server1')).toBe('disconnected')
      expect(manager.getStatus('server2')).toBe('disconnected')
    })
  })

  describe('getServers', () => {
    it('returns all server info', async () => {
      const config1: McpServerConfig = { type: 'stdio', command: 'cmd1' }
      const config2: McpServerConfig = { type: 'stdio', command: 'cmd2' }

      await manager.connect('server1', config1)
      await manager.connect('server2', config2)

      const servers = manager.getServers()

      expect(servers).toHaveLength(2)
      expect(servers.map((s) => s.name).sort()).toEqual(['server1', 'server2'])
    })
  })

  describe('getAllTools', () => {
    it('returns tools from all connected servers', async () => {
      const config1: McpServerConfig = { type: 'stdio', command: 'cmd1' }
      const config2: McpServerConfig = { type: 'stdio', command: 'cmd2' }

      await manager.connect('server1', config1)
      await manager.connect('server2', config2)

      const tools = manager.getAllTools()

      expect(tools).toHaveLength(2)
      expect(tools[0].serverName).toBe('server1')
      expect(tools[1].serverName).toBe('server2')
    })

    it('excludes tools from disconnected servers', async () => {
      const config1: McpServerConfig = { type: 'stdio', command: 'cmd1' }
      const config2: McpServerConfig = { type: 'stdio', command: 'cmd2' }

      await manager.connect('server1', config1)
      await manager.connect('server2', config2)
      await manager.disconnect('server1')

      const tools = manager.getAllTools()

      expect(tools).toHaveLength(1)
      expect(tools[0].serverName).toBe('server2')
    })
  })

  describe('callTool', () => {
    it('calls a tool on a connected server', async () => {
      const config: McpServerConfig = { type: 'stdio', command: 'cmd' }
      await manager.connect('test-server', config)

      const result = await manager.callTool('test-server', 'test_tool', {
        arg: 'value',
      })

      expect(result).toBeDefined()
    })

    it('throws when calling tool on non-existent server', async () => {
      await expect(
        manager.callTool('non-existent', 'tool', {}),
      ).rejects.toThrow('not connected')
    })
  })

  describe('event listeners', () => {
    it('emits server_connected event on successful connection', async () => {
      const events: McpClientEvent[] = []
      manager.addEventListener((event) => events.push(event))

      const config: McpServerConfig = { type: 'stdio', command: 'cmd' }
      await manager.connect('test-server', config)

      expect(events).toContainEqual({
        type: 'server_connected',
        serverName: 'test-server',
      })
    })

    it('emits server_disconnected event on disconnect', async () => {
      const events: McpClientEvent[] = []
      manager.addEventListener((event) => events.push(event))

      const config: McpServerConfig = { type: 'stdio', command: 'cmd' }
      await manager.connect('test-server', config)
      await manager.disconnect('test-server')

      expect(events).toContainEqual({
        type: 'server_disconnected',
        serverName: 'test-server',
      })
    })

    it('emits server_error event on connection failure', async () => {
      const { Client } = await import(
        '@modelcontextprotocol/sdk/client/index.js'
      )
      vi.mocked(
        Client as unknown as (...args: unknown[]) => unknown,
      ).mockImplementationOnce(() => ({
        connect: vi.fn().mockRejectedValue(new Error('Test error')),
        close: vi.fn(),
        setNotificationHandler: vi.fn(),
      }))

      const events: McpClientEvent[] = []
      manager.addEventListener((event) => events.push(event))

      const config: McpServerConfig = { type: 'stdio', command: 'cmd' }
      await manager.connect('test-server', config)

      expect(events).toContainEqual({
        type: 'server_error',
        serverName: 'test-server',
        error: 'Test error',
      })
    })

    it('allows removing event listeners', async () => {
      const events: McpClientEvent[] = []
      const removeListener = manager.addEventListener((event) =>
        events.push(event),
      )

      const config: McpServerConfig = { type: 'stdio', command: 'cmd' }
      await manager.connect('server1', config)

      removeListener()

      await manager.connect('server2', config)

      // Should only have event for server1
      const serverConnectedEvents = events.filter(
        (e) => e.type === 'server_connected',
      )
      expect(serverConnectedEvents).toHaveLength(1)
      expect(serverConnectedEvents[0].serverName).toBe('server1')
    })
  })

  describe('refreshTools', () => {
    it('refreshes tools for a connected server', async () => {
      const config: McpServerConfig = { type: 'stdio', command: 'cmd' }
      await manager.connect('test-server', config)

      const tools = await manager.refreshTools('test-server')

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('test_tool')
    })

    it('returns empty array for non-existent server', async () => {
      const tools = await manager.refreshTools('non-existent')
      expect(tools).toEqual([])
    })
  })
})

describe('McpClientManager transport selection', () => {
  it('creates StdioClientTransport for stdio config', async () => {
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    )

    const manager = new McpClientManager()
    const config: McpServerConfig = {
      type: 'stdio',
      command: 'test-cmd',
      args: ['--arg1'],
      env: { TEST_VAR: 'value' },
    }

    await manager.connect('test', config)

    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        // Command should be passed through (not in RESOLVABLE_COMMANDS list)
        command: 'test-cmd',
        args: ['--arg1'],
      }),
    )

    await manager.disconnectAll()
  })

  it('resolves executable path for known commands', async () => {
    const { resolveExecutablePath } = await import('./paths.js')
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    )

    const manager = new McpClientManager()
    const config: McpServerConfig = {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    }

    await manager.connect('node-server', config)

    // Should have called resolveExecutablePath with 'node'
    expect(resolveExecutablePath).toHaveBeenCalledWith('node')

    // StdioClientTransport should receive the resolved path
    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/usr/local/bin/node',
        args: ['server.js'],
      }),
    )

    await manager.disconnectAll()
  })

  it('resolves npx command for MCP servers', async () => {
    const { resolveExecutablePath } = await import('./paths.js')
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    )

    const manager = new McpClientManager()
    const config: McpServerConfig = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-test'],
    }

    await manager.connect('npx-server', config)

    expect(resolveExecutablePath).toHaveBeenCalledWith('npx')
    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/usr/local/bin/npx',
      }),
    )

    await manager.disconnectAll()
  })

  it('creates StreamableHTTPClientTransport for http config', async () => {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )

    const manager = new McpClientManager()
    const config: McpServerConfig = {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    }

    await manager.connect('test', config)

    expect(StreamableHTTPClientTransport).toHaveBeenCalled()

    await manager.disconnectAll()
  })

  it('creates SSEClientTransport for sse config', async () => {
    const { SSEClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/sse.js'
    )

    const manager = new McpClientManager()
    const config: McpServerConfig = {
      type: 'sse',
      url: 'https://example.com/sse',
    }

    await manager.connect('test', config)

    expect(SSEClientTransport).toHaveBeenCalled()

    await manager.disconnectAll()
  })
})
