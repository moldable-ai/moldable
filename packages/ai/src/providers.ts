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
  [LLMProvider.OpenAI_GPT_5_2]: {
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
}

/**
 * Map Anthropic reasoning effort to budget tokens
 * Based on Anthropic's extended thinking documentation
 */
const ANTHROPIC_BUDGET_TOKENS: Record<AnthropicReasoningEffort, number> = {
  low: 5000,
  medium: 10000,
  high: 20000,
  xhigh: 50000,
}

// Lazy client creation
let anthropicClient: AnthropicProvider | null = null
let openaiClient: OpenAIProvider | null = null
let openrouterClient: ReturnType<typeof createOpenRouter> | null = null

function getAnthropicClient(apiKey: string): AnthropicProvider {
  if (!anthropicClient) {
    anthropicClient = createAnthropic({ apiKey })
  }
  return anthropicClient
}

function getOpenAIClient(apiKey: string): OpenAIProvider {
  if (!openaiClient) {
    openaiClient = createOpenAI({ apiKey })
  }
  return openaiClient
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

type ApiKeys = {
  anthropicApiKey?: string
  openaiApiKey?: string
  openrouterApiKey?: string
}

/**
 * Get the provider configuration for a given LLM provider
 */
export function getProviderConfig(
  provider: LLMProvider,
  apiKeys: ApiKeys,
  reasoningEffort: ReasoningEffort = 'medium',
): ProviderConfig {
  const config = MODEL_CONFIG[provider]
  const isAnthropic = provider.startsWith('anthropic/')
  const isOpenRouter = provider.startsWith('openrouter/')

  // Validate that config exists for this provider
  if (!config) {
    throw new Error(`Unknown model: ${provider}. No configuration found.`)
  }

  if (isAnthropic) {
    if (!apiKeys.anthropicApiKey) {
      throw new Error('Anthropic API key is required')
    }

    const client = getAnthropicClient(apiKeys.anthropicApiKey)
    const modelId = provider.replace('anthropic/', '')

    // Map reasoning effort to budget tokens (default to 'medium' if not a valid Anthropic effort)
    const anthropicEffort = (
      ['low', 'medium', 'high', 'xhigh'].includes(reasoningEffort)
        ? reasoningEffort
        : 'medium'
    ) as AnthropicReasoningEffort
    const budgetTokens = ANTHROPIC_BUDGET_TOKENS[anthropicEffort]

    return {
      model: client(modelId),
      // Anthropic doesn't allow temperature when thinking is enabled
      temperature: config.isReasoning ? undefined : config.temperature,
      isReasoning: config.isReasoning,
      providerOptions: config.isReasoning
        ? {
            anthropic: {
              thinking: {
                type: 'enabled',
                budgetTokens,
              },
            },
          }
        : undefined,
    }
  }

  if (isOpenRouter) {
    if (!apiKeys.openrouterApiKey) {
      throw new Error('OpenRouter API key is required')
    }

    const client = getOpenRouterClient(apiKeys.openrouterApiKey)
    // OpenRouter model ID is everything after 'openrouter/'
    // e.g., 'openrouter/minimax/minimax-m2.1' -> 'minimax/minimax-m2.1'
    const modelId = provider.replace('openrouter/', '')

    // Build provider options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerOptions: any = {}

    // Add reasoning if enabled - OpenRouter normalizes to the correct format for each model
    if (config.isReasoning) {
      providerOptions.reasoning = { enabled: true }
    }

    return {
      model: client(modelId),
      temperature: config.temperature,
      isReasoning: config.isReasoning,
      providerOptions:
        Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
    }
  }

  // OpenAI
  if (!apiKeys.openaiApiKey) {
    throw new Error('OpenAI API key is required')
  }

  const client = getOpenAIClient(apiKeys.openaiApiKey)
  const modelId = provider.replace('openai/', '')

  // Use the reasoning effort directly for OpenAI (all valid values work)
  const openaiEffort = reasoningEffort as OpenAIReasoningEffort

  return {
    model: client.responses(modelId),
    temperature: config.temperature,
    isReasoning: config.isReasoning,
    providerOptions: {
      openai: {
        store: false,
        ...(config.isReasoning
          ? {
              reasoningSummary: 'auto',
              reasoningEffort: openaiEffort,
            }
          : {}),
      },
    },
  }
}
