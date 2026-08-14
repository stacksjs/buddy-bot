import type {
  EcosystemAdapter,
  EcosystemDependency,
  EcosystemUpdate,
  LatestOptions,
  VersionInfo,
} from './types'
import { fetchWithTimeout } from '../utils/http'
import { compareNumeric, detectFiles, escapeRegex, numericUpdateType, regenerateWith } from './shared'

/** `gem 'rails', '~> 7.0'` — the name and its first version constraint. */
const GEM_LINE = /^\s*gem\s+["']([\w-]+)["']\s*(?:,\s*["']([^"']+)["'])?/

/**
 * Which `group` a gem line sits inside, when the file uses blocks.
 *
 * The group names are captured lazily up to the trailing `do`, which has to be
 * matched as a word — a character class excluding `d` would fail on every
 * group whose name contains one, `:development` included.
 */
const GROUP_OPEN = /^\s*group\s+(.+?)\s+do\s*$/
const BLOCK_END = /^\s*end\s*$/

/**
 * Ruby gems, from a `Gemfile`.
 *
 * The pessimistic operator (`~>`) is preserved on write: it is the whole of a
 * Gemfile's version policy, and replacing it with an exact version would turn
 * a deliberately flexible constraint into a pin.
 */
export const rubyAdapter: EcosystemAdapter = {
  name: 'ruby',
  manifestPatterns: ['Gemfile', '*.gemspec'],

  async detect(dir: string): Promise<string[]> {
    return detectFiles(dir, this.manifestPatterns)
  },

  async parse(file: string, content: string): Promise<EcosystemDependency[]> {
    const dependencies: EcosystemDependency[] = []
    const groups: string[] = []

    for (const line of content.split('\n')) {
      // Comments first: a commented-out gem line is not a dependency.
      const withoutComment = line.replace(/#.*$/, '')

      const groupOpen = GROUP_OPEN.exec(withoutComment)
      if (groupOpen) {
        groups.push(groupOpen[1].replace(/[:'",\s]/g, '') || 'default')
        continue
      }

      if (BLOCK_END.test(withoutComment)) {
        groups.pop()
        continue
      }

      const match = GEM_LINE.exec(withoutComment)
      if (!match?.[1])
        continue

      // A gem with no constraint floats to whatever bundler resolves; there is
      // no version in the file to update.
      if (!match[2])
        continue

      // Path and git gems are not from RubyGems.
      if (/\b(?:path|git|github|branch):/.test(withoutComment))
        continue

      dependencies.push({
        name: match[1],
        currentVersion: match[2],
        section: groups.length > 0 ? groups[groups.length - 1] : 'dependencies',
        file,
      })
    }

    return dependencies
  },

  async latest(dependency: EcosystemDependency, options: LatestOptions = {}): Promise<VersionInfo | null> {
    const base = options.registryUrl ?? 'https://rubygems.org'
    const response = await fetchWithTimeout(
      `${base}/api/v1/versions/${encodeURIComponent(dependency.name)}.json`,
      { headers: { 'User-Agent': 'buddy-bot', 'Accept': 'application/json' } },
    ).catch(() => null)

    if (!response?.ok)
      return null

    const versions = await response.json().catch(() => null) as Array<{
      number?: string
      created_at?: string
      prerelease?: boolean
      yanked?: boolean
    }> | null

    if (!Array.isArray(versions) || versions.length === 0)
      return null

    const usable = versions
      .filter(entry => entry.number && !entry.yanked)
      .filter(entry => options.includePrerelease ? true : !entry.prerelease)
      .sort((a, b) => compareNumeric(a.number!, b.number!))

    const newest = usable[usable.length - 1]
    if (!newest?.number)
      return null

    return {
      latest: newest.number,
      ...(newest.created_at ? { publishedAt: new Date(newest.created_at) } : {}),
      homepage: `${base}/gems/${dependency.name}`,
    }
  },

  applyUpdate(content: string, update: EcosystemUpdate): string {
    const name = escapeRegex(update.name)
    const current = escapeRegex(update.currentVersion)

    // The operator is carried across from the current constraint, so `~> 7.0`
    // becomes `~> 7.1` rather than a bare pin.
    const operator = /^\s*(~>|>=|<=|>|<|=)?\s*/.exec(update.currentVersion)?.[1] ?? ''
    const replacement = operator ? `${operator} ${update.newVersion}` : update.newVersion

    return content.replace(
      new RegExp(`^(\\s*gem\\s+["']${name}["']\\s*,\\s*["'])${current}(["'])`, 'gm'),
      `$1${replacement}$2`,
    )
  },

  async postWrite(dir: string): Promise<{ regenerated: string[], note?: string }> {
    return regenerateWith(dir, [{ lockfile: 'Gemfile.lock', command: ['bundle', 'lock', '--update'] }])
  },

  osvEcosystem: 'RubyGems',
  compareVersions: compareNumeric,
  updateType: numericUpdateType,
}
