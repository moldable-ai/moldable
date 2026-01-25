import { tool, zodSchema } from 'ai'
import { z } from 'zod/v4'

export type GatewayToolContext = {
  sessionKey?: string
  channel?: string
  chatId?: string
  peerId?: string
  isGroup?: boolean
  agentId?: string
  workspaceId?: string
}

export type GatewayToolsOptions = {
  baseUrl: string
  token?: string
  context?: GatewayToolContext
}

type GatewayFetchOptions = {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  body?: unknown
}

function normalizeBaseUrl(value: string): string {
  if (!value.trim()) return value
  return value.endsWith('/') ? value.slice(0, -1) : value
}

async function gatewayFetch(
  baseUrl: string,
  token: string | undefined,
  { method, path, body }: GatewayFetchOptions,
): Promise<unknown> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Gateway error (${res.status}): ${text}`)
  }
  if (!text) return {}
  return JSON.parse(text)
}

export function createGatewayTools(options: GatewayToolsOptions) {
  const { baseUrl, token, context } = options

  const spawnSubagentSchema = z.object({
    task: z.string().describe('Task for the subagent to execute'),
    label: z
      .string()
      .optional()
      .describe('Optional label for the subagent run'),
    agentId: z
      .string()
      .optional()
      .describe('Agent id to run the subagent under'),
    sessionKey: z
      .string()
      .optional()
      .describe('Requester session key (defaults to current gateway session)'),
    deliverToChannel: z
      .boolean()
      .optional()
      .describe('Whether to deliver the subagent result to the channel'),
    model: z.string().optional().describe('Override model for the subagent'),
    reasoningEffort: z
      .string()
      .optional()
      .describe('Reasoning effort override'),
    workspaceId: z.string().optional().describe('Workspace id for the run'),
  })

  const cronCreateSchema = z.object({
    schedule: z
      .string()
      .describe('Cron schedule in 5-field format, e.g. */5 * * * *'),
    timezone: z.string().optional().describe('Optional IANA timezone'),
    enabled: z.boolean().optional().describe('Enable or disable the job'),
    agentId: z.string().optional().describe('Agent id to run the job under'),
    sessionKey: z
      .string()
      .optional()
      .describe('Session key to store the cron conversation under'),
    channel: z.string().optional().describe('Channel to deliver results to'),
    chatId: z.string().optional().describe('Chat id to deliver results to'),
    peerId: z
      .string()
      .optional()
      .describe('Peer id (DM sender) for the session key'),
    isGroup: z
      .boolean()
      .optional()
      .describe('Whether the target chat is a group'),
    task: z.string().describe('Task message for the cron job'),
    model: z.string().optional().describe('Model override'),
    reasoningEffort: z
      .string()
      .optional()
      .describe('Reasoning effort override'),
  })

  const cronIdSchema = z.object({
    id: z.string().describe('Cron job id'),
  })

  const subagentIdSchema = z.object({
    runId: z.string().describe('Subagent run id'),
  })

  return {
    gatewaySpawnSubagent: tool({
      description:
        'Spawn a subagent run via the Moldable Gateway. Use for delegating tasks.',
      inputSchema: zodSchema(spawnSubagentSchema),
      execute: async (input) => {
        const sessionKey = input.sessionKey ?? context?.sessionKey
        if (!sessionKey) {
          return {
            success: false,
            error: 'Missing sessionKey for subagent spawn.',
          }
        }
        const body = {
          task: input.task,
          label: input.label,
          agent_id: input.agentId ?? context?.agentId,
          requester_session_key: sessionKey,
          requester_channel: context?.channel,
          requester_chat_id: context?.chatId,
          requester_peer_id: context?.peerId,
          requester_is_group: context?.isGroup,
          deliver_to_channel: input.deliverToChannel ?? true,
          model: input.model,
          reasoning_effort: input.reasoningEffort,
          workspace_id: input.workspaceId ?? context?.workspaceId,
        }
        const data = await gatewayFetch(baseUrl, token, {
          method: 'POST',
          path: '/api/agents/subagents/spawn',
          body,
        })
        return { success: true, run: data }
      },
    }),

    gatewayListSubagents: tool({
      description: 'List subagent runs from the Moldable Gateway.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const data = await gatewayFetch(baseUrl, token, {
          method: 'GET',
          path: '/api/agents/subagents',
        })
        return { success: true, runs: data }
      },
    }),

    gatewayGetSubagent: tool({
      description: 'Get a specific subagent run by id.',
      inputSchema: zodSchema(subagentIdSchema),
      execute: async (input) => {
        const data = await gatewayFetch(baseUrl, token, {
          method: 'GET',
          path: `/api/agents/subagents/${encodeURIComponent(input.runId)}`,
        })
        return { success: true, run: data }
      },
    }),

    gatewayDeleteSubagent: tool({
      description: 'Delete a subagent run record by id.',
      inputSchema: zodSchema(subagentIdSchema),
      execute: async (input) => {
        const data = await gatewayFetch(baseUrl, token, {
          method: 'DELETE',
          path: `/api/agents/subagents/${encodeURIComponent(input.runId)}`,
        })
        return { success: true, result: data }
      },
    }),

    gatewayCreateCronJob: tool({
      description: 'Create a cron job via the Moldable Gateway.',
      inputSchema: zodSchema(cronCreateSchema),
      execute: async (input) => {
        const body = {
          schedule: input.schedule,
          timezone: input.timezone,
          enabled: input.enabled,
          agent_id: input.agentId ?? context?.agentId,
          session_key: input.sessionKey ?? context?.sessionKey,
          channel: input.channel ?? context?.channel,
          chat_id: input.chatId ?? context?.chatId,
          peer_id: input.peerId ?? context?.peerId,
          is_group: input.isGroup ?? context?.isGroup,
          task: input.task,
          model: input.model,
          reasoning_effort: input.reasoningEffort,
        }
        const data = await gatewayFetch(baseUrl, token, {
          method: 'POST',
          path: '/api/cron/jobs',
          body,
        })
        return { success: true, job: data }
      },
    }),

    gatewayListCronJobs: tool({
      description: 'List cron jobs from the Moldable Gateway.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const data = await gatewayFetch(baseUrl, token, {
          method: 'GET',
          path: '/api/cron/jobs',
        })
        return { success: true, jobs: data }
      },
    }),

    gatewayGetCronJob: tool({
      description: 'Fetch a cron job by id.',
      inputSchema: zodSchema(cronIdSchema),
      execute: async (input) => {
        const data = await gatewayFetch(baseUrl, token, {
          method: 'GET',
          path: `/api/cron/jobs/${encodeURIComponent(input.id)}`,
        })
        return { success: true, job: data }
      },
    }),

    gatewayDeleteCronJob: tool({
      description: 'Delete a cron job by id.',
      inputSchema: zodSchema(cronIdSchema),
      execute: async (input) => {
        const data = await gatewayFetch(baseUrl, token, {
          method: 'DELETE',
          path: `/api/cron/jobs/${encodeURIComponent(input.id)}`,
        })
        return { success: true, result: data }
      },
    }),

    gatewayRunCronJob: tool({
      description: 'Run a cron job immediately.',
      inputSchema: zodSchema(cronIdSchema),
      execute: async (input) => {
        const data = await gatewayFetch(baseUrl, token, {
          method: 'POST',
          path: `/api/cron/jobs/${encodeURIComponent(input.id)}/run`,
        })
        return { success: true, job: data }
      },
    }),
  }
}
