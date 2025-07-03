import type { BuddyBotConfig } from './src/types'

const config: BuddyBotConfig = {
  verbose: true,
  packages: {
    strategy: 'all',
    ignore: ['@types/bun'], // Example ignore
  },

  // Scheduling (uncomment to enable automated runs)
  // schedule: {
  //   cron: '0 2 * * 1', // Monday 2 AM
  //   timezone: 'America/New_York',
  //   runOnStartup: false,
  //   maxRuntime: 30 * 60 * 1000 // 30 minutes
  // }
}

export default config
