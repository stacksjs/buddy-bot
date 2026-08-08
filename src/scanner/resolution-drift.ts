import { semver } from 'bun'

/**
 * Packages that are behind for a reason no manifest shows.
 *
 * Everything else buddy-bot does compares a *declared* range against the
 * registry: `^1.2.0` is declared, `1.5.0` is published, so there is an update.
 * That misses an entire class of staleness, and the missed class is the one
 * that wastes the most time, because from inside the repository everything
 * looks correct.
 *
 * **The case this exists for, which happened.** An application declared
 * `@stacksjs/database@^0.70.315` and got it. It also depended, transitively, on
 * `buddy-bot`, which declared `ts-pantry@^0.10.11` while the rest of that family
 * had moved to `^0.11`. Under hoisted linking one copy wins for the whole tree,
 * so the cap decided it: `ts-pantry@0.10.56` was installed while `0.11.19`
 * existed and satisfied every range the application itself declared. A fix
 * released *for that application*, in response to a bug it reported, could not
 * reach it.
 *
 * Nothing reported anything. Every declared range was satisfiable and current,
 * `bun install` succeeded, and the only symptom was a fix that appeared not to
 * work. It took reading `node_modules/*\/package.json` by hand to find the cap.
 *
 * So: compare what is *installed* against the newest version every declared
 * range would allow, and when they differ, name the dependant responsible.
 * Naming it is most of the value - "ts-pantry is behind" sends somebody to the
 * wrong repository; "buddy-bot caps ts-pantry at ^0.10.11" is the fix.
 */

/** A range somebody declared, and who declared it. */
export interface DeclaredRange {
  /** The package that declared it: a dependant's name, or the root manifest. */
  by: string
  range: string
}

export interface DriftInput {
  name: string
  /** What `node_modules` actually holds. */
  installed: string
  /** Every version the registry offers, unsorted. */
  available: readonly string[]
  /** Every range declared for this package anywhere in the tree. */
  declared: readonly DeclaredRange[]
}

/**
 * Why a package is behind, because the two have different fixes.
 *
 * - `lockfile` - the declared ranges already allow something newer and the
 *   installed copy is older anyway. One `bun update` fixes it, here.
 * - `capped` - the installed copy is the newest anything allows, and a
 *   dependant's range is why. No amount of installing fixes it; somebody has to
 *   widen a range in another repository.
 *
 * Separating them is most of the value. Both read as "behind" in a list, and
 * one of them cannot be fixed from the repository looking at the list - which
 * is exactly the confusion this module exists to end.
 */
export type DriftKind = 'lockfile' | 'capped'

export interface Drift {
  name: string
  kind: DriftKind
  installed: string
  /** The newest version that satisfies every declared range. */
  reachable: string
  /**
   * The declarations that exclude `latest`, whatever the kind.
   *
   * Reported for lockfile drift too, because a package can be both - behind its
   * ceiling and under one - and hiding the cap means somebody updates, sees it
   * move part of the way, and works out why all over again.
   */
  capping: DeclaredRange[]
  /**
   * The newest version in the registry, whether or not any range allows it.
   *
   * Reported alongside `reachable` because they answer different questions:
   * `reachable` is "what could I have right now", `latest` is "what exists".
   * When they differ, widening a range is the fix rather than reinstalling.
   */
  latest: string
}

/** Highest first, so `[0]` is always the newest. */
function newestFirst(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => semver.order(b, a))
}

/**
 * Whether a version satisfies a range, treating an unparseable range as
 * satisfied.
 *
 * A range this cannot parse - a git URL, a `workspace:*`, a `file:` path - is
 * not a version constraint at all, and treating it as unsatisfiable would
 * report drift on every package in a monorepo. The honest answer for something
 * that is not a semver range is that semver has nothing to say about it.
 */
function allows(range: string, version: string): boolean {
  const text = range.trim()

  if (!text || text === '*' || text === 'latest')
    return true

  if (/^(?:workspace|file|link|git|github|npm):/i.test(text) || text.includes('/'))
    return true

  try {
    return semver.satisfies(version, text)
  }
  catch {
    return true
  }
}

/**
 * The drift for one package, or null when nothing is worth saying.
 *
 * Two ways to be behind, and the distinction is the point. A package pinned at
 * `1.0.0` by its *own* manifest is neither: it is pinned, that was a decision,
 * and reporting it every run is how a report gets ignored.
 */
export function driftFor(input: DriftInput): Drift | null {
  const ordered = newestFirst(input.available)
  if (ordered.length === 0)
    return null

  const latest = ordered[0]

  const reachable = ordered.find(version =>
    input.declared.every(declaration => allows(declaration.range, version)))

  // Nothing satisfies every range at once. That is a genuine conflict rather
  // than drift, and it is the installer's to report - saying "you could have
  // version X" when there is no such X would be worse than silence.
  if (!reachable)
    return null

  const capping = input.declared.filter(declaration => !allows(declaration.range, latest))

  const external = capping.filter(declaration => declaration.by !== ROOT)

  /*
   * Behind what the ranges already allow: the lockfile has not caught up, and
   * one `bun update` fixes it here.
   *
   * `capping` is still reported. A package can be both - behind its ceiling
   * *and* under one - and dropping the cap because the lockfile is the nearer
   * problem means somebody updates, sees it move to 1.2.0 rather than 2.0.0,
   * and has to work out why all over again.
   */
  if (semver.order(input.installed, reachable) < 0)
    return { name: input.name, kind: 'lockfile', installed: input.installed, reachable, latest, capping: external }

  /*
   * At the ceiling, and a *dependant* is the ceiling.
   *
   * This is the case the module exists for and the one every other check
   * misses: nothing is out of date by any declared measure, the installer did
   * the right thing, and the package is still stuck. Only reported when the cap
   * comes from somebody else - a range in this repository's own manifest is a
   * decision made here, which `packages.pin` and `packages.ignore` already
   * cover.
   */
  if (external.length > 0 && semver.order(reachable, latest) < 0)
    return { name: input.name, kind: 'capped', installed: input.installed, reachable, latest, capping: external }

  return null
}

/**
 * The name to use for the repository's own manifest.
 *
 * A cap in your own `package.json` is a decision you made and can see; a cap in
 * a dependant's is neither. Only the second is reported, so the two have to be
 * distinguishable.
 */
export const ROOT = 'root'

/** Every drifting package in a tree, worst gap first. */
export function findDrift(inputs: readonly DriftInput[]): Drift[] {
  const found: Drift[] = []

  for (const input of inputs) {
    const drift = driftFor(input)
    if (drift)
      found.push(drift)
  }

  /*
   * Capped packages first, then by how far behind.
   *
   * A cap is somebody's declaration and needs a pull request against another
   * repository; a lag with no cap usually needs one `bun update`. Those are
   * different amounts of work, and the report should lead with the one that
   * will not fix itself.
   */
  return found.sort((a, b) => {
    if (a.kind !== b.kind)
      return a.kind === 'capped' ? -1 : 1

    return semver.order(b.latest, a.latest)
  })
}

/** One line a person can act on. */
export function describeDrift(drift: Drift): string {
  const gap = `${drift.name} ${drift.installed} is installed, ${drift.reachable} is reachable`

  if (drift.kind === 'lockfile')
    return `${gap}. Nothing is capping it - the lockfile is behind.`

  const by = drift.capping.map(declaration => `${declaration.by} (${declaration.range})`).join(', ')

  return drift.reachable === drift.latest
    ? `${gap}, and ${drift.latest} exists but is capped by ${by}.`
    : `${gap}. ${drift.latest} exists but is capped by ${by}.`
}
