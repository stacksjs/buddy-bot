import { describe, expect, it } from 'bun:test'
import { formatError, GitHubApiError } from '../src/utils/errors'

describe('formatError', () => {
  it('success case - returns the message for a plain Error', () => {
    expect(formatError(new Error('boom'))).toBe('boom')
  })

  it('success case - returns a string passed directly', () => {
    expect(formatError('plain failure')).toBe('plain failure')
  })

  it('appends a cause when it adds new information', () => {
    const error = new Error('outer failed', { cause: new Error('inner reason') })
    expect(formatError(error)).toBe('outer failed (cause: inner reason)')
  })

  it('omits a cause already contained in the message', () => {
    const error = new Error('outer failed: inner reason', { cause: new Error('inner reason') })
    expect(formatError(error)).toBe('outer failed: inner reason')
  })

  it('edge case - truncates very long messages', () => {
    const result = formatError(new Error('x'.repeat(5000)), 100)
    expect(result).toEndWith('… (truncated)')
    expect(result.length).toBeLessThan(150)
  })

  it('edge case - serializes non-Error objects', () => {
    expect(formatError({ status: 403 })).toBe('{"status":403}')
  })

  it('never includes a stack trace, so bundled source is not dumped to logs', () => {
    const error = new Error('403 Forbidden')
    // A bundled CLI's stack frame would otherwise print minified dist output
    error.stack = 'Error: 403 Forbidden\n    at import{C as R}from"./chunk-vx34638n.js"'
    const result = formatError(error)
    expect(result).toBe('403 Forbidden')
    expect(result).not.toContain('chunk-')
  })
})

describe('GitHubApiError', () => {
  const makeError = (status: number) =>
    new GitHubApiError(`GitHub API error: ${status}`, status, 'PATCH', 'https://api.github.com/repos/o/r/issues/1', 'o/r')

  it('classifies a 404 as not found', () => {
    expect(makeError(404).isNotFound).toBe(true)
    expect(makeError(404).isForbidden).toBe(false)
  })

  it('classifies a 410 Gone as not found', () => {
    expect(makeError(410).isNotFound).toBe(true)
  })

  it('classifies a 403 as forbidden but not missing', () => {
    expect(makeError(403).isForbidden).toBe(true)
    expect(makeError(403).isNotFound).toBe(false)
  })

  it('retains the status and repository for callers to branch on', () => {
    const error = makeError(404)
    expect(error.status).toBe(404)
    expect(error.repository).toBe('o/r')
    expect(error.name).toBe('GitHubApiError')
    expect(error).toBeInstanceOf(Error)
  })
})
