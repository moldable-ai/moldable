import {
  Download,
  Key,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  cn,
  useTheme,
} from '@moldable-ai/ui'
import { type DangerousPattern } from '../hooks/use-workspace-config'
import { SettingsApiKeys } from './settings-api-keys'
import { SettingsDeveloper } from './settings-developer'
import { SettingsGeneral } from './settings-general'
import { SettingsLogs } from './settings-logs'
import { SettingsMcp } from './settings-mcp'
import { SettingsSecurity } from './settings-security'

type SettingsSection =
  | 'general'
  | 'security'
  | 'api-keys'
  | 'mcp'
  | 'developer'
  | 'logs'
  | 'updates'

interface NavItem {
  id: SettingsSection
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  {
    id: 'general',
    label: 'General',
    icon: <SettingsIcon className="size-4" />,
  },
  { id: 'security', label: 'Security', icon: <Shield className="size-4" /> },
  { id: 'api-keys', label: 'API Keys', icon: <Key className="size-4" /> },
  { id: 'mcp', label: 'MCP Servers', icon: <Plug className="size-4" /> },
  {
    id: 'developer',
    label: 'Developer',
    icon: <Terminal className="size-4" />,
  },
  { id: 'logs', label: 'System Logs', icon: <ScrollText className="size-4" /> },
  { id: 'updates', label: 'Updates', icon: <Download className="size-4" /> },
]

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when API keys change to refresh health status */
  onHealthRefresh?: () => void
  /** AI server port (may be fallback port if default was unavailable) */
  aiServerPort?: number
  /** Current unsandboxed approval preference */
  requireUnsandboxedApproval: boolean
  /** Callback to update unsandboxed approval preference */
  onRequireUnsandboxedApprovalChange: (value: boolean) => void
  /** Current dangerous command approval preference */
  requireDangerousCommandApproval: boolean
  /** Callback to update dangerous command approval preference */
  onRequireDangerousCommandApprovalChange: (value: boolean) => void
  /** Custom dangerous command patterns */
  customDangerousPatterns: DangerousPattern[]
  /** Callback to update custom dangerous patterns */
  onCustomDangerousPatternsChange: (patterns: DangerousPattern[]) => void
}

export function SettingsDialog({
  open,
  onOpenChange,
  onHealthRefresh,
  aiServerPort,
  requireUnsandboxedApproval,
  onRequireUnsandboxedApprovalChange,
  requireDangerousCommandApproval,
  onRequireDangerousCommandApprovalChange,
  customDangerousPatterns,
  onCustomDangerousPatternsChange,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-h-[85vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0">
        {/* Header */}
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-6 py-4">
          <SettingsIcon className="size-5" />
          <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar navigation */}
          <aside className="border-border w-40 shrink-0 border-r p-2">
            <nav className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    activeSection === item.id
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Right content area */}
          <main className="flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable]">
            <div className="mx-auto max-w-xl">
              {activeSection === 'general' && (
                <SettingsGeneral
                  theme={theme}
                  resolvedTheme={resolvedTheme}
                  onThemeChange={setTheme}
                />
              )}

              {activeSection === 'security' && (
                <SettingsSecurity
                  requireUnsandboxedApproval={requireUnsandboxedApproval}
                  onRequireUnsandboxedApprovalChange={
                    onRequireUnsandboxedApprovalChange
                  }
                  requireDangerousCommandApproval={
                    requireDangerousCommandApproval
                  }
                  onRequireDangerousCommandApprovalChange={
                    onRequireDangerousCommandApprovalChange
                  }
                  customDangerousPatterns={customDangerousPatterns}
                  onCustomDangerousPatternsChange={
                    onCustomDangerousPatternsChange
                  }
                />
              )}

              {activeSection === 'api-keys' && (
                <SettingsApiKeys onKeysChanged={onHealthRefresh} />
              )}

              {activeSection === 'mcp' && (
                <SettingsMcp aiServerPort={aiServerPort} />
              )}

              {activeSection === 'developer' && <SettingsDeveloper />}

              {activeSection === 'logs' && <SettingsLogs />}

              {activeSection === 'updates' && <SettingsUpdates />}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SettingsUpdates() {
  const { checking, checkForUpdate } = useAppUpdateForSettings()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Updates</h2>
        <p className="text-muted-foreground text-xs">
          Check for and install application updates
        </p>
      </div>

      <div className="bg-muted/30 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Check for Updates</p>
            <p className="text-muted-foreground text-xs">
              See if a new version of Moldable is available
            </p>
          </div>
          <button
            onClick={checkForUpdate}
            disabled={checking}
            className={cn(
              'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors',
              checking && 'cursor-not-allowed opacity-50',
            )}
          >
            {checking ? 'Checking...' : 'Check Now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Simple hook wrapper for updates in settings context
function useAppUpdateForSettings() {
  const [checking, setChecking] = useState(false)

  const checkForUpdate = async () => {
    setChecking(true)
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        const { toast } = await import('sonner')
        toast.success(`Update available: v${update.version}`, {
          description: 'Check the notification in the bottom left corner.',
        })
      } else {
        const { toast } = await import('sonner')
        toast.success("You're on the latest version")
      }
    } catch (error) {
      console.error('Failed to check for updates:', error)
      const { toast } = await import('sonner')
      toast.error('Failed to check for updates')
    } finally {
      setChecking(false)
    }
  }

  return { checking, checkForUpdate }
}
