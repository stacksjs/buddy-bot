import type {
  EcosystemAdapter,
  EcosystemDependency,
  EcosystemUpdate,
  LatestOptions,
  VersionInfo,
} from './types'
import { fetchWithTimeout } from '../utils/http'
import { compareNumeric, detectFiles, escapeRegex, numericUpdateType, regenerateWith } from './shared'

/** Cargo tables that hold dependencies, and what to call them. */
const DEPENDENCY_TABLES: Array<[RegExp, string]> = [
  [/^\[dependencies\]/m, 'dependencies'],
  [/^\[dev-dependencies\]/m, 'devDependencies'],
  [/^\[build-dependencies\]/m, 'buildDependencies'],
  [/^\[workspace\.dependencies\]/m, 'workspaceDependencies'],
]

interface CratesResponse {
  crate?: {
    max_stable_version?: string
    newest_version?: string
    homepage?: string
    repository?: string
  }
  versions?: Array<{ num: string, created_at?: string, yanked?: boolean }>
}

/**
 * Rust crates, from `Cargo.toml`.
 *
 * Cargo's default caret semantics match semver closely enough that the shared
 * numeric comparator is correct here, unlike Python.
 */
export const rustAdapter: EcosystemAdapter = {
  name: 'rust',
  manifestPatterns: ['Cargo.toml'],

  async detect(dir: string): Promise<string[]> {
    return detectFiles(dir, this.manifestPatterns)
  },

  async parse(file: string, content: string): Promise<EcosystemDependency[]> {
    const dependencies: EcosystemDependency[] = []

    for (const [heading, section] of DEPENDENCY_TABLES) {
      const match = heading.exec(content)
      if (!match)
        continue

      const start = match.index + match[0].length
      const nextTable = content.slice(start).search(/\n\[/)
      const body = nextTable === -1 ? content.slice(start) : content.slice(start, start + nextTable)

      for (const entry of body.matchAll(/^\s*([\w-]+)\s*=\s*(.+)$/gm)) {
        const name = entry[1]
        const value = entry[2].trim()

        // `{ version = "1.0", features = [...] }` or a bare `"1.0"`.
        const inline = /version\s*=\s*["']([^"']+)["']/.exec(value)
        const plain = /^["']([^"']+)["']/.exec(value)
        const version = inline?.[1] ?? plain?.[1]

        // A path or git dependency has no registry version to update; leaving
        // it alone is the only correct behaviour.
        if (!version || /\b(?:path|git)\s*=/.test(value))
          continue

        dependencies.push({ name, currentVersion: version, section, file })
      }
    }

    return dependencies
  },

  async latest(dependency: EcosystemDependency, options: LatestOptions = {}): Promise<VersionInfo | null> {
    const base = options.registryUrl ?? 'https://crates.io'
    const response = await fetchWithTimeout(
      `${base}/api/v1/crates/${encodeURIComponent(dependency.name)}`,
      { headers: { 'User-Agent': 'buddy-bot (https://buddy-bot.sh)', 'Accept': 'application/json' } },
    ).catch(() => null)

    if (!response?.ok)
      return null

    const body = await response.json().catch(() => null) as CratesResponse | null
    if (!body?.crate)
      return null

    // `max_stable_version` already excludes pre-releases; `newest_version`
    // does not, which is exactly the opt-in distinction.
    const latest = options.includePrerelease
      ? body.crate.newest_version ?? body.crate.max_stable_version
      : body.crate.max_stable_version ?? body.crate.newest_version

    if (!latest)
      return null

    const version = body.versions?.find(entry => entry.num === latest)

    // A yanked crate is one the author withdrew; proposing it would move a
    // repository onto a version its author asked people not to use.
    if (version?.yanked)
      return null

    return {
      latest,
      ...(version?.created_at ? { publishedAt: new Date(version.created_at) } : {}),
      ...(body.crate.repository ? { releaseNotesUrl: `${body.crate.repository}/releases` } : {}),
      ...(body.crate.homepage ? { homepage: body.crate.homepage } : {}),
    }
  },

  applyUpdate(content: string, update: EcosystemUpdate): string {
    const name = escapeRegex(update.name)
    const current = escapeRegex(update.currentVersion)

    return content
      // name = "1.0"
      .replace(
        new RegExp(`^(\\s*${name}\\s*=\\s*["'])${current}(["'])`, 'gm'),
        `$1${update.newVersion}$2`,
      )
      // name = { version = "1.0", … }
      .replace(
        new RegExp(`^(\\s*${name}\\s*=\\s*\\{[^}]*?version\\s*=\\s*["'])${current}(["'])`, 'gm'),
        `$1${update.newVersion}$2`,
      )
  },

  async postWrite(dir: string): Promise<{ regenerated: string[], note?: string }> {
    return regenerateWith(dir, [{ lockfile: 'Cargo.lock', command: ['cargo', 'update', '--workspace'] }])
  },

  osvEcosystem: 'crates.io',
  compareVersions: compareNumeric,
  updateType: numericUpdateType,
}
