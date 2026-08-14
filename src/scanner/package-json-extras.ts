import type { Dependency } from '../types'

/** Runtimes buddy-bot knows how to resolve a version for. */
export const KNOWN_ENGINES: Record<string, { registry: 'npm' | 'github', source: string }> = {
  node: { registry: 'github', source: 'nodejs/node' },
  bun: { registry: 'npm', source: 'bun' },
  npm: { registry: 'npm', source: 'npm' },
  pnpm: { registry: 'npm', source: 'pnpm' },
  yarn: { registry: 'npm', source: 'yarn' },
  deno: { registry: 'github', source: 'denoland/deno' },
}

/**
 * Extract `engines` as dependencies.
 *
 * An engine constraint is a dependency in every way that matters — it pins
 * what the project runs on, it goes stale, and a security release in Node is
 * exactly as worth knowing about as one in a library. It is separated from
 * ordinary dependencies only because bumping it is a deployment decision, so
 * it is reported with its own dependency type and left off by default.
 *
 * @param engines - The `engines` object from a package.json
 * @param file - Manifest path, for attribution
 * @returns Dependencies, one per known engine
 * @example
 * ```ts
 * extractEngines({ node: '>=20' }, 'package.json')
 * // [{ name: 'node', currentVersion: '>=20', type: 'engines', … }]
 * ```
 */
export function extractEngines(engines: unknown, file: string): Dependency[] {
  if (typeof engines !== 'object' || engines === null || Array.isArray(engines))
    return []

  const dependencies: Dependency[] = []

  for (const [name, constraint] of Object.entries(engines as Record<string, unknown>)) {
    if (typeof constraint !== 'string' || !constraint.trim())
      continue

    // An unknown engine has no registry to ask, and guessing at one would
    // resolve versions for an unrelated package with the same name.
    if (!KNOWN_ENGINES[name])
      continue

    dependencies.push({
      name,
      currentVersion: constraint.trim(),
      type: 'engines',
      file,
      metadata: { engine: 'true', source: KNOWN_ENGINES[name].source },
    })
  }

  return dependencies
}

/** A version another field pins, and where the pin came from. */
export interface ResolutionPin {
  name: string
  version: string
  /** `overrides`, `resolutions`, or `pnpm.overrides` */
  field: string
}

/**
 * Collect the versions `overrides` and `resolutions` pin.
 *
 * A package pinned by an override cannot be updated by editing the dependency
 * that declares it: the override wins at install time regardless. Proposing
 * one anyway produces a pull request that changes `package.json`, passes CI,
 * merges, and installs exactly the same tree as before — which is worse than
 * no pull request, because it looks like progress.
 *
 * Nested override objects are walked, since npm allows an override to apply
 * only under a particular parent.
 *
 * @param packageData - Parsed package.json
 * @returns Every pin found, with the field it came from
 */
export function collectResolutionPins(packageData: unknown): ResolutionPin[] {
  if (typeof packageData !== 'object' || packageData === null)
    return []

  const data = packageData as Record<string, unknown>
  const pins: ResolutionPin[] = []

  const walk = (table: unknown, field: string): void => {
    if (typeof table !== 'object' || table === null || Array.isArray(table))
      return

    for (const [name, value] of Object.entries(table as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) {
        pins.push({ name, version: value.trim(), field })
        continue
      }

      // npm's nested form: { "foo": { ".": "1.0", "bar": "2.0" } }
      if (typeof value === 'object' && value !== null) {
        const nested = value as Record<string, unknown>
        if (typeof nested['.'] === 'string')
          pins.push({ name, version: nested['.'].trim(), field })
        walk(value, field)
      }
    }
  }

  walk(data.overrides, 'overrides')
  walk(data.resolutions, 'resolutions')
  walk((data.pnpm as Record<string, unknown> | undefined)?.overrides, 'pnpm.overrides')

  return pins
}

/**
 * Whether a pin holds a package at a version an update would not reach.
 *
 * An override naming a range that already admits the new version is not
 * holding anything back — only an exact pin, or one that excludes it, is.
 *
 * @param pin - The pin to test
 * @param newVersion - Version an update would propose
 * @returns Whether the pin would defeat the update
 */
export function pinBlocksUpdate(pin: ResolutionPin, newVersion: string): boolean {
  const constraint = pin.version.trim()

  // A range that already covers the proposed version does not block it.
  try {
    if (/^[\^~><=]/.test(constraint))
      return !Bun.semver.satisfies(newVersion, constraint)
  }
  catch {
    // An unparseable constraint is one we cannot reason about; reporting it
    // is better than assuming it is harmless.
    return true
  }

  // An exact pin blocks anything that is not exactly it.
  return constraint !== newVersion
}

/**
 * Resolve the newest version of a known engine.
 *
 * npm-published runtimes are looked up on the registry; Node and Deno publish
 * releases on GitHub instead. Both are behind injected lookups so the caller
 * reuses whatever clients and caching it already has.
 *
 * @param engine - Engine name, as it appears under `engines`
 * @param lookups - Registry and release lookups
 * @returns The newest version, or null when it cannot be resolved
 */
export async function resolveEngineVersion(
  engine: string,
  lookups: {
    npm: (name: string) => Promise<string | null>
    github: (repo: string) => Promise<string | null>
  },
): Promise<string | null> {
  const known = KNOWN_ENGINES[engine]
  if (!known)
    return null

  const version = known.registry === 'npm'
    ? await lookups.npm(known.source)
    : await lookups.github(known.source)

  return version ? version.replace(/^v/, '') : null
}

/**
 * Propose a new engine constraint, preserving its shape.
 *
 * An engine constraint is usually a floor (`>=20`), and rewriting it to an
 * exact version would turn "runs on 20 or newer" into "runs only on 20.11.1" —
 * which breaks every contributor on a different patch release. The operator
 * and the precision are both carried across.
 *
 * @param constraint - The declared constraint
 * @param latest - Newest available version
 * @returns The new constraint, or null when it already admits `latest`
 * @example
 * ```ts
 * bumpEngineConstraint('>=20', '22.3.0')  // '>=22'
 * bumpEngineConstraint('>=20', '20.11.1') // null — already satisfied
 * ```
 */
export function bumpEngineConstraint(constraint: string, latest: string): string | null {
  const match = /^\s*(>=|\^|~|>|=)?\s*v?(\d+(?:\.\d+)*)\s*$/.exec(constraint)
  if (!match)
    return null

  const [, operator = '', declared] = match
  const declaredParts = declared.split('.').map(Number)
  const latestParts = latest.split('.').map(Number)

  // Matched to the precision the author wrote: someone who pinned `>=20` gets
  // `>=22`, not `>=22.3.0`.
  const truncated = latestParts.slice(0, declaredParts.length)

  // Lexicographic, not "any greater and none lesser": `22.3` follows `20.5`
  // because the first differing component is larger, even though the second
  // is smaller. Comparing component-wise without stopping at the first
  // difference would call that a downgrade.
  let isNewer = false
  for (let index = 0; index < truncated.length; index++) {
    const difference = truncated[index] - (declaredParts[index] ?? 0)
    if (difference !== 0) {
      isNewer = difference > 0
      break
    }
  }

  if (!isNewer)
    return null

  return `${operator}${truncated.join('.')}`
}
