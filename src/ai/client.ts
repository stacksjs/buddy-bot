import type { BuddyBotConfig } from '../types'
import type { Logger } from '../utils/logger'
import type { AiClient, AiCompletionRequest, AiProvider, AiProviderName, AiResponse } from './types'
import process from 'node:process'
import { getDefaultLogger } from '../utils/logger'
import { PROVIDER_DEFAULT_MODEL, PROVIDER_KEY_ENV, PROVIDER_PRIORITY, resolveModelAlias } from './aliases'
import { createAnthropicProvider } from './providers/anthropic'
import { createGoogleProvider } from './providers/google'
import { createOpenAiProvider } from './providers/openai'
import { redactError } from './redact'
import { AiBudgetExceededError, AiProviderError } from './types'

/** What provider, model and credentials a run resolved to. */
export interface AiResolution {
  provider: AiProviderName
  model: string
  apiKey: string
  baseUrl?: string
}

/**
 * Work out which provider and model to use, and find its key.
 *
 * Resolution order is explicit config, then the first provider in priority
 * order with a key present. Returning `null` rather than throwing is
 * deliberate: no key configured is the normal state for a dependency bot, and
 * every AI feature is expected to degrade to a no-op rather than fail the run.
 *
 * @param config - Full buddy-bot configuration
 * @returns The resolution, or `null` when no provider is usable
 */
export function resolveAiProvider(config: BuddyBotConfig): AiResolution | null {
  const ai = config.ai
  if (ai?.enabled === false)
    return null

  const candidates: AiProviderName[] = ai?.provider ? [ai.provider] : PROVIDER_PRIORITY

  for (const provider of candidates) {
    const apiKey = findApiKey(provider, ai?.apiKeyEnv)
    if (!apiKey)
      continue

    const model = resolveModel(provider, ai?.model)
    if (!model)
      continue

    return {
      provider,
      model,
      apiKey,
      ...(ai?.baseUrl ? { baseUrl: ai.baseUrl } : {}),
    }
  }

  return null
}

/**
 * Build an AI client from configuration.
 *
 * @param config - Full buddy-bot configuration
 * @param logger - Logger for diagnostics; defaults to the process-wide logger
 * @returns A client, or `null` when no provider is configured — callers must
 * treat `null` as "AI features are off" rather than as an error
 * @example
 * ```ts
 * const ai = createAiClient(config)
 * if (!ai) {
 *   logger.info('AI disabled (no API key)')
 *   return
 * }
 * const response = await ai.complete({ messages: [{ role: 'user', content: 'hi' }] })
 * ```
 */
export function createAiClient(config: BuddyBotConfig, logger: Logger = getDefaultLogger()): AiClient | null {
  const resolution = resolveAiProvider(config)
  if (!resolution) {
    logger.debug('AI disabled: no provider configured with an available API key')
    return null
  }

  const provider = instantiate(resolution)
  const budget = config.ai?.maxTokensPerRun
  const defaultEffort = config.ai?.effort

  let tokensUsed = 0

  return {
    provider: resolution.provider,
    model: resolution.model,

    get tokensUsed() {
      return tokensUsed
    },

    async complete(request: AiCompletionRequest): Promise<AiResponse> {
      // Checked before the call rather than after, so an exhausted budget
      // cannot spend one more request's worth of tokens on its way out.
      if (budget !== undefined && tokensUsed >= budget)
        throw new AiBudgetExceededError(tokensUsed, budget)

      const model = request.model ? resolveModelAlias(request.model) : resolution.model

      try {
        const response = await provider.complete(
          { ...request, effort: request.effort ?? defaultEffort },
          model,
        )

        tokensUsed += response.usage.outputTokens
        logger.debug(
          `AI ${resolution.provider}/${response.model}: `
          + `${response.usage.inputTokens} in, ${response.usage.outputTokens} out (${response.stopReason})`,
        )

        return response
      }
      catch (error) {
        if (error instanceof AiBudgetExceededError)
          throw error

        // Provider errors often echo request headers back, which carry the key.
        const message = redactError(error)
        logger.warn(`⚠️ AI request failed (${resolution.provider}): ${message}`)
        throw error instanceof AiProviderError
          ? error
          : new AiProviderError(message, resolution.provider)
      }
    },
  }
}

function instantiate(resolution: AiResolution): AiProvider {
  switch (resolution.provider) {
    case 'anthropic':
      return createAnthropicProvider({ apiKey: resolution.apiKey, baseUrl: resolution.baseUrl })
    case 'google':
      return createGoogleProvider({ apiKey: resolution.apiKey, baseUrl: resolution.baseUrl })
    case 'openai':
    case 'openrouter':
    case 'openai-compatible':
      return createOpenAiProvider({
        apiKey: resolution.apiKey,
        baseUrl: resolution.baseUrl,
        provider: resolution.provider,
      })
  }
}

function findApiKey(provider: AiProviderName, overrideEnv?: string): string | undefined {
  const names = overrideEnv ? [overrideEnv, ...PROVIDER_KEY_ENV[provider]] : PROVIDER_KEY_ENV[provider]

  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim().length > 0)
      return value.trim()
  }

  return undefined
}

/**
 * Pick the model for a provider.
 *
 * Only Anthropic ships a built-in default — for other providers a model must
 * be named, because inventing one would silently route requests to a model the
 * user never chose.
 */
function resolveModel(provider: AiProviderName, configured?: string): string | undefined {
  const override = process.env.BUDDY_BOT_MODEL || configured
  if (override)
    return resolveModelAlias(override)

  return PROVIDER_DEFAULT_MODEL[provider]
}
