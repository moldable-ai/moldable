/**
 * Supported LLM providers for Moldable
 */
export enum LLMProvider {
  // Anthropic models
  Anthropic_Claude_Opus_4_5 = 'anthropic/claude-opus-4-5',

  // OpenAI models
  OpenAI_GPT_5_2 = 'openai/gpt-5.2',

  // OpenRouter models
  OpenRouter_MiniMax_M2_1 = 'openrouter/minimax/minimax-m2.1',
  OpenRouter_Google_Gemini_3_Flash = 'openrouter/google/gemini-3-flash-preview',
}

/**
 * Vendor type for LLM providers (determines API routing)
 */
export type LLMVendor = 'anthropic' | 'openai' | 'openrouter'

/**
 * Logo vendor type (for displaying model-specific logos)
 * Extends LLMVendor with specific model vendors served via OpenRouter
 */
export type LogoVendor = LLMVendor | 'minimax' | 'google'

/**
 * Model display info for UI
 */
export type ModelInfo = {
  id: LLMProvider
  name: string
  vendor: LLMVendor
  /** Override vendor for logo display (e.g., 'minimax' when served via OpenRouter) */
  logoVendor?: LogoVendor
}

/**
 * Available models with display information
 */
export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: LLMProvider.Anthropic_Claude_Opus_4_5,
    name: 'Opus 4.5',
    vendor: 'anthropic',
  },
  {
    id: LLMProvider.OpenAI_GPT_5_2,
    name: 'GPT-5.2',
    vendor: 'openai',
  },
  {
    id: LLMProvider.OpenRouter_MiniMax_M2_1,
    name: 'MiniMax M2.1',
    vendor: 'openrouter',
    logoVendor: 'minimax',
  },
  {
    id: LLMProvider.OpenRouter_Google_Gemini_3_Flash,
    name: 'Gemini 3 Flash',
    vendor: 'openrouter',
    logoVendor: 'google',
  },
]

/**
 * Default model to use
 */
export const DEFAULT_MODEL = LLMProvider.Anthropic_Claude_Opus_4_5

/**
 * Reasoning effort levels for Claude (Anthropic)
 * Maps to budget tokens for extended thinking
 */
export type AnthropicReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Reasoning effort levels for OpenAI (GPT-5.2, o-series)
 */
export type OpenAIReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Union type for all reasoning effort levels
 */
export type ReasoningEffort = AnthropicReasoningEffort | OpenAIReasoningEffort

/**
 * Reasoning effort options for each vendor
 */
export const REASONING_EFFORT_OPTIONS: Record<
  LLMVendor,
  { value: ReasoningEffort; label: string }[]
> = {
  anthropic: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
  ],
  openai: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
  ],
  openrouter: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
  ],
}

/**
 * Default reasoning effort per vendor
 */
export const DEFAULT_REASONING_EFFORT: Record<LLMVendor, ReasoningEffort> = {
  anthropic: 'medium',
  openai: 'medium',
  openrouter: 'medium',
}

/**
 * Get vendor from model ID
 */
export function getVendorFromModel(modelId: string): LLMVendor {
  if (modelId.startsWith('anthropic/')) return 'anthropic'
  if (modelId.startsWith('openrouter/')) return 'openrouter'
  return 'openai'
}
