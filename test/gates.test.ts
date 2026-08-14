import { describe, expect, it } from 'bun:test'
import {
  checkDependencies,
  checkDescription,
  checkTitleFormat,
  runGates,
  summarizeGates,
} from '../src/gates/checks'

describe('title format check', () => {
  it('success case - accepts conventional commit titles', () => {
    expect(checkTitleFormat('feat(review): add path filters', 'error').passed).toBe(true)
    expect(checkTitleFormat('fix: correct the off-by-one', 'error').passed).toBe(true)
    expect(checkTitleFormat('chore(deps)!: drop node 18', 'error').passed).toBe(true)
  })

  it('failure case - rejects a title with no type', () => {
    const result = checkTitleFormat('Updated some stuff', 'error')

    expect(result.passed).toBe(false)
    expect(result.detail).toContain('feat(scope)')
  })

  it('failure case - rejects an unknown type', () => {
    expect(checkTitleFormat('wip: still working', 'error').passed).toBe(false)
  })
})

describe('description check', () => {
  it('success case - accepts a substantive description', () => {
    expect(checkDescription('This change adds path filters so reviews can be scoped.', { mode: 'error' }).passed).toBe(true)
  })

  it('failure case - rejects an empty description', () => {
    const result = checkDescription('', { mode: 'error' })

    expect(result.passed).toBe(false)
    expect(result.summary).toContain('missing')
  })

  it('failure case - reports missing required sections', () => {
    const result = checkDescription(
      '## Summary\n\nSomething changed here in detail.',
      { mode: 'error', requireSections: ['Summary', 'Testing'] },
    )

    expect(result.passed).toBe(false)
    expect(result.detail).toContain('Testing')
    expect(result.detail).not.toContain('Summary')
  })

  it('success case - accepts when every required section is present', () => {
    const body = '## Summary\n\nWhat changed.\n\n## Testing\n\nHow it was verified.'

    expect(checkDescription(body, { mode: 'error', requireSections: ['Summary', 'Testing'] }).passed).toBe(true)
  })
})

describe('dependency gate', () => {
  it('success case - passes a clean dependency set', () => {
    const result = checkDependencies(
      [{ name: 'react', version: '18.0.0', license: 'MIT' }],
      { mode: 'error', licenseAllowlist: ['MIT', 'Apache-2.0'] },
    )

    expect(result.passed).toBe(true)
  })

  it('failure case - blocks a vulnerable dependency', () => {
    const result = checkDependencies(
      [{ name: 'bad-pkg', version: '1.0.0', vulnerable: true }],
      { mode: 'error' },
    )

    expect(result.passed).toBe(false)
    expect(result.detail).toContain('known vulnerability')
  })

  it('failure case - blocks a deprecated dependency', () => {
    const result = checkDependencies(
      [{ name: 'old-pkg', version: '1.0.0', deprecated: true }],
      { mode: 'error' },
    )

    expect(result.detail).toContain('deprecated')
  })

  it('failure case - blocks a license outside the allowlist', () => {
    // The point of an allowlist is that anything not on it needs a decision.
    const result = checkDependencies(
      [{ name: 'copyleft-pkg', version: '1.0.0', license: 'GPL-3.0' }],
      { mode: 'error', licenseAllowlist: ['MIT'] },
    )

    expect(result.passed).toBe(false)
    expect(result.detail).toContain('GPL-3.0')
  })

  it('success case - no allowlist means licenses are not checked', () => {
    const result = checkDependencies(
      [{ name: 'any-pkg', version: '1.0.0', license: 'GPL-3.0' }],
      { mode: 'error' },
    )

    expect(result.passed).toBe(true)
  })

  it('edge case - an empty dependency set passes', () => {
    expect(checkDependencies([], { mode: 'error' }).passed).toBe(true)
    expect(checkDependencies(undefined, { mode: 'error' }).passed).toBe(true)
  })
})

describe('running and summarizing gates', () => {
  const input = { title: 'Updated stuff', body: 'short' }

  it('success case - runs only the configured checks', () => {
    const results = runGates(input, { titleFormat: 'error' })

    expect(results.map(result => result.name)).toEqual(['title-format'])
  })

  it('success case - an off check does not run', () => {
    expect(runGates(input, { titleFormat: 'off' })).toEqual([])
  })

  it('failure case - an error-mode failure blocks', () => {
    const summary = summarizeGates(runGates(input, { titleFormat: 'error' }))

    expect(summary.conclusion).toBe('failure')
    expect(summary.title).toContain('failed')
  })

  it('success case - a warning-mode failure reports without blocking', () => {
    // This is what makes a gate adoptable before a team agrees to enforce it.
    const summary = summarizeGates(runGates(input, { titleFormat: 'warning' }))

    expect(summary.conclusion).toBe('success')
    expect(summary.title).toContain('warning')
    expect(summary.summary).toContain('⚠️')
  })

  it('success case - all passing reports success', () => {
    const summary = summarizeGates(runGates(
      { title: 'feat: add a thing', body: 'A sufficiently detailed description of the change.' },
      { titleFormat: 'error', description: { mode: 'error' } },
    ))

    expect(summary.conclusion).toBe('success')
    expect(summary.title).toBe('All checks passed')
  })

  it('edge case - no configured checks is neutral, not a pass', () => {
    const summary = summarizeGates([])

    expect(summary.conclusion).toBe('neutral')
  })

  it('success case - the summary explains each check', () => {
    const summary = summarizeGates(runGates(input, { titleFormat: 'error', description: { mode: 'warning' } }))

    expect(summary.summary).toContain('title-format')
    expect(summary.summary).toContain('description')
  })
})
