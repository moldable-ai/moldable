# Moldable Code - Lightweight IDE PRD

## Overview

A VS Code/Cursor-inspired lightweight IDE for vibe coders who want to see their code **and** the running app side-by-side. Focused on simplicity and a polished experience rather than feature parity with full IDEs.

## Target User

"Vibe coders" - people who work with AI to build apps but aren't traditional developers. They want to:

- See what files exist and make quick edits
- **Primarily watch the built output** as it changes
- Use AI (via Moldable chat) to do most of the heavy lifting

## Core Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Sidebar Toggle] [Breadcrumbs]                        [Preview ◉]  │
├──────────┬──────────────────────────────────┬───────────────────────┤
│          │  [Tab1.tsx] [Tab2.tsx] [×]       │                       │
│  FILES   ├──────────────────────────────────┤    BROWSER PREVIEW    │
│          │                                  │                       │
│  📁 src  │     Monaco Editor                │    http://localhost   │
│   📄 app │                                  │    ┌─────────────────┐│
│   📄 lib │                                  │    │                 ││
│          │                                  │    │   Live App      ││
│          │                                  │    │                 ││
│          │                                  │    └─────────────────┘│
│          │                                  │                       │
└──────────┴──────────────────────────────────┴───────────────────────┘
```

**Three-panel layout:**

1. **File tree sidebar** (collapsible, ~240px default)
2. **Editor area** (tabbed Monaco editor)
3. **Browser preview** (right panel, toggleable, ~40% width default)

All panels are **resizable** via drag handles using `react-resizable-panels` (already in `@moldable-ai/ui`).

## Architecture Principles

### Component Decomposition

**Every feature gets its own file.** Components should be small, focused, and composable:

```
src/components/
├── editor/
│   ├── monaco-editor.tsx       # Monaco wrapper with theme sync
│   ├── editor-tabs.tsx         # Tab bar with close buttons
│   ├── editor-panel.tsx        # Combines tabs + editor
│   └── use-editor-state.ts     # Hook for open files, active tab
├── file-tree/
│   ├── file-tree.tsx           # Recursive tree component
│   ├── file-tree-item.tsx      # Single file/folder row
│   ├── file-icon.tsx           # Icon based on extension
│   └── use-file-tree.ts        # Hook for expand/collapse state
├── browser/
│   ├── browser-panel.tsx       # Full browser preview panel
│   ├── browser-toolbar.tsx     # URL bar + refresh + external
│   └── use-browser-state.ts    # Hook for URL, history
├── project/
│   ├── project-selector.tsx    # Empty state / welcome screen
│   ├── recent-projects.tsx     # List of recent projects
│   └── use-project.ts          # Hook for project state
├── command-palette/
│   ├── command-palette.tsx     # Cmd+P dialog
│   ├── file-search-results.tsx # Search result items
│   └── use-file-search.ts      # Hook for fuzzy search
└── layout/
    ├── ide-layout.tsx          # Main three-panel layout
    ├── header.tsx              # Top bar with breadcrumbs
    └── sidebar-toggle.tsx      # Collapse/expand button
```

### State Management

Use **custom hooks** to encapsulate state logic:

```typescript
// hooks/use-editor-state.ts
export function useEditorState() {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)

  const openFile = useCallback(async (path: string) => { ... }, [])
  const closeFile = useCallback((path: string) => { ... }, [])
  const saveFile = useCallback(async (path: string, content: string) => { ... }, [])

  return { openFiles, activeFilePath, openFile, closeFile, saveFile }
}
```

### Moldable Patterns

Follow standard Moldable app patterns:

1. **Workspace-aware storage** via `@moldable-ai/storage`
2. **Desktop communication** via `sendToMoldable()` from `@moldable-ai/ui`
3. **Query caching** with workspaceId in query keys
4. **Theme sync** via `useTheme()` hook

## Key Features

### 1. Project Selector (Empty State)

When no project is open, show a welcome screen similar to Cursor/VS Code:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                         [Moldable Code Icon]                        │
│                                                                     │
│                    ┌─────────────────────────┐                      │
│                    │   📂 Open Project       │                      │
│                    └─────────────────────────┘                      │
│                                                                     │
│                    Recent Projects                                  │
│                    ────────────────                                 │
│                    my-next-app           ~/projects/my-next-app     │
│                    landing-page          ~/projects/landing-page    │
│                    api-server            ~/projects/api-server      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Component: `src/components/project/project-selector.tsx`**

```tsx
'use client'

import { FolderOpen } from 'lucide-react'
import { Button } from '@moldable-ai/ui'
import { RecentProjects } from './recent-projects'

interface ProjectSelectorProps {
  recentProjects: Array<{ path: string; name: string; lastOpened: string }>
  onSelectProject: (path: string) => void
  onOpenFolder: () => void
}

export function ProjectSelector({
  recentProjects,
  onSelectProject,
  onOpenFolder,
}: ProjectSelectorProps) {
  return (
    <div className="bg-background flex h-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-8">
        {/* Logo */}
        <div className="bg-primary/10 flex h-20 w-20 items-center justify-center rounded-2xl">
          <span className="text-4xl">💻</span>
        </div>

        {/* Open folder button */}
        <Button size="lg" onClick={onOpenFolder} className="gap-2">
          <FolderOpen className="size-5" />
          Open Project
        </Button>

        {/* Recent projects */}
        {recentProjects.length > 0 && (
          <RecentProjects
            projects={recentProjects}
            onSelect={onSelectProject}
          />
        )}
      </div>
    </div>
  )
}
```

**Storage:** Recent projects stored via `@moldable-ai/storage` at workspace data path.

### 2. Folder Selection (New Desktop API)

Add `moldable:select-folder` to Moldable's desktop APIs.

**App usage:**

```typescript
import { sendToMoldable } from '@moldable-ai/ui'

// Request folder selection
const requestId = crypto.randomUUID()
sendToMoldable({
  type: 'moldable:select-folder',
  requestId,
  title: 'Select Project Folder', // Optional
})

// Listen for response
window.addEventListener('message', (event) => {
  if (
    event.data?.type === 'moldable:folder-selected' &&
    event.data?.requestId === requestId
  ) {
    if (event.data.path) {
      setRootPath(event.data.path)
    }
    // path is null if user cancelled
  }
})
```

**Desktop implementation (`app.tsx`):**

```typescript
// Add to existing message handler
if (event.data?.type === 'moldable:select-folder') {
  const { requestId, title } = event.data
  open({
    directory: true,
    multiple: false,
    title: title || 'Select Folder',
  }).then((path) => {
    // Find the iframe that sent the message and respond
    const iframe = document.querySelector('iframe')
    iframe?.contentWindow?.postMessage(
      {
        type: 'moldable:folder-selected',
        requestId,
        path: typeof path === 'string' ? path : (path?.[0] ?? null),
      },
      '*',
    )
  })
}
```

**Also add helper to `@moldable-ai/ui`:**

```typescript
// In @moldable-ai/ui
export async function selectFolder(title?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID()

    const handler = (event: MessageEvent) => {
      if (
        event.data?.type === 'moldable:folder-selected' &&
        event.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler)
        resolve(event.data.path ?? null)
      }
    }

    window.addEventListener('message', handler)
    sendToMoldable({ type: 'moldable:select-folder', requestId, title })
  })
}
```

### 3. Monaco Editor

Replace the read-only `CodeBlock` with Monaco Editor for actual editing.

**Package:** `@monaco-editor/react` (official React wrapper)

**Component: `src/components/editor/monaco-editor.tsx`**

```tsx
'use client'

import Editor, { type Monaco } from '@monaco-editor/react'
import { useCallback, useRef } from 'react'
import { useTheme } from '@moldable-ai/ui'
import type { editor } from 'monaco-editor'

interface MonacoEditorProps {
  value: string
  language: string
  onChange?: (value: string) => void
  onSave?: (value: string) => void
  readOnly?: boolean
}

export function MonacoEditor({
  value,
  language,
  onChange,
  onSave,
  readOnly = false,
}: MonacoEditorProps) {
  const { resolvedTheme } = useTheme()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const handleMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor

      // Cmd+S to save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave?.(editor.getValue())
      })
    },
    [onSave],
  )

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs-light'}
      onChange={(val) => onChange?.(val ?? '')}
      onMount={handleMount}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        tabSize: 2,
        padding: { top: 12 },
      }}
    />
  )
}
```

**Language detection: `src/lib/file-utils.ts`**

```typescript
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  yaml: 'yaml',
  yml: 'yaml',
  // Add more as needed
}

export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TO_LANGUAGE[ext] ?? 'plaintext'
}
```

### 4. File Tree Sidebar

**Component: `src/components/file-tree/file-tree.tsx`**

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@moldable-ai/ui'
import { FileTreeItem } from './file-tree-item'

interface FileTreeProps {
  rootPath: string
  onFileSelect: (path: string) => void
  selectedPath?: string | null
}

export function FileTree({
  rootPath,
  onFileSelect,
  selectedPath,
}: FileTreeProps) {
  const { workspaceId, fetchWithWorkspace } = useWorkspace()

  const { data } = useQuery({
    queryKey: ['files', rootPath, workspaceId],
    queryFn: () =>
      fetchWithWorkspace(
        `/api/files?path=${encodeURIComponent(rootPath)}`,
      ).then((r) => r.json()),
    enabled: !!rootPath,
  })

  if (!data?.files) return null

  return (
    <div className="flex flex-col">
      {data.files.map((file: FileItem) => (
        <FileTreeItem
          key={file.path}
          file={file}
          depth={0}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  )
}
```

**Improvements over current:**

- **Lazy loading**: Only fetch children when folder is expanded
- **Ignore patterns**: Hide `node_modules`, `.git`, `.next` by default (server-side)
- **File icons**: Use `file-icon.tsx` component based on extension
- **Keyboard nav**: Arrow keys to navigate, Enter to open

### 5. Command Palette (Cmd+P)

**Component: `src/components/command-palette/command-palette.tsx`**

```tsx
'use client'

import { File } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@moldable-ai/ui'
import { FileIcon } from '../file-tree/file-icon'
import { useFileSearch } from './use-file-search'

interface CommandPaletteProps {
  rootPath: string
  onFileSelect: (path: string) => void
}

export function CommandPalette({
  rootPath,
  onFileSelect,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { results, isLoading } = useFileSearch(rootPath, query)

  // Cmd+P to open
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const handleSelect = (path: string) => {
    onFileSelect(path)
    setOpen(false)
    setQuery('')
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search files..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {isLoading ? 'Searching...' : 'No files found.'}
        </CommandEmpty>
        <CommandGroup heading="Files">
          {results.map((file) => (
            <CommandItem
              key={file.path}
              value={file.path}
              onSelect={() => handleSelect(file.path)}
              className="flex items-center gap-2"
            >
              <FileIcon filename={file.name} className="size-4" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="text-muted-foreground max-w-[200px] truncate text-xs">
                {file.relativePath}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
```

**Hook: `src/components/command-palette/use-file-search.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useWorkspace } from '@moldable-ai/ui'

export function useFileSearch(rootPath: string, query: string) {
  const { workspaceId, fetchWithWorkspace } = useWorkspace()

  // Fetch all files once (cached)
  const { data: allFiles } = useQuery({
    queryKey: ['all-files', rootPath, workspaceId],
    queryFn: () =>
      fetchWithWorkspace(
        `/api/search?root=${encodeURIComponent(rootPath)}`,
      ).then((r) => r.json()),
    enabled: !!rootPath,
    staleTime: 30000, // Cache for 30s
  })

  // Client-side fuzzy filter
  const results = useMemo(() => {
    if (!allFiles?.files || !query.trim()) return allFiles?.files ?? []
    const q = query.toLowerCase()
    return allFiles.files
      .filter(
        (f: any) =>
          f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
      )
      .slice(0, 20)
  }, [allFiles, query])

  return { results, isLoading: !allFiles }
}
```

### 6. Browser Preview Panel

**Component: `src/components/browser/browser-panel.tsx`**

```tsx
'use client'

import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Button, Input } from '@moldable-ai/ui'
import { sendToMoldable } from '@moldable-ai/ui'

interface BrowserPanelProps {
  defaultUrl?: string
  onClose?: () => void
}

export function BrowserPanel({
  defaultUrl = 'http://localhost:3000',
  onClose,
}: BrowserPanelProps) {
  const [url, setUrl] = useState(defaultUrl)
  const [inputUrl, setInputUrl] = useState(defaultUrl)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const handleNavigate = useCallback(() => {
    setUrl(inputUrl)
  }, [inputUrl])

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = url
    }
  }, [url])

  const handleOpenExternal = useCallback(() => {
    sendToMoldable({ type: 'moldable:open-url', url })
  }, [url])

  return (
    <div className="bg-background flex h-full flex-col border-l">
      {/* Toolbar */}
      <div className="flex h-10 items-center gap-2 border-b px-2">
        <Input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
          className="h-7 flex-1 text-xs"
          placeholder="http://localhost:3000"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleRefresh}
        >
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleOpenExternal}
        >
          <ExternalLink className="size-3.5" />
        </Button>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* iframe */}
      <iframe
        ref={iframeRef}
        src={url}
        className="w-full flex-1 border-none bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  )
}
```

### 7. Editor Tabs

**Component: `src/components/editor/editor-tabs.tsx`**

```tsx
'use client'

import { X } from 'lucide-react'
import { cn } from '@moldable-ai/ui'
import { FileIcon } from '../file-tree/file-icon'

interface Tab {
  path: string
  name: string
  isDirty?: boolean
}

interface EditorTabsProps {
  tabs: Tab[]
  activeTab: string | null
  onTabSelect: (path: string) => void
  onTabClose: (path: string) => void
}

export function EditorTabs({
  tabs,
  activeTab,
  onTabSelect,
  onTabClose,
}: EditorTabsProps) {
  return (
    <div className="bg-muted/30 flex h-9 shrink-0 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <button
          key={tab.path}
          onClick={() => onTabSelect(tab.path)}
          className={cn(
            'group flex h-full cursor-pointer items-center gap-2 border-r px-3 text-xs transition-colors',
            activeTab === tab.path
              ? 'bg-background text-foreground border-b-primary -mb-px border-b-2'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          <FileIcon filename={tab.name} className="size-3.5" />
          <span className="max-w-[120px] truncate">{tab.name}</span>
          {tab.isDirty && <span className="bg-primary size-2 rounded-full" />}
          <X
            className="hover:bg-accent size-3 rounded-sm opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onTabClose(tab.path)
            }}
          />
        </button>
      ))}
    </div>
  )
}
```

## API Endpoints

| Endpoint      | Method | Description                                   | Status  |
| ------------- | ------ | --------------------------------------------- | ------- |
| `/api/config` | GET    | Get project config (rootPath, recentProjects) | Exists  |
| `/api/config` | POST   | Save project config                           | Exists  |
| `/api/files`  | GET    | List files in directory                       | Exists  |
| `/api/read`   | GET    | Read file content                             | Exists  |
| `/api/write`  | POST   | Write file content                            | Exists  |
| `/api/search` | GET    | Recursive file search                         | **New** |

### `/api/files` (Updated)

Add ignore patterns server-side:

```typescript
// src/app/api/files/route.ts
import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  '.DS_Store',
]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')

  if (!path) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 })
  }

  const entries = await readdir(path, { withFileTypes: true })
  const files = entries
    .filter((entry) => !IGNORE_PATTERNS.includes(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: join(path, entry.name),
      isDirectory: entry.isDirectory(),
    }))
    .sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return NextResponse.json({ files })
}
```

### `/api/search` (New)

Recursively list all files for Cmd+P search:

```typescript
// src/app/api/search/route.ts
import { NextResponse } from 'next/server'
import { glob } from 'fast-glob'

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.next/**',
  '**/dist/**',
]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const root = searchParams.get('root')

  if (!root) {
    return NextResponse.json({ error: 'Root required' }, { status: 400 })
  }

  const files = await glob('**/*', {
    cwd: root,
    ignore: IGNORE_PATTERNS,
    onlyFiles: true,
    absolute: true,
  })

  return NextResponse.json({
    files: files.slice(0, 1000).map((path) => ({
      path,
      name: path.split('/').pop() ?? '',
      relativePath: path.replace(root, '').replace(/^\//, ''),
    })),
  })
}
```

## Desktop Changes

### Add `moldable:select-folder` Handler

In `desktop/src/app.tsx`, add to the existing message handler:

```typescript
// In the useEffect that handles postMessage
if (event.data?.type === 'moldable:select-folder') {
  const { requestId, title } = event.data

  open({
    directory: true,
    multiple: false,
    title: title || 'Select Folder',
  })
    .then((selected) => {
      const path =
        typeof selected === 'string' ? selected : (selected?.[0] ?? null)

      // Post back to the requesting iframe
      const iframe = document.querySelector('iframe')
      iframe?.contentWindow?.postMessage(
        {
          type: 'moldable:folder-selected',
          requestId,
          path,
        },
        '*',
      )
    })
    .catch(() => {
      // User cancelled or error
      const iframe = document.querySelector('iframe')
      iframe?.contentWindow?.postMessage(
        {
          type: 'moldable:folder-selected',
          requestId,
          path: null,
        },
        '*',
      )
    })
}
```

## Dependencies

```json
{
  "dependencies": {
    "@monaco-editor/react": "^4.6.0",
    "fast-glob": "^3.3.2"
  }
}
```

## Complete File Structure

```
~/.moldable/shared/apps/code-editor/
├── moldable.json
├── package.json
├── next.config.ts
├── tsconfig.json
├── .eslintrc.json
├── .gitignore
├── postcss.config.mjs
├── scripts/
│   └── moldable-dev.mjs
└── src/
    ├── app/
    │   ├── layout.tsx                  # Root layout with providers
    │   ├── page.tsx                    # Main entry (delegates to IDELayout)
    │   ├── globals.css
    │   ├── widget/
    │   │   ├── layout.tsx              # WidgetLayout wrapper
    │   │   └── page.tsx                # Widget view with GHOST_EXAMPLES
    │   └── api/
    │       ├── moldable/health/route.ts
    │       ├── config/route.ts         # Project config CRUD
    │       ├── files/route.ts          # Directory listing
    │       ├── read/route.ts           # File read
    │       ├── write/route.ts          # File write
    │       └── search/route.ts         # Recursive file search
    │
    ├── components/
    │   ├── editor/
    │   │   ├── monaco-editor.tsx       # Monaco wrapper with theme sync
    │   │   ├── editor-tabs.tsx         # Tab bar component
    │   │   ├── editor-panel.tsx        # Combines tabs + editor area
    │   │   └── editor-empty.tsx        # "No file open" state
    │   │
    │   ├── file-tree/
    │   │   ├── file-tree.tsx           # Recursive tree container
    │   │   ├── file-tree-item.tsx      # Single file/folder row
    │   │   └── file-icon.tsx           # Extension-based icon
    │   │
    │   ├── browser/
    │   │   ├── browser-panel.tsx       # Full browser preview
    │   │   └── browser-toolbar.tsx     # URL bar + actions
    │   │
    │   ├── project/
    │   │   ├── project-selector.tsx    # Empty state / welcome
    │   │   └── recent-projects.tsx     # Recent projects list
    │   │
    │   ├── command-palette/
    │   │   ├── command-palette.tsx     # Cmd+P dialog
    │   │   └── file-search-item.tsx    # Search result row
    │   │
    │   └── layout/
    │       ├── ide-layout.tsx          # Main three-panel layout
    │       ├── header.tsx              # Top bar with breadcrumbs
    │       └── sidebar-header.tsx      # File tree header
    │
    ├── hooks/
    │   ├── use-editor-state.ts         # Open files, active tab, dirty state
    │   ├── use-file-tree.ts            # Expand/collapse state
    │   ├── use-project.ts              # Root path, recent projects
    │   ├── use-file-search.ts          # Cmd+P search logic
    │   └── use-browser-state.ts        # URL, history
    │
    ├── lib/
    │   ├── query-provider.tsx          # TanStack Query setup
    │   ├── file-utils.ts               # getLanguageFromPath, etc.
    │   └── constants.ts                # Ignore patterns, defaults
    │
    └── proxy.ts                        # Moldable proxy setup
```

## Implementation Order

### Phase 1: Foundation

1. **Desktop API** - Add `moldable:select-folder` handler to `app.tsx`
2. **Project hook** - `use-project.ts` for root path + recent projects
3. **Project selector** - Empty state when no project open

### Phase 2: Core Editor

4. **File tree components** - `file-tree.tsx`, `file-tree-item.tsx`, `file-icon.tsx`
5. **Editor state hook** - `use-editor-state.ts` for open files management
6. **Monaco editor** - `monaco-editor.tsx` with theme sync
7. **Editor tabs** - `editor-tabs.tsx` with close buttons

### Phase 3: Layout

8. **IDE layout** - `ide-layout.tsx` with resizable panels
9. **Header** - Breadcrumbs, sidebar toggle
10. **Browser panel** - `browser-panel.tsx` as right panel

### Phase 4: Polish

11. **Command palette** - Cmd+P file search
12. **Keyboard shortcuts** - Cmd+S save, Cmd+W close tab
13. **Visual polish** - Loading states, animations, icons

## Non-Goals (Keep Simple)

- ❌ Git integration (use git-flow app instead)
- ❌ Terminal/shell access (Moldable chat handles commands)
- ❌ LSP/IntelliSense (AI provides this via chat)
- ❌ Extensions/plugins
- ❌ Multi-root workspaces
- ❌ Diff view (future enhancement)
- ❌ Search in files content (future enhancement)

## Success Criteria

1. User can open any local folder as a project via native picker
2. User can browse files with collapsible tree and proper icons
3. User can edit files with Monaco (syntax highlighting, Cmd+S to save)
4. User can see live preview of running app alongside code
5. Cmd+P opens file search that feels snappy (<100ms filter)
6. Recent projects remembered per workspace
7. Theme syncs with Moldable (dark/light)
8. Looks polished and professional (Linear-quality aesthetic)
9. Components are small, focused, and composable
10. All state logic in custom hooks, not in page components

## AI Context Integration

The code editor should set AI context to help Moldable chat understand what the user is working on:

```typescript
// In editor-panel.tsx or similar
useEffect(() => {
  if (activeFile) {
    sendToMoldable({
      type: 'moldable:set-chat-instructions',
      text: `User is editing \`${activeFile.name}\` in project \`${rootPath}\`.
File path: ${activeFile.path}
Language: ${activeFile.language}`,
    })
  }
}, [activeFile, rootPath])
```

This enables the AI to:

- Know which file the user is looking at
- Provide relevant code suggestions
- Reference the correct file paths when making changes
