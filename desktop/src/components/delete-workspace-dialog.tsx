import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@moldable-ai/ui'
import type { Workspace } from '../lib/workspaces'

interface DeleteWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
  onConfirm: (workspace: Workspace) => Promise<void>
}

export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  onConfirm,
}: DeleteWorkspaceDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const isConfirmed =
    workspace && confirmText.toLowerCase() === workspace.name.toLowerCase()

  const handleDelete = async () => {
    if (!workspace || !isConfirmed) return

    setIsDeleting(true)
    try {
      await onConfirm(workspace)
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to delete workspace:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // Reset state when dialog opens/closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setConfirmText('')
      setIsDeleting(false)
    }
    onOpenChange(isOpen)
  }

  if (!workspace) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="min-w-[700px] max-w-3xl">
        <DialogHeader>
          <div className="bg-destructive/10 mb-2 flex size-12 items-center justify-center rounded-full">
            <AlertTriangle className="text-destructive size-6" />
          </div>
          <DialogTitle>Delete workspace?</DialogTitle>
          <DialogDescription className="text-left">
            This action cannot be undone. This will permanently delete the{' '}
            <strong className="text-foreground">{workspace.name}</strong>{' '}
            workspace including:
          </DialogDescription>
        </DialogHeader>

        <ul className="text-muted-foreground my-2 list-inside list-disc space-y-1 text-sm">
          <li>Unregistering all apps in this workspace</li>
          <li>Deleting all app data (databases, files, settings)</li>
          <li>Deleting all conversation history</li>
          <li>Deleting workspace-specific configuration</li>
        </ul>

        <div className="grid gap-2 py-2">
          <Label htmlFor="confirm-delete" className="text-sm">
            Type <strong className="text-foreground">{workspace.name}</strong>{' '}
            to confirm:
          </Label>
          <Input
            id="confirm-delete"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={workspace.name}
            autoFocus
            autoComplete="off"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmed || isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete workspace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
