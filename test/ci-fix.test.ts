import { describe, expect, it } from 'bun:test'
import { classifyFailure, describeFailure, extractErrorLines } from '../src/ci/classify'
import { attemptFix } from '../src/ci/fix'

const LOCKFILE_LOG = `
$ bun install --frozen-lockfile
bun install v1.2.19
error: lockfile had changes, but lockfile is frozen
note: try re-running without --frozen-lockfile
`

const FLAKE_LOG = `
$ bun install
error: request to https://registry.npmjs.org/react failed, reason: ECONNRESET
`

const TYPE_ERROR_LOG = `
$ bunx tsc --noEmit
src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
`

const TEST_LOG = `
$ bun test
(fail) auth > rejects an expired token
 1 fail
`

describe('failure classification', () => {
  it('success case - recognises lock file drift as mechanically fixable', () => {
    const failure = classifyFailure(LOCKFILE_LOG)

    expect(failure.kind).toBe('lockfile-drift')
    expect(failure.mechanical).toBe(true)
  })

  it('success case - recognises a network flake as retryable', () => {
    const failure = classifyFailure(FLAKE_LOG)

    expect(failure.kind).toBe('flake')
    expect(failure.mechanical).toBe(true)
  })

  it('success case - recognises a type error', () => {
    expect(classifyFailure(TYPE_ERROR_LOG).kind).toBe('type-error')
  })

  it('success case - recognises a test failure', () => {
    expect(classifyFailure(TEST_LOG).kind).toBe('test-failure')
  })

  it('success case - prefers lock file drift over generic install noise', () => {
    // Misreading this as an install failure would send a one-command fix to
    // the model instead.
    const mixed = `${LOCKFILE_LOG}\ncould not resolve dependency foo`

    expect(classifyFailure(mixed).kind).toBe('lockfile-drift')
  })

  it('edge case - an unrecognised failure still carries evidence', () => {
    const failure = classifyFailure('something went wrong\nFATAL: unexplained')

    expect(failure.kind).toBe('unknown')
    expect(failure.mechanical).toBe(false)
    expect(failure.evidence.length).toBeGreaterThan(0)
  })

  it('edge case - an empty log classifies as unknown', () => {
    expect(classifyFailure('').kind).toBe('unknown')
  })

  it('success case - describes every kind in plain language', () => {
    for (const log of [LOCKFILE_LOG, FLAKE_LOG, TYPE_ERROR_LOG, TEST_LOG, ''])
      expect(describeFailure(classifyFailure(log)).length).toBeGreaterThan(10)
  })
})

describe('error line extraction', () => {
  it('success case - keeps error lines and drops stack noise', () => {
    const lines = ['setup step', 'error: it broke', '    at foo (bar.ts:1)', 'more setup']

    const extracted = extractErrorLines(lines)

    expect(extracted).toContain('error: it broke')
    expect(extracted.some(line => line.startsWith('at foo'))).toBe(false)
  })

  it('edge case - falls back to the tail when nothing looks like an error', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`)

    const extracted = extractErrorLines(lines, 5)

    expect(extracted).toHaveLength(5)
    expect(extracted.at(-1)).toBe('line 99')
  })
})

describe('fix attempts', () => {
  const base = { workspace: '/tmp', baseBranch: 'main' }

  it('success case - fixes lock file drift without a model', async () => {
    let regenerated = false
    const outcome = await attemptFix({
      ...base,
      log: LOCKFILE_LOG,
      regenerateLockfile: async () => {
        regenerated = true
        return true
      },
    })

    // No AI configured, and none needed.
    expect(regenerated).toBe(true)
    expect(outcome.action).toBe('mechanical-fix')
    expect(outcome.fixed).toBe(true)
  })

  it('success case - recommends a retry for a flake', async () => {
    const outcome = await attemptFix({ ...base, log: FLAKE_LOG })

    expect(outcome.action).toBe('retry')
    expect(outcome.report).toContain('transient')
  })

  it('failure case - refuses when the failure exists on the base branch', async () => {
    // Patching here would attribute someone else's breakage to this change.
    let regenerated = false
    const outcome = await attemptFix({
      ...base,
      log: LOCKFILE_LOG,
      failsOnBase: true,
      regenerateLockfile: async () => {
        regenerated = true
        return true
      },
    })

    expect(regenerated).toBe(false)
    expect(outcome.action).toBe('skipped')
    expect(outcome.report).toContain('base branch')
  })

  it('failure case - stops after the attempt cap rather than looping', async () => {
    const outcome = await attemptFix({ ...base, log: TYPE_ERROR_LOG, priorAttempts: 3, maxAttempts: 3 })

    expect(outcome.action).toBe('skipped')
    expect(outcome.report).toContain('stopping')
  })

  it('success case - reports usefully when no AI is configured', async () => {
    const outcome = await attemptFix({ ...base, log: TYPE_ERROR_LOG })

    expect(outcome.action).toBe('reported')
    expect(outcome.fixed).toBe(false)
    // An unfixable failure still gets an actionable comment, not silence.
    expect(outcome.report).toContain('does not type-check')
  })

  it('success case - includes log evidence in the report', async () => {
    const outcome = await attemptFix({ ...base, log: TYPE_ERROR_LOG })

    expect(outcome.report).toContain('error TS2322')
  })
})
