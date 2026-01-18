import { type CommandProgressCallback, createBashTools } from './bash'
import { createFilesystemTools } from './filesystem'
import { createScaffoldTools } from './scaffold'
import { createSearchTools } from './search'
import { createSkillsTools } from './skills'
import { createWebSearchTools } from './web-search'

export { createFilesystemTools } from './filesystem'
export {
  createBashTools,
  type CommandProgressCallback,
  type CommandProgressUpdate,
} from './bash'
export { createSearchTools } from './search'
export { createWebSearchTools, type WebSearchResult } from './web-search'
export { createSkillsTools, SKILLS_TOOL_DESCRIPTIONS } from './skills'
export {
  createScaffoldTools,
  SCAFFOLD_TOOL_DESCRIPTIONS,
  type ScaffoldToolsOptions,
} from './scaffold'

export type MoldableToolsOptions = {
  /** Base path for file operations (security boundary) */
  basePath?: string
  /** Max buffer size for command output (default: 1MB) */
  maxBuffer?: number
  /** Max results for search operations (default: 100) */
  maxSearchResults?: number
  /** Google Search API key (or set GOOGLE_SEARCH_ENGINE_API_KEY env var) */
  googleApiKey?: string
  /** Google Search Engine ID (or set GOOGLE_SEARCH_ENGINE_ID env var) */
  googleSearchEngineId?: string
  /** Callback for streaming command output to the UI */
  onCommandProgress?: CommandProgressCallback
  /** API server port for scaffold tools (passed from frontend) */
  apiServerPort?: number
  /** Whether to require user approval for unsandboxed commands (default: true) */
  requireUnsandboxedApproval?: boolean
  /** Whether to require user approval for dangerous commands (default: true) */
  requireDangerousCommandApproval?: boolean
  /** Dangerous command patterns (regex strings) that require approval */
  dangerousPatterns?: string[]
}

/**
 * Create all available tools for the Moldable AI agent
 */
export function createMoldableTools(options: MoldableToolsOptions = {}) {
  const {
    basePath,
    maxBuffer,
    maxSearchResults,
    googleApiKey,
    googleSearchEngineId,
    onCommandProgress,
    apiServerPort,
    requireUnsandboxedApproval,
    requireDangerousCommandApproval,
    dangerousPatterns,
  } = options

  return {
    ...createFilesystemTools({ basePath }),
    ...createBashTools({
      cwd: basePath,
      maxBuffer,
      onProgress: onCommandProgress,
      requireUnsandboxedApproval,
      requireDangerousCommandApproval,
      dangerousPatterns,
    }),
    ...createSearchTools({
      basePath,
      maxResults: maxSearchResults,
    }),
    ...createWebSearchTools({
      apiKey: googleApiKey,
      searchEngineId: googleSearchEngineId,
    }),
    ...createSkillsTools(),
    ...createScaffoldTools({ apiServerPort }),
  }
}

/**
 * Get descriptions of all available tools (for display in UI)
 */
export const TOOL_DESCRIPTIONS = {
  // File operations
  readFile: 'Read file contents with optional line range',
  writeFile: 'Write or overwrite a file',
  editFile: 'Surgical string replacement in a file',
  deleteFile: 'Delete a file',
  listDirectory: 'List directory contents',
  fileExists: 'Check if a path exists',

  // Terminal
  runCommand: 'Execute bash commands',

  // Search
  grep: 'Search file contents with regex (ripgrep)',
  globFileSearch: 'Find files by glob pattern',

  // Web
  webSearch: 'Search the internet via Google',

  // App scaffolding
  scaffoldApp: 'Create a new Moldable app from the standard template',

  // Skills management
  listSkillRepos: 'List registered skill repositories',
  listAvailableSkills: 'Show available skills from repositories',
  syncSkills: 'Download skills to local filesystem',
  addSkillRepo: 'Add a new skill repository',
  updateSkillSelection: 'Update which skills are synced',
  initSkillsConfig: 'Initialize default skills configuration',
} as const

/**
 * Tool categories for UI grouping
 */
export const TOOL_CATEGORIES = {
  filesystem: [
    'readFile',
    'writeFile',
    'editFile',
    'deleteFile',
    'listDirectory',
    'fileExists',
  ],
  terminal: ['runCommand'],
  search: ['grep', 'globFileSearch'],
  web: ['webSearch'],
  scaffold: ['scaffoldApp'],
  skills: [
    'listSkillRepos',
    'listAvailableSkills',
    'syncSkills',
    'addSkillRepo',
    'updateSkillSelection',
    'initSkillsConfig',
  ],
} as const
