'use client'

import { useWorkspace } from '@moldable-ai/ui'

export default function HomePage() {
  const { workspaceId } = useWorkspace()

  return (
    <div className="bg-background text-foreground min-h-screen p-8 pb-[var(--chat-safe-padding)]">
      <div className="mx-auto max-w-2xl">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <span>__APP_ICON__</span>
          __APP_NAME__
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          __APP_DESCRIPTION__
        </p>

        {/* TODO: Replace this with your app's main content */}
        <div className="mt-8 space-y-4">
          <div className="border-border bg-card rounded-lg border p-6">
            <h2 className="text-foreground text-lg font-semibold">
              Getting Started
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              This is your app&apos;s main page. Edit{' '}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                src/app/page.tsx
              </code>{' '}
              to customize it.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Current workspace: {workspaceId || 'loading...'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
