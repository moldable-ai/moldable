import { getAugmentedPath, resolveExecutablePath } from './paths.js'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { describe, expect, it } from 'vitest'

describe('paths', () => {
  describe('resolveExecutablePath', () => {
    it('should return absolute paths unchanged', () => {
      if (process.platform === 'win32') {
        expect(
          resolveExecutablePath('C:\\\\Windows\\\\System32\\\\cmd.exe'),
        ).toBe('C:\\\\Windows\\\\System32\\\\cmd.exe')
      } else {
        expect(resolveExecutablePath('/usr/bin/node')).toBe('/usr/bin/node')
        expect(resolveExecutablePath('/opt/homebrew/bin/npm')).toBe(
          '/opt/homebrew/bin/npm',
        )
      }
    })

    it('should expand tilde to home directory', () => {
      const result = resolveExecutablePath('~/bin/custom')
      expect(result).toBe(join(homedir(), 'bin/custom'))
    })

    it('should return non-resolvable commands unchanged', () => {
      // Commands not in the RESOLVABLE_COMMANDS list should pass through
      expect(resolveExecutablePath('custom-binary')).toBe('custom-binary')
      expect(resolveExecutablePath('my-script')).toBe('my-script')
    })

    it('should attempt to resolve known commands', () => {
      // These should either find the executable or return the original
      const nodeResult = resolveExecutablePath('node')
      const npmResult = resolveExecutablePath('npm')
      const npxResult = resolveExecutablePath('npx')

      // Results should either be absolute paths or the original command
      const isAbsolute = (value: string) =>
        value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
      expect(isAbsolute(nodeResult) || nodeResult === 'node').toBeTruthy()
      expect(isAbsolute(npmResult) || npmResult === 'npm').toBeTruthy()
      expect(isAbsolute(npxResult) || npxResult === 'npx').toBeTruthy()
    })

    it('should handle all resolvable command names', () => {
      const commands = [
        'node',
        'npm',
        'npx',
        'pnpm',
        'yarn',
        'bun',
        'python',
        'python3',
        'uv',
      ]

      for (const cmd of commands) {
        const result = resolveExecutablePath(cmd)
        // Should either resolve to absolute path or return original
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getAugmentedPath', () => {
    it('should return a non-empty path string', () => {
      const path = getAugmentedPath()
      expect(typeof path).toBe('string')
      expect(path.length).toBeGreaterThan(0)
    })

    it('should include common executable locations', () => {
      const path = getAugmentedPath()
      const paths = path.split(delimiter)

      // Should include at least some common paths
      const commonPaths =
        process.platform === 'win32'
          ? ['C:\\\\Windows\\\\System32', 'C:\\\\Windows']
          : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

      const hasCommonPaths = commonPaths.some((p) => paths.includes(p))
      expect(hasCommonPaths).toBe(true)
    })

    it('should include existing PATH', () => {
      const originalPath = process.env.PATH || ''
      const augmentedPath = getAugmentedPath()

      // The augmented path should contain the original PATH
      expect(augmentedPath).toContain(originalPath)
    })

    it('should have paths separated by colons', () => {
      const path = getAugmentedPath()
      // Should have multiple paths separated by colons
      expect(path.split(delimiter).length).toBeGreaterThan(1)
    })

    it('should check NVM directory if it exists', () => {
      const nvmDir = join(homedir(), '.nvm', 'versions', 'node')
      const path = getAugmentedPath()

      if (existsSync(nvmDir)) {
        // If NVM exists, the path should include an NVM bin directory
        if (process.platform !== 'win32') {
          expect(path).toContain('.nvm/versions/node')
        }
      }
      // If NVM doesn't exist, test still passes
    })
  })

  describe('path resolution integration', () => {
    it('should find node if installed via common methods', () => {
      const nodePath = resolveExecutablePath('node')

      // Node should be found on most dev machines
      // Either it's resolved to an absolute path or returns 'node'
      if (nodePath !== 'node') {
        expect(
          nodePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(nodePath),
        ).toBe(true)
        expect(existsSync(nodePath)).toBe(true)
      }
    })

    it('should provide consistent results for repeated calls', () => {
      const result1 = resolveExecutablePath('npm')
      const result2 = resolveExecutablePath('npm')

      expect(result1).toBe(result2)
    })

    it('should handle path-like commands correctly', () => {
      // Commands with path separators should be treated as paths
      const result = resolveExecutablePath('./local-script')
      expect(result).toBe('./local-script')
    })
  })
})
