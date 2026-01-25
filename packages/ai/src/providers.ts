import {
  type AnthropicReasoningEffort,
  LLMProvider,
  type OpenAIReasoningEffort,
  type ReasoningEffort,
} from './types'
import { type AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic'
import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

// Model configuration
type ModelConfig = {
  temperature: number
  isReasoning: boolean
}

const MODEL_CONFIG: Record<LLMProvider, ModelConfig> = {
  [LLMProvider.Anthropic_Claude_Opus_4_5]: {
    temperature: 1.0,
    isReasoning: true,
  },
  [LLMProvider.Anthropic_Claude_Sonnet_4_5]: {
    temperature: 1.0,
    isReasoning: true,
  },
  [LLMProvider.OpenAI_GPT_5_2_Codex]: {
    temperature: 1.0,
    isReasoning: true,
  },
  [LLMProvider.OpenRouter_MiniMax_M2_1]: {
    temperature: 1.0,
    isReasoning: true,
  },
  [LLMProvider.OpenRouter_Google_Gemini_3_Flash]: {
    temperature: 1.0,
    isReasoning: true,
  },
  [LLMProvider.OpenRouter_Google_Gemini_3_Pro]: {
    temperature: 1.0,
    isReasoning: true,
  },
  [LLMProvider.OpenRouter_XAI_Grok_Code_Fast_1]: {
    temperature: 1.0,
    isReasoning: true,
  },
  [LLMProvider.OpenRouter_ZAI_GLM_4_7]: {
    temperature: 1.0,
    isReasoning: true,
  },
}

/**
 * Map Anthropic reasoning effort to budget tokens
 * Based on Anthropic's extended thinking documentation
 * 'none' maps to 0 but is handled specially (no thinking config sent)
 */
const ANTHROPIC_BUDGET_TOKENS: Record<AnthropicReasoningEffort, number> = {
  none: 0,
  low: 5000,
  medium: 10000,
  high: 20000,
  xhigh: 50000,
}

// Lazy client creation
let anthropicClient: AnthropicProvider | null = null
const openaiClients = new Map<string, OpenAIProvider>()
let openrouterClient: ReturnType<typeof createOpenRouter> | null = null

function getAnthropicClient(apiKey: string): AnthropicProvider {
  if (!anthropicClient) {
    anthropicClient = createAnthropic({ apiKey })
  }
  return anthropicClient
}

type OpenAIClientOptions = {
  baseURL?: string
  organization?: string
  project?: string
  headers?: Record<string, string>
}

function getOpenAIClient(
  apiKey: string,
  options?: OpenAIClientOptions,
): OpenAIProvider {
  const baseURL = options?.baseURL?.trim() || undefined
  const organization = options?.organization?.trim() || undefined
  const project = options?.project?.trim() || undefined
  const headersEntries = options?.headers
    ? Object.entries(options.headers)
        .filter(([key, value]) => key && value)
        .sort(([a], [b]) => a.localeCompare(b))
    : undefined
  const cacheKey = JSON.stringify({
    apiKey,
    baseURL,
    organization,
    project,
    headers: headersEntries,
  })
  let client = openaiClients.get(cacheKey)
  if (!client) {
    client = createOpenAI({
      apiKey,
      baseURL,
      organization,
      project,
      headers: options?.headers,
    })
    openaiClients.set(cacheKey, client)
  }
  return client
}

function getOpenRouterClient(
  apiKey: string,
): ReturnType<typeof createOpenRouter> {
  if (!openrouterClient) {
    openrouterClient = createOpenRouter({ apiKey })
  }
  return openrouterClient
}

export type ProviderConfig = {
  // Note: OpenRouter SDK returns LanguageModelV2 (AI SDK v5 compatible)
  // while we use AI SDK v6 (LanguageModelV3). Type escape is intentional.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any
  temperature: number | undefined
  isReasoning: boolean
  providerOptions?: Record<string, unknown>
}

export type OpenAIApiMode = 'responses' | 'chat' | 'auto'

export type ProviderConfigOptions = {
  openaiMode?: OpenAIApiMode
  openaiInstructions?: string
}

type ApiKeys = {
  anthropicApiKey?: string
  openaiApiKey?: string
  openrouterApiKey?: string
  openaiBaseUrl?: string
  openaiOrganization?: string
  openaiProject?: string
  openaiHeaders?: Record<string, string>
}

/**
 * Build config for OpenRouter-routed models
 */
function buildOpenRouterConfig(
  apiKey: string,
  modelId: string,
  config: ModelConfig,
  reasoningEffort: ReasoningEffort = 'medium',
): ProviderConfig {
  const client = getOpenRouterClient(apiKey)
  // Use reasoning if model supports it AND user hasn't disabled it
  const reasoningDisabled = reasoningEffort === 'none'
  const useReasoning = config.isReasoning && !reasoningDisabled
  return {
    model: client(modelId),
    temperature: config.temperature,
    isReasoning: useReasoning,
    providerOptions: useReasoning
      ? { reasoning: { enabled: true } }
      : undefined,
  }
}

/**
 * Get the provider configuration for a given LLM provider
 */
export function getProviderConfig(
  provider: LLMProvider,
  apiKeys: ApiKeys,
  reasoningEffort: ReasoningEffort = 'medium',
  options?: ProviderConfigOptions,
): ProviderConfig {
  const config = MODEL_CONFIG[provider]

  // Validate that config exists for this provider
  if (!config) {
    throw new Error(`Unknown model: ${provider}. No configuration found.`)
  }

  const isAnthropic = provider.startsWith('anthropic/')
  const isOpenRouter = provider.startsWith('openrouter/')

  // Anthropic models: prefer direct API, fall back to OpenRouter
  if (isAnthropic) {
    if (apiKeys.anthropicApiKey) {
      const client = getAnthropicClient(apiKeys.anthropicApiKey)
      const modelId = provider.replace('anthropic/', '')

      // Check if reasoning is disabled
      const reasoningDisabled = reasoningEffort === 'none'
      const anthropicEffort = (
        ['low', 'medium', 'high', 'xhigh'].includes(reasoningEffort)
          ? reasoningEffort
          : 'medium'
      ) as AnthropicReasoningEffort

      // Use reasoning if model supports it AND user hasn't disabled it
      const useReasoning = config.isReasoning && !reasoningDisabled

      return {
        model: client(modelId),
        // Anthropic doesn't allow temperature when thinking is enabled
        temperature: useReasoning ? undefined : config.temperature,
        isReasoning: useReasoning,
        providerOptions: useReasoning
          ? {
              anthropic: {
                thinking: {
                  type: 'enabled',
                  budgetTokens: ANTHROPIC_BUDGET_TOKENS[anthropicEffort],
                },
              },
            }
          : undefined,
      }
    }

    if (apiKeys.openrouterApiKey) {
      // Map internal ID to OpenRouter format: 'anthropic/claude-opus-4-5' -> 'anthropic/claude-opus-4.5'
      const modelId = provider.replace(/-(\d+)-(\d+)$/, '-$1.$2')
      return buildOpenRouterConfig(
        apiKeys.openrouterApiKey,
        modelId,
        config,
        reasoningEffort,
      )
    }

    throw new Error('Anthropic API key or OpenRouter API key is required')
  }

  // OpenRouter-native models: require OpenRouter key
  if (isOpenRouter) {
    if (!apiKeys.openrouterApiKey) {
      throw new Error('OpenRouter API key is required')
    }
    // Strip 'openrouter/' prefix: 'openrouter/minimax/minimax-m2.1' -> 'minimax/minimax-m2.1'
    const modelId = provider.replace('openrouter/', '')
    return buildOpenRouterConfig(
      apiKeys.openrouterApiKey,
      modelId,
      config,
      reasoningEffort,
    )
  }

  // OpenAI models: prefer direct API, fall back to OpenRouter
  if (apiKeys.openaiApiKey) {
    const client = getOpenAIClient(apiKeys.openaiApiKey, {
      baseURL: apiKeys.openaiBaseUrl,
      organization: apiKeys.openaiOrganization,
      project: apiKeys.openaiProject,
      headers: apiKeys.openaiHeaders,
    })
    const modelId = provider.replace('openai/', '')

    // Check if reasoning is disabled (user hasn't verified org, etc.)
    const reasoningDisabled = reasoningEffort === 'none'
    const useReasoning = config.isReasoning && !reasoningDisabled
    const envModeRaw =
      process.env.MOLDABLE_OPENAI_API_MODE?.toLowerCase() ??
      process.env.OPENAI_API_MODE?.toLowerCase()
    const envMode =
      envModeRaw === 'responses' || envModeRaw === 'chat'
        ? (envModeRaw as OpenAIApiMode)
        : undefined
    const useChatFromEnv =
      process.env.MOLDABLE_OPENAI_USE_CHAT_COMPLETIONS === '1' ||
      process.env.OPENAI_USE_CHAT_COMPLETIONS === '1'
    const resolvedMode: OpenAIApiMode =
      options?.openaiMode ?? envMode ?? (useChatFromEnv ? 'chat' : 'chat')
    const shouldUseChat = resolvedMode !== 'responses'

    if (shouldUseChat) {
      return {
        model: client.chat(modelId),
        temperature: config.temperature,
        isReasoning: false,
        providerOptions: {
          openai: {
            store: false,
          },
        },
      }
    }

    return {
      model: client.responses(modelId),
      temperature: config.temperature,
      isReasoning: useReasoning,
      providerOptions: {
        openai: {
          store: false,
          instructions: options?.openaiInstructions,
          ...(useReasoning
            ? {
                reasoningSummary: 'auto',
                reasoningEffort: reasoningEffort as OpenAIReasoningEffort,
              }
            : {}),
        },
      },
    }
  }

  if (apiKeys.openrouterApiKey) {
    // OpenRouter uses full model ID for OpenAI models: 'openai/gpt-5.2-codex'
    return buildOpenRouterConfig(
      apiKeys.openrouterApiKey,
      provider,
      config,
      reasoningEffort,
    )
  }

  throw new Error('OpenAI API key or OpenRouter API key is required')
}
