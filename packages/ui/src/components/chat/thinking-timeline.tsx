'use client'

import {
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  Terminal,
} from 'lucide-react'
import { type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export enum ThinkingTimelineMarker {
  Default = 'default',
  None = 'none',
  Loading = 'loading',
  Search = 'search',
  Read = 'read',
  File = 'file',
  Terminal = 'terminal',
  Folder = 'folder',
}

export type ThinkingTimelineItem = {
  content: ReactNode
  marker?: ThinkingTimelineMarker
}

export type ThinkingTimelineProps = {
  items: ThinkingTimelineItem[]
  className?: string
}

export function ThinkingTimeline({ items, className }: ThinkingTimelineProps) {
  if (!items?.length) {
    return null
  }

  return (
    <div className={cn('relative my-1', className)}>
      <ol className="relative flex flex-col">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const marker = item.marker ?? ThinkingTimelineMarker.Default

          return (
            <li
              key={index}
              className={cn(
                'relative flex w-full items-start gap-2',
                !isLast && 'pb-4',
              )}
            >
              <div className="relative flex w-5 shrink-0 justify-center self-stretch">
                {!isLast && (
                  <div className="bg-border pointer-events-none absolute bottom-[-24px] left-1/2 top-6 w-px -translate-x-1/2" />
                )}
                <span
                  className={cn(
                    'text-muted-foreground flex h-6 w-6 items-center justify-center',
                    marker === ThinkingTimelineMarker.Default ? 'mt-1' : 'mt-0',
                  )}
                >
                  {getMarkerVisual(marker)}
                </span>
              </div>
              <div className="min-w-0 flex-1">{item.content}</div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function getMarkerVisual(marker: ThinkingTimelineMarker) {
  switch (marker) {
    case ThinkingTimelineMarker.None:
      return null
    case ThinkingTimelineMarker.Loading:
      return <Loader2 className="size-4 animate-spin" />
    case ThinkingTimelineMarker.Search:
      return <Globe className="size-4" />
    case ThinkingTimelineMarker.Read:
      return <Eye className="size-4" />
    case ThinkingTimelineMarker.File:
      return <FileText className="size-4" />
    case ThinkingTimelineMarker.Terminal:
      return <Terminal className="size-4" />
    case ThinkingTimelineMarker.Folder:
      return <FolderOpen className="size-4" />
    case ThinkingTimelineMarker.Default:
    default:
      return (
        <span className="bg-foreground/70 block h-[6px] w-[6px] rounded-full" />
      )
  }
}
