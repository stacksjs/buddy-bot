import type { BuddyBotConfig } from './src/types'

const config: BuddyBotConfig = {
  verbose: true,
  packages: {
    strategy: 'all',
    ignore: ['@types/bun'] // Example ignore
  }
}

export default config
