/** A package mentioned in an issue, with what buddy-bot already knows. */
export interface PackageContext {
  name: string
  /** Version declared in the repository, when it is a dependency */
  declaredVersion?: string
  /** Latest published version */
  latestVersion?: string
  /** Whether an advisory affects the declared version */
  vulnerable?: boolean
  /** Whether the package is deprecated upstream */
  deprecated?: boolean
  /** Open pull request numbers that update it */
  openPRs?: number[]
}

/** Labels a repository already defines, and the ones to apply. */
export interface LabelDecision {
  /** Labels chosen from the repository's existing set */
  apply: string[]
  /** Labels the model suggested that do not exist */
  rejected: string[]
}

/**
 * Find package names an issue plausibly refers to.
 *
 * Matched against the repository's own dependencies rather than extracted
 * freely, so an issue mentioning "react hooks" does not produce context for a
 * package the project does not use.
 *
 * @param text - Issue title and body
 * @param knownPackages - Dependencies declared in the repository
 * @returns The referenced package names
 * @example
 * ```ts
 * findMentionedPackages('bump lodash please', ['lodash', 'react']) // => ['lodash']
 * ```
 */
export function findMentionedPackages(text: string, knownPackages: string[]): string[] {
  if (!text.trim())
    return []

  const haystack = text.toLowerCase()
  const found: string[] = []

  for (const name of knownPackages) {
    const needle = name.toLowerCase()
    // Word-boundary match so `vite` does not match inside `vitest`, while
    // scoped names and dotted names still match as written.
    const pattern = new RegExp(`(?:^|[^\\w@/.-])${escapeRegExp(needle)}(?![\\w/.-])`)
    if (pattern.test(haystack) && !found.includes(name))
      found.push(name)
  }

  return found
}

/**
 * Render what buddy-bot knows about the packages an issue mentions.
 *
 * This is the half of issue enrichment that needs no model: every fact here is
 * already collected by the scanner, the advisory service and the deprecation
 * checker, so a repository gets it without configuring AI.
 *
 * @param packages - Context for each mentioned package
 * @returns A comment body, or empty when there is nothing useful to say
 */
export function renderPackageContext(packages: PackageContext[]): string {
  const useful = packages.filter(entry =>
    entry.declaredVersion || entry.latestVersion || entry.vulnerable || entry.deprecated || entry.openPRs?.length,
  )

  if (useful.length === 0)
    return ''

  let body = '### 📦 Dependency context\n\n| Package | In this repo | Latest | Notes |\n|---|---|---|---|\n'

  for (const entry of useful) {
    const notes: string[] = []
    if (entry.vulnerable)
      notes.push('⚠️ known advisory')
    if (entry.deprecated)
      notes.push('🚫 deprecated')
    if (entry.openPRs?.length)
      notes.push(`open PR ${entry.openPRs.map(number => `#${number}`).join(', ')}`)

    body += `| \`${entry.name}\` | ${entry.declaredVersion ?? '—'} | ${entry.latestVersion ?? '—'} | ${
      notes.join(', ') || '—'
    } |\n`
  }

  return body
}

/**
 * Keep only labels the repository actually defines.
 *
 * A model asked to label an issue will invent plausible-sounding labels;
 * applying those creates junk labels that nobody curated. Restricting to the
 * existing set makes the feature safe to leave on.
 *
 * @param suggested - Labels the model proposed
 * @param existing - Labels the repository defines
 * @returns Which to apply and which were rejected
 */
export function constrainLabels(suggested: string[], existing: string[]): LabelDecision {
  const lookup = new Map(existing.map(label => [label.toLowerCase(), label]))
  const apply: string[] = []
  const rejected: string[] = []

  for (const label of suggested) {
    const match = lookup.get(label.trim().toLowerCase())
    if (match && !apply.includes(match))
      apply.push(match)
    else if (!match)
      rejected.push(label)
  }

  return { apply, rejected }
}

/**
 * Score how likely two issues are duplicates.
 *
 * A cheap token-overlap score rather than embeddings: it runs with no model,
 * and duplicate detection only needs to be good enough to ask a human.
 *
 * @param a - First issue's title and body
 * @param b - Second issue's title and body
 * @returns Similarity between 0 and 1
 */
export function similarity(a: string, b: string): number {
  const left = tokenize(a)
  const right = tokenize(b)

  if (left.size === 0 || right.size === 0)
    return 0

  let shared = 0
  for (const token of left) {
    if (right.has(token))
      shared++
  }

  return shared / Math.min(left.size, right.size)
}

/**
 * Find issues that look like duplicates of a new one.
 *
 * Never used to close anything automatically — a wrong auto-close costs a
 * maintainer far more than a wrong suggestion, so this only ever produces a
 * comment asking a human to confirm.
 *
 * @param issue - The new issue's text
 * @param candidates - Existing issues to compare against
 * @param threshold - Minimum similarity to report
 */
export function findDuplicates(
  issue: string,
  candidates: Array<{ number: number, text: string }>,
  threshold = 0.6,
): Array<{ number: number, score: number }> {
  return candidates
    .map(candidate => ({ number: candidate.number, score: similarity(issue, candidate.text) }))
    .filter(entry => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
}

/** Words too common to carry meaning in a similarity comparison. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'but', 'with', 'this', 'that', 'it', 'be', 'has', 'have', 'not',
  'when', 'then', 'i', 'we', 'you', 'my', 'our',
])

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\w.-]+/)
      .filter(token => token.length > 2 && !STOP_WORDS.has(token)),
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
