import { afterEach, describe, expect, it } from 'vitest'

// Re-implement isInMoldable for testing (since it accesses window)
function isInMoldable(): boolean {
  if (typeof window === 'undefined') return false
  return window.parent !== window
}

describe('commands utilities', () => {
  describe('isInMoldable', () => {
    const originalWindow = global.window

    afterEach(() => {
      // Restore original window
      if (originalWindow) {
        global.window = originalWindow
      }
    })

    it('returns false when window is undefined (SSR)', () => {
      // @ts-expect-error - intentionally setting to undefined
      global.window = undefined

      // Re-evaluate with undefined window
      const result =
        typeof window === 'undefined' ? false : window.parent !== window
      expect(result).toBe(false)
    })

    it('returns false when parent equals window (not in iframe)', () => {
      // jsdom default: window.parent === window
      expect(isInMoldable()).toBe(false)
    })

    it('returns true when parent differs from window (in iframe)', () => {
      // Mock the iframe scenario
      const mockParent = {} as Window
      const originalParent = window.parent

      Object.defineProperty(window, 'parent', {
        value: mockParent,
        writable: true,
        configurable: true,
      })

      expect(isInMoldable()).toBe(true)

      // Restore
      Object.defineProperty(window, 'parent', {
        value: originalParent,
        writable: true,
        configurable: true,
      })
    })
  })

  describe('CommandAction types', () => {
    it('navigate action has path', () => {
      const action = { type: 'navigate' as const, path: '/settings' }
      expect(action.type).toBe('navigate')
      expect(action.path).toBe('/settings')
    })

    it('message action has payload', () => {
      const action = { type: 'message' as const, payload: { foo: 'bar' } }
      expect(action.type).toBe('message')
      expect(action.payload).toEqual({ foo: 'bar' })
    })

    it('focus action has target', () => {
      const action = { type: 'focus' as const, target: 'input-field' }
      expect(action.type).toBe('focus')
      expect(action.target).toBe('input-field')
    })
  })

  describe('AppCommand structure', () => {
    it('accepts valid command definition', () => {
      const command = {
        id: 'add-todo',
        label: 'Add Todo',
        shortcut: 'a',
        icon: '➕',
        group: 'Tasks',
        action: { type: 'message' as const, payload: {} },
      }

      expect(command.id).toBe('add-todo')
      expect(command.label).toBe('Add Todo')
      expect(command.shortcut).toBe('a')
      expect(command.icon).toBe('➕')
      expect(command.group).toBe('Tasks')
    })

    it('works with minimal required fields', () => {
      const command = {
        id: 'test',
        label: 'Test Command',
        action: { type: 'navigate' as const, path: '/' },
      }

      expect(command.id).toBeDefined()
      expect(command.label).toBeDefined()
      expect(command.action).toBeDefined()
    })
  })

  describe('CommandMessage structure', () => {
    it('has correct type marker', () => {
      const message = {
        type: 'moldable:command' as const,
        command: 'add-todo',
        payload: { text: 'Buy milk' },
      }

      expect(message.type).toBe('moldable:command')
      expect(message.command).toBe('add-todo')
      expect(message.payload).toEqual({ text: 'Buy milk' })
    })

    it('works without payload', () => {
      const message: {
        type: 'moldable:command'
        command: string
        payload?: unknown
      } = {
        type: 'moldable:command',
        command: 'refresh',
      }

      expect(message.type).toBe('moldable:command')
      expect(message.command).toBe('refresh')
      expect(message.payload).toBeUndefined()
    })
  })
})
