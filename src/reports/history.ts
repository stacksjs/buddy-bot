import type { GitProvider } from '../git/provider'
import type { Logger } from '../utils/logger'
import type { ReportMetrics } from './metrics'
import { getDefaultLogger } from '../utils/logger'

/** Where report snapshots live in the repository. */
export const HISTORY_PATH = '.buddy/reports.jsonl'

/** How many snapshots to keep. */
export const HISTORY_LIMIT = 52

/**
 * Parse a snapshot history.
 *
 * JSONL because it is append-friendly and a corrupt line loses one snapshot
 * rather than the whole history. Unparseable lines are skipped for the same
 * reason — a report should still render when one old entry is damaged.
 *
 * @param content - File content, absent when the file does not exist
 * @returns Snapshots in file order, oldest first
 */
export function parseHistory(content: string | null): ReportMetrics[] {
  if (!content?.trim())
    return []

  const snapshots: ReportMetrics[] = []

  for (const line of content.split('\n')) {
    if (!line.trim())
      continue

    try {
      const parsed = JSON.parse(line) as ReportMetrics
      // A snapshot with no period or timestamp cannot be compared against, and
      // keeping it would let a malformed entry become the "previous" report.
      if (parsed?.period && parsed.generatedAt && parsed.health && parsed.activity)
        snapshots.push(parsed)
    }
    catch {
      continue
    }
  }

  return snapshots
}

/**
 * Append a snapshot, trimming the history to its limit.
 *
 * @param existing - Snapshots already stored
 * @param snapshot - The new snapshot
 * @returns The file content to write
 */
export function appendHistory(existing: ReportMetrics[], snapshot: ReportMetrics): string {
  const kept = [...existing, snapshot].slice(-HISTORY_LIMIT)
  return `${kept.map(entry => JSON.stringify(entry)).join('\n')}\n`
}

/**
 * Find the snapshot to compare a new one against.
 *
 * Only snapshots covering the same period are comparable: a 7-day count next
 * to a 30-day one is not a delta, it is a category error that would show as a
 * dramatic improvement or regression that never happened.
 *
 * @param history - Stored snapshots
 * @param period - The period being reported
 * @returns The most recent comparable snapshot, or null
 */
export function findPrevious(history: ReportMetrics[], period: string): ReportMetrics | null {
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].period === period)
      return history[index]
  }

  return null
}

/**
 * Read the stored history from the repository.
 *
 * Read from the base branch: the history is trusted input to the deltas a
 * report publishes, and reading it from a feature branch would let that branch
 * decide what the repository's dependency trend looks like.
 *
 * @param provider - Provider to read through
 * @param baseRef - Branch to read from
 * @param logger - Where to report failures
 * @returns Stored snapshots, empty when there are none
 */
export async function loadHistory(
  provider: Pick<GitProvider, 'getFileContent'>,
  baseRef: string,
  logger: Logger = getDefaultLogger(),
): Promise<ReportMetrics[]> {
  try {
    return parseHistory(await provider.getFileContent(HISTORY_PATH, baseRef))
  }
  catch (error) {
    logger.debug(`No report history at ${HISTORY_PATH}: ${error}`)
    return []
  }
}
