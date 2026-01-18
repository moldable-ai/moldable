'use client'

import { type ReactNode, createContext, useContext } from 'react'

/**
 * Callback type for responding to tool approval requests
 */
export type ApprovalResponseHandler = (params: {
  approvalId: string
  approved: boolean
  reason?: string
}) => void

/**
 * Context for tool approval handling
 */
const ToolApprovalContext = createContext<ApprovalResponseHandler | null>(null)

/**
 * Provider for tool approval handling
 */
export function ToolApprovalProvider({
  onApprovalResponse,
  children,
}: {
  onApprovalResponse: ApprovalResponseHandler | null
  children: ReactNode
}) {
  return (
    <ToolApprovalContext.Provider value={onApprovalResponse}>
      {children}
    </ToolApprovalContext.Provider>
  )
}

/**
 * Hook to get the approval response handler
 */
export function useToolApprovalResponse(): ApprovalResponseHandler | null {
  return useContext(ToolApprovalContext)
}
