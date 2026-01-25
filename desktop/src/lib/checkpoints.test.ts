import {
  formatBytes,
  formatRelativeTime,
  generateMessageId,
} from './checkpoints'
import { describe, expect, it } from 'vitest'

describe('checkpoints utilities', () => {
  // ==========================================================================
  // generateMessageId
  // ==========================================================================

  describe('generateMessageId', () => {
    it('generates a string starting with msg-', () => {
      const id = generateMessageId()
      expect(id.startsWith('msg-')).toBe(true)
    })

    it('generates unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateMessageId())
      }
      expect(ids.size).toBe(100)
    })

    it('includes timestamp component', () => {
      const before = Date.now()
      const id = generateMessageId()
      const after = Date.now()

      // Extract timestamp from ID (format: msg-{timestamp}-{random})
      const parts = id.split('-')
      expect(parts.length).toBe(3)

      const timestamp = parseInt(parts[1], 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('has reasonable length', () => {
      const id = generateMessageId()
      // msg- (4) + timestamp (~13) + - (1) + random (6) = ~24
      expect(id.length).toBeGreaterThan(15)
      expect(id.length).toBeLessThan(30)
    })
  })

  // ==========================================================================
  // formatBytes
  // ==========================================================================

  describe('formatBytes', () => {
    it('formats zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B')
    })

    it('formats bytes (< 1KB)', () => {
      expect(formatBytes(1)).toBe('1 B')
      expect(formatBytes(512)).toBe('512 B')
      expect(formatBytes(1023)).toBe('1023 B')
    })

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
      expect(formatBytes(10240)).toBe('10.0 KB')
    })

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
      expect(formatBytes(100 * 1024 * 1024)).toBe('100.0 MB')
    })

    it('formats gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
    })
  })

  // ==========================================================================
  // formatRelativeTime
  // ==========================================================================

  describe('formatRelativeTime', () => {
    it('formats just now', () => {
      const now = new Date().toISOString()
      expect(formatRelativeTime(now)).toBe('just now')
    })

    it('formats seconds as just now', () => {
      const date = new Date(Date.now() - 30 * 1000).toISOString()
      expect(formatRelativeTime(date)).toBe('just now')
    })

    it('formats minutes', () => {
      const date1 = new Date(Date.now() - 1 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date1)).toBe('1 minute ago')

      const date2 = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date2)).toBe('5 minutes ago')

      const date59 = new Date(Date.now() - 59 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date59)).toBe('59 minutes ago')
    })

    it('formats hours', () => {
      const date1 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date1)).toBe('1 hour ago')

      const date5 = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date5)).toBe('5 hours ago')

      const date23 = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date23)).toBe('23 hours ago')
    })

    it('formats days', () => {
      const date1 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date1)).toBe('1 day ago')

      const date3 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date3)).toBe('3 days ago')

      const date6 = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(date6)).toBe('6 days ago')
    })

    it('formats as date for older than a week', () => {
      const date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      const result = formatRelativeTime(date.toISOString())

      // Should be a formatted date string, not relative time
      expect(result).not.toContain('ago')
      expect(result).not.toBe('just now')
    })
  })
})
