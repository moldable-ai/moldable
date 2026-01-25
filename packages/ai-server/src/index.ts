#!/usr/bin/env node
import {
  type CommandProgressUpdate,
  DEFAULT_MODEL,
  LLMProvider,
  type ReasoningEffort,
  buildSystemPrompt,
  createMoldableTools,
  getProviderConfig,
  toMarkdown,
} from '@moldable-ai/ai'
import { createSkillsTools } from '@moldable-ai/ai/tools'
import {
  McpClientManager,
  type McpServerInfo,
  addMcpServer,
  createMcpTools,
  getMcpServer,
  getMcpbInstallDir,
  installBundleFromExtracted,
  parseManifest,
  removeMcpServer,
} from '@moldable-ai/mcp'
import { readCodexCliCredentialsCached } from './codex-cli-credentials.js'
import {
  type GatewayMessage,
  type GatewaySession,
  buildGatewaySessionTitle,
  deleteGatewaySession,
  listGatewaySessions,
  loadGatewaySession,
  saveGatewaySession,
} from './gateway-sessions.js'
import {
  type GatewayChatRequest,
  buildGatewayContext,
  normalizeGatewayMessages,
  resolveGatewaySessionId,
  toGatewayMessages,
} from './gateway.js'
import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from 'ai'
import { config } from 'dotenv'
import { strFromU8, unzipSync } from 'fflate'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { IncomingMessage, ServerResponse, createServer } from 'http'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Development workspace - only relevant when developing Moldable itself
// This is NOT where user apps go (that's MOLDABLE_HOME/shared/apps/)
// Only set if explicitly provided via env var or request body
const WORKSPACE_ROOT = process.env.MOLDABLE_WORKSPACE || null

// Moldable home directory - where all user data, apps, and configs live
const MOLDABLE_HOME = process.env.MOLDABLE_HOME ?? join(homedir(), '.moldable')

const CODEX_CLI_SYNC_TTL_MS = 5 * 60 * 1000
const CODEX_CLI_NEAR_EXPIRY_MS = 10 * 60 * 1000

// Try multiple locations for .env file
// Priority: shared/.env (user home) > dev workspace shared/.env > dev .env
const envPaths = [
  join(MOLDABLE_HOME, 'shared', '.env'), // User's shared env for all workspaces
  join(__dirname, '..', '..', '..', '.moldable', 'shared', '.env'), // Dev workspace
  join(__dirname, '..', '..', '..', '.env'), // Dev fallback
]

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath })
    console.log(`📁 Loaded env from: ${envPath}`)
    break
  }
}

// Port and host are read at runtime via functions to prevent Bun from inlining
// defaults at compile time when using `bun build --compile`
function getPort(): number {
  const envPort = process.env.MOLDABLE_AI_PORT
  if (envPort) {
    const parsed = parseInt(envPort, 10)
    if (!isNaN(parsed)) return parsed
  }
  return 39100
}

function getHost(): string {
  return process.env.MOLDABLE_AI_HOST || '127.0.0.1'
}
const DEBUG_CHAT_REQUESTS =
  process.env.MOLDABLE_DEBUG_CHAT_REQUESTS === '1' ||
  process.env.MOLDABLE_DEBUG_PROMPTS === '1' ||
  process.env.MOLDABLE_DEBUG === '1' ||
  process.env.DEBUG === '1'

// MCP client manager (singleton)
// MCPs are shared across all workspaces
const mcpManager = new McpClientManager(
  join(MOLDABLE_HOME, 'shared', 'config', 'mcp.json'),
)
let mcpServers: McpServerInfo[] = []

const SKILLS_CONFIG_PATH = join(
  MOLDABLE_HOME,
  'shared',
  'config',
  'skills.json',
)
const SKILLS_DIR = join(MOLDABLE_HOME, 'shared', 'skills')
const skillsTools = createSkillsTools()
const skillsToolContext = {
  toolCallId: 'skills-api',
  messages: [],
  abortSignal: new AbortController().signal,
}

// Initialize MCP connections
async function initMcpConnections() {
  console.log('🔌 Connecting to MCP servers...')
  try {
    mcpServers = await mcpManager.connectAll()
    const connected = mcpServers.filter((s) => s.status === 'connected')
    const failed = mcpServers.filter((s) => s.status === 'error')

    if (connected.length > 0) {
      console.log(`✅ Connected to ${connected.length} MCP server(s):`)
      for (const server of connected) {
        console.log(`   - ${server.name}: ${server.tools.length} tools`)
      }
    }

    if (failed.length > 0) {
      console.log(`⚠️  Failed to connect to ${failed.length} MCP server(s):`)
      for (const server of failed) {
        console.log(`   - ${server.name}: ${server.error}`)
      }
    }

    if (mcpServers.length === 0) {
      console.log('   No MCP servers configured')
    }
  } catch (error) {
    console.error('❌ Error initializing MCP connections:', error)
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, User-Agent, X-Requested-With',
}

type OpenAIAuthSource = 'env' | 'codex-cli' | 'none'

function isCodexModel(model: string): boolean {
  return model.toLowerCase().includes('codex')
}

function resolveOpenAIAuth(model?: string): {
  apiKey?: string
  source: OpenAIAuthSource
} {
  const envKey = process.env.OPENAI_API_KEY?.trim()
  if (envKey) {
    return { apiKey: envKey, source: 'env' }
  }

  if (model && !isCodexModel(model)) {
    return { source: 'none' }
  }

  const creds = readCodexCliCredentialsCached({ ttlMs: CODEX_CLI_SYNC_TTL_MS })
  if (!creds) return { source: 'none' }

  const now = Date.now()
  if (
    typeof creds.expires === 'number' &&
    creds.expires <= now + CODEX_CLI_NEAR_EXPIRY_MS
  ) {
    return { source: 'none' }
  }

  return { apiKey: creds.access, source: 'codex-cli' }
}

// Parse JSON body
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// Send JSON response
function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    ...corsHeaders,
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify(data))
}

// Send error response
function sendError(res: ServerResponse, message: string, status = 500): void {
  sendJson(res, { error: message }, status)
}

function normalizeSkillRepoInput(value: string): string | null {
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

    const owner = segments[0]
    const repo = segments[1]

    if (
      (host === 'github.com' || host.endsWith('.github.com')) &&
      owner &&
      repo
    ) {
      return `${owner}/${cleanRepo(repo)}`
    }

    if (host === 'skills.sh' || host.endsWith('.skills.sh')) {
      const offset = segments[0] === 'skills' ? 1 : 0
      const skillOwner = segments[offset]
      const skillRepo = segments[offset + 1]
      if (skillOwner && skillRepo) {
        return `${skillOwner}/${cleanRepo(skillRepo)}`
      }
    }
  } catch {
    return null
  }

  return null
}

function sanitizeRepoDir(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '-')
}

function getInstalledSkills(repoName: string): string[] {
  const repoDir = join(SKILLS_DIR, sanitizeRepoDir(repoName))
  if (!existsSync(repoDir)) return []

  try {
    return readdirSync(repoDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function pruneUnselectedSkills(repoName: string, selected: string[]): void {
  const repoDir = join(SKILLS_DIR, sanitizeRepoDir(repoName))
  if (!existsSync(repoDir)) return

  const selectedSet = new Set(selected)
  try {
    for (const entry of readdirSync(repoDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!selectedSet.has(entry.name)) {
        rmSync(join(repoDir, entry.name), { recursive: true, force: true })
      }
    }
  } catch {
    // Ignore cleanup errors - selection is still updated in config.
  }
}

/**
 * Remove dangling tool calls from messages.
 *
 * When a user sends a new message while the assistant is executing tools,
 * we may have tool_call blocks without corresponding tool_result blocks.
 * The Anthropic API requires every tool_use to have a matching tool_result.
 *
 * This function:
 * 1. Collects all tool call IDs that have responses (tool-result or tool-approval-response)
 * 2. Also keeps tool calls that have pending approval requests (awaiting user response)
 * 3. Removes tool calls that don't have matching results/responses/requests
 * 4. Removes assistant messages that become empty after removing dangling calls
 *
 * Note: Tool calls with approval requests OR responses are NOT dangling.
 */
function removeDanglingToolCalls<T extends { role: string; content: unknown }>(
  messages: T[],
): T[] {
  // First pass: collect all tool call IDs that have responses
  // This includes both tool-result (executed) and tool-approval-response (pending execution after approval)
  const toolResponseIds = new Set<string>()
  const approvalResponseApprovalIds = new Set<string>()

  for (const msg of messages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{
        type: string
        toolCallId?: string
        approvalId?: string
      }>) {
        if (part.type === 'tool-result' && part.toolCallId) {
          toolResponseIds.add(part.toolCallId)
        }
        // Also track approval responses - these mean the tool call is valid (pending execution)
        if (part.type === 'tool-approval-response' && part.approvalId) {
          approvalResponseApprovalIds.add(part.approvalId)
        }
      }
    }
  }

  // Collect tool calls that have approval requests (pending user input)
  // AND tool calls that have approval responses
  const approvalRequestToolCallIds = new Map<string, string>() // approvalId -> toolCallId
  const toolCallsWithPendingApproval = new Set<string>() // Tool calls awaiting user approval

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{
        type: string
        toolCallId?: string
        approvalId?: string
      }>) {
        if (
          part.type === 'tool-approval-request' &&
          part.approvalId &&
          part.toolCallId
        ) {
          approvalRequestToolCallIds.set(part.approvalId, part.toolCallId)
          // Mark this tool call as having a pending approval request
          toolCallsWithPendingApproval.add(part.toolCallId)
        }
      }
    }
  }

  // Mark tool calls that have approval responses as having responses
  for (const approvalId of approvalResponseApprovalIds) {
    const toolCallId = approvalRequestToolCallIds.get(approvalId)
    if (toolCallId) {
      toolResponseIds.add(toolCallId)
      // Remove from pending since it's been responded to
      toolCallsWithPendingApproval.delete(toolCallId)
    }
  }

  // Combine: tool calls are valid if they have a response OR have a pending approval
  const validToolCallIds = new Set([
    ...toolResponseIds,
    ...toolCallsWithPendingApproval,
  ])

  // Second pass: filter out dangling tool calls
  const result: T[] = []

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const content = msg.content as Array<{
        type: string
        toolCallId?: string
        text?: string
      }>

      // Check if this message has tool calls
      const hasToolCalls = content.some((part) => part.type === 'tool-call')

      if (hasToolCalls) {
        // Filter out tool calls that don't have matching results, approval responses, or pending approvals
        const filteredContent = content.filter((part) => {
          if (part.type === 'tool-call' && part.toolCallId) {
            const isValid = validToolCallIds.has(part.toolCallId)
            if (!isValid) {
              console.log(
                `   ⚠️ Removing dangling tool call: ${part.toolCallId} (no matching tool_result, approval response, or pending approval)`,
              )
            }
            return isValid
          }
          return true // Keep non-tool-call parts
        })

        // Check if the message still has meaningful content after filtering
        const hasRemainingContent = filteredContent.some((part) => {
          if (part.type === 'text' && part.text) {
            return part.text.trim() !== ''
          }
          return part.type === 'tool-call' // Any remaining tool calls are valid
        })

        if (hasRemainingContent) {
          result.push({ ...msg, content: filteredContent })
        } else if (filteredContent.length > 0) {
          // Has content but no text or tool-calls (e.g., only reasoning)
          // Check if this is the last message - if so, keep it
          // Otherwise, filter it out
          const isLast = msg === messages[messages.length - 1]
          if (isLast) {
            result.push({ ...msg, content: filteredContent })
          } else {
            console.log(
              `   ⚠️ Filtering out assistant message with only reasoning after removing dangling tool calls`,
            )
          }
        } else {
          console.log(
            `   ⚠️ Filtering out assistant message that became empty after removing dangling tool calls`,
          )
        }
      } else {
        // No tool calls, keep as is
        result.push(msg)
      }
    } else {
      // Non-assistant messages, keep as is
      result.push(msg)
    }
  }

  return result
}

type ApiKeys = {
  anthropicApiKey?: string
  openaiApiKey?: string
  openrouterApiKey?: string
}

function apiKeysFromEnv(model?: string): ApiKeys {
  const openaiAuth = resolveOpenAIAuth(model)
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: openaiAuth.apiKey,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
  }
}

function validateApiKeys(model: string, apiKeys: ApiKeys): string | null {
  const isAnthropic = model.startsWith('anthropic/')
  const isOpenRouter = model.startsWith('openrouter/')
  const isOpenAI = model.startsWith('openai/')

  if (isAnthropic && !apiKeys.anthropicApiKey && !apiKeys.openrouterApiKey) {
    return 'ANTHROPIC_API_KEY or OPENROUTER_API_KEY required'
  }
  if (isOpenRouter && !apiKeys.openrouterApiKey) {
    return 'OPENROUTER_API_KEY not configured'
  }
  if (isOpenAI && !apiKeys.openaiApiKey && !apiKeys.openrouterApiKey) {
    return 'OPENAI_API_KEY or OPENROUTER_API_KEY required'
  }

  return null
}

// Handle chat request - using AI SDK's UIMessage format for useChat compatibility
async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Create abort controller for this request
  const abortController = new AbortController()
  let isAborted = false

  // Listen for client disconnect to abort the request.
  // We listen to res.on('close') because that fires when the client closes the connection
  // during response streaming (e.g., when user clicks stop button).
  // Note: req.on('close') fires when request body is done being read, which is NOT
  // when the client disconnects during response streaming.
  res.on('close', () => {
    if (!res.writableEnded) {
      console.log('⚠️ Client disconnected mid-stream, aborting...')
      isAborted = true
      abortController.abort()
    }
  })

  try {
    const body = (await parseBody(req)) as {
      messages?: UIMessage[]
      model?: string
      reasoningEffort?: ReasoningEffort
      basePath?: string // Workspace root for file operations
      activeWorkspaceId?: string // Active workspace ID (e.g., "personal", "work")
      apiServerPort?: number // API server port for scaffold tools (handles multi-user on same machine)
      requireUnsandboxedApproval?: boolean // Whether to require user approval for unsandboxed commands
      requireDangerousCommandApproval?: boolean // Whether to require user approval for dangerous commands
      dangerousPatterns?: string[] // Dangerous command patterns (regex strings)
      registeredApps?: Array<{
        // All registered apps in Moldable
        id: string
        name: string
        icon: string
      }>
      activeApp?: {
        // Currently active app in Moldable
        id: string
        name: string
        icon: string
        workingDir: string
        dataDir: string
      }
      appChatInstructions?: string // App-provided instructions to include in system prompt
    }

    console.log('📨 Received chat request')
    if (DEBUG_CHAT_REQUESTS) {
      console.log('   Raw body:', JSON.stringify(body, null, 2))
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      sendError(res, 'messages array is required', 400)
      return
    }

    const model = (body.model as LLMProvider) || DEFAULT_MODEL
    const reasoningEffort = body.reasoningEffort || 'medium'
    console.log('   Model:', model)
    console.log('   Reasoning effort:', reasoningEffort)
    console.log('   Input messages:', body.messages.length)
    if (body.activeApp) {
      console.log(
        `   Active app: ${body.activeApp.icon} ${body.activeApp.name} (${body.activeApp.workingDir})`,
      )
    }

    // Get API keys from environment
    const apiKeys = apiKeysFromEnv(model)
    const apiKeyError = validateApiKeys(model, apiKeys)
    if (apiKeyError) {
      sendError(res, apiKeyError, 500)
      return
    }

    // toolsBasePath: Where bash commands run and the default working directory for tools.
    // - body.basePath: Sent by desktop when user is viewing a specific app (the app's working dir)
    // - WORKSPACE_ROOT: Fallback for Moldable development (the monorepo path)
    // - undefined: No specific working dir, tools resolve paths from root
    //
    // NOTE: Even with a basePath set, tools can always access ~/.moldable/*
    // (home dir is allowlisted) so apps are created in MOLDABLE_HOME/shared/apps/
    const toolsBasePath = body.basePath || WORKSPACE_ROOT || undefined
    if (toolsBasePath) {
      console.log('   Tools base path:', toolsBasePath)
    }
    if (body.apiServerPort) {
      console.log('   API server port:', body.apiServerPort)
    }

    // outputDir: Where large tool outputs are saved for later retrieval
    // Path: ~/.moldable/workspaces/{workspaceId}/tool-output/
    const toolsOutputDir = body.activeWorkspaceId
      ? join(MOLDABLE_HOME, 'workspaces', body.activeWorkspaceId, 'tool-output')
      : join(MOLDABLE_HOME, 'tool-output') // Fallback when no workspace
    console.log('   Tool output dir:', toolsOutputDir)

    // Create MCP tools from connected servers (these don't need the writer)
    const mcpTools = createMcpTools(mcpManager)
    const mcpToolCount = Object.keys(mcpTools).length
    if (mcpToolCount > 0) {
      console.log(`   MCP tools: ${mcpToolCount}`)
    }

    // Get tool names for system prompt (we'll create actual tools inside the stream)
    const toolNamesForPrompt = [
      // Moldable built-in tool names
      'readFile',
      'writeFile',
      'editFile',
      'deleteFile',
      'listDirectory',
      'fileExists',
      'runCommand',
      'grep',
      'globFileSearch',
      'webSearch',
      'scaffoldApp',
      'readToolOutput',
      'listSkillRepos',
      'listAvailableSkills',
      'syncSkills',
      'addSkillRepo',
      'updateSkillSelection',
      'initSkillsConfig',
      // MCP tool names
      ...Object.keys(mcpTools),
    ]

    // Build system message (async to load AGENTS.md from development workspace)
    // developmentWorkspace is ONLY for reading AGENTS.md when developing Moldable itself
    const systemMessage = await buildSystemPrompt({
      developmentWorkspace: WORKSPACE_ROOT || undefined,
      activeWorkspaceId: body.activeWorkspaceId,
      moldableHome: MOLDABLE_HOME,
      currentDate: new Date(),
      availableTools: toolNamesForPrompt,
      registeredApps: body.registeredApps,
      activeApp: body.activeApp,
      appChatInstructions: body.appChatInstructions,
    })

    // Get provider config
    const {
      model: languageModel,
      temperature,
      providerOptions,
    } = getProviderConfig(model, apiKeys, reasoningEffort)

    // DEBUG: Log incoming UIMessages structure
    console.log('   === UIMessages Debug ===')
    for (const msg of body.messages) {
      console.log(`   [${msg.role}] id=${msg.id}`)
      console.log(`      parts: ${JSON.stringify(msg.parts)}`)
    }
    console.log('   ========================')

    // Pre-filter UIMessages to remove messages with empty content
    // This can happen when user sends a new message while streaming (assistant message is empty/partial)
    const validUIMessages = body.messages.filter((msg) => {
      // If no parts or empty parts array, filter out
      if (!msg.parts || msg.parts.length === 0) {
        console.log(
          `   ⚠️ Filtering out ${msg.role} UIMessage with no parts (id: ${msg.id})`,
        )
        return false
      }

      // Check if message has any non-empty content in its parts
      const hasNonEmptyContent = msg.parts.some((part) => {
        // Check text-based parts (text, reasoning) for non-empty text
        if (part.type === 'text' || part.type === 'reasoning') {
          const textPart = part as { text?: string }
          const hasText = textPart.text && textPart.text.trim() !== ''
          console.log(
            `      part.type=${part.type}, hasText=${hasText}, text="${(textPart.text || '').substring(0, 50)}..."`,
          )
          return hasText
        }
        // Tool invocations are valid content (they have structured data, not text)
        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
          console.log(`      part.type=${part.type}, valid=true (tool)`)
          return true
        }
        // Other part types (file, source-url, etc.) - assume valid if present
        console.log(`      part.type=${part.type}, valid=true (other)`)
        return true
      })

      if (!hasNonEmptyContent) {
        console.log(
          `   ⚠️ Filtering out ${msg.role} UIMessage with empty content (id: ${msg.id})`,
        )
        return false
      }
      return true
    })

    // Convert UIMessages to ModelMessages using AI SDK's converter
    // Note: We can't pass tools here since they're created inside the stream callback
    // This is fine - the converter just needs to know about existing tool results in messages
    const modelMessages = await convertToModelMessages(validUIMessages)

    // DEBUG: Log model messages structure
    console.log('   === ModelMessages Debug ===')
    for (const msg of modelMessages) {
      console.log(`   [${msg.role}] content type: ${typeof msg.content}`)
      if (typeof msg.content === 'string') {
        console.log(`      content: "${msg.content.substring(0, 100)}..."`)
      } else if (Array.isArray(msg.content)) {
        console.log(`      content array length: ${msg.content.length}`)
        for (const part of msg.content) {
          console.log(
            `      - type: ${part.type}, ${JSON.stringify(part).substring(0, 100)}...`,
          )
        }
      }
    }
    console.log('   ============================')

    // Double-check: filter out any model messages with empty/invalid content
    // Non-final assistant messages must have actual text content, not just reasoning
    // IMPORTANT: We must preserve assistant messages with tool_call blocks, as the next
    // message will have tool_result blocks that reference them (Anthropic API requirement)
    const filteredMessages = modelMessages.filter((msg, index) => {
      const isLastMessage = index === modelMessages.length - 1

      // Keep messages that have non-empty string content
      if (typeof msg.content === 'string' && msg.content.trim() !== '') {
        return true
      }

      // For array content, check if there's actual text content (not just reasoning)
      if (Array.isArray(msg.content) && msg.content.length > 0) {
        // For assistant messages that are NOT the final message,
        // we need actual text content, not just reasoning
        // BUT we must keep messages with tool_call blocks (tool invocations)
        if (msg.role === 'assistant' && !isLastMessage) {
          const hasTextContent = msg.content.some(
            (part) => part.type === 'text' && 'text' in part && part.text,
          )
          const hasToolCall = msg.content.some(
            (part) => part.type === 'tool-call',
          )

          // Keep if has text or tool calls
          if (!hasTextContent && !hasToolCall) {
            console.log(
              `   ⚠️ Filtering out non-final assistant message with only reasoning (no text/tool content)`,
            )
            return false
          }
        }
        return true
      }

      // Filter out messages with empty/missing content
      console.log(
        `   ⚠️ Filtering out ${msg.role} model message with empty content`,
      )
      return false
    })

    // Fix dangling tool calls: if an assistant message has tool_call blocks but
    // no corresponding tool_result in the next message, we need to remove those tool calls.
    // This happens when user sends a new message while assistant is executing tools.
    const fixedMessages = removeDanglingToolCalls(filteredMessages)

    const uiFiltered = body.messages.length - validUIMessages.length
    const modelFiltered = modelMessages.length - fixedMessages.length
    console.log(
      '   Messages:',
      `${body.messages.length} UI → ${validUIMessages.length} valid → ${modelMessages.length} model → ${fixedMessages.length} final`,
      uiFiltered + modelFiltered > 0
        ? `(filtered ${uiFiltered + modelFiltered} empty/dangling)`
        : '',
    )

    if (DEBUG_CHAT_REQUESTS) {
      // Log the full request for debugging
      console.log('\n=== Chat Request ===')
      console.log(
        toMarkdown(
          {
            provider: model,
            temperature,
            tools_enabled: `${toolNamesForPrompt.length} tools`,
            available_tools: toolNamesForPrompt,
          },
          { namespace: 'config' },
        ),
      )
      console.log('--- System Prompt ---')
      console.log(systemMessage)
      console.log('--- Messages ---')
      console.log(toMarkdown(fixedMessages, { namespace: 'messages' }))
      console.log('=== End Request ===\n')
    }

    // Create UI message stream response (compatible with useChat/DefaultChatTransport)
    const streamResponse = createUIMessageStreamResponse({
      stream: createUIMessageStream({
        originalMessages: body.messages,
        // Format errors for better user-facing messages
        // See: https://ai-sdk.dev/docs/reference/ai-sdk-errors
        onError: (error: unknown) => formatErrorMessage(error),
        execute: async ({ writer }) => {
          try {
            // Create Moldable built-in tools INSIDE the stream execute callback
            // so we have access to the writer for streaming progress
            const moldableTools = createMoldableTools({
              basePath: toolsBasePath,
              // Pass API server port for scaffold tools (handles multi-user on same machine)
              apiServerPort: body.apiServerPort,
              // Whether to require user approval for unsandboxed commands (default: true)
              requireUnsandboxedApproval:
                body.requireUnsandboxedApproval ?? true,
              // Whether to require user approval for dangerous commands (default: true)
              requireDangerousCommandApproval:
                body.requireDangerousCommandApproval ?? true,
              // Dangerous command patterns (regex strings)
              dangerousPatterns: body.dangerousPatterns ?? [],
              // Directory to save large tool outputs for later retrieval
              outputDir: toolsOutputDir,
              // Stream command progress (stdout/stderr) to the UI as data parts
              onCommandProgress: (
                toolCallId: string,
                progress: CommandProgressUpdate & { command: string },
              ) => {
                // Throttle updates: only send every 100ms or when output changes significantly
                // For now, send all updates - can optimize later if needed
                writer.write({
                  type: 'data-tool-progress',
                  id: toolCallId, // Same ID enables reconciliation/updating
                  data: {
                    toolCallId,
                    command: progress.command,
                    stdout: progress.stdout,
                    stderr: progress.stderr,
                    status: 'running',
                  },
                })
              },
            })

            // Combine all tools
            const tools = {
              ...moldableTools,
              ...mcpTools,
            }

            if (DEBUG_CHAT_REQUESTS) {
              console.log('   Starting streamText...')
            }
            const result = streamText({
              model: languageModel,
              messages: [
                { role: 'system', content: systemMessage },
                ...fixedMessages,
              ],
              temperature,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              providerOptions: providerOptions as any,
              tools,
              stopWhen: stepCountIs(1000),
              abortSignal: abortController.signal,
              // Handle abort cleanup - called when stream is aborted via AbortSignal
              onAbort: ({ steps }) => {
                console.log(`⚠️ Stream aborted after ${steps.length} step(s)`)
              },
            })

            if (DEBUG_CHAT_REQUESTS) {
              console.log('   Merging stream...')
            }
            writer.merge(
              result.toUIMessageStream({
                sendReasoning: true,
              }),
            )
          } catch (streamError) {
            // Don't log abort errors as they're expected when user stops
            if (
              streamError instanceof Error &&
              streamError.name === 'AbortError'
            ) {
              console.log('⚠️ Stream aborted by user')
              return
            }
            console.error('   Stream error:', streamError)
            throw streamError
          }
        },
      }),
    })

    // Copy headers and pipe the stream
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type':
        streamResponse.headers.get('Content-Type') || 'text/plain',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    if (streamResponse.body) {
      const reader = streamResponse.body.getReader()
      const pump = async () => {
        try {
          while (true) {
            // Check if aborted before each read
            if (isAborted) {
              console.log('⚠️ Stopping pump due to abort')
              reader.cancel()
              res.end()
              break
            }
            const { done, value } = await reader.read()
            if (done) {
              console.log('✅ Stream completed')
              res.end()
              break
            }
            res.write(value)
          }
        } catch (err) {
          // Don't log abort errors
          if (err instanceof Error && err.name === 'AbortError') {
            console.log('⚠️ Pump aborted')
          } else {
            console.error('Stream error:', err)
          }
          res.end()
        }
      }
      pump()
    } else {
      res.end()
    }
  } catch (error) {
    // Don't log abort errors
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('⚠️ Request aborted')
      return
    }
    console.error('❌ Chat error:', error)
    if (!res.headersSent) {
      // Format error message for better user experience
      const formattedMessage = formatErrorMessage(error)
      sendError(res, formattedMessage)
    }
  }
}

async function handleGatewayChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = (await parseBody(req)) as GatewayChatRequest
    if (!body.messages || !Array.isArray(body.messages)) {
      sendError(res, 'messages array is required', 400)
      return
    }

    const model = (body.model as LLMProvider) || DEFAULT_MODEL
    const reasoningEffort = body.reasoningEffort || 'medium'

    const apiKeys = apiKeysFromEnv(model)
    const apiKeyError = validateApiKeys(model, apiKeys)
    if (apiKeyError) {
      sendError(res, apiKeyError, 500)
      return
    }

    const uiMessages = normalizeGatewayMessages(body.messages)
    const modelMessages = await convertToModelMessages(uiMessages)
    const fixedMessages = removeDanglingToolCalls(modelMessages)

    const toolsBasePath = WORKSPACE_ROOT || MOLDABLE_HOME
    const toolsOutputDir = body.activeWorkspaceId
      ? join(
          MOLDABLE_HOME,
          'workspaces',
          body.activeWorkspaceId,
          'gateway-tool-output',
        )
      : join(MOLDABLE_HOME, 'shared', 'gateway-tool-output')

    const mcpTools = createMcpTools(mcpManager)
    const toolNamesForPrompt = [
      'readFile',
      'writeFile',
      'editFile',
      'deleteFile',
      'listDirectory',
      'fileExists',
      'runCommand',
      'grep',
      'globFileSearch',
      'webSearch',
      'scaffoldApp',
      'readToolOutput',
      'listSkillRepos',
      'listAvailableSkills',
      'syncSkills',
      'addSkillRepo',
      'updateSkillSelection',
      'initSkillsConfig',
      ...Object.keys(mcpTools),
    ]

    const systemMessage = await buildSystemPrompt({
      developmentWorkspace: WORKSPACE_ROOT || undefined,
      activeWorkspaceId: body.activeWorkspaceId,
      moldableHome: MOLDABLE_HOME,
      currentDate: new Date(),
      availableTools: toolNamesForPrompt,
      registeredApps: [],
      activeApp: null,
      appChatInstructions: null,
    })

    const gatewayContext = buildGatewayContext(body.gateway)
    const systemWithContext = gatewayContext
      ? `${systemMessage}\n\n${gatewayContext}`
      : systemMessage

    const {
      model: languageModel,
      temperature,
      providerOptions,
    } = getProviderConfig(model, apiKeys, reasoningEffort)

    const moldableTools = createMoldableTools({
      basePath: toolsBasePath,
      apiServerPort: body.apiServerPort,
      requireUnsandboxedApproval: body.requireUnsandboxedApproval ?? true,
      requireDangerousCommandApproval:
        body.requireDangerousCommandApproval ?? true,
      dangerousPatterns: body.dangerousPatterns ?? [],
      outputDir: toolsOutputDir,
    })

    const tools = {
      ...moldableTools,
      ...mcpTools,
    }

    const result = streamText({
      model: languageModel,
      messages: [
        { role: 'system', content: systemWithContext },
        ...fixedMessages,
      ],
      temperature,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: providerOptions as any,
      tools,
      stopWhen: stepCountIs(1000),
    })

    const text = await result.text

    const sessionId = resolveGatewaySessionId(body)
    const storedMessages: GatewayMessage[] = [
      ...toGatewayMessages(body.messages),
      { role: 'assistant', text, timestamp: Math.floor(Date.now() / 1000) },
    ]

    const now = new Date().toISOString()
    const existing = loadGatewaySession(sessionId, {
      moldableHome: MOLDABLE_HOME,
      workspaceId: body.activeWorkspaceId,
    })
    const session: GatewaySession = {
      id: sessionId,
      title: buildGatewaySessionTitle(storedMessages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messageCount: storedMessages.length,
      messages: storedMessages,
      channel: body.gateway?.channel,
      peerId: body.gateway?.peerId,
      displayName: body.gateway?.displayName,
      isGroup: body.gateway?.isGroup,
      agentId: body.gateway?.agentId,
      sessionKey: body.gateway?.sessionKey ?? sessionId,
    }

    saveGatewaySession(session, {
      moldableHome: MOLDABLE_HOME,
      workspaceId: body.activeWorkspaceId,
    })

    sendJson(res, { text, sessionId })
  } catch (error) {
    console.error('❌ Gateway chat error:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Gateway chat failed',
      500,
    )
  }
}

function handleGatewaySessions(
  res: ServerResponse,
  workspaceId?: string | null,
): void {
  const sessions = listGatewaySessions({
    moldableHome: MOLDABLE_HOME,
    workspaceId,
  })
  sendJson(res, sessions)
}

function handleGatewaySession(
  res: ServerResponse,
  id: string,
  workspaceId?: string | null,
): void {
  const session = loadGatewaySession(id, {
    moldableHome: MOLDABLE_HOME,
    workspaceId,
  })
  if (!session) {
    sendError(res, 'Session not found', 404)
    return
  }
  sendJson(res, session)
}

function handleDeleteGatewaySession(
  res: ServerResponse,
  id: string,
  workspaceId?: string | null,
): void {
  deleteGatewaySession(id, {
    moldableHome: MOLDABLE_HOME,
    workspaceId,
  })
  sendJson(res, { ok: true })
}

/**
 * Format error messages to be more user-friendly
 * Handles AI SDK specific error types: https://ai-sdk.dev/docs/reference/ai-sdk-errors
 */
function formatErrorMessage(error: unknown): string {
  // Handle abort errors silently
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Request cancelled'
  }

  // Extract error name and message
  const errorName = error instanceof Error ? error.name : ''
  const message =
    error instanceof Error ? error.message : String(error || 'Unknown error')

  // Handle AI SDK specific errors by name
  switch (errorName) {
    case 'AI_APICallError':
      if (message.includes('401'))
        return 'API authentication failed. Please check your API key.'
      if (message.includes('403'))
        return 'API access denied. Your API key may not have access to this model.'
      if (message.includes('429'))
        return 'Rate limit exceeded. Please wait a moment and try again.'
      if (message.includes('500'))
        return 'The AI service encountered an error. Please try again.'
      if (message.includes('502') || message.includes('503'))
        return 'The AI service is temporarily unavailable.'
      return `API call failed: ${message}`

    case 'AI_LoadAPIKeyError':
      return 'API key not found. Please add your API key in settings.'

    case 'AI_InvalidArgumentError':
      return `Invalid request: ${message}`

    case 'AI_InvalidToolInputError':
      return `Tool input error: ${message}`

    case 'AI_NoSuchModelError':
      return 'The selected model is not available. Please choose a different model.'

    case 'AI_NoSuchProviderError':
      return 'The AI provider is not configured. Please check your settings.'

    case 'AI_NoSuchToolError':
      return `Tool not found: ${message}`

    case 'AI_MessageConversionError':
      return 'Failed to process messages. Try starting a new chat.'

    case 'AI_InvalidMessageRoleError':
      return 'Invalid message format. Try starting a new chat.'

    case 'AI_RetryError':
      return 'Request failed after multiple attempts. Please try again later.'

    case 'AI_EmptyResponseBodyError':
      return 'The AI service returned an empty response. Please try again.'

    case 'AI_InvalidResponseDataError':
      return 'Received invalid response from AI service. Please try again.'

    case 'AI_JSONParseError':
      return 'Failed to parse AI response. Please try again.'

    case 'AI_TypeValidationError':
      return `Response validation failed: ${message}`

    case 'AI_UnsupportedFunctionalityError':
      return `This feature is not supported: ${message}`

    case 'AI_UIMessageStreamError':
      return `Stream error: ${message}`

    case 'AI_NoContentGeneratedError':
      return 'The AI did not generate a response. Please try again.'

    case 'AI_NoObjectGeneratedError':
      return 'Failed to generate structured output. Please try again.'

    case 'AI_ToolCallRepairError':
      return 'Failed to repair tool call. Please try again.'

    case 'AI_TooManyEmbeddingValuesForCallError':
      return 'Too much content to process at once. Try with less content.'
  }

  // Handle common HTTP/network errors by message content
  if (message.includes('401') || message.includes('Unauthorized')) {
    return 'API authentication failed. Please check your API key is valid.'
  }
  if (message.includes('403') || message.includes('Forbidden')) {
    return 'API access denied. Your API key may not have access to this model.'
  }
  if (message.includes('429') || message.includes('rate limit')) {
    return 'Rate limit exceeded. Please wait a moment and try again.'
  }
  if (message.includes('500') || message.includes('Internal Server Error')) {
    return 'The AI service encountered an internal error. Please try again.'
  }
  if (message.includes('502') || message.includes('Bad Gateway')) {
    return 'The AI service is temporarily unavailable. Please try again.'
  }
  if (message.includes('503') || message.includes('Service Unavailable')) {
    return 'The AI service is overloaded. Please try again in a moment.'
  }
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return 'Could not connect to the AI service. Please check your network connection.'
  }
  if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
    return 'The request timed out. Please try again.'
  }
  if (
    message.includes('credit') ||
    message.includes('balance') ||
    message.includes('billing')
  ) {
    return 'API billing issue. Please check your account has sufficient credits.'
  }
  if (
    message.includes('context length') ||
    message.includes('token limit') ||
    message.includes('too long')
  ) {
    return 'The conversation is too long. Try starting a new chat or removing some messages.'
  }
  if (
    message.includes('invalid_api_key') ||
    message.includes('Invalid API key')
  ) {
    return 'Invalid API key. Please check your API key in settings.'
  }

  // Clean up the message
  const cleanedMessage = message
    .replace(/^Error:\s*/i, '')
    .replace(/^API error:\s*/i, '')
    .replace(/^\[.*?\]\s*/, '')

  return cleanedMessage || 'An unexpected error occurred. Please try again.'
}

// Re-read .env file and update process.env with fresh values
// This allows detecting newly added API keys without restarting the server
// NOTE: We manually parse instead of using dotenv's config() because
// config({ override: true }) doesn't reliably update process.env in all cases
function reloadEnvFile(): void {
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      // Clear existing API key values so we detect removal too
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY
      delete process.env.OPENROUTER_API_KEY

      // Manually parse and set env vars
      try {
        const content = readFileSync(envPath, 'utf-8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          // Skip comments and empty lines
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIndex = trimmed.indexOf('=')
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim()
            const value = trimmed.slice(eqIndex + 1).trim()
            // Only set API key env vars we care about
            if (
              key === 'ANTHROPIC_API_KEY' ||
              key === 'OPENAI_API_KEY' ||
              key === 'OPENROUTER_API_KEY'
            ) {
              process.env[key] = value
            }
          }
        }
      } catch (err) {
        console.error(`Failed to read env file ${envPath}:`, err)
      }
      break
    }
  }
}

// Handle health check
function handleHealth(res: ServerResponse): void {
  // Re-read .env to pick up newly added API keys
  reloadEnvFile()

  const openaiAuth = resolveOpenAIAuth()

  sendJson(res, {
    status: 'ok',
    version: '0.1.0',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasOpenAIKey: !!openaiAuth.apiKey,
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    openaiAuthSource:
      openaiAuth.source === 'none' ? undefined : openaiAuth.source,
    mcpServers: mcpServers.map((s) => ({
      name: s.name,
      status: s.status,
      toolCount: s.tools.length,
      error: s.error,
    })),
  })
}

// Handle MCP servers list
function handleMcpServers(res: ServerResponse): void {
  sendJson(res, {
    servers: mcpServers.map((s) => ({
      name: s.name,
      config: s.config,
      status: s.status,
      error: s.error,
      tools: s.tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    })),
  })
}

// Handle MCP reload
async function handleMcpReload(res: ServerResponse): Promise<void> {
  console.log('🔄 Reloading MCP connections...')
  try {
    mcpServers = await mcpManager.reload()
    const connected = mcpServers.filter((s) => s.status === 'connected')
    console.log(`✅ Reloaded: ${connected.length} connected`)
    sendJson(res, {
      success: true,
      servers: mcpServers.map((s) => ({
        name: s.name,
        status: s.status,
        toolCount: s.tools.length,
        error: s.error,
      })),
    })
  } catch (error) {
    console.error('❌ Error reloading MCP:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to reload MCP',
    )
  }
}

// Handle adding a new MCP server
async function handleAddMcpServer(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as {
    name?: string
    config?: {
      type?: 'stdio' | 'http' | 'sse'
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
    }
  }
  const { name, config: serverConfig } = body

  if (!name || !serverConfig) {
    sendError(res, 'name and config are required', 400)
    return
  }

  // Validate required fields based on type
  const type = serverConfig.type || (serverConfig.command ? 'stdio' : 'http')
  if (type === 'stdio' && !serverConfig.command) {
    sendError(res, 'command is required for stdio servers', 400)
    return
  }
  if ((type === 'http' || type === 'sse') && !serverConfig.url) {
    sendError(res, 'url is required for HTTP/SSE servers', 400)
    return
  }

  const mcpConfigPath = join(MOLDABLE_HOME, 'shared', 'config', 'mcp.json')

  try {
    addMcpServer(
      name,
      { ...serverConfig, type } as Parameters<typeof addMcpServer>[1],
      mcpConfigPath,
    )
    console.log(`✅ Added MCP server: ${name}`)
    sendJson(res, { success: true, name })
  } catch (error) {
    console.error('❌ Error adding MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to add server',
    )
  }
}

// Handle removing an MCP server
async function handleRemoveMcpServer(
  name: string,
  res: ServerResponse,
): Promise<void> {
  const mcpConfigPath = join(MOLDABLE_HOME, 'shared', 'config', 'mcp.json')

  try {
    removeMcpServer(name, mcpConfigPath)
    console.log(`🗑️  Removed MCP server: ${name}`)
    sendJson(res, { success: true, name })
  } catch (error) {
    console.error('❌ Error removing MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to remove server',
    )
  }
}

// Handle updating an MCP server config
async function handleUpdateMcpServer(
  name: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as {
    config?: {
      type?: 'stdio' | 'http' | 'sse'
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
      disabled?: boolean
    }
  }
  const { config: newConfig } = body

  if (!newConfig) {
    sendError(res, 'config is required', 400)
    return
  }

  const mcpConfigPath = join(MOLDABLE_HOME, 'shared', 'config', 'mcp.json')

  try {
    // Validate required fields based on type
    const type = newConfig.type || (newConfig.command ? 'stdio' : 'http')
    if (type === 'stdio' && !newConfig.command) {
      sendError(res, 'command is required for stdio servers', 400)
      return
    }
    if ((type === 'http' || type === 'sse') && !newConfig.url) {
      sendError(res, 'url is required for HTTP/SSE servers', 400)
      return
    }

    addMcpServer(
      name,
      { ...newConfig, type } as Parameters<typeof addMcpServer>[1],
      mcpConfigPath,
    )
    console.log(`✏️  Updated MCP server: ${name}`)
    sendJson(res, { success: true, name })
  } catch (error) {
    console.error('❌ Error updating MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to update server',
    )
  }
}

// Handle toggling an MCP server enabled/disabled
async function handleToggleMcpServer(
  name: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as { enabled?: boolean }
  const { enabled } = body

  if (typeof enabled !== 'boolean') {
    sendError(res, 'enabled (boolean) is required', 400)
    return
  }

  const mcpConfigPath = join(MOLDABLE_HOME, 'shared', 'config', 'mcp.json')

  try {
    // Get current config
    const currentConfig = getMcpServer(name, mcpConfigPath)
    if (!currentConfig) {
      sendError(res, `Server "${name}" not found`, 404)
      return
    }

    // Update with disabled flag
    const updatedConfig = {
      ...currentConfig,
      disabled: !enabled,
    }

    addMcpServer(name, updatedConfig, mcpConfigPath)
    console.log(
      `🔀 Toggled MCP server "${name}": ${enabled ? 'enabled' : 'disabled'}`,
    )
    sendJson(res, { success: true, name, enabled })
  } catch (error) {
    console.error('❌ Error toggling MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to toggle server',
    )
  }
}

// Handle installing an MCPB bundle
async function handleInstallBundle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as {
    bundlePath?: string
    userConfig?: Record<string, string | number | boolean | string[]>
  }
  const { bundlePath, userConfig } = body

  if (!bundlePath) {
    sendError(res, 'bundlePath is required', 400)
    return
  }

  try {
    // Read file directly from filesystem
    const { readFileSync } = await import('fs')
    const buffer = readFileSync(bundlePath)
    const bytes = new Uint8Array(buffer)
    console.log(`📦 Installing bundle from: ${bundlePath}`)

    // Extract ZIP
    const unzipped = unzipSync(bytes)

    // Parse manifest
    const manifestFile = unzipped['manifest.json']
    if (!manifestFile) {
      sendError(res, 'manifest.json not found in bundle', 400)
      return
    }

    const manifestJson = strFromU8(manifestFile)
    const manifest = parseManifest(JSON.parse(manifestJson))

    // Create install directory
    const installDir = join(getMcpbInstallDir(), manifest.name)
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true })
    }
    mkdirSync(installDir, { recursive: true })

    // Extract all files to install directory
    for (const [path, data] of Object.entries(unzipped)) {
      const fullPath = join(installDir, path)
      const dir = dirname(fullPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(fullPath, data)
    }

    // Make binaries executable on Unix
    if (manifest.server.type === 'binary' && process.platform !== 'win32') {
      const { chmodSync } = await import('fs')
      const entryPath = join(installDir, manifest.server.entry_point)
      if (existsSync(entryPath)) {
        chmodSync(entryPath, 0o755)
      }
    }

    // Install npm dependencies for node bundles
    const packageJsonPath = join(installDir, 'package.json')
    if (manifest.server.type === 'node' && existsSync(packageJsonPath)) {
      console.log(`📦 Installing npm dependencies for ${manifest.name}...`)
      const { execSync } = await import('child_process')
      const { resolveExecutablePath, getAugmentedPath } = await import(
        '@moldable-ai/mcp'
      )
      try {
        const npmPath = resolveExecutablePath('npm')
        execSync(`"${npmPath}" install --omit=dev`, {
          cwd: installDir,
          stdio: 'inherit',
          timeout: 120000,
          env: {
            ...process.env,
            PATH: getAugmentedPath(),
          },
        })
        console.log(`✅ Dependencies installed for ${manifest.name}`)
      } catch (npmError) {
        console.error(`⚠️ Failed to install npm dependencies:`, npmError)
        // Continue anyway - some bundles might not need deps
      }
    }

    // Install to MCP config
    const mcpConfigPath = join(MOLDABLE_HOME, 'shared', 'config', 'mcp.json')
    const result = installBundleFromExtracted(
      installDir,
      userConfig || {},
      mcpConfigPath,
    )

    console.log(`📦 Installed MCPB bundle: ${manifest.name}`)
    sendJson(res, {
      success: true,
      name: result.name,
      installPath: installDir,
    })
  } catch (error) {
    console.error('❌ Error installing bundle:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to install bundle',
    )
  }
}

async function handleListSkillRepos(res: ServerResponse): Promise<void> {
  try {
    const result = (await skillsTools.listSkillRepos.execute!(
      {},
      skillsToolContext,
    )) as {
      success?: boolean
      repositories?: Array<{
        name: string
        url: string
        enabled: boolean
        mode: string
        skills: string[]
        lastSync?: string
      }>
      error?: string
    }

    if (result.success === false) {
      sendJson(res, {
        success: false,
        error: result.error,
        repositories: [],
      })
      return
    }

    const repositories =
      result.repositories?.map((repo) => ({
        ...repo,
        installedSkills: getInstalledSkills(repo.name),
      })) ?? []

    sendJson(res, { success: true, repositories })
  } catch (error) {
    console.error('❌ Error listing skills:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to list skills',
    )
  }
}

async function handleAddSkillRepo(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as {
    url?: string
    name?: string
    branch?: string
    skillsPath?: string
    mode?: 'all' | 'include' | 'exclude'
    skills?: string[]
    sync?: boolean
  }

  if (!body.url) {
    sendError(res, 'url is required', 400)
    return
  }

  const normalizedUrl = normalizeSkillRepoInput(body.url)
  if (!normalizedUrl) {
    sendError(res, 'Invalid repository URL. Use owner/repo format.', 400)
    return
  }

  try {
    const addResult = (await skillsTools.addSkillRepo.execute!(
      {
        url: normalizedUrl,
        name: body.name,
        branch: body.branch,
        skillsPath: body.skillsPath,
        mode: body.mode,
        skills: body.skills,
      },
      skillsToolContext,
    )) as {
      success?: boolean
      name?: string
      url?: string
      availableSkills?: string[]
      error?: string
    }

    if (addResult.success === false) {
      sendJson(res, addResult, 400)
      return
    }

    let syncResult:
      | {
          success?: boolean
          synced?: number
          failed?: number
          skills?: string[]
          error?: string
        }
      | undefined

    if (body.sync !== false && addResult.name) {
      syncResult = (await skillsTools.syncSkills.execute!(
        { repoName: addResult.name },
        skillsToolContext,
      )) as {
        success?: boolean
        synced?: number
        failed?: number
        skills?: string[]
        error?: string
      }
    }

    sendJson(res, {
      success: true,
      ...addResult,
      sync: syncResult,
    })
  } catch (error) {
    console.error('❌ Error adding skill repo:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to add skill repo',
    )
  }
}

async function handleSyncSkills(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as { repoName?: string }

  try {
    const result = (await skillsTools.syncSkills.execute!(
      { repoName: body.repoName },
      skillsToolContext,
    )) as {
      success?: boolean
      synced?: number
      failed?: number
      skills?: string[]
      error?: string
    }

    if (result.success === false) {
      sendJson(res, result, 400)
      return
    }

    sendJson(res, result)
  } catch (error) {
    console.error('❌ Error syncing skills:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to sync skills',
    )
  }
}

async function handleListAvailableSkills(
  name: string,
  res: ServerResponse,
): Promise<void> {
  if (!name) {
    sendError(res, 'Repository name is required', 400)
    return
  }

  try {
    const result = (await skillsTools.listAvailableSkills.execute!(
      { repoName: name },
      skillsToolContext,
    )) as {
      success?: boolean
      repoName?: string
      available?: string[]
      selected?: string[]
      mode?: 'all' | 'include' | 'exclude'
      error?: string
    }

    if (result.success === false) {
      sendJson(res, result, 400)
      return
    }

    sendJson(res, {
      success: true,
      repoName: result.repoName,
      available: result.available || [],
      selected: result.selected || [],
      mode: result.mode,
    })
  } catch (error) {
    console.error('❌ Error listing available skills:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to list skills',
    )
  }
}

async function handleUpdateSkillSelection(
  name: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!name) {
    sendError(res, 'Repository name is required', 400)
    return
  }

  const body = (await parseBody(req)) as {
    mode?: 'all' | 'include' | 'exclude'
    skills?: string[]
    sync?: boolean
  }

  const hasSkills = Array.isArray(body.skills)
  if (!body.mode && !hasSkills) {
    sendError(res, 'mode or skills are required', 400)
    return
  }

  const nextMode = body.mode || 'include'

  try {
    const updateResult = (await skillsTools.updateSkillSelection.execute!(
      {
        repoName: name,
        mode: nextMode,
        skills: hasSkills ? body.skills : undefined,
      },
      skillsToolContext,
    )) as {
      success?: boolean
      repoName?: string
      mode?: 'all' | 'include' | 'exclude'
      skills?: string[]
      enabled?: boolean
      error?: string
    }

    if (updateResult.success === false) {
      sendJson(res, updateResult, 400)
      return
    }

    if (nextMode === 'include' && hasSkills && body.skills) {
      pruneUnselectedSkills(name, body.skills)
    }

    let syncResult:
      | {
          success?: boolean
          synced?: number
          failed?: number
          skills?: string[]
          error?: string
        }
      | undefined

    if (body.sync) {
      syncResult = (await skillsTools.syncSkills.execute!(
        { repoName: name },
        skillsToolContext,
      )) as {
        success?: boolean
        synced?: number
        failed?: number
        skills?: string[]
        error?: string
      }
    }

    sendJson(res, {
      success: true,
      repoName: updateResult.repoName,
      mode: updateResult.mode,
      skills: updateResult.skills,
      enabled: updateResult.enabled,
      sync: syncResult,
    })
  } catch (error) {
    console.error('❌ Error updating skill selection:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to update selection',
    )
  }
}

async function handleRemoveSkillRepo(
  name: string,
  res: ServerResponse,
): Promise<void> {
  if (!name) {
    sendError(res, 'Repository name is required', 400)
    return
  }

  if (!existsSync(SKILLS_CONFIG_PATH)) {
    sendError(res, 'No skills config found', 404)
    return
  }

  try {
    const config = JSON.parse(readFileSync(SKILLS_CONFIG_PATH, 'utf-8')) as {
      repositories?: Array<{
        name: string
        url: string
      }>
    }

    const repositories = config.repositories ?? []
    const index = repositories.findIndex((repo) => repo.name === name)

    if (index === -1) {
      sendError(res, `Repository "${name}" not found`, 404)
      return
    }

    const [removed] = repositories.splice(index, 1)
    if (!removed) {
      sendError(res, `Repository "${name}" not found`, 404)
      return
    }

    writeFileSync(SKILLS_CONFIG_PATH, JSON.stringify({ repositories }, null, 2))

    const repoDir = join(SKILLS_DIR, sanitizeRepoDir(removed.name))
    if (existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true })
    }

    sendJson(res, { success: true, name: removed.name, url: removed.url })
  } catch (error) {
    console.error('❌ Error removing skill repo:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to remove skill repo',
    )
  }
}

// Create HTTP server
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${getHost()}:${getPort()}`)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders)
    res.end()
    return
  }

  // Route requests
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    await handleChat(req, res)
  } else if (url.pathname === '/api/gateway/chat' && req.method === 'POST') {
    await handleGatewayChat(req, res)
  } else if (url.pathname === '/api/gateway/sessions' && req.method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId')
    handleGatewaySessions(res, workspaceId)
  } else if (
    url.pathname.startsWith('/api/gateway/sessions/') &&
    req.method === 'GET'
  ) {
    const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '')
    const workspaceId = url.searchParams.get('workspaceId')
    if (!sessionId) {
      sendError(res, 'Session ID required', 400)
      return
    }
    handleGatewaySession(res, sessionId, workspaceId)
  } else if (
    url.pathname.startsWith('/api/gateway/sessions/') &&
    req.method === 'DELETE'
  ) {
    const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '')
    const workspaceId = url.searchParams.get('workspaceId')
    if (!sessionId) {
      sendError(res, 'Session ID required', 400)
      return
    }
    handleDeleteGatewaySession(res, sessionId, workspaceId)
  } else if (url.pathname === '/health' && req.method === 'GET') {
    handleHealth(res)
  } else if (url.pathname === '/api/mcp/servers' && req.method === 'GET') {
    handleMcpServers(res)
  } else if (url.pathname === '/api/mcp/servers' && req.method === 'POST') {
    await handleAddMcpServer(req, res)
  } else if (
    url.pathname.startsWith('/api/mcp/servers/') &&
    url.pathname.endsWith('/toggle') &&
    req.method === 'POST'
  ) {
    // Extract server name from /api/mcp/servers/:name/toggle
    const pathParts = url.pathname.split('/')
    const name = decodeURIComponent(pathParts[pathParts.length - 2] || '')
    await handleToggleMcpServer(name, req, res)
  } else if (
    url.pathname.startsWith('/api/mcp/servers/') &&
    req.method === 'PUT'
  ) {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '')
    await handleUpdateMcpServer(name, req, res)
  } else if (
    url.pathname.startsWith('/api/mcp/servers/') &&
    req.method === 'DELETE'
  ) {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '')
    await handleRemoveMcpServer(name, res)
  } else if (url.pathname === '/api/mcp/reload' && req.method === 'POST') {
    await handleMcpReload(res)
  } else if (
    url.pathname === '/api/mcp/install-bundle' &&
    req.method === 'POST'
  ) {
    await handleInstallBundle(req, res)
  } else if (url.pathname === '/api/skills/repos' && req.method === 'GET') {
    await handleListSkillRepos(res)
  } else if (
    url.pathname.startsWith('/api/skills/repos/') &&
    url.pathname.endsWith('/available') &&
    req.method === 'GET'
  ) {
    const pathParts = url.pathname.split('/')
    const name = decodeURIComponent(pathParts[pathParts.length - 2] || '')
    await handleListAvailableSkills(name, res)
  } else if (
    url.pathname.startsWith('/api/skills/repos/') &&
    url.pathname.endsWith('/selection') &&
    req.method === 'POST'
  ) {
    const pathParts = url.pathname.split('/')
    const name = decodeURIComponent(pathParts[pathParts.length - 2] || '')
    await handleUpdateSkillSelection(name, req, res)
  } else if (url.pathname === '/api/skills/add' && req.method === 'POST') {
    await handleAddSkillRepo(req, res)
  } else if (url.pathname === '/api/skills/sync' && req.method === 'POST') {
    await handleSyncSkills(req, res)
  } else if (
    url.pathname.startsWith('/api/skills/repos/') &&
    req.method === 'DELETE'
  ) {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '')
    await handleRemoveSkillRepo(name, res)
  } else {
    sendError(res, 'Not found', 404)
  }
})

// Start server
const port = getPort()
const host = getHost()
server.listen(port, host, async () => {
  console.log(`🤖 Moldable AI server running at http://${host}:${port}`)
  console.log(`   MOLDABLE_HOME: ${MOLDABLE_HOME}`)
  console.log(
    `   Development workspace: ${WORKSPACE_ROOT || '(not configured)'}`,
  )
  const openaiAuth = resolveOpenAIAuth()
  console.log(
    `   Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`,
  )
  const openaiLabel =
    openaiAuth.source === 'env'
      ? '✓'
      : openaiAuth.source === 'codex-cli'
        ? '✓ (Codex CLI)'
        : '✗'
  console.log(`   OpenAI API key: ${openaiLabel}`)
  console.log(
    `   OpenRouter API key: ${process.env.OPENROUTER_API_KEY ? '✓' : '✗'}`,
  )

  // Initialize MCP connections after server starts
  await initMcpConnections()
})

// Handle shutdown gracefully for both SIGINT (Ctrl+C) and SIGTERM (kill)
const shutdown = async () => {
  console.log('\n🛑 Shutting down AI server...')

  // Disconnect MCP servers
  console.log('   Disconnecting MCP servers...')
  await mcpManager.disconnectAll()

  server.close(() => {
    console.log('✅ AI server stopped')
    process.exit(0)
  })
  // Force exit after 5 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('⚠️ Forcing exit...')
    process.exit(0)
  }, 5000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
