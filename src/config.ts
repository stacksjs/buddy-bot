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
  },
}

// eslint-disable-next-line antfu/no-top-level-await
export const config: BuddyBotConfig = await loadConfig({
  name: 'buddy-bot',
  cwd: process.cwd(),
  defaultConfig,
})
