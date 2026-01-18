'use client'

// import { useWorkspace } from '@moldable-ai/ui'

/**
 * Ghost examples showing what items will look like.
 * Update these to match your app's data structure.
 */
const GHOST_EXAMPLES = [
  { text: 'First example item', icon: '📝' },
  { text: 'Second example item', icon: '✨' },
  { text: 'Third example item', icon: '🎯' },
]

export default function WidgetPage() {
  // Uncomment to access workspace context for data fetching:
  // const { workspaceId, fetchWithWorkspace } = useWorkspace()

  // TODO: Replace with actual data fetching
  const items: typeof GHOST_EXAMPLES = []
  const isLoading = false

  // Show ghost state when empty
  const showGhost = !isLoading && items.length === 0

  return (
    <div className="flex h-full flex-col p-2">
      {/* Compact Header */}
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-base">__APP_ICON__</span>
        <h2 className="text-foreground text-sm font-semibold">__APP_NAME__</h2>
      </div>

      {/* Content */}
      <div className="space-y-1">
        {showGhost ? (
          // Ghost empty state
          GHOST_EXAMPLES.map((row, idx) => (
            <div
              key={idx}
              className="border-border/30 bg-muted/20 flex items-center gap-2 rounded-md border px-2 py-1.5 opacity-60"
            >
              <span className="text-[11px]">{row.icon}</span>
              <span className="text-foreground/80 text-[11px]">{row.text}</span>
            </div>
          ))
        ) : isLoading ? (
          // Loading state
          <div className="text-muted-foreground py-4 text-center text-xs">
            Loading...
          </div>
        ) : (
          // Actual items
          items.map((item, idx) => (
            <div
              key={idx}
              className="border-border/50 hover:bg-muted/50 flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors"
            >
              <span className="text-[11px]">{item.icon}</span>
              <span className="text-foreground text-[11px]">{item.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
