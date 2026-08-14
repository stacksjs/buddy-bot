import type { PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { Buddy } from '../src/buddy'
import { serializeManifest } from '../src/pr/pr-manifest'
import { extractPackageNamesFromPRBody } from '../src/utils/helpers'

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

/**
 * A body in the pre-manifest format, kept verbatim so the fallback path stays
 * covered after the manifest becomes the primary source.
 */
const LEGACY_BODY = `## 📦 npm Dependencies

| Package | Change | Age | Adoption | Passing | Confidence |
|---|---|---|---|---|---|
| [typescript](https://www.typescriptlang.org/) | \`^5.8.2\` -> \`^5.8.3\` | 📅 | 📈 | ✅ | 🔒 |
| [lodash](https://lodash.com/) | \`^4.17.20\` -> \`^4.17.21\` | 📅 | 📈 | ✅ | 🔒 |

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box`

describe('manifest-first PR body consumers', () => {
  describe('extractPackageNamesFromPRBody', () => {
    it('success case - reads names from the manifest', () => {
      const body = `irrelevant prose${serializeManifest([
        makeUpdate(),
        makeUpdate({ name: '@types/node' }),
      ])}`

      expect(extractPackageNamesFromPRBody(body)).toEqual(['typescript', '@types/node'])
    })

    it('success case - falls back to table scraping for legacy bodies', () => {
      // The legacy scraper walks non-overlapping four-cell chunks, so on the
      // six-column npm table its row boundaries drift and it silently drops
      // packages — the misparse the manifest exists to eliminate. Asserted as
      // it actually behaves so the fallback stays honest about its limits.
      expect(extractPackageNamesFromPRBody(LEGACY_BODY)).toEqual(['lodash'])
    })

    it('success case - the manifest recovers packages the legacy scraper missed', () => {
      const body = `${LEGACY_BODY}${serializeManifest([
        makeUpdate(),
        makeUpdate({ name: 'lodash', currentVersion: '^4.17.20', newVersion: '^4.17.21' }),
      ])}`

      expect(extractPackageNamesFromPRBody(body)).toEqual(['typescript', 'lodash'])
    })

    it('edge case - deduplicates a package listed in several manifest rows', () => {
      const body = serializeManifest([
        makeUpdate({ file: 'package.json' }),
        makeUpdate({ file: 'packages/app/package.json' }),
      ])

      expect(extractPackageNamesFromPRBody(body)).toEqual(['typescript'])
    })
  })

  describe('Buddy body extraction', () => {
    const buddy = new Buddy({ verbose: false }) as any

    it('success case - reads updates from the manifest', () => {
      const body = `prose${serializeManifest([makeUpdate()])}`

      expect(buddy.extractPackageUpdatesFromPRBody(body)).toEqual([
        { name: 'typescript', currentVersion: '^5.8.2', newVersion: '^5.8.3' },
      ])
    })

    it('success case - falls back to table scraping for legacy bodies', () => {
      const updates = buddy.extractPackageUpdatesFromPRBody(LEGACY_BODY)

      expect(updates).toHaveLength(2)
      expect(updates[0]).toEqual({ name: 'typescript', currentVersion: '5.8.2', newVersion: '5.8.3' })
    })

    it('success case - reads file paths from the manifest', () => {
      const body = serializeManifest([
        makeUpdate({ file: 'package.json' }),
        makeUpdate({ name: 'laravel/framework', file: 'composer.json' }),
      ])

      expect(buddy.extractFilePathsFromPRBody(body)).toEqual(['package.json', 'composer.json'])
    })

    it('edge case - a manifest survives prose that would confuse the regex', () => {
      // Release-notes prose containing an arrow and backticks used to be
      // scraped as a bogus update row.
      const body = `### Release Notes\n\nRenamed \`old\` -> \`new\` in the API.${serializeManifest([makeUpdate()])}`

      expect(buddy.extractPackageUpdatesFromPRBody(body)).toEqual([
        { name: 'typescript', currentVersion: '^5.8.2', newVersion: '^5.8.3' },
      ])
    })
  })
})
