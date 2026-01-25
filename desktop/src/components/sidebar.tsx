import { Bot, Grid2x2, MessageSquare, Plus, Settings } from 'lucide-react'
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
import { open } from '@tauri-apps/plugin-shell'

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
  onOpenAgents?: () => void
  isAgentsActive?: boolean
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
  onOpenAgents,
  isAgentsActive = false,
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onSelectApp(null)}
            className={cn(
              'mb-2 flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-all',
              activeApp === null && !isChatActive && !isAgentsActive
                ? 'bg-muted'
                : 'hover:bg-muted/50',
            )}
          >
            <img src="/logo.svg" alt="Home" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Home
        </TooltipContent>
      </Tooltip>

      {/* Chat button - always visible */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onChatToggle}
            className={cn(
              'mb-4 flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-all',
              isChatActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <MessageSquare className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Toggle Chat
        </TooltipContent>
      </Tooltip>

      {/* Agents button - gateway sessions */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpenAgents}
            className={cn(
              'mb-4 flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-all',
              isAgentsActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Bot className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Agents
        </TooltipContent>
      </Tooltip>

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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsAddAppDialogOpen(true)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground mt-4 flex size-8 cursor-pointer items-center justify-center rounded-lg outline-none transition-all"
          >
            <Plus className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Add app
        </TooltipContent>
      </Tooltip>

      {/* Settings button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpenSettings}
            className="text-muted-foreground hover:bg-muted hover:text-foreground mt-2 flex size-8 cursor-pointer items-center justify-center rounded-lg outline-none transition-all"
          >
            <Settings className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Settings
        </TooltipContent>
      </Tooltip>

      {/* Discord button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => open('https://go.moldable.sh/discord')}
            className="text-muted-foreground hover:bg-muted hover:text-foreground mt-2 flex size-8 cursor-pointer items-center justify-center rounded-lg outline-none transition-all"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4 fill-current"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Join Discord
        </TooltipContent>
      </Tooltip>

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
