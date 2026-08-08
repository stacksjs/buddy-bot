import type { BuddyBotConfig } from '../types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/** Public GitHub API host, used when nothing else is configured. */
export const DEFAULT_GITHUB_API_URL = 'https://api.github.com'

/** Public GitHub web host, used for building human-facing links. */
export const DEFAULT_GITHUB_SERVER_URL = 'https://github.com'

/** Public npm registry host. */
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'

/** Public Packagist host. */
export const DEFAULT_COMPOSER_REGISTRY = 'https://packagist.org'

/** Strip trailing slashes so callers can always concatenate `/path` safely. */
function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function firstNonEmpty(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate && candidate.trim())
      return candidate
  }
  return undefined
}

/**
 * Resolve the GitHub REST API base URL.
 *
 * Precedence is explicit config, then `GITHUB_API_URL` — which GitHub Actions
 * sets automatically on both github.com and GitHub Enterprise Server runners —
 * then the public host. This is what lets buddy-bot run unmodified on GHES.
 *
 * @param config - Optional loaded configuration
 * @returns Base URL with no trailing slash, e.g. `https://github.acme.com/api/v3`
 */
export function getGitHubApiUrl(config?: BuddyBotConfig): string {
  return normalizeBase(firstNonEmpty(
    config?.repository?.apiUrl,
    process.env.GITHUB_API_URL,
    DEFAULT_GITHUB_API_URL,
  )!)
}

/**
 * Resolve the GitHub web base URL, used for links in PR bodies and dashboards.
 *
 * @param config - Optional loaded configuration
 * @returns Base URL with no trailing slash
 */
export function getGitHubServerUrl(config?: BuddyBotConfig): string {
  return normalizeBase(firstNonEmpty(
    config?.repository?.serverUrl,
    process.env.GITHUB_SERVER_URL,
    DEFAULT_GITHUB_SERVER_URL,
  )!)
}

interface NpmrcRegistries {
  default?: string
  scoped: Map<string, string>
}

/**
 * Locate the user's home directory the way npm does.
 *
 * npm resolves `~/.npmrc` through `$HOME` (or `%USERPROFILE%` on Windows)
 * rather than the passwd entry, so honouring those first keeps buddy-bot
 * reading the same file npm would — including under `sudo`, in containers, and
 * anywhere else the environment deliberately relocates home.
 */
function homeDirectory(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

const npmrcCache = new Map<string, NpmrcRegistries>()

/**
 * Parse the `registry=` and `@scope:registry=` directives out of the `.npmrc`
 * files that apply to a project, nearest file winning.
 *
 * Only registry directives are read — auth tokens and other settings are left
 * to the package manager, which buddy-bot shells out to for installs.
 */
function readNpmrcRegistries(cwd: string): NpmrcRegistries {
  const cached = npmrcCache.get(cwd)
  if (cached)
    return cached

  const result: NpmrcRegistries = { scoped: new Map() }
  // Home first so the project file overrides it.
  const candidates = [path.join(homeDirectory(), '.npmrc'), path.join(cwd, '.npmrc')]

  for (const file of candidates) {
    let content: string
    try {
      content = fs.readFileSync(file, 'utf-8')
    }
    catch {
      continue
    }

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || line.startsWith(';'))
        continue

      const separator = line.indexOf('=')
      if (separator === -1)
        continue

      const key = line.slice(0, separator).trim()
      const value = expandEnvRefs(line.slice(separator + 1).trim())
      if (!value)
        continue

      if (key === 'registry') {
        result.default = value
      }
      else if (key.endsWith(':registry') && key.startsWith('@')) {
        result.scoped.set(key.slice(0, -':registry'.length), value)
      }
    }
  }

  npmrcCache.set(cwd, result)
  return result
}

/** Expand npm's `${VAR}` interpolation so env-driven registries resolve. */
function expandEnvRefs(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? '')
}

/**
 * Clear the memoized `.npmrc` lookups. Exposed for tests, which write `.npmrc`
 * files into temporary directories between assertions.
 */
export function clearNpmrcCache(): void {
  npmrcCache.clear()
}

/**
 * Resolve the npm registry to query for a package.
 *
 * Precedence is explicit config, then `NPM_CONFIG_REGISTRY`, then a
 * scope-specific `.npmrc` entry, then the `.npmrc` default, then the public
 * registry. Scoped lookups matter for private packages: `@acme/ui` may live on
 * a different host than the rest of the tree.
 *
 * @param packageName - Package being resolved, used to match `@scope:registry`
 * @param config - Optional loaded configuration
 * @param cwd - Project directory whose `.npmrc` applies
 * @returns Base URL with no trailing slash
 * @example
 * ```ts
 * getNpmRegistryUrl('@acme/ui', config) // 'https://npm.acme.com'
 * getNpmRegistryUrl('react', config) // 'https://registry.npmjs.org'
 * ```
 */
export function getNpmRegistryUrl(
  packageName?: string,
  config?: BuddyBotConfig,
  cwd: string = process.cwd(),
): string {
  const scope = packageName?.startsWith('@') ? packageName.split('/')[0] : undefined
  const npmrc = readNpmrcRegistries(cwd)

  return normalizeBase(firstNonEmpty(
    scope ? config?.registries?.npmScopes?.[scope] : undefined,
    config?.registries?.npm,
    process.env.NPM_CONFIG_REGISTRY,
    scope ? npmrc.scoped.get(scope) : undefined,
    npmrc.default,
    DEFAULT_NPM_REGISTRY,
  )!)
}

/**
 * Resolve the Composer/Packagist base URL.
 *
 * @param config - Optional loaded configuration
 * @returns Base URL with no trailing slash
 */
export function getComposerRegistryUrl(config?: BuddyBotConfig): string {
  return normalizeBase(firstNonEmpty(
    config?.registries?.composer,
    process.env.COMPOSER_REGISTRY_URL,
    DEFAULT_COMPOSER_REGISTRY,
  )!)
}
