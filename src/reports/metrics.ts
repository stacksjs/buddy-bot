import type { PullRequest } from '../types'

/** How far back a report looks. */
export type ReportPeriod = '7d' | '30d' | '90d'

/** Every period the CLI accepts. */
export const REPORT_PERIODS: ReportPeriod[] = ['7d', '30d', '90d']

/** Days in each period. */
export const PERIOD_DAYS: Record<ReportPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 }

/** Dependency counts, by state. */
export interface HealthMetrics {
  /** Dependencies seen, per ecosystem */
  byEcosystem: Record<string, number>
  total: number
  outdated: number
  /** Outdated as a whole-number percentage of total */
  outdatedPercent: number
  majorBehind: number
  vulnerable: number
  deprecated: number
  /** Packages held back by a range declared elsewhere in the tree */
  drifted: number
}

/** What the bot did during the period. */
export interface ActivityMetrics {
  opened: number
  merged: number
  closed: number
  /** Still open at the end of the period */
  open: number
  /** Median hours from open to merge, null when nothing merged */
  medianHoursToMerge: number | null
  /** Merged as a whole-number percentage of opened */
  mergeRate: number
}

/** A full snapshot, comparable against an earlier one. */
export interface ReportMetrics {
  period: ReportPeriod
  /** ISO timestamp the snapshot covers up to */
  generatedAt: string
  health: HealthMetrics
  activity: ActivityMetrics
}

/** The inputs a snapshot is computed from. */
export interface MetricsInput {
  period: ReportPeriod
  /** Now, injected so a snapshot is reproducible */
  now: Date
  /** Every pull request the provider reported, any state */
  pullRequests: PullRequest[]
  /** Branch prefix identifying buddy-bot's own pull requests */
  branchPrefix?: string
  updates: Array<{
    name: string
    updateType: 'major' | 'minor' | 'patch'
    dependencyType: string
    file: string
    securityAdvisories?: unknown[]
  }>
  /** Total dependencies scanned, per ecosystem */
  dependenciesByEcosystem: Record<string, number>
  deprecated?: number
  drifted?: number
}

/**
 * Compute a metrics snapshot.
 *
 * Everything here is arithmetic over data the scan already produced, so a
 * report works with no AI provider and no external service. The AI narrative
 * is a layer on top of these numbers, never a replacement for them — a report
 * whose figures came from a language model is not a report.
 *
 * @param input - Scan results and pull request history
 * @returns The snapshot
 * @example
 * ```ts
 * const metrics = computeMetrics({ period: '30d', now: new Date(), pullRequests, updates, dependenciesByEcosystem })
 * ```
 */
export function computeMetrics(input: MetricsInput): ReportMetrics {
  const since = new Date(input.now.getTime() - PERIOD_DAYS[input.period] * 24 * 60 * 60 * 1000)
  const prefix = input.branchPrefix ?? 'buddy-bot/'

  const ours = input.pullRequests.filter(pr => pr.head.startsWith(prefix))
  const openedInPeriod = ours.filter(pr => pr.createdAt >= since)
  const mergedInPeriod = ours.filter(pr => pr.mergedAt !== undefined && pr.mergedAt >= since)

  const closedInPeriod = ours.filter(pr =>
    pr.state === 'closed' && pr.mergedAt === undefined && pr.updatedAt >= since,
  )

  const hoursToMerge = mergedInPeriod
    .map(pr => (pr.mergedAt!.getTime() - pr.createdAt.getTime()) / (1000 * 60 * 60))
    .sort((a, b) => a - b)

  const total = Object.values(input.dependenciesByEcosystem).reduce((sum, count) => sum + count, 0)
  const outdated = input.updates.length

  return {
    period: input.period,
    generatedAt: input.now.toISOString(),
    health: {
      byEcosystem: { ...input.dependenciesByEcosystem },
      total,
      outdated,
      outdatedPercent: total > 0 ? Math.round((outdated / total) * 100) : 0,
      majorBehind: input.updates.filter(update => update.updateType === 'major').length,
      vulnerable: input.updates.filter(update => (update.securityAdvisories?.length ?? 0) > 0).length,
      deprecated: input.deprecated ?? 0,
      drifted: input.drifted ?? 0,
    },
    activity: {
      opened: openedInPeriod.length,
      merged: mergedInPeriod.length,
      closed: closedInPeriod.length,
      open: ours.filter(pr => pr.state === 'open').length,
      medianHoursToMerge: median(hoursToMerge),
      // Against what was opened in the same window. Not a completion rate —
      // a PR opened on the last day has had no chance to merge — which is why
      // the report labels it rather than presenting it as a score.
      mergeRate: openedInPeriod.length > 0
        ? Math.round((mergedInPeriod.length / openedInPeriod.length) * 100)
        : 0,
    },
  }
}

/** Median of a pre-sorted list, null when empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0)
    return null

  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]

  return Math.round(value * 10) / 10
}

/** A metric's movement between two snapshots. */
export interface Delta {
  current: number
  previous: number
  change: number
  /** Whether the movement is an improvement, given what the metric measures */
  improved: boolean
}

/**
 * Compare a snapshot against an earlier one.
 *
 * Direction matters per metric and cannot be inferred: more merged pull
 * requests is good, more vulnerable dependencies is not. Getting that backwards
 * would produce a report that congratulates a repository for regressing.
 *
 * @param current - The new snapshot
 * @param previous - The snapshot to compare against, absent on a first run
 * @returns Deltas keyed by metric, empty when there is nothing to compare
 */
export function computeDeltas(
  current: ReportMetrics,
  previous: ReportMetrics | null,
): Record<string, Delta> {
  if (!previous)
    return {}

  /** Metrics where a rise is an improvement. */
  const higherIsBetter = new Set(['merged', 'mergeRate'])

  const pairs: Array<[string, number, number]> = [
    ['outdated', current.health.outdated, previous.health.outdated],
    ['majorBehind', current.health.majorBehind, previous.health.majorBehind],
    ['vulnerable', current.health.vulnerable, previous.health.vulnerable],
    ['deprecated', current.health.deprecated, previous.health.deprecated],
    ['opened', current.activity.opened, previous.activity.opened],
    ['merged', current.activity.merged, previous.activity.merged],
    ['mergeRate', current.activity.mergeRate, previous.activity.mergeRate],
  ]

  const deltas: Record<string, Delta> = {}

  for (const [name, currentValue, previousValue] of pairs) {
    const change = currentValue - previousValue
    deltas[name] = {
      current: currentValue,
      previous: previousValue,
      change,
      improved: higherIsBetter.has(name) ? change >= 0 : change <= 0,
    }
  }

  return deltas
}
