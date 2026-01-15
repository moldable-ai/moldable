import {
  addMcpServer,
  expandEnvVars,
  expandServerConfig,
  getMcpServer,
  listMcpServers,
  loadMcpConfig,
  removeMcpServer,
  saveMcpConfig,
} from './config.js'
import { McpConfigSchema, McpServerConfigSchema } from './types.js'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('expandEnvVars', () => {
  it('expands environment variables in strings', () => {
    process.env.TEST_VAR = 'hello'
    expect(expandEnvVars('${TEST_VAR} world')).toBe('hello world')
    delete process.env.TEST_VAR
  })

  it('returns empty string for undefined variables', () => {
    expect(expandEnvVars('${UNDEFINED_VAR}')).toBe('')
  })

  it('leaves strings without variables unchanged', () => {
    expect(expandEnvVars('no variables here')).toBe('no variables here')
  })

  it('expands multiple variables in one string', () => {
    process.env.VAR1 = 'foo'
    process.env.VAR2 = 'bar'
    expect(expandEnvVars('${VAR1} and ${VAR2}')).toBe('foo and bar')
    delete process.env.VAR1
    delete process.env.VAR2
  })
})

describe('expandServerConfig', () => {
  it('expands env vars in stdio config', () => {
    process.env.TEST_CMD = 'my-command'
    process.env.TEST_ARG = '--test'

    const config = expandServerConfig({
      type: 'stdio',
      command: '${TEST_CMD}',
      args: ['${TEST_ARG}', 'literal'],
    })

    expect(config.type).toBe('stdio')
    if (config.type === 'stdio') {
      expect(config.command).toBe('my-command')
      expect(config.args).toEqual(['--test', 'literal'])
    }

    delete process.env.TEST_CMD
    delete process.env.TEST_ARG
  })

  it('expands env vars in http config', () => {
    process.env.API_URL = 'https://api.example.com'
    process.env.API_TOKEN = 'secret-token'

    const config = expandServerConfig({
      type: 'http',
      url: '${API_URL}/mcp',
      headers: { Authorization: 'Bearer ${API_TOKEN}' },
    })

    expect(config.type).toBe('http')
    if (config.type === 'http') {
      expect(config.url).toBe('https://api.example.com/mcp')
      expect(config.headers?.Authorization).toBe('Bearer secret-token')
    }

    delete process.env.API_URL
    delete process.env.API_TOKEN
  })
})

describe('McpConfigSchema', () => {
  it('validates stdio server config with explicit type', () => {
    const config = {
      mcpServers: {
        test: {
          type: 'stdio' as const,
          command: 'npx',
          args: ['-y', 'some-package'],
        },
      },
    }
    expect(() => McpConfigSchema.parse(config)).not.toThrow()
  })

  it('validates http server config', () => {
    const config = {
      mcpServers: {
        test: {
          type: 'http' as const,
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
        },
      },
    }
    expect(() => McpConfigSchema.parse(config)).not.toThrow()
  })

  it('validates sse server config', () => {
    const config = {
      mcpServers: {
        test: {
          type: 'sse' as const,
          url: 'https://example.com/sse',
        },
      },
    }
    expect(() => McpConfigSchema.parse(config)).not.toThrow()
  })

  it('rejects invalid config', () => {
    const config = {
      mcpServers: {
        test: {
          type: 'invalid',
        },
      },
    }
    expect(() => McpConfigSchema.parse(config)).toThrow()
  })
})

describe('McpServerConfigSchema - Claude Desktop compatibility', () => {
  it('infers stdio type when command is present but type is missing', () => {
    // This is the Claude Desktop config format
    const config = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me'],
    }

    const parsed = McpServerConfigSchema.parse(config)

    expect(parsed.type).toBe('stdio')
    expect(parsed.command).toBe('npx')
  })

  it('accepts explicit stdio type', () => {
    const config = {
      type: 'stdio' as const,
      command: 'python',
      args: ['server.py'],
    }

    const parsed = McpServerConfigSchema.parse(config)

    expect(parsed.type).toBe('stdio')
    expect(parsed.command).toBe('python')
  })

  it('validates http config with explicit type', () => {
    const config = {
      type: 'http' as const,
      url: 'https://example.com/mcp',
    }

    const parsed = McpServerConfigSchema.parse(config)

    expect(parsed.type).toBe('http')
    expect(parsed.url).toBe('https://example.com/mcp')
  })

  it('validates full Claude Desktop config format', () => {
    // Example from Claude Desktop docs
    const config = {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            '/Users/username/Desktop',
            '/Users/username/Downloads',
          ],
        },
        'brave-search': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: {
            BRAVE_API_KEY: 'your-api-key',
          },
        },
      },
    }

    const parsed = McpConfigSchema.parse(config)

    expect(parsed.mcpServers.filesystem.type).toBe('stdio')
    expect(parsed.mcpServers['brave-search'].type).toBe('stdio')
  })
})

describe('Config file operations', () => {
  const testDir = join(tmpdir(), 'moldable-mcp-test-' + Date.now())
  const testConfigPath = join(testDir, 'mcp.json')

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it('loads empty config when file does not exist', () => {
    const config = loadMcpConfig(join(testDir, 'nonexistent.json'))
    expect(config).toEqual({ mcpServers: {} })
  })

  it('saves and loads config', () => {
    const config = {
      mcpServers: {
        test: {
          type: 'stdio' as const,
          command: 'npx',
          args: ['test'],
        },
      },
    }

    saveMcpConfig(config, testConfigPath)
    const loaded = loadMcpConfig(testConfigPath)

    expect(loaded.mcpServers.test.command).toBe('npx')
  })

  it('adds a server to config', () => {
    const serverConfig = {
      type: 'stdio' as const,
      command: 'python',
      args: ['server.py'],
    }

    addMcpServer('my-server', serverConfig, testConfigPath)
    const loaded = loadMcpConfig(testConfigPath)

    expect(loaded.mcpServers['my-server']).toBeDefined()
    expect(loaded.mcpServers['my-server'].command).toBe('python')
  })

  it('removes a server from config', () => {
    const config = {
      mcpServers: {
        server1: { type: 'stdio' as const, command: 'cmd1' },
        server2: { type: 'stdio' as const, command: 'cmd2' },
      },
    }

    saveMcpConfig(config, testConfigPath)
    removeMcpServer('server1', testConfigPath)
    const loaded = loadMcpConfig(testConfigPath)

    expect(loaded.mcpServers.server1).toBeUndefined()
    expect(loaded.mcpServers.server2).toBeDefined()
  })

  it('gets a specific server config', () => {
    const config = {
      mcpServers: {
        myserver: {
          type: 'http' as const,
          url: 'https://example.com/mcp',
        },
      },
    }

    saveMcpConfig(config, testConfigPath)
    const server = getMcpServer('myserver', testConfigPath)

    expect(server).toBeDefined()
    expect(server?.type).toBe('http')
  })

  it('returns undefined for non-existent server', () => {
    saveMcpConfig({ mcpServers: {} }, testConfigPath)
    const server = getMcpServer('nonexistent', testConfigPath)

    expect(server).toBeUndefined()
  })

  it('lists all servers', () => {
    const config = {
      mcpServers: {
        server1: { type: 'stdio' as const, command: 'cmd1' },
        server2: { type: 'stdio' as const, command: 'cmd2' },
      },
    }

    saveMcpConfig(config, testConfigPath)
    const servers = listMcpServers(testConfigPath)

    expect(Object.keys(servers)).toEqual(['server1', 'server2'])
  })

  it('handles malformed JSON gracefully', () => {
    writeFileSync(testConfigPath, 'not valid json')
    const config = loadMcpConfig(testConfigPath)

    expect(config).toEqual({ mcpServers: {} })
  })
})
