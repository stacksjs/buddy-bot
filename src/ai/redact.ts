/**
 * Patterns for credentials that must never reach a log or a transcript.
 *
 * Deliberately broad: a false positive costs a masked string in a debug line,
 * while a false negative writes a live key into CI output that is retained and
 * often world-readable.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Provider keys: sk-..., sk-ant-..., sk-or-v1-...
  /\bsk-[a-z0-9-]*[a-z0-9]{16,}\b/gi,
  // Google API keys
  /\bAIza[\w-]{20,}\b/g,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // Bearer headers
  /\b(bearer\s+)[\w.\-~+/]{20,}=*/gi,
  // Anything shaped like an assignment to a secret-named variable
  // Quotes are written as escapes so the pattern reads the same under any
  // quote-style lint rule.
  /\b([\w-]*(?:token|secret|password|api[_-]?key|credential)[\w-]*\s*[=:]\s*)([\u0022\u0027]?)[^\s\u0022\u0027,}]{8,}\2/gi,
]

/** Replacement written in place of a detected secret. */
export const REDACTED = '[redacted]'

/**
 * Mask anything that looks like a credential.
 *
 * Applied to every log line, error message and transcript entry the AI layer
 * produces — a provider error often echoes the request headers back, and those
 * carry the key.
 *
 * @param value - Text that may contain credentials
 * @returns The same text with credentials replaced
 * @example
 * ```ts
 * redact('failed with key sk-ant-api03-abcdefghijklmnop')
 * // => 'failed with key [redacted]'
 * ```
 */
export function redact(value: string): string {
  let masked = value

  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, (_match: string, prefix?: string, quote?: string) => {
      // Assignment-shaped matches keep their key name so the log still says
      // *which* credential was involved.
      if (typeof prefix === 'string' && prefix.length > 0)
        return `${prefix}${quote ?? ''}${REDACTED}${quote ?? ''}`
      return REDACTED
    })
  }

  return masked
}

/**
 * Mask credentials anywhere inside an arbitrary value.
 *
 * @param value - Value to sanitize; objects and arrays are walked
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string')
    return redact(value)

  if (Array.isArray(value))
    return value.map(redactDeep)

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactDeep(entry)]),
    )
  }

  return value
}

/**
 * Format an unknown error for logging, with credentials masked.
 *
 * @param error - Thrown value
 */
export function redactError(error: unknown): string {
  if (error instanceof Error)
    return redact(error.message)
  return redact(String(error))
}
