import { ExternalLink, Key, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'

interface EnvRequirement {
  key: string
  name: string
  description?: string
  url?: string
  required: boolean
}

interface AppEnvStatus {
  requirements: EnvRequirement[]
  missing: string[]
  present: string[]
}

interface AppEnvDialogProps {
  appName: string
  appPath: string
  onClose: () => void
  onComplete: () => void
}

export function AppEnvDialog({
  appName,
  appPath,
  onClose,
  onComplete,
}: AppEnvDialogProps) {
  const [status, setStatus] = useState<AppEnvStatus | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load env requirements
  useEffect(() => {
    invoke<AppEnvStatus>('get_app_env_requirements', { appPath })
      .then(setStatus)
      .catch((e) => setError(String(e)))
  }, [appPath])

  const handleOpenUrl = useCallback(async (url: string) => {
    await open(url)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)

    try {
      // Save each env var
      for (const [key, value] of Object.entries(values)) {
        if (value.trim()) {
          await invoke('set_app_env_var', { key, value: value.trim() })
        }
      }

      // Check if all required vars are now set
      const newStatus = await invoke<AppEnvStatus>('get_app_env_requirements', {
        appPath,
      })

      if (newStatus.missing.length === 0) {
        onComplete()
      } else {
        setStatus(newStatus)
        setError(`Still missing required keys: ${newStatus.missing.join(', ')}`)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [values, appPath, onComplete])

  const handleSkip = useCallback(() => {
    // Allow skipping if no required keys are missing
    if (status && status.missing.length === 0) {
      onComplete()
    } else {
      onClose()
    }
  }, [status, onComplete, onClose])

  if (!status) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="border-border bg-card mx-4 flex w-full max-w-md items-center justify-center rounded-xl border p-8 shadow-2xl">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      </div>
    )
  }

  // Filter to show only requirements that aren't already set
  const pendingRequirements = status.requirements.filter(
    (req) => !status.present.includes(req.key),
  )

  if (pendingRequirements.length === 0) {
    // All set, auto-complete
    onComplete()
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="border-border bg-card mx-4 w-full max-w-md rounded-xl border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
              <Key className="size-5" />
            </div>
            <div>
              <h2 className="font-semibold">Configure {appName}</h2>
              <p className="text-muted-foreground text-sm">
                Add API keys to enable all features
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-6">
          {pendingRequirements.map((req) => (
            <div key={req.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {req.name}
                  {req.required && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </label>
                {req.url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto cursor-pointer px-2 py-1 text-xs"
                    onClick={() => handleOpenUrl(req.url!)}
                  >
                    <ExternalLink className="mr-1 size-3" />
                    Get key
                  </Button>
                )}
              </div>
              {req.description && (
                <p className="text-muted-foreground text-xs">
                  {req.description}
                </p>
              )}
              <Input
                type="password"
                placeholder={`Enter ${req.key}`}
                value={values[req.key] || ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [req.key]: e.target.value }))
                }
                className="font-mono text-sm"
              />
            </div>
          ))}

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t px-6 py-4">
          <Button
            variant="outline"
            className="flex-1 cursor-pointer"
            onClick={handleSkip}
          >
            {status.missing.length === 0 ? 'Skip optional' : 'Cancel'}
          </Button>
          <Button
            className="flex-1 cursor-pointer"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Save & Continue
          </Button>
        </div>
      </div>
    </div>
  )
}
