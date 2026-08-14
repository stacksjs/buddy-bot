import type { PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { validateConfig } from '../src/config-validation'
import { mergeGroupEffects, resolveRuleEffects, ruleMatches } from '../src/rules/engine'
import { convertRenovateRules } from '../src/rules/renovate'
import { matchesSchedule, parseCronWindow } from '../src/rules/schedule'

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'react',
    currentVersion: '^17.0.2',
    newVersion: '18.2.0',
    updateType: 'major',
    dependencyType: 'dependencies',
    file: 'package.json',
    ...overrides,
  }
}

/** A Saturday at 02:00 UTC. */
const SATURDAY = new Date('2026-08-15T02:00:00Z')
/** A Tuesday at 14:00 UTC. */
const TUESDAY = new Date('2026-08-11T14:00:00Z')

describe('cron window parsing', () => {
  it('success case - expands wildcards, lists, ranges and steps', () => {
    expect(parseCronWindow('0 0 * * *')?.hours).toEqual(new Set([0]))
    expect(parseCronWindow('0 1,3 * * *')?.hours).toEqual(new Set([1, 3]))
    expect(parseCronWindow('0 1-3 * * *')?.hours).toEqual(new Set([1, 2, 3]))
    expect(parseCronWindow('0 0-6/2 * * *')?.hours).toEqual(new Set([0, 2, 4, 6]))
  })

  it('failure case - rejects the wrong field count', () => {
    expect(parseCronWindow('0 0 * *')).toBeNull()
    expect(parseCronWindow('0 0 * * * *')).toBeNull()
  })

  it('failure case - rejects out-of-range values', () => {
    expect(parseCronWindow('0 25 * * *')).toBeNull()
    expect(parseCronWindow('0 0 32 * *')).toBeNull()
    expect(parseCronWindow('0 0 * 13 *')).toBeNull()
  })

  it('failure case - rejects nonsense', () => {
    expect(parseCronWindow('0 abc * * *')).toBeNull()
    expect(parseCronWindow('0 3-1 * * *')).toBeNull()
    expect(parseCronWindow('0 */0 * * *')).toBeNull()
  })
})

describe('schedule windows', () => {
  it('success case - a weekend window admits Saturday', () => {
    expect(matchesSchedule('0 2 * * 6,0', SATURDAY)).toBe(true)
  })

  it('failure case - a weekend window excludes Tuesday', () => {
    expect(matchesSchedule('0 2 * * 6,0', TUESDAY)).toBe(false)
  })

  it('success case - an always-on expression admits any time', () => {
    expect(matchesSchedule('0 * * * *', TUESDAY)).toBe(true)
    expect(matchesSchedule('0 * * * *', SATURDAY)).toBe(true)
  })

  it('failure case - the hour field is honoured', () => {
    expect(matchesSchedule('0 3 * * *', SATURDAY)).toBe(false)
  })

  it('success case - restricting both day fields is an OR, as cron defines', () => {
    // 15th of the month OR a Sunday — SATURDAY is the 15th.
    expect(matchesSchedule('0 2 15 * 0', SATURDAY)).toBe(true)
  })

  it('success case - honours a time zone', () => {
    // 02:00 UTC on Saturday is 22:00 Friday in New York.
    expect(matchesSchedule('0 22 * * 5', SATURDAY, 'America/New_York')).toBe(true)
    expect(matchesSchedule('0 22 * * 6', SATURDAY, 'America/New_York')).toBe(false)
  })

  it('failure case - a malformed expression matches nothing', () => {
    // Treating a typo as "always" would mean a schedule the user believed was
    // holding updates back was doing nothing at all.
    expect(matchesSchedule('not a cron', SATURDAY)).toBe(false)
  })
})

describe('matchCurrentVersion', () => {
  it('success case - matches a version series', () => {
    expect(ruleMatches({ matchCurrentVersion: '<18.0.0' }, makeUpdate())).toBe(true)
  })

  it('failure case - excludes versions outside the range', () => {
    expect(ruleMatches({ matchCurrentVersion: '>=18.0.0' }, makeUpdate())).toBe(false)
  })

  it('success case - strips range operators from the declared version', () => {
    // `^17.0.2` is a range, not a version, and cannot be tested against one.
    expect(ruleMatches({ matchCurrentVersion: '17.x' }, makeUpdate({ currentVersion: '~17.0.2' }))).toBe(true)
    expect(ruleMatches({ matchCurrentVersion: '17.x' }, makeUpdate({ currentVersion: '>=17.0.2' }))).toBe(true)
  })

  it('failure case - an unparseable version matches nothing', () => {
    expect(ruleMatches({ matchCurrentVersion: '*' }, makeUpdate({ currentVersion: 'workspace:*' }))).toBe(false)
  })
})

describe('rule schedules', () => {
  it('success case - a scheduled rule applies inside its window', () => {
    const rule = { matchUpdateTypes: ['major' as const], schedule: '0 2 * * 6,0', enabled: false }

    expect(resolveRuleEffects(makeUpdate(), [rule], SATURDAY).enabled).toBe(false)
  })

  it('failure case - a scheduled rule is inert outside its window', () => {
    // The rule says when its updates may be *proposed*, not when the run
    // happens — so on a Tuesday the rule simply does not apply.
    const rule = { matchUpdateTypes: ['major' as const], schedule: '0 2 * * 6,0', enabled: false }

    expect(resolveRuleEffects(makeUpdate(), [rule], TUESDAY).enabled).toBe(true)
  })
})

describe('autoMigrate effect', () => {
  it('success case - a rule can opt a package into migration', () => {
    const effects = resolveRuleEffects(makeUpdate(), [{ matchPackages: ['react'], autoMigrate: true }])

    expect(effects.autoMigrate).toBe(true)
  })

  it('success case - one package opting in is enough for the group', () => {
    // Unlike auto-merge: migrating what can be migrated leaves the rest
    // exactly as it would have been.
    const merged = mergeGroupEffects([
      resolveRuleEffects(makeUpdate(), [{ matchPackages: ['react'], autoMigrate: true }]),
      resolveRuleEffects(makeUpdate({ name: 'vue' }), []),
    ])

    expect(merged.autoMigrate).toBe(true)
  })

  it('failure case - nothing opting in leaves it off', () => {
    expect(mergeGroupEffects([resolveRuleEffects(makeUpdate(), [])]).autoMigrate).toBe(false)
  })
})

describe('rules validation', () => {
  it('success case - accepts a well-formed rule', () => {
    expect(validateConfig({
      packages: {
        strategy: 'all',
        rules: [{ matchPackages: ['@types/*'], labels: ['types'], autoMerge: true }],
      },
    })).toEqual([])
  })

  it('failure case - a matcherless rule must say so explicitly', () => {
    // A rule with no matchers applies to everything, which is almost always a
    // typo'd matcher rather than an intention.
    const issues = validateConfig({ packages: { strategy: 'all', rules: [{ labels: ['x'] }] } })

    expect(issues[0].message).toContain('matchPackages: ["*"]')
  })

  it('failure case - an unknown key is an error, not ignored', () => {
    // A typo'd matcher does not disable the rule — it widens it.
    const issues = validateConfig({
      packages: { strategy: 'all', rules: [{ matchPackages: ['x'], matchPackageNames: ['y'] } as never] },
    })

    expect(issues.some(issue => issue.path.endsWith('matchPackageNames'))).toBe(true)
  })

  it('failure case - rejects an invalid ecosystem or update type', () => {
    const issues = validateConfig({
      packages: {
        strategy: 'all',
        rules: [{ matchEcosystems: ['maven' as never], matchUpdateTypes: ['huge' as never] }],
      },
    })

    expect(issues).toHaveLength(2)
  })

  it('failure case - rejects a malformed rule schedule', () => {
    const issues = validateConfig({
      packages: { strategy: 'all', rules: [{ matchPackages: ['x'], schedule: '0 0 *' }] },
    })

    expect(issues[0].path).toBe('packages.rules[0].schedule')
  })

  it('failure case - rejects wrong types on effects', () => {
    const issues = validateConfig({
      packages: {
        strategy: 'all',
        rules: [{ matchPackages: ['x'], autoMerge: 'yes' as never, prPriority: 'high' as never }],
      },
    })

    expect(issues).toHaveLength(2)
  })
})

describe('renovate rule conversion', () => {
  it('success case - maps names, prefixes and effects', () => {
    const { rules } = convertRenovateRules([{
      matchPackageNames: ['react'],
      matchPackagePrefixes: ['@types/'],
      automerge: true,
      addLabels: ['deps'],
      reviewers: ['alice'],
      prPriority: 5,
    }])

    expect(rules[0]).toEqual({
      matchPackages: ['react', '@types/*'],
      autoMerge: true,
      labels: ['deps'],
      reviewers: ['alice'],
      prPriority: 5,
    })
  })

  it('success case - converts an anchored prefix pattern exactly', () => {
    const { rules, warnings } = convertRenovateRules([{ matchPackagePatterns: ['^@types/'] }])

    expect(rules[0].matchPackages).toEqual(['@types/*'])
    expect(warnings).toEqual([])
  })

  it('success case - warns rather than mistranslating a real regex', () => {
    // A rule that silently matches the wrong packages is worse than one the
    // user has to rewrite.
    const { warnings } = convertRenovateRules([{ matchPackagePatterns: ['^(foo|bar)$'] }])

    expect(warnings[0]).toContain('regular expression')
  })

  it('success case - maps managers onto ecosystems', () => {
    const { rules } = convertRenovateRules([{ matchManagers: ['npm', 'bun', 'dockerfile'] }])

    expect(rules[0].matchEcosystems).toEqual(['npm', 'docker'])
  })

  it('success case - reports managers with no equivalent', () => {
    const { incompatible } = convertRenovateRules([{ matchManagers: ['npm', 'maven'] }])

    expect(incompatible[0]).toContain('maven')
  })

  it('success case - reports update types with no equivalent', () => {
    const { rules, incompatible } = convertRenovateRules([{
      matchPackageNames: ['x'],
      matchUpdateTypes: ['major', 'digest', 'lockFileMaintenance'],
    }])

    expect(rules[0].matchUpdateTypes).toEqual(['major'])
    expect(incompatible[0]).toContain('digest')
  })

  it('success case - parses a prose release age into minutes', () => {
    expect(convertRenovateRules([{ matchPackageNames: ['x'], minimumReleaseAge: '3 days' }]).rules[0].minimumReleaseAge)
      .toBe(4320)
    expect(convertRenovateRules([{ matchPackageNames: ['x'], minimumReleaseAge: '2 hours' }]).rules[0].minimumReleaseAge)
      .toBe(120)
  })

  it('failure case - reports an unparseable release age', () => {
    const { warnings } = convertRenovateRules([{ matchPackageNames: ['x'], minimumReleaseAge: 'a while' }])

    expect(warnings[0]).toContain('minimumReleaseAge')
  })

  it('failure case - a Renovate schedule needs rewriting as cron', () => {
    const { incompatible } = convertRenovateRules([{
      matchPackageNames: ['x'],
      schedule: ['after 10pm every weekday'],
    }])

    expect(incompatible[0]).toContain('cron')
  })

  it('failure case - drops a rule whose matchers could not be converted', () => {
    // Keeping it would silently apply its effects to every package.
    const { rules, incompatible } = convertRenovateRules([{ matchDatasources: ['npm'], automerge: true }])

    expect(rules).toEqual([])
    expect(incompatible[0]).toContain('dropped')
  })

  it('edge case - tolerates junk in the array', () => {
    expect(convertRenovateRules([null, 'x', 42]).rules).toEqual([])
    expect(convertRenovateRules(undefined).rules).toEqual([])
  })
})
