import type { AiClient } from '../ai/types'
import type { BuddyBotConfig, PackageUpdate } from '../types'
import type { Logger } from '../utils/logger'
import type { UpgradeResult } from './migrate'
import { stripManifest } from '../pr/pr-manifest'
import { getDefaultLogger } from '../utils/logger'
import { attemptMajorUpgrade } from './migrate'
import { collectSpanNotes, describeSpanGaps } from './span'

/** What analysing a group's majors produced. */
export interface GroupUpgradeOutcome {
  /** Report to splice into the pull request body */
  report: string
  /** Whether the pull request should open as a draft */
  draft: boolean
  /** Per-package results, for callers that need the detail */
  results: Array<{ update: PackageUpdate, result: UpgradeResult }>
  /** Majors skipped, and why — reported rather than silently passed over */
  skipped: Array<{ name: string, reason: string }>
}

/** Everything the wiring needs to analyse a group. */
export interface GroupUpgradeOptions {
  updates: PackageUpdate[]
  config: BuddyBotConfig
  workspace: string
  baseBranch: string
  /** Repository-relative paths to search for usage */
  files: string[]
  ai: AiClient | null
  /** Fetches releases spanning a version range; injected for testing */
  fetchReleases: (name: string, from: string, to: string) => Promise<Array<{
    version: string
    body: string
    htmlUrl?: string
    isPrerelease?: boolean
  }>>
  logger?: Logger
}

/**
 * Whether a package name matches one of a set of globs.
 *
 * Only `*` is supported, matching any run of characters, which covers the
 * `@scope/*` and `eslint*` shapes configuration actually uses. Anchored at
 * both ends so `react` does not match `react-dom`.
 */
export function matchesGlobs(name: string, globs: string[] | undefined): boolean {
  // No globs configured means every major qualifies.
  if (!globs?.length)
    return true

  return globs.some((glob) => {
    const pattern = glob
      .split('*')
      .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp(`^${pattern}$`).test(name)
  })
}

/**
 * Analyse the major updates in a group and produce a body section.
 *
 * The ladder is deliberate: with no AI configured this returns nothing and the
 * caller opens exactly the pull request it always did. With AI it adds a
 * per-package migration report and may ask for the PR to open as a draft. It
 * never fails the pull request — an analysis that errored is reported as
 * skipped, because a missing report is a much smaller problem than a blocked
 * dependency update.
 *
 * @param options - Group updates, config, repository context and clients
 * @returns The report, draft decision, and what was skipped
 * @example
 * ```ts
 * const outcome = await analyzeGroupMajors({ updates: group.updates, config, ... })
 * const body = appendUpgradeReport(prBody, outcome.report)
 * ```
 */
export async function analyzeGroupMajors(options: GroupUpgradeOptions): Promise<GroupUpgradeOutcome> {
  const logger = options.logger ?? getDefaultLogger()
  const settings = options.config.ai?.majorUpgrades
  const empty: GroupUpgradeOutcome = { report: '', draft: false, results: [], skipped: [] }

  if (!settings?.enabled || !options.ai)
    return empty

  const majors = options.updates.filter(update => update.updateType === 'major')
  if (majors.length === 0)
    return empty

  const results: GroupUpgradeOutcome['results'] = []
  const skipped: GroupUpgradeOutcome['skipped'] = []

  for (const update of majors) {
    if (!matchesGlobs(update.name, settings.packages)) {
      skipped.push({ name: update.name, reason: 'not matched by ai.majorUpgrades.packages' })
      continue
    }

    try {
      const releases = await options.fetchReleases(update.name, update.currentVersion, update.newVersion)
      const span = collectSpanNotes(releases, update.currentVersion, update.newVersion)
      const gaps = describeSpanGaps(span)

      const result = await attemptMajorUpgrade({
        update,
        releaseNotes: span.notes,
        files: options.files,
        workspace: options.workspace,
        baseBranch: options.baseBranch,
        ai: options.ai,
        ...(settings.autoMigrate !== undefined ? { autoMigrate: settings.autoMigrate } : {}),
        ...(settings.draftBelowConfidence ? { draftBelowConfidence: settings.draftBelowConfidence } : {}),
        logger,
      })

      results.push({
        update,
        // The gap note rides with the report so a partial analysis never reads
        // as a complete one.
        result: gaps ? { ...result, report: `${gaps}\n\n${result.report}` } : result,
      })
    }
    catch (error) {
      // An analysis failure must never block the dependency update itself.
      logger.warn(`⚠️ Could not analyse the ${update.name} major upgrade: ${error}`)
      skipped.push({ name: update.name, reason: 'analysis failed' })
    }
  }

  return {
    report: renderGroupReport(results, skipped),
    draft: results.some(entry => entry.result.draft),
    results,
    skipped,
  }
}

/** Render every package's report into one body section. */
function renderGroupReport(
  results: GroupUpgradeOutcome['results'],
  skipped: GroupUpgradeOutcome['skipped'],
): string {
  const sections = results
    .filter(entry => entry.result.report)
    .map(entry => `### ${entry.update.name} ${entry.update.currentVersion} → ${entry.update.newVersion}\n\n${entry.result.report}`)

  if (sections.length === 0 && skipped.length === 0)
    return ''

  const parts = ['## Major upgrade analysis', '', ...sections]

  if (skipped.length > 0) {
    // Saying which packages were not analysed keeps the section from reading
    // as complete coverage of the group's majors.
    parts.push(
      '',
      `Not analysed: ${skipped.map(entry => `\`${entry.name}\` (${entry.reason})`).join(', ')}.`,
    )
  }

  return parts.join('\n')
}

/**
 * Splice an upgrade report into a pull request body.
 *
 * The report goes after the rendered tables and before the manifest, so the
 * manifest stays the last thing in the body where the parser expects it.
 *
 * @param body - Generated pull request body, manifest included
 * @param report - Report section, empty to leave the body untouched
 * @returns The body with the report inserted
 */
export function appendUpgradeReport(body: string, report: string): string {
  if (!report.trim())
    return body

  const withoutManifest = stripManifest(body)
  const manifest = body.slice(withoutManifest.length)

  return `${withoutManifest}\n\n---\n\n${report}${manifest}`
}
