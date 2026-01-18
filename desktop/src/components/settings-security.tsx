import { AlertTriangle, Plus, Shield, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from '@moldable-ai/ui'
import {
  DEFAULT_DANGEROUS_PATTERNS,
  type DangerousPattern,
} from '../hooks/use-workspace-config'

interface SettingsSecurityProps {
  requireUnsandboxedApproval: boolean
  onRequireUnsandboxedApprovalChange: (value: boolean) => void
  requireDangerousCommandApproval: boolean
  onRequireDangerousCommandApprovalChange: (value: boolean) => void
  customDangerousPatterns: DangerousPattern[]
  onCustomDangerousPatternsChange: (patterns: DangerousPattern[]) => void
}

export function SettingsSecurity({
  requireUnsandboxedApproval,
  onRequireUnsandboxedApprovalChange,
  requireDangerousCommandApproval,
  onRequireDangerousCommandApprovalChange,
  customDangerousPatterns,
  onCustomDangerousPatternsChange,
}: SettingsSecurityProps) {
  const [isAddPatternOpen, setIsAddPatternOpen] = useState(false)
  const [newPattern, setNewPattern] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [patternError, setPatternError] = useState<string | null>(null)

  const handleAddPattern = () => {
    // Validate regex
    try {
      new RegExp(newPattern)
    } catch {
      setPatternError('Invalid regex pattern')
      return
    }

    if (!newPattern.trim()) {
      setPatternError('Pattern is required')
      return
    }

    if (!newDescription.trim()) {
      setPatternError('Description is required')
      return
    }

    // Check for duplicates
    const allPatterns = [
      ...DEFAULT_DANGEROUS_PATTERNS,
      ...customDangerousPatterns,
    ]
    if (allPatterns.some((p) => p.pattern === newPattern)) {
      setPatternError('This pattern already exists')
      return
    }

    onCustomDangerousPatternsChange([
      ...customDangerousPatterns,
      { pattern: newPattern, description: newDescription.trim() },
    ])

    setNewPattern('')
    setNewDescription('')
    setPatternError(null)
    setIsAddPatternOpen(false)
  }

  const handleRemovePattern = (pattern: string) => {
    onCustomDangerousPatternsChange(
      customDangerousPatterns.filter((p) => p.pattern !== pattern),
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Security</h2>
        <p className="text-muted-foreground text-xs">
          Configure approval requirements for potentially dangerous operations
        </p>
      </div>

      {/* Unsandboxed commands approval */}
      <section className="flex flex-col gap-3">
        <div className="bg-muted/30 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="bg-muted mt-0.5 flex size-6 shrink-0 items-center justify-center rounded">
                <Shield className="text-muted-foreground size-3.5" />
              </div>
              <div>
                <p className="text-sm font-medium">Unsandboxed Commands</p>
                <p className="text-muted-foreground text-xs">
                  Require approval before running commands without sandbox
                  protection (e.g., package installs).
                </p>
              </div>
            </div>
            <Switch
              checked={requireUnsandboxedApproval}
              onCheckedChange={onRequireUnsandboxedApprovalChange}
              className="cursor-pointer"
            />
          </div>
        </div>
      </section>

      {/* Dangerous commands approval */}
      <section className="flex flex-col gap-3">
        <div className="bg-muted/30 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="bg-muted mt-0.5 flex size-6 shrink-0 items-center justify-center rounded">
                <AlertTriangle className="text-muted-foreground size-3.5" />
              </div>
              <div>
                <p className="text-sm font-medium">Dangerous Commands</p>
                <p className="text-muted-foreground text-xs">
                  Require approval for destructive commands like{' '}
                  <code className="bg-muted rounded px-1 text-[10px]">
                    rm -rf
                  </code>
                  ,{' '}
                  <code className="bg-muted rounded px-1 text-[10px]">
                    sudo
                  </code>
                  , or{' '}
                  <code className="bg-muted rounded px-1 text-[10px]">
                    git push --force
                  </code>
                  .
                </p>
              </div>
            </div>
            <Switch
              checked={requireDangerousCommandApproval}
              onCheckedChange={onRequireDangerousCommandApprovalChange}
              className="cursor-pointer"
            />
          </div>
        </div>

        {/* Pattern list */}
        {requireDangerousCommandApproval && (
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs">
                Commands matching these patterns will require approval
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddPatternOpen(true)}
                className="h-7 cursor-pointer gap-1 px-2 text-xs"
              >
                <Plus className="size-3" />
                Add
              </Button>
            </div>

            {/* Custom patterns */}
            {customDangerousPatterns.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-muted-foreground px-1 text-[10px] font-medium uppercase tracking-wider">
                  Custom
                </p>
                <div className="divide-border/50 divide-y rounded-md border">
                  {customDangerousPatterns.map((p) => (
                    <PatternItem
                      key={p.pattern}
                      pattern={p.pattern}
                      description={p.description}
                      onRemove={() => handleRemovePattern(p.pattern)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Built-in patterns */}
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground px-1 text-[10px] font-medium uppercase tracking-wider">
                Built-in
              </p>
              <div className="divide-border/50 divide-y rounded-md border">
                {DEFAULT_DANGEROUS_PATTERNS.map((p) => (
                  <PatternItem
                    key={p.pattern}
                    pattern={p.pattern}
                    description={p.description}
                    isBuiltIn
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Add pattern dialog */}
      <Dialog open={isAddPatternOpen} onOpenChange={setIsAddPatternOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Dangerous Command Pattern</DialogTitle>
            <DialogDescription>
              Add a regex pattern to match commands that should require
              approval.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Regex Pattern</label>
              <Input
                value={newPattern}
                onChange={(e) => {
                  setNewPattern(e.target.value)
                  setPatternError(null)
                }}
                placeholder="e.g., \\bkubectl\\s+delete\\b"
                className="font-mono text-sm"
              />
              <p className="text-muted-foreground text-xs">
                Use JavaScript regex syntax. Remember to escape backslashes.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={newDescription}
                onChange={(e) => {
                  setNewDescription(e.target.value)
                  setPatternError(null)
                }}
                placeholder="e.g., Kubernetes delete operations"
              />
            </div>

            {patternError && (
              <p className="text-destructive text-sm">{patternError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddPatternOpen(false)
                setNewPattern('')
                setNewDescription('')
                setPatternError(null)
              }}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button onClick={handleAddPattern} className="cursor-pointer">
              Add Pattern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PatternItem({
  pattern,
  description,
  isBuiltIn,
  onRemove,
}: {
  pattern: string
  description: string
  isBuiltIn?: boolean
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs">{description}</p>
        <code className="text-muted-foreground block truncate text-[10px]">
          {pattern}
        </code>
      </div>
      {!isBuiltIn && onRemove && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive size-6 shrink-0 cursor-pointer p-0"
        >
          <Trash2 className="size-3" />
        </Button>
      )}
    </div>
  )
}
