import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import { cn } from '../lib/utils'
import type { Workspace } from '../lib/workspaces'
import { WORKSPACE_COLORS } from '../lib/workspaces'
import { ColorPicker } from './workspace-selector'

type WorkspaceDialogProps =
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'create'
      initialName?: string
      initialColor?: string
      onSave: (name: string, color: string) => Promise<void>
      existingNames: string[]
    }
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'edit'
      initialName: string
      initialColor: string
      onSave: (name: string, color: string) => Promise<void>
      existingNames: string[]
    }
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'manage'
      workspaces: Workspace[]
      activeWorkspaceId?: string
      onSelect: (id: string) => void
      onEdit: (workspace: Workspace) => void
      onDelete: (workspace: Workspace) => void
      onCreate: () => void
    }

export function WorkspaceDialog(props: WorkspaceDialogProps) {
  if (props.mode === 'manage') {
    return <ManageWorkspacesDialog {...props} />
  }
  return <CreateEditWorkspaceDialog {...props} />
}

function CreateEditWorkspaceDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  initialColor = WORKSPACE_COLORS[0],
  onSave,
  existingNames,
}: Extract<WorkspaceDialogProps, { mode: 'create' | 'edit' }>) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required')
      return
    }

    if (
      existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())
    ) {
      setError('A workspace with this name already exists')
      return
    }

    setIsSubmitting(true)
    try {
      await onSave(trimmedName, color)
      setName('')
      setColor(WORKSPACE_COLORS[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reset state when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setName(initialName)
      setColor(initialColor)
      setError(null)
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New Workspace' : 'Edit Workspace'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Create a new workspace to organize your apps and data.'
              : 'Update your workspace settings.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Work, Side Project"
                autoFocus
              />
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
            <div className="grid gap-2">
              <Label>Color</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? 'Saving...'
                : mode === 'create'
                  ? 'Create'
                  : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ManageWorkspacesDialog({
  open,
  onOpenChange,
  workspaces,
  activeWorkspaceId,
  onSelect,
  onEdit,
  onDelete,
  onCreate,
}: Extract<WorkspaceDialogProps, { mode: 'manage' }>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Manage Workspaces</DialogTitle>
          <DialogDescription>
            Switch between workspaces or manage their settings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-4">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className={cn(
                'hover:bg-muted/50 flex items-center gap-3 rounded-lg p-3 transition-colors',
                workspace.id === activeWorkspaceId
                  ? 'border-primary bg-primary/5 border'
                  : '',
              )}
            >
              <button
                type="button"
                className="flex flex-1 cursor-pointer items-center gap-3 outline-none"
                onClick={() => onSelect(workspace.id)}
              >
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: workspace.color }}
                />
                <span className="font-medium">{workspace.name}</span>
                {workspace.id === activeWorkspaceId && (
                  <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs">
                    Active
                  </span>
                )}
              </button>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => onEdit(workspace)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive size-8"
                  onClick={() => onDelete(workspace)}
                  disabled={workspaces.length <= 1}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCreate}>
            <Plus className="mr-2 size-4" />
            New Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
