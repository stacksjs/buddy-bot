import type { BuddyBotConfig, PackageUpdate, PRManifest } from '../types'
import { parseManifest } from './pr-manifest'

/** Branch prefix every buddy-bot pull request is opened from. */
const BUDDY_BRANCH_PREFIX = 'buddy-bot/'

/** Label that suppresses auto-merge on an individual PR. */
export const DEFAULT_OPT_OUT_LABEL = 'no-auto-merge'

/**
 * Conditions that restrict which updates may merge without review.
 *
 * `all` is deliberately explicit: an empty condition list is treated as
 * "nothing qualifies" rather than "everything qualifies", so a half-written
 * config cannot start merging major upgrades.
 */
export type AutoMergeCondition = 'patch-only' | 'minor-only' | 'security-only' | 'all'

/** Why a pull request was or was not eligible for auto-merge. */
export interface AutoMergeDecision {
  /** Whether the PR qualifies */
  eligible: boolean
  /** Human-readable explanation, always populated */
  reason: string
}

/** The subset of a pull request auto-merge needs to make a decision. */
export interface AutoMergeCandidate {
  number: number
  title: string
  body: string
  head: string
  author?: string
  labels?: string[]
  draft?: boolean
}

/**
 * Resolved auto-merge settings, with defaults applied.
 *
 * @param config - Full buddy-bot configuration
 */
export function resolveAutoMergeConfig(config: BuddyBotConfig): {
  enabled: boolean
  strategy: 'merge' | 'squash' | 'rebase'
  conditions: AutoMergeCondition[]
  requireGreenCI: boolean
  optOutLabel: string
  securityLabel: string
} {
  const autoMerge = config.pullRequest?.autoMerge
  return {
    enabled: autoMerge?.enabled ?? false,
    strategy: autoMerge?.strategy ?? 'squash',
    conditions: (autoMerge?.conditions ?? []) as AutoMergeCondition[],
    requireGreenCI: autoMerge?.requireGreenCI ?? true,
    optOutLabel: autoMerge?.optOutLabel ?? DEFAULT_OPT_OUT_LABEL,
    securityLabel: config.security?.label ?? 'security',
  }
}

/**
 * Decides whether a pull request may be auto-merged.
 *
 * Reads the update types from the embedded metadata manifest rather than the
 * PR title, so a retitled or reworded PR cannot be talked into a merge it does
 * not qualify for. A PR whose manifest is missing or truncated is never
 * eligible: without the complete update list there is no way to prove every
 * update satisfies the configured conditions.
 *
 * CI state is checked separately by the caller and passed in, because the two
 * entry points differ — PR creation has no checks yet, while `update-check`
 * polls a PR whose checks have had time to run.
 *
 * @param pr - The pull request under consideration
 * @param config - Full buddy-bot configuration
 * @param ciGreen - Whether required checks have passed, or `undefined` when not yet known
 * @returns The decision and the reason behind it
 * @example
 * ```ts
 * const decision = evaluateAutoMerge(pr, config, true)
 * if (decision.eligible)
 *   await provider.mergePullRequest(pr.number, strategy)
 * ```
 */
export function evaluateAutoMerge(
  pr: AutoMergeCandidate,
  config: BuddyBotConfig,
  ciGreen?: boolean,
): AutoMergeDecision {
  const settings = resolveAutoMergeConfig(config)

  if (!settings.enabled)
    return { eligible: false, reason: 'auto-merge is disabled by config' }

  if (settings.conditions.length === 0)
    return { eligible: false, reason: 'no auto-merge conditions configured (set conditions to at least one of patch-only, minor-only, security-only, all)' }

  if (!pr.head.startsWith(BUDDY_BRANCH_PREFIX))
    return { eligible: false, reason: `PR #${pr.number} is not a buddy-bot PR (branch: ${pr.head})` }

  if (pr.draft)
    return { eligible: false, reason: `PR #${pr.number} is a draft` }

  const labels = pr.labels ?? []
  if (labels.includes(settings.optOutLabel))
    return { eligible: false, reason: `PR #${pr.number} carries the ${settings.optOutLabel} label` }

  if (settings.requireGreenCI && ciGreen === false)
    return { eligible: false, reason: `PR #${pr.number} has failing or pending checks` }

  const manifest = parseManifest(pr.body)
  if (!manifest)
    return { eligible: false, reason: `PR #${pr.number} has no metadata manifest to verify update types against` }

  if (manifest.truncated)
    return { eligible: false, reason: `PR #${pr.number} has a truncated manifest, so its full update set cannot be verified` }

  return evaluateConditions(manifest, labels, settings)
}

function evaluateConditions(
  manifest: PRManifest,
  labels: string[],
  settings: { conditions: AutoMergeCondition[], securityLabel: string },
): AutoMergeDecision {
  // A PR qualifies when any configured condition accepts it.
  for (const condition of settings.conditions) {
    switch (condition) {
      case 'all':
        return { eligible: true, reason: 'all updates qualify (condition: all)' }

      case 'patch-only':
        if (manifest.updates.length > 0 && manifest.updates.every(update => updateTypeOf(update) === 'patch'))
          return { eligible: true, reason: 'every update is a patch' }
        break

      case 'minor-only':
        if (manifest.updates.length > 0 && manifest.updates.every(update => updateTypeOf(update) !== 'major'))
          return { eligible: true, reason: 'every update is minor or patch' }
        break

      case 'security-only':
        if (labels.includes(settings.securityLabel))
          return { eligible: true, reason: 'PR resolves a security advisory' }
        break
    }
  }

  const types = [...new Set(manifest.updates.map(updateTypeOf))].join(', ') || 'none'
  return {
    eligible: false,
    reason: `update types (${types}) do not satisfy conditions (${settings.conditions.join(', ')})`,
  }
}

/**
 * Semver bucket for a manifest entry.
 *
 * Size-reduced manifests omit `type`, so it is recomputed from the version
 * pair when absent. An unparseable pair is treated as `major` — the
 * conservative reading, since an unknown change must never auto-merge under a
 * patch-only policy.
 */
function updateTypeOf(update: { type?: string, current: string, target: string }): 'major' | 'minor' | 'patch' {
  if (update.type === 'major' || update.type === 'minor' || update.type === 'patch')
    return update.type

  const current = parseVersion(update.current)
  const target = parseVersion(update.target)
  if (!current || !target)
    return 'major'

  if (current[0] !== target[0])
    return 'major'
  if (current[1] !== target[1])
    return 'minor'
  return 'patch'
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match)
    return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Decides auto-merge eligibility for a set of updates before a PR exists.
 *
 * Used at creation time, where the manifest has not been written yet but the
 * updates are already known.
 *
 * @param updates - Updates the PR will contain
 * @param labels - Labels the PR will be created with
 * @param config - Full buddy-bot configuration
 */
export function evaluateAutoMergeForUpdates(
  updates: PackageUpdate[],
  labels: string[],
  config: BuddyBotConfig,
): AutoMergeDecision {
  const settings = resolveAutoMergeConfig(config)

  if (!settings.enabled)
    return { eligible: false, reason: 'auto-merge is disabled by config' }

  if (settings.conditions.length === 0)
    return { eligible: false, reason: 'no auto-merge conditions configured' }

  if (labels.includes(settings.optOutLabel))
    return { eligible: false, reason: `PR carries the ${settings.optOutLabel} label` }

  const manifest: PRManifest = {
    schemaVersion: 1,
    updates: updates.map(update => ({
      name: update.name,
      current: update.currentVersion,
      target: update.newVersion,
      type: update.updateType,
      file: update.file,
    })),
  }

  return evaluateConditions(manifest, labels, settings)
}
