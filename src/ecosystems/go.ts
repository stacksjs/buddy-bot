import type {
  EcosystemAdapter,
  EcosystemDependency,
  EcosystemUpdate,
  LatestOptions,
  VersionInfo,
} from './types'
import { fetchWithTimeout } from '../utils/http'
import { compareNumeric, detectFiles, escapeRegex, numericUpdateType, regenerateWith } from './shared'

/** `example.com/mod/v2 v2.1.0` inside a require block or on a require line. */
const REQUIRE_LINE = /^\s*(?:require\s+)?([\w.~-]+(?:\.[\w.~-]+)*\/[^\s]+)\s+(v[\w.+-]+)\s*(\/\/.*)?$/

/**
 * A Go pseudo-version: `v0.0.0-20230101120000-abcdef123456`.
 *
 * These name an untagged commit. Proposing an update from one is a judgement
 * about which commit to move to, not a version bump, so they are left alone.
 */
const PSEUDO_VERSION = /^v\d+\.\d+\.\d+-\d{14}-[a-f0-9]{12}$/

/**
 * Go modules, from `go.mod`.
 *
 * The major-version suffix (`/v2`) is part of the module path, so a v1→v2
 * upgrade means editing the path as well as the version — which is a source
 * change, not a dependency bump. This adapter proposes updates within a major
 * version and leaves the path alone.
 */
export const goAdapter: EcosystemAdapter = {
  name: 'go',
  manifestPatterns: ['go.mod'],

  async detect(dir: string): Promise<string[]> {
    return detectFiles(dir, this.manifestPatterns)
  },

  async parse(file: string, content: string): Promise<EcosystemDependency[]> {
    const dependencies: EcosystemDependency[] = []
    let inRequireBlock = false

    for (const line of content.split('\n')) {
      const trimmed = line.trim()

      if (/^require\s*\($/.test(trimmed)) {
        inRequireBlock = true
        continue
      }
      if (inRequireBlock && trimmed === ')') {
        inRequireBlock = false
        continue
      }
      if (!inRequireBlock && !trimmed.startsWith('require '))
        continue

      const match = REQUIRE_LINE.exec(line)
      if (!match)
        continue

      const [, name, version, comment] = match

      // An indirect dependency is one the module graph pulled in; updating it
      // directly is `go mod tidy`'s job, not a manifest edit's.
      if (comment?.includes('indirect'))
        continue

      if (PSEUDO_VERSION.test(version))
        continue

      dependencies.push({ name, currentVersion: version, section: 'require', file })
    }

    return dependencies
  },

  async latest(dependency: EcosystemDependency, options: LatestOptions = {}): Promise<VersionInfo | null> {
    const base = options.registryUrl ?? 'https://proxy.golang.org'
    // The proxy lower-cases module paths, encoding upper-case letters as `!x`.
    const encoded = dependency.name.replace(/[A-Z]/g, letter => `!${letter.toLowerCase()}`)

    const response = await fetchWithTimeout(
      `${base}/${encoded}/@latest`,
      { headers: { 'User-Agent': 'buddy-bot', 'Accept': 'application/json' } },
    ).catch(() => null)

    if (!response?.ok)
      return null

    const body = await response.json().catch(() => null) as { Version?: string, Time?: string } | null
    if (!body?.Version)
      return null

    // The proxy's `@latest` can be a pseudo-version for a module with no tags.
    // Proposing one would replace a tagged version with a commit hash.
    if (PSEUDO_VERSION.test(body.Version))
      return null

    return {
      latest: body.Version,
      ...(body.Time ? { publishedAt: new Date(body.Time) } : {}),
      releaseNotesUrl: `https://pkg.go.dev/${dependency.name}@${body.Version}`,
      homepage: `https://pkg.go.dev/${dependency.name}`,
    }
  },

  applyUpdate(content: string, update: EcosystemUpdate): string {
    const name = escapeRegex(update.name)
    const current = escapeRegex(update.currentVersion)

    // Anchored on the module path so a shorter path that is a prefix of a
    // longer one cannot match the wrong line.
    return content.replace(
      new RegExp(`^(\\s*(?:require\\s+)?${name}\\s+)${current}(\\s|$)`, 'gm'),
      `$1${update.newVersion}$2`,
    )
  },

  async postWrite(dir: string): Promise<{ regenerated: string[], note?: string }> {
    return regenerateWith(dir, [{ lockfile: 'go.sum', command: ['go', 'mod', 'tidy'] }])
  },

  osvEcosystem: 'Go',
  compareVersions: compareNumeric,
  updateType: numericUpdateType,
}
