import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button, Input, Label } from '@moldable-ai/ui'
import { cn } from '../lib/utils'
import type { Workspace } from '../lib/workspaces'
import { WORKSPACE_COLORS } from '../lib/workspaces'
import { AnimatePresence, motion } from 'framer-motion'

interface OnboardingWorkspaceProps {
  workspaces: Workspace[]
  onSelect: (workspaceId: string) => void
  onCreateWorkspace: (name: string, color?: string) => Promise<Workspace>
}

const fadeIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

const scaleIn = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
}

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
}

const staggerItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
}

export function OnboardingWorkspace({
  workspaces,
  onSelect,
  onCreateWorkspace,
}: OnboardingWorkspaceProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceColor, setNewWorkspaceColor] = useState<string>(
    WORKSPACE_COLORS[0],
  )
  const [createError, setCreateError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleCreate = async () => {
    const trimmedName = newWorkspaceName.trim()
    if (!trimmedName) {
      setCreateError('Name is required')
      return
    }

    if (
      workspaces.some((w) => w.name.toLowerCase() === trimmedName.toLowerCase())
    ) {
      setCreateError('A workspace with this name already exists')
      return
    }

    setIsSubmitting(true)
    setCreateError(null)

    try {
      const workspace = await onCreateWorkspace(trimmedName, newWorkspaceColor)
      onSelect(workspace.id)
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create workspace',
      )
      setIsSubmitting(false)
    }
  }

  return (
    <motion.div
      key="workspace-step"
      className="flex w-full flex-col items-center gap-6"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={fadeIn}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="flex flex-col items-center gap-2"
        variants={fadeIn}
      >
        <h1 className="text-foreground text-xl font-medium">
          Welcome to Moldable
        </h1>
        <p className="text-muted-foreground text-sm">
          {isCreating
            ? 'Create a new workspace'
            : 'Select a workspace to continue'}
        </p>
      </motion.div>

      <AnimatePresence mode="wait">
        {!isCreating ? (
          <motion.div
            key="workspace-list"
            className="flex w-full max-w-[300px] flex-col gap-2"
            initial="initial"
            animate="animate"
            exit="exit"
            variants={staggerContainer}
          >
            {workspaces.map((workspace, index) => (
              <motion.button
                key={workspace.id}
                onClick={() => onSelect(workspace.id)}
                className="bg-card hover:bg-muted border-border flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
                variants={staggerItem}
                transition={{ duration: 0.2, delay: index * 0.05 }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: workspace.color }}
                />
                <span className="text-foreground text-sm font-medium">
                  {workspace.name}
                </span>
              </motion.button>
            ))}

            <motion.button
              onClick={() => setIsCreating(true)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-transparent px-4 py-3 transition-colors hover:border-current"
              variants={staggerItem}
              transition={{
                duration: 0.2,
                delay: workspaces.length * 0.05,
              }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <Plus className="size-4" />
              <span className="text-sm">New workspace</span>
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="create-form"
            className="flex w-full flex-col gap-4"
            initial="initial"
            animate="animate"
            exit="exit"
            variants={scaleIn}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="workspace-name">Name</Label>
              <Input
                id="workspace-name"
                value={newWorkspaceName}
                onChange={(e) => {
                  setNewWorkspaceName(e.target.value)
                  setCreateError(null)
                }}
                placeholder="e.g., Work, Side Project"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
              {createError && (
                <motion.p
                  className="text-destructive text-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {createError}
                </motion.p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {WORKSPACE_COLORS.map((color) => (
                  <motion.button
                    key={color}
                    type="button"
                    onClick={() => setNewWorkspaceColor(color)}
                    className={cn(
                      'size-6 cursor-pointer rounded-full transition-all',
                      newWorkspaceColor === color
                        ? 'ring-primary ring-2 ring-offset-2'
                        : '',
                    )}
                    style={{ backgroundColor: color }}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.95 }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setIsCreating(false)
                  setNewWorkspaceName('')
                  setCreateError(null)
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleCreate}
                disabled={isSubmitting || !newWorkspaceName.trim()}
              >
                {isSubmitting ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legal footer - only show when not creating */}
      <AnimatePresence>
        {!isCreating && (
          <motion.p
            className="text-muted-foreground/75 mt-10 max-w-[280px] text-center text-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.2 }}
          >
            By continuing, you agree to our
            <br />
            <a
              href="https://moldable.sh/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground underline underline-offset-2"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href="https://moldable.sh/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground underline underline-offset-2"
            >
              Privacy Policy
            </a>
            .
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
