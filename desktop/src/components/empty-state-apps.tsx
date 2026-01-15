import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button, cn } from '@moldable-ai/ui'
import { AddAppDialog } from './add-app-dialog'

interface EmptyStateAppsProps {
  onAddApp: () => void
  onRefreshApps?: () => void
  className?: string
}

function NotesWidgetContent() {
  const notes = [
    { title: 'Meeting notes from standup', date: 'Today' },
    { title: 'Ideas for the weekend project', date: 'Yesterday' },
    { title: 'Book recommendations', date: '2 days ago' },
  ]

  return (
    <div className="flex flex-col gap-1.5 p-2">
      {notes.map((note, idx) => (
        <div key={idx} className="bg-muted/30 rounded-md px-2.5 py-1.5">
          <p className="text-foreground truncate text-xs font-medium">
            {note.title}
          </p>
          <p className="text-muted-foreground text-[10px]">{note.date}</p>
        </div>
      ))}
    </div>
  )
}

function CalendarWidgetContent() {
  const events = [
    { title: 'Team sync', time: '10:00 AM', color: 'bg-blue-500' },
    { title: 'Lunch with Alex', time: '12:30 PM', color: 'bg-green-500' },
    { title: 'Design review', time: '3:00 PM', color: 'bg-purple-500' },
  ]

  return (
    <div className="flex flex-col gap-1.5 p-2">
      <p className="text-muted-foreground px-1 text-[10px] font-medium uppercase tracking-wide">
        Today
      </p>
      {events.map((event, idx) => (
        <div
          key={idx}
          className="bg-muted/30 flex items-center gap-2 rounded-md px-2.5 py-1.5"
        >
          <div className={cn('size-1.5 rounded-full', event.color)} />
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-xs font-medium">
              {event.title}
            </p>
          </div>
          <p className="text-muted-foreground text-[10px]">{event.time}</p>
        </div>
      ))}
    </div>
  )
}

export function EmptyStateApps({
  onAddApp,
  onRefreshApps,
  className,
}: EmptyStateAppsProps) {
  const [isAddAppDialogOpen, setIsAddAppDialogOpen] = useState(false)

  const exampleApps = [
    {
      icon: '📝',
      name: 'Notes',
      content: <NotesWidgetContent />,
    },
    {
      icon: '📅',
      name: 'Calendar',
      content: <CalendarWidgetContent />,
    },
  ]

  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center px-6 py-16',
        className,
      )}
    >
      {/* Ghost widget cards grid */}
      <div className="mx-auto mb-10 grid w-full max-w-lg auto-rows-auto grid-cols-2 gap-4">
        {exampleApps.map((app, idx) => (
          <div
            key={idx}
            className="border-border/40 bg-card/50 flex min-h-[160px] flex-col overflow-hidden rounded-2xl border opacity-50"
          >
            {/* Header bar */}
            <div className="bg-muted/30 border-border/40 flex h-8 shrink-0 items-center justify-between border-b px-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">{app.icon}</span>
                <span className="text-muted-foreground text-xs font-medium">
                  {app.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="bg-status-running/50 size-2 rounded-full" />
                <span className="text-muted-foreground text-[10px]">
                  Running
                </span>
              </div>
            </div>

            {/* Widget content */}
            <div className="bg-background/50 flex-1">{app.content}</div>
          </div>
        ))}
      </div>

      {/* Message and CTA */}
      <div className="flex flex-col items-center gap-4">
        <div className="text-center">
          <h2 className="text-foreground text-lg font-semibold">
            Your apps will appear here
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Add your first app or ask Moldable to create one for you
          </p>
        </div>
        <Button
          onClick={() => setIsAddAppDialogOpen(true)}
          className="cursor-pointer"
        >
          <Plus className="mr-2 size-4" />
          Add App
        </Button>
      </div>

      <AddAppDialog
        open={isAddAppDialogOpen}
        onOpenChange={setIsAddAppDialogOpen}
        onAddFromFolder={onAddApp}
        onAppInstalled={() => onRefreshApps?.()}
      />
    </div>
  )
}
