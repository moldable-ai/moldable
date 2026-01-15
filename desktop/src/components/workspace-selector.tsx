import { Check, ChevronDown, Plus, Settings } from 'lucide-react'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@moldable-ai/ui'
import { cn } from '../lib/utils'
import type { Workspace } from '../lib/workspaces'
import { WORKSPACE_COLORS } from '../lib/workspaces'
import { DeleteWorkspaceDialog } from './delete-workspace-dialog'
import { WorkspaceDialog } from './workspace-dialog'

interface WorkspaceSelectorProps {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  onWorkspaceChange: (workspaceId: string) => void
  onCreateWorkspace: (name: string, color?: string) => Promise<Workspace>
  onUpdateWorkspace: (
    id: string,
    updates: { name?: string; color?: string },
  ) => Promise<Workspace>
  onDeleteWorkspace: (id: string) => Promise<void>
  disabled?: boolean
  className?: string
}

export function WorkspaceSelector({
  workspaces,
  activeWorkspace,
  onWorkspaceChange,
  onCreateWorkspace,
  onUpdateWorkspace,
  onDeleteWorkspace,
  disabled = false,
  className,
}: WorkspaceSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'manage' | null>(null)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(
    null,
  )
  const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(
    null,
  )

  const handleCreateWorkspace = async (name: string, color: string) => {
    const workspace = await onCreateWorkspace(name, color)
    onWorkspaceChange(workspace.id)
    setDialogMode(null)
  }

  const handleEditWorkspace = async (name: string, color: string) => {
    if (!editingWorkspace) return
    await onUpdateWorkspace(editingWorkspace.id, { name, color })
    setEditingWorkspace(null)
    setDialogMode(null)
  }

  const handleDeleteWorkspace = (workspace: Workspace) => {
    if (workspaces.length <= 1) {
      alert('Cannot delete the last workspace')
      return
    }
    setDeletingWorkspace(workspace)
  }

  const confirmDeleteWorkspace = async (workspace: Workspace) => {
    await onDeleteWorkspace(workspace.id)
    setDeletingWorkspace(null)
  }

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger
          disabled={disabled}
          className={cn(
            'focus-visible:ring-ring text-muted-foreground hover:bg-muted hover:text-foreground flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          {activeWorkspace && (
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: activeWorkspace.color }}
            />
          )}
          <span>{activeWorkspace?.name ?? 'Select workspace'}</span>
          <ChevronDown className="size-3 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => {
                onWorkspaceChange(workspace.id)
                setIsOpen(false)
              }}
              className="flex items-center gap-2"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: workspace.color }}
              />
              <span className="flex-1">{workspace.name}</span>
              {workspace.id === activeWorkspace?.id && (
                <Check className="text-primary size-4" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setDialogMode('create')
              setIsOpen(false)
            }}
            className="flex items-center gap-2"
          >
            <Plus className="size-4" />
            <span>New workspace</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setDialogMode('manage')
              setIsOpen(false)
            }}
            className="flex items-center gap-2"
          >
            <Settings className="size-4" />
            <span>Manage workspaces</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create workspace dialog */}
      <WorkspaceDialog
        open={dialogMode === 'create' && !editingWorkspace}
        onOpenChange={(open) => !open && setDialogMode(null)}
        mode="create"
        onSave={handleCreateWorkspace}
        existingNames={workspaces.map((w) => w.name)}
      />

      {/* Manage workspaces dialog */}
      <WorkspaceDialog
        open={dialogMode === 'manage'}
        onOpenChange={(open) => !open && setDialogMode(null)}
        mode="manage"
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspace?.id}
        onSelect={(id) => {
          onWorkspaceChange(id)
          setDialogMode(null)
        }}
        onEdit={(workspace) => {
          setEditingWorkspace(workspace)
          setDialogMode('create') // Reuse create dialog for edit
        }}
        onDelete={handleDeleteWorkspace}
        onCreate={() => setDialogMode('create')}
      />

      {/* Edit workspace dialog */}
      {editingWorkspace && (
        <WorkspaceDialog
          open={!!editingWorkspace && dialogMode === 'create'}
          onOpenChange={(open) => {
            if (!open) {
              setEditingWorkspace(null)
              setDialogMode(null)
            }
          }}
          mode="edit"
          initialName={editingWorkspace.name}
          initialColor={editingWorkspace.color}
          onSave={handleEditWorkspace}
          existingNames={workspaces
            .filter((w) => w.id !== editingWorkspace.id)
            .map((w) => w.name)}
        />
      )}

      {/* Delete workspace confirmation dialog */}
      <DeleteWorkspaceDialog
        open={!!deletingWorkspace}
        onOpenChange={(open) => !open && setDeletingWorkspace(null)}
        workspace={deletingWorkspace}
        onConfirm={confirmDeleteWorkspace}
      />
    </>
  )
}

// Simple color picker component
export function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {WORKSPACE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            'size-6 cursor-pointer rounded-full transition-all',
            value === color
              ? 'ring-primary ring-2 ring-offset-2'
              : 'hover:scale-110',
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  )
}
