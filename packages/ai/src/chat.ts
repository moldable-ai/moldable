import { getProviderConfig } from './providers'
import { DEFAULT_MODEL, LLMProvider } from './types'
import {
  type SystemModelMessage,
  type ToolSet,
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  extractReasoningMiddleware,
  smoothStream,
  streamText,
  wrapLanguageModel,
} from 'ai'

/**
 * Logger interface for chat operations
 */
export interface ChatLogger {
  debug: (message: string, data?: unknown) => void
  info: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

/**
 * Default console logger
 */
const defaultLogger: ChatLogger = {
  debug: (message, data) => {
    if (process.env.DEBUG || process.env.MOLDABLE_DEBUG) {
      console.log(`[chat:debug] ${message}`, data ?? '')
    }
  },
  info: (message, data) => console.log(`[chat:info] ${message}`, data ?? ''),
  error: (message, data) =>
    console.error(`[chat:error] ${message}`, data ?? ''),
}

type CreateChatStreamParams = {
  messages: UIMessage[]
  provider?: LLMProvider
  systemMessage: string | SystemModelMessage
  tools?: ToolSet
  apiKeys: {
    anthropicApiKey?: string
    openaiApiKey?: string
  }
  /** Enable verbose logging of prompts and messages */
  debug?: boolean
  /** Custom logger (defaults to console with DEBUG env check) */
  logger?: ChatLogger
}

/**
 * Create a streaming chat response using the AI SDK
 */
export function createChatStream({
  messages,
  provider = DEFAULT_MODEL,
  systemMessage,
  tools = {},
  apiKeys,
  debug = false,
  logger = defaultLogger,
}: CreateChatStreamParams): Response {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const {
          model: baseModel,
          temperature,
          isReasoning,
          providerOptions,
        } = getProviderConfig(provider, apiKeys)

        // Use reasoning middleware for OpenAI models
        const isOpenAI = provider.startsWith('openai/')
        const model =
          isReasoning && isOpenAI
            ? wrapLanguageModel({
                model: baseModel,
                middleware: extractReasoningMiddleware({ tagName: 'think' }),
              })
            : baseModel

        // Convert UI messages to model messages
        const modelMessages = await convertToModelMessages(messages, {
          tools: Object.keys(tools).length > 0 ? tools : undefined,
        })

        // Only include tools if provided
        const hasTools = Object.keys(tools).length > 0
        const toolNames = hasTools ? Object.keys(tools) : []

        // Log the request details
        if (debug) {
          logger.info('=== Chat Request ===')
          logger.info(`Provider: ${provider}`)
          logger.info(`Temperature: ${temperature}`)
          logger.info(`Tools enabled: ${hasTools} (${toolNames.length} tools)`)
          if (hasTools) {
            logger.debug('Available tools:', toolNames)
          }
          logger.info('--- System Prompt ---')
          logger.info(
            typeof systemMessage === 'string'
              ? systemMessage
              : JSON.stringify(systemMessage, null, 2),
          )
          logger.info('--- Messages ---')
          logger.info(`Message count: ${modelMessages.length}`)
          logger.debug('Messages:', JSON.stringify(modelMessages, null, 2))
          logger.info('=== End Request ===')
        }

        const result = streamText({
          model,
          system: systemMessage,
          messages: modelMessages,
          temperature,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          providerOptions: providerOptions as any,
          experimental_transform: smoothStream({ chunking: 'word' }),
          ...(hasTools && {
            tools,
            maxSteps: 1000,
          }),
        })

        writer.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          }),
        )
      },
    }),
  })
}
