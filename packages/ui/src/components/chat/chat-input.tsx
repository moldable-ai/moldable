import { ArrowUp, Square } from 'lucide-react'
import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

type ChatInputProps = {
  input: string
  onInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  isResponding: boolean
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
  onStop?: () => void
  compact?: boolean
}

export function ChatInput({
  input,
  onInputChange,
  onSubmit,
  isResponding,
  placeholder = 'Ask anything...',
  inputRef,
  onStop,
  compact = false,
}: ChatInputProps) {
  const hasInput = input.trim().length > 0

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Allow Shift+Enter for newlines
        return
      }
      // Submit on plain Enter (if there's input)
      e.preventDefault()

      if (hasInput) {
        // If we have input, submit (which will stop any ongoing stream)
        onSubmit(e as unknown as FormEvent<HTMLFormElement>)
      } else if (isResponding && onStop) {
        // If no input but streaming, just stop
        onStop()
      }
    }
  }

  // Show stop button only when streaming AND no input
  const showStopButton = isResponding && !hasInput

  const handleButtonClick = (e: MouseEvent<HTMLButtonElement>) => {
    // When rendered as stop button (type="button"), always call onStop
    // Don't re-check conditions - trust the render decision to avoid race conditions
    if (e.currentTarget.type === 'button') {
      e.preventDefault()
      onStop?.()
    }
    // If type="submit", form handles submission
  }

  return (
    <div className={cn('isolate w-full p-2')} data-chat-input-wrapper>
      <div className="mx-auto max-w-5xl">
        <form onSubmit={onSubmit}>
          <div
            className={cn(
              'bg-background relative flex w-full flex-col rounded-3xl border',
              compact && 'h-14',
            )}
          >
            {/* Textarea */}
            <div className={cn('w-full px-5', compact ? 'py-4' : 'py-4 pr-14')}>
              <Textarea
                ref={inputRef}
                value={input}
                placeholder={placeholder}
                onChange={onInputChange}
                onKeyDown={handleKeyDown}
                className={cn(
                  'max-h-32 min-h-[24px] resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                  compact && 'max-h-6 min-h-6',
                )}
              />
            </div>

            {/* Send/Stop button - absolutely positioned */}
            {!compact && (
              <div className="absolute bottom-3 right-3">
                <Button
                  type={showStopButton ? 'button' : 'submit'}
                  size="icon"
                  className="bg-primary text-primary-foreground size-8 cursor-pointer rounded-full hover:opacity-70 disabled:opacity-30"
                  disabled={!hasInput && !isResponding}
                  onClick={handleButtonClick}
                >
                  {showStopButton ? (
                    <Square className="fill-primary-foreground size-4 animate-pulse" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                  <span className="sr-only">
                    {showStopButton ? 'Stop generating' : 'Send message'}
                  </span>
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
