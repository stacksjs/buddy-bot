import type { AiProviderName } from './types'

/**
 * Short names that resolve to concrete Anthropic model IDs.
 *
 * Only Anthropic aliases ship built in, because only those can be kept
 * accurate here: resolving `gpt` or `gemini` to a specific ID would mean
 * guessing at another vendor's catalogue and silently sending requests to a
 * model the user did not choose. Other providers take an explicit model ID.
 */
export const MODEL_ALIASES: Record<string, string> = {
  'claude': 'claude-opus-5',
  'claude-opus': 'claude-opus-5',
  'opus': 'claude-opus-5',
  'claude-sonnet': 'claude-sonnet-5',
  'sonnet': 'claude-sonnet-5',
  'claude-haiku': 'claude-haiku-4-5',
  'haiku': 'claude-haiku-4-5',
  'claude-fable': 'claude-fable-5',
  'fable': 'claude-fable-5',
}

/** Model used when a provider is selected without naming one. */
export const PROVIDER_DEFAULT_MODEL: Partial<Record<AiProviderName, string>> = {
  anthropic: 'claude-opus-5',
}

/** Environment variable holding each provider's API key. */
export const PROVIDER_KEY_ENV: Record<AiProviderName, string[]> = {
  'anthropic': ['ANTHROPIC_API_KEY'],
  'openai': ['OPENAI_API_KEY'],
  'google': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  'openrouter': ['OPENROUTER_API_KEY'],
  'openai-compatible': ['OPENAI_COMPATIBLE_API_KEY', 'OPENAI_API_KEY'],
}

/**
 * Order providers are auto-selected in when the config names none.
 *
 * Anthropic first because its models are the ones this codebase's prompts and
 * alias table are written against.
 */
export const PROVIDER_PRIORITY: AiProviderName[] = ['anthropic', 'openai', 'google', 'openrouter']

/**
 * Resolve an alias to a concrete model ID.
 *
 * Unknown values pass through unchanged — they are assumed to be concrete IDs,
 * so a newly released model works without waiting for the table to catch up.
 *
 * @param model - Alias or concrete model ID
 * @returns The concrete model ID
 * @example
 * ```ts
 * resolveModelAlias('opus') // => 'claude-opus-5'
 * resolveModelAlias('claude-haiku-4-5') // => 'claude-haiku-4-5'
 * ```
 */
export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model.toLowerCase().trim()] ?? model
}
