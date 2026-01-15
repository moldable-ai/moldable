import { FolderOpen, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@moldable-ai/ui'
import type { AvailableApp } from '../lib/app-manager'
import { getAvailableApps, installAvailableApp } from '../lib/app-manager'
import { cn } from '../lib/utils'

interface AddAppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddFromFolder: () => void
  onAppInstalled: () => void
}

export function AddAppDialog({
  open,
  onOpenChange,
  onAddFromFolder,
  onAppInstalled,
}: AddAppDialogProps) {
  const [availableApps, setAvailableApps] = useState<AvailableApp[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load available apps when dialog opens
  useEffect(() => {
    if (open) {
      setLoading(true)
      setError(null)
      getAvailableApps()
        .then(setAvailableApps)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [open])

  const handleInstallApp = async (app: AvailableApp) => {
    setInstalling(app.id)
    setError(null)
    try {
      await installAvailableApp(app.path)
      onAppInstalled()
      // Refresh the list
      const apps = await getAvailableApps()
      setAvailableApps(apps)
      // If no more apps to install, close the dialog
      if (apps.length === 0) {
        onOpenChange(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to install app')
    } finally {
      setInstalling(null)
    }
  }

  const handleAddFromFolder = () => {
    onOpenChange(false)
    onAddFromFolder()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add App</DialogTitle>
          <DialogDescription>
            Install a pre-built app or add one from a folder
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 py-4">
          {/* Available apps section - scrollable */}
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center py-8">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading apps...
            </div>
          ) : availableApps.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="text-muted-foreground mb-2 shrink-0 text-xs font-medium uppercase tracking-wide">
                Available Apps
              </p>
              <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
                <div className="grid gap-2">
                  {availableApps.map((app) => (
                    <button
                      key={app.id}
                      onClick={() => handleInstallApp(app)}
                      disabled={installing !== null}
                      className={cn(
                        'hover:bg-muted/50 flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      <div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                        {app.iconPath ? (
                          <img
                            src={app.iconPath}
                            alt={app.name}
                            className="size-full object-cover p-1"
                          />
                        ) : (
                          <span className="text-lg">{app.icon}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground font-medium">
                          {app.name}
                        </p>
                        {app.description && (
                          <p className="text-muted-foreground text-sm">
                            {app.description}
                          </p>
                        )}
                      </div>
                      {installing === app.id ? (
                        <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                      ) : (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          Install
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {error && <p className="text-destructive text-sm">{error}</p>}

          {/* Divider if there are available apps */}
          {availableApps.length > 0 && (
            <div className="border-border shrink-0 border-t" />
          )}

          {/* Add from folder option - always visible at bottom */}
          <button
            onClick={handleAddFromFolder}
            disabled={installing !== null}
            className={cn(
              'hover:bg-muted/50 flex w-full shrink-0 cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-left transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FolderOpen className="text-muted-foreground size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground font-medium">Add from folder</p>
              <p className="text-muted-foreground text-sm">
                Select a folder containing a Moldable app
              </p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
