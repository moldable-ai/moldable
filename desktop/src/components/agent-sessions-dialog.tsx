import { Dialog, DialogContent } from '@moldable-ai/ui'
import { AgentSessionsPanel } from './agent-sessions-panel'

interface AgentSessionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  aiServerPort?: number
  workspaceId?: string
}

export function AgentSessionsDialog({
  open,
  onOpenChange,
  aiServerPort,
  workspaceId,
}: AgentSessionsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-h-[85vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <AgentSessionsPanel
          aiServerPort={aiServerPort}
          workspaceId={workspaceId}
          variant="dialog"
          showCloseButton={false}
          pollingEnabled={open}
        />
      </DialogContent>
    </Dialog>
  )
}
