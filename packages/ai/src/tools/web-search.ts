import { tool, zodSchema } from 'ai'
import { z } from 'zod/v4'

/**
 * Web search result
 */
export type WebSearchResult = {
  title: string
  link: string
  snippet: string
  languageCode?: string
}

/**
 * Create web search tools for the AI agent
 * Uses Google Custom Search API
 *
 * Requires environment variables:
 * - GOOGLE_SEARCH_ENGINE_API_KEY
 * - GOOGLE_SEARCH_ENGINE_ID
 */
export function createWebSearchTools(
  options: {
    apiKey?: string
    searchEngineId?: string
    excludedSites?: string[]
  } = {},
) {
  const {
    apiKey = process.env.GOOGLE_SEARCH_ENGINE_API_KEY,
    searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID,
    excludedSites = ['reddit.com'], // Sites that block scraping
  } = options

  const webSearchSchema = z.object({
    query: z.string().describe('The search query'),
    exactTerms: z.string().optional().describe('Exact phrase to match'),
    numberOfResults: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum results to return (default: 10, max: 10)'),
    languageCode: z
      .string()
      .optional()
      .describe('Language code (e.g., "en-US")'),
  })

  return {
    webSearch: tool({
      description:
        'Search the internet using Google. Returns titles, URLs, and snippets for matching web pages. Use for current information, documentation, or research.',
      inputSchema: zodSchema(webSearchSchema),
      execute: async (input) => {
        // Check for required credentials
        if (!apiKey || !searchEngineId) {
          return {
            success: false,
            error:
              'Google Search API credentials not configured. Set GOOGLE_SEARCH_ENGINE_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.',
            results: [],
          }
        }

        try {
          const url = new URL('https://www.googleapis.com/customsearch/v1')
          url.searchParams.append('key', apiKey)
          url.searchParams.append('cx', searchEngineId)

          if (input.exactTerms) {
            url.searchParams.append('exactTerms', input.exactTerms)
          }

          // Add language parameter if provided
          if (input.languageCode) {
            const googleLangCode = `lang_${input.languageCode.split('-')[0].toLowerCase()}`
            url.searchParams.append('lr', googleLangCode)
            url.searchParams.append('hl', input.languageCode.toLowerCase())
          }

          // Build query with site exclusions
          const siteExclusions = excludedSites
            .map((site) => `-site:${site}`)
            .join(' ')
          url.searchParams.append('q', `${input.query} ${siteExclusions}`)

          const response = await fetch(url.href)

          if (!response.ok) {
            const errorText = await response.text()
            return {
              success: false,
              error: `Google Search API error: ${response.status} - ${errorText}`,
              results: [],
            }
          }

          const json = await response.json()

          const results: WebSearchResult[] =
            json.items?.map(
              (item: { title: string; link: string; snippet: string }) => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                languageCode: input.languageCode,
              }),
            ) ?? []

          return {
            success: true,
            results: results.slice(0, input.numberOfResults || 10),
            totalResults:
              json.searchInformation?.totalResults || results.length,
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Web search failed',
            results: [],
          }
        }
      },
    }),
  }
}
