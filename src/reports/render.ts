import type { AiClient } from '../ai/types'
import type { Logger } from '../utils/logger'
import type { Delta, ReportMetrics } from './metrics'
import { getDefaultLogger } from '../utils/logger'
import { PERIOD_DAYS } from './metrics'

/** Marker identifying the report issue, so it is updated rather than duplicated. */
export const REPORT_MARKER = '<!-- buddy-bot:report -->'

/** Render a delta as an arrow and a signed number. */
function renderDelta(delta: Delta | undefined): string {
  if (!delta || delta.change === 0)
    return '—'

  const arrow = delta.change > 0 ? '▲' : '▼'
  const sign = delta.change > 0 ? '+' : ''

  return `${arrow} ${sign}${delta.change}${delta.improved ? '' : ' ⚠️'}`
}

/**
 * Render a report from metrics alone.
 *
 * The deterministic baseline: no AI, no network, just the numbers and how they
 * moved. This is the report — the narrative mode adds prose around it and never
 * replaces it, because figures produced by a language model are not metrics.
 *
 * @param metrics - The current snapshot
 * @param deltas - Movement since the previous snapshot
 * @returns Markdown
 */
export function renderReport(metrics: ReportMetrics, deltas: Record<string, Delta> = {}): string {
  const days = PERIOD_DAYS[metrics.period]
  const lines: string[] = [
    REPORT_MARKER,
    '',
    `## Dependency report — last ${days} days`,
    '',
    `Generated ${metrics.generatedAt.slice(0, 10)}.`,
    '',
    '### Dependency health',
    '',
    '| Metric | Value | Change |',
    '| --- | --- | --- |',
    `| Total dependencies | ${metrics.health.total} | |`,
    `| Outdated | ${metrics.health.outdated} (${metrics.health.outdatedPercent}%) | ${renderDelta(deltas.outdated)} |`,
    `| A major behind | ${metrics.health.majorBehind} | ${renderDelta(deltas.majorBehind)} |`,
    `| With known advisories | ${metrics.health.vulnerable} | ${renderDelta(deltas.vulnerable)} |`,
    `| Deprecated | ${metrics.health.deprecated} | ${renderDelta(deltas.deprecated)} |`,
  ]

  if (metrics.health.drifted > 0) {
    lines.push(
      `| Held back by a dependant | ${metrics.health.drifted} | |`,
    )
  }

  lines.push('', '### By ecosystem', '')

  const ecosystems = Object.entries(metrics.health.byEcosystem)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)

  if (ecosystems.length === 0) {
    lines.push('No dependencies detected.')
  }
  else {
    lines.push('| Ecosystem | Dependencies |', '| --- | --- |')
    for (const [ecosystem, count] of ecosystems)
      lines.push(`| ${ecosystem} | ${count} |`)
  }

  lines.push(
    '',
    '### Bot activity',
    '',
    '| Metric | Value | Change |',
    '| --- | --- | --- |',
    `| Pull requests opened | ${metrics.activity.opened} | ${renderDelta(deltas.opened)} |`,
    `| Merged | ${metrics.activity.merged} | ${renderDelta(deltas.merged)} |`,
    `| Closed without merging | ${metrics.activity.closed} | |`,
    `| Currently open | ${metrics.activity.open} | |`,
  )

  if (metrics.activity.medianHoursToMerge !== null)
    lines.push(`| Median time to merge | ${formatHours(metrics.activity.medianHoursToMerge)} | |`)

  lines.push(`| Merged vs opened | ${metrics.activity.mergeRate}% | ${renderDelta(deltas.mergeRate)} |`)

  lines.push(
    '',
    // Said plainly, because the number invites being read as a completion
    // rate: a pull request opened on the last day of the window has had no
    // chance to merge inside it.
    `_"Merged vs opened" compares both counts within the same ${days}-day window, so`,
    'recently opened pull requests depress it by definition._',
  )

  if (Object.keys(deltas).length === 0)
    lines.push('', '_No previous report to compare against; this is the baseline._')

  return lines.join('\n')
}

/**
 * Add a narrative to a rendered report.
 *
 * The metrics are inlined into the prompt as trusted data — they are numbers
 * this process computed, not content from a pull request — and the model is
 * asked to interpret them, never to restate or recompute them. The tables stay
 * exactly as rendered underneath.
 *
 * @param report - The deterministic report
 * @param metrics - The snapshot behind it
 * @param ai - Client, absent to leave the report as-is
 * @param focus - What the narrative should emphasise
 * @param logger - Where to report failures
 * @returns The report, with a narrative prepended when one could be written
 */
export async function withNarrative(
  report: string,
  metrics: ReportMetrics,
  ai: AiClient | null,
  focus?: string,
  logger: Logger = getDefaultLogger(),
): Promise<string> {
  if (!ai)
    return report

  try {
    const response = await ai.complete({
      system: 'You write short factual summaries of dependency-health metrics. '
        + 'Interpret the numbers you are given; never invent figures, and never '
        + 'restate a table that already appears in the report. Three sentences at most.',
      messages: [{
        role: 'user',
        content: [
          focus ? `Focus: ${focus}` : 'Focus: what changed and what needs attention.',
          '',
          'Metrics:',
          JSON.stringify(metrics, null, 2),
        ].join('\n'),
      }],
    })

    const narrative = response.text.trim()
    if (!narrative)
      return report

    return report.replace(
      '### Dependency health',
      `${narrative}\n\n### Dependency health`,
    )
  }
  catch (error) {
    // A missing narrative is cosmetic; the report's value is the numbers.
    logger.warn(`⚠️ Could not write the report narrative: ${error}`)
    return report
  }
}

function formatHours(hours: number): string {
  if (hours < 24)
    return `${hours}h`

  const days = Math.round((hours / 24) * 10) / 10
  return `${days}d`
}
