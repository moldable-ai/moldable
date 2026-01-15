import { createWebSearchTools } from './web-search'
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
  results: Array<{ title: string; link: string; snippet: string }>
  error?: string
}

type WebSearchInput = {
  query: string
  numberOfResults?: number
  languageCode?: string
  exactTerms?: string
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
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('webSearch', () => {
    it('returns error when credentials not configured', async () => {
      delete process.env.GOOGLE_SEARCH_ENGINE_API_KEY
      delete process.env.GOOGLE_SEARCH_ENGINE_ID

      const tools = createWebSearchTools()
      const result = await execWebSearch(tools, { query: 'test query' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('credentials not configured')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('makes correct API request', async () => {
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

      const result = await execWebSearch(tools, { query: 'test query' })

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

    it('adds site exclusions to query', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
        excludedSites: ['reddit.com', 'twitter.com'],
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      await execWebSearch(tools, { query: 'test' })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('-site%3Areddit.com')
      expect(calledUrl).toContain('-site%3Atwitter.com')
    })

    it('respects numberOfResults parameter', async () => {
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
      })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(3)
    })

    it('adds language parameters when specified', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      await execWebSearch(tools, { query: 'test', languageCode: 'en-US' })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('lr=lang_en')
      expect(calledUrl).toContain('hl=en-us')
    })

    it('adds exactTerms when specified', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      await execWebSearch(tools, { query: 'test', exactTerms: 'exact phrase' })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('exactTerms=exact+phrase')
    })

    it('handles API errors gracefully', async () => {
      const tools = createWebSearchTools({
        apiKey: 'test-api-key',
        searchEngineId: 'test-engine-id',
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden - quota exceeded',
      })

      const result = await execWebSearch(tools, { query: 'test' })

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

      const result = await execWebSearch(tools, { query: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
      expect(result.results).toHaveLength(0)
    })

    it('handles empty results', async () => {
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
      })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(0)
    })

    it('reads credentials from environment variables', async () => {
      process.env.GOOGLE_SEARCH_ENGINE_API_KEY = 'env-api-key'
      process.env.GOOGLE_SEARCH_ENGINE_ID = 'env-engine-id'

      const tools = createWebSearchTools() // No explicit credentials

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      const result = await execWebSearch(tools, { query: 'test' })

      expect(result.success).toBe(true)
      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('key=env-api-key')
      expect(calledUrl).toContain('cx=env-engine-id')
    })
  })
})
