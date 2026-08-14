/** A PEP 440 version, broken into its ordered components. */
export interface Pep440Version {
  epoch: number
  release: number[]
  /** `a`/`b`/`rc` and its number, absent on a final release */
  pre?: [string, number]
  /** `.postN`, absent when there is none */
  post?: number
  /** `.devN`, absent when there is none */
  dev?: number
  /** `+local`, which never affects ordering against a different version */
  local?: string
}

/**
 * PEP 440's grammar, near enough for dependency comparison.
 *
 * Normalizes the spellings the spec permits: `alpha`/`a`, `preview`/`rc`,
 * `-`/`_`/`.` separators, an optional `v` prefix.
 */
const PEP440 = /^\s*v?(?:(\d+)!)?(\d+(?:\.\d+)*)((?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?)((?:[-_.]?(?:post|rev|r)[-_.]?\d*|-\d+)?)((?:[-_.]?dev[-_.]?\d*)?)(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/i

/** Pre-release markers, normalized to the three the spec orders. */
const PRE_ALIASES: Record<string, string> = {
  a: 'a',
  alpha: 'a',
  b: 'b',
  beta: 'b',
  c: 'rc',
  rc: 'rc',
  pre: 'rc',
  preview: 'rc',
}

/** Sort order of the pre-release markers. */
const PRE_ORDER: Record<string, number> = { a: 0, b: 1, rc: 2 }

/**
 * Parse a PEP 440 version.
 *
 * @param version - Version string
 * @returns The parsed version, or null when it is not PEP 440
 * @example
 * ```ts
 * parsePep440('1.2.3rc1')
 * // { epoch: 0, release: [1, 2, 3], pre: ['rc', 1] }
 * ```
 */
export function parsePep440(version: string): Pep440Version | null {
  const match = PEP440.exec(version)
  if (!match)
    return null

  const [, epoch, release, preRaw, postRaw, devRaw, local] = match

  const parsed: Pep440Version = {
    epoch: epoch ? Number(epoch) : 0,
    release: release.split('.').map(Number),
  }

  if (preRaw) {
    const preMatch = /([a-z]+)[-_.]?(\d*)/i.exec(preRaw)
    if (preMatch) {
      const marker = PRE_ALIASES[preMatch[1].toLowerCase()]
      if (marker)
        parsed.pre = [marker, preMatch[2] ? Number(preMatch[2]) : 0]
    }
  }

  if (postRaw) {
    const postMatch = /(\d+)/.exec(postRaw)
    parsed.post = postMatch ? Number(postMatch[1]) : 0
  }

  if (devRaw) {
    const devMatch = /(\d+)/.exec(devRaw)
    parsed.dev = devMatch ? Number(devMatch[1]) : 0
  }

  if (local)
    parsed.local = local.toLowerCase()

  return parsed
}

/** Compare two release tuples, treating a missing component as zero. */
function compareRelease(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0)
      return diff
  }
  return 0
}

/**
 * Compare two PEP 440 versions.
 *
 * The ordering rules that differ from semver and are easy to get wrong:
 * a `.post` release *follows* the release it post-dates, a `.dev` release
 * *precedes* everything with the same release number including its own
 * pre-releases, and an epoch dominates everything else. `1.0.post1` being
 * newer than `1.0` is the one that matters most in practice — treating it as
 * older would keep proposing a downgrade.
 *
 * @param a - First version
 * @param b - Second version
 * @returns Negative when a precedes b, positive when it follows, 0 when equal
 */
export function comparePep440(a: string, b: string): number {
  const left = parsePep440(a)
  const right = parsePep440(b)

  // Unparseable versions fall back to a stable string order rather than
  // claiming an ordering that is not there.
  if (!left || !right)
    return a === b ? 0 : a < b ? -1 : 1

  if (left.epoch !== right.epoch)
    return left.epoch - right.epoch

  const release = compareRelease(left.release, right.release)
  if (release !== 0)
    return release

  // dev < pre < final < post, all within the same release number.
  const rank = (version: Pep440Version): number => {
    if (version.dev !== undefined && version.pre === undefined && version.post === undefined)
      return 0
    if (version.pre !== undefined)
      return 1
    if (version.post !== undefined)
      return 3
    return 2
  }

  const rankDiff = rank(left) - rank(right)
  if (rankDiff !== 0)
    return rankDiff

  if (left.pre && right.pre) {
    const markerDiff = PRE_ORDER[left.pre[0]] - PRE_ORDER[right.pre[0]]
    if (markerDiff !== 0)
      return markerDiff
    if (left.pre[1] !== right.pre[1])
      return left.pre[1] - right.pre[1]
  }

  if ((left.post ?? 0) !== (right.post ?? 0))
    return (left.post ?? 0) - (right.post ?? 0)

  // A dev release of the same pre/post precedes the non-dev one.
  const leftDev = left.dev ?? Number.POSITIVE_INFINITY
  const rightDev = right.dev ?? Number.POSITIVE_INFINITY
  if (leftDev !== rightDev)
    return leftDev < rightDev ? -1 : 1

  return 0
}

/** Whether a version is a pre-release or development build. */
export function isPep440Prerelease(version: string): boolean {
  const parsed = parsePep440(version)
  return Boolean(parsed && (parsed.pre !== undefined || parsed.dev !== undefined))
}

/**
 * Classify a version change.
 *
 * @param from - Current version
 * @param to - Proposed version
 */
export function pep440UpdateType(from: string, to: string): 'major' | 'minor' | 'patch' {
  const a = parsePep440(from)
  const b = parsePep440(to)
  if (!a || !b)
    return 'patch'

  if (a.epoch !== b.epoch || (a.release[0] ?? 0) !== (b.release[0] ?? 0))
    return 'major'
  if ((a.release[1] ?? 0) !== (b.release[1] ?? 0))
    return 'minor'
  return 'patch'
}

/**
 * Split a Python requirement into its operator and version.
 *
 * Operators are preserved on write so an update never quietly widens or
 * narrows a constraint a maintainer chose — `~=1.4` staying `~=` rather than
 * becoming `==` is the difference between a compatible-release pin and an
 * exact one.
 *
 * @param constraint - Constraint such as `>=1.2,<2.0` or `~=1.4.2`
 * @returns The leading operator and the version it applies to
 */
export function splitConstraint(constraint: string): { operator: string, version: string } {
  const match = /^\s*(~=|===|==|!=|<=|>=|<|>|\^)?\s*(.*)$/.exec(constraint.trim())
  if (!match)
    return { operator: '', version: constraint.trim() }

  return { operator: match[1] ?? '', version: match[2].trim() }
}
