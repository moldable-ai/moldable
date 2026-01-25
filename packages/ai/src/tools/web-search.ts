import { tool, zodSchema } from 'ai'
import { z } from 'zod/v4'

/**
 * Web search result
 */
export type WebSearchResult = {
  title: string
  link: string
  snippet: string
  url?: string
  siteName?: string
  published?: string
  languageCode?: string
}

type WebSearchProvider = 'perplexity' | 'brave' | 'google'

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>()

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const DEFAULT_PERPLEXITY_BASE_URL = 'https://openrouter.ai/api/v1'
const PERPLEXITY_DIRECT_BASE_URL = 'https://api.perplexity.ai'
const DEFAULT_PERPLEXITY_MODEL = 'perplexity/sonar-pro'
const PERPLEXITY_KEY_PREFIXES = ['pplx-']
const OPENROUTER_KEY_PREFIXES = ['sk-or-']

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 30 * 1000
const MAX_RESULTS = 10

function clampResults(value: number, fallback: number) {
  const rounded = Math.floor(value)
  const safe = Number.isFinite(rounded) ? rounded : fallback
  return Math.max(1, Math.min(MAX_RESULTS, safe))
}

function normalizeProvider(value?: string): WebSearchProvider | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'perplexity') return 'perplexity'
  if (normalized === 'brave') return 'brave'
  if (normalized === 'google') return 'google'
  return undefined
}

function readCache<T>(key: string): T | undefined {
  const entry = SEARCH_CACHE.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    SEARCH_CACHE.delete(key)
    return undefined
  }
  return entry.value as T
}

function writeCache<T>(key: string, value: T, ttlMs: number) {
  if (ttlMs <= 0) return
  SEARCH_CACHE.set(key, {
    value: value as unknown as Record<string, unknown>,
    expiresAt: Date.now() + ttlMs,
  })
}

function clearWebSearchCache() {
  SEARCH_CACHE.clear()
}

function resolvePerplexityKeySource(params: {
  perplexityApiKey?: string
  openrouterApiKey?: string
}): { apiKey?: string; source: 'perplexity' | 'openrouter' | 'none' } {
  if (params.perplexityApiKey) {
    return { apiKey: params.perplexityApiKey, source: 'perplexity' }
  }
  if (params.openrouterApiKey) {
    return { apiKey: params.openrouterApiKey, source: 'openrouter' }
  }
  return { apiKey: undefined, source: 'none' }
}

function inferPerplexityBaseUrlFromKey(apiKey?: string) {
  if (!apiKey) return undefined
  const normalized = apiKey.toLowerCase()
  if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return PERPLEXITY_DIRECT_BASE_URL
  }
  if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return DEFAULT_PERPLEXITY_BASE_URL
  }
  return undefined
}

function resolvePerplexityBaseUrl(params: {
  baseUrl?: string
  source: 'perplexity' | 'openrouter' | 'none'
  apiKey?: string
}) {
  if (params.baseUrl) return params.baseUrl
  if (params.source === 'perplexity') return PERPLEXITY_DIRECT_BASE_URL
  if (params.source === 'openrouter') return DEFAULT_PERPLEXITY_BASE_URL
  return (
    inferPerplexityBaseUrlFromKey(params.apiKey) ?? DEFAULT_PERPLEXITY_BASE_URL
  )
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function runPerplexitySearch(params: {
  query: string
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}) {
  const endpoint = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
        'HTTP-Referer': 'https://moldable.sh',
        'X-Title': 'Moldable Web Search',
      },
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: 'user', content: params.query }],
      }),
    },
    params.timeoutMs,
  )

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `Perplexity API error: ${response.status} ${detail || response.statusText}`,
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
  }

  return {
    content: data.choices?.[0]?.message?.content ?? 'No response',
    citations: data.citations ?? [],
  }
}

export function createWebSearchTools(
  options: {
    apiKey?: string
    searchEngineId?: string
    excludedSites?: string[]
    braveApiKey?: string
    openrouterApiKey?: string
    perplexityApiKey?: string
    perplexityBaseUrl?: string
    perplexityModel?: string
    provider?: WebSearchProvider
    cacheTtlMs?: number
    timeoutSeconds?: number
  } = {},
) {
  const {
    apiKey = process.env.GOOGLE_SEARCH_ENGINE_API_KEY,
    searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID,
    excludedSites = ['reddit.com'],
    braveApiKey = process.env.BRAVE_API_KEY,
    openrouterApiKey = process.env.OPENROUTER_API_KEY,
    perplexityApiKey = process.env.PERPLEXITY_API_KEY,
    perplexityBaseUrl,
    perplexityModel,
    provider,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutSeconds,
  } = options

  const timeoutMs =
    typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds)
      ? Math.max(1, timeoutSeconds) * 1000
      : DEFAULT_TIMEOUT_MS

  const webSearchSchema = z.object({
    query: z.string().describe('The search query'),
    provider: z
      .enum(['perplexity', 'brave', 'google'])
      .optional()
      .describe('Force a specific provider'),
    exactTerms: z.string().optional().describe('Exact phrase to match'),
    numberOfResults: z
      .number()
      .optional()
      .describe('Maximum results to return (1-10)'),
    count: z.number().optional().describe('Alias for numberOfResults (1-10)'),
    languageCode: z
      .string()
      .optional()
      .describe('Language code (e.g., "en-US")'),
    country: z
      .string()
      .optional()
      .describe('Country code for region-specific results (e.g., "US")'),
    search_lang: z
      .string()
      .optional()
      .describe('ISO language code for search results (e.g., "en")'),
    ui_lang: z
      .string()
      .optional()
      .describe('ISO language code for UI elements (e.g., "en")'),
    freshness: z
      .string()
      .optional()
      .describe('Brave-only freshness filter (e.g., "pw")'),
  })

  return {
    webSearch: tool({
      description:
        'Search the web using Perplexity Sonar (default when OpenRouter is configured), Brave, or Google. Returns structured results or AI-synthesized answers with citations.',
      inputSchema: zodSchema(webSearchSchema),
      execute: async (input) => {
        const resolvedProvider =
          normalizeProvider(input.provider) ??
          provider ??
          (openrouterApiKey || perplexityApiKey
            ? 'perplexity'
            : braveApiKey
              ? 'brave'
              : apiKey && searchEngineId
                ? 'google'
                : undefined)

        if (!resolvedProvider) {
          return {
            success: false,
            error:
              'Web search credentials not configured. Set OPENROUTER_API_KEY or PERPLEXITY_API_KEY for Perplexity, BRAVE_API_KEY for Brave, or GOOGLE_SEARCH_ENGINE_API_KEY + GOOGLE_SEARCH_ENGINE_ID for Google.',
            results: [],
          }
        }

        const count = clampResults(
          input.numberOfResults ?? input.count ?? 10,
          10,
        )

        const cacheKey = `${resolvedProvider}:${input.query}:${count}:${input.country ?? 'default'}:${input.search_lang ?? 'default'}:${input.ui_lang ?? 'default'}:${input.freshness ?? 'default'}:${input.languageCode ?? 'default'}:${input.exactTerms ?? 'default'}`
        const cached = readCache<Record<string, unknown>>(cacheKey)
        if (cached) {
          return { ...cached, cached: true }
        }

        if (resolvedProvider === 'perplexity') {
          const auth = resolvePerplexityKeySource({
            perplexityApiKey,
            openrouterApiKey,
          })
          if (!auth.apiKey) {
            return {
              success: false,
              error:
                'Perplexity web search requires PERPLEXITY_API_KEY or OPENROUTER_API_KEY.',
              results: [],
            }
          }

          const baseUrl = resolvePerplexityBaseUrl({
            baseUrl: perplexityBaseUrl,
            source: auth.source,
            apiKey: auth.apiKey,
          })
          const model = perplexityModel || DEFAULT_PERPLEXITY_MODEL

          try {
            const result = await runPerplexitySearch({
              query: input.query,
              apiKey: auth.apiKey,
              baseUrl,
              model,
              timeoutMs,
            })

            const payload = {
              success: true,
              provider: resolvedProvider,
              query: input.query,
              model,
              content: result.content,
              citations: result.citations,
              results: [],
            }
            writeCache(cacheKey, payload, cacheTtlMs)
            return payload
          } catch (error) {
            return {
              success: false,
              error:
                error instanceof Error ? error.message : 'Web search failed',
              results: [],
            }
          }
        }

        if (resolvedProvider === 'brave') {
          if (!braveApiKey) {
            return {
              success: false,
              error:
                'Brave web search requires BRAVE_API_KEY or configure a different provider.',
              results: [],
            }
          }

          try {
            const url = new URL(BRAVE_SEARCH_ENDPOINT)
            url.searchParams.set('q', input.query)
            url.searchParams.set('count', String(count))
            if (input.country) {
              url.searchParams.set('country', input.country)
            }
            if (input.search_lang) {
              url.searchParams.set('search_lang', input.search_lang)
            }
            if (input.ui_lang) {
              url.searchParams.set('ui_lang', input.ui_lang)
            }
            if (input.freshness) {
              url.searchParams.set('freshness', input.freshness)
            }

            const response = await fetchWithTimeout(
              url.toString(),
              {
                method: 'GET',
                headers: {
                  Accept: 'application/json',
                  'X-Subscription-Token': braveApiKey,
                },
              },
              timeoutMs,
            )

            if (!response.ok) {
              const detail = await response.text()
              return {
                success: false,
                error: `Brave Search API error: ${response.status} - ${detail}`,
                results: [],
              }
            }

            const json = (await response.json()) as {
              web?: {
                results?: Array<{
                  title?: string
                  url?: string
                  description?: string
                  age?: string
                }>
              }
            }

            const results: WebSearchResult[] =
              json.web?.results?.map((item) => ({
                title: item.title ?? '',
                link: item.url ?? '',
                url: item.url ?? '',
                snippet: item.description ?? '',
                siteName: resolveSiteName(item.url),
                published: item.age,
              })) ?? []

            const payload = {
              success: true,
              provider: resolvedProvider,
              query: input.query,
              results: results.slice(0, count),
            }
            writeCache(cacheKey, payload, cacheTtlMs)
            return payload
          } catch (error) {
            return {
              success: false,
              error:
                error instanceof Error ? error.message : 'Web search failed',
              results: [],
            }
          }
        }

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
          url.searchParams.append('num', String(count))

          if (input.exactTerms) {
            url.searchParams.append('exactTerms', input.exactTerms)
          }

          const googleLanguage =
            input.languageCode || input.search_lang || input.ui_lang

          if (googleLanguage) {
            const googleLangCode = `lang_${googleLanguage.split('-')[0].toLowerCase()}`
            url.searchParams.append('lr', googleLangCode)
            url.searchParams.append('hl', googleLanguage.toLowerCase())
          }

          const siteExclusions = excludedSites
            .map((site) => `-site:${site}`)
            .join(' ')
          url.searchParams.append('q', `${input.query} ${siteExclusions}`)

          const response = await fetchWithTimeout(
            url.href,
            {
              method: 'GET',
            },
            timeoutMs,
          )

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
                url: item.link,
                snippet: item.snippet,
                languageCode: googleLanguage,
                siteName: resolveSiteName(item.link),
              }),
            ) ?? []

          const payload = {
            success: true,
            provider: resolvedProvider,
            results: results.slice(0, count),
            totalResults:
              json.searchInformation?.totalResults || results.length,
          }
          writeCache(cacheKey, payload, cacheTtlMs)
          return payload
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

export const __testing = {
  clearWebSearchCache,
} as const
