import {
  type McpbManifest,
  type UserConfigField,
  checkCompatibility,
  expandMcpbVariables,
  generateServerConfig,
  getBundleInstallPath,
  getDefaultUserConfigValues,
  getMcpbInstallDir,
  parseManifest,
  validateUserConfig,
} from './bundle.js'
import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('bundle', () => {
  describe('getMcpbInstallDir', () => {
    it('returns correct installation directory', () => {
      const dir = getMcpbInstallDir()
      expect(dir).toBe(join(homedir(), '.moldable', 'shared', 'mcps'))
    })
  })

  describe('getBundleInstallPath', () => {
    it('returns correct path for a bundle', () => {
      const path = getBundleInstallPath('test-bundle')
      expect(path).toBe(
        join(homedir(), '.moldable', 'shared', 'mcps', 'test-bundle'),
      )
    })
  })

  describe('parseManifest', () => {
    it('parses a valid minimal manifest', () => {
      const json = {
        manifest_version: '1.0',
        name: 'test-server',
        version: '1.0.0',
        description: 'A test MCP server',
        author: { name: 'Test Author' },
        server: {
          type: 'node',
          entry_point: 'index.js',
        },
      }

      const manifest = parseManifest(json)

      expect(manifest.name).toBe('test-server')
      expect(manifest.version).toBe('1.0.0')
      expect(manifest.server.type).toBe('node')
    })

    it('parses a manifest with user_config', () => {
      const json = {
        manifest_version: '1.0',
        name: 'test-server',
        version: '1.0.0',
        description: 'A test MCP server',
        author: { name: 'Test Author' },
        server: {
          type: 'node',
          entry_point: 'index.js',
        },
        user_config: {
          api_key: {
            type: 'string',
            title: 'API Key',
            required: true,
            sensitive: true,
          },
          port: {
            type: 'number',
            title: 'Port',
            default: 3000,
            min: 1,
            max: 65535,
          },
        },
      }

      const manifest = parseManifest(json)

      expect(manifest.user_config).toBeDefined()
      expect(manifest.user_config?.api_key?.type).toBe('string')
      expect(manifest.user_config?.port?.default).toBe(3000)
    })

    it('parses a manifest with mcp_config', () => {
      const json = {
        manifest_version: '1.0',
        name: 'test-server',
        version: '1.0.0',
        description: 'A test MCP server',
        author: { name: 'Test Author' },
        server: {
          type: 'node',
          entry_point: 'index.js',
          mcp_config: {
            command: 'node',
            args: ['${__dirname}/index.js'],
            env: {
              NODE_ENV: 'production',
            },
          },
        },
      }

      const manifest = parseManifest(json)

      expect(manifest.server.mcp_config?.command).toBe('node')
      expect(manifest.server.mcp_config?.args).toEqual([
        '${__dirname}/index.js',
      ])
    })

    it('throws on invalid manifest', () => {
      expect(() => parseManifest({})).toThrow()
      expect(() => parseManifest({ name: 'test' })).toThrow()
    })

    it('parses all server types', () => {
      const serverTypes = ['node', 'python', 'binary', 'uv']

      for (const type of serverTypes) {
        const json = {
          manifest_version: '1.0',
          name: `${type}-server`,
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' },
          server: {
            type,
            entry_point: type === 'node' ? 'index.js' : 'main.py',
          },
        }

        const manifest = parseManifest(json)
        expect(manifest.server.type).toBe(type)
      }
    })
  })

  describe('checkCompatibility', () => {
    const baseManifest: McpbManifest = {
      manifest_version: '1.0',
      name: 'test',
      version: '1.0.0',
      description: 'Test',
      author: { name: 'Test' },
      server: { type: 'node', entry_point: 'index.js' },
    }

    it('returns compatible for manifest without platform restrictions', () => {
      const result = checkCompatibility(baseManifest)

      expect(result.isCompatible).toBe(true)
      expect(result.issues).toHaveLength(0)
    })

    it('returns compatible when current platform is in list', () => {
      const manifest: McpbManifest = {
        ...baseManifest,
        compatibility: {
          platforms: [process.platform as 'darwin' | 'win32' | 'linux'],
        },
      }

      const result = checkCompatibility(manifest)

      expect(result.isCompatible).toBe(true)
    })

    it('returns incompatible when current platform is not in list', () => {
      const manifest: McpbManifest = {
        ...baseManifest,
        compatibility: {
          platforms: ['win32'] as const,
        },
      }

      // Only test this if we're not on Windows
      if (process.platform !== 'win32') {
        const result = checkCompatibility(manifest)

        expect(result.isCompatible).toBe(false)
        expect(result.issues[0]).toContain('only supports')
      }
    })
  })

  describe('expandMcpbVariables', () => {
    it('expands __dirname variable', () => {
      const result = expandMcpbVariables(
        '${__dirname}/index.js',
        '/path/to/bundle',
      )
      expect(result).toBe('/path/to/bundle/index.js')
    })

    it('expands HOME variable', () => {
      const result = expandMcpbVariables('${HOME}/config', '/bundle')
      expect(result).toBe(`${homedir()}/config`)
    })

    it('expands DESKTOP variable', () => {
      const result = expandMcpbVariables('${DESKTOP}/file.txt', '/bundle')
      expect(result).toBe(join(homedir(), 'Desktop', 'file.txt'))
    })

    it('expands DOCUMENTS variable', () => {
      const result = expandMcpbVariables('${DOCUMENTS}/doc.txt', '/bundle')
      expect(result).toBe(join(homedir(), 'Documents', 'doc.txt'))
    })

    it('expands DOWNLOADS variable', () => {
      const result = expandMcpbVariables('${DOWNLOADS}/file.zip', '/bundle')
      expect(result).toBe(join(homedir(), 'Downloads', 'file.zip'))
    })

    it('expands pathSeparator variable', () => {
      const expected = process.platform === 'win32' ? '\\' : '/'
      expect(expandMcpbVariables('a${pathSeparator}b', '/bundle')).toBe(
        `a${expected}b`,
      )
      expect(expandMcpbVariables('a${/}b', '/bundle')).toBe(`a${expected}b`)
    })

    it('expands user_config variables', () => {
      const result = expandMcpbVariables(
        '--api-key=${user_config.apiKey}',
        '/bundle',
        { apiKey: 'secret123' },
      )
      expect(result).toBe('--api-key=secret123')
    })

    it('expands user_config array variables', () => {
      const result = expandMcpbVariables(
        'dirs: ${user_config.paths}',
        '/bundle',
        { paths: ['/a', '/b', '/c'] },
      )
      expect(result).toBe('dirs: /a /b /c')
    })

    it('handles missing user_config values', () => {
      const result = expandMcpbVariables(
        '--key=${user_config.missing}',
        '/bundle',
        {},
      )
      expect(result).toBe('--key=')
    })

    it('expands multiple variables', () => {
      const result = expandMcpbVariables(
        '${__dirname}/run --home=${HOME}',
        '/app',
        {},
      )
      expect(result).toBe(`/app/run --home=${homedir()}`)
    })
  })

  describe('generateServerConfig', () => {
    it('generates config for node server', () => {
      const manifest: McpbManifest = {
        manifest_version: '1.0',
        name: 'node-server',
        version: '1.0.0',
        description: 'Test',
        author: { name: 'Test' },
        server: {
          type: 'node',
          entry_point: 'index.js',
        },
      }

      const config = generateServerConfig(manifest, '/bundle/path')

      expect(config.type).toBe('stdio')
      expect(config.command).toBe('node')
      expect(config.args).toContain('/bundle/path/index.js')
      expect(config.cwd).toBe('/bundle/path')
    })

    it('generates config for python server', () => {
      const manifest: McpbManifest = {
        manifest_version: '1.0',
        name: 'python-server',
        version: '1.0.0',
        description: 'Test',
        author: { name: 'Test' },
        server: {
          type: 'python',
          entry_point: 'main.py',
        },
      }

      const config = generateServerConfig(manifest, '/bundle/path')

      expect(config.type).toBe('stdio')
      expect(config.command).toBe(
        process.platform === 'win32' ? 'python' : 'python3',
      )
      expect(config.args).toContain('/bundle/path/main.py')
    })

    it('generates config for uv server', () => {
      const manifest: McpbManifest = {
        manifest_version: '1.0',
        name: 'uv-server',
        version: '1.0.0',
        description: 'Test',
        author: { name: 'Test' },
        server: {
          type: 'uv',
          entry_point: 'main.py',
        },
      }

      const config = generateServerConfig(manifest, '/bundle/path')

      expect(config.type).toBe('stdio')
      expect(config.command).toBe('uv')
      expect(config.args).toEqual(['run', '/bundle/path/main.py'])
    })

    it('generates config for binary server', () => {
      const manifest: McpbManifest = {
        manifest_version: '1.0',
        name: 'binary-server',
        version: '1.0.0',
        description: 'Test',
        author: { name: 'Test' },
        server: {
          type: 'binary',
          entry_point: 'server',
        },
      }

      const config = generateServerConfig(manifest, '/bundle/path')

      expect(config.type).toBe('stdio')
      const expectedBinary =
        process.platform === 'win32'
          ? '/bundle/path/server.exe'
          : '/bundle/path/server'
      expect(config.command).toBe(expectedBinary)
    })

    it('uses mcp_config when provided', () => {
      const manifest: McpbManifest = {
        manifest_version: '1.0',
        name: 'custom-server',
        version: '1.0.0',
        description: 'Test',
        author: { name: 'Test' },
        server: {
          type: 'node',
          entry_point: 'index.js',
          mcp_config: {
            command: 'npx',
            args: ['--yes', 'custom-mcp-server'],
            env: {
              DEBUG: 'true',
            },
          },
        },
      }

      const config = generateServerConfig(manifest, '/bundle/path')

      expect(config.command).toBe('npx')
      expect(config.args).toEqual(['--yes', 'custom-mcp-server'])
      expect(config.env).toEqual({ DEBUG: 'true' })
    })

    it('expands variables in mcp_config', () => {
      const manifest: McpbManifest = {
        manifest_version: '1.0',
        name: 'var-server',
        version: '1.0.0',
        description: 'Test',
        author: { name: 'Test' },
        server: {
          type: 'node',
          entry_point: 'index.js',
          mcp_config: {
            command: 'node',
            args: ['${__dirname}/dist/index.js'],
            env: {
              HOME_DIR: '${HOME}',
            },
          },
        },
      }

      const config = generateServerConfig(manifest, '/my/bundle')

      expect(config.args).toContain('/my/bundle/dist/index.js')
      expect(config.env?.HOME_DIR).toBe(homedir())
    })
  })

  describe('getDefaultUserConfigValues', () => {
    it('extracts default values from user_config', () => {
      const userConfig: Record<string, UserConfigField> = {
        apiKey: {
          type: 'string',
          title: 'API Key',
          default: 'default-key',
        },
        port: {
          type: 'number',
          title: 'Port',
          default: 3000,
        },
        debug: {
          type: 'boolean',
          title: 'Debug',
          default: false,
        },
      }

      const defaults = getDefaultUserConfigValues(userConfig)

      expect(defaults.apiKey).toBe('default-key')
      expect(defaults.port).toBe(3000)
      expect(defaults.debug).toBe(false)
    })

    it('expands HOME in default values', () => {
      const userConfig: Record<string, UserConfigField> = {
        configPath: {
          type: 'directory',
          title: 'Config Path',
          default: '${HOME}/.config/myapp',
        },
      }

      const defaults = getDefaultUserConfigValues(userConfig)

      expect(defaults.configPath).toBe(`${homedir()}/.config/myapp`)
    })

    it('handles array defaults', () => {
      const userConfig: Record<string, UserConfigField> = {
        paths: {
          type: 'directory',
          title: 'Paths',
          multiple: true,
          default: ['${HOME}/a', '${HOME}/b'],
        },
      }

      const defaults = getDefaultUserConfigValues(userConfig)

      expect(defaults.paths).toEqual([`${homedir()}/a`, `${homedir()}/b`])
    })

    it('skips fields without defaults', () => {
      const userConfig: Record<string, UserConfigField> = {
        apiKey: {
          type: 'string',
          title: 'API Key',
          required: true,
        },
        port: {
          type: 'number',
          title: 'Port',
          default: 3000,
        },
      }

      const defaults = getDefaultUserConfigValues(userConfig)

      expect(defaults.apiKey).toBeUndefined()
      expect(defaults.port).toBe(3000)
    })
  })

  describe('validateUserConfig', () => {
    it('passes valid configuration', () => {
      const userConfig: Record<string, UserConfigField> = {
        apiKey: {
          type: 'string',
          title: 'API Key',
          required: true,
        },
        port: {
          type: 'number',
          title: 'Port',
          min: 1,
          max: 65535,
        },
      }

      const result = validateUserConfig(userConfig, {
        apiKey: 'my-key',
        port: 3000,
      })

      expect(result.valid).toBe(true)
      expect(Object.keys(result.errors)).toHaveLength(0)
    })

    it('fails when required field is missing', () => {
      const userConfig: Record<string, UserConfigField> = {
        apiKey: {
          type: 'string',
          title: 'API Key',
          required: true,
        },
      }

      const result = validateUserConfig(userConfig, {})

      expect(result.valid).toBe(false)
      expect(result.errors.apiKey).toContain('required')
    })

    it('fails when number is out of range', () => {
      const userConfig: Record<string, UserConfigField> = {
        port: {
          type: 'number',
          title: 'Port',
          min: 1,
          max: 65535,
        },
      }

      const resultTooLow = validateUserConfig(userConfig, { port: 0 })
      expect(resultTooLow.valid).toBe(false)
      expect(resultTooLow.errors.port).toContain('at least 1')

      const resultTooHigh = validateUserConfig(userConfig, { port: 70000 })
      expect(resultTooHigh.valid).toBe(false)
      expect(resultTooHigh.errors.port).toContain('at most 65535')
    })

    it('fails when type is wrong', () => {
      const userConfig: Record<string, UserConfigField> = {
        port: {
          type: 'number',
          title: 'Port',
        },
        debug: {
          type: 'boolean',
          title: 'Debug',
        },
      }

      const result = validateUserConfig(userConfig, {
        port: 'not a number' as unknown as number,
        debug: 'true' as unknown as boolean,
      })

      expect(result.valid).toBe(false)
      expect(result.errors.port).toContain('must be a number')
      expect(result.errors.debug).toContain('must be a boolean')
    })

    it('validates directory/file multiple fields', () => {
      const userConfig: Record<string, UserConfigField> = {
        paths: {
          type: 'directory',
          title: 'Paths',
          multiple: true,
        },
      }

      const validResult = validateUserConfig(userConfig, {
        paths: ['/a', '/b'],
      })
      expect(validResult.valid).toBe(true)

      const invalidResult = validateUserConfig(userConfig, {
        paths: '/single/path' as unknown as string[],
      })
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.errors.paths).toContain('array of paths')
    })

    it('skips validation for empty optional fields', () => {
      const userConfig: Record<string, UserConfigField> = {
        optional: {
          type: 'string',
          title: 'Optional',
          required: false,
        },
      }

      const result = validateUserConfig(userConfig, {})

      expect(result.valid).toBe(true)
    })
  })
})
