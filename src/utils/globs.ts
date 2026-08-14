import { Glob } from 'bun'

/** A compiled include/exclude pattern set. */
export interface PathMatcher {
  /** Whether a path passes the filter */
  matches: (path: string) => boolean
}

/**
 * Compile gitignore-style patterns into a matcher.
 *
 * Patterns are evaluated in order and the last one to match decides, so a
 * broad exclude can be re-opened by a later include — the same rule gitignore
 * uses, which is what people expect when they write these by hand.
 *
 * A set containing only exclusions implies "include everything else"; a set
 * with any inclusion implies "exclude everything else".
 *
 * @param patterns - Globs, `!`-prefixed to exclude
 * @returns A matcher, or one that accepts everything when no patterns are given
 * @example
 * ```ts
 * const matcher = createPathMatcher(['src/**', '!src/generated/**'])
 * matcher.matches('src/app.ts') // true
 * matcher.matches('src/generated/api.ts') // false
 * ```
 */
export function createPathMatcher(patterns?: string[]): PathMatcher {
  if (!patterns || patterns.length === 0)
    return { matches: () => true }

  const compiled = patterns.map((raw) => {
    const negated = raw.startsWith('!')
    const pattern = negated ? raw.slice(1) : raw
    return { negated, glob: new Glob(pattern), pattern }
  })

  const hasInclude = compiled.some(entry => !entry.negated)

  return {
    matches(path: string): boolean {
      const normalized = path.replace(/^\.\//, '')
      // Absent any positive pattern, everything is included until excluded.
      let included = !hasInclude

      for (const entry of compiled) {
        if (!safeMatch(entry.glob, normalized))
          continue
        included = !entry.negated
      }

      return included
    },
  }
}

/**
 * Find the instructions that apply to a path.
 *
 * All matching entries apply, ordered from least to most specific, so a
 * repository-wide rule and a directory-specific one compose rather than one
 * silently replacing the other.
 *
 * @param path - Repository-relative path
 * @param instructions - Glob-keyed guidance
 * @returns Matching instructions, most specific last
 */
export function instructionsForPath(
  path: string,
  instructions?: Array<{ path: string, instructions: string }>,
): string[] {
  if (!instructions?.length)
    return []

  const normalized = path.replace(/^\.\//, '')

  return instructions
    .filter(entry => safeMatch(new Glob(entry.path), normalized))
    // Specificity is approximated by pattern length, which orders
    // `src/**` before `src/security/**` without needing a glob parser.
    .sort((a, b) => a.path.length - b.path.length)
    .map(entry => entry.instructions)
}

/**
 * Match a glob without letting a malformed pattern abort the run.
 *
 * A bad pattern in config should exclude nothing rather than crash a review.
 */
function safeMatch(glob: Glob, path: string): boolean {
  try {
    return glob.match(path)
  }
  catch {
    return false
  }
}
