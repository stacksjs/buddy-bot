import type { BuddyBotConfig } from './src/types'

const config: BuddyBotConfig = {
  verbose: true,
  packages: {
    strategy: 'all',
    ignore: ['typescript', 'bun-plugin-dtsx'],
    includePrerelease: false, // Don't include alpha, beta, rc versions by default
    excludeMajor: false, // Allow major updates (controlled by ignore list)
    // No custom groups - use default grouping (major separate, non-major together)
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
    reviewers: ['chrisbbreuer', 'glennmichael123'],
    assignees: ['chrisbbreuer', 'glennmichael123'],
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
