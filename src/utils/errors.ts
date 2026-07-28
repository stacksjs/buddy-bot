/**
 * Error raised when the GitHub REST API responds with a non-2xx status.
 *
 * Carries the HTTP status separately from the message so callers can branch on
 * it (for example, treating a 404 as "resource is gone, recreate it") instead
 * of pattern matching on message text.
 */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: string,
    public readonly url: string,
    public readonly repository: string,
    public readonly responseBody?: string,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }

  /** Whether the targeted resource does not exist (or is invisible to this token). */
  get isNotFound(): boolean {
    return this.status === 404 || this.status === 410
  }

  /** Whether the token lacks permission for this operation. */
  get isForbidden(): boolean {
    return this.status === 403
  }
}

/**
 * Convert an unknown thrown value into a single readable log line.
 *
 * Passing a raw `Error` to `console.error` makes Bun print a source-mapped code
 * frame, which for a bundled CLI dumps the whole minified chunk into CI logs.
 * This keeps the useful part — the message, plus any `cause` — and nothing else.
 *
 * @param error - The caught value, of any type
 * @param maxLength - Truncate the result beyond this many characters
 * @returns A trimmed, single-value description safe to log
 * @example
 * ```ts
 * catch (error) {
 *   console.error(`❌ Failed to update issue #${n}: ${formatError(error)}`)
 * }
 * ```
 */
export function formatError(error: unknown, maxLength = 2000): string {
  const message = extractMessage(error)
  return message.length > maxLength
    ? `${message.slice(0, maxLength)}… (truncated)`
    : message
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause
    // Only surface a cause when it adds something the message does not already say
    if (cause !== undefined && cause !== null) {
      const causeMessage = cause instanceof Error ? cause.message : String(cause)
      if (causeMessage && !error.message.includes(causeMessage))
        return `${error.message} (cause: ${causeMessage})`
    }
    return error.message
  }

  if (typeof error === 'string')
    return error

  try {
    return JSON.stringify(error)
  }
  catch {
    return String(error)
  }
}
