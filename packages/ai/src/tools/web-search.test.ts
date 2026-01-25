import { __testing, createWebSearchTools } from './web-search'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Helper types and functions to handle AI SDK's strict tool types
type ToolContext = { toolCallId: string; messages: []; abortSignal: never }
const ctx: ToolContext = {
  toolCallId: 'test',
  messages: [],
  abortSignal: undefined as never,
}

type WebSearchTools = ReturnType<typeof createWebSearchTools>
type WebSearchResult = {
  success: boolean
  query?: string
  provider?: string
  results: Array<{ title: string; link: string; snippet: string }>
  content?: string
  citations?: string[]
  error?: string
}

type WebSearchInput = {
  query: string
  numberOfResults?: number
  count?: number
  languageCode?: string
  exactTerms?: string
  provider?: 'perplexity' | 'brave' | 'google'
}
async function execWebSearch(
  tools: WebSearchTools,
  input: WebSearchInput,
): Promise<WebSearchResult> {
  return (await tools.webSearch.execute!(
    { numberOfResults: 10, ...input },
    ctx,
  )) as WebSearchResult
}

describe('createWebSearchTools', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.clearAllMocks()
    __testing.clearWebSearchCache()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('webSearch', () => {
    it('returns error when no credentials are configured', async () => {
      delete process.env.OPENROUTER_API_KEY
      delete process.env.PERPLEXITY_API_KEY
      delete process.env.BRAVE_API_KEY
      delete process.env.GOOGLE_SEARCH_ENGINE_API_KEY
      delete process.env.GOOGLE_SEARCH_ENGINE_ID

      const tools = createWebSearchTools()
      const result = await execWebSearch(tools, { query: 'test query' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('credentials not configured')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('defaults to Perplexity when OPENROUTER_API_KEY is set', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test'

      const tools = createWebSearchTools()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Answer' } }],
          citations: ['https://example.com'],
        }),
      })

      const result = await execWebSearch(tools, { query: 'test query' })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('perplexity')
      expect(result.content).toBe('Answer')
      expect(result.citations).toEqual(['https://example.com'])

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('openrouter.ai/api/v1/chat/completions')
    })

    it('uses direct Perplexity API when PERPLEXITY_API_KEY is set', async () => {
      process.env.PERPLEXITY_API_KEY = 'pplx-test'

      const tools = createWebSearchTools()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Answer' } }],
          citations: [],
        }),
      })

      const result = await execWebSearch(tools, { query: 'test query' })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('perplexity')

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('api.perplexity.ai/chat/completions')
    })

    it('respects explicit provider override', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test'

      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      await execWebSearch(tools, { query: 'test', provider: 'google' })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('customsearch/v1')
    })

    it('makes correct Google API request', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              title: 'Result 1',
              link: 'https://example.com/1',
              snippet: 'Snippet 1',
            },
            {
              title: 'Result 2',
              link: 'https://example.com/2',
              snippet: 'Snippet 2',
            },
          ],
          searchInformation: { totalResults: '1000' },
        }),
      })

      const result = await execWebSearch(tools, {
        query: 'test query',
        provider: 'google',
      })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)
      expect(result.results[0].title).toBe('Result 1')
      expect(result.results[0].link).toBe('https://example.com/1')

      // Verify API was called with correct parameters
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('customsearch/v1')
      expect(calledUrl).toContain('key=test-api-key')
      expect(calledUrl).toContain('cx=test-engine-id')
      expect(calledUrl).toContain('test+query')
    })

    it('adds site exclusions to Google query', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
        excludedSites: ['reddit.com', 'twitter.com'],
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      await execWebSearch(tools, { query: 'test', provider: 'google' })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('-site%3Areddit.com')
      expect(calledUrl).toContain('-site%3Atwitter.com')
    })

    it('respects numberOfResults parameter for Google', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: Array(10)
            .fill(null)
            .map((_, i) => ({
              title: `Result ${i}`,
              link: `https://example.com/${i}`,
              snippet: `Snippet ${i}`,
            })),
        }),
      })

      const result = await execWebSearch(tools, {
        query: 'test',
        numberOfResults: 3,
        provider: 'google',
      })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(3)
    })

    it('adds language parameters when specified for Google', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      await execWebSearch(tools, {
        query: 'test',
        languageCode: 'en-US',
        provider: 'google',
      })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('lr=lang_en')
      expect(calledUrl).toContain('hl=en-us')
    })

    it('adds exactTerms when specified for Google', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      await execWebSearch(tools, {
        query: 'test',
        exactTerms: 'exact phrase',
        provider: 'google',
      })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('exactTerms=exact+phrase')
    })

    it('handles Google API errors gracefully', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden - quota exceeded',
      })

      const result = await execWebSearch(tools, {
        query: 'test',
        provider: 'google',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('403')
      expect(result.results).toHaveLength(0)
    })

    it('handles network errors gracefully', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await execWebSearch(tools, {
        query: 'test',
        provider: 'google',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
      expect(result.results).toHaveLength(0)
    })

    it('handles empty Google results', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No items
      })

      const result = await execWebSearch(tools, {
        query: 'very obscure search term xyz123',
        provider: 'google',
      })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(0)
    })

    it('reads Google credentials from environment variables', async () => {
      process.env.GOOGLE_SEARCH_ENGINE_API_KEY = 'env-api-key'
      process.env.GOOGLE_SEARCH_ENGINE_ID = 'env-engine-id'

      const tools = createWebSearchTools() // No explicit credentials

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      const result = await execWebSearch(tools, {
        query: 'test',
        provider: 'google',
      })

      expect(result.success).toBe(true)
      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('key=env-api-key')
      expect(calledUrl).toContain('cx=env-engine-id')
    })
  })
})
