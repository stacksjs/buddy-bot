import type { BuddyBotConfig } from './types'
import process from 'node:process'
import { loadConfig } from 'bunfig'
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

export async function getConfig(): Promise<BuddyBotConfig> {
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
