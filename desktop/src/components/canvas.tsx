import type { AppConfig } from '../app'
import { EmptyStateApps } from './empty-state-apps'
import { WidgetCard } from './widget-card'

interface CanvasProps {
  apps: AppConfig[]
  workspaceId: string
  onOpenApp: (app: AppConfig) => void
  onAddApp: () => void
  onRefreshApps?: () => void
}

export function Canvas({
  apps,
  workspaceId,
  onOpenApp,
  onAddApp,
  onRefreshApps,
}: CanvasProps) {
  if (apps.length === 0) {
    return <EmptyStateApps onAddApp={onAddApp} onRefreshApps={onRefreshApps} />
  }

  return (
    <div className="pb-(--chat-safe-padding) h-full overflow-auto p-6">
      {/* Widget grid */}
      <div className="grid auto-rows-auto grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {apps.map((app) => (
          <WidgetCard
            key={app.id}
            app={app}
            workspaceId={workspaceId}
            onClick={() => onOpenApp(app)}
          />
        ))}
      </div>
    </div>
  )
}
