import type { PackageUpdate } from '../types'
import { createPathMatcher } from '../utils/globs'
import { satisfiesRange } from '../utils/helpers'
import { matchesSchedule } from './schedule'

/** Ecosystems a rule can match on. */
export type RuleEcosystem = 'npm' | 'composer' | 'github-actions' | 'docker' | 'pkgx' | 'zig'

/** A conditional override applied to matching updates. */
export interface PackageRule {
  // Matchers — all present matchers must match (AND within a rule)
  /** Package names or globs */
  matchPackages?: string[]
  matchEcosystems?: RuleEcosystem[]
  matchDepTypes?: string[]
  matchUpdateTypes?: Array<'major' | 'minor' | 'patch'>
  /** Globs on the manifest path, for monorepo directories */
  matchFiles?: string[]
  /**
   * Semver range the *currently installed* version must satisfy.
   *
   * Lets a rule target a version series rather than a package — holding back
   * everything still on `<2.0.0` while letting the rest through.
   */
  matchCurrentVersion?: string

  // Effects
  /** `false` drops matching updates entirely */
  enabled?: boolean
  strategy?: 'major' | 'minor' | 'patch' | 'all'
  groupName?: string
  labels?: string[]
  reviewers?: string[]
  assignees?: string[]
  autoMerge?: boolean
  /** Minutes a version must have been published, overriding the global */
  minimumReleaseAge?: number
  /** Ordering within the per-run PR cap; higher goes first */
  prPriority?: number
  /** Attempt the migration for matching majors, overriding the global */
  autoMigrate?: boolean
  /**
   * Cron expression describing when these updates may be proposed.
   *
   * The window, not the firing minute: `0 0 * * 6,0` holds updates back on a
   * weekday run and releases them on a weekend one.
   */
  schedule?: string
  /** IANA time zone `schedule` is written in (default: the runner's) */
  scheduleTimezone?: string
}

/** The effects that survived rule evaluation for one update. */
export interface ResolvedEffects {
  enabled: boolean
  strategy?: PackageRule['strategy']
  groupName?: string
  labels: string[]
  reviewers: string[]
  assignees: string[]
  autoMerge?: boolean
  minimumReleaseAge?: number
  prPriority: number
  autoMigrate?: boolean
}

/** Which ecosystem an update belongs to, inferred from its file and type. */
export function ecosystemOf(update: PackageUpdate): RuleEcosystem {
  if (update.dependencyType === 'github-actions')
    return 'github-actions'
  if (update.dependencyType === 'docker-image')
    return 'docker'
  if (update.dependencyType === 'zig-dependencies')
    return 'zig'
  if (update.file.endsWith('composer.json') || update.file.endsWith('composer.lock'))
    return 'composer'
  if (update.file.endsWith('package.json'))
    return 'npm'

  return 'pkgx'
}

/**
 * Whether a rule matches an update.
 *
 * Matchers combine with AND, so a rule with several matchers is a
 * conjunction. An absent matcher is not a wildcard match on its own — a rule
 * with no matchers at all matches everything, which is why config validation
 * asks for an explicit `matchPackages: ['*']` rather than accepting silence.
 *
 * @param rule - Rule to test
 * @param update - Update to test against
 * @param now - Instant to evaluate `schedule` against (default: now)
 */
export function ruleMatches(rule: PackageRule, update: PackageUpdate, now: Date = new Date()): boolean {
  if (rule.matchPackages?.length) {
    const matcher = createPathMatcher(rule.matchPackages)
    if (!matcher.matches(update.name))
      return false
  }

  if (rule.matchEcosystems?.length && !rule.matchEcosystems.includes(ecosystemOf(update)))
    return false

  if (rule.matchDepTypes?.length && !rule.matchDepTypes.includes(update.dependencyType))
    return false

  if (rule.matchUpdateTypes?.length && !rule.matchUpdateTypes.includes(update.updateType))
    return false

  if (rule.matchFiles?.length) {
    const matcher = createPathMatcher(rule.matchFiles)
    if (!matcher.matches(update.file))
      return false
  }

  if (rule.matchCurrentVersion && !currentVersionMatches(update.currentVersion, rule.matchCurrentVersion))
    return false

  // Evaluated last: it is the only matcher that depends on when the run
  // happened rather than on what is being updated.
  if (rule.schedule && !matchesSchedule(rule.schedule, now, rule.scheduleTimezone))
    return false

  return true
}

/**
 * Whether an installed version satisfies a rule's range.
 *
 * Declared versions carry range operators (`^1.2.3`, `~2.0`), which are not
 * versions and cannot be tested against a range. Stripping to the concrete
 * floor is what the user means by "packages still on 1.x".
 */
function currentVersionMatches(currentVersion: string, range: string): boolean {
  const concrete = currentVersion.replace(/^[\^~>=<\s]+/, '').trim()
  return concrete ? satisfiesRange(concrete, range) : false
}

/**
 * Resolve the effects that apply to an update.
 *
 * Rules are evaluated in order and later matches override earlier ones on a
 * per-field basis, which is what lets a broad rule set a default and a narrow
 * one refine it. List effects accumulate rather than replace, because a
 * package matching both a "security" and a "frontend" rule should carry both
 * labels rather than whichever happened to be last.
 *
 * @param update - Update to resolve
 * @param rules - Rules in configuration order
 * @returns The merged effects
 * @example
 * ```ts
 * const effects = resolveRuleEffects(update, config.packages.rules)
 * if (!effects.enabled)
 *   return // rule disabled this update
 * ```
 */
export function resolveRuleEffects(
  update: PackageUpdate,
  rules: PackageRule[] = [],
  now: Date = new Date(),
): ResolvedEffects {
  const effects: ResolvedEffects = {
    enabled: true,
    labels: [],
    reviewers: [],
    assignees: [],
    prPriority: 0,
  }

  for (const rule of rules) {
    if (!ruleMatches(rule, update, now))
      continue

    if (rule.enabled !== undefined)
      effects.enabled = rule.enabled
    if (rule.strategy !== undefined)
      effects.strategy = rule.strategy
    if (rule.groupName !== undefined)
      effects.groupName = rule.groupName
    if (rule.autoMerge !== undefined)
      effects.autoMerge = rule.autoMerge
    if (rule.minimumReleaseAge !== undefined)
      effects.minimumReleaseAge = rule.minimumReleaseAge
    if (rule.prPriority !== undefined)
      effects.prPriority = rule.prPriority
    if (rule.autoMigrate !== undefined)
      effects.autoMigrate = rule.autoMigrate

    // Accumulated, not replaced: matching two rules should mean both sets of
    // labels and reviewers, not the later one silently winning.
    for (const label of rule.labels ?? []) {
      if (!effects.labels.includes(label))
        effects.labels.push(label)
    }
    for (const reviewer of rule.reviewers ?? []) {
      if (!effects.reviewers.includes(reviewer))
        effects.reviewers.push(reviewer)
    }
    for (const assignee of rule.assignees ?? []) {
      if (!effects.assignees.includes(assignee))
        effects.assignees.push(assignee)
    }
  }

  return effects
}

/**
 * Drop updates a rule disabled, and retarget those a rule constrains.
 *
 * @param updates - Candidate updates
 * @param rules - Rules in configuration order
 * @returns Updates that survived, each paired with its effects
 */
export function applyRules(
  updates: PackageUpdate[],
  rules: PackageRule[] = [],
  now: Date = new Date(),
): Array<{ update: PackageUpdate, effects: ResolvedEffects }> {
  const result: Array<{ update: PackageUpdate, effects: ResolvedEffects }> = []

  for (const update of updates) {
    const effects = resolveRuleEffects(update, rules, now)
    if (!effects.enabled)
      continue

    // A per-rule strategy narrows what may be proposed for this package,
    // independently of the global strategy.
    if (effects.strategy && !strategyAllows(effects.strategy, update.updateType))
      continue

    result.push({ update, effects })
  }

  return result
}

/**
 * Merge the effects of every update in a group into the group's PR metadata.
 *
 * Conflicting effects resolve conservatively: labels and reviewers union, and
 * auto-merge requires every update in the group to allow it. One package that
 * must not merge unattended has to be able to hold back the whole PR that
 * contains it.
 *
 * @param effects - Effects of each update in the group
 */
export function mergeGroupEffects(effects: ResolvedEffects[]): {
  labels: string[]
  reviewers: string[]
  assignees: string[]
  autoMerge: boolean
  prPriority: number
  autoMigrate: boolean
} {
  const labels = new Set<string>()
  const reviewers = new Set<string>()
  const assignees = new Set<string>()
  let prPriority = 0

  for (const entry of effects) {
    entry.labels.forEach(label => labels.add(label))
    entry.reviewers.forEach(reviewer => reviewers.add(reviewer))
    entry.assignees.forEach(assignee => assignees.add(assignee))
    prPriority = Math.max(prPriority, entry.prPriority)
  }

  return {
    labels: [...labels],
    reviewers: [...reviewers],
    assignees: [...assignees],
    autoMerge: effects.length > 0 && effects.every(entry => entry.autoMerge === true),
    prPriority,
    // Unlike auto-merge, one package opting in is enough: migrating what can
    // be migrated leaves the rest exactly as it would have been.
    autoMigrate: effects.some(entry => entry.autoMigrate === true),
  }
}

/** Whether a strategy permits an update of this type. */
function strategyAllows(strategy: NonNullable<PackageRule['strategy']>, updateType: 'major' | 'minor' | 'patch'): boolean {
  switch (strategy) {
    case 'all':
      return true
    case 'major':
      return updateType === 'major'
    case 'minor':
      return updateType === 'minor' || updateType === 'patch'
    case 'patch':
      return updateType === 'patch'
  }
}

/**
 * Compile legacy `packages.groups` into equivalent rules.
 *
 * Keeps existing configurations working unchanged while giving the engine one
 * code path to reason about, rather than two grouping mechanisms that can
 * disagree.
 *
 * @param groups - Legacy group definitions
 */
export function groupsToRules(
  groups: Array<{ name: string, patterns: string[], strategy?: PackageRule['strategy'] }> = [],
): PackageRule[] {
  return groups.map(group => ({
    matchPackages: group.patterns,
    groupName: group.name,
    ...(group.strategy ? { strategy: group.strategy } : {}),
  }))
}
