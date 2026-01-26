'use client'

import {
  BookOpen,
  Download,
  ExternalLink,
  Loader2,
  Pencil,
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
  Input,
  ScrollArea,
  cn,
} from '@moldable-ai/ui'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { toast } from 'sonner'

const DEFAULT_AI_SERVER_PORT = 39200
const SKILLS_SITE_URL = 'https://skills.sh'

interface SkillRepoInfo {
  name: string
  url: string
  enabled: boolean
  mode: 'all' | 'include' | 'exclude'
  skills: string[]
  lastSync?: string
  installedSkills?: string[]
}

interface SettingsSkillsProps {
  /** AI server port (may be fallback port if default was unavailable) */
  aiServerPort?: number
}

const getRepoId = (repo: SkillRepoInfo) => repo.url || repo.name

function normalizeRepoInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const directMatch = trimmed.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?$/,
  )
  if (directMatch) {
    return `${directMatch[1]}/${directMatch[2]}`
  }

  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    const host = url.hostname.toLowerCase()
    const segments = url.pathname.split('/').filter(Boolean)
    const cleanRepo = (repo: string) => repo.replace(/\.git$/, '')

    if (host === 'github.com' || host.endsWith('.github.com')) {
      if (segments.length >= 2) {
        return `${segments[0]}/${cleanRepo(segments[1])}`
      }
    }

    if (host === 'skills.sh' || host.endsWith('.skills.sh')) {
      const offset = segments[0] === 'skills' ? 1 : 0
      if (segments.length >= offset + 2) {
        return `${segments[offset]}/${cleanRepo(segments[offset + 1])}`
      }
    }
  } catch {
    return null
  }

  return null
}

function formatLastSync(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export function SettingsSkills({
  aiServerPort = DEFAULT_AI_SERVER_PORT,
}: SettingsSkillsProps) {
  const [repos, setRepos] = useState<SkillRepoInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [repoInput, setRepoInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillRepoInfo | null>(null)
  const [syncingRepo, setSyncingRepo] = useState<string | null>(null)
  const [isSyncingAll, setIsSyncingAll] = useState(false)
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null)
  const [availableSkills, setAvailableSkills] = useState<
    Record<string, string[]>
  >({})
  const [selectedSkills, setSelectedSkills] = useState<
    Record<string, string[]>
  >({})
  const [selectionErrors, setSelectionErrors] = useState<
    Record<string, string | null>
  >({})
  const [isLoadingSkills, setIsLoadingSkills] = useState<
    Record<string, boolean>
  >({})
  const [isSavingSelection, setIsSavingSelection] = useState<
    Record<string, boolean>
  >({})

  const AI_SERVER_URL = useMemo(
    () => `http://127.0.0.1:${aiServerPort}`,
    [aiServerPort],
  )

  const fetchRepos = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`${AI_SERVER_URL}/api/skills/repos`)
      const data = await response.json()

      if (!response.ok || data.success === false) {
        if (!data?.error?.includes('No skills config')) {
          toast.error(data.error || 'Failed to load skills')
        }
      }

      setRepos(data.repositories || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load skills')
    } finally {
      setIsLoading(false)
    }
  }, [AI_SERVER_URL])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const loadRepoSkills = useCallback(
    async (repoId: string) => {
      setIsLoadingSkills((prev) => ({ ...prev, [repoId]: true }))
      try {
        const response = await fetch(
          `${AI_SERVER_URL}/api/skills/repos/${encodeURIComponent(repoId)}/available`,
        )
        const data = await response.json()

        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'Failed to load skills')
        }

        setAvailableSkills((prev) => ({
          ...prev,
          [repoId]: data.available || [],
        }))
        setSelectedSkills((prev) => ({
          ...prev,
          [repoId]: data.selected || [],
        }))
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to load skills',
        )
      } finally {
        setIsLoadingSkills((prev) => ({ ...prev, [repoId]: false }))
      }
    },
    [AI_SERVER_URL],
  )

  const handleToggleManage = useCallback(
    async (repoId: string) => {
      if (expandedRepo === repoId) {
        setExpandedRepo(null)
        return
      }

      setExpandedRepo(repoId)
      if (!availableSkills[repoId]) {
        await loadRepoSkills(repoId)
      }
    },
    [availableSkills, expandedRepo, loadRepoSkills],
  )

  const handleSyncRepo = useCallback(
    async (repoId: string) => {
      setSyncingRepo(repoId)
      try {
        const response = await fetch(`${AI_SERVER_URL}/api/skills/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoName: repoId }),
        })
        const data = await response.json()
        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'Failed to sync skills')
        }
        toast.success(`Synced ${data.synced || 0} skills from ${repoId}`)
        await fetchRepos()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to sync skills',
        )
      } finally {
        setSyncingRepo(null)
      }
    },
    [AI_SERVER_URL, fetchRepos],
  )

  const handleToggleSkill = useCallback(
    async (repoId: string, skill: string) => {
      const current = selectedSkills[repoId] || []
      const next = current.includes(skill)
        ? current.filter((item) => item !== skill)
        : [...current, skill]
      const sortedNext = [...next].sort((a, b) => a.localeCompare(b))

      setSelectedSkills((prev) => ({ ...prev, [repoId]: sortedNext }))
      setIsSavingSelection((prev) => ({ ...prev, [repoId]: true }))
      setSelectionErrors((prev) => ({ ...prev, [repoId]: null }))

      try {
        const response = await fetch(
          `${AI_SERVER_URL}/api/skills/repos/${encodeURIComponent(repoId)}/selection`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'include',
              skills: sortedNext,
            }),
          },
        )
        const data = await response.json()

        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'Failed to update selection')
        }

        setRepos((prev) =>
          prev.map((repo) =>
            getRepoId(repo) === repoId
              ? {
                  ...repo,
                  mode: data.mode || 'include',
                  skills: data.skills || sortedNext,
                }
              : repo,
          ),
        )
        if (!current.includes(skill)) {
          void handleSyncRepo(repoId)
        }
      } catch (err) {
        setSelectedSkills((prev) => ({ ...prev, [repoId]: current }))
        setSelectionErrors((prev) => ({
          ...prev,
          [repoId]:
            err instanceof Error ? err.message : 'Failed to update selection',
        }))
      } finally {
        setIsSavingSelection((prev) => ({ ...prev, [repoId]: false }))
      }
    },
    [AI_SERVER_URL, handleSyncRepo, selectedSkills],
  )

  const handleAddRepo = useCallback(async () => {
    const normalized = normalizeRepoInput(repoInput)
    if (!normalized) {
      toast.error(
        'Enter a GitHub repo (owner/repo) or a skills.sh link to install.',
      )
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`${AI_SERVER_URL}/api/skills/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized, sync: true }),
      })

      const data = await response.json()

      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Failed to add skill repo')
      }

      const syncInfo = data.sync
      const syncSuffix = syncInfo
        ? ` (${syncInfo.synced || 0} synced${syncInfo.failed ? `, ${syncInfo.failed} failed` : ''})`
        : ''

      toast.success(`Installed ${data.name || normalized}${syncSuffix}`)
      setRepoInput('')
      setShowAddForm(false)
      await fetchRepos()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to install skill',
      )
    } finally {
      setIsSaving(false)
    }
  }, [AI_SERVER_URL, fetchRepos, repoInput])

  const handleSyncAll = useCallback(async () => {
    setIsSyncingAll(true)
    try {
      const response = await fetch(`${AI_SERVER_URL}/api/skills/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Failed to sync skills')
      }
      toast.success(`Synced ${data.synced || 0} skills`)
      await fetchRepos()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync skills')
    } finally {
      setIsSyncingAll(false)
    }
  }, [AI_SERVER_URL, fetchRepos])

  const handleRemoveRepo = useCallback(
    async (repoId: string) => {
      try {
        const response = await fetch(
          `${AI_SERVER_URL}/api/skills/repos/${encodeURIComponent(repoId)}`,
          { method: 'DELETE' },
        )
        const data = await response.json()
        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'Failed to remove skill repo')
        }
        toast.success(`Removed ${data.name || repoId}`)
        setDeleteTarget(null)
        await fetchRepos()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to remove skill',
        )
      }
    },
    [AI_SERVER_URL, fetchRepos],
  )

  const handleOpenSkillsSite = useCallback(async () => {
    await openUrl(SKILLS_SITE_URL)
  }, [])

  const isEditing = showAddForm

  return (
    <>
      <div className="relative flex flex-col gap-6">
        <div>
          <h2 className="text-base font-semibold">Skills</h2>
          <p className="text-muted-foreground text-xs">
            Install shared skills for all workspaces. Skills live in
            ~/.moldable/shared/skills.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenSkillsSite}
            className="cursor-pointer"
          >
            <ExternalLink className="mr-1.5 size-3.5" />
            Browse skills.sh
          </Button>
          <span className="text-muted-foreground text-xs">
            Install using GitHub owner/repo or a skills.sh link.
          </span>
        </div>

        {isEditing && (
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="mb-3 text-sm font-medium">Add Skill Repository</p>
            <Input
              placeholder="owner/repo or https://skills.sh/owner/repo"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddRepo()
                }
                if (e.key === 'Escape') {
                  setShowAddForm(false)
                }
              }}
              disabled={isSaving}
              className="h-9"
              autoFocus
            />
            <p className="text-muted-foreground mt-2 text-xs">
              Equivalent to running{' '}
              <code className="font-mono">npx skills add owner/repo</code>.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleAddRepo}
                disabled={isSaving}
                className="cursor-pointer"
              >
                {isSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                Install
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddForm(false)}
                disabled={isSaving}
                className="cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!isEditing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(true)}
            className="w-fit cursor-pointer"
          >
            <Plus className="mr-1.5 size-3.5" />
            Add Skill Repository
          </Button>
        )}

        <div>
          <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
            <span>Installed Skill Repositories</span>
            {repos.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncAll}
                disabled={isSyncingAll}
                className="h-7 cursor-pointer px-2"
              >
                {isSyncingAll ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <Download className="mr-1 size-3" />
                )}
                Sync All
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : repos.length === 0 ? (
            <div className="bg-muted/30 rounded-lg py-8 text-center">
              <BookOpen className="text-muted-foreground mx-auto mb-2 size-6" />
              <p className="text-muted-foreground text-xs">
                No skill repositories installed
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {repos.map((repo) => {
                const repoId = getRepoId(repo)
                const lastSyncText = formatLastSync(repo.lastSync)
                const isExpanded = expandedRepo === repoId
                const availableList = [...(availableSkills[repoId] || [])].sort(
                  (a, b) => a.localeCompare(b),
                )
                const isRepoSyncing = syncingRepo === repoId
                const displaySkills =
                  repo.mode === 'include'
                    ? repo.skills
                    : repo.mode === 'exclude'
                      ? repo.skills
                      : []
                const rawSelectionList =
                  selectedSkills[repoId] ??
                  (repo.mode === 'include' ? repo.skills : [])
                const selectionList = [...rawSelectionList].sort((a, b) =>
                  a.localeCompare(b),
                )
                const isLoadingSelection = isLoadingSkills[repoId]
                const isSavingRepoSelection = isSavingSelection[repoId]
                const selectionError = selectionErrors[repoId]
                const selectionLabel =
                  repo.mode === 'exclude'
                    ? 'Excluded skills'
                    : 'Selected skills'

                return (
                  <div
                    key={repoId}
                    className="bg-muted/30 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium uppercase">
                        {repo.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{repo.name}</span>
                        <div className="text-muted-foreground truncate font-mono text-[11px]">
                          {repo.url}
                        </div>
                        <div className="text-muted-foreground text-[10px]">
                          {repo.enabled ? 'Enabled' : 'Disabled'} - Mode:{' '}
                          {repo.mode}
                          {repo.mode !== 'all' && repo.skills.length > 0
                            ? ` (${repo.skills.length})`
                            : ''}
                          {lastSyncText ? ` - Last synced ${lastSyncText}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'size-7 cursor-pointer p-0',
                            isExpanded && 'bg-muted',
                          )}
                          onClick={() => handleToggleManage(repoId)}
                          disabled={!repo.enabled}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 cursor-pointer p-0"
                          onClick={() => handleSyncRepo(repoId)}
                          disabled={!repo.enabled || syncingRepo === repoId}
                        >
                          {syncingRepo === repoId ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Download className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive size-7 cursor-pointer p-0"
                          onClick={() => setDeleteTarget(repo)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {repo.mode === 'all' ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        All skills are selected for this repository.
                      </p>
                    ) : displaySkills.length > 0 ? (
                      <ScrollArea className="mt-2 max-h-32">
                        <div className="flex flex-wrap gap-1">
                          {displaySkills.map((skill) => (
                            <span
                              key={skill}
                              className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <p className="text-muted-foreground mt-2 text-xs">
                        {selectionLabel} will appear here once configured.
                      </p>
                    )}

                    {isExpanded && (
                      <div className="border-border bg-background/60 mt-3 rounded-md border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium">
                              Select skills to sync
                            </p>
                            <p className="text-muted-foreground text-[10px]">
                              Click to toggle. Changes sync automatically.
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-[10px]">
                            {isSavingRepoSelection ? (
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Loader2 className="size-3 animate-spin" />
                                Saving...
                              </span>
                            ) : isRepoSyncing ? (
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Loader2 className="size-3 animate-spin" />
                                Syncing...
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {availableList.length} available
                              </span>
                            )}
                          </div>
                        </div>

                        {selectionError && (
                          <p className="text-destructive mb-2 text-[11px]">
                            {selectionError}
                          </p>
                        )}

                        {isLoadingSelection ? (
                          <div className="flex items-center gap-2 py-2">
                            <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
                            <span className="text-muted-foreground text-[11px]">
                              Loading skills...
                            </span>
                          </div>
                        ) : availableList.length === 0 ? (
                          <p className="text-muted-foreground text-[11px]">
                            No skills found in this repository.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {availableList.map((skill) => {
                              const isSelected = selectionList.includes(skill)
                              const isDisabled =
                                !repo.enabled || isSavingRepoSelection

                              return (
                                <button
                                  key={skill}
                                  type="button"
                                  onClick={() =>
                                    handleToggleSkill(repoId, skill)
                                  }
                                  disabled={isDisabled}
                                  className={cn(
                                    'rounded px-2 py-1 font-mono text-[11px] transition-colors',
                                    'cursor-pointer',
                                    isSelected
                                      ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                      : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70',
                                    isDisabled &&
                                      'cursor-not-allowed opacity-60',
                                  )}
                                >
                                  {skill}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove skill repository?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{' '}
              <strong>{deleteTarget?.name || 'this repo'}</strong> and delete
              its synced skills from disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && handleRemoveRepo(getRepoId(deleteTarget))
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
