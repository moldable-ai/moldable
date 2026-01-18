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

/**
 * Options for downloading a file
 */
export interface DownloadFileOptions {
  /** Suggested filename for the save dialog */
  filename: string
  /** File content - either a string or base64-encoded data */
  data: string
  /** MIME type of the file (e.g., 'text/csv', 'application/json') */
  mimeType: string
  /** If true, data is base64-encoded binary; if false, data is plain text */
  isBase64?: boolean
}

/**
 * Trigger a file download via Moldable's native save dialog.
 * Works inside Moldable's iframe environment where browser downloads don't work.
 *
 * @example
 * ```tsx
 * // Export CSV
 * downloadFile({
 *   filename: 'data.csv',
 *   data: 'name,value\nfoo,1\nbar,2',
 *   mimeType: 'text/csv',
 * })
 *
 * // Export JSON
 * downloadFile({
 *   filename: 'data.json',
 *   data: JSON.stringify({ items: [...] }, null, 2),
 *   mimeType: 'application/json',
 * })
 * ```
 *
 * @returns Promise that resolves when the save dialog completes (or rejects on error)
 */
export function downloadFile(options: DownloadFileOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isInMoldable()) {
      // Fallback for browser: use traditional blob download
      try {
        const blob = options.isBase64
          ? new Blob(
              [Uint8Array.from(atob(options.data), (c) => c.charCodeAt(0))],
              {
                type: options.mimeType,
              },
            )
          : new Blob([options.data], { type: options.mimeType })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = options.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        resolve()
      } catch (err) {
        reject(err)
      }
      return
    }

    // Generate a unique ID for this download request
    const requestId = `download-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Listen for the response
    const handleResponse = (event: MessageEvent) => {
      if (event.data?.type !== 'moldable:save-file-result') return
      if (event.data?.requestId !== requestId) return

      window.removeEventListener('message', handleResponse)

      if (event.data.success) {
        resolve()
      } else if (event.data.cancelled) {
        // User cancelled - not an error, just resolve
        resolve()
      } else {
        reject(new Error(event.data.error || 'Download failed'))
      }
    }

    window.addEventListener('message', handleResponse)

    // Send the download request to Moldable
    sendToMoldable({
      type: 'moldable:save-file',
      requestId,
      filename: options.filename,
      data: options.data,
      mimeType: options.mimeType,
      isBase64: options.isBase64 ?? false,
    })

    // Timeout after 5 minutes (user might take time in save dialog)
    setTimeout(
      () => {
        window.removeEventListener('message', handleResponse)
        reject(new Error('Download timed out'))
      },
      5 * 60 * 1000,
    )
  })
}
