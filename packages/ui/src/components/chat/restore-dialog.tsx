'use client'

import { AlertTriangle, History } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { formatDistanceToNow } from 'date-fns'

export interface CheckpointInfo {
  /** The message ID of the checkpoint */
  messageId: string
  /** Number of files in the checkpoint */
  fileCount: number
  /** Total bytes of the checkpoint */
  totalBytes: number
  /** When the checkpoint was created */
  createdAt: string
  /** List of file paths (for display) */
  files?: string[]
}

export interface RestoreDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog state changes */
  onOpenChange: (open: boolean) => void
  /** The checkpoint to potentially restore */
  checkpoint: CheckpointInfo | null
  /** Callback when restore is confirmed */
  onConfirm: () => void
  /** Whether a restore is in progress */
  isRestoring?: boolean
}

/**
 * Dialog for confirming checkpoint restoration.
 *
 * Note: The restore operation is cascading - it will undo ALL changes from
 * this point forward, including deleting files that were created after this
 * checkpoint.
 */
export function RestoreDialog({
  open,
  onOpenChange,
  checkpoint,
  onConfirm,
  isRestoring,
}: RestoreDialogProps) {
  if (!checkpoint) return null

  const files = checkpoint.files ?? []
  const displayFiles = files.slice(0, 5)
  const remainingCount = files.length - displayFiles.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="text-muted-foreground size-5" />
            Restore to this point?
          </DialogTitle>
          <DialogDescription>
            This will undo all changes made from{' '}
            {formatDistanceToNow(new Date(checkpoint.createdAt), {
              addSuffix: true,
            })}{' '}
            onwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Warning */}
          <div className="bg-destructive/10 flex items-start gap-2 rounded-lg p-3 text-sm">
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-foreground">
                All changes after this point will be reverted. Files created
                after this checkpoint will be deleted.
              </p>
              <p className="text-muted-foreground">
                This action cannot be undone.
              </p>
            </div>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="text-muted-foreground text-sm">
              <p className="text-foreground mb-2 font-medium">
                Files in this checkpoint:
              </p>
              <ul className="bg-muted/50 space-y-1 rounded-md p-2 font-mono text-xs">
                {displayFiles.map((file) => (
                  <li key={file} className="truncate">
                    {file}
                  </li>
                ))}
                {remainingCount > 0 && (
                  <li className="text-muted-foreground/70">
                    ...and {remainingCount} more
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Stats */}
          <p className="text-muted-foreground text-xs">
            {checkpoint.fileCount} file{checkpoint.fileCount !== 1 ? 's' : ''}{' '}
            captured
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRestoring}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isRestoring}
            className="cursor-pointer"
          >
            {isRestoring ? 'Restoring...' : 'Restore'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
