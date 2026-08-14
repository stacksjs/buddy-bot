import type { PullRequest } from '../src/types'
import type { ReportMetrics } from '../src/reports/metrics'
import { describe, expect, it } from 'bun:test'
import { appendHistory, findPrevious, HISTORY_LIMIT, parseHistory } from '../src/reports/history'
import { computeDeltas, computeMetrics } from '../src/reports/metrics'
import { REPORT_MARKER, renderReport, withNarrative } from '../src/reports/render'
import { Logger } from '../src/utils/logger'

const NOW = new Date('2026-08-14T12:00:00Z')

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 'chore(deps): bump x',
    body: '',
    head: 'buddy-bot/update-x',
    base: 'main',
    state: 'open',
    url: 'https://git.test/pull/1',
    createdAt: daysAgo(3),
    updatedAt: daysAgo(1),
    author: 'buddy-bot',
    reviewers: [],
    assignees: [],
    labels: [],
    draft: false,
    ...overrides,
  }
}

function baseInput(overrides: Partial<Parameters<typeof computeMetrics>[0]> = {}) {
  return {
    period: '30d' as const,
    now: NOW,
    pullRequests: [] as PullRequest[],
    updates: [],
    dependenciesByEcosystem: { npm: 100 },
    ...overrides,
  }
}

describe('health metrics', () => {
  it('success case - counts outdated as a share of everything declared', () => {
    // Against the outdated set alone the percentage would always be 100%.
    const metrics = computeMetrics(baseInput({
      dependenciesByEcosystem: { npm: 80, composer: 20 },
      updates: [
        { name: 'a', updateType: 'major', dependencyType: 'dependencies', file: 'package.json' },
        { name: 'b', updateType: 'patch', dependencyType: 'dependencies', file: 'package.json' },
      ],
    }))

    expect(metrics.health.total).toBe(100)
    expect(metrics.health.outdated).toBe(2)
    expect(metrics.health.outdatedPercent).toBe(2)
    expect(metrics.health.majorBehind).toBe(1)
  })

  it('success case - counts dependencies with advisories', () => {
    const metrics = computeMetrics(baseInput({
      updates: [
        { name: 'a', updateType: 'patch', dependencyType: 'dependencies', file: 'p', securityAdvisories: [{}] },
        { name: 'b', updateType: 'patch', dependencyType: 'dependencies', file: 'p' },
      ],
    }))

    expect(metrics.health.vulnerable).toBe(1)
  })

  it('edge case - no dependencies yields zero rather than a division by zero', () => {
    const metrics = computeMetrics(baseInput({ dependenciesByEcosystem: {} }))

    expect(metrics.health.total).toBe(0)
    expect(metrics.health.outdatedPercent).toBe(0)
  })
})

describe('activity metrics', () => {
  it('success case - counts only buddy-bot pull requests', () => {
    const metrics = computeMetrics(baseInput({
      pullRequests: [pr(), pr({ number: 2, head: 'feature/manual' })],
    }))

    expect(metrics.activity.opened).toBe(1)
  })

  it('success case - excludes pull requests older than the window', () => {
    const metrics = computeMetrics(baseInput({
      period: '7d',
      pullRequests: [pr({ createdAt: daysAgo(3) }), pr({ number: 2, createdAt: daysAgo(30) })],
    }))

    expect(metrics.activity.opened).toBe(1)
  })

  it('success case - a merged pull request is not counted as closed', () => {
    // The distinction is the whole point: merged means the update landed.
    const metrics = computeMetrics(baseInput({
      pullRequests: [
        pr({ state: 'merged', mergedAt: daysAgo(1) }),
        pr({ number: 2, state: 'closed' }),
      ],
    }))

    expect(metrics.activity.merged).toBe(1)
    expect(metrics.activity.closed).toBe(1)
  })

  it('success case - computes a median time to merge', () => {
    const metrics = computeMetrics(baseInput({
      pullRequests: [
        pr({ createdAt: daysAgo(3), state: 'merged', mergedAt: daysAgo(2) }),
        pr({ number: 2, createdAt: daysAgo(5), state: 'merged', mergedAt: daysAgo(2) }),
        pr({ number: 3, createdAt: daysAgo(9), state: 'merged', mergedAt: daysAgo(2) }),
      ],
    }))

    expect(metrics.activity.medianHoursToMerge).toBe(72)
  })

  it('edge case - nothing merged has no median', () => {
    expect(computeMetrics(baseInput({ pullRequests: [pr()] })).activity.medianHoursToMerge).toBeNull()
  })

  it('success case - merge rate compares both counts in the same window', () => {
    const metrics = computeMetrics(baseInput({
      pullRequests: [
        pr({ state: 'merged', mergedAt: daysAgo(1) }),
        pr({ number: 2 }),
      ],
    }))

    expect(metrics.activity.mergeRate).toBe(50)
  })
})

describe('deltas', () => {
  function snapshot(overrides: Partial<ReportMetrics['health'] & ReportMetrics['activity']> = {}): ReportMetrics {
    return computeMetrics(baseInput({
      updates: Array.from({ length: overrides.outdated ?? 0 }, (_, index) => ({
        name: `p${index}`,
        updateType: 'patch' as const,
        dependencyType: 'dependencies',
        file: 'package.json',
      })),
    }))
  }

  it('success case - a first report has nothing to compare against', () => {
    expect(computeDeltas(snapshot(), null)).toEqual({})
  })

  it('success case - fewer outdated dependencies is an improvement', () => {
    const deltas = computeDeltas(snapshot({ outdated: 2 }), snapshot({ outdated: 5 }))

    expect(deltas.outdated).toEqual({ current: 2, previous: 5, change: -3, improved: true })
  })

  it('success case - more vulnerable dependencies is not an improvement', () => {
    // Getting the direction wrong would congratulate a repository for
    // regressing.
    const current = snapshot()
    current.health.vulnerable = 4
    const previous = snapshot()
    previous.health.vulnerable = 1

    expect(computeDeltas(current, previous).vulnerable.improved).toBe(false)
  })

  it('success case - more merged pull requests is an improvement', () => {
    const current = snapshot()
    current.activity.merged = 10
    const previous = snapshot()
    previous.activity.merged = 3

    expect(computeDeltas(current, previous).merged.improved).toBe(true)
  })

  it('edge case - no movement is neither better nor worse', () => {
    expect(computeDeltas(snapshot(), snapshot()).outdated.change).toBe(0)
  })
})

describe('report rendering', () => {
  const metrics = computeMetrics(baseInput({
    dependenciesByEcosystem: { npm: 90, 'github-actions': 10 },
    updates: [{ name: 'a', updateType: 'major', dependencyType: 'dependencies', file: 'package.json' }],
    pullRequests: [pr({ state: 'merged', mergedAt: daysAgo(1) })],
  }))

  it('success case - carries the marker so it updates in place', () => {
    // Otherwise every period opens a near-identical issue instead of one
    // readable trend.
    expect(renderReport(metrics)).toContain(REPORT_MARKER)
  })

  it('success case - renders health and activity tables', () => {
    const report = renderReport(metrics)

    expect(report).toContain('Dependency health')
    expect(report).toContain('Bot activity')
    expect(report).toContain('| npm | 90 |')
  })

  it('success case - says plainly that this is a baseline', () => {
    expect(renderReport(metrics, {})).toContain('baseline')
  })

  it('success case - marks a regression', () => {
    const worse = { ...metrics, health: { ...metrics.health, vulnerable: 3 } }
    const deltas = computeDeltas(worse, metrics)

    expect(renderReport(worse, deltas)).toContain('⚠️')
  })

  it('success case - an improvement is not marked as a regression', () => {
    const better = { ...metrics, health: { ...metrics.health, vulnerable: 0 } }
    const deltas = computeDeltas(better, { ...metrics, health: { ...metrics.health, vulnerable: 3 } })

    expect(renderReport(better, deltas)).not.toContain('⚠️')
  })

  it('success case - explains what the merge rate is not', () => {
    // The number invites being read as a completion rate.
    expect(renderReport(metrics)).toContain('depress it by definition')
  })

  it('edge case - a repository with no dependencies still renders', () => {
    const empty = computeMetrics(baseInput({ dependenciesByEcosystem: {} }))

    expect(renderReport(empty)).toContain('No dependencies detected')
  })
})

describe('narrative', () => {
  const metrics = computeMetrics(baseInput())

  it('success case - with no AI the report is unchanged', async () => {
    const report = renderReport(metrics)

    expect(await withNarrative(report, metrics, null)).toBe(report)
  })

  it('success case - prepends prose above the tables', async () => {
    const ai = {
      provider: 'anthropic' as const,
      model: 'test',
      tokensUsed: 0,
      async complete() {
        return {
          text: 'Dependencies are in good shape.',
          toolCalls: [],
          stopReason: 'end' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'test',
        }
      },
    }

    const output = await withNarrative(renderReport(metrics), metrics, ai)

    expect(output).toContain('Dependencies are in good shape.')
    expect(output.indexOf('Dependencies are in good shape.'))
      .toBeLessThan(output.indexOf('### Dependency health'))
  })

  it('failure case - a failing narrative leaves the numbers intact', async () => {
    // The report's value is the metrics; the prose is cosmetic.
    const report = renderReport(metrics)
    const ai = {
      provider: 'anthropic' as const,
      model: 'test',
      tokensUsed: 0,
      async complete(): Promise<never> {
        throw new Error('rate limited')
      },
    }

    expect(await withNarrative(report, metrics, ai, undefined, Logger.silent())).toBe(report)
  })
})

describe('history', () => {
  const snapshot = computeMetrics(baseInput())

  it('success case - round-trips through JSONL', () => {
    const content = appendHistory([], snapshot)

    expect(parseHistory(content)).toHaveLength(1)
    expect(parseHistory(content)[0].period).toBe('30d')
  })

  it('success case - a corrupt line loses one snapshot, not the history', () => {
    const content = `${JSON.stringify(snapshot)}\n{broken\n${JSON.stringify(snapshot)}\n`

    expect(parseHistory(content)).toHaveLength(2)
  })

  it('failure case - an entry missing its shape is not kept', () => {
    // Keeping it would let a malformed entry become the "previous" report.
    expect(parseHistory('{"period":"30d"}\n')).toEqual([])
  })

  it('success case - trims to the retention limit', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 5 }, () => snapshot)

    expect(parseHistory(appendHistory(many, snapshot))).toHaveLength(HISTORY_LIMIT)
  })

  it('success case - compares only against the same period', () => {
    // A 7-day count next to a 30-day one is not a delta, it is a category
    // error that would show as a change that never happened.
    const weekly = computeMetrics(baseInput({ period: '7d' }))

    expect(findPrevious([weekly, snapshot], '7d')?.period).toBe('7d')
    expect(findPrevious([weekly], '30d')).toBeNull()
  })

  it('edge case - an absent file yields no history', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('')).toEqual([])
  })
})
