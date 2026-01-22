import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  LLMProvider,
  REASONING_EFFORT_OPTIONS,
  getVendorFromModel,
} from './types'
import { describe, expect, it } from 'vitest'

describe('types', () => {
  describe('LLMProvider enum', () => {
    it('has Anthropic provider', () => {
      expect(LLMProvider.Anthropic_Claude_Opus_4_5).toBe(
        'anthropic/claude-opus-4-5',
      )
    })

    it('has OpenAI provider', () => {
      expect(LLMProvider.OpenAI_GPT_5_2_Codex).toBe('openai/gpt-5.2-codex')
    })

    it('has OpenRouter providers', () => {
      expect(LLMProvider.OpenRouter_MiniMax_M2_1).toBe(
        'openrouter/minimax/minimax-m2.1',
      )
      expect(LLMProvider.OpenRouter_Google_Gemini_3_Flash).toBe(
        'openrouter/google/gemini-3-flash-preview',
      )
    })
  })

  describe('AVAILABLE_MODELS', () => {
    it('contains all providers', () => {
      const providerIds = AVAILABLE_MODELS.map((m) => m.id)
      expect(providerIds).toContain(LLMProvider.Anthropic_Claude_Opus_4_5)
      expect(providerIds).toContain(LLMProvider.Anthropic_Claude_Sonnet_4_5)
      expect(providerIds).toContain(LLMProvider.OpenAI_GPT_5_2_Codex)
      expect(providerIds).toContain(LLMProvider.OpenRouter_MiniMax_M2_1)
      expect(providerIds).toContain(
        LLMProvider.OpenRouter_Google_Gemini_3_Flash,
      )
      expect(providerIds).toContain(LLMProvider.OpenRouter_Google_Gemini_3_Pro)
      expect(providerIds).toContain(LLMProvider.OpenRouter_XAI_Grok_Code_Fast_1)
      expect(providerIds).toContain(LLMProvider.OpenRouter_ZAI_GLM_4_7)
    })

    it('has display names for all models', () => {
      for (const model of AVAILABLE_MODELS) {
        expect(model.name).toBeDefined()
        expect(model.name.length).toBeGreaterThan(0)
      }
    })

    it('has vendor info for all models', () => {
      for (const model of AVAILABLE_MODELS) {
        expect(model.vendor).toBeDefined()
        expect(['anthropic', 'openai', 'openrouter']).toContain(model.vendor)
      }
    })

    it('has logoVendor override for OpenRouter models', () => {
      const minimax = AVAILABLE_MODELS.find(
        (m) => m.id === LLMProvider.OpenRouter_MiniMax_M2_1,
      )
      const gemini = AVAILABLE_MODELS.find(
        (m) => m.id === LLMProvider.OpenRouter_Google_Gemini_3_Flash,
      )

      expect(minimax?.logoVendor).toBe('minimax')
      expect(gemini?.logoVendor).toBe('google')
    })
  })

  describe('DEFAULT_MODEL', () => {
    it('is set to Anthropic Claude Opus', () => {
      expect(DEFAULT_MODEL).toBe(LLMProvider.Anthropic_Claude_Opus_4_5)
    })

    it('is a valid AVAILABLE_MODELS entry', () => {
      const modelIds = AVAILABLE_MODELS.map((m) => m.id)
      expect(modelIds).toContain(DEFAULT_MODEL)
    })
  })

  describe('REASONING_EFFORT_OPTIONS', () => {
    it('has options for all vendors', () => {
      expect(REASONING_EFFORT_OPTIONS.anthropic).toBeDefined()
      expect(REASONING_EFFORT_OPTIONS.openai).toBeDefined()
      expect(REASONING_EFFORT_OPTIONS.openrouter).toBeDefined()
    })

    it('has all effort levels for each vendor', () => {
      for (const vendor of ['anthropic', 'openai', 'openrouter'] as const) {
        const values = REASONING_EFFORT_OPTIONS[vendor].map((o) => o.value)
        expect(values).toContain('low')
        expect(values).toContain('medium')
        expect(values).toContain('high')
        expect(values).toContain('xhigh')
      }
    })

    it('has labels for all options', () => {
      for (const vendor of ['anthropic', 'openai', 'openrouter'] as const) {
        for (const option of REASONING_EFFORT_OPTIONS[vendor]) {
          expect(option.label).toBeDefined()
          expect(option.label.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('DEFAULT_REASONING_EFFORT', () => {
    it('defaults to none for all vendors', () => {
      expect(DEFAULT_REASONING_EFFORT.anthropic).toBe('none')
      expect(DEFAULT_REASONING_EFFORT.openai).toBe('none')
      expect(DEFAULT_REASONING_EFFORT.openrouter).toBe('none')
    })
  })

  describe('getVendorFromModel', () => {
    it('returns anthropic for anthropic models', () => {
      expect(getVendorFromModel('anthropic/claude-opus-4-5')).toBe('anthropic')
      expect(getVendorFromModel('anthropic/claude-3-sonnet')).toBe('anthropic')
    })

    it('returns openrouter for openrouter models', () => {
      expect(getVendorFromModel('openrouter/minimax/minimax-m2.1')).toBe(
        'openrouter',
      )
      expect(
        getVendorFromModel('openrouter/google/gemini-3-flash-preview'),
      ).toBe('openrouter')
    })

    it('returns openai for other models (default)', () => {
      expect(getVendorFromModel('openai/gpt-5.2')).toBe('openai')
      expect(getVendorFromModel('openai/gpt-4')).toBe('openai')
      // Unknown prefixes default to openai
      expect(getVendorFromModel('unknown/model')).toBe('openai')
    })

    it('works with LLMProvider enum values', () => {
      expect(getVendorFromModel(LLMProvider.Anthropic_Claude_Opus_4_5)).toBe(
        'anthropic',
      )
      expect(getVendorFromModel(LLMProvider.OpenAI_GPT_5_2_Codex)).toBe(
        'openai',
      )
      expect(getVendorFromModel(LLMProvider.OpenRouter_MiniMax_M2_1)).toBe(
        'openrouter',
      )
    })
  })
})
