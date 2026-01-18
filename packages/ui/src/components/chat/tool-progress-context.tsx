'use client'

import { type ReactNode, createContext, useContext } from 'react'

/**
 * Progress data for a running tool (command execution with streaming stdout/stderr)
 */
export interface ToolProgressData {
  toolCallId: string
  command: string
  stdout: string
  stderr: string
  status: 'running' | 'complete'
}

/**
 * Context for tool progress data
 */
const ToolProgressContext = createContext<Record<string, ToolProgressData>>({})

/**
 * Provider for tool progress data
 */
export function ToolProgressProvider({
  value,
  children,
}: {
  value: Record<string, ToolProgressData>
  children: ReactNode
}) {
  return (
    <ToolProgressContext.Provider value={value}>
      {children}
    </ToolProgressContext.Provider>
  )
}

/**
 * Hook to get tool progress data
 */
export function useToolProgress(): Record<string, ToolProgressData> {
  return useContext(ToolProgressContext)
}

/**
 * Hook to get progress for a specific tool call
 */
export function useToolCallProgress(
  toolCallId: string | undefined,
): ToolProgressData | undefined {
  const progress = useContext(ToolProgressContext)
  return toolCallId ? progress[toolCallId] : undefined
}
