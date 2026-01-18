'use client'

import { Check, ChevronDown, HelpCircle, ShieldAlert, X } from 'lucide-react'
import * as React from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

/**
 * State of the tool approval
 */
export type ToolApprovalState =
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-denied'

interface ToolApprovalContextValue {
  state: ToolApprovalState
  approved?: boolean
}

const ToolApprovalContext = React.createContext<ToolApprovalContextValue>({
  state: 'approval-requested',
})

function useToolApprovalContext() {
  return React.useContext(ToolApprovalContext)
}

/**
 * Root component for tool approval UI
 */
interface ToolApprovalProps {
  children: React.ReactNode
  /** Current state of the approval */
  state: ToolApprovalState
  /** Whether the user approved (for responded/output states) */
  approved?: boolean
  className?: string
}

export function ToolApproval({
  children,
  state,
  approved,
  className,
}: ToolApprovalProps) {
  return (
    <ToolApprovalContext.Provider value={{ state, approved }}>
      <div
        className={cn(
          'bg-card border-border my-2 overflow-hidden rounded-lg border',
          className,
        )}
      >
        {children}
      </div>
    </ToolApprovalContext.Provider>
  )
}

/**
 * Header section with icon and title
 */
interface ToolApprovalHeaderProps {
  children: React.ReactNode
  className?: string
}

export function ToolApprovalHeader({
  children,
  className,
}: ToolApprovalHeaderProps) {
  const { state, approved } = useToolApprovalContext()

  // Show different icons based on state
  const icon =
    state === 'approval-requested' ? (
      <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
    ) : approved ? (
      <Check className="text-success size-3.5 shrink-0" />
    ) : (
      <X className="text-destructive size-3.5 shrink-0" />
    )

  return (
    <div
      className={cn('bg-muted/50 flex items-start gap-2 px-3 py-2', className)}
    >
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * Content shown only when approval is being requested
 */
interface ToolApprovalRequestProps {
  children: React.ReactNode
  className?: string
}

export function ToolApprovalRequest({
  children,
  className,
}: ToolApprovalRequestProps) {
  const { state } = useToolApprovalContext()

  if (state !== 'approval-requested') {
    return null
  }

  return <div className={cn('text-xs', className)}>{children}</div>
}

/**
 * Expandable help section explaining why approval is needed
 */
interface ToolApprovalHelpProps {
  children: React.ReactNode
  className?: string
}

export function ToolApprovalHelp({
  children,
  className,
}: ToolApprovalHelpProps) {
  const { state } = useToolApprovalContext()
  const [isOpen, setIsOpen] = React.useState(false)

  // Only show when approval is being requested
  if (state !== 'approval-requested') {
    return null
  }

  return (
    <div className={cn('', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-[10px] transition-colors"
      >
        <HelpCircle className="size-2.5" />
        <span>What does this mean?</span>
        <ChevronDown
          className={cn(
            'size-2.5 transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>
      {isOpen && (
        <div className="bg-muted/30 mt-1.5 rounded-md px-2 py-1.5">
          <p className="text-muted-foreground text-[10px] leading-relaxed">
            {children}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Pre-built help content for sandboxing explanation
 */
export function ToolApprovalSandboxHelp({ className }: { className?: string }) {
  return (
    <ToolApprovalHelp className={className}>
      <strong className="text-foreground">Sandboxing</strong> restricts commands
      from accessing the network and writing to sensitive locations. Package
      managers like{' '}
      <code className="bg-muted rounded px-1 py-0.5">pnpm install</code> need
      network access to download packages, so they run unsandboxed.
      <strong className="text-foreground">
        {' '}
        Only approve commands you trust.
      </strong>
    </ToolApprovalHelp>
  )
}

/**
 * Pre-built help content for dangerous command explanation
 */
export function ToolApprovalDangerousHelp({
  className,
}: {
  className?: string
}) {
  return (
    <ToolApprovalHelp className={className}>
      <strong className="text-foreground">Dangerous commands</strong> can make
      irreversible changes to your system, like deleting files recursively or
      modifying permissions. These commands are flagged based on common patterns
      (rm -rf, sudo, etc.) to give you a chance to review before execution.
      <strong className="text-foreground">
        {' '}
        Only approve if you understand what the command does.
      </strong>
    </ToolApprovalHelp>
  )
}

/**
 * Content shown when approval was granted
 */
interface ToolApprovalAcceptedProps {
  children?: React.ReactNode
  className?: string
}

export function ToolApprovalAccepted({
  children,
  className,
}: ToolApprovalAcceptedProps) {
  const { state, approved } = useToolApprovalContext()

  // Show for responded/output states where approved is true
  const shouldShow =
    (state === 'approval-responded' || state === 'output-available') && approved

  if (!shouldShow) {
    return null
  }

  return (
    <div
      className={cn(
        'text-success flex items-center gap-1.5 text-xs',
        className,
      )}
    >
      {children ?? 'Approved'}
    </div>
  )
}

/**
 * Content shown when approval was rejected
 */
interface ToolApprovalRejectedProps {
  children?: React.ReactNode
  className?: string
}

export function ToolApprovalRejected({
  children,
  className,
}: ToolApprovalRejectedProps) {
  const { state, approved } = useToolApprovalContext()

  // Show for output-denied or responded with approved=false
  const shouldShow =
    state === 'output-denied' ||
    ((state === 'approval-responded' || state === 'output-available') &&
      approved === false)

  if (!shouldShow) {
    return null
  }

  return (
    <div
      className={cn(
        'text-destructive flex items-center gap-1.5 text-xs',
        className,
      )}
    >
      {children ?? 'Rejected'}
    </div>
  )
}

/**
 * Actions container (approve/reject buttons)
 */
interface ToolApprovalActionsProps {
  children: React.ReactNode
  className?: string
}

export function ToolApprovalActions({
  children,
  className,
}: ToolApprovalActionsProps) {
  const { state } = useToolApprovalContext()

  // Only show actions when approval is being requested
  if (state !== 'approval-requested') {
    return null
  }

  return (
    <div
      className={cn(
        'border-border flex items-center justify-end gap-2 border-t px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Individual action button
 */
type ToolApprovalActionProps = React.ComponentProps<typeof Button>

export function ToolApprovalAction({
  className,
  size = 'sm',
  ...props
}: ToolApprovalActionProps) {
  return (
    <Button className={cn('h-7 text-xs', className)} size={size} {...props} />
  )
}
