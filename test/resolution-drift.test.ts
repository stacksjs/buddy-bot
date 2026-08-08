/**
 * Packages that are behind for a reason no manifest shows.
 *
 * Everything else buddy-bot does compares a declared range against the
 * registry. This covers the class that misses, and the class it misses is the
 * one that wastes the most time, because from inside the repository everything
 * looks correct: every range is satisfiable, `bun install` succeeds, and the
 * only symptom is a fix that appears not to work.
 *
 * The first test is the incident that prompted it, with the real numbers.
 */

import { describe, expect, test } from 'bun:test'
import { describeDrift, driftFor, findDrift } from '../src/scanner/resolution-drift'

describe('a transitive cap', () => {
  test('is found, and the dependant responsible is named', () => {
    /*
     * What actually happened. An application declared @stacksjs/database and
     * got it, and also depended transitively on buddy-bot, which declared
     * ts-pantry at ^0.10.11 while the rest of that family had moved to ^0.11.
     * Under hoisted linking one copy wins for the whole tree, so 0.10.56 was
     * installed while 0.11.19 existed - and a fix released for that
     * application, in response to a bug it reported, could not reach it.
     */
    const drift = driftFor({
      name: 'ts-pantry',
      installed: '0.10.56',
      available: ['0.10.11', '0.10.56', '0.11.0', '0.11.19'],
      declared: [
        { by: '@stacksjs/config', range: '^0.11.0' },
        { by: 'buddy-bot', range: '^0.10.11' },
      ],
    })

    // Nothing satisfies both ^0.11.0 and ^0.10.11, so there is no reachable
    // version and this is a conflict rather than drift - the installer's to
    // report. Saying "you could have X" when there is no such X is worse than
    // silence.
    expect(drift).toBeNull()
  })

  test('and when the ranges overlap, the cap is the whole finding', () => {
    /*
     * The commoner shape, and the one every other check misses. Nothing is out
     * of date by any declared measure - the installer resolved correctly to the
     * newest version every range allows - and the package is still stuck two
     * minor versions back because one dependant says so.
     *
     * `installed === reachable` here, which is why a check that only compares
     * those two reports nothing at all.
     */
    const drift = driftFor({
      name: 'ts-pantry',
      installed: '0.10.56',
      available: ['0.10.56', '0.11.0', '0.11.19'],
      declared: [
        { by: 'root', range: '*' },
        { by: 'buddy-bot', range: '<=0.10.56' },
      ],
    })

    expect(drift?.kind).toBe('capped')
    expect(drift?.installed).toBe('0.10.56')
    expect(drift?.latest).toBe('0.11.19')
    expect(drift?.capping.map(c => c.by)).toEqual(['buddy-bot'])
  })

  test('reports the gap when a range permits more than is installed', () => {
    const drift = driftFor({
      name: 'ts-pantry',
      installed: '0.10.56',
      available: ['0.10.56', '0.11.0', '0.11.19'],
      declared: [{ by: 'root', range: '^0.10.0 || ^0.11.0' }],
    })

    expect(drift?.installed).toBe('0.10.56')
    expect(drift?.reachable).toBe('0.11.19')
    // Nothing is capping - the ranges allow the newest, so this is a lockfile
    // that has not been updated rather than anybody's declaration.
    expect(drift?.capping).toEqual([])
  })

  test('names the capping dependant when one excludes the newest', () => {
    const drift = driftFor({
      name: 'left-pad',
      installed: '1.0.0',
      available: ['1.0.0', '1.2.0', '2.0.0'],
      declared: [
        { by: 'root', range: '*' },
        { by: 'old-tool', range: '^1.0.0' },
      ],
    })

    expect(drift?.reachable).toBe('1.2.0')
    expect(drift?.latest).toBe('2.0.0')
    // "left-pad is behind" sends somebody to the wrong repository. "old-tool
    // caps it at ^1.0.0" is the fix.
    expect(drift?.capping.map(c => c.by)).toEqual(['old-tool'])
  })
})

describe('what is deliberately not drift', () => {
  test('a package already at the best available version', () => {
    expect(driftFor({
      name: 'a',
      installed: '2.0.0',
      available: ['1.0.0', '2.0.0'],
      declared: [{ by: 'root', range: '^2.0.0' }],
    })).toBeNull()
  })

  test('a package pinned by its own manifest', () => {
    /*
     * Pinned is not drifting, it is pinned. Reporting it every run is how a
     * report gets ignored, and this report is only worth having if everything
     * in it is actionable.
     */
    expect(driftFor({
      name: 'a',
      installed: '1.0.0',
      available: ['1.0.0', '2.0.0'],
      declared: [{ by: 'root', range: '1.0.0' }],
    })).toBeNull()
  })

  test('a package installed ahead of the registry, which happens with a local link', () => {
    expect(driftFor({
      name: 'a',
      installed: '3.0.0',
      available: ['1.0.0', '2.0.0'],
      declared: [{ by: 'root', range: '*' }],
    })).toBeNull()
  })

  test('a package with no published versions at all', () => {
    expect(driftFor({ name: 'a', installed: '1.0.0', available: [], declared: [] })).toBeNull()
  })
})

describe('ranges that are not semver', () => {
  test('a workspace or file protocol is not a version constraint', () => {
    /*
     * A range this cannot parse is not a constraint at all, and treating it as
     * unsatisfiable would report drift on every package in a monorepo. The
     * honest answer for something that is not a semver range is that semver has
     * nothing to say about it.
     */
    const drift = driftFor({
      name: 'a',
      installed: '1.0.0',
      available: ['1.0.0', '2.0.0'],
      declared: [
        { by: 'root', range: 'workspace:*' },
        { by: 'other', range: 'file:../a' },
      ],
    })

    expect(drift?.reachable).toBe('2.0.0')
    expect(drift?.capping).toEqual([])
  })

  test('and neither is a git or github dependency', () => {
    const drift = driftFor({
      name: 'a',
      installed: '1.0.0',
      available: ['1.0.0', '2.0.0'],
      declared: [{ by: 'root', range: 'github:someone/a#main' }],
    })

    expect(drift?.reachable).toBe('2.0.0')
  })
})

describe('the report', () => {
  test('leads with capped packages, because they will not fix themselves', () => {
    /*
     * A cap is somebody's declaration and needs a pull request against another
     * repository. A lag with no cap usually needs one `bun update`. Different
     * amounts of work, and the report should lead with the one that persists.
     */
    const drift = findDrift([
      {
        name: 'lagging',
        installed: '1.0.0',
        available: ['1.0.0', '1.1.0'],
        declared: [{ by: 'root', range: '^1.0.0' }],
      },
      {
        name: 'capped',
        installed: '1.0.0',
        available: ['1.0.0', '2.0.0'],
        declared: [{ by: 'root', range: '*' }, { by: 'old', range: '^1.0.0' }],
      },
    ])

    expect(drift.map(d => d.name)).toEqual(['capped', 'lagging'])
  })

  test('says who to go and talk to', () => {
    const line = describeDrift({
      name: 'ts-pantry',
      installed: '0.10.56',
      kind: 'capped' as const,
      reachable: '0.10.56',
      latest: '0.11.19',
      capping: [{ by: 'buddy-bot', range: '^0.10.11' }],
    })

    expect(line).toContain('buddy-bot (^0.10.11)')
    expect(line).toContain('0.11.19')
  })

  test('and says when there is nobody to talk to', () => {
    const line = describeDrift({
      name: 'a',
      installed: '1.0.0',
      kind: 'lockfile' as const,
      reachable: '2.0.0',
      latest: '2.0.0',
      capping: [],
    })

    expect(line).toContain('lockfile is behind')
  })
})
