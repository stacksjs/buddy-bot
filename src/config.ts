import type { BuddyBotConfig } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { deepMerge, loadConfig } from 'bunfig'
import { assertValidConfig } from './config-validation'
import { getDefaultLogger } from './utils/logger'
import { resolveRepositoryConfig } from './utils/repository'

export const defaultConfig: BuddyBotConfig = {
  verbose: true,
  repository: {
    owner: '',
    name: '',
    provider: 'github',
  },
  security: {
    enabled: true,
    prioritize: true,
    label: 'security',
    minimumSeverity: 'low',
  },
  dashboard: {
    enabled: false,
    title: 'Dependency Dashboard',
  },
  workflows: {
    enabled: false,
    outputDir: '.github/workflows',
    templates: {
      daily: false,
      weekly: false,
      monthly: false,
    },
    custom: [],
  },
  packages: {
    strategy: 'all',
    ignore: [],
    ignorePaths: [],
    pin: {},
    groups: [],
    includePrerelease: false,
    excludeMajor: false,
    respectLatest: true,
    minimumReleaseAge: 0,
    minimumReleaseAgeExclude: [],
  },
}

// Lazy-loaded config to avoid top-level await (enables bun --compile)
let _config: BuddyBotConfig | null = null

/**
 * Load one specific config file, merged over the defaults.
 *
 * bunfig discovers config by name; a `--config` path names an exact file
 * instead, so it is imported directly. JSON is parsed, and TypeScript and
 * JavaScript modules are imported for their default (or named `config`) export.
 *
 * @param configPath - Path to the config file, relative or absolute
 * @returns The merged configuration
 * @throws {Error} When the file is missing or exports no object
 */
async function loadConfigFile(configPath: string): Promise<BuddyBotConfig> {
  const absolute = resolve(configPath)

  const file = Bun.file(absolute)
  if (!(await file.exists()))
    throw new Error(`Config file not found: ${absolute}`)

  let loaded: unknown
  if (absolute.endsWith('.json')) {
    loaded = await file.json()
  }
  else {
    const module = await import(absolute)
    loaded = module.default ?? module.config
  }

  if (typeof loaded !== 'object' || loaded === null)
    throw new Error(`Config file ${absolute} does not export a configuration object`)

  return deepMerge(defaultConfig, loaded as Partial<BuddyBotConfig>) as BuddyBotConfig
}

/**
 * Load and validate the buddy-bot configuration.
 *
 * The result is memoized so repeated calls within a run see one config. An
 * explicit `configPath` bypasses the cache, since a caller naming a file is
 * asking for that file rather than whatever was loaded earlier.
 *
 * @param configPath - Path to a specific config file, overriding discovery
 * @returns The validated configuration
 * @throws {Error} When the configuration fails validation
 */
export async function getConfig(configPath?: string): Promise<BuddyBotConfig> {
  if (configPath) {
    const loaded = await loadConfigFile(configPath)

    const resolution = resolveRepositoryConfig(loaded)
    if (resolution.warning)
      getDefaultLogger().warn(`⚠️ ${resolution.warning}`)

    assertValidConfig(loaded)
    return loaded
  }

  if (!_config) {
    const loaded = await loadConfig({
      name: 'buddy-bot',
      cwd: process.cwd(),
      defaultConfig,
    })

    // Reconcile the configured repository with GITHUB_REPOSITORY before any
    // consumer reads it, so the CLI and Buddy always agree on the target repo.
    const resolution = resolveRepositoryConfig(loaded)
    if (resolution.warning)
      getDefaultLogger().warn(`⚠️ ${resolution.warning}`)

    // Fail before any network or git work happens. A malformed strategy or a
    // group with no patterns otherwise produces a run that silently does the
    // wrong thing and reports success.
    assertValidConfig(loaded)

    _config = loaded
  }
  return _config
}

/**
 * Reset the memoized configuration.
 *
 * Only useful in tests, which load different fixtures from the same process.
 */
export function resetConfigCache(): void {
  _config = null
}

// For backwards compatibility - synchronous access with default fallback
export const config: BuddyBotConfig = defaultConfig
