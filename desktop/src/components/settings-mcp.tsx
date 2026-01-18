import {
  ChevronDown,
  Loader2,
  Package,
  Pencil,
  Plug,
  Plus,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  ScrollArea,
  Switch,
  Textarea,
  cn,
} from '@moldable-ai/ui'
import { getCurrentWindow } from '@tauri-apps/api/window'

const DEFAULT_AI_SERVER_PORT = 39100

interface McpServerConfig {
  type?: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
  [key: string]: unknown
}

interface McpServerInfo {
  name: string
  config: McpServerConfig
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  tools: Array<{ name: string; description?: string }>
}

interface SettingsMcpProps {
  /** AI server port (may be fallback port if default was unavailable) */
  aiServerPort?: number
}

// Server row with expandable tools
function ServerRow({
  server,
  onEdit,
  onDelete,
  onToggle,
  disabled,
}: {
  server: McpServerInfo
  onEdit: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
  disabled?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const isEnabled = !server.config.disabled
  const isConnected = server.status === 'connected'
  const toolCount = server.tools.length

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="bg-muted/30 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2.5">
          {/* Avatar */}
          <div className="relative">
            <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium uppercase">
              {server.name.charAt(0)}
            </div>
            {isEnabled && (
              <div
                className={cn(
                  'border-background absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2',
                  isConnected ? 'bg-green-500' : 'bg-muted-foreground',
                )}
              />
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium">{server.name}</span>
            <CollapsibleTrigger
              className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs"
              disabled={!isEnabled || (toolCount === 0 && !server.error)}
            >
              {!isEnabled ? (
                <span>Disabled</span>
              ) : isConnected ? (
                <>
                  <span>
                    {toolCount} tool{toolCount !== 1 ? 's' : ''} enabled
                  </span>
                  {toolCount > 0 && (
                    <ChevronDown
                      className={cn(
                        'size-3 transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    />
                  )}
                </>
              ) : server.status === 'error' ? (
                <>
                  <span className="text-destructive">Error</span>
                  {server.error && (
                    <ChevronDown
                      className={cn(
                        'text-destructive size-3 transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    />
                  )}
                </>
              ) : (
                <span>Disconnected</span>
              )}
            </CollapsibleTrigger>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="size-7 cursor-pointer p-0"
              onClick={onEdit}
              disabled={disabled}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive size-7 cursor-pointer p-0"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Switch
              checked={isEnabled}
              onCheckedChange={onToggle}
              className="ml-1 cursor-pointer"
            />
          </div>
        </div>

        {/* Expanded tools or error */}
        <CollapsibleContent>
          {server.error ? (
            <div className="bg-destructive/10 text-destructive mt-2 break-all rounded-md px-2 py-1.5 font-mono text-[11px]">
              {server.error}
            </div>
          ) : (
            <ScrollArea className="mt-2 max-h-48">
              <div className="flex flex-wrap gap-1">
                {server.tools.map((tool) => (
                  <span
                    key={tool.name}
                    className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]"
                    title={tool.description}
                  >
                    {tool.name}
                  </span>
                ))}
              </div>
            </ScrollArea>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground mt-2 flex cursor-pointer items-center gap-1 text-xs"
            onClick={() => setIsOpen(false)}
          >
            Show less
            <ChevronDown className="size-3 rotate-180" />
          </button>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function SettingsMcp({
  aiServerPort = DEFAULT_AI_SERVER_PORT,
}: SettingsMcpProps) {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Build AI server URL with dynamic port
  const AI_SERVER_URL = useMemo(
    () => `http://127.0.0.1:${aiServerPort}`,
    [aiServerPort],
  )
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Form state
  const [newName, setNewName] = useState('')
  const [configJson, setConfigJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installStatus, setInstallStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  const fetchServers = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${AI_SERVER_URL}/api/mcp/servers`)
      if (!response.ok) throw new Error('Failed to fetch servers')
      const data = await response.json()
      setServers(data.servers || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch servers')
    } finally {
      setIsLoading(false)
    }
  }, [AI_SERVER_URL])

  const reloadServers = useCallback(async () => {
    try {
      await fetch(`${AI_SERVER_URL}/api/mcp/reload`, { method: 'POST' })
      await fetchServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload')
    }
  }, [AI_SERVER_URL, fetchServers])

  useEffect(() => {
    fetchServers()
    resetForm()
  }, [fetchServers])

  const resetForm = () => {
    setShowAddForm(false)
    setEditingServer(null)
    setNewName('')
    setConfigJson('')
    setJsonError(null)
  }

  const startEditing = (server: McpServerInfo) => {
    // Remove disabled from config for display (it's managed by toggle)
    const { disabled: _, ...configWithoutDisabled } = server.config
    setEditingServer(server.name)
    setConfigJson(JSON.stringify(configWithoutDisabled, null, 2))
    setJsonError(null)
    setShowAddForm(false)
  }

  const startAdding = () => {
    setShowAddForm(true)
    setEditingServer(null)
    setNewName('')
    setConfigJson(
      JSON.stringify(
        {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-example'],
        },
        null,
        2,
      ),
    )
    setJsonError(null)
  }

  const validateJson = (json: string): McpServerConfig | null => {
    try {
      const parsed = JSON.parse(json)
      if (typeof parsed !== 'object' || parsed === null) {
        setJsonError('Config must be an object')
        return null
      }
      setJsonError(null)
      return parsed
    } catch {
      setJsonError('Invalid JSON')
      return null
    }
  }

  const handleSave = async () => {
    const config = validateJson(configJson)
    if (!config) return

    if (showAddForm && !newName.trim()) {
      setError('Server name is required')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      if (editingServer) {
        // Update existing
        const response = await fetch(
          `${AI_SERVER_URL}/api/mcp/servers/${encodeURIComponent(editingServer)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config }),
          },
        )
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update')
        }
      } else {
        // Add new
        const response = await fetch(`${AI_SERVER_URL}/api/mcp/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim(), config }),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to add')
        }
      }

      resetForm()
      await reloadServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteServer = async (name: string) => {
    try {
      const response = await fetch(
        `${AI_SERVER_URL}/api/mcp/servers/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) throw new Error('Failed to delete')
      setDeleteTarget(null)
      await reloadServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleToggleServer = async (name: string, enabled: boolean) => {
    try {
      const response = await fetch(
        `${AI_SERVER_URL}/api/mcp/servers/${encodeURIComponent(name)}/toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
      )
      if (!response.ok) throw new Error('Failed to toggle')
      await reloadServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle')
    }
  }

  // Install bundle from file path
  const installBundle = useCallback(
    async (bundlePath: string) => {
      setIsInstalling(true)
      setInstallStatus(null)

      try {
        const response = await fetch(
          `${AI_SERVER_URL}/api/mcp/install-bundle`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bundlePath }),
          },
        )

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to install bundle')
        }

        setInstallStatus({
          type: 'success',
          message: `Installed "${data.name}" successfully`,
        })

        await reloadServers()
      } catch (err) {
        setInstallStatus({
          type: 'error',
          message:
            err instanceof Error ? err.message : 'Failed to install bundle',
        })
      } finally {
        setIsInstalling(false)
      }
    },
    [AI_SERVER_URL, reloadServers],
  )

  // Listen for Tauri window drag-drop events
  useEffect(() => {
    const window = getCurrentWindow()
    const unlisten = window.onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        setIsDragging(true)
      } else if (event.payload.type === 'leave') {
        setIsDragging(false)
      } else if (event.payload.type === 'drop') {
        setIsDragging(false)
        const paths = event.payload.paths
        const bundlePath = paths.find(
          (p) => p.endsWith('.mcpb') || p.endsWith('.zip'),
        )
        if (bundlePath) {
          installBundle(bundlePath)
        } else if (paths.length > 0) {
          setInstallStatus({
            type: 'error',
            message: 'Please drop an .mcpb or .zip file',
          })
        }
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [installBundle])

  // Clear install status after a delay
  useEffect(() => {
    if (installStatus) {
      const timer = setTimeout(() => setInstallStatus(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [installStatus])

  const isEditing = showAddForm || editingServer

  return (
    <>
      <div className="relative flex flex-col gap-6">
        {/* Drag overlay */}
        {(isDragging || isInstalling) && (
          <div className="bg-background/95 border-primary absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg border-2 border-dashed">
            {isInstalling ? (
              <>
                <Loader2 className="text-primary mb-2 size-8 animate-spin" />
                <p className="text-sm font-medium">Installing bundle...</p>
              </>
            ) : (
              <>
                <Package className="text-primary mb-2 size-8" />
                <p className="text-sm font-medium">
                  Drop MCPB bundle to install
                </p>
                <p className="text-muted-foreground text-xs">
                  .mcpb or .zip files
                </p>
              </>
            )}
          </div>
        )}

        <div>
          <h2 className="text-base font-semibold">MCP Servers</h2>
          <p className="text-muted-foreground text-xs">
            Configure Model Context Protocol servers for extended AI
            capabilities
          </p>
        </div>

        {/* Error */}
        {error && <p className="text-destructive text-xs">{error}</p>}

        {/* Install status */}
        {installStatus && (
          <div
            className={cn(
              'rounded-md px-3 py-2 text-xs',
              installStatus.type === 'success'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            {installStatus.message}
          </div>
        )}

        {/* Edit/Add form */}
        {isEditing && (
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="mb-3 text-sm font-medium">
              {editingServer ? `Edit "${editingServer}"` : 'New Server'}
            </p>

            {showAddForm && (
              <Input
                placeholder="Server name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={isSaving}
                className="mb-3 h-9"
                autoFocus
              />
            )}

            <Textarea
              value={configJson}
              onChange={(e) => {
                setConfigJson(e.target.value)
                validateJson(e.target.value)
              }}
              disabled={isSaving}
              rows={8}
              className="resize-none font-mono text-xs"
              placeholder='{"command": "npx", "args": ["-y", "..."]}'
            />
            {jsonError && (
              <p className="text-destructive mt-1 text-xs">{jsonError}</p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !!jsonError}
                className="cursor-pointer"
              >
                {isSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetForm}
                disabled={isSaving}
                className="cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Add button */}
        {!isEditing && (
          <Button
            variant="outline"
            size="sm"
            onClick={startAdding}
            className="w-fit cursor-pointer"
          >
            <Plus className="mr-1.5 size-3.5" />
            Add Server
          </Button>
        )}

        {/* Server list */}
        <div>
          <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium">
            Installed MCP Servers
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : servers.length === 0 ? (
            <div className="bg-muted/30 rounded-lg py-8 text-center">
              <Plug className="text-muted-foreground mx-auto mb-2 size-6" />
              <p className="text-muted-foreground text-xs">
                No MCP servers configured
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <ServerRow
                  key={server.name}
                  server={server}
                  onEdit={() => startEditing(server)}
                  onDelete={() => setDeleteTarget(server.name)}
                  onToggle={(enabled) =>
                    handleToggleServer(server.name, enabled)
                  }
                  disabled={!!editingServer}
                />
              ))}
            </div>
          )}
        </div>

        <p className="text-muted-foreground text-center text-xs">
          📦 Drag an MCP bundle file here to install it
        </p>
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete server?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &ldquo;{deleteTarget}&rdquo; from your MCP
              configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDeleteServer(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
