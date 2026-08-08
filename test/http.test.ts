import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import {
  DEFAULT_TIMEOUT_MS,
  fetchJsonOrNull,
  fetchWithTimeout,
  HttpRequestError,
  parseRetryDelay,
} from '../src/utils/http'

function response(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('http', () => {
  let fetchSpy: any

  afterEach(() => {
    fetchSpy?.mockRestore?.()
  })

  describe('parseRetryDelay', () => {
    it('should read Retry-After as delta-seconds', () => {
      const headers = new Headers({ 'retry-after': '30' })
      expect(parseRetryDelay(headers)).toBe(30_000)
    })

    it('should read Retry-After as an HTTP date', () => {
      const now = Date.parse('2026-01-01T00:00:00Z')
      const headers = new Headers({ 'retry-after': 'Thu, 01 Jan 2026 00:01:00 GMT' })
      expect(parseRetryDelay(headers, now)).toBe(60_000)
    })

    it('should fall back to x-ratelimit-reset when the quota is exhausted', () => {
      const now = 1_700_000_000_000
      const headers = new Headers({
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(now / 1000 + 45),
      })
      expect(parseRetryDelay(headers, now)).toBe(45_000)
    })

    it('should ignore x-ratelimit-reset while quota remains', () => {
      const headers = new Headers({
        'x-ratelimit-remaining': '4999',
        'x-ratelimit-reset': '1700000000',
      })
      expect(parseRetryDelay(headers)).toBeNull()
    })

    it('should return null when no hint is present', () => {
      expect(parseRetryDelay(new Headers())).toBeNull()
    })

    it('should never return a negative delay for a past date', () => {
      const now = Date.parse('2026-01-01T00:00:00Z')
      const headers = new Headers({ 'retry-after': 'Wed, 31 Dec 2025 23:00:00 GMT' })
      expect(parseRetryDelay(headers, now)).toBe(0)
    })
  })

  describe('fetchWithTimeout', () => {
    it('success case - returns the response', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(200, { ok: true }))

      const result = await fetchWithTimeout('https://example.com/a')

      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should attach an abort signal to every request', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(200))

      await fetchWithTimeout('https://example.com/a')

      const init = fetchSpy.mock.calls[0][1]
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('should return non-2xx responses rather than throwing', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(404))

      const result = await fetchWithTimeout('https://example.com/missing')

      expect(result.status).toBe(404)
    })

    it('should not retry a 404', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(404))

      await fetchWithTimeout('https://example.com/missing', { retries: 3 })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should retry a 503 and return the eventual success', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(response(503))
        .mockResolvedValueOnce(response(200, { done: true }))

      const result = await fetchWithTimeout('https://example.com/a', { retryBaseMs: 1 })

      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('should honour a server-supplied Retry-After', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(response(429, {}, { 'retry-after': '0' }))
        .mockResolvedValueOnce(response(200))

      const result = await fetchWithTimeout('https://example.com/a', { retryBaseMs: 1 })

      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('should treat a 403 without rate-limit headers as terminal', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(403))

      const result = await fetchWithTimeout('https://example.com/a', { retries: 3, retryBaseMs: 1 })

      expect(result.status).toBe(403)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should retry a 403 that carries rate-limit headers', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(response(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' }))
        .mockResolvedValueOnce(response(200))

      const result = await fetchWithTimeout('https://example.com/a', { retryBaseMs: 1 })

      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('failure case - throws HttpRequestError after exhausting retries', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))

      const promise = fetchWithTimeout('https://example.com/a', { retries: 1, retryBaseMs: 1 })

      await expect(promise).rejects.toBeInstanceOf(HttpRequestError)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('should never replay a POST after a network error', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection reset'))

      const promise = fetchWithTimeout('https://example.com/a', {
        method: 'POST',
        retries: 3,
        retryBaseMs: 1,
      })

      await expect(promise).rejects.toBeInstanceOf(HttpRequestError)
      // A reset mid-POST may still have created the resource upstream.
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should never replay a POST on a 5xx', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(502))

      const result = await fetchWithTimeout('https://example.com/a', {
        method: 'POST',
        retries: 3,
        retryBaseMs: 1,
      })

      expect(result.status).toBe(502)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should replay a POST on a 429, which the server provably refused', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(response(429, {}, { 'retry-after': '0' }))
        .mockResolvedValueOnce(response(201))

      const result = await fetchWithTimeout('https://example.com/a', {
        method: 'POST',
        retryBaseMs: 1,
      })

      expect(result.status).toBe(201)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('should replay a POST on 5xx when the caller opts in', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(response(503))
        .mockResolvedValueOnce(response(200))

      const result = await fetchWithTimeout('https://example.com/a', {
        method: 'POST',
        retryNonIdempotent: true,
        retryBaseMs: 1,
      })

      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('should report retries through onRetry', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(response(503))
        .mockResolvedValueOnce(response(200))

      const seen: string[] = []
      await fetchWithTimeout('https://example.com/a', {
        retryBaseMs: 1,
        onRetry: ({ reason }) => seen.push(reason),
      })

      expect(seen).toEqual(['HTTP 503'])
    })

    it('edge case - a caller abort is not retried', async () => {
      const controller = new AbortController()
      fetchSpy = (spyOn(globalThis, 'fetch') as any).mockImplementation(async () => {
        controller.abort()
        throw new DOMException('Aborted', 'AbortError')
      })

      const promise = fetchWithTimeout('https://example.com/a', {
        signal: controller.signal,
        retries: 3,
        retryBaseMs: 1,
      })

      await expect(promise).rejects.toThrow()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should expose a sane default timeout', () => {
      expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0)
      expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(60_000)
    })
  })

  describe('fetchJsonOrNull', () => {
    it('success case - parses the body', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(200, { name: 'react' }))

      const result = await fetchJsonOrNull<{ name: string }>('https://example.com/a')

      expect(result).toEqual({ name: 'react' })
    })

    it('failure case - returns null for a non-2xx', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response(404))

      expect(await fetchJsonOrNull('https://example.com/a')).toBeNull()
    })

    it('failure case - returns null when the request fails outright', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))

      expect(await fetchJsonOrNull('https://example.com/a', { retries: 0 })).toBeNull()
    })

    it('edge case - returns null for a malformed body', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('not json', { status: 200 }),
      )

      expect(await fetchJsonOrNull('https://example.com/a')).toBeNull()
    })
  })
})
