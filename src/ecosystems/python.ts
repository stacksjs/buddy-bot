import type {
  EcosystemAdapter,
  EcosystemDependency,
  EcosystemUpdate,
  LatestOptions,
  VersionInfo,
} from './types'
import { fetchWithTimeout } from '../utils/http'
import { comparePep440, isPep440Prerelease, pep440UpdateType, splitConstraint } from './pep440'
import { detectFiles, escapeRegex, regenerateWith } from './shared'

/** `name >= 1.2` / `name[extra]~=1.4` / `name==1.0 ; python_version<"3.9"`. */
const REQUIREMENT = /^\s*([A-Z0-9][\w.-]*)\s*(\[[^\]]*\])?\s*([<>=!~^].*?)?\s*(?:;.*)?$/i

/** Lines in a requirements file that are directives rather than requirements. */
const DIRECTIVE = /^\s*(?:-|#|$)/

/**
 * Parse a `requirements.txt`-style file.
 *
 * Directive lines (`-r`, `-e`, `--index-url`) are skipped rather than parsed:
 * they name files and flags, not packages, and a `-e .` treated as a package
 * would produce an update proposal against the project itself.
 */
function parseRequirements(file: string, content: string): EcosystemDependency[] {
  const dependencies: EcosystemDependency[] = []

  content.split('\n').forEach((line) => {
    const withoutComment = line.split('#')[0]
    if (DIRECTIVE.test(withoutComment))
      return

    const match = REQUIREMENT.exec(withoutComment)
    if (!match?.[1] || !match[3])
      return

    dependencies.push({
      name: match[1],
      currentVersion: match[3].trim(),
      section: 'dependencies',
      file,
      ...(match[2] ? { metadata: { extras: match[2] } } : {}),
    })
  })

  return dependencies
}

/** Sections of a `pyproject.toml` that hold dependency lists. */
const PYPROJECT_ARRAYS: Array<[RegExp, string]> = [
  [/^\s*dependencies\s*=\s*\[/m, 'dependencies'],
  [/^\s*(?:dev-dependencies|dev)\s*=\s*\[/m, 'devDependencies'],
]

/**
 * Parse a `pyproject.toml`.
 *
 * Handles the two shapes in practice: PEP 621 / uv string arrays, and Poetry's
 * `[tool.poetry.dependencies]` table. Deliberately regex-based rather than a
 * full TOML parse, because the write path has to preserve the file's exact
 * formatting and a parse/serialize round-trip would not.
 */
function parsePyproject(file: string, content: string): EcosystemDependency[] {
  const dependencies: EcosystemDependency[] = []
  const seen = new Set<string>()

  const add = (name: string, version: string, section: string): void => {
    const key = `${section}:${name}`
    if (!version.trim() || version.trim() === '*' || seen.has(key))
      return
    seen.add(key)
    dependencies.push({ name, currentVersion: version.trim(), section, file })
  }

  // PEP 621 and uv: string arrays of requirement specifiers.
  for (const [heading, section] of PYPROJECT_ARRAYS) {
    const match = heading.exec(content)
    if (!match)
      continue

    const start = match.index + match[0].length
    const end = content.indexOf(']', start)
    if (end === -1)
      continue

    for (const entry of content.slice(start, end).matchAll(/["']([^"']+)["']/g)) {
      const requirement = REQUIREMENT.exec(entry[1])
      if (requirement?.[1] && requirement[3])
        add(requirement[1], requirement[3], section)
    }
  }

  // Poetry: a table of name = "constraint" or name = { version = "..." }.
  const poetryTables = content.matchAll(
    /\[tool\.poetry\.(?:group\.[\w-]+\.)?(dependencies|dev-dependencies)\]([\s\S]*?)(?=\n\[|$)/g,
  )

  for (const table of poetryTables) {
    const section = table[1] === 'dependencies' ? 'dependencies' : 'devDependencies'

    for (const entry of table[2].matchAll(/^\s*([A-Z0-9][\w.-]*)\s*=\s*(.+)$/gim)) {
      const name = entry[1]
      // Poetry's own marker for the interpreter, not a package.
      if (name.toLowerCase() === 'python')
        continue

      const value = entry[2].trim()
      const inline = /version\s*=\s*["']([^"']+)["']/.exec(value)
      const plain = /^["']([^"']+)["']/.exec(value)

      const version = inline?.[1] ?? plain?.[1]
      if (version)
        add(name, version, section)
    }
  }

  return dependencies
}

interface PypiResponse {
  info?: {
    version?: string
    yanked?: boolean
    home_page?: string
    project_urls?: Record<string, string>
  }
  releases?: Record<string, Array<{ upload_time_iso_8601?: string, yanked?: boolean }>>
}

/**
 * Python packages, from `pyproject.toml` and `requirements*.txt`.
 *
 * Versions are compared with PEP 440 rather than semver: `1.0.post1` is newer
 * than `1.0`, and treating Python versions as semver would keep proposing a
 * downgrade for every post-release on PyPI.
 */
export const pythonAdapter: EcosystemAdapter = {
  name: 'python',
  manifestPatterns: ['pyproject.toml', 'requirements.txt', 'requirements-*.txt', 'requirements/*.txt'],

  async detect(dir: string): Promise<string[]> {
    return detectFiles(dir, this.manifestPatterns)
  },

  async parse(file: string, content: string): Promise<EcosystemDependency[]> {
    return file.endsWith('.toml')
      ? parsePyproject(file, content)
      : parseRequirements(file, content)
  },

  async latest(dependency: EcosystemDependency, options: LatestOptions = {}): Promise<VersionInfo | null> {
    const base = options.registryUrl ?? 'https://pypi.org'
    const response = await fetchWithTimeout(
      `${base}/pypi/${encodeURIComponent(dependency.name)}/json`,
      { headers: { 'User-Agent': 'buddy-bot', 'Accept': 'application/json' } },
    ).catch(() => null)

    if (!response?.ok)
      return null

    const body = await response.json().catch(() => null) as PypiResponse | null
    if (!body?.info?.version)
      return null

    // PyPI's `info.version` skips pre-releases, so it is already what a caller
    // wants unless pre-releases were explicitly asked for.
    let latest = body.info.version

    if (options.includePrerelease && body.releases) {
      const candidates = Object.keys(body.releases)
        // A yanked release is one the maintainer withdrew; proposing it would
        // move a repository onto a version its author asked people not to use.
        .filter(version => !body.releases![version]?.every(file => file.yanked))
        .sort(comparePep440)

      latest = candidates[candidates.length - 1] ?? latest
    }

    const files = body.releases?.[latest]
    const uploaded = files?.find(file => file.upload_time_iso_8601)?.upload_time_iso_8601

    return {
      latest,
      ...(uploaded ? { publishedAt: new Date(uploaded) } : {}),
      ...(body.info.yanked ? { deprecated: true } : {}),
      ...(body.info.project_urls?.Changelog ? { releaseNotesUrl: body.info.project_urls.Changelog } : {}),
      ...(body.info.home_page ? { homepage: body.info.home_page } : {}),
    }
  },

  applyUpdate(content: string, update: EcosystemUpdate): string {
    const { operator } = splitConstraint(update.currentVersion)
    const name = escapeRegex(update.name)
    const current = escapeRegex(update.currentVersion)

    // The operator is preserved: `~=1.4` staying `~=` rather than becoming
    // `==` is the difference between a compatible-release pin and an exact one.
    // Any operator on the incoming version is stripped first, so a caller that
    // passes `^2.0` rather than `2.0` cannot produce `^^2.0`.
    const bare = splitConstraint(update.newVersion).version
    const replacement = operator ? `${operator}${bare}` : bare

    return content
      // requirements.txt and PEP 621 arrays: name followed by the constraint.
      .replace(
        new RegExp(`(^|["'\\s])(${name})(\\[[^\\]]*\\])?\\s*${current}`, 'gim'),
        (_, prefix, matchedName, extras) => `${prefix}${matchedName}${extras ?? ''}${replacement}`,
      )
      // Poetry tables: name = "constraint".
      .replace(
        new RegExp(`^(\\s*${name}\\s*=\\s*["'])${current}(["'])`, 'gim'),
        `$1${replacement}$2`,
      )
      // Poetry inline tables: name = { version = "constraint", … }.
      .replace(
        new RegExp(`^(\\s*${name}\\s*=\\s*\\{[^}]*version\\s*=\\s*["'])${current}(["'])`, 'gim'),
        `$1${replacement}$2`,
      )
  },

  async postWrite(dir: string): Promise<{ regenerated: string[], note?: string }> {
    return regenerateWith(dir, [
      { lockfile: 'uv.lock', command: ['uv', 'lock'] },
      { lockfile: 'poetry.lock', command: ['poetry', 'lock', '--no-update'] },
    ])
  },

  osvEcosystem: 'PyPI',
  compareVersions: comparePep440,
  updateType: pep440UpdateType,
}

/** Whether a version string is a Python pre-release. */
export { isPep440Prerelease }
