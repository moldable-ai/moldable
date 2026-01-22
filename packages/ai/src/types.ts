/**
 * Supported LLM providers for Moldable
 */
export enum LLMProvider {
  // Anthropic models
  Anthropic_Claude_Opus_4_5 = 'anthropic/claude-opus-4-5',
  Anthropic_Claude_Sonnet_4_5 = 'anthropic/claude-sonnet-4-5',

  // OpenAI models
  OpenAI_GPT_5_2_Codex = 'openai/gpt-5.2-codex',

  // OpenRouter models
  OpenRouter_MiniMax_M2_1 = 'openrouter/minimax/minimax-m2.1',
  OpenRouter_Google_Gemini_3_Flash = 'openrouter/google/gemini-3-flash-preview',
  OpenRouter_Google_Gemini_3_Pro = 'openrouter/google/gemini-3-pro-preview',
  OpenRouter_XAI_Grok_Code_Fast_1 = 'openrouter/x-ai/grok-code-fast-1',
  OpenRouter_ZAI_GLM_4_7 = 'openrouter/z-ai/glm-4.7',
}

/**
 * Vendor type for LLM providers (determines API routing)
 */
export type LLMVendor = 'anthropic' | 'openai' | 'openrouter'

/**
 * Logo vendor type (for displaying model-specific logos)
 * Extends LLMVendor with specific model vendors served via OpenRouter
 */
export type LogoVendor = LLMVendor | 'minimax' | 'google' | 'xai' | 'zai'

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
    id: LLMProvider.Anthropic_Claude_Sonnet_4_5,
    name: 'Sonnet 4.5',
    vendor: 'anthropic',
  },
  {
    id: LLMProvider.OpenAI_GPT_5_2_Codex,
    name: 'GPT-5.2 Codex',
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
  {
    id: LLMProvider.OpenRouter_Google_Gemini_3_Pro,
    name: 'Gemini 3 Pro',
    vendor: 'openrouter',
    logoVendor: 'google',
  },
  {
    id: LLMProvider.OpenRouter_XAI_Grok_Code_Fast_1,
    name: 'Grok Code Fast',
    vendor: 'openrouter',
    logoVendor: 'xai',
  },
  {
    id: LLMProvider.OpenRouter_ZAI_GLM_4_7,
    name: 'GLM 4.7',
    vendor: 'openrouter',
    logoVendor: 'zai',
  },
]

/**
 * Default model to use
 */
export const DEFAULT_MODEL = LLMProvider.Anthropic_Claude_Opus_4_5

/**
 * Reasoning effort levels for Claude (Anthropic)
 * Maps to budget tokens for extended thinking
 * 'none' disables extended thinking entirely
 */
export type AnthropicReasoningEffort =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

/**
 * Reasoning effort levels for OpenAI (GPT-5.2, o-series)
 * 'none' disables reasoning summaries (useful if org isn't verified)
 */
export type OpenAIReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

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
    { value: 'none', label: 'None' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
  ],
  openai: [
    { value: 'none', label: 'None' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
  ],
  openrouter: [
    { value: 'none', label: 'None' },
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
  anthropic: 'none',
  openai: 'none',
  openrouter: 'none',
}

/**
 * Get vendor from model ID
 */
export function getVendorFromModel(modelId: string): LLMVendor {
  if (modelId.startsWith('anthropic/')) return 'anthropic'
  if (modelId.startsWith('openrouter/')) return 'openrouter'
  return 'openai'
}
