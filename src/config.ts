import type { BuddyBotConfig } from './types'
import process from 'node:process'
import { loadConfig } from 'bunfig'
import { resolveRepositoryConfig } from './utils/repository'

export const defaultConfig: BuddyBotConfig = {
  verbose: true,
  repository: {
    owner: '',
    name: '',
    provider: 'github',
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
      console.warn(`⚠️ ${resolution.warning}`)

    _config = loaded
  }
  return _config
}

// For backwards compatibility - synchronous access with default fallback
export const config: BuddyBotConfig = defaultConfig
