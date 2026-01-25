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

function PureMessages({
  messages,
  status,
  checkpoints,
  restoringMessageId,
  onRestoreCheckpoint,
}: MessagesProps) {
  const lastMessage = messages[messages.length - 1]

  const isThinking = (() => {
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
  })()

  const isStreaming = status === 'streaming' || status === 'submitted'

  return (
    <>
      {messages.map((message, index) => {
        const checkpoint = checkpoints?.get(message.id)
        // Only show checkpoint badge on user messages that have checkpoints
        const showCheckpointBadge =
          checkpoint && message.role === 'user' && onRestoreCheckpoint

        return (
          <div key={message.id} className="group/message-row relative">
            <Message
              message={message}
              isLast={index === messages.length - 1}
              isStreaming={isStreaming}
            />
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
      })}

      {isThinking && <ThinkingMessage />}
    </>
  )
}

export const Messages = memo(PureMessages)
