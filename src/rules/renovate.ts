import type { PackageRule, RuleEcosystem } from './engine'

/** What converting a Renovate `packageRules` array produced. */
export interface RenovateConversion {
  rules: PackageRule[]
  /** Renovate features with no equivalent, named so they are not lost silently */
  incompatible: string[]
  /** Settings that converted with a caveat worth reading */
  warnings: string[]
}

/** Renovate manager names mapped onto buddy-bot ecosystems. */
const MANAGER_ECOSYSTEMS: Record<string, RuleEcosystem> = {
  'npm': 'npm',
  'bun': 'npm',
  'pnpm': 'npm',
  'yarn': 'npm',
  'composer': 'composer',
  'github-actions': 'github-actions',
  'dockerfile': 'docker',
  'docker-compose': 'docker',
  'docker': 'docker',
}

/** Update types Renovate has that buddy-bot does not model. */
const UNSUPPORTED_UPDATE_TYPES = new Set([
  'pin',
  'digest',
  'lockFileMaintenance',
  'rollback',
  'bump',
  'replacement',
  'pinDigest',
])

/**
 * Convert a Renovate regex or prefix matcher into a glob.
 *
 * Renovate's `matchPackagePatterns` are regular expressions; buddy-bot's
 * `matchPackages` are globs. The anchored-prefix form (`^@types/`) is by far
 * the most common and converts exactly. Anything using real regex features is
 * reported rather than mistranslated — a rule that silently matches the wrong
 * packages is worse than one the user has to rewrite.
 */
function patternToGlob(pattern: string): { glob: string, exact: boolean } {
  const trimmed = pattern.trim()

  // `^foo` — anchored prefix, the overwhelmingly common shape.
  if (/^\^[\w@\-./]+$/.test(trimmed))
    return { glob: `${trimmed.slice(1)}*`, exact: true }

  // `^foo$` — an anchored literal is just the name.
  if (/^\^[\w@\-./]+\$$/.test(trimmed))
    return { glob: trimmed.slice(1, -1), exact: true }

  // `foo$` — anchored suffix.
  if (/^[\w@\-./]+\$$/.test(trimmed))
    return { glob: `*${trimmed.slice(0, -1)}`, exact: true }

  // A bare literal with no regex metacharacters is a substring match.
  if (/^[\w@\-./]+$/.test(trimmed))
    return { glob: `*${trimmed}*`, exact: true }

  return { glob: trimmed, exact: false }
}

/**
 * Parse a Renovate duration into minutes.
 *
 * Renovate writes `minimumReleaseAge` as prose (`"3 days"`); buddy-bot counts
 * minutes.
 */
function durationToMinutes(value: unknown): number | null {
  if (typeof value === 'number')
    return value
  if (typeof value !== 'string')
    return null

  const match = /^(\d+)\s*(minute|hour|day|week)s?$/i.exec(value.trim())
  if (!match)
    return null

  const amount = Number(match[1])
  switch (match[2].toLowerCase()) {
    case 'minute': return amount
    case 'hour': return amount * 60
    case 'day': return amount * 60 * 24
    case 'week': return amount * 60 * 24 * 7
    default: return null
  }
}

/**
 * Convert Renovate `packageRules` into buddy-bot `packages.rules`.
 *
 * The mapping is deliberately conservative: a Renovate feature with no
 * equivalent is listed in `incompatible` rather than approximated, and a
 * matcher that converts only loosely produces a warning. A migration that
 * quietly changes which packages a rule governs is worse than one that says
 * what it could not carry over.
 *
 * @param packageRules - The `packageRules` array from a Renovate config
 * @returns Converted rules alongside what did not survive the conversion
 * @example
 * ```ts
 * const { rules, incompatible } = convertRenovateRules(renovate.packageRules)
 * config.packages.rules = rules
 * ```
 */
export function convertRenovateRules(packageRules: unknown): RenovateConversion {
  const rules: PackageRule[] = []
  const incompatible: string[] = []
  const warnings: string[] = []

  if (!Array.isArray(packageRules))
    return { rules, incompatible, warnings }

  packageRules.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null)
      return

    const source = raw as Record<string, unknown>
    const rule: PackageRule = {}
    const label = `packageRules[${index}]`

    // -- Matchers ----------------------------------------------------------

    const packages = new Set<string>()

    for (const name of asStringArray(source.matchPackageNames))
      packages.add(name)

    for (const prefix of asStringArray(source.matchPackagePrefixes))
      packages.add(`${prefix}*`)

    for (const pattern of asStringArray(source.matchPackagePatterns)) {
      const { glob, exact } = patternToGlob(pattern)
      packages.add(glob)
      if (!exact)
        warnings.push(`${label}: pattern ${JSON.stringify(pattern)} is a regular expression and was copied verbatim as a glob — check it matches what you expect`)
    }

    if (packages.size > 0)
      rule.matchPackages = [...packages]

    const depTypes = asStringArray(source.matchDepTypes)
    if (depTypes.length > 0)
      rule.matchDepTypes = depTypes

    const files = [...asStringArray(source.matchFileNames), ...asStringArray(source.matchPaths)]
    if (files.length > 0)
      rule.matchFiles = files

    const updateTypes = asStringArray(source.matchUpdateTypes ?? source.updateTypes)
    const supported = updateTypes.filter(type => type === 'major' || type === 'minor' || type === 'patch')
    const dropped = updateTypes.filter(type => UNSUPPORTED_UPDATE_TYPES.has(type))
    if (supported.length > 0)
      rule.matchUpdateTypes = supported as Array<'major' | 'minor' | 'patch'>
    if (dropped.length > 0)
      incompatible.push(`${label}: update types ${dropped.join(', ')} have no equivalent`)

    const ecosystems = asStringArray(source.matchManagers)
      .map(manager => MANAGER_ECOSYSTEMS[manager])
      .filter((ecosystem): ecosystem is RuleEcosystem => Boolean(ecosystem))
    if (ecosystems.length > 0)
      rule.matchEcosystems = [...new Set(ecosystems)]

    const unmappedManagers = asStringArray(source.matchManagers).filter(manager => !MANAGER_ECOSYSTEMS[manager])
    if (unmappedManagers.length > 0)
      incompatible.push(`${label}: managers ${unmappedManagers.join(', ')} are not supported`)

    if (typeof source.matchCurrentVersion === 'string')
      rule.matchCurrentVersion = source.matchCurrentVersion

    // -- Effects -----------------------------------------------------------

    if (typeof source.enabled === 'boolean')
      rule.enabled = source.enabled

    if (typeof source.groupName === 'string')
      rule.groupName = source.groupName

    if (typeof source.automerge === 'boolean')
      rule.autoMerge = source.automerge

    if (typeof source.prPriority === 'number')
      rule.prPriority = source.prPriority

    const labels = [...asStringArray(source.labels), ...asStringArray(source.addLabels)]
    if (labels.length > 0)
      rule.labels = [...new Set(labels)]

    const reviewers = asStringArray(source.reviewers)
    if (reviewers.length > 0)
      rule.reviewers = reviewers

    const assignees = asStringArray(source.assignees)
    if (assignees.length > 0)
      rule.assignees = assignees

    const age = durationToMinutes(source.minimumReleaseAge)
    if (age !== null)
      rule.minimumReleaseAge = age
    else if (source.minimumReleaseAge !== undefined)
      warnings.push(`${label}: could not parse minimumReleaseAge ${JSON.stringify(source.minimumReleaseAge)}`)

    // Renovate schedules are natural language ("after 10pm every weekday");
    // buddy-bot rules take cron. Translating prose would be guessing.
    if (source.schedule !== undefined)
      incompatible.push(`${label}: schedule ${JSON.stringify(source.schedule)} must be rewritten as a cron expression`)

    // A rule with no matchers applies to everything, which is almost never
    // what a Renovate rule meant — it usually used a matcher we could not map.
    const hasMatcher = Boolean(
      rule.matchPackages || rule.matchDepTypes || rule.matchFiles
      || rule.matchUpdateTypes || rule.matchEcosystems || rule.matchCurrentVersion,
    )

    if (!hasMatcher) {
      if (Object.keys(rule).length > 0)
        incompatible.push(`${label}: no matcher could be converted, so the rule was dropped rather than applied to every package`)
      return
    }

    rules.push(rule)
  })

  return { rules, incompatible, warnings }
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string')
    return [value]
  if (!Array.isArray(value))
    return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}
