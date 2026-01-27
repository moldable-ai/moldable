import { memo } from 'react'
import { type ChatMessage, Message, ThinkingMessage } from './chat-message'
import { CheckpointBadge } from './checkpoint-badge'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

/**
 * Checkpoint info for a specific message
 */
export interface MessageCheckpoint {
  messageId: string
  fileCount: number
  totalBytes: number
}

interface MessagesProps {
  messages: ChatMessage[]
  status: ChatStatus
  /** Map of message ID to checkpoint info */
  checkpoints?: Map<string, MessageCheckpoint>
  /** Message ID currently being restored */
  restoringMessageId?: string | null
  /** Callback when restore is requested for a message */
  onRestoreCheckpoint?: (messageId: string) => void
}

export function computeIsThinking(messages: ChatMessage[], status: ChatStatus) {
  const lastMessage = messages[messages.length - 1]

  if (!lastMessage) return false
  if (status !== 'submitted' && status !== 'streaming') {
    return false
  }

  if (lastMessage.role === 'user') {
    return true
  }

  if (lastMessage.role === 'assistant') {
    const hasVisibleText = (lastMessage.parts ?? []).some((part) => {
      return part.type === 'text' && part.text.trim().length > 0
    })
    // Also check content fallback
    if (!hasVisibleText && lastMessage.content?.trim()) {
      return false
    }
    return !hasVisibleText
  }

  return false
}

interface MessageRowProps {
  message: ChatMessage
  isLast: boolean
  isStreaming: boolean
  checkpoint?: MessageCheckpoint
  restoringMessageId?: string | null
  onRestoreCheckpoint?: (messageId: string) => void
}

function PureMessageRow({
  message,
  isLast,
  isStreaming,
  checkpoint,
  restoringMessageId,
  onRestoreCheckpoint,
}: MessageRowProps) {
  // Only show checkpoint badge on user messages that have checkpoints
  const showCheckpointBadge =
    checkpoint && message.role === 'user' && onRestoreCheckpoint

  return (
    <div className="group/message-row relative">
      <Message message={message} isLast={isLast} isStreaming={isStreaming} />
      {/* Checkpoint badge - positioned at bottom-right of user message */}
      {showCheckpointBadge && (
        <div className="absolute bottom-1 right-4 opacity-0 transition-opacity group-hover/message-row:opacity-100">
          <CheckpointBadge
            messageId={message.id}
            fileCount={checkpoint.fileCount}
            totalBytes={checkpoint.totalBytes}
            isRestoring={restoringMessageId === message.id}
            onRestore={() => onRestoreCheckpoint(message.id)}
          />
        </div>
      )}
    </div>
  )
}

export const MessageRow = memo(PureMessageRow)

function PureMessages({
  messages,
  status,
  checkpoints,
  restoringMessageId,
  onRestoreCheckpoint,
}: MessagesProps) {
  const isThinking = computeIsThinking(messages, status)
  const isStreaming = status === 'streaming' || status === 'submitted'

  return (
    <>
      {messages.map((message, index) => {
        const checkpoint = checkpoints?.get(message.id)

        return (
          <MessageRow
            key={message.id}
            message={message}
            isLast={index === messages.length - 1}
            isStreaming={isStreaming}
            checkpoint={checkpoint}
            restoringMessageId={restoringMessageId}
            onRestoreCheckpoint={onRestoreCheckpoint}
          />
        )
      })}

      {isThinking && <ThinkingMessage />}
    </>
  )
}

export const Messages = memo(PureMessages)
