import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

const DEFAULT_AI_PORT = 39200
const DEFAULT_API_PORT = 39102
const POLL_INTERVAL = 5000 // 5 seconds

export interface AIServerHealth {
  status: 'checking' | 'healthy' | 'unhealthy' | 'no-keys'
  /** OpenRouter provides access to all models via a single key - recommended */
  hasOpenRouterKey: boolean
  /** Direct Anthropic API key (fallback if no OpenRouter) */
  hasAnthropicKey: boolean
  /** Direct OpenAI API key (fallback if no OpenRouter) */
  hasOpenAIKey: boolean
  /** The actual port the AI server is running on */
  port: number
  /** The actual port the API server is running on (for scaffold tools) */
  apiServerPort: number
  error?: string
}

/**
 * Get the actual AI server port from Tauri (may differ from default if fallback was used)
 */
async function getAIServerPort(): Promise<number> {
  try {
    return await invoke<number>('get_ai_server_port')
  } catch {
    return DEFAULT_AI_PORT
  }
}

/**
 * Get the actual API server port from Tauri (may differ from default if fallback was used)
 */
async function getAPIServerPort(): Promise<number> {
  try {
    return await invoke<number>('get_api_server_port')
  } catch {
    return DEFAULT_API_PORT
  }
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
    port: DEFAULT_AI_PORT,
    apiServerPort: DEFAULT_API_PORT,
  })

  // Cache the ports so we don't keep calling Tauri
  const portRef = useRef<number>(DEFAULT_AI_PORT)
  const apiPortRef = useRef<number>(DEFAULT_API_PORT)

  const checkHealth = useCallback(async () => {
    try {
      // Get the actual ports (may be fallback ports if defaults were unavailable)
      const [port, apiPort] = await Promise.all([
        getAIServerPort(),
        getAPIServerPort(),
      ])
      portRef.current = port
      apiPortRef.current = apiPort

      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })

      if (!response.ok) {
        setHealth({
          status: 'unhealthy',
          hasOpenRouterKey: false,
          hasAnthropicKey: false,
          hasOpenAIKey: false,
          port,
          apiServerPort: apiPort,
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
        port,
        apiServerPort: apiPort,
      })
    } catch (error) {
      setHealth({
        status: 'unhealthy',
        hasOpenRouterKey: false,
        hasAnthropicKey: false,
        hasOpenAIKey: false,
        port: portRef.current,
        apiServerPort: apiPortRef.current,
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
