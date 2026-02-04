import type { BuddyBotConfig } from './types'
import process from 'node:process'
import { loadConfig } from 'bunfig'

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
    _config = await loadConfig({
  name: 'buddy-bot',
  cwd: process.cwd(),
  defaultConfig,
})
  }
  return _config
}

// For backwards compatibility - synchronous access with default fallback
export const config: BuddyBotConfig = defaultConfig
