import type { BuddyBotConfig } from './src/types'

const config: BuddyBotConfig = {
  verbose: true,
  packages: {
    strategy: 'all',
    ignore: ['@types/bun'], // Example ignore (restored)
  },

  // Repository settings for PR creation
  repository: {
    provider: 'github',
    owner: 'stacksjs',
    name: 'buddy-bot',
    baseBranch: 'main',
  },

  // Pull request configuration
  pullRequest: {
    reviewers: [],
    labels: ['dependencies'],
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: ['patch-only'],
    },
  },

  // Workflow generation settings
  workflows: {
    enabled: true,
    outputDir: '.github/workflows',
    templates: {
      comprehensive: true,
      daily: true,
      weekly: true,
      monthly: true,
      docker: false, // Disable Docker workflow
      monorepo: false, // Disable monorepo workflow
    },
    custom: [
      {
        name: 'Security Updates',
        schedule: '0 6 * * *', // 6 AM daily
        strategy: 'patch',
        autoMerge: true,
        labels: ['security', 'dependencies'],
      },
    ],
  },

  // Scheduling (uncomment to enable automated runs)
  // schedule: {
  //   cron: '0 2 * * 1', // Monday 2 AM
  //   timezone: 'America/New_York',
  // }
}

export default config
