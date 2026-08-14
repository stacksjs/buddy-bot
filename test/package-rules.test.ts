import type { PackageRule } from '../src/rules/engine'
import type { PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import {
  applyRules,
  ecosystemOf,
  groupsToRules,
  mergeGroupEffects,
  resolveRuleEffects,
  ruleMatches,
} from '../src/rules/engine'

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'react',
    currentVersion: '17.0.0',
    newVersion: '18.0.0',
    updateType: 'major',
    dependencyType: 'dependencies',
    file: 'package.json',
    ...overrides,
  }
}

describe('ecosystem inference', () => {
  it('success case - infers each ecosystem from the update', () => {
    expect(ecosystemOf(makeUpdate())).toBe('npm')
    expect(ecosystemOf(makeUpdate({ file: 'composer.json', dependencyType: 'require' }))).toBe('composer')
    expect(ecosystemOf(makeUpdate({ dependencyType: 'github-actions' }))).toBe('github-actions')
    expect(ecosystemOf(makeUpdate({ dependencyType: 'docker-image' }))).toBe('docker')
    expect(ecosystemOf(makeUpdate({ dependencyType: 'zig-dependencies' }))).toBe('zig')
    expect(ecosystemOf(makeUpdate({ file: 'deps.yaml' }))).toBe('pkgx')
  })
})

describe('rule matching', () => {
  it('success case - matches by package name', () => {
    expect(ruleMatches({ matchPackages: ['react'] }, makeUpdate())).toBe(true)
    expect(ruleMatches({ matchPackages: ['vue'] }, makeUpdate())).toBe(false)
  })

  it('success case - matches by glob', () => {
    expect(ruleMatches({ matchPackages: ['@types/*'] }, makeUpdate({ name: '@types/node' }))).toBe(true)
  })

  it('success case - matches by update type', () => {
    expect(ruleMatches({ matchUpdateTypes: ['major'] }, makeUpdate())).toBe(true)
    expect(ruleMatches({ matchUpdateTypes: ['patch'] }, makeUpdate())).toBe(false)
  })

  it('success case - matches by ecosystem and dep type', () => {
    expect(ruleMatches({ matchEcosystems: ['npm'] }, makeUpdate())).toBe(true)
    expect(ruleMatches({ matchDepTypes: ['devDependencies'] }, makeUpdate())).toBe(false)
  })

  it('success case - matches by file glob for monorepos', () => {
    const update = makeUpdate({ file: 'packages/api/package.json' })

    expect(ruleMatches({ matchFiles: ['packages/api/**'] }, update)).toBe(true)
    expect(ruleMatches({ matchFiles: ['packages/web/**'] }, update)).toBe(false)
  })

  it('success case - matchers combine with AND', () => {
    const rule: PackageRule = { matchPackages: ['react'], matchUpdateTypes: ['patch'] }

    // Name matches but the update type does not, so the rule does not apply.
    expect(ruleMatches(rule, makeUpdate())).toBe(false)
  })

  it('edge case - a rule with no matchers matches everything', () => {
    expect(ruleMatches({}, makeUpdate())).toBe(true)
  })
})

describe('effect resolution', () => {
  it('success case - later rules override earlier ones per field', () => {
    const rules: PackageRule[] = [
      { matchPackages: ['*'], strategy: 'patch', labels: ['deps'] },
      { matchPackages: ['react'], strategy: 'all' },
    ]

    const effects = resolveRuleEffects(makeUpdate(), rules)

    expect(effects.strategy).toBe('all')
    // The earlier rule's label survives because it was not overridden.
    expect(effects.labels).toContain('deps')
  })

  it('success case - labels and reviewers accumulate across rules', () => {
    // Matching two rules should mean both sets, not whichever was last.
    const rules: PackageRule[] = [
      { matchEcosystems: ['npm'], labels: ['npm'], reviewers: ['alice'] },
      { matchPackages: ['react'], labels: ['frontend'], reviewers: ['bob'] },
    ]

    const effects = resolveRuleEffects(makeUpdate(), rules)

    expect(effects.labels).toEqual(['npm', 'frontend'])
    expect(effects.reviewers).toEqual(['alice', 'bob'])
  })

  it('success case - deduplicates repeated labels', () => {
    const rules: PackageRule[] = [
      { matchPackages: ['*'], labels: ['deps'] },
      { matchPackages: ['react'], labels: ['deps'] },
    ]

    expect(resolveRuleEffects(makeUpdate(), rules).labels).toEqual(['deps'])
  })

  it('edge case - no rules yields permissive defaults', () => {
    const effects = resolveRuleEffects(makeUpdate())

    expect(effects.enabled).toBe(true)
    expect(effects.labels).toEqual([])
    expect(effects.prPriority).toBe(0)
  })
})

describe('applying rules', () => {
  it('success case - drops updates a rule disabled', () => {
    const result = applyRules(
      [makeUpdate(), makeUpdate({ name: 'vue' })],
      [{ matchPackages: ['react'], enabled: false }],
    )

    expect(result.map(entry => entry.update.name)).toEqual(['vue'])
  })

  it('success case - a per-rule strategy narrows what may be proposed', () => {
    // react is held to patch-only, so its major update is dropped.
    const result = applyRules(
      [makeUpdate(), makeUpdate({ name: 'vue', updateType: 'patch' })],
      [{ matchPackages: ['react'], strategy: 'patch' }],
    )

    expect(result.map(entry => entry.update.name)).toEqual(['vue'])
  })

  it('success case - keeps updates a strategy permits', () => {
    const result = applyRules([makeUpdate({ updateType: 'patch' })], [{ matchPackages: ['react'], strategy: 'minor' }])

    expect(result).toHaveLength(1)
  })

  it('success case - carries effects alongside each surviving update', () => {
    const result = applyRules([makeUpdate()], [{ matchPackages: ['react'], groupName: 'React' }])

    expect(result[0].effects.groupName).toBe('React')
  })
})

describe('group effect merging', () => {
  it('success case - unions labels, reviewers and assignees', () => {
    const merged = mergeGroupEffects([
      { enabled: true, labels: ['a'], reviewers: ['alice'], assignees: [], prPriority: 1 },
      { enabled: true, labels: ['b'], reviewers: ['alice'], assignees: ['bob'], prPriority: 5 },
    ])

    expect(merged.labels).toEqual(['a', 'b'])
    expect(merged.reviewers).toEqual(['alice'])
    expect(merged.assignees).toEqual(['bob'])
  })

  it('success case - takes the highest priority in the group', () => {
    const merged = mergeGroupEffects([
      { enabled: true, labels: [], reviewers: [], assignees: [], prPriority: 1 },
      { enabled: true, labels: [], reviewers: [], assignees: [], prPriority: 9 },
    ])

    expect(merged.prPriority).toBe(9)
  })

  it('failure case - one package forbidding auto-merge holds back the group', () => {
    // A package that must not merge unattended has to be able to stop the PR
    // that contains it.
    const merged = mergeGroupEffects([
      { enabled: true, labels: [], reviewers: [], assignees: [], autoMerge: true, prPriority: 0 },
      { enabled: true, labels: [], reviewers: [], assignees: [], prPriority: 0 },
    ])

    expect(merged.autoMerge).toBe(false)
  })

  it('success case - auto-merges when every package allows it', () => {
    const merged = mergeGroupEffects([
      { enabled: true, labels: [], reviewers: [], assignees: [], autoMerge: true, prPriority: 0 },
      { enabled: true, labels: [], reviewers: [], assignees: [], autoMerge: true, prPriority: 0 },
    ])

    expect(merged.autoMerge).toBe(true)
  })

  it('edge case - an empty group does not auto-merge', () => {
    expect(mergeGroupEffects([]).autoMerge).toBe(false)
  })
})

describe('legacy group compilation', () => {
  it('success case - compiles groups into equivalent rules', () => {
    // Existing configs keep working, and the engine has one path to reason about.
    const rules = groupsToRules([{ name: 'TypeScript Types', patterns: ['@types/*'], strategy: 'minor' }])

    expect(rules).toEqual([{ matchPackages: ['@types/*'], groupName: 'TypeScript Types', strategy: 'minor' }])
  })

  it('success case - a compiled group assigns its name to matching updates', () => {
    const rules = groupsToRules([{ name: 'React', patterns: ['react*'] }])

    expect(resolveRuleEffects(makeUpdate(), rules).groupName).toBe('React')
  })

  it('edge case - no groups compiles to no rules', () => {
    expect(groupsToRules()).toEqual([])
  })
})
