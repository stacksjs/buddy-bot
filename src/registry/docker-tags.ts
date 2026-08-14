/** A tag parsed into the parts that decide whether it is an upgrade. */
export interface ParsedTag {
  raw: string
  /** Numeric components, most significant first */
  version: number[]
  /**
   * Variant suffix such as `alpine` or `slim`, normalized to lower case, with
   * any pre-release marker removed.
   *
   * The two are separated because they mean different things: a variant says
   * which image this is, a pre-release marker says how finished it is. Leaving
   * `rc1` in the variant would make `2.0-rc1` a different image from `2.0`
   * rather than an earlier build of it.
   */
  suffix: string
  /** Whether the tag names a pre-release */
  prerelease: boolean
}

// A trailing number is part of the marker, not a boundary: `rc1`, `beta2` and
// `alpha3` are the forms projects actually publish, and `\b` between `c` and
// `1` does not exist.
const PRERELEASE = /(?:^|[-_.])(?:rc|alpha|beta|pre|dev|nightly|canary|snapshot|edge|next)\d*(?:$|[-_.])/i

/**
 * Parse a Docker tag.
 *
 * Docker tags are not semver and cannot be treated as such: `1.2`, `18`,
 * `20.11.1-alpine3.19` and `bookworm` are all ordinary. What matters is the
 * leading numeric run and whatever variant follows it.
 *
 * @param tag - The raw tag
 * @returns The parsed tag, or null when it carries no version at all
 */
export function parseTag(tag: string): ParsedTag | null {
  const match = /^v?(\d+(?:\.\d+)*)(.*)$/.exec(tag.trim())
  if (!match)
    return null

  const [, numbers, rest] = match
  const prerelease = PRERELEASE.test(rest)

  const suffix = rest
    .replace(PRERELEASE, (matched) => {
      // Keep whichever separator the marker consumed, so `-rc1-alpine`
      // collapses to `-alpine` rather than to `alpine` glued to what precedes.
      return matched.endsWith('-') || matched.endsWith('_') || matched.endsWith('.') ? '-' : ''
    })
    .replace(/^[-_.]/, '')
    .toLowerCase()

  return {
    raw: tag,
    version: numbers.split('.').map(Number),
    suffix,
    prerelease,
  }
}

/** Compare two version component arrays, longest-common-prefix style. */
export function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0)
      return diff
  }

  // `1.2.3` is more specific than `1.2`; prefer it when both name the same
  // version, since it is what a maintainer would have pinned.
  return a.length - b.length
}

/**
 * Whether two suffixes name the same image variant.
 *
 * Compared by their leading word rather than exactly, so `alpine3.18` and
 * `alpine3.19` are the same variant moving forward. Without this a
 * `node:20-alpine3.18` image would never see an update, because every newer
 * tag carries a different alpine version in its suffix.
 */
export function sameVariant(a: string, b: string): boolean {
  const word = (value: string): string => /^[a-z]+/.exec(value)?.[0] ?? value
  return word(a) === word(b)
}

/**
 * Find the newest tag that is an upgrade of the current one.
 *
 * Variant is preserved absolutely: an `-alpine` image must not be "updated"
 * to a Debian one. That would swap the base distribution underneath a
 * Dockerfile whose later `RUN apk add …` lines would then fail — a change
 * nobody asked for, arriving as a dependency bump.
 *
 * @param currentTag - The tag in the file
 * @param available - Tags the registry reported
 * @param options - Whether to consider pre-releases
 * @returns The newer tag, or null when there is nothing better
 * @example
 * ```ts
 * selectLatestTag('20.10-alpine', ['20.11-alpine', '21.0', '20.11-slim'])
 * // '20.11-alpine'
 * ```
 */
export function selectLatestTag(
  currentTag: string,
  available: string[],
  options: { includePrerelease?: boolean } = {},
): string | null {
  const current = parseTag(currentTag)
  // A non-version tag (`latest`, `bookworm`, `stable`) is a moving target the
  // registry already updates; proposing a version for it would pin something
  // the author deliberately left floating.
  if (!current)
    return null

  const candidates = available
    .map(parseTag)
    .filter((tag): tag is ParsedTag => tag !== null)
    .filter(tag => options.includePrerelease ? true : !tag.prerelease)
    .filter(tag => sameVariant(tag.suffix, current.suffix))
    // Matching the current tag's precision keeps `18` on `18`/`19` rather than
    // rewriting it to `18.20.4` — the author chose that precision.
    .filter(tag => tag.version.length === current.version.length)
    .filter(tag => compareVersions(tag.version, current.version) > 0)

  if (candidates.length === 0)
    return null

  candidates.sort((a, b) => compareVersions(b.version, a.version))
  return candidates[0].raw
}

/**
 * Classify a tag change, for grouping and strategy filtering.
 *
 * @param from - Current tag
 * @param to - Proposed tag
 * @returns The update type, defaulting to `patch` when unclear
 */
export function tagUpdateType(from: string, to: string): 'major' | 'minor' | 'patch' {
  const a = parseTag(from)
  const b = parseTag(to)
  if (!a || !b)
    return 'patch'

  if ((b.version[0] ?? 0) !== (a.version[0] ?? 0))
    return 'major'
  if ((b.version[1] ?? 0) !== (a.version[1] ?? 0))
    return 'minor'
  return 'patch'
}
