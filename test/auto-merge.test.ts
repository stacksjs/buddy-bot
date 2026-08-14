import type { AutoMergeCandidate } from '../src/pr/auto-merge'
import type { BuddyBotConfig, PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { evaluateAutoMerge, evaluateAutoMergeForUpdates, resolveAutoMergeConfig } from '../src/pr/auto-merge'
import { serializeManifest } from '../src/pr/pr-manifest'

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'typescript',
    currentVersion: '5.8.2',
    newVersion: '5.8.3',
    updateType: 'patch',
    dependencyType: 'devDependencies',
    file: 'package.json',
    ...overrides,
  }
}

function makePR(updates: PackageUpdate[], overrides: Partial<AutoMergeCandidate> = {}): AutoMergeCandidate {
  return {
    number: 42,
    title: 'chore(deps): update dependencies',
    body: `prose${serializeManifest(updates)}`,
    head: 'buddy-bot/update-deps',
    labels: [],
    draft: false,
    ...overrides,
  }
}

function makeConfig(conditions: string[], overrides: Record<string, unknown> = {}): BuddyBotConfig {
  return {
    pullRequest: {
      autoMerge: { enabled: true, strategy: 'squash', conditions, ...overrides },
    },
  } as BuddyBotConfig
}

describe('auto-merge evaluation', () => {
  describe('config gating', () => {
    it('failure case - refuses when auto-merge is disabled', () => {
      const config = { pullRequest: { autoMerge: { enabled: false, strategy: 'squash' as const } } }

      const decision = evaluateAutoMerge(makePR([makeUpdate()]), config, true)

      expect(decision.eligible).toBe(false)
      expect(decision.reason).toContain('disabled by config')
    })

    it('failure case - refuses when no conditions are configured', () => {
      const decision = evaluateAutoMerge(makePR([makeUpdate()]), makeConfig([]), true)

      expect(decision.eligible).toBe(false)
      expect(decision.reason).toContain('no auto-merge conditions')
    })

    it('success case - applies documented defaults', () => {
      const settings = resolveAutoMergeConfig(makeConfig(['patch-only']))

      expect(settings).toMatchObject({
        enabled: true,
        strategy: 'squash',
        requireGreenCI: true,
        optOutLabel: 'no-auto-merge',
        securityLabel: 'security',
      })
    })
  })

  describe('patch-only', () => {
    it('success case - merges a patch-only PR', () => {
      const decision = evaluateAutoMerge(makePR([makeUpdate()]), makeConfig(['patch-only']), true)

      expect(decision.eligible).toBe(true)
      expect(decision.reason).toContain('patch')
    })

    it('failure case - refuses a PR containing a minor update', () => {
      const updates = [makeUpdate(), makeUpdate({ name: 'vite', newVersion: '5.9.0', updateType: 'minor' })]

      const decision = evaluateAutoMerge(makePR(updates), makeConfig(['patch-only']), true)

      expect(decision.eligible).toBe(false)
      expect(decision.reason).toContain('do not satisfy conditions')
    })

    it('failure case - refuses a major update', () => {
      const update = makeUpdate({ newVersion: '6.0.0', updateType: 'major' })

      expect(evaluateAutoMerge(makePR([update]), makeConfig(['patch-only']), true).eligible).toBe(false)
    })
  })

  describe('minor-only', () => {
    it('success case - merges mixed minor and patch updates', () => {
      const updates = [makeUpdate(), makeUpdate({ name: 'vite', newVersion: '5.9.0', updateType: 'minor' })]

      expect(evaluateAutoMerge(makePR(updates), makeConfig(['minor-only']), true).eligible).toBe(true)
    })

    it('failure case - refuses when a major update is present', () => {
      const updates = [makeUpdate(), makeUpdate({ name: 'vite', newVersion: '6.0.0', updateType: 'major' })]

      expect(evaluateAutoMerge(makePR(updates), makeConfig(['minor-only']), true).eligible).toBe(false)
    })
  })

  describe('security-only', () => {
    it('success case - merges a PR carrying the security label', () => {
      const pr = makePR([makeUpdate({ updateType: 'major', newVersion: '6.0.0' })], { labels: ['security'] })

      const decision = evaluateAutoMerge(pr, makeConfig(['security-only']), true)

      expect(decision.eligible).toBe(true)
      expect(decision.reason).toContain('security advisory')
    })

    it('failure case - refuses an unlabelled PR', () => {
      expect(evaluateAutoMerge(makePR([makeUpdate()]), makeConfig(['security-only']), true).eligible).toBe(false)
    })

    it('success case - honours a custom security label', () => {
      const config = { ...makeConfig(['security-only']), security: { label: 'vuln' } } as BuddyBotConfig
      const pr = makePR([makeUpdate()], { labels: ['vuln'] })

      expect(evaluateAutoMerge(pr, config, true).eligible).toBe(true)
    })
  })

  describe('all', () => {
    it('success case - merges a major update when explicitly opted in', () => {
      const update = makeUpdate({ newVersion: '6.0.0', updateType: 'major' })

      expect(evaluateAutoMerge(makePR([update]), makeConfig(['all']), true).eligible).toBe(true)
    })
  })

  describe('safety rails', () => {
    it('failure case - refuses a non-buddy-bot branch', () => {
      const pr = makePR([makeUpdate()], { head: 'feature/hand-written' })

      expect(evaluateAutoMerge(pr, makeConfig(['patch-only']), true).reason).toContain('not a buddy-bot PR')
    })

    it('failure case - refuses a draft PR', () => {
      const pr = makePR([makeUpdate()], { draft: true })

      expect(evaluateAutoMerge(pr, makeConfig(['patch-only']), true).reason).toContain('draft')
    })

    it('failure case - refuses a PR carrying the opt-out label', () => {
      const pr = makePR([makeUpdate()], { labels: ['no-auto-merge'] })

      expect(evaluateAutoMerge(pr, makeConfig(['patch-only']), true).reason).toContain('no-auto-merge')
    })

    it('failure case - honours a custom opt-out label', () => {
      const config = makeConfig(['patch-only'], { optOutLabel: 'hold' })
      const pr = makePR([makeUpdate()], { labels: ['hold'] })

      expect(evaluateAutoMerge(pr, config, true).eligible).toBe(false)
    })

    it('failure case - refuses when checks are red', () => {
      const decision = evaluateAutoMerge(makePR([makeUpdate()]), makeConfig(['patch-only']), false)

      expect(decision.eligible).toBe(false)
      expect(decision.reason).toContain('failing or pending checks')
    })

    it('success case - ignores red checks when requireGreenCI is off', () => {
      const config = makeConfig(['patch-only'], { requireGreenCI: false })

      expect(evaluateAutoMerge(makePR([makeUpdate()]), config, false).eligible).toBe(true)
    })

    it('failure case - refuses a PR with no manifest', () => {
      const pr = makePR([], { body: '| [typescript](x) | `5.8.2` -> `5.8.3` |' })

      expect(evaluateAutoMerge(pr, makeConfig(['patch-only']), true).reason).toContain('no metadata manifest')
    })

    it('failure case - refuses a truncated manifest', () => {
      // A manifest that dropped rows cannot prove every update is a patch.
      const updates = Array.from({ length: 2000 }, (_, i) => makeUpdate({
        name: `@scope/a-fairly-long-package-name-${i}`,
        file: `packages/workspace-number-${i}/package.json`,
      }))

      const decision = evaluateAutoMerge(makePR(updates), makeConfig(['patch-only']), true)

      expect(decision.eligible).toBe(false)
      expect(decision.reason).toContain('truncated manifest')
    })

    it('edge case - refuses an empty update set under patch-only', () => {
      expect(evaluateAutoMerge(makePR([]), makeConfig(['patch-only']), true).eligible).toBe(false)
    })
  })

  describe('size-reduced manifests', () => {
    it('edge case - recomputes update type when the field was shed', () => {
      // Reduced manifests omit `type`; the bucket comes back from the versions.
      const body = 'x\n\n<!-- buddy-bot:manifest v1\n{"schemaVersion":1,"updates":[{"name":"a","current":"1.2.3","target":"1.2.4","file":"package.json"}]}\n-->'

      expect(evaluateAutoMerge(makePR([], { body }), makeConfig(['patch-only']), true).eligible).toBe(true)
    })

    it('edge case - treats an unparseable version pair as major', () => {
      const body = 'x\n\n<!-- buddy-bot:manifest v1\n{"schemaVersion":1,"updates":[{"name":"a","current":"latest","target":"main","file":"deps.yaml"}]}\n-->'

      expect(evaluateAutoMerge(makePR([], { body }), makeConfig(['minor-only']), true).eligible).toBe(false)
    })
  })

  describe('evaluateAutoMergeForUpdates', () => {
    it('success case - qualifies patch updates before the PR exists', () => {
      const decision = evaluateAutoMergeForUpdates([makeUpdate()], ['dependencies'], makeConfig(['patch-only']))

      expect(decision.eligible).toBe(true)
    })

    it('failure case - refuses when a major update is in the set', () => {
      const updates = [makeUpdate(), makeUpdate({ name: 'vite', updateType: 'major', newVersion: '6.0.0' })]

      expect(evaluateAutoMergeForUpdates(updates, [], makeConfig(['patch-only'])).eligible).toBe(false)
    })

    it('failure case - respects the opt-out label at creation time', () => {
      const decision = evaluateAutoMergeForUpdates([makeUpdate()], ['no-auto-merge'], makeConfig(['patch-only']))

      expect(decision.eligible).toBe(false)
    })
  })
})
