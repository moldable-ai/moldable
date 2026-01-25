'use client'

import { History, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip'

export interface CheckpointBadgeProps {
  /** Message ID this checkpoint belongs to */
  messageId: string
  /** Number of files in the checkpoint */
  fileCount: number
  /** Total bytes of the checkpoint */
  totalBytes?: number
  /** Whether a restore is in progress */
  isRestoring?: boolean
  /** Callback when restore is requested */
  onRestore: () => void
  /** Additional class name */
  className?: string
}

/**
 * Badge shown on messages that have a checkpoint restore point.
 * Clicking triggers the restore confirmation dialog.
 */
export function CheckpointBadge({
  isRestoring,
  onRestore,
  className,
}: CheckpointBadgeProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation()
              onRestore()
            }}
            disabled={isRestoring}
            className={cn(
              'text-muted-foreground hover:text-foreground hover:bg-muted/50 size-6',
              !isRestoring && 'cursor-pointer',
              isRestoring && 'cursor-wait',
              className,
            )}
          >
            {isRestoring ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <History className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Undo all changes from this point onwards</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
