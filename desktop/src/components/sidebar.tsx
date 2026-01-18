import { Grid2x2, MessageSquare, Plus, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@moldable-ai/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@moldable-ai/ui'
import type { AppConfig } from '../app'
import { AddAppDialog } from './add-app-dialog'

// Icon dimensions for calculating overflow
const ICON_SIZE = 36 // size-9 = 36px
const ICON_GAP = 8 // gap-2 = 8px

interface SidebarProps {
  apps: AppConfig[]
  activeApp: AppConfig | null
  onSelectApp: (app: AppConfig | null) => void
  onAddApp?: () => void
  onRefreshApps?: () => void
  onDeleteApp?: (appId: string) => void
  onChatToggle?: () => void
  isChatActive?: boolean
  onOpenSettings?: () => void
}

function AppIcon({
  app,
  isActive,
  onClick,
  tooltipSide = 'right',
}: {
  app: AppConfig
  isActive: boolean
  onClick: () => void
  tooltipSide?: 'right' | 'bottom'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-xl text-sm outline-none',
            'transition-transform duration-200 ease-out hover:scale-125',
            isActive ? 'bg-muted' : 'hover:bg-muted/50',
          )}
        >
          {app.iconPath ? (
            <img
              src={app.iconPath}
              alt={app.name}
              className="size-full object-cover p-1"
            />
          ) : (
            app.icon
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={8}>
        {app.name}
      </TooltipContent>
    </Tooltip>
  )
}

export function Sidebar({
  apps,
  activeApp,
  onSelectApp,
  onAddApp,
  onRefreshApps,
  onDeleteApp: _onDeleteApp,
  onChatToggle,
  isChatActive = false,
  onOpenSettings,
}: SidebarProps) {
  const [isAddAppDialogOpen, setIsAddAppDialogOpen] = useState(false)
  const [isOverflowOpen, setIsOverflowOpen] = useState(false)
  const [maxVisibleApps, setMaxVisibleApps] = useState(10) // Start high, will be calculated
  const appsContainerRef = useRef<HTMLDivElement>(null)

  // Calculate max visible apps based on container height
  useEffect(() => {
    const container = appsContainerRef.current
    if (!container) return

    const calculateMaxApps = () => {
      const containerHeight = container.clientHeight
      // Each icon takes ICON_SIZE + ICON_GAP (except last one)
      // Formula: n icons fit if n * ICON_SIZE + (n-1) * ICON_GAP <= height
      // Solving: n <= (height + ICON_GAP) / (ICON_SIZE + ICON_GAP)
      const maxApps = Math.floor(
        (containerHeight + ICON_GAP) / (ICON_SIZE + ICON_GAP),
      )
      setMaxVisibleApps(Math.max(1, maxApps)) // At least 1
    }

    calculateMaxApps()

    const resizeObserver = new ResizeObserver(calculateMaxApps)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [])

  // Split apps into visible and overflow
  const { visibleApps, overflowApps } = useMemo(() => {
    if (apps.length <= maxVisibleApps) {
      return { visibleApps: apps, overflowApps: [] }
    }
    return {
      visibleApps: apps.slice(0, maxVisibleApps - 1), // Leave room for overflow button
      overflowApps: apps.slice(maxVisibleApps - 1),
    }
  }, [apps, maxVisibleApps])

  const hasOverflow = overflowApps.length > 0
  const isActiveInOverflow =
    hasOverflow && overflowApps.some((app) => app.id === activeApp?.id)

  return (
    <aside className="bg-card ring-border m-2 flex w-14 flex-col items-center rounded-xl pb-3 pt-2 shadow-sm ring-1">
      {/* Home button */}
      <button
        onClick={() => onSelectApp(null)}
        className={cn(
          'mb-2 flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-all',
          activeApp === null && !isChatActive
            ? 'bg-muted'
            : 'hover:bg-muted/50',
        )}
        title="Home"
      >
        <img src="/logo.svg" alt="Home" className="size-4" />
      </button>

      {/* Chat button - always visible */}
      <button
        onClick={onChatToggle}
        className={cn(
          'mb-4 flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-all',
          isChatActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        title="Chat with Moldable"
      >
        <MessageSquare className="size-4" />
      </button>

      <div className="bg-border mb-4 h-px w-8" />

      {/* App icons */}
      <div ref={appsContainerRef} className="flex flex-1 flex-col gap-2">
        {visibleApps.map((app) => (
          <AppIcon
            key={app.id}
            app={app}
            isActive={activeApp?.id === app.id}
            onClick={() => onSelectApp(app)}
          />
        ))}

        {/* Overflow popover */}
        {hasOverflow && (
          <Popover open={isOverflowOpen} onOpenChange={setIsOverflowOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'relative flex size-9 cursor-pointer items-center justify-center rounded-xl text-sm outline-none',
                  'transition-transform duration-200 ease-out hover:scale-125',
                  isActiveInOverflow || isOverflowOpen
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <Grid2x2 className="size-4" />
                <span className="bg-muted-foreground text-background absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full text-[9px] font-medium">
                  {overflowApps.length}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" sideOffset={8} className="w-auto p-2">
              <div className="grid grid-cols-6 gap-2">
                {overflowApps.map((app) => (
                  <Tooltip key={app.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          onSelectApp(app)
                          setIsOverflowOpen(false)
                        }}
                        className={cn(
                          'flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-xl text-sm outline-none transition-all',
                          'hover:scale-110',
                          activeApp?.id === app.id
                            ? 'bg-muted'
                            : 'hover:bg-muted/50',
                        )}
                      >
                        {app.iconPath ? (
                          <img
                            src={app.iconPath}
                            alt={app.name}
                            className="size-full object-cover p-1"
                          />
                        ) : (
                          app.icon
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>
                      {app.name}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="bg-border mt-4 h-px w-8" />

      {/* Add app button */}
      <button
        onClick={() => setIsAddAppDialogOpen(true)}
        className="text-muted-foreground hover:bg-muted hover:text-foreground mt-4 flex size-8 cursor-pointer items-center justify-center rounded-lg outline-none transition-all"
        title="Add app"
      >
        <Plus className="size-4" />
      </button>

      {/* Settings button */}
      <button
        onClick={onOpenSettings}
        className="text-muted-foreground hover:bg-muted hover:text-foreground mt-2 flex size-8 cursor-pointer items-center justify-center rounded-lg outline-none transition-all"
        title="Settings"
      >
        <Settings className="size-4" />
      </button>

      {/* Add App Dialog */}
      <AddAppDialog
        open={isAddAppDialogOpen}
        onOpenChange={setIsAddAppDialogOpen}
        onAddFromFolder={() => onAddApp?.()}
        onAppInstalled={() => onRefreshApps?.()}
      />
    </aside>
  )
}
