import { Clock, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip'

export interface ConversationMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface ConversationHistoryProps {
  conversations: ConversationMeta[]
  currentConversationId?: string | null
  onSelect: (id: string) => void
  onDelete?: (id: string) => void
  disabled?: boolean
  className?: string
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function ConversationHistory({
  conversations,
  currentConversationId,
  onSelect,
  onDelete,
  disabled = false,
  className,
}: ConversationHistoryProps) {
  if (conversations.length === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                className={cn(
                  'text-muted-foreground hover:text-foreground',
                  className,
                )}
              >
                <Clock className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Conversation history</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-64">
          <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
            Recent conversations
          </div>
          <DropdownMenuSeparator />
          <div className="max-h-64 overflow-y-auto">
            {conversations.slice(0, 20).map((conv) => (
              <DropdownMenuItem
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'group flex cursor-pointer items-start gap-2 py-2',
                  conv.id === currentConversationId && 'bg-accent',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{conv.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatRelativeTime(conv.updatedAt)} · {conv.messageCount}{' '}
                    messages
                  </p>
                </div>
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(conv.id)
                    }}
                    className="text-muted-foreground hover:text-destructive size-6 shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}
