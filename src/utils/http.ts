import process from 'node:process'

/**
 * Default per-request timeout.
 *
 * Every outbound request buddy-bot makes is a small JSON API call, so 30s is
 * generous. The point is that *some* bound exists: an unbounded `fetch()` in a
 * GitHub Actions job hangs until the 6-hour job cap, turning a transient
 * network stall into a wasted workflow run.
 */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Retry attempts made *after* the initial request. */
export const DEFAULT_RETRIES = 2

/** Base delay for exponential backoff. */
const DEFAULT_RETRY_BASE_MS = 500

/** Ceiling on any single backoff delay, including server-provided `Retry-After`. */
const DEFAULT_MAX_DELAY_MS = 30_000

/**
 * HTTP methods that can be safely re-sent after a network failure because
 * replaying them cannot create a second resource.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'])

/** Statuses that indicate a transient condition worth retrying. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export interface HttpRequestOptions extends RequestInit {
  /** Abort the request after this many milliseconds (default: {@link DEFAULT_TIMEOUT_MS}) */
  timeoutMs?: number
  /** Retry attempts after the first try (default: {@link DEFAULT_RETRIES}) */
  retries?: number
  /** Base delay for exponential backoff in milliseconds */
  retryBaseMs?: number
  /** Cap on any single backoff delay in milliseconds */
  maxDelayMs?: number
  /**
   * Force retries for a non-idempotent method. Only set this when the caller
   * knows a replayed request cannot duplicate a side effect.
   */
  retryNonIdempotent?: boolean
  /** Called before each backoff sleep, for progress logging */
  onRetry?: (info: { attempt: number, delayMs: number, reason: string }) => void
}

/**
 * Raised when a request fails to produce a response at all (timeout, DNS
 * failure, connection reset) after exhausting retries. Non-2xx responses are
 * *not* errors here — they are returned so callers can branch on status.
 */
export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly method: string,
    public readonly attempts: number,
    public readonly timedOut: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'HttpRequestError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveTimeout(explicit?: number): number {
  if (typeof explicit === 'number' && explicit > 0)
    return explicit

  const fromEnv = Number(process.env.BUDDY_HTTP_TIMEOUT_MS)
  if (Number.isFinite(fromEnv) && fromEnv > 0)
    return fromEnv

  return DEFAULT_TIMEOUT_MS
}

/**
 * Read a server-provided retry delay from response headers.
 *
 * Understands `Retry-After` in both of its RFC 9110 forms (delta-seconds and
 * HTTP-date) and GitHub's `x-ratelimit-reset` epoch timestamp, which is the
 * only hint sent when a primary rate limit is exhausted.
 *
 * @returns Delay in milliseconds, or `null` when the response carries no hint
 */
export function parseRetryDelay(headers: Headers, now: number = Date.now()): number | null {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0)
      return seconds * 1000

    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date))
      return Math.max(0, date - now)
  }

  // GitHub signals primary rate limit exhaustion with remaining=0 plus the
  // epoch second at which the window resets.
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'))
    if (Number.isFinite(reset) && reset > 0)
      return Math.max(0, reset * 1000 - now)
  }

  return null
}

/**
 * Whether a response status justifies another attempt.
 *
 * A 403 is retryable only when it carries rate-limit headers — GitHub returns
 * 403 for both "slow down" and "your token cannot do that", and retrying the
 * latter just burns time.
 */
function isRetryableResponse(response: Response): boolean {
  if (TRANSIENT_STATUSES.has(response.status))
    return true

  if (response.status === 403) {
    return response.headers.get('x-ratelimit-remaining') === '0'
      || response.headers.has('retry-after')
  }

  return false
}

/**
 * Whether a rejected request may be replayed for a non-idempotent method.
 *
 * Only statuses that prove the server refused the request *before* acting on
 * it qualify. A 502 or a socket timeout on a POST may well have created the
 * resource, so replaying it risks a duplicate PR or issue.
 */
function isSafeToReplay(response: Response): boolean {
  return response.status === 429 || response.status === 403
}

function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * 2 ** (attempt - 1)
  const jitter = Math.random() * baseMs
  return Math.min(exponential + jitter, maxMs)
}

/**
 * `fetch` with a hard timeout and bounded retries.
 *
 * Non-2xx responses are returned rather than thrown, matching `fetch`
 * semantics — only a total failure to obtain a response raises
 * {@link HttpRequestError}.
 *
 * Retries are conservative by design. Idempotent methods retry on transient
 * statuses and network failures; POST and PATCH retry only when the server
 * explicitly rejected the request with a rate-limit status, because a replayed
 * write could otherwise create a duplicate pull request or issue.
 *
 * @param url - Absolute request URL
 * @param options - Standard `RequestInit` plus timeout and retry controls
 * @returns The final `Response`, successful or not
 * @throws {HttpRequestError} When no response could be obtained after retries
 * @example
 * ```ts
 * const response = await fetchWithTimeout('https://registry.npmjs.org/react', {
 *   timeoutMs: 10_000,
 * })
 * if (response.ok)
 *   console.log(await response.json())
 * ```
 */
export async function fetchWithTimeout(url: string, options: HttpRequestOptions = {}): Promise<Response> {
  const {
    timeoutMs,
    retries = DEFAULT_RETRIES,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    retryNonIdempotent = false,
    onRetry,
    signal: callerSignal,
    ...init
  } = options

  const method = (init.method ?? 'GET').toUpperCase()
  const canReplayFreely = retryNonIdempotent || IDEMPOTENT_METHODS.has(method)
  const effectiveTimeout = resolveTimeout(timeoutMs)
  const maxAttempts = Math.max(1, retries + 1)

  let lastError: unknown
  let lastTimedOut = false

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(effectiveTimeout)
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal

    try {
      const response = await fetch(url, { ...init, signal })

      if (attempt < maxAttempts && isRetryableResponse(response)) {
        // A write may only be replayed when the status proves the server
        // refused it outright.
        if (canReplayFreely || isSafeToReplay(response)) {
          const serverDelay = parseRetryDelay(response.headers)
          const delayMs = Math.min(
            serverDelay ?? backoffDelay(attempt, retryBaseMs, maxDelayMs),
            maxDelayMs,
          )
          onRetry?.({ attempt, delayMs, reason: `HTTP ${response.status}` })
          await sleep(delayMs)
          continue
        }
      }

      return response
    }
    catch (error) {
      lastError = error
      // The caller's own abort is intentional — never retry through it.
      if (callerSignal?.aborted)
        throw error

      lastTimedOut = error instanceof Error
        && (error.name === 'TimeoutError' || error.name === 'AbortError')

      const shouldRetry = attempt < maxAttempts && canReplayFreely
      if (!shouldRetry)
        break

      const delayMs = backoffDelay(attempt, retryBaseMs, maxDelayMs)
      onRetry?.({
        attempt,
        delayMs,
        reason: lastTimedOut ? `timeout after ${effectiveTimeout}ms` : 'network error',
      })
      await sleep(delayMs)
    }
  }

  const detail = lastTimedOut
    ? `timed out after ${effectiveTimeout}ms`
    : `network error: ${lastError instanceof Error ? lastError.message : String(lastError)}`

  throw new HttpRequestError(
    `${method} ${url} failed after ${maxAttempts} attempt(s): ${detail}`,
    url,
    method,
    maxAttempts,
    lastTimedOut,
    { cause: lastError },
  )
}

/**
 * Fetch a URL and parse the body as JSON, returning `null` for any
 * non-2xx response or unparseable body.
 *
 * Intended for best-effort metadata lookups where a miss is not fatal — a
 * package that has no Packagist entry, an image with no Docker Hub tags. Use
 * {@link fetchWithTimeout} directly when the caller must distinguish a 404
 * from a 500.
 *
 * @param url - Absolute request URL
 * @param options - Standard `RequestInit` plus timeout and retry controls
 * @returns The parsed body, or `null` when unavailable
 */
export async function fetchJsonOrNull<T>(url: string, options: HttpRequestOptions = {}): Promise<T | null> {
  try {
    const response = await fetchWithTimeout(url, options)
    if (!response.ok)
      return null
    return await response.json() as T
  }
  catch {
    return null
  }
}
