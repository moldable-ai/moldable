import { WORKSPACE_COLORS, generateWorkspaceId } from './workspaces'
import { describe, expect, it } from 'vitest'

describe('workspaces utilities', () => {
  describe('WORKSPACE_COLORS', () => {
    it('has 8 color options', () => {
      expect(WORKSPACE_COLORS).toHaveLength(8)
    })

    it('contains valid hex colors', () => {
      for (const color of WORKSPACE_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      }
    })

    it('has no duplicate colors', () => {
      const uniqueColors = new Set(WORKSPACE_COLORS)
      expect(uniqueColors.size).toBe(WORKSPACE_COLORS.length)
    })

    it('includes expected colors', () => {
      expect(WORKSPACE_COLORS).toContain('#10b981') // emerald
      expect(WORKSPACE_COLORS).toContain('#3b82f6') // blue
      expect(WORKSPACE_COLORS).toContain('#8b5cf6') // violet
    })
  })

  describe('generateWorkspaceId', () => {
    it('converts name to lowercase', () => {
      expect(generateWorkspaceId('MyWorkspace')).toBe('myworkspace')
      expect(generateWorkspaceId('UPPERCASE')).toBe('uppercase')
    })

    it('replaces spaces with dashes', () => {
      expect(generateWorkspaceId('My Workspace')).toBe('my-workspace')
      expect(generateWorkspaceId('one two three')).toBe('one-two-three')
    })

    it('replaces multiple spaces with single dash', () => {
      expect(generateWorkspaceId('one   two')).toBe('one-two')
    })

    it('removes special characters', () => {
      expect(generateWorkspaceId("Work's Project!")).toBe('work-s-project')
      expect(generateWorkspaceId('test@123#')).toBe('test-123')
    })

    it('removes leading and trailing dashes', () => {
      expect(generateWorkspaceId('-leading')).toBe('leading')
      expect(generateWorkspaceId('trailing-')).toBe('trailing')
      expect(generateWorkspaceId('-both-')).toBe('both')
    })

    it('handles consecutive special characters', () => {
      expect(generateWorkspaceId('a!!!b')).toBe('a-b')
      expect(generateWorkspaceId('test...name')).toBe('test-name')
    })

    it('handles empty-ish input', () => {
      expect(generateWorkspaceId('')).toBe('')
      expect(generateWorkspaceId('   ')).toBe('')
      expect(generateWorkspaceId('---')).toBe('')
    })

    it('preserves numbers', () => {
      expect(generateWorkspaceId('Project 2024')).toBe('project-2024')
      expect(generateWorkspaceId('v1.0.0')).toBe('v1-0-0')
    })

    it('handles realistic workspace names', () => {
      expect(generateWorkspaceId('Personal')).toBe('personal')
      expect(generateWorkspaceId('Work Projects')).toBe('work-projects')
      expect(generateWorkspaceId('Side Hustle 2024')).toBe('side-hustle-2024')
      expect(generateWorkspaceId('Client: Acme Corp.')).toBe('client-acme-corp')
    })

    it('handles unicode characters', () => {
      // Unicode is removed, replaced with dashes
      expect(generateWorkspaceId('Café')).toBe('caf')
      expect(generateWorkspaceId('日本語')).toBe('')
    })
  })
})
