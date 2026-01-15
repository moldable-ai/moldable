'use client'

import { useEffect, useRef } from 'react'

/**
 * Action types for app commands
 */
export type CommandAction =
  | { type: 'navigate'; path: string }
  | { type: 'message'; payload: unknown }
  | { type: 'focus'; target: string }

/**
 * Command definition that apps expose via /_moldable/commands
 */
export interface AppCommand {
  /** Unique identifier for the command */
  id: string
  /** Display label shown in command palette */
  label: string
  /** Optional keyboard shortcut (single key, shown as hint) */
  shortcut?: string
  /** Optional icon (emoji or lucide icon name) */
  icon?: string
  /** Optional group/category for organizing commands */
  group?: string
  /** What happens when the command is executed */
  action: CommandAction
}

/**
 * Response from /_moldable/commands endpoint
 */
export interface CommandsResponse {
  commands: AppCommand[]
}

/**
 * Message sent to iframe when executing a command
 */
export interface CommandMessage {
  type: 'moldable:command'
  command: string
  payload?: unknown
}

/**
 * Hook for apps to handle commands from the desktop
 *
 * @example
 * ```tsx
 * useMoldableCommands({
 *   'add-todo': () => setShowAddForm(true),
 *   'clear-completed': () => clearCompletedTodos(),
 * })
 * ```
 */
export function useMoldableCommands(
  handlers: Record<string, (payload?: unknown) => void>,
) {
  // Use ref to avoid recreating the listener on every render
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only handle moldable:command messages
      if (event.data?.type !== 'moldable:command') return

      const { command, payload } = event.data as CommandMessage
      const handler = handlersRef.current[command]

      if (handler) {
        handler(payload)
      } else {
        console.warn(`[Moldable] No handler for command: ${command}`)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])
}

/**
 * Hook to register a single command handler
 * Useful when you want to register handlers in different components
 */
export function useMoldableCommand(
  commandId: string,
  handler: (payload?: unknown) => void,
) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'moldable:command') return
      if (event.data.command !== commandId) return

      handlerRef.current(event.data.payload)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [commandId])
}

/**
 * Utility to check if running inside Moldable desktop (iframe)
 */
export function isInMoldable(): boolean {
  if (typeof window === 'undefined') return false
  return window.parent !== window
}

/**
 * Send a message to the Moldable desktop (parent window)
 * Useful for apps that need to communicate back to the desktop
 */
export function sendToMoldable(message: {
  type: string
  [key: string]: unknown
}) {
  if (!isInMoldable()) {
    console.warn('[Moldable] Not running inside Moldable desktop')
    return
  }
  window.parent.postMessage(message, '*')
}
