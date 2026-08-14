/** One release as the span walker needs it. */
export interface SpanRelease {
  /** Tag name, with or without a leading `v` */
  version: string
  body: string
  htmlUrl?: string
  isPrerelease?: boolean
}

/** Release notes spanning an upgrade, with what was left out. */
export interface ReleaseSpan {
  /** Rendered notes, newest boundary first */
  notes: string
  /** Versions actually included */
  included: string[]
  /**
   * Versions inside the span that were dropped, and why.
   *
   * Reported rather than silently discarded: an analysis based on partial
   * notes is worth flagging, since the breaking change it missed may be in
   * exactly the release nobody read.
   */
  omitted: Array<{ version: string, reason: 'patch-release' | 'budget' }>
  /** Whether the walk stopped before reaching the current version */
  truncated: boolean
}

/** How much of a release span to spend on prose. */
export const DEFAULT_SPAN_BUDGET = 24_000

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)/

/** Parse a tag into a comparable triple, or null when it is not semver. */
function parse(version: string): [number, number, number] | null {
  const match = SEMVER.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Whether a version is inside `(from, to]`.
 *
 * Half-open at the bottom: the version already installed has nothing to say
 * about what changed, and closed at the top because the target release is the
 * one being adopted.
 */
function isInSpan(version: string, from: string, to: string): boolean {
  const [v, f, t] = [parse(version), parse(from), parse(to)]
  if (!v || !f || !t)
    return false
  return compare(v, f) > 0 && compare(v, t) <= 0
}

/** Whether a version is a major or minor boundary (`x.y.0`). */
function isBoundary(version: string): boolean {
  return parse(version)?.[2] === 0
}

/**
 * Collect the release notes that describe a version span.
 *
 * A 5.x → 7.x upgrade is not described by the newest release: the breaking
 * changes live in the 6.0.0 and 7.0.0 notes, which a "latest releases" fetch
 * scrolls straight past. This walks the whole span and keeps the boundaries,
 * because `x.y.0` is where a project documents what it broke and patch
 * releases almost never are.
 *
 * The target release is always kept even if it is a patch, since it is the
 * version actually being adopted.
 *
 * @param releases - Releases newest-first, as the provider returned them
 * @param fromVersion - Version currently installed
 * @param toVersion - Version being upgraded to
 * @param budget - Character budget for the rendered notes
 * @returns The rendered span and an honest account of what it left out
 * @example
 * ```ts
 * const span = collectSpanNotes(releases, '5.2.1', '7.0.0')
 * const result = await attemptMajorUpgrade({ ...options, releaseNotes: span.notes })
 * ```
 */
export function collectSpanNotes(
  releases: SpanRelease[],
  fromVersion: string,
  toVersion: string,
  budget: number = DEFAULT_SPAN_BUDGET,
): ReleaseSpan {
  const inSpan = releases.filter(release =>
    !release.isPrerelease && isInSpan(release.version, fromVersion, toVersion),
  )

  const omitted: ReleaseSpan['omitted'] = []
  const kept: SpanRelease[] = []

  for (const release of inSpan) {
    const isTarget = parse(release.version) !== null
      && parse(toVersion) !== null
      && compare(parse(release.version)!, parse(toVersion)!) === 0

    if (isBoundary(release.version) || isTarget)
      kept.push(release)
    else
      omitted.push({ version: release.version, reason: 'patch-release' })
  }

  // Newest first: the target release and the majors nearest it are the ones
  // worth spending budget on if the span does not fit.
  kept.sort((a, b) => compare(parse(b.version) ?? [0, 0, 0], parse(a.version) ?? [0, 0, 0]))

  const sections: string[] = []
  const included: string[] = []
  let spent = 0

  for (const release of kept) {
    const section = renderRelease(release)
    if (spent + section.length > budget) {
      omitted.push({ version: release.version, reason: 'budget' })
      continue
    }
    sections.push(section)
    included.push(release.version)
    spent += section.length
  }

  return {
    notes: sections.join('\n\n---\n\n'),
    included,
    omitted,
    // Nothing in the span at all, when the span is real, means the release
    // list did not reach back far enough.
    truncated: inSpan.length === 0 && fromVersion !== toVersion,
  }
}

function renderRelease(release: SpanRelease): string {
  const heading = release.htmlUrl
    ? `## [${release.version}](${release.htmlUrl})`
    : `## ${release.version}`

  return `${heading}\n\n${release.body.trim()}`.trim()
}

/**
 * Describe what a span left out, for the pull request body.
 *
 * @param span - The collected span
 * @returns A one-line note, or empty when nothing was dropped
 */
export function describeSpanGaps(span: ReleaseSpan): string {
  if (span.truncated)
    return '⚠️ No release notes were found for this version span; the analysis below is based on usage sites alone.'

  const dropped = span.omitted.filter(entry => entry.reason === 'budget')
  if (dropped.length === 0)
    return ''

  return `⚠️ ${dropped.length} release(s) in this span were omitted for length: ${
    dropped.map(entry => entry.version).join(', ')
  }.`
}
