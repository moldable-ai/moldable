import { RefreshCw, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { AnimatePresence, motion } from 'framer-motion'

interface UpdateNotificationProps {
  visible: boolean
  onReload: () => void
  onDismiss: () => void
}

/**
 * A toast-like notification that appears when the app detects
 * file changes that require a reload to take effect.
 */
export function UpdateNotification({
  visible,
  onReload,
  onDismiss,
}: UpdateNotificationProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cn(
            'z-100 fixed bottom-4 right-4',
            'flex items-center gap-3',
            'border-border bg-card rounded-lg border px-4 py-3 shadow-lg',
            'backdrop-blur-sm',
          )}
        >
          {/* Pulsing indicator */}
          <div className="relative flex size-2">
            <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-75" />
            <span className="bg-primary relative inline-flex size-2 rounded-full" />
          </div>

          {/* Message */}
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground text-sm font-medium">
              New update available
            </span>
          </div>

          {/* Actions */}
          <div className="ml-2 flex items-center gap-1">
            <button
              onClick={onReload}
              className={cn(
                'bg-primary text-primary-foreground',
                'flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium',
                'hover:bg-primary/90 transition-colors',
              )}
            >
              <RefreshCw className="size-3" />
              Reload
            </button>
            <button
              onClick={onDismiss}
              className={cn(
                'text-muted-foreground hover:bg-muted hover:text-foreground',
                'flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors',
              )}
              title="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
