import type { PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import {
  hasManifest,
  manifestFiles,
  manifestUpdates,
  MANIFEST_MAX_LENGTH,
  MANIFEST_SCHEMA_VERSION,
  parseManifest,
  serializeManifest,
  stripManifest,
  withManifest,
} from '../src/pr/pr-manifest'

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'typescript',
    currentVersion: '^5.8.2',
    newVersion: '^5.8.3',
    updateType: 'patch',
    dependencyType: 'devDependencies',
    file: 'package.json',
    ...overrides,
  }
}

describe('pr-manifest', () => {
  describe('serializeManifest', () => {
    it('success case - round-trips a single update', () => {
      const body = `Some body${serializeManifest([makeUpdate()])}`
      const manifest = parseManifest(body)

      expect(manifest).not.toBeNull()
      expect(manifest?.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
      expect(manifest?.updates).toHaveLength(1)
      expect(manifest?.updates[0]).toMatchObject({
        name: 'typescript',
        current: '^5.8.2',
        target: '^5.8.3',
        type: 'patch',
        file: 'package.json',
        dependencyType: 'devDependencies',
      })
    })

    it('success case - round-trips every supported ecosystem', () => {
      const updates = [
        makeUpdate({ name: 'lodash', file: 'package.json', dependencyType: 'dependencies' }),
        makeUpdate({ name: 'laravel/framework', file: 'composer.json', dependencyType: 'require' }),
        makeUpdate({ name: 'actions/checkout', file: '.github/workflows/ci.yml', dependencyType: 'github-actions' }),
        makeUpdate({ name: 'node', file: 'Dockerfile', dependencyType: 'docker-image' }),
        makeUpdate({ name: 'bun.com', file: 'deps.yaml', dependencyType: 'dependencies' }),
        makeUpdate({ name: 'zigimg', file: 'build.zig.zon', dependencyType: 'zig-dependencies' }),
      ]

      const manifest = parseManifest(serializeManifest(updates))

      expect(manifest?.updates.map(u => u.name)).toEqual([
        'lodash',
        'laravel/framework',
        'actions/checkout',
        'node',
        'bun.com',
        'zigimg',
      ])
      expect(manifestFiles(manifest!)).toEqual([
        'package.json',
        'composer.json',
        '.github/workflows/ci.yml',
        'Dockerfile',
        'deps.yaml',
        'build.zig.zon',
      ])
    })

    it('success case - records optional group metadata', () => {
      const manifest = parseManifest(
        serializeManifest([makeUpdate()], { group: 'Non-Major Updates', strategy: 'all', branch: 'buddy-bot/update-x' }),
      )

      expect(manifest?.group).toBe('Non-Major Updates')
      expect(manifest?.strategy).toBe('all')
      expect(manifest?.branch).toBe('buddy-bot/update-x')
      expect(manifest?.generatedAt).toBeDefined()
    })

    it('edge case - serializes an empty update list', () => {
      const manifest = parseManifest(serializeManifest([]))

      expect(manifest).not.toBeNull()
      expect(manifest?.updates).toEqual([])
    })
  })

  describe('parseManifest', () => {
    it('failure case - returns null for a legacy body with no manifest', () => {
      const legacy = '| [typescript](https://x) | `^5.8.2` -> `^5.8.3` |\n\n - [ ] <!-- rebase-check -->'

      expect(parseManifest(legacy)).toBeNull()
      expect(hasManifest(legacy)).toBe(false)
    })

    it('failure case - returns null for malformed JSON instead of throwing', () => {
      const broken = 'body\n\n<!-- buddy-bot:manifest v1\n{ "updates": [ }\n-->'

      expect(() => parseManifest(broken)).not.toThrow()
      expect(parseManifest(broken)).toBeNull()
    })

    it('failure case - returns null for a truncated manifest with no closing marker', () => {
      const truncated = `body\n\n<!-- buddy-bot:manifest v1\n{"schemaVersion":1,"updates":[`

      expect(parseManifest(truncated)).toBeNull()
    })

    it('failure case - returns null for JSON without an updates array', () => {
      const wrongShape = 'body\n\n<!-- buddy-bot:manifest v1\n{"schemaVersion":1}\n-->'

      expect(parseManifest(wrongShape)).toBeNull()
    })

    it('edge case - handles null and empty bodies', () => {
      expect(parseManifest(null)).toBeNull()
      expect(parseManifest(undefined)).toBeNull()
      expect(parseManifest('')).toBeNull()
    })

    it('edge case - drops malformed entries but keeps valid ones', () => {
      const mixed = 'body\n\n<!-- buddy-bot:manifest v1\n{"schemaVersion":1,"updates":[{"name":"ok","current":"1.0.0","target":"1.0.1"},{"name":42}]}\n-->'

      const manifest = parseManifest(mixed)

      expect(manifest?.updates).toHaveLength(1)
      expect(manifest?.updates[0].name).toBe('ok')
    })

    it('edge case - preserves unknown fields from a future schema version', () => {
      const future = 'body\n\n<!-- buddy-bot:manifest v2\n{"schemaVersion":2,"updates":[{"name":"a","current":"1","target":"2"}],"futureField":"kept"}\n-->'

      const manifest = parseManifest(future) as any

      expect(manifest.schemaVersion).toBe(2)
      expect(manifest.futureField).toBe('kept')
    })

    it('edge case - reads the manifest when other HTML comments are present', () => {
      const body = `<!-- rebase-check -->\ntext${serializeManifest([makeUpdate()])}\n<!-- trailing comment -->`

      expect(parseManifest(body)?.updates).toHaveLength(1)
    })
  })

  describe('stripManifest / withManifest', () => {
    it('success case - strips the manifest back to the original body', () => {
      const original = 'PR body content'

      expect(stripManifest(`${original}${serializeManifest([makeUpdate()])}`)).toBe(original)
    })

    it('success case - replaces rather than stacks manifests across rebases', () => {
      let body = `content${serializeManifest([makeUpdate()])}`
      body = withManifest(body, [makeUpdate({ newVersion: '^5.9.0' })])

      expect(body.match(/buddy-bot:manifest/g)).toHaveLength(1)
      expect(parseManifest(body)?.updates[0].target).toBe('^5.9.0')
    })

    it('edge case - stripping a body without a manifest is a no-op', () => {
      expect(stripManifest('plain body')).toBe('plain body')
    })
  })

  describe('manifestUpdates', () => {
    it('success case - projects onto the rebase update shape', () => {
      const manifest = parseManifest(serializeManifest([makeUpdate()]))!

      expect(manifestUpdates(manifest)).toEqual([
        { name: 'typescript', currentVersion: '^5.8.2', newVersion: '^5.8.3' },
      ])
    })
  })

  describe('body size budget', () => {
    it('edge case - stays compact enough for the generator to reserve space', () => {
      const updates = Array.from({ length: 50 }, (_, i) => makeUpdate({ name: `package-number-${i}` }))
      const serialized = serializeManifest(updates)

      // The generator reserves the manifest's length out of its truncation
      // budget, so the only requirement here is that per-update cost stays
      // small — a manifest that grew to kilobytes per entry would starve the
      // release notes.
      expect(serialized.length / updates.length).toBeLessThan(200)
      expect(parseManifest(serialized)?.updates).toHaveLength(50)
    })

    it('edge case - sheds optional fields before exceeding the size ceiling', () => {
      // Sized so the full encoding overflows the ceiling but the reduced one
      // still fits, which is exactly the case field-shedding exists for.
      const updates = Array.from({ length: 200 }, (_, i) => makeUpdate({
        name: `@scope/a-fairly-long-package-name-${i}`,
        file: `packages/workspace-number-${i}/package.json`,
      }))

      const serialized = serializeManifest(updates)
      const manifest = parseManifest(serialized)

      expect(serialized.length).toBeLessThanOrEqual(MANIFEST_MAX_LENGTH)
      // All rows survive; only `type` and `dependencyType` are dropped.
      expect(manifest?.updates).toHaveLength(200)
      expect(manifest?.truncated).toBeUndefined()
      expect(manifest?.updates[0].type).toBeUndefined()
      expect(manifest?.updates[0].name).toBe('@scope/a-fairly-long-package-name-0')
    })

    it('edge case - truncates rows and flags it when even minimal fields overflow', () => {
      const updates = Array.from({ length: 2000 }, (_, i) => makeUpdate({
        name: `@scope/a-fairly-long-package-name-${i}`,
        file: `packages/workspace-number-${i}/package.json`,
      }))

      const serialized = serializeManifest(updates)
      const manifest = parseManifest(serialized)

      expect(serialized.length).toBeLessThanOrEqual(MANIFEST_MAX_LENGTH)
      expect(manifest?.truncated).toBe(true)
      expect(manifest?.updates.length).toBeGreaterThan(0)
      expect(manifest?.updates.length).toBeLessThan(2000)
    })
  })
})
