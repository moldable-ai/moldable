import { memo } from 'react'
import { type ChatMessage, Message, ThinkingMessage } from './chat-message'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

interface MessagesProps {
  messages: ChatMessage[]
  status: ChatStatus
}

function PureMessages({ messages, status }: MessagesProps) {
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
      {messages.map((message, index) => (
        <Message
          key={message.id}
          message={message}
          isLast={index === messages.length - 1}
          isStreaming={isStreaming}
        />
      ))}

      {isThinking && <ThinkingMessage />}
    </>
  )
}

export const Messages = memo(PureMessages)
