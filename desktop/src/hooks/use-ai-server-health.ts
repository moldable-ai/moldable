import { useCallback, useEffect, useState } from 'react'

const HEALTH_ENDPOINT = 'http://localhost:3100/health'
const POLL_INTERVAL = 5000 // 5 seconds

export interface AIServerHealth {
  status: 'checking' | 'healthy' | 'unhealthy' | 'no-keys'
  /** OpenRouter provides access to all models via a single key - recommended */
  hasOpenRouterKey: boolean
  /** Direct Anthropic API key (fallback if no OpenRouter) */
  hasAnthropicKey: boolean
  /** Direct OpenAI API key (fallback if no OpenRouter) */
  hasOpenAIKey: boolean
  error?: string
}

/**
 * Hook to monitor AI server health and API key configuration.
 *
 * Key priority: OpenRouter > Anthropic/OpenAI direct keys
 * OpenRouter is recommended because a single key provides access to all models.
 */
export function useAIServerHealth() {
  const [health, setHealth] = useState<AIServerHealth>({
    status: 'checking',
    hasOpenRouterKey: false,
    hasAnthropicKey: false,
    hasOpenAIKey: false,
  })

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(HEALTH_ENDPOINT, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })

      if (!response.ok) {
        setHealth({
          status: 'unhealthy',
          hasOpenRouterKey: false,
          hasAnthropicKey: false,
          hasOpenAIKey: false,
          error: `Server returned ${response.status}`,
        })
        return
      }

      const data = await response.json()

      // Check if any LLM key is configured
      // OpenRouter is preferred (single key for all models), but direct keys work too
      const hasAnyKey =
        data.hasOpenRouterKey || data.hasAnthropicKey || data.hasOpenAIKey

      setHealth({
        status: hasAnyKey ? 'healthy' : 'no-keys',
        hasOpenRouterKey: data.hasOpenRouterKey ?? false,
        hasAnthropicKey: data.hasAnthropicKey ?? false,
        hasOpenAIKey: data.hasOpenAIKey ?? false,
      })
    } catch (error) {
      setHealth({
        status: 'unhealthy',
        hasOpenRouterKey: false,
        hasAnthropicKey: false,
        hasOpenAIKey: false,
        error:
          error instanceof Error ? error.message : 'Cannot reach AI server',
      })
    }
  }, [])

  // Initial check
  useEffect(() => {
    checkHealth()
  }, [checkHealth])

  // Poll periodically
  useEffect(() => {
    const interval = setInterval(checkHealth, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [checkHealth])

  return { health, checkHealth }
}
