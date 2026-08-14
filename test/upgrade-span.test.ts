import type { SpanRelease } from '../src/upgrades/span'
import { describe, expect, it } from 'bun:test'
import { collectSpanNotes, DEFAULT_SPAN_BUDGET, describeSpanGaps } from '../src/upgrades/span'

function release(version: string, body = 'notes', extra: Partial<SpanRelease> = {}): SpanRelease {
  return { version, body, ...extra }
}

describe('release span collection', () => {
  it('success case - keeps major boundaries across a multi-major span', () => {
    // The whole point: 5.x → 7.x breaks at 6.0.0 and 7.0.0, and a "latest
    // releases" fetch scrolls straight past both.
    const span = collectSpanNotes([
      release('7.0.0', 'removed the legacy API'),
      release('6.4.2'),
      release('6.0.0', 'renamed the config key'),
      release('5.9.1'),
      release('5.2.0'),
    ], '5.2.1', '7.0.0')

    expect(span.included).toEqual(['7.0.0', '6.0.0'])
    expect(span.notes).toContain('removed the legacy API')
    expect(span.notes).toContain('renamed the config key')
  })

  it('success case - keeps minor boundaries too', () => {
    const span = collectSpanNotes([
      release('2.0.0'),
      release('1.5.0'),
      release('1.4.0'),
    ], '1.3.0', '2.0.0')

    expect(span.included).toEqual(['2.0.0', '1.5.0', '1.4.0'])
  })

  it('success case - always keeps the target even when it is a patch', () => {
    // It is the version actually being adopted.
    const span = collectSpanNotes([
      release('2.0.3', 'the release being adopted'),
      release('2.0.0', 'the breaking one'),
    ], '1.9.0', '2.0.3')

    expect(span.included).toEqual(['2.0.3', '2.0.0'])
  })

  it('failure case - excludes the version already installed', () => {
    // It has nothing to say about what changed.
    const span = collectSpanNotes([release('2.0.0'), release('1.0.0')], '1.0.0', '2.0.0')

    expect(span.included).toEqual(['2.0.0'])
  })

  it('failure case - excludes releases beyond the target', () => {
    const span = collectSpanNotes([release('3.0.0'), release('2.0.0')], '1.0.0', '2.0.0')

    expect(span.included).toEqual(['2.0.0'])
  })

  it('failure case - excludes prereleases', () => {
    const span = collectSpanNotes([
      release('2.0.0'),
      release('2.0.0-rc.1', 'notes', { isPrerelease: true }),
    ], '1.0.0', '2.0.0')

    expect(span.included).toEqual(['2.0.0'])
  })

  it('success case - reports patch releases as deliberately dropped', () => {
    const span = collectSpanNotes([
      release('2.0.0'),
      release('1.9.3'),
      release('1.9.2'),
    ], '1.9.1', '2.0.0')

    expect(span.omitted.filter(entry => entry.reason === 'patch-release')).toHaveLength(2)
  })

  it('success case - spends the budget on the releases nearest the target', () => {
    // If the span will not fit, the recent majors matter more than ancient
    // ones — they are what the repository is about to run.
    const span = collectSpanNotes([
      release('4.0.0', 'x'.repeat(400)),
      release('3.0.0', 'y'.repeat(400)),
      release('2.0.0', 'z'.repeat(400)),
    ], '1.0.0', '4.0.0', 500)

    expect(span.included).toEqual(['4.0.0'])
    expect(span.omitted.filter(entry => entry.reason === 'budget').map(e => e.version))
      .toEqual(['3.0.0', '2.0.0'])
  })

  it('success case - renders links when the release has one', () => {
    const span = collectSpanNotes(
      [release('2.0.0', 'body', { htmlUrl: 'https://example.test/r/2.0.0' })],
      '1.0.0',
      '2.0.0',
    )

    expect(span.notes).toContain('[2.0.0](https://example.test/r/2.0.0)')
  })

  it('edge case - tolerates a v prefix on either side', () => {
    const span = collectSpanNotes([release('v2.0.0')], 'v1.0.0', 'v2.0.0')

    expect(span.included).toEqual(['v2.0.0'])
  })

  it('edge case - ignores tags that are not semver', () => {
    const span = collectSpanNotes([release('nightly'), release('2.0.0')], '1.0.0', '2.0.0')

    expect(span.included).toEqual(['2.0.0'])
  })

  it('failure case - an empty release list is reported as truncated', () => {
    // Silence here would produce an analysis that read nothing while looking
    // like it read everything.
    const span = collectSpanNotes([], '1.0.0', '2.0.0')

    expect(span.truncated).toBe(true)
    expect(span.notes).toBe('')
  })

  it('edge case - a no-op span is not truncated', () => {
    expect(collectSpanNotes([], '2.0.0', '2.0.0').truncated).toBe(false)
  })

  it('success case - the default budget is generous enough for a real span', () => {
    expect(DEFAULT_SPAN_BUDGET).toBeGreaterThan(10_000)
  })
})

describe('span gap reporting', () => {
  it('success case - says nothing when the span is complete', () => {
    expect(describeSpanGaps(collectSpanNotes([release('2.0.0')], '1.0.0', '2.0.0'))).toBe('')
  })

  it('success case - names releases dropped for length', () => {
    const span = collectSpanNotes([
      release('3.0.0', 'x'.repeat(400)),
      release('2.0.0', 'y'.repeat(400)),
    ], '1.0.0', '3.0.0', 500)

    expect(describeSpanGaps(span)).toContain('2.0.0')
  })

  it('success case - flags an analysis with no notes at all', () => {
    expect(describeSpanGaps(collectSpanNotes([], '1.0.0', '2.0.0'))).toContain('usage sites alone')
  })

  it('edge case - patch drops are not worth reporting', () => {
    // They were never going to describe a breaking change.
    const span = collectSpanNotes([release('2.0.0'), release('1.9.1')], '1.9.0', '2.0.0')

    expect(describeSpanGaps(span)).toBe('')
  })
})
